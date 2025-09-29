const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const userService = require("../services/user.service");
const { isValidId } = require("../helpers/validators");

class UserController {
  /**
   * Get user profile
   */
  async getProfile(req, res) {
    try {
      const user = await userService.getUserProfile(req.user.userId);

      res.status(200).json(
        formatResponseBody(
          {
            data: user,
          },
          false,
        ),
      );
    } catch (error) {
      logError("Error getting user profile:", error);

      let statusCode = 500;
      if (error.message.includes("not found")) statusCode = 404;
      else if (error.message.includes("deactivated")) statusCode = 401;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res) {
    try {
      const { displayedName, email, password } = req.body;
      const updateData = {};

      if (displayedName) updateData.displayedName = displayedName;
      if (email) updateData.email = email;
      if (password) updateData.password = password;

      const updatedUser = await userService.updateUserProfile(
        req.user.userId,
        updateData,
      );

      res.status(200).json(
        formatResponseBody({
          message: "Profile updated successfully",
          data: updatedUser,
        }),
      );
    } catch (error) {
      logError("Error updating user profile:", error);

      let statusCode = 500;
      if (error.message.includes("Validation failed")) statusCode = 400;
      else if (error.message.includes("not found")) statusCode = 404;
      else if (error.message.includes("deactivated")) statusCode = 401;
      else if (error.message.includes("already in use")) statusCode = 409;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Update user by ID
   */
  async updateUserById(req, res) {
    try {
      const { userId } = req.params;

      if (!isValidId(userId)) {
        return res
          .status(400)
          .json(formatResponseBody({ error: "Invalid user ID format" }));
      }

      const { displayedName, email, password } = req.body;
      const updateData = {};

      // Check if the authenticated user is trying to update their own profile
      // Convert both to strings for consistent comparison
      if (req.user.userId.toString() !== userId.toString()) {
        // For now, only allow users to update their own profile
        // You can extend this to check for admin roles later
        return res.status(403).json(
          formatResponseBody({
            error: "You can only update your own profile",
          }),
        );
      }

      if (displayedName) updateData.displayedName = displayedName;
      if (email) updateData.email = email;
      if (password) updateData.password = password;

      const updatedUser = await userService.updateUserProfile(
        userId,
        updateData,
      );

      res.status(200).json(
        formatResponseBody({
          message: "User updated successfully",
          data: updatedUser,
        }),
      );
    } catch (error) {
      logError("Error updating user by ID:", error);

      let statusCode = 500;
      if (error.message.includes("Validation failed")) statusCode = 400;
      else if (error.message.includes("not found")) statusCode = 404;
      else if (error.message.includes("deactivated")) statusCode = 401;
      else if (error.message.includes("already in use")) statusCode = 409;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Delete user profile
   */
  async deleteProfile(req, res) {
    try {
      const deletedUser = await userService.deleteUserProfile(req.user.userId);

      res.status(200).json(
        formatResponseBody({
          message: "Account deleted successfully",
          data: deletedUser,
        }),
      );
    } catch (error) {
      logError("Error deleting user profile:", error);

      let statusCode = 500;
      if (error.message.includes("not found")) statusCode = 404;
      else if (error.message.includes("deactivated")) statusCode = 401;

      res.status(statusCode).json(
        formatResponseBody({
          error: error.message,
        }),
      );
    }
  }

  /**
   * Get user statistics (display name, fields, staff, stocks)
   */
  async getUserStatistics(req, res) {
    try {
      const userId = req.user.userId;
      const user = await userService.getUserProfile(userId);
      const displayName = user.displayedName || user.userId;

      // Use proper database instances instead of direct file reads
      const dbManager = require("../data/database-manager");
      const fieldsDb = dbManager.getFieldsDatabase();
      const staffDb = dbManager.getStaffDatabase();
      const animalsDb = dbManager.getAnimalsDatabase();

      // Count fields
      const fields = await fieldsDb.getAll();
      const fieldsCount = fields.filter((f) => f.userId === userId).length;

      // Count staff
      const staff = await staffDb.getAll();
      const staffCount = staff.filter((s) => s.userId === userId).length;

      // Count animals (stocks)
      const animals = await animalsDb.getAll();
      const stocksCount = animals.filter((a) => a.userId === userId).length;

      res.status(200).json(
        require("../helpers/response-helper").formatResponseBody({
          data: {
            displayName,
            fields: fieldsCount,
            staff: staffCount,
            stocks: stocksCount,
          },
        }),
      );
    } catch (error) {
      require("../helpers/logger-api").logError(
        "Error getting user statistics:",
        error,
      );
      res.status(500).json(
        require("../helpers/response-helper").formatResponseBody({
          error: error.message || "Internal server error",
        }),
      );
    }
  }

  /**
   * Get statistics for all users (admin only)
   */
  async getAllUsersStatistics(req, res) {
    try {
      if (!req.user.isAdmin) {
        return res
          .status(403)
          .json(
            require("../helpers/response-helper").formatResponseBody({
              error: "Forbidden: Admins only",
            }),
          );
      }

      // Use proper database instances instead of direct file reads
      const dbManager = require("../data/database-manager");
      const usersDb = dbManager.getUsersDatabase();
      const fieldsDb = dbManager.getFieldsDatabase();
      const staffDb = dbManager.getStaffDatabase();
      const animalsDb = dbManager.getAnimalsDatabase();

      // Load all data using proper database instances
      const users = await usersDb.getAll();
      const fields = await fieldsDb.getAll();
      const staff = await staffDb.getAll();
      const animals = await animalsDb.getAll();

      const stats = users.map((user) => {
        const userId = user.userId;
        return {
          displayName: user.displayedName || userId,
          fields: fields.filter((f) => f.userId === userId).length,
          staff: staff.filter((s) => s.userId === userId).length,
          stocks: animals.filter((a) => a.userId === userId).length,
        };
      });

      res
        .status(200)
        .json(
          require("../helpers/response-helper").formatResponseBody({
            data: stats,
          }),
        );
    } catch (error) {
      require("../helpers/logger-api").logError(
        "Error getting all users statistics:",
        error,
      );
      res
        .status(500)
        .json(
          require("../helpers/response-helper").formatResponseBody({
            error: error.message || "Internal server error",
          }),
        );
    }
  }
}

module.exports = new UserController();
