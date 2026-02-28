const dbManager = require("../data/database-manager");
const { logError, logInfo, logDebug } = require("../helpers/logger-api");
const { FINANCE_INTEGRITY_CALCULATION } = require("../data/settings");
const JSONDatabase = require("../data/json-database");

class FinancialService {
  constructor() {
    // Support both old (array) and new (object) formats
    this.db = dbManager.getFinancialDatabase();
  }

  // Helper to load the full data structure
  async _getData() {
    const data = await this.db.getAll();
    // If old format (array), migrate to new format
    if (Array.isArray(data)) {
      return {
        accounts: data,
        counters: {
          lastAccountId: data.length,
          lastTransactionId: this._getMaxTransactionId(data),
        },
      };
    }
    return data;
  }

  // Helper to save the full data structure
  async _saveData(data) {
    await this.db.replaceAll(data);
  }

  // Helper to get max transaction ID from old data
  _getMaxTransactionId(accounts) {
    let maxId = 0;
    for (const acc of accounts) {
      for (const t of acc.transactions || []) {
        if (typeof t.id === "number" && t.id > maxId) maxId = t.id;
      }
    }
    return maxId;
  }

  // Helper to recalculate all balances for an account
  recalculateAllBalances(account) {
    let runningBalance = 0;
    // Sort transactions by timestamp ascending
    account.transactions.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    );
    for (const tx of account.transactions) {
      tx.balanceBefore = runningBalance;
      if (tx.type === "income") {
        runningBalance += tx.amount;
      } else if (tx.type === "expense") {
        runningBalance -= tx.amount;
      }
      tx.balanceAfter = runningBalance;
    }
    account.balance = runningBalance;
  }

  // Verify balance calculation is correct
  verifyBalanceCalculation(account) {
    let calculatedBalance = 0;
    const transactions = [...(account.transactions || [])].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    );

    for (const tx of transactions) {
      if (tx.type === "income") {
        calculatedBalance += tx.amount;
      } else if (tx.type === "expense") {
        calculatedBalance -= tx.amount;
      }
    }

    const isCorrect = Math.abs(calculatedBalance - account.balance) < 0.01; // Allow for floating point precision

    if (!isCorrect) {
      logError(`Balance mismatch detected for user ${account.userId}:`, {
        storedBalance: account.balance,
        calculatedBalance: calculatedBalance,
        difference: account.balance - calculatedBalance,
        transactionCount: transactions.length,
      });
    }

    return isCorrect;
  }

  // Ensure counters exist and are correct
  _ensureCounters(data) {
    let changed = false;
    if (!data.counters) {
      data.counters = { lastAccountId: 0, lastTransactionId: 0 };
      changed = true;
    }
    // Scan accounts for max IDs if needed
    if (data.accounts) {
      const maxAccountId = data.accounts.reduce(
        (max, acc) =>
          typeof acc.id === "number" && acc.id > max ? acc.id : max,
        0,
      );
      if (
        !data.counters.lastAccountId ||
        data.counters.lastAccountId < maxAccountId
      ) {
        data.counters.lastAccountId = maxAccountId;
        changed = true;
      }
      let maxTxId = 0;
      for (const acc of data.accounts) {
        for (const t of acc.transactions || []) {
          if (typeof t.id === "number" && t.id > maxTxId) maxTxId = t.id;
        }
      }
      if (
        !data.counters.lastTransactionId ||
        data.counters.lastTransactionId < maxTxId
      ) {
        data.counters.lastTransactionId = maxTxId;
        changed = true;
      }
    }
    return changed;
  }

  // Get next account ID
  async _getNextAccountId() {
    const data = await this._getData();
    if (this._ensureCounters(data)) {
      await this._saveData(data);
    }
    data.counters.lastAccountId = (data.counters.lastAccountId || 0) + 1;
    await this._saveData(data);
    return data.counters.lastAccountId;
  }

  // Get next transaction ID
  async _getNextTransactionId() {
    const data = await this._getData();
    if (this._ensureCounters(data)) {
      await this._saveData(data);
    }
    data.counters.lastTransactionId =
      (data.counters.lastTransactionId || 0) + 1;
    await this._saveData(data);
    return data.counters.lastTransactionId;
  }

  // Get all accounts
  async _getAccounts() {
    const data = await this._getData();
    return data.accounts;
  }

  // Save all accounts
  async _saveAccounts(accounts) {
    const data = await this._getData();
    data.accounts = accounts;
    await this._saveData(data);
  }

  /**
   * Initialize or get user's financial account
   */
  async initializeAccount(userId) {
    try {
      const accounts = await this._getAccounts();
      // Convert userId to number for consistent comparison
      const numericUserId = parseInt(userId, 10);
      let account = accounts.find(
        (acc) => parseInt(acc.userId, 10) === numericUserId,
      );
      if (!account) {
        const newId = await this._getNextAccountId();
        account = {
          id: newId,
          userId: numericUserId, // Store as number
          balance: 0,
          currency: "ROL",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          transactions: [],
        };
        accounts.push(account);
        await this._saveAccounts(accounts);
        logDebug(`Financial account initialized for user: ${numericUserId}`);
      }
      return account;
    } catch (error) {
      logError("Error initializing financial account:", error);
      throw new Error("Failed to initialize financial account");
    }
  }

  /**
   * Get user's financial account
   */
  async getAccount(userId) {
    try {
      const accounts = await this._getAccounts();
      // Convert userId to number for consistent comparison
      const numericUserId = parseInt(userId, 10);
      const account = accounts.find(
        (acc) => parseInt(acc.userId, 10) === numericUserId,
      );
      if (!account) {
        return await this.initializeAccount(userId);
      }

      // Only perform integrity calculations if the setting is enabled
      if (FINANCE_INTEGRITY_CALCULATION) {
        // Ensure balance is recalculated for accuracy
        this.recalculateAllBalances(account);

        // Verify the calculation is correct
        const isBalanceCorrect = this.verifyBalanceCalculation(account);
        if (!isBalanceCorrect) {
          logError(
            `Balance verification failed for user ${numericUserId}, recalculating...`,
          );
          this.recalculateAllBalances(account);
        }

        // If balance was recalculated, save the updated account
        const accountsAfterRecalc = await this._getAccounts();
        const accountAfterRecalc = accountsAfterRecalc.find(
          (acc) => parseInt(acc.userId, 10) === numericUserId,
        );
        if (
          accountAfterRecalc &&
          accountAfterRecalc.balance !== account.balance
        ) {
          await this._saveAccounts(accountsAfterRecalc);
          logInfo(
            `Balance updated for user ${numericUserId}: ${account.balance} -> ${accountAfterRecalc.balance}`,
          );
        }
      }

      // Ensure userId is a number in the returned object
      return { ...account, userId: numericUserId };
    } catch (error) {
      logError("Error getting financial account:", error);
      throw new Error("Failed to get financial account");
    }
  }

  /**
   * Add a transaction to user's account
   */
  async addTransaction(userId, transactionData) {
    try {
      const { type, amount, description, category, referenceId } =
        transactionData;
      if (!type || !amount || !description) {
        throw new Error("Missing required transaction fields");
      }
      if (amount <= 0) {
        throw new Error("Transaction amount must be positive");
      }
      const accounts = await this._getAccounts();
      const numericUserId = parseInt(userId, 10);
      const account = accounts.find(
        (acc) => parseInt(acc.userId, 10) === numericUserId,
      );
      if (!account) throw new Error("Account not found");
      if (type === "expense" && account.balance < amount) {
        throw new Error("Insufficient funds: overdraft is not allowed");
      }
      const newTransactionId = await this._getNextTransactionId();
      const transaction = {
        id: newTransactionId,
        type: type,
        amount: parseFloat(amount),
        description: description,
        category: category || "general",
        referenceId: referenceId || null,
        timestamp: new Date().toISOString(),
        balanceBefore: 0, // will be recalculated
        balanceAfter: 0, // will be recalculated
      };
      // Add transaction to account
      account.transactions.push(transaction);

      // Only recalculate all balances if integrity calculation is enabled
      if (FINANCE_INTEGRITY_CALCULATION) {
        this.recalculateAllBalances(account);
      } else {
        // Simple balance update without full recalculation
        if (type === "income") {
          account.balance += parseFloat(amount);
        } else if (type === "expense") {
          account.balance -= parseFloat(amount);
        }
      }

      account.updatedAt = new Date().toISOString();
      // Save all accounts
      await this._saveAccounts(accounts);
      logInfo(`Transaction added for user ${userId}: ${type} ${amount} ROL`);
      return transaction;
    } catch (error) {
      logError("Error adding transaction:", error);
      throw error;
    }
  }

  /**
   * Get user's transaction history
   */
  async getTransactionHistory(userId, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        type = null,
        category = null,
        startDate = null,
        endDate = null,
      } = options;

      const account = await this.getAccount(userId);
      let transactions = account.transactions || [];

      // Filter by type
      if (type) {
        transactions = transactions.filter((t) => t.type === type);
      }

      // Filter by category
      if (category) {
        transactions = transactions.filter((t) => t.category === category);
      }

      // Filter by date range
      if (startDate) {
        transactions = transactions.filter(
          (t) => new Date(t.timestamp) >= new Date(startDate),
        );
      }
      if (endDate) {
        transactions = transactions.filter(
          (t) => new Date(t.timestamp) <= new Date(endDate),
        );
      }

      // Sort by timestamp (newest first)
      transactions.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );

      // Apply pagination
      const paginatedTransactions = transactions.slice(offset, offset + limit);

      return {
        transactions: paginatedTransactions,
        total: transactions.length,
        limit,
        offset,
        hasMore: offset + limit < transactions.length,
      };
    } catch (error) {
      logError("Error getting transaction history:", error);
      throw new Error("Failed to get transaction history");
    }
  }

  /**
   * Get financial statistics for user
   */
  async getFinancialStats(userId) {
    try {
      const account = await this.getAccount(userId);
      const transactions = account.transactions || [];

      const stats = {
        currentBalance: account.balance,
        totalIncome: 0,
        totalExpenses: 0,
        totalTransferred: 0,
        transactionCount: transactions.length,
        categories: {},
        monthlyStats: {},
      };

      transactions.forEach((transaction) => {
        if (transaction.type === "income") {
          stats.totalIncome += transaction.amount;
        } else if (transaction.type === "expense") {
          stats.totalExpenses += transaction.amount;
        }

        // Calculate total transferred money (transfers and marketplace transactions)
        if (
          transaction.category === "transfer" ||
          transaction.category === "marketplace"
        ) {
          stats.totalTransferred += transaction.amount;
        }

        // Category statistics
        if (!stats.categories[transaction.category]) {
          stats.categories[transaction.category] = {
            count: 0,
            total: 0,
          };
        }
        stats.categories[transaction.category].count++;
        stats.categories[transaction.category].total += transaction.amount;

        // Monthly statistics
        const month = new Date(transaction.timestamp)
          .toISOString()
          .substring(0, 7);
        if (!stats.monthlyStats[month]) {
          stats.monthlyStats[month] = {
            income: 0,
            expenses: 0,
            count: 0,
          };
        }
        if (transaction.type === "income") {
          stats.monthlyStats[month].income += transaction.amount;
        } else if (transaction.type === "expense") {
          stats.monthlyStats[month].expenses += transaction.amount;
        }
        stats.monthlyStats[month].count++;
      });

      return stats;
    } catch (error) {
      logError("Error getting financial statistics:", error);
      throw new Error("Failed to get financial statistics");
    }
  }

  /**
   * Get comprehensive marketplace statistics across all users
   */
  async getMarketplaceStats() {
    try {
      // Get marketplace data using singleton
      const marketplaceDb = dbManager.getMarketplaceDatabase();
      const marketplaceData = await marketplaceDb.getAll();

      // Get financial data for volume calculation
      const accounts = await this._getAccounts();
      let totalVolume = 0;

      accounts.forEach((account) => {
        const transactions = account.transactions || [];
        transactions.forEach((transaction) => {
          if (transaction.category === "marketplace") {
            totalVolume += transaction.amount;
          }
        });
      });

      // Calculate statistics
      const stats = {
        totalActiveOffers: 0,
        totalOffers: 0,
        totalTransactions: 0,
        totalVolume: totalVolume / 2, // Divide by 2 to avoid double counting
        offersByType: {
          field: 0,
          animal: 0,
        },
        activeOffersByType: {
          field: 0,
          animal: 0,
        },
      };

      // Count offers
      if (marketplaceData.offers && Array.isArray(marketplaceData.offers)) {
        marketplaceData.offers.forEach((offer) => {
          stats.totalOffers++;

          if (offer.status === "active") {
            stats.totalActiveOffers++;
            if (offer.itemType === "field") {
              stats.activeOffersByType.field++;
            } else if (offer.itemType === "animal") {
              stats.activeOffersByType.animal++;
            }
          }

          if (offer.itemType === "field") {
            stats.offersByType.field++;
          } else if (offer.itemType === "animal") {
            stats.offersByType.animal++;
          }
        });
      }

      // Count transactions
      if (
        marketplaceData.transactions &&
        Array.isArray(marketplaceData.transactions)
      ) {
        stats.totalTransactions = marketplaceData.transactions.length;
      }

      return stats;
    } catch (error) {
      logError("Error getting marketplace statistics:", error);
      throw new Error("Failed to get marketplace statistics");
    }
  }

  // Find account by userId, do not create if missing
  async findAccount(userId) {
    const accounts = await this._getAccounts();
    const numericUserId = parseInt(userId, 10);
    return (
      accounts.find((acc) => parseInt(acc.userId, 10) === numericUserId) || null
    );
  }

  /**
   * Transfer funds between users (for marketplace/giełda functionality)
   */
  async transferFunds(fromUserId, toUserId, amount, description) {
    try {
      if (amount <= 0) {
        throw new Error("Transfer amount must be positive");
      }
      if (amount > 999.99) {
        throw new Error("Cannot transfer more than 999.99 ROL at once");
      }
      const fromAccount = await this.getAccount(fromUserId);
      if (fromAccount.balance < amount) {
        throw new Error(
          "Insufficient funds for transfer: overdraft is not allowed",
        );
      }
      // Check if recipient exists (do not create)
      const toAccount = await this.findAccount(toUserId);
      if (!toAccount) {
        throw new Error("Recipient user does not exist");
      }
      // Add expense transaction to sender
      await this.addTransaction(fromUserId, {
        type: "expense",
        amount: amount,
        description: `Transfer to user: ${description}`,
        category: "transfer",
        referenceId: toUserId,
      });
      // Add income transaction to receiver
      await this.addTransaction(toUserId, {
        type: "income",
        amount: amount,
        description: `Transfer from user: ${description}`,
        category: "transfer",
        referenceId: fromUserId,
      });
      logInfo(
        `Transfer completed: ${fromUserId} -> ${toUserId}, amount: ${amount} ROL`,
      );
      return { success: true, amount };
    } catch (error) {
      logError("Error transferring funds:", error);
      throw error;
    }
  }

  /**
   * Get all financial accounts (admin only)
   */
  async getAllAccounts() {
    try {
      return await this._getAccounts();
    } catch (error) {
      logError("Error getting all accounts:", error);
      throw new Error("Failed to get all accounts");
    }
  }

  /**
   * Update account balance (admin function for system operations)
   */
  async updateAccountBalance(userId, amount, description) {
    try {
      const account = await this.getAccount(userId);

      await this.addTransaction(userId, {
        type: amount > 0 ? "income" : "expense",
        amount: Math.abs(amount),
        description: description || "System adjustment",
        category: "system",
      });

      return await this.getAccount(userId);
    } catch (error) {
      logError("Error updating account balance:", error);
      throw error;
    }
  }

  /**
   * Get all transactions across all users (admin only)
   * @param {Object} options - Optional filters: type, category, startDate, endDate
   * @returns {Array} All transactions
   */
  async getAllTransactions(options = {}) {
    const { type, category, startDate, endDate } = options;
    const data = await this._getData();
    let allTransactions = [];
    for (const account of data.accounts) {
      if (Array.isArray(account.transactions)) {
        for (const tx of account.transactions) {
          allTransactions.push({ ...tx, userId: account.userId });
        }
      }
    }
    // Apply filters if provided
    if (type) {
      allTransactions = allTransactions.filter((tx) => tx.type === type);
    }
    if (category) {
      allTransactions = allTransactions.filter(
        (tx) => tx.category === category,
      );
    }
    if (startDate) {
      allTransactions = allTransactions.filter(
        (tx) => new Date(tx.timestamp) >= new Date(startDate),
      );
    }
    if (endDate) {
      allTransactions = allTransactions.filter(
        (tx) => new Date(tx.timestamp) <= new Date(endDate),
      );
    }
    // Sort by timestamp descending
    allTransactions.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
    );
    return allTransactions;
  }
}

module.exports = new FinancialService();
