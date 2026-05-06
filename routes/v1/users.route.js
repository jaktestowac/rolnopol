const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { validateIdParam } = require("../../middleware/id-validation.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { AVATAR_MAX_SIZE_BYTES, ALLOWED_AVATAR_MIME_TYPES } = require("../../helpers/avatar-image");
const userController = require("../../controllers/user.controller");

const usersRoute = express.Router();

// Apply rate limiting
const apiLimiter = createRateLimiter("api");
const avatarUploadRawParser = (req, res, next) => {
  express.raw({ type: ALLOWED_AVATAR_MIME_TYPES, limit: AVATAR_MAX_SIZE_BYTES })(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.type === "entity.too.large") {
      return res.status(413).json(
        formatResponseBody({
          error: "Validation failed: Avatar image must be 100 KB or smaller",
        }),
      );
    }

    return res.status(400).json(
      formatResponseBody({
        error: "Validation failed: Unable to process avatar image",
      }),
    );
  });
};

/**
 * Get user profile
 * GET /api/users/profile
 */
usersRoute.get("/users/profile", apiLimiter, authenticateUser, userController.getProfile.bind(userController));

/**
 * Update user profile
 * PUT /api/users/profile
 */
usersRoute.put("/users/profile", apiLimiter, authenticateUser, userController.updateProfile.bind(userController));

/**
 * Update user avatar
 * PUT /api/users/profile/avatar
 */
usersRoute.put(
  "/users/profile/avatar",
  apiLimiter,
  authenticateUser,
  requireFeatureFlag("profileAvatarUploadEnabled", { resourceName: "Profile avatar upload" }),
  avatarUploadRawParser,
  userController.updateProfileAvatar.bind(userController),
);

/**
 * Delete user profile
 * DELETE /api/users/profile
 */
usersRoute.delete("/users/profile", apiLimiter, authenticateUser, userController.deleteProfile.bind(userController));

/**
 * Add friend by email or username
 * POST /api/users/friends
 */
usersRoute.post(
  "/users/friends",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  userController.addFriend.bind(userController),
);

/**
 * List friends
 * GET /api/users/friends
 */
usersRoute.get(
  "/users/friends",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  userController.getFriends.bind(userController),
);

/**
 * Remove friend
 * DELETE /api/users/friends/:friendUserId
 */
usersRoute.delete(
  "/users/friends/:friendUserId",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  validateIdParam("friendUserId"),
  userController.removeFriend.bind(userController),
);

/**
 * Block user by identifier or userId
 * POST /api/users/blocked
 */
usersRoute.post(
  "/users/blocked",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  userController.blockUser.bind(userController),
);

/**
 * List blocked users
 * GET /api/users/blocked
 */
usersRoute.get(
  "/users/blocked",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  userController.getBlockedUsers.bind(userController),
);

/**
 * Unblock user
 * DELETE /api/users/blocked/:blockedUserId
 */
usersRoute.delete(
  "/users/blocked/:blockedUserId",
  apiLimiter,
  requireFeatureFlag("messengerEnabled", { resourceName: "Messenger" }),
  authenticateUser,
  validateIdParam("blockedUserId"),
  userController.unblockUser.bind(userController),
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
usersRoute.get("/users/statistics", apiLimiter, authenticateUser, userController.getUserStatistics.bind(userController));

/**
 * Get statistics for all users (admin only)
 */
usersRoute.get("/users/statistics/all", apiLimiter, authenticateUser, userController.getAllUsersStatistics.bind(userController));

module.exports = usersRoute;
