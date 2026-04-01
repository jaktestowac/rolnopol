const dbManager = require("../../data/database-manager");

class ChatbotContextService {
  constructor() {
    this.fieldsDb = dbManager.getFieldsDatabase();
    this.staffDb = dbManager.getStaffDatabase();
    this.animalsDb = dbManager.getAnimalsDatabase();
    this.financialDb = dbManager.getFinancialDatabase();
    this.marketplaceDb = dbManager.getMarketplaceDatabase();
    this.assignmentsDb = dbManager.getAssignmentsDatabase();
  }

  async _loadUserResources(userId) {
    const numericUserId = Number(userId);

    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      throw new Error("Validation failed: invalid user id");
    }

    // Load all user resources in parallel
    const [fields, staff, animals, assignments, financialData, marketplaceData] = await Promise.all([
      this.fieldsDb.find((item) => Number(item?.userId) === numericUserId),
      this.staffDb.find((item) => Number(item?.userId) === numericUserId),
      this.animalsDb.find((item) => Number(item?.userId) === numericUserId),
      this.assignmentsDb.find((item) => Number(item?.userId) === numericUserId),
      this._loadUserFinancialData(numericUserId),
      this._loadUserMarketplaceData(numericUserId),
    ]);

    return {
      fields: Array.isArray(fields) ? fields : [],
      staff: Array.isArray(staff) ? staff : [],
      animals: Array.isArray(animals) ? animals : [],
      assignments: Array.isArray(assignments) ? assignments : [],
      financial: financialData,
      marketplace: marketplaceData,
    };
  }

  async _loadUserFinancialData(userId) {
    // Get the full financial database (complex object with accounts array)
    const allData = await this.financialDb.read();
    const accounts = allData.accounts || [];

    // Find account for this user
    const userAccount = accounts.find((acc) => Number(acc?.userId) === userId);

    if (!userAccount) {
      return {
        account: null,
        balance: 0,
        currency: "ROL",
        transactions: [],
      };
    }

    return {
      account: {
        id: userAccount.id,
        balance: userAccount.balance,
        currency: userAccount.currency,
        createdAt: userAccount.createdAt,
      },
      balance: userAccount.balance,
      currency: userAccount.currency,
      transactions: Array.isArray(userAccount.transactions) ? userAccount.transactions : [],
    };
  }

  async _loadUserMarketplaceData(userId) {
    // Get the full marketplace database (complex object with offers and transactions arrays)
    const allData = await this.marketplaceDb.read();
    const offers = allData.offers || [];
    const transactions = allData.transactions || [];

    // Find offers from this user as seller
    const userOffers = offers.filter((offer) => Number(offer?.sellerId) === userId);

    // Find marketplace transactions involving this user
    const userTransactions = transactions.filter(
      (transaction) => Number(transaction?.buyerId) === userId || Number(transaction?.sellerId) === userId,
    );

    return {
      offers: userOffers.map((offer) => ({
        id: offer.id,
        itemType: offer.itemType,
        itemId: offer.itemId,
        price: offer.price,
        status: offer.status,
        createdAt: offer.createdAt,
      })),
      transactions: userTransactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        offerId: transaction.offerId,
        buyerId: transaction.buyerId,
        sellerId: transaction.sellerId,
        amount: transaction.amount,
        status: transaction.status,
        createdAt: transaction.createdAt,
      })),
    };
  }

  _toCompactContext(resources) {
    const fields = resources.fields || [];
    const staff = resources.staff || [];
    const animals = resources.animals || [];
    const assignments = resources.assignments || [];
    const financial = resources.financial || {};
    const marketplace = resources.marketplace || {};

    const totalFieldArea = fields.reduce((sum, field) => sum + (Number(field?.area) || 0), 0);
    const totalAnimals = animals.reduce((sum, animal) => sum + (Number(animal?.amount) || 0), 0);

    // Financial summaries
    const transactions = financial.transactions || [];
    const incomeTransactions = transactions.filter((t) => t.type === "income");
    const expenseTransactions = transactions.filter((t) => t.type === "expense");
    const totalIncome = incomeTransactions.reduce((sum, t) => sum + (Number(t?.amount) || 0), 0);
    const totalExpense = expenseTransactions.reduce((sum, t) => sum + (Number(t?.amount) || 0), 0);

    // Marketplace summaries
    const offers = marketplace.offers || [];
    const activeOffers = offers.filter((o) => o.status === "active");
    const marketplaceTransactions = marketplace.transactions || [];

    return {
      summary: {
        fieldsCount: fields.length,
        totalFieldAreaHa: Number(totalFieldArea.toFixed(2)),
        staffCount: staff.length,
        assignmentsCount: assignments.length,
        animalRecordsCount: animals.length,
        totalAnimals,
        accountBalance: financial.balance || 0,
        accountCurrency: financial.currency || "ROL",
        totalIncome,
        totalExpense,
        transactionCount: transactions.length,
        activeMarketplaceOffers: activeOffers.length,
        marketplaceTransactionCount: marketplaceTransactions.length,
      },
      samples: {
        fields: fields.slice(0, 5).map((field) => ({
          id: field.id,
          name: field.name || null,
          districtName: field.districtName || field.district || null,
          area: Number(field.area) || 0,
          cropType: field.cropType || null,
        })),
        staff: staff.slice(0, 5).map((member) => ({
          id: member.id,
          name: member.name || null,
          surname: member.surname || null,
          position: member.position || null,
          age: Number(member.age) || null,
        })),
        animals: animals.slice(0, 5).map((animal) => ({
          id: animal.id,
          type: animal.type || null,
          amount: Number(animal.amount) || 0,
          fieldId: animal.fieldId ?? null,
        })),
        assignments: assignments.slice(0, 3).map((assignment) => ({
          id: assignment.id,
          title: assignment.title || null,
          assignedTo: assignment.assignedTo || null,
          status: assignment.status || null,
        })),
        recentTransactions: transactions.slice(-5).map((transaction) => ({
          id: transaction.id,
          type: transaction.type,
          amount: Number(transaction.amount) || 0,
          category: transaction.category || null,
          description: transaction.description || null,
          timestamp: transaction.timestamp,
        })),
        marketplaceOffers: activeOffers.slice(0, 3).map((offer) => ({
          id: offer.id,
          itemType: offer.itemType,
          price: Number(offer.price) || 0,
          status: offer.status,
        })),
      },
    };
  }

  async getContextForUser(userId) {
    const resources = await this._loadUserResources(userId);
    return this._toCompactContext(resources);
  }
}

module.exports = new ChatbotContextService();
