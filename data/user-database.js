const dbManager = require("./database-manager");
const { logDebug, logError } = require("../helpers/logger-api");
const {
  createEntity,
  updateEntityTimestamp,
} = require("../helpers/entity.helpers");
const ResourceService = require("../services/resource.service");

/**
 * User database operations
 */
class UserDatabase {
  constructor() {
    this.db = dbManager.getUsersDatabase();
  }

  /**
   * Get all users
   */
  async getAllUsers() {
    try {
      return await this.db.getAll();
    } catch (error) {
      logError("Error getting all users:", error);
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  async findUserById(id) {
    try {
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid user ID format");
      }
      return await this.db.findOne((user) => user.id === numericId);
    } catch (error) {
      logError("Error finding user by ID:", error);
      throw error;
    }
  }

  /**
   * Find user by username (legacy)
   */
  async findUserByUsername(username) {
    try {
      return await this.db.findOne((user) => user.username === username);
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
      return await this.db.findOne((user) => user.email === email);
    } catch (error) {
      logError("Error finding user by email:", error);
      throw error;
    }
  }

  /**
   * Find user by internal ID
   */
  async findUserByInternalId(internalId) {
    try {
      return await this.db.findOne((user) => user.internalId === internalId);
    } catch (error) {
      logError("Error finding user by internal ID:", error);
      throw error;
    }
  }

  /**
   * Create a new user (email-based auth)
   */
  async createUser(userData) {
    try {
      const newUser = {
        // username omitted in new accounts; keep if provided for backward compatibility
        ...(userData.username ? { username: userData.username } : {}),
        displayedName: userData.displayedName,
        email: userData.email,
        password: userData.password, // Should be hashed before calling this method
        isActive: true,
        lastLogin: null,
        ...userData.additionalData,
      };

      // The add() method now returns the created user directly
      const createdUser = await this.db.add(newUser);

      // Initialize financial account for the user (this might write to financial.json)
      try {
        const financialService = require("../services/financial.service");
        await financialService.initializeAccount(createdUser.id);
      } catch (financialError) {
        logError("Error initializing financial account:", financialError);
        // Don't fail user creation if financial account fails
      }

      logDebug("User created successfully", {
        id: createdUser.id,
        email: createdUser.email,
      });
      return createdUser;
    } catch (error) {
      logError("Error creating user:", error);
      throw error;
    }
  }

  /**
   * Update user by ID
   */
  async updateUser(id, updateData) {
    try {
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid user ID format");
      }

      const updatedData = updateEntityTimestamp(updateData);

      await this.db.updateRecords(
        (user) => user.id === numericId,
        (user) => ({ ...user, ...updatedData }),
      );

      logDebug("User updated successfully", { id: numericId });
      return await this.findUserById(id);
    } catch (error) {
      logError("Error updating user:", error);
      throw error;
    }
  }

  /**
   * Update user last login timestamp
   */
  async updateUserLastLogin(id) {
    try {
      await this.updateUser(id, { lastLogin: new Date().toISOString() });
      logDebug("User last login updated", { id });
    } catch (error) {
      logError("Error updating user last login:", error);
      throw error;
    }
  }

  /**
   * Deactivate user (soft delete)
   */
  async deactivateUser(id) {
    try {
      await this.updateUser(id, { isActive: false });
      logDebug("User deactivated", { id });
    } catch (error) {
      logError("Error deactivating user:", error);
      throw error;
    }
  }

  /**
   * Delete user permanently
   */
  async deleteUser(id) {
    try {
      const numericId = Number(id);
      if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid user ID format");
      }

      // Get the user data before deleting
      const userToDelete = await this.findUserById(id);
      if (!userToDelete) {
        throw new Error("User not found");
      }

      await this.db.remove((user) => user.id === numericId);
      logDebug("User deleted permanently", { id: numericId });

      // Cascade delete related resources
      await ResourceService.cascadeDelete({ type: "user", userId: numericId });
      return userToDelete;
    } catch (error) {
      logError("Error deleting user:", error);
      throw error;
    }
  }

  /**
   * Check if user exists by email
   */
  async userExistsByEmail(email) {
    try {
      const user = await this.findUserByEmail(email);
      return !!user;
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
      const user = await this.findUserById(id);
      return !!user;
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
      const user = await this.findUserByUsername(username);
      return !!user;
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
      const users = await this.getAllUsers();
      return users.length;
    } catch (error) {
      logError("Error getting user count:", error);
      throw error;
    }
  }

  /**
   * Get active users only
   */
  async getActiveUsers() {
    try {
      return await this.db.find((user) => user.isActive === true);
    } catch (error) {
      logError("Error getting active users:", error);
      throw error;
    }
  }

  /**
   * Generate auto-incremented ID for fields
   */
  _generateFieldId(fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return 1;
    }
    const maxId = Math.max(...fields.map((field) => field.id || 0));
    return maxId + 1;
  }

  /**
   * Add a field to a user
   */
  async addField(id, fieldData) {
    const user = await this.findUserById(id);
    if (!user) throw new Error("User not found");
    const fields = Array.isArray(user.fields) ? user.fields : [];
    const fieldId = this._generateFieldId(fields);
    const newField = { id: fieldId, ...fieldData };
    fields.push(newField);
    await this.updateUser(id, { fields });
    return newField;
  }

  /**
   * List fields for a user
   */
  async listFields(id) {
    const user = await this.findUserById(id);
    return Array.isArray(user?.fields) ? user.fields : [];
  }

  /**
   * Delete a field from a user
   */
  async deleteField(id, fieldId) {
    const user = await this.findUserById(id);
    if (!user) throw new Error("User not found");
    const fields = (user.fields || []).filter((f) => f.id !== fieldId);
    await this.updateUser(id, { fields });
    return true;
  }

  /**
   * Generate auto-incremented ID for staff
   */
  _generateStaffId(staff) {
    if (!Array.isArray(staff) || staff.length === 0) {
      return 1;
    }
    const maxId = Math.max(...staff.map((s) => s.id || 0));
    return maxId + 1;
  }

  /**
   * Add a staff (sub-user) to a user
   */
  async addStaff(id, staffData) {
    const user = await this.findUserById(id);
    if (!user) throw new Error("User not found");
    const staff = Array.isArray(user.staff) ? user.staff : [];
    const staffId = this._generateStaffId(staff);
    const newStaff = { id: staffId, ...staffData };
    staff.push(newStaff);
    await this.updateUser(id, { staff });
    return newStaff;
  }
  /**
   * List staff for a user
   */
  async listStaff(id) {
    const user = await this.findUserById(id);
    return Array.isArray(user?.staff) ? user.staff : [];
  }
  /**
   * Delete a staff from a user
   */
  async deleteStaff(id, staffId) {
    const user = await this.findUserById(id);
    if (!user) throw new Error("User not found");
    const staff = (user.staff || []).filter((s) => s.id !== staffId);
    await this.updateUser(id, { staff });
    return true;
  }
}

module.exports = UserDatabase;
