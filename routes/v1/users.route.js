const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const {
  validateIdParam,
} = require("../../middleware/id-validation.middleware");
const userController = require("../../controllers/user.controller");

const usersRoute = express.Router();

// Apply rate limiting
const apiLimiter = createRateLimiter("api");

/**
 * Get user profile
 * GET /api/users/profile
 */
usersRoute.get(
  "/users/profile",
  apiLimiter,
  authenticateUser,
  userController.getProfile.bind(userController),
);

/**
 * Update user profile
 * PUT /api/users/profile
 */
usersRoute.put(
  "/users/profile",
  apiLimiter,
  authenticateUser,
  userController.updateProfile.bind(userController),
);

/**
 * Delete user profile
 * DELETE /api/users/profile
 */
usersRoute.delete(
  "/users/profile",
  apiLimiter,
  authenticateUser,
  userController.deleteProfile.bind(userController),
);

/**
 * Update user by ID
 * PUT /api/users/:userId
 */
usersRoute.put(
  "/users/:userId",
  apiLimiter,
  authenticateUser,
  validateIdParam("userId"),
  userController.updateUserById.bind(userController),
);

/**
 * Get user statistics (display name, fields, staff, stocks)
 */
usersRoute.get(
  "/users/statistics",
  apiLimiter,
  authenticateUser,
  userController.getUserStatistics.bind(userController),
);

/**
 * Get statistics for all users (admin only)
 */
usersRoute.get(
  "/users/statistics/all",
  apiLimiter,
  authenticateUser,
  userController.getAllUsersStatistics.bind(userController),
);

module.exports = usersRoute;
