const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const financialController = require("../../controllers/financial.controller");

const financialRoute = express.Router();

// Apply rate limiting
const apiLimiter = createRateLimiter("api");

/**
 * Get user's financial account
 * GET /api/financial/account
 */
financialRoute.get(
  "/financial/account",
  apiLimiter,
  authenticateUser,
  financialController.getAccount.bind(financialController),
);

/**
 * Add a new transaction
 * POST /api/financial/transactions
 */
financialRoute.post(
  "/financial/transactions",
  apiLimiter,
  authenticateUser,
  financialController.addTransaction.bind(financialController),
);

/**
 * Get transaction history
 * GET /api/financial/transactions
 */
financialRoute.get(
  "/financial/transactions",
  apiLimiter,
  authenticateUser,
  financialController.getTransactionHistory.bind(financialController),
);

/**
 * Get transaction by ID
 * GET /api/financial/transactions/:transactionId
 */
financialRoute.get(
  "/financial/transactions/:transactionId",
  apiLimiter,
  authenticateUser,
  validateIdParam("transactionId"),
  financialController.getTransactionById.bind(financialController),
);

/**
 * Get financial statistics
 * GET /api/financial/stats
 */
financialRoute.get(
  "/financial/stats",
  apiLimiter,
  authenticateUser,
  financialController.getFinancialStats.bind(financialController),
);

/**
 * Transfer funds to another user
 * POST /api/financial/transfer
 */
financialRoute.post(
  "/financial/transfer",
  apiLimiter,
  authenticateUser,
  financialController.transferFunds.bind(financialController),
);

/**
 * Get comprehensive marketplace statistics across all users
 * GET /api/financial/marketplace-stats
 */
financialRoute.get(
  "/financial/marketplace-stats",
  apiLimiter,
  authenticateUser,
  financialController.getMarketplaceStats.bind(financialController),
);

/**
 * Get all financial accounts (admin only)
 * GET /api/financial/accounts/all
 */
financialRoute.get(
  "/financial/accounts/all",
  apiLimiter,
  authenticateUser,
  financialController.getAllAccounts.bind(financialController),
);

/**
 * Update account balance (admin only)
 * PUT /api/financial/accounts/balance
 */
financialRoute.put(
  "/financial/accounts/balance",
  apiLimiter,
  authenticateUser,
  financialController.updateAccountBalance.bind(financialController),
);

module.exports = financialRoute;
