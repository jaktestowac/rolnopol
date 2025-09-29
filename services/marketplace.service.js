const dbManager = require("../data/database-manager");
const logger = require("../helpers/logger-api");

class MarketplaceService {
  constructor() {
    this.marketplaceDb = dbManager.getMarketplaceDatabase();
    this.fieldsDb = dbManager.getFieldsDatabase();
    this.animalsDb = dbManager.getAnimalsDatabase();
    this.financialDb = dbManager.getFinancialDatabase();
    this.usersDb = dbManager.getUsersDatabase();
  }

  async getOffers(userId) {
    const marketplaceData = await this.marketplaceDb.read();
    const offers = marketplaceData.offers.filter(
      (offer) => offer.status === "active",
    );
    const validatedOffers = await this._validateAndUpdateOffers(offers);
    const [allAnimals, allFields, allUsers] = await Promise.all([
      this.animalsDb.read(),
      this.fieldsDb.read(),
      this.usersDb.read(),
    ]);
    const filteredOffers = validatedOffers
      .filter((offer) => {
        return (
          Number(offer.sellerId) !== Number(userId) &&
          offer.sellerId !== userId &&
          offer.status === "active"
        );
      })
      .map((offer) => {
        let details = {};
        if (offer.itemType === "animal") {
          const animal = allAnimals.find(
            (a) => Number(a.id) === Number(offer.itemId),
          );
          if (animal) details = { type: animal.type, amount: animal.amount };
        } else if (offer.itemType === "field") {
          const field = allFields.find(
            (f) => Number(f.id) === Number(offer.itemId),
          );
          if (field) details = { name: field.name, area: field.area };
        }
        const seller = allUsers.find(
          (u) => Number(u.id) === Number(offer.sellerId),
        );
        return {
          ...offer,
          details,
          // Prefer displayedName; otherwise show masked email
          sellerLabel: seller
            ? (seller.displayedName && seller.displayedName.trim().length > 0
                ? seller.displayedName
                : this._maskEmail(seller.email))
            : undefined,
        };
      });
    return { filteredOffers };
  }

  async getMyOffers(userId) {
    const marketplaceData = await this.marketplaceDb.read();
    const [allAnimals, allFields, allUsers] = await Promise.all([
      this.animalsDb.read(),
      this.fieldsDb.read(),
      this.usersDb.read(),
    ]);
    const myOffers = marketplaceData.offers.filter(
      (offer) =>
        Number(offer.sellerId) === Number(userId) || offer.sellerId === userId,
    );
    const validatedMyOffers = await this._validateAndUpdateOffers(myOffers);
    const enrichedMyOffers = validatedMyOffers.map((offer) => {
      let details = {};
      if (offer.itemType === "animal") {
        const animal = allAnimals.find(
          (a) => Number(a.id) === Number(offer.itemId),
        );
        if (animal) details = { type: animal.type, amount: animal.amount };
      } else if (offer.itemType === "field") {
        const field = allFields.find(
          (f) => Number(f.id) === Number(offer.itemId),
        );
        if (field) details = { name: field.name, area: field.area };
      }
      const seller = allUsers.find(
        (u) => Number(u.id) === Number(offer.sellerId),
      );
      return {
        ...offer,
        details,
        sellerLabel: seller
          ? (seller.displayedName && seller.displayedName.trim().length > 0
              ? seller.displayedName
              : this._maskEmail(seller.email))
          : undefined,
      };
    });
    return { enrichedMyOffers };
  }

  async createOffer(userId, { itemType, itemId, price, description }) {
    // check if user exist
    const users = await this.usersDb.read();
    const userData = users.find((user) => Number(user.id) === Number(userId));
    if (!userData) throw { statusCode: 400, message: "User not found" };
    if (!itemType || !itemId || !price)
      throw {
        statusCode: 400,
        message: "Missing required fields: itemType, itemId, price",
      };
    if (!["field", "animal"].includes(itemType))
      throw {
        statusCode: 400,
        message: 'Invalid item type. Must be "field" or "animal"',
      };
    if (price <= 0)
      throw { statusCode: 400, message: "Price must be greater than 0" };
    if (description && description.length > 300)
      throw {
        statusCode: 400,
        message: "Description cannot exceed 300 characters",
      };
    if (description && /[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(description))
      throw {
        statusCode: 400,
        message: "Description contains invalid characters",
      };
    // Verify item ownership and availability
    let item;
    try {
      item = await this._verifyItemOwnership(itemType, itemId, userId);
    } catch (err) {
      throw { statusCode: 400, message: err.message };
    }
    if (!item)
      throw { statusCode: 404, message: "Item not found or not owned by user" };
    // Check if item is already offered
    const marketplaceData = await this.marketplaceDb.read();
    const existingOffer = marketplaceData.offers.find(
      (offer) =>
        offer.itemType === itemType &&
        (Number(offer.itemId) === Number(itemId) || offer.itemId === itemId) &&
        offer.status === "active",
    );
    if (existingOffer)
      throw { statusCode: 400, message: "Item is already offered for sale" };
    // Create new offer
    const newOffer = {
      id: ++marketplaceData.counters.lastOfferId,
      sellerId: Number(userId),
      itemType,
      itemId: Number(itemId),
      price: parseFloat(price),
      description: description || "",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    marketplaceData.offers.push(newOffer);
    await this.marketplaceDb.write(marketplaceData);
    return { newOffer };
  }

  async buyItem(buyerId, offerId) {
    if (!offerId)
      throw { statusCode: 400, message: "Missing required field: offerId" };
    const marketplaceData = await this.marketplaceDb.read();
    const offer = marketplaceData.offers.find(
      (o) => o.id === offerId && o.status === "active",
    );
    if (!offer)
      throw { statusCode: 404, message: "Offer not found or not available" };
    if (
      Number(offer.sellerId) === Number(buyerId) ||
      offer.sellerId === buyerId
    )
      throw { statusCode: 400, message: "Cannot buy your own offer" };
    const buyerBalance = await this._getUserBalance(buyerId);
    if (buyerBalance < offer.price)
      throw {
        statusCode: 400,
        message:
          "Insufficient funds to complete purchase (no overdraft allowed)",
      };
    let item;
    try {
      item = await this._verifyItemOwnership(
        offer.itemType,
        offer.itemId,
        offer.sellerId,
      );
    } catch (err) {
      throw { statusCode: 400, message: err.message };
    }
    if (!item)
      throw {
        statusCode: 404,
        message: "Item no longer available for purchase",
      };
    const transaction = await this._processPurchase(offer, buyerId);
    return transaction;
  }

  async cancelOffer(userId, offerId) {
    const marketplaceData = await this.marketplaceDb.read();
    const offer = marketplaceData.offers.find(
      (o) => o.id === parseInt(offerId),
    );
    if (!offer) throw { statusCode: 404, message: "Offer not found" };
    if (Number(offer.sellerId) !== Number(userId) && offer.sellerId !== userId)
      throw { statusCode: 403, message: "Not authorized to cancel this offer" };
    if (offer.status !== "active")
      throw { statusCode: 400, message: "Offer is not active" };
    offer.status = "cancelled";
    offer.updatedAt = new Date().toISOString();
    await this.marketplaceDb.write(marketplaceData);
    return { success: true };
  }

  async getTransactionHistory(userId) {
    const marketplaceData = await this.marketplaceDb.read();
    const userTransactions = marketplaceData.transactions.filter(
      (transaction) =>
        Number(transaction.buyerId) === Number(userId) ||
        transaction.buyerId === userId ||
        Number(transaction.sellerId) === Number(userId) ||
        transaction.sellerId === userId,
    );
    return { userTransactions };
  }

  async getAllOffersAdmin(query) {
    const { sellerId, itemType, status, startDate, endDate } = query;
    const marketplaceData = await this.marketplaceDb.read();
    const [allAnimals, allFields] = await Promise.all([
      this.animalsDb.read(),
      this.fieldsDb.read(),
    ]);
    let offers = marketplaceData.offers;
    if (sellerId)
      offers = offers.filter((o) => String(o.sellerId) === String(sellerId));
    if (itemType) offers = offers.filter((o) => o.itemType === itemType);
    if (status) offers = offers.filter((o) => o.status === status);
    if (startDate)
      offers = offers.filter(
        (o) => o.createdAt && new Date(o.createdAt) >= new Date(startDate),
      );
    if (endDate)
      offers = offers.filter(
        (o) => o.createdAt && new Date(o.createdAt) <= new Date(endDate),
      );
    const enrichedOffers = offers.map((offer) => {
      let details = {};
      if (offer.itemType === "animal") {
        const animal = allAnimals.find(
          (a) => Number(a.id) === Number(offer.itemId),
        );
        if (animal) details = { type: animal.type, amount: animal.amount };
      } else if (offer.itemType === "field") {
        const field = allFields.find(
          (f) => Number(f.id) === Number(offer.itemId),
        );
        if (field) details = { name: field.name, area: field.area };
      }
      return { ...offer, details };
    });
    return { enrichedOffers };
  }

  async getAllTransactionsAdmin(query) {
    const { sellerId, buyerId, itemType, status, startDate, endDate } = query;
    const marketplaceData = await this.marketplaceDb.read();
    let transactions = marketplaceData.transactions;
    if (sellerId)
      transactions = transactions.filter(
        (t) => String(t.sellerId) === String(sellerId),
      );
    if (buyerId)
      transactions = transactions.filter(
        (t) => String(t.buyerId) === String(buyerId),
      );
    if (itemType)
      transactions = transactions.filter((t) => t.itemType === itemType);
    if (status) transactions = transactions.filter((t) => t.status === status);
    if (startDate)
      transactions = transactions.filter(
        (t) => t.createdAt && new Date(t.createdAt) >= new Date(startDate),
      );
    if (endDate)
      transactions = transactions.filter(
        (t) => t.createdAt && new Date(t.createdAt) <= new Date(endDate),
      );
    return { transactions };
  }

  // --- Private helpers ---
  async _checkItemAvailability(itemType, itemId) {
    try {
      const numericItemId = Number(itemId);
      if (itemType === "field") {
        const fields = await this.fieldsDb.read();
        const field = fields.find((f) => Number(f.id) === numericItemId);
        if (!field) return false;
        const animals = await this.animalsDb.read();
        const fieldAnimals = animals.filter(
          (a) => Number(a.fieldId) === numericItemId,
        );
        return fieldAnimals.length === 0;
      } else if (itemType === "animal") {
        const animals = await this.animalsDb.read();
        const animal = animals.find((a) => Number(a.id) === numericItemId);
        if (!animal) return false;
        return !animal.fieldId || Number(animal.fieldId) === 0;
      }
      return false;
    } catch (error) {
      logger.logError("Error checking item availability:", error);
      return false;
    }
  }

  async _validateAndUpdateOffers(offers) {
    try {
      const marketplaceData = await this.marketplaceDb.read();
      let hasChanges = false;
      for (const offer of offers) {
        if (offer.status === "active") {
          const isAvailable = await this._checkItemAvailability(
            offer.itemType,
            offer.itemId,
          );
          if (!isAvailable) {
            const offerIndex = marketplaceData.offers.findIndex(
              (o) => o.id === offer.id,
            );
            if (offerIndex !== -1) {
              marketplaceData.offers[offerIndex].status = "unavailable";
              marketplaceData.offers[offerIndex].updatedAt =
                new Date().toISOString();
              offer.status = "unavailable";
              logger.logError(
                `Offer ${offer.id} (${offer.itemType} ${offer.itemId}) marked as unavailable - item is in use`,
              );
              hasChanges = true;
            }
          }
        }
      }
      if (hasChanges) {
        await this.marketplaceDb.write(marketplaceData);
      }
      return offers;
    } catch (error) {
      logger.logError("Error validating offers:", error);
      return offers;
    }
  }

  // Mask email helper for labels
  _maskEmail(email) {
    if (!email || typeof email !== "string") return "Unknown";
    const atIdx = email.indexOf("@");
    if (atIdx === -1) return email;
    const local = email.slice(0, atIdx);
    const domain = email.slice(atIdx + 1);
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }

  async _verifyItemOwnership(itemType, itemId, userId) {
    try {
      const numericItemId = Number(itemId);
      const numericUserId = Number(userId);
      if (itemType === "field") {
        const fields = await this.fieldsDb.read();
        const field = fields.find(
          (f) =>
            Number(f.id) === numericItemId &&
            Number(f.userId) === numericUserId,
        );
        if (!field) return null;
        const animals = await this.animalsDb.read();
        const fieldAnimals = animals.filter(
          (a) => Number(a.fieldId) === numericItemId,
        );
        if (fieldAnimals.length > 0)
          throw new Error("Cannot sell field with assigned animals");
        return field;
      } else if (itemType === "animal") {
        const animals = await this.animalsDb.read();
        const animal = animals.find(
          (a) =>
            Number(a.id) === numericItemId &&
            Number(a.userId) === numericUserId,
        );
        if (!animal) return null;
        if (animal.fieldId && Number(animal.fieldId) !== 0)
          throw new Error("Cannot sell animal assigned to a field");
        return animal;
      }
      return null;
    } catch (error) {
      throw error;
    }
  }

  async _getUserBalance(userId) {
    try {
      const financial = await this.financialDb.read();
      const account = financial.accounts.find(
        (acc) => acc.userId === userId.toString(),
      );
      return account ? account.balance : 0;
    } catch (error) {
      return 0;
    }
  }

  async _processPurchase(offer, buyerId) {
    const marketplaceData = await this.marketplaceDb.read();
    const transaction = {
      id: ++marketplaceData.counters.lastTransactionId,
      offerId: offer.id,
      sellerId: Number(offer.sellerId),
      buyerId: Number(buyerId),
      itemType: offer.itemType,
      itemId: Number(offer.itemId),
      price: offer.price,
      status: "completed",
      createdAt: new Date().toISOString(),
    };
    offer.status = "sold";
    offer.updatedAt = new Date().toISOString();
    await this._transferItemOwnership(
      offer.itemType,
      offer.itemId,
      offer.sellerId,
      buyerId,
    );
    await this._updateFinancialBalances(offer.sellerId, buyerId, offer.price);
    marketplaceData.transactions.push(transaction);
    await this.marketplaceDb.write(marketplaceData);
    return transaction;
  }

  async _transferItemOwnership(itemType, itemId, fromUserId, toUserId) {
    try {
      const numericItemId = Number(itemId);
      const numericToUserId = Number(toUserId);
      if (itemType === "field") {
        const fields = await this.fieldsDb.read();
        const fieldIndex = fields.findIndex(
          (f) =>
            f.id === numericItemId ||
            f.id === itemId ||
            f.id === itemId.toString(),
        );
        if (fieldIndex !== -1) {
          fields[fieldIndex].userId = numericToUserId;
          await this.fieldsDb.write(fields);
        }
      } else if (itemType === "animal") {
        const animals = await this.animalsDb.read();
        const animalIndex = animals.findIndex(
          (a) =>
            a.id === numericItemId ||
            a.id === itemId ||
            a.id === itemId.toString(),
        );
        if (animalIndex !== -1) {
          animals[animalIndex].userId = numericToUserId;
          await this.animalsDb.write(animals);
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to transfer ${itemType} ownership: ${error.message}`,
      );
    }
  }

  async _updateFinancialBalances(sellerId, buyerId, amount) {
    try {
      const financial = await this.financialDb.read();
      const sellerAccount = financial.accounts.find(
        (acc) =>
          acc.userId === sellerId.toString() ||
          acc.userId === Number(sellerId).toString(),
      );
      if (sellerAccount) {
        const balanceBefore = sellerAccount.balance;
        sellerAccount.balance += amount;
        sellerAccount.updatedAt = new Date().toISOString();
        const sellerTransaction = {
          id: ++financial.counters.lastTransactionId,
          type: "income",
          amount: amount,
          description: "Marketplace sale",
          category: "marketplace",
          referenceId: null,
          timestamp: new Date().toISOString(),
          balanceBefore: balanceBefore,
          balanceAfter: sellerAccount.balance,
        };
        sellerAccount.transactions.push(sellerTransaction);
      }
      const buyerAccount = financial.accounts.find(
        (acc) =>
          acc.userId === buyerId.toString() ||
          acc.userId === Number(buyerId).toString(),
      );
      if (buyerAccount) {
        const balanceBefore = buyerAccount.balance;
        buyerAccount.balance -= amount;
        buyerAccount.updatedAt = new Date().toISOString();
        const buyerTransaction = {
          id: ++financial.counters.lastTransactionId,
          type: "expense",
          amount: amount,
          description: "Marketplace purchase",
          category: "marketplace",
          referenceId: null,
          timestamp: new Date().toISOString(),
          balanceBefore: balanceBefore,
          balanceAfter: buyerAccount.balance,
        };
        buyerAccount.transactions.push(buyerTransaction);
      }
      await this.financialDb.write(financial);
    } catch (error) {
      throw new Error(`Failed to update financial balances: ${error.message}`);
    }
  }
}

module.exports = new MarketplaceService();
