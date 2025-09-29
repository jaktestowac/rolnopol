const UserDataSingleton = require("../data/user-data-singleton");
const { validateProfileUpdateData } = require("../helpers/validators");
const { logDebug, logError } = require("../helpers/logger-api");

class UserService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      logError("User profile retrieval failed", {
        userId,
        reason: "User not found",
      });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User profile retrieval failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    // Remove password from response
    const { password, ...userResponse } = user;

    return userResponse;
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updateData) {
    logDebug("Updating user profile", { userId, updateData });
    const { displayedName, email, password } = updateData;

    // Trim displayedName before validation
    const trimmedDisplayedName = displayedName
      ? displayedName.trim()
      : displayedName;

    // Validate input data
    const validation = validateProfileUpdateData({
      displayedName: trimmedDisplayedName,
      email,
      password,
    });
    if (!validation.isValid) {
      logError("User profile update failed", {
        userId,
        reason: "Validation failed",
        errors: validation.errors,
      });
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Check if user exists and is active
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      logError("User profile update failed", {
        userId,
        reason: "User not found",
      });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User profile update failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    const dataToUpdate = {};

    // Check if email is being changed and if it's already taken
    if (email && email !== user.email) {
      const existingUser = await this.userDataInstance.findUserByEmail(email);
      if (existingUser) {
        logError("User profile update failed", {
          userId,
          reason: "Email already in use",
        });
        throw new Error("Email already in use");
      }
      dataToUpdate.email = email;
    }

    // Update other fields - only if they are not empty after trimming
    if (trimmedDisplayedName && trimmedDisplayedName.length > 0)
      dataToUpdate.displayedName = trimmedDisplayedName;
    if (password) dataToUpdate.password = password; // Plain text password

    // Update user
    const updatedUser = await this.userDataInstance.updateUser(
      userId,
      dataToUpdate,
    );

    // Remove password from response
    const { password: _, ...userResponse } = updatedUser;

    logDebug("User profile updated successfully", { userId });

    return userResponse;
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    const users = await this.userDataInstance.getAllUsers();

    // Remove passwords from all users
    return users.map((user) => {
      const { password, ...userResponse } = user;
      return userResponse;
    });
  }

  /**
   * Get user count
   */
  async getUserCount() {
    return await this.userDataInstance.getUserCount();
  }

  /**
   * Delete user profile
   */
  async deleteUserProfile(userId) {
    // Check if user exists and is active
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      logError("User deletion failed", { userId, reason: "User not found" });
      throw new Error("User not found");
    }

    if (!user.isActive) {
      logError("User deletion failed", {
        userId,
        reason: "Account is deactivated",
      });
      throw new Error("Account is deactivated");
    }

    // Delete user
    const deletedUser = await this.userDataInstance.deleteUser(userId);

    // Remove password from response
    const { password, ...userResponse } = deletedUser;

    logDebug("User profile deleted successfully", { userId });

    return userResponse;
  }
}

module.exports = new UserService();
