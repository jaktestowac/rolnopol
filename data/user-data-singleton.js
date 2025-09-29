const UserDatabase = require("./user-database");
const { logDebug, logError } = require("../helpers/logger-api");

/**
 * Singleton class for managing user data
 * Provides a single point of access to user operations with caching
 */
class UserDataSingleton {
  constructor() {
    if (UserDataSingleton.instance) {
      return UserDataSingleton.instance;
    }

    this.userDb = new UserDatabase();
    this.cache = null;
    this.cacheExpiry = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache

    UserDataSingleton.instance = this;
  }

  /**
   * Get the singleton instance
   */
  static getInstance() {
    if (!UserDataSingleton.instance) {
      UserDataSingleton.instance = new UserDataSingleton();
    }
    return UserDataSingleton.instance;
  }

  /**
   * Check if cache is valid
   */
  isCacheValid() {
    return (
      this.cache !== null && this.cacheExpiry && Date.now() < this.cacheExpiry
    );
  }

  /**
   * Get users with caching
   */
  async getUsers() {
    try {
      if (this.isCacheValid()) {
        logDebug("Returning cached users data");
        return this.cache;
      }

      logDebug("Cache miss or expired, fetching users from database");
      const users = await this.userDb.getAllUsers();

      // Update cache
      this.cache = users;
      this.cacheExpiry = Date.now() + this.cacheTimeout;

      return users;
    } catch (error) {
      logError("Error getting users:", error);
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  async findUser(id) {
    try {
      return await this.userDb.findUserById(id);
    } catch (error) {
      logError("Error finding user:", error);
      throw error;
    }
  }

  /**
   * Find user by username
   */
  async findUserByUsername(username) {
    try {
      return await this.userDb.findUserByUsername(username);
    } catch (error) {
      logError("Error finding user by username:", error);
      throw error;
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email) {
    try {
      return await this.userDb.findUserByEmail(email);
    } catch (error) {
      logError("Error finding user by email:", error);
      throw error;
    }
  }

  /**
   * Find user by internal ID
   */
  async getUserByInternalId(internalId) {
    try {
      return await this.userDb.findUserByInternalId(internalId);
    } catch (error) {
      logError("Error finding user by internal ID:", error);
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(userData) {
    try {
      const newUser = await this.userDb.createUser(userData);
      this.invalidateCache();
      return newUser;
    } catch (error) {
      logError("Error creating user:", error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(id, updateData) {
    try {
      const updatedUser = await this.userDb.updateUser(id, updateData);
      this.invalidateCache();
      return updatedUser;
    } catch (error) {
      logError("Error updating user:", error);
      throw error;
    }
  }

  /**
   * Update user last login
   */
  async updateUserLastLogin(id) {
    try {
      await this.userDb.updateUserLastLogin(id);
      this.invalidateCache();
    } catch (error) {
      logError("Error updating user last login:", error);
      throw error;
    }
  }

  /**
   * Check if user exists by email
   */
  async userExistsByEmail(email) {
    try {
      return await this.userDb.userExistsByEmail(email);
    } catch (error) {
      logError("Error checking if user exists by email:", error);
      throw error;
    }
  }

  /**
   * Check if user exists by ID
   */
  async userExistsById(id) {
    try {
      return await this.userDb.userExistsById(id);
    } catch (error) {
      logError("Error checking if user exists by ID:", error);
      throw error;
    }
  }

  /**
   * Check if user exists by username
   */
  async userExistsByUsername(username) {
    try {
      return await this.userDb.userExistsByUsername(username);
    } catch (error) {
      logError("Error checking if user exists by username:", error);
      throw error;
    }
  }

  /**
   * Get user count
   */
  async getUserCount() {
    try {
      return await this.userDb.getUserCount();
    } catch (error) {
      logError("Error getting user count:", error);
      throw error;
    }
  }

  /**
   * Get active users
   */
  async getActiveUsers() {
    try {
      return await this.userDb.getActiveUsers();
    } catch (error) {
      logError("Error getting active users:", error);
      throw error;
    }
  }

  /**
   * Deactivate user
   */
  async deactivateUser(id) {
    try {
      await this.userDb.deactivateUser(id);
      this.invalidateCache();
    } catch (error) {
      logError("Error deactivating user:", error);
    }
  }

  /**
   * Delete user permanently
   */
  async deleteUser(id) {
    try {
      const deletedUser = await this.userDb.deleteUser(id);
      this.invalidateCache();
      return deletedUser;
    } catch (error) {
      logError("Error deleting user:", error);
      throw error;
    }
  }

  /**
   * Add a field to a user
   */
  async addField(id, fieldData) {
    const result = await this.userDb.addField(id, fieldData);
    this.invalidateCache();
    return result;
  }

  /**
   * List fields for a user
   */
  async listFields(id) {
    return await this.userDb.listFields(id);
  }

  /**
   * Delete a field from a user
   */
  async deleteField(id, fieldId) {
    const result = await this.userDb.deleteField(id, fieldId);
    this.invalidateCache();
    return result;
  }

  /**
   * Add a staff (sub-user) to a user
   */
  async addStaff(id, staffData) {
    const result = await this.userDb.addStaff(id, staffData);
    this.invalidateCache();
    return result;
  }

  /**
   * List staff for a user
   */
  async listStaff(id) {
    return await this.userDb.listStaff(id);
  }

  /**
   * Delete a staff from a user
   */
  async deleteStaff(id, staffId) {
    const result = await this.userDb.deleteStaff(id, staffId);
    this.invalidateCache();
    return result;
  }

  /**
   * Invalidate cache
   */
  invalidateCache() {
    this.cache = null;
    this.cacheExpiry = null;
    logDebug("User cache invalidated");
  }

  /**
   * Force refresh cache
   */
  async forceRefreshCache() {
    try {
      this.invalidateCache();
      await this.getUsers();
      logDebug("User cache force refreshed");
    } catch (error) {
      logError("Error force refreshing cache:", error);
      throw error;
    }
  }

  /**
   * Get cache status for debugging
   */
  getCacheStatus() {
    return {
      hasCachedData: this.cache !== null,
      cacheExpiry: this.cacheExpiry,
      isValid: this.isCacheValid(),
      cachedUserCount: this.cache ? this.cache.length : 0,
    };
  }
}

module.exports = UserDataSingleton;
