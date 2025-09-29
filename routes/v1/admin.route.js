const express = require("express");
const {
  createRateLimiter,
  adminLoginLimiter,
} = require("../../middleware/rate-limit.middleware");
const { authenticateAdmin } = require("../../middleware/auth.middleware");
const adminController = require("../../controllers/admin.controller");
const marketplaceController = require("../../controllers/marketplace.controller");
const financialController = require("../../controllers/financial.controller");

const adminRoute = express.Router();

// Apply rate limiting
const authLimiter = createRateLimiter("auth");
const adminLimiter = createRateLimiter("admin");

/**
 * Admin login endpoint
 * POST /api/v1/admin/auth/login
 */
adminRoute.post(
  "/admin/auth/login",
  authLimiter,
  adminLoginLimiter,
  adminController.login.bind(adminController),
);

/**
 * Admin logout endpoint
 * POST /api/v1/admin/auth/logout
 */
adminRoute.post(
  "/admin/auth/logout",
  authenticateAdmin,
  adminController.logout.bind(adminController),
);

/**
 * Admin token validation endpoint
 * POST /api/v1/admin/auth/validate
 */
adminRoute.post(
  "/admin/auth/validate",
  authLimiter,
  adminController.validateToken.bind(adminController),
);

/**
 * Get system statistics
 * GET /api/v1/admin/stats
 */
adminRoute.get(
  "/admin/stats",
  authenticateAdmin,
  adminLimiter,
  adminController.getStats.bind(adminController),
);

/**
 * Get lightweight overview statistics for admin dashboard
 * GET /api/v1/admin/overview-stats
 */
adminRoute.get(
  "/admin/overview-stats",
  authenticateAdmin,
  adminLimiter,
  adminController.getOverviewStats.bind(adminController),
);

/**
 * Get all users
 * GET /api/v1/admin/users
 */
adminRoute.get(
  "/admin/users",
  authenticateAdmin,
  adminLimiter,
  adminController.getAllUsers.bind(adminController),
);

/**
 * Update user status
 * PUT /api/v1/admin/users/:userId/status
 */
adminRoute.put(
  "/admin/users/:userId/status",
  authenticateAdmin,
  adminLimiter,
  adminController.updateUserStatus.bind(adminController),
);

/**
 * Delete user
 * DELETE /api/v1/admin/users/:userId
 */
adminRoute.delete(
  "/admin/users/:userId",
  authenticateAdmin,
  adminLimiter,
  adminController.deleteUser.bind(adminController),
);

/**
 * Get dashboard data
 * GET /api/v1/admin/dashboard
 */
adminRoute.get(
  "/admin/dashboard",
  authenticateAdmin,
  adminLimiter,
  adminController.getDashboard.bind(adminController),
);

/**
 * Create database backup
 * GET /api/v1/admin/database/backup
 */
adminRoute.get(
  "/admin/database/backup",
  authenticateAdmin,
  adminLimiter,
  adminController.createBackup.bind(adminController),
);

/**
 * Restore database from backup
 * POST /api/v1/admin/database/restore
 */
adminRoute.post(
  "/admin/database/restore",
  authenticateAdmin,
  adminLimiter,
  adminController.restoreBackup.bind(adminController),
);

/**
 * Reinitialize all database services from current JSON files (no auth)
 * POST /api/v1/database/reinit
 */
adminRoute.get(
  "/database/reinit",
  adminController.reinitializeDatabases.bind(adminController),
);

/**
 * Get all fields
 * GET /api/v1/admin/fields
 */
adminRoute.get(
  "/admin/fields",
  authenticateAdmin,
  adminLimiter,
  adminController.getAllFields.bind(adminController),
);

/**
 * Get all staff
 * GET /api/v1/admin/staff
 */
adminRoute.get(
  "/admin/staff",
  authenticateAdmin,
  adminLimiter,
  adminController.getAllStaff.bind(adminController),
);

/**
 * Get all animals
 * GET /api/v1/admin/animals
 */
adminRoute.get(
  "/admin/animals",
  authenticateAdmin,
  adminLimiter,
  adminController.getAllAnimals.bind(adminController),
);

/**
 * Admin: Get all marketplace offers
 * GET /api/v1/admin/marketplace/offers
 */
adminRoute.get(
  "/admin/marketplace/offers",
  authenticateAdmin,
  adminLimiter,
  marketplaceController.getAllOffersAdmin.bind(marketplaceController),
);

/**
 * Admin: Get all marketplace transactions
 * GET /api/v1/admin/marketplace/transactions
 */
adminRoute.get(
  "/admin/marketplace/transactions",
  authenticateAdmin,
  adminLimiter,
  marketplaceController.getAllTransactionsAdmin.bind(marketplaceController),
);

/**
 * Admin: Get all financial transactions
 * GET /api/v1/admin/financial/transactions
 */
adminRoute.get(
  "/admin/financial/transactions",
  authenticateAdmin,
  adminLimiter,
  financialController.getAllTransactionsAdmin.bind(financialController),
);

module.exports = adminRoute;
