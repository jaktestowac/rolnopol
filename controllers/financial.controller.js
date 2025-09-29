const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const financialService = require("../services/financial.service");

class FinancialController {
  /**
   * Get user's financial account
   */
  async getAccount(req, res) {
    try {
      const account = await financialService.getAccount(req.user.userId);

      res.status(200).json(
        formatResponseBody({
          data: {
            account: account,
          },
        })
      );
    } catch (error) {
      logError("Error getting financial account:", error);

      let statusCode = 500;
      if (error.message.includes("not found")) statusCode = 404;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Add a new transaction
   */
  async addTransaction(req, res) {
    try {
      const { type, amount, description, category, cardNumber, cvv } = req.body;

      if (!type || !amount || !description) {
        return res.status(400).json(
          formatResponseBody({
            error: "Missing required fields: type, amount, description",
          })
        );
      }

      // Description validation (min 3, max 100, allowed chars)
      if (typeof description !== "string" || description.trim().length < 3) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description must be at least 3 characters long",
          })
        );
      }
      if (description.length > 100) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description cannot exceed 100 characters",
          })
        );
      }
      if (/[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(description)) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description contains invalid characters",
          })
        );
      }

      // Amount: max 2 decimal places
      if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
        return res.status(400).json(
          formatResponseBody({
            error: "Amount can have maximum 2 decimal places",
          })
        );
      }

      if (!["income", "expense"].includes(type)) {
        return res.status(400).json(
          formatResponseBody({
            error: "Invalid transaction type. Must be 'income' or 'expense'",
          })
        );
      }

      // For income, card details are mandatory and validated; they are NOT persisted nor returned
      if (type === "income") {
        const { isValidCardNumber, isValidCvv } = require("../helpers/validators");
        if (!cardNumber || !cvv) {
          return res.status(400).json(formatResponseBody({ error: "Missing required fields: cardNumber, cvv" }));
        }
        const sanitizedCard = String(cardNumber).replace(/\s+/g, "");
        if (!isValidCardNumber(sanitizedCard)) {
          return res.status(400).json(formatResponseBody({ error: "Invalid card number" }));
        }
        if (!isValidCvv(String(cvv))) {
          return res.status(400).json(formatResponseBody({ error: "Invalid CVV" }));
        }
        // Remove sensitive fields from request body to prevent accidental use/logging downstream
        delete req.body.cardNumber;
        delete req.body.cvv;
      }

      // Ensure no sensitive data is persisted
      const transaction = await financialService.addTransaction(req.user.userId, {
        type,
        amount: parseFloat(amount),
        description,
        category: category || "general",
      });

      res.status(201).json(
        formatResponseBody({
          message: "Transaction added successfully",
          data: {
            // never return sensitive data
            transaction: transaction,
          },
        })
      );
    } catch (error) {
      logError("Error adding transaction:", error);

      let statusCode = 500;
      if (error.message.includes("Missing required")) statusCode = 400;
      else if (error.message.includes("must be positive")) statusCode = 400;
      else if (error.message.includes("overdraft")) statusCode = 400;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(req, res) {
    try {
      const { limit, offset, type, category, startDate, endDate } = req.query;

      const options = {
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
        type: type || null,
        category: category || null,
        startDate: startDate || null,
        endDate: endDate || null,
      };

      const history = await financialService.getTransactionHistory(req.user.userId, options);

      res.status(200).json(
        formatResponseBody({
          data: history,
        })
      );
    } catch (error) {
      logError("Error getting transaction history:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get financial statistics
   */
  async getFinancialStats(req, res) {
    try {
      const stats = await financialService.getFinancialStats(req.user.userId);

      res.status(200).json(
        formatResponseBody({
          data: {
            statistics: stats,
          },
        })
      );
    } catch (error) {
      logError("Error getting financial statistics:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get total marketplace volume across all users
   */
  async getTotalMarketplaceVolume(req, res) {
    try {
      const totalVolume = await financialService.getTotalMarketplaceVolume();

      res.status(200).json(
        formatResponseBody({
          data: {
            totalVolume: totalVolume,
          },
        })
      );
    } catch (error) {
      logError("Error getting total marketplace volume:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get comprehensive marketplace statistics across all users
   */
  async getMarketplaceStats(req, res) {
    try {
      const stats = await financialService.getMarketplaceStats();

      res.status(200).json(
        formatResponseBody({
          data: stats,
        })
      );
    } catch (error) {
      logError("Error getting marketplace statistics:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Transfer funds to another user
   */
  async transferFunds(req, res) {
    try {
      const { toUserId, amount, description } = req.body;

      if (!toUserId || !amount || !description) {
        return res.status(400).json(
          formatResponseBody({
            error: "Missing required fields: toUserId, amount, description",
          })
        );
      }

      // Description validation (min 3, max 100, allowed chars)
      if (typeof description !== "string" || description.trim().length < 3) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description must be at least 3 characters long",
          })
        );
      }
      if (description.length > 100) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description cannot exceed 100 characters",
          })
        );
      }
      if (/[^\w\s.,;:!()\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(description)) {
        return res.status(400).json(
          formatResponseBody({
            error: "Description contains invalid characters",
          })
        );
      }

      // Amount: max 2 decimal places
      if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
        return res.status(400).json(
          formatResponseBody({
            error: "Amount can have maximum 2 decimal places",
          })
        );
      }

      if (req.user.userId === toUserId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Cannot transfer funds to yourself",
          })
        );
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json(
          formatResponseBody({
            error: "Transfer amount must be positive",
          })
        );
      }
      if (parsedAmount > 999.99) {
        return res.status(400).json(
          formatResponseBody({
            error: "Cannot transfer more than 999.99 ROL at once",
          })
        );
      }
      // Check sender's balance
      const senderAccount = await financialService.getAccount(req.user.userId);
      if (senderAccount.balance < parsedAmount) {
        return res.status(400).json(
          formatResponseBody({
            error: "Insufficient funds for transfer",
          })
        );
      }

      const result = await financialService.transferFunds(req.user.userId, toUserId, parsedAmount, description);

      res.status(200).json(
        formatResponseBody({
          message: "Transfer completed successfully",
          data: result,
        })
      );
    } catch (error) {
      logError("Error transferring funds:", error);
      let statusCode = 500;
      if (error.message.includes("Missing required")) statusCode = 400;
      else if (error.message.includes("must be positive")) statusCode = 400;
      else if (error.message.includes("Insufficient funds")) statusCode = 400;
      else if (error.message.includes("Cannot transfer more than")) statusCode = 400;
      else if (error.message.includes("Recipient user does not exist")) statusCode = 400;
      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get all financial accounts (admin only)
   */
  async getAllAccounts(req, res) {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json(
          formatResponseBody({
            error: "Forbidden: Admin access required",
          })
        );
      }

      const accounts = await financialService.getAllAccounts();

      res.status(200).json(
        formatResponseBody({
          data: accounts,
        })
      );
    } catch (error) {
      logError("Error getting all accounts:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Update account balance (admin only)
   */
  async updateAccountBalance(req, res) {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json(
          formatResponseBody({
            error: "Forbidden: Admin access required",
          })
        );
      }

      const { userId, amount, description } = req.body;

      if (!userId || amount === undefined || !description) {
        return res.status(400).json(
          formatResponseBody({
            error: "Missing required fields: userId, amount, description",
          })
        );
      }

      const updatedAccount = await financialService.updateAccountBalance(userId, parseFloat(amount), description);

      res.status(200).json(
        formatResponseBody({
          message: "Account balance updated successfully",
          data: updatedAccount,
        })
      );
    } catch (error) {
      logError("Error updating account balance:", error);

      let statusCode = 500;
      if (error.message.includes("Missing required")) statusCode = 400;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(req, res) {
    try {
      const { transactionId } = req.params;
      const account = await financialService.getAccount(req.user.userId);

      const transaction = account.transactions.find((t) => t.id === transactionId);

      if (!transaction) {
        return res.status(404).json(
          formatResponseBody({
            error: "Transaction not found",
          })
        );
      }

      res.status(200).json(
        formatResponseBody({
          data: transaction,
        })
      );
    } catch (error) {
      logError("Error getting transaction by ID:", error);

      res.status(500).json(
        formatResponseBody({
          error: error.message,
        })
      );
    }
  }

  /**
   * Admin: Get all financial transactions across all users
   */
  async getAllTransactionsAdmin(req, res) {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json(formatResponseBody({ error: "Forbidden: Admin access required" }));
      }
      const { type, category, startDate, endDate } = req.query;
      const options = { type, category, startDate, endDate };
      const transactions = await financialService.getAllTransactions(options);
      res.status(200).json(
        formatResponseBody({
          data: transactions,
          total: transactions.length,
        })
      );
    } catch (error) {
      logError("Error getting all financial transactions (admin):", error);
      res.status(500).json(formatResponseBody({ error: error.message }));
    }
  }
}

module.exports = new FinancialController();
