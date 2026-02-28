const UserDataSingleton = require("../data/user-data-singleton");
const {
  generateAdminToken,
  revokeAdminToken,
  getTokenStats,
  cleanupExpiredTokens,
  isTokenInStorage,
  isAdminToken,
} = require("../helpers/token.helpers");
const { ADMIN_USERNAME, ADMIN_PASSWORD, loginExpirationAdmin } = require("../data/settings");
const { logDebug, logError } = require("../helpers/logger-api");
const { getLogList, clearLogList } = require("../helpers/logger-api");
const featureFlagsService = require("./feature-flags.service");
const dbManager = require("../data/database-manager");
const pricingService = require("./commodities-pricing.service");
const commoditiesAdminControlsService = require("./commodities-admin-controls.service");
const packageJson = require("../package.json");

class AdminService {
  constructor() {
    this.userDataInstance = UserDataSingleton.getInstance();
  }

  _normalizePagination(rawQuery = {}, { defaultPageSize = 25, maxPageSize = 200 } = {}) {
    const page = Number(rawQuery.page || 1);
    const pageSize = Number(rawQuery.pageSize || defaultPageSize);

    if (!Number.isInteger(page) || page <= 0) {
      throw new Error("Validation failed: page must be a positive integer");
    }

    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new Error("Validation failed: pageSize must be a positive integer");
    }

    const normalizedPageSize = Math.min(pageSize, maxPageSize);
    const offset = (page - 1) * normalizedPageSize;

    return {
      page,
      pageSize: normalizedPageSize,
      offset,
    };
  }

  _safeDate(rawValue) {
    if (!rawValue) return null;
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Validation failed: date filter is invalid");
    }
    return parsed;
  }

  _parseBooleanQuery(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(text)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(text)) {
      return false;
    }

    throw new Error("Validation failed: boolean filter is invalid");
  }

  _toPublicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      displayedName: user.displayedName || user.username || null,
      email: user.email || null,
      isActive: user.isActive === true,
      messengerMutedUntil: user.messengerMutedUntil || null,
      messengerMuteReason: user.messengerMuteReason || null,
    };
  }

  async _getMessagesStore() {
    const messagesDb = dbManager.getMessagesDatabase();
    const raw = await messagesDb.getAll();
    if (!raw || typeof raw !== "object") {
      return { messages: [] };
    }
    return {
      ...raw,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
    };
  }

  /**
   * Admin login
   */
  async loginAdmin(credentials, clientId) {
    const { username, password } = credentials;

    // Check against hardcoded admin credentials
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      logError("Invalid admin credentials", { username, password });
      throw new Error("Invalid admin credentials");
    }

    // Generate a token valid for 1 hour
    const token = generateAdminToken();

    logDebug("Admin login successful", { username: ADMIN_USERNAME, clientId });

    return {
      token,
      username: ADMIN_USERNAME,
      expiresIn: "1 hour",
      permissions: ["read", "write", "delete", "backup", "restore"],
    };
  }

  /**
   * Admin logout
   */
  async logoutAdmin(token) {
    // Revoke admin token from storage
    if (token) {
      const revoked = revokeAdminToken(token);
      if (revoked) {
        logDebug("Admin token revoked from storage during logout", { token });
      }
    }
  }

  /**
   * Get system statistics
   */
  async getSystemStats() {
    const userCount = await this.userDataInstance.getUserCount();
    const users = await this.userDataInstance.getUsers();

    // Calculate statistics
    const activeUsers = users.filter((user) => user.isActive).length;
    const inactiveUsers = users.filter((user) => !user.isActive).length;

    // Calculate profile completeness
    const profileCompleteness = users.map((user) => this.calculateProfileCompleteness(user));
    const avgProfileCompleteness =
      profileCompleteness.length > 0
        ? profileCompleteness.reduce((sum, completeness) => sum + completeness, 0) / profileCompleteness.length
        : 0;

    // Get token statistics
    const tokenStats = getTokenStats();

    return {
      users: {
        total: userCount,
        active: activeUsers,
        inactive: inactiveUsers,
        avgProfileCompleteness: Math.round(avgProfileCompleteness * 100) / 100,
      },
      tokens: tokenStats,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: packageJson.version,
      },
    };
  }

  /**
   * Get all users with detailed information
   */
  async getAllUsersDetailed() {
    const users = await this.userDataInstance.getUsers();

    return users.map((user) => {
      const { password, ...userResponse } = user;
      return {
        ...userResponse,
        profileCompleteness: this.calculateProfileCompleteness(user),
      };
    });
  }

  /**
   * Update user status
   */
  async updateUserStatus(userId, isActive) {
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updatedUser = await this.userDataInstance.updateUser(userId, {
      isActive,
    });
    const { password, ...userResponse } = updatedUser;

    return userResponse;
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    const user = await this.userDataInstance.findUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    await this.userDataInstance.deleteUser(userId);
    return { message: "User deleted successfully" };
  }

  /**
   * Calculate profile completeness percentage
   */
  calculateProfileCompleteness(user) {
    const fields = ["displayedName", "email", "firstName", "lastName", "phone"];
    const filledFields = fields.filter((field) => user[field] && user[field].trim() !== "");
    return filledFields.length / fields.length;
  }

  /**
   * Cleanup expired tokens
   */
  cleanupExpiredTokens() {
    return cleanupExpiredTokens();
  }

  /**
   * Validate admin token
   */
  async validateToken(token) {
    if (!token) {
      return false;
    }

    // Check if token exists and is valid using the token storage

    // First check if token is in storage
    const tokenExists = isTokenInStorage(token);
    if (!tokenExists) {
      return false;
    }

    // Then check if it's a valid admin token
    const isValidAdmin = isAdminToken(token);

    return isValidAdmin;
  }

  getCpuUsage() {
    const ncpu = require("os").cpus().length;
    let previousTime = new Date().getTime();
    let previousUsage = process.cpuUsage();
    let lastUsage;

    const currentUsage = process.cpuUsage(previousUsage);

    previousUsage = process.cpuUsage();

    // we can't do simply times / 10000 / ncpu because we can't trust
    // setInterval is executed exactly every 1.000.000 microseconds
    const currentTime = new Date().getTime();
    // times from process.cpuUsage are in microseconds while delta time in milliseconds
    // * 10 to have the value in percentage for only one cpu
    // * ncpu to have the percentage for all cpus af the host

    // this should match top's %CPU
    const timeDelta = (currentTime - previousTime) * 10;
    // this would take care of CPUs number of the host
    // const timeDelta = (currentTime - previousTime) * 10 * ncpu;
    const { user, system } = currentUsage;

    lastUsage = { system: system / timeDelta, total: (system + user) / timeDelta, user: user / timeDelta };
    previousTime = currentTime;

    return lastUsage;
  }

  /**
   * Get dashboard data
   */
  async getDashboardData() {
    // CPU usage is complex to calculate accurately in Node.js without native addons, but we can provide a basic estimate
    const users = await this.userDataInstance.getUsers();
    const systemStats = await this.getSystemStats();
    const databaseInfo = await this.getDatabaseInfo();

    // Calculate system health metrics
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    const cpuUsage = this.getCpuUsage();
    const cpuUsageFormatted = cpuUsage.total ?? 0 + " %";

    // Response times can be tracked via middleware in a real app; here we provide a placeholder
    const responseTimes = {
      average: 200,
      max: 500,
      min: 100,
    };

    const systemHealth = {
      uptime: uptime,
      uptimeFormatted: this.formatUptime(uptime),
      memoryUsage: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
        formatted: {
          heapUsed: this.formatBytes(memoryUsage.heapUsed),
          heapTotal: this.formatBytes(memoryUsage.heapTotal),
          external: this.formatBytes(memoryUsage.external),
          rss: this.formatBytes(memoryUsage.rss),
        },
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        formatted: cpuUsageFormatted,
      },
      responseTimes,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || "development",
      platform: process.platform,
      arch: process.arch,
    };

    return {
      users: {
        total: users.length,
        active: users.filter((user) => user.isActive).length,
        inactive: users.filter((user) => !user.isActive).length,
        recent: users.slice(-5), // Last 5 users
      },
      systemHealth,
      database: databaseInfo,
      stats: systemStats,
    };
  }

  /**
   * Create database backup
   */
  async createDatabaseBackup() {
    const users = await this.userDataInstance.getUsers();

    // Create backup data structure
    const backupData = {
      version: packageJson.version,
      timestamp: new Date().toISOString(),
      users: users.map((user) => {
        const { password, ...userData } = user;
        return userData;
      }),
      metadata: {
        totalUsers: users.length,
        backupType: "full",
        createdBy: "admin",
      },
    };

    return backupData;
  }

  /**
   * Restore database from backup
   */
  async restoreDatabase(backupData) {
    if (!backupData.users || !Array.isArray(backupData.users)) {
      throw new Error("Invalid backup data format");
    }

    // Clear existing users
    const existingUsers = await this.userDataInstance.getUsers();
    for (const user of existingUsers) {
      const existingUserId = user?.userId ?? user?.id;
      if (existingUserId !== undefined && existingUserId !== null) {
        await this.userDataInstance.deleteUser(existingUserId);
      }
    }

    // Restore users from backup
    let restoredCount = 0;
    for (const userData of backupData.users) {
      try {
        // Create user with backup data (without password for security)
        const newUser = {
          ...userData,
          password: "restored_user_password_reset_required", // Force password reset
          createdAt: userData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.userDataInstance.createUser(newUser);
        restoredCount++;
      } catch (error) {
        logDebug("Failed to restore user", {
          userId: userData.userId,
          error: error.message,
        });
      }
    }

    return {
      message: `Database restored successfully. ${restoredCount} users restored.`,
      restoredCount,
      totalInBackup: backupData.users.length,
    };
  }

  /**
   * Format uptime in human readable format
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) {
      return `${days} day${days > 1 ? "s" : ""}, ${hours} hour${hours > 1 ? "s" : ""}, ${minutes} minute${
        minutes > 1 ? "s" : ""
      }, ${secs} second${secs > 1 ? "s" : ""}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""}, ${minutes} minute${minutes > 1 ? "s" : ""}, ${secs} second${secs > 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? "s" : ""}, ${secs} second${secs > 1 ? "s" : ""}`;
    } else {
      return `${secs} second${secs > 1 ? "s" : ""}`;
    }
  }

  /**
   * Format bytes in human readable format with Polish locale
   */
  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const value = bytes / Math.pow(k, i);
    const formattedValue = value.toLocaleString("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formattedValue + " " + sizes[i];
  }

  /**
   * Get comprehensive database information based on singletons
   */
  async getDatabaseInfo() {
    try {
      const databaseInfo = {
        totalFiles: 0,
        totalRecords: 0,
        totalSize: 0,
        databases: [],
      };

      // Database manager for all DBs
      const dbManager = require("../data/database-manager");
      const users = await this.userDataInstance.getUsers();
      const fieldsDb = dbManager.getFieldsDatabase();
      const staffDb = dbManager.getStaffDatabase();
      const animalsDb = dbManager.getAnimalsDatabase();
      const marketplaceDb = dbManager.getMarketplaceDatabase();
      const financialDb = dbManager.getFinancialDatabase();
      const featureFlagsDb = dbManager.getFeatureFlagsDatabase ? dbManager.getFeatureFlagsDatabase() : null;
      const messagesDb = dbManager.getMessagesDatabase ? dbManager.getMessagesDatabase() : null;
      const commoditiesDb = dbManager.getCommoditiesDatabase ? dbManager.getCommoditiesDatabase() : null;
      const assignmentsDb = dbManager.getAssignmentsDatabase ? dbManager.getAssignmentsDatabase() : null;
      const docsDb = dbManager.getDocsDatabase ? dbManager.getDocsDatabase() : null;
      const testDb = dbManager.getTestDatabase ? dbManager.getTestDatabase() : null;

      // Users
      const userCount = users.length;
      const userDataSize = this.calculateObjectSize(users);
      const userFormattedSize = this.formatBytes(userDataSize);
      const activeUsers = users.filter((user) => user.isActive).length;
      const inactiveUsers = users.filter((user) => !user.isActive).length;
      const usersWithProfile = users.filter((user) => user.firstName || user.lastName || user.phone).length;
      databaseInfo.databases.push({
        name: "users.json",
        displayName: "Users Database",
        recordCount: userCount,
        fileSize: userDataSize,
        formattedSize: userFormattedSize,
        lastModified: new Date(),
        additionalStats: {
          activeUsers,
          inactiveUsers,
          usersWithProfile,
          profileCompletionRate: userCount > 0 ? Math.round((usersWithProfile / userCount) * 100) : 0,
        },
      });

      // Tokens
      const tokenStats = getTokenStats();
      const tokenStorageSize = this.calculateObjectSize(tokenStats);
      const tokenFormattedSize = this.formatBytes(tokenStorageSize);
      databaseInfo.databases.push({
        name: "tokens.json",
        displayName: "Tokens Database",
        recordCount: tokenStats.totalTokens,
        fileSize: tokenStorageSize,
        formattedSize: tokenFormattedSize,
        lastModified: new Date(),
        additionalStats: {
          totalTokens: tokenStats.totalTokens,
          activeUserTokens: tokenStats.activeUserTokens,
          activeAdminTokens: tokenStats.activeAdminTokens,
        },
      });

      // Fields
      if (fieldsDb) {
        const fields = await fieldsDb.getAll();
        const fieldsSize = this.calculateObjectSize(fields);
        databaseInfo.databases.push({
          name: "fields.json",
          displayName: "Fields Database",
          recordCount: fields.length,
          fileSize: fieldsSize,
          formattedSize: this.formatBytes(fieldsSize),
          lastModified: new Date(),
          additionalStats: {
            totalArea: fields.reduce((sum, f) => sum + (f.area || 0), 0),
            usersWithFields: new Set(fields.map((f) => f.userId)).size,
          },
        });
      }

      // Staff
      if (staffDb) {
        const staff = await staffDb.getAll();
        const staffSize = this.calculateObjectSize(staff);
        databaseInfo.databases.push({
          name: "staff.json",
          displayName: "Staff Database",
          recordCount: staff.length,
          fileSize: staffSize,
          formattedSize: this.formatBytes(staffSize),
          lastModified: new Date(),
          additionalStats: {
            avgAge: staff.length > 0 ? Math.round(staff.reduce((sum, s) => sum + (s.age || 0), 0) / staff.length) : 0,
            usersWithStaff: new Set(staff.map((s) => s.userId)).size,
          },
        });
      }

      // Animals
      if (animalsDb) {
        const animals = await animalsDb.getAll();
        const animalsSize = this.calculateObjectSize(animals);
        databaseInfo.databases.push({
          name: "animals.json",
          displayName: "Animals Database",
          recordCount: animals.length,
          fileSize: animalsSize,
          formattedSize: this.formatBytes(animalsSize),
          lastModified: new Date(),
          additionalStats: {
            totalAnimals: animals.reduce((sum, a) => sum + (a.amount || 0), 0),
            types: new Set(animals.map((a) => a.type)).size,
            usersWithAnimals: new Set(animals.map((a) => a.userId)).size,
          },
        });
      }

      // Marketplace
      if (marketplaceDb) {
        const marketplace = await marketplaceDb.read();
        const offers = Array.isArray(marketplace.offers) ? marketplace.offers : [];
        const transactions = Array.isArray(marketplace.transactions) ? marketplace.transactions : [];
        const marketplaceSize = this.calculateObjectSize(marketplace);
        databaseInfo.databases.push({
          name: "marketplace.json",
          displayName: "Marketplace Database",
          recordCount: offers.length + transactions.length,
          fileSize: marketplaceSize,
          formattedSize: this.formatBytes(marketplaceSize),
          lastModified: new Date(),
          additionalStats: {
            totalOffers: offers.length,
            totalTransactions: transactions.length,
            totalVolume: transactions.reduce((sum, t) => sum + (t.price || 0), 0),
          },
        });
      }

      // Financial
      if (financialDb) {
        const financial = await financialDb.read();
        const accounts = Array.isArray(financial.accounts) ? financial.accounts : [];
        let totalFinancialTransactions = 0;
        let totalFinancialVolume = 0;
        accounts.forEach((acc) => {
          if (Array.isArray(acc.transactions)) {
            totalFinancialTransactions += acc.transactions.length;
            totalFinancialVolume += acc.transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
          }
        });
        const financialSize = this.calculateObjectSize(financial);
        databaseInfo.databases.push({
          name: "financial.json",
          displayName: "Financial Database",
          recordCount: accounts.length,
          fileSize: financialSize,
          formattedSize: this.formatBytes(financialSize),
          lastModified: new Date(),
          additionalStats: {
            totalTransactions: totalFinancialTransactions,
            totalVolume: totalFinancialVolume,
          },
        });
      }

      // Feature Flags
      if (featureFlagsDb) {
        const featureFlagsData = await featureFlagsDb.getAll();
        const flags = featureFlagsData && typeof featureFlagsData === "object" ? featureFlagsData.flags || {} : {};
        const entries = Object.entries(flags);
        const enabledFlags = entries.filter(([, value]) => value === true).length;
        const featureFlagsSize = this.calculateObjectSize(featureFlagsData);

        databaseInfo.databases.push({
          name: "feature-flags.json",
          displayName: "Feature Flags Database",
          recordCount: entries.length,
          fileSize: featureFlagsSize,
          formattedSize: this.formatBytes(featureFlagsSize),
          lastModified: new Date(),
          additionalStats: {
            enabledFlags,
            disabledFlags: entries.length - enabledFlags,
          },
        });
      }

      // Messages
      if (messagesDb) {
        const messagesStore = await messagesDb.getAll();
        const messages = Array.isArray(messagesStore?.messages) ? messagesStore.messages : [];
        const conversationPairs = new Set(
          messages.map((message) => [Number(message?.fromUserId || 0), Number(message?.toUserId || 0)].sort((a, b) => a - b).join(":")),
        );
        const unreadMessages = messages.filter((message) => !message?.readAt).length;
        const messagesSize = this.calculateObjectSize(messagesStore);

        databaseInfo.databases.push({
          name: "messages.json",
          displayName: "Messages Database",
          recordCount: messages.length,
          fileSize: messagesSize,
          formattedSize: this.formatBytes(messagesSize),
          lastModified: new Date(),
          additionalStats: {
            conversations: conversationPairs.size,
            unreadMessages,
          },
        });
      }

      // Commodities
      if (commoditiesDb) {
        const commoditiesStore = await commoditiesDb.getAll();
        const holdings = Array.isArray(commoditiesStore?.holdings) ? commoditiesStore.holdings : [];
        const uniqueSymbols = new Set(holdings.map((entry) => String(entry?.symbol || "").toUpperCase()).filter(Boolean));
        const usersWithHoldings = new Set(
          holdings.map((entry) => Number(entry?.userId || 0)).filter((id) => Number.isInteger(id) && id > 0),
        );
        const totalQuantity = holdings.reduce((sum, entry) => sum + Number(entry?.quantity || 0), 0);
        const totalInvested = holdings.reduce((sum, entry) => sum + Number(entry?.totalInvested || 0), 0);
        const commoditiesSize = this.calculateObjectSize(commoditiesStore);

        databaseInfo.databases.push({
          name: "commodities.json",
          displayName: "Commodities Database",
          recordCount: holdings.length,
          fileSize: commoditiesSize,
          formattedSize: this.formatBytes(commoditiesSize),
          lastModified: new Date(),
          additionalStats: {
            symbols: uniqueSymbols.size,
            usersWithHoldings: usersWithHoldings.size,
            totalQuantity,
            totalInvested,
          },
        });
      }

      // Assignments
      if (assignmentsDb) {
        const assignments = await assignmentsDb.getAll();
        const assignmentsSize = this.calculateObjectSize(assignments);
        databaseInfo.databases.push({
          name: "assignments.json",
          displayName: "Assignments Database",
          recordCount: assignments.length,
          fileSize: assignmentsSize,
          formattedSize: this.formatBytes(assignmentsSize),
          lastModified: new Date(),
          additionalStats: {},
        });
      }

      // Docs
      if (docsDb) {
        const docs = await docsDb.getAll();
        const docsSize = this.calculateObjectSize(docs);
        databaseInfo.databases.push({
          name: "docs.json",
          displayName: "Docs Database",
          recordCount: docs.length,
          fileSize: docsSize,
          formattedSize: this.formatBytes(docsSize),
          lastModified: new Date(),
          additionalStats: {},
        });
      }

      // Test
      if (testDb) {
        const test = await testDb.getAll();
        const testSize = this.calculateObjectSize(test);
        databaseInfo.databases.push({
          name: "test.json",
          displayName: "Test Database",
          recordCount: test.length,
          fileSize: testSize,
          formattedSize: this.formatBytes(testSize),
          lastModified: new Date(),
          additionalStats: {},
        });
      }

      // Calculate totals
      databaseInfo.totalFiles = databaseInfo.databases.length;
      databaseInfo.totalRecords = databaseInfo.databases.reduce((sum, db) => sum + db.recordCount, 0);
      databaseInfo.totalSize = databaseInfo.databases.reduce((sum, db) => sum + db.fileSize, 0);
      databaseInfo.formattedTotalSize = this.formatBytes(databaseInfo.totalSize);

      return databaseInfo;
    } catch (error) {
      logError("Error getting database info:", error);
      throw error;
    }
  }

  /**
   * Calculate approximate size of an object in bytes
   */
  calculateObjectSize(obj) {
    try {
      const jsonString = JSON.stringify(obj);
      return Buffer.byteLength(jsonString, "utf8");
    } catch (error) {
      logError("Error calculating object size:", error);
      return 0;
    }
  }

  /**
   * Get all fields across all users
   */
  async getAllFields() {
    const dbManager = require("../data/database-manager");
    const fieldsDb = dbManager.getFieldsDatabase();
    const fields = await fieldsDb.getAll();
    const users = await this.userDataInstance.getUsers();

    // Create a map of userId to user info
    const userMap = {};
    users.forEach((user) => {
      userMap[user.id] = {
        id: user.id,
        displayedName: user.displayedName || user.username,
        email: user.email,
      };
    });

    // Add user info to each field
    return fields.map((field) => ({
      ...field,
      user: userMap[field.userId] || {
        id: field.userId,
        displayedName: "Unknown User",
        email: "N/A",
      },
    }));
  }

  /**
   * Get all staff across all users
   */
  async getAllStaff() {
    const dbManager = require("../data/database-manager");
    const staffDb = dbManager.getStaffDatabase();
    const staff = await staffDb.getAll();
    const users = await this.userDataInstance.getUsers();

    // Create a map of userId to user info
    const userMap = {};
    users.forEach((user) => {
      userMap[user.id] = {
        id: user.id,
        displayedName: user.displayedName || user.username,
        email: user.email,
      };
    });

    // Add user info to each staff member
    return staff.map((staffMember) => ({
      ...staffMember,
      user: userMap[staffMember.userId] || {
        id: staffMember.userId,
        displayedName: "Unknown User",
        email: "N/A",
      },
    }));
  }

  /**
   * Get all animals across all users
   */
  async getAllAnimals() {
    const dbManager = require("../data/database-manager");
    const animalsDb = dbManager.getAnimalsDatabase();
    const fieldsDb = dbManager.getFieldsDatabase();

    const animals = await animalsDb.getAll();
    const users = await this.userDataInstance.getUsers();
    const fields = await fieldsDb.getAll();

    // Create maps for quick lookup
    const userMap = {};
    users.forEach((user) => {
      userMap[user.id] = {
        id: user.id,
        displayedName: user.displayedName || user.username,
        email: user.email,
      };
    });

    const fieldMap = {};
    fields.forEach((field) => {
      fieldMap[field.id] = field;
    });

    // Add user and field info to each animal
    return animals.map((animal) => ({
      ...animal,
      user: userMap[animal.userId] || {
        id: animal.userId,
        displayedName: "Unknown User",
        email: "N/A",
      },
      field: animal.fieldId
        ? fieldMap[animal.fieldId] || {
            id: animal.fieldId,
            name: "Unknown Field",
          }
        : null,
    }));
  }

  /**
   * Get lightweight overview statistics for the admin dashboard
   */
  async getOverviewStats() {
    const dbManager = require("../data/database-manager");
    const userData = this.userDataInstance;
    const fieldsDb = dbManager.getFieldsDatabase();
    const staffDb = dbManager.getStaffDatabase();
    const animalsDb = dbManager.getAnimalsDatabase();
    const marketplaceDb = dbManager.getMarketplaceDatabase();
    const financialDb = dbManager.getFinancialDatabase();
    const assignmentsDb = dbManager.getAssignmentsDatabase ? dbManager.getAssignmentsDatabase() : null;
    const docsDb = dbManager.getDocsDatabase ? dbManager.getDocsDatabase() : null;
    const commoditiesDb = dbManager.getCommoditiesDatabase ? dbManager.getCommoditiesDatabase() : null;
    const messagesDb = dbManager.getMessagesDatabase ? dbManager.getMessagesDatabase() : null;
    const featureFlagsDb = dbManager.getFeatureFlagsDatabase ? dbManager.getFeatureFlagsDatabase() : null;

    // Fetch all data in parallel
    const [users, fields, staff, animals, marketplace, financial, assignments, docs, commodities, messagesStore, featureFlagsData] =
      await Promise.all([
        userData.getUsers(),
        fieldsDb.getAll(),
        staffDb.getAll(),
        animalsDb.getAll(),
        marketplaceDb.read(),
        financialDb.read(),
        assignmentsDb ? assignmentsDb.getAll() : Promise.resolve([]),
        docsDb ? docsDb.getAll() : Promise.resolve([]),
        commoditiesDb ? commoditiesDb.getAll() : Promise.resolve({ holdings: [] }),
        messagesDb ? messagesDb.getAll() : Promise.resolve({ messages: [] }),
        featureFlagsDb ? featureFlagsDb.getAll() : Promise.resolve({ flags: {} }),
      ]);

    // Users
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.isActive).length;
    const inactiveUsers = users.filter((u) => !u.isActive).length;

    // Fields
    const totalFields = fields.length;
    const totalArea = fields.reduce((sum, f) => sum + (f.area || 0), 0);
    const avgAreaPerField = totalFields > 0 ? Math.round(totalArea / totalFields) : 0;
    const usersWithFields = new Set(fields.map((f) => f.userId)).size;
    const avgAreaPerUser = totalUsers > 0 ? Math.round(totalArea / totalUsers) : 0;

    // Staff
    const totalStaff = staff.length;
    const totalAge = staff.reduce((sum, s) => sum + (s.age || 0), 0);
    const avgStaffAge = totalStaff > 0 ? Math.round(totalAge / totalStaff) : 0;
    const usersWithStaff = new Set(staff.map((s) => s.userId)).size;

    // Animals
    const totalAnimals = animals.reduce((sum, a) => sum + (a.amount || 0), 0);
    const animalTypes = new Set(animals.map((a) => a.type)).size;
    const usersWithAnimals = new Set(animals.map((a) => a.userId)).size;

    // Marketplace offers
    const offers = Array.isArray(marketplace.offers) ? marketplace.offers : [];
    const totalOffers = offers.length;
    const activeOffers = offers.filter((o) => o.status === "active").length;
    const soldOffers = offers.filter((o) => o.status === "sold").length;
    const cancelledOffers = offers.filter((o) => o.status === "cancelled").length;
    const unavailableOffers = offers.filter((o) => o.status === "unavailable").length;

    // Marketplace transactions
    const transactions = Array.isArray(marketplace.transactions) ? marketplace.transactions : [];
    const totalTransactions = transactions.length;
    const totalTransactionVolume = transactions.reduce((sum, t) => sum + (t.price || 0), 0);

    // Financial transactions
    const accounts = Array.isArray(financial.accounts) ? financial.accounts : [];
    let totalFinancialTransactions = 0;
    let totalFinancialVolume = 0;
    accounts.forEach((acc) => {
      if (Array.isArray(acc.transactions)) {
        totalFinancialTransactions += acc.transactions.length;
        totalFinancialVolume += acc.transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      }
    });

    // Additional resources
    const assignmentsList = Array.isArray(assignments) ? assignments : [];
    const docsList = Array.isArray(docs) ? docs : [];
    const holdings = Array.isArray(commodities?.holdings) ? commodities.holdings : [];
    const messages = Array.isArray(messagesStore?.messages) ? messagesStore.messages : [];
    const featureFlags = featureFlagsData && typeof featureFlagsData === "object" ? featureFlagsData.flags || {} : {};

    const commoditiesSymbols = new Set(holdings.map((entry) => String(entry?.symbol || "").toUpperCase()).filter(Boolean));
    const commoditiesUsers = new Set(holdings.map((entry) => Number(entry?.userId || 0)).filter((id) => Number.isInteger(id) && id > 0));
    const commoditiesTotalQuantity = holdings.reduce((sum, entry) => sum + Number(entry?.quantity || 0), 0);
    const commoditiesTotalInvested = holdings.reduce((sum, entry) => sum + Number(entry?.totalInvested || 0), 0);

    const messageConversations = new Set(
      messages.map((message) => [Number(message?.fromUserId || 0), Number(message?.toUserId || 0)].sort((a, b) => a - b).join(":")),
    );
    const unreadMessages = messages.filter((message) => !message?.readAt).length;

    const featureFlagEntries = Object.entries(featureFlags);
    const enabledFeatureFlags = featureFlagEntries.filter(([, value]) => value === true).length;

    // System status (simple for now)
    const systemStatus = "Online";

    // --- Insights ---
    // Most Traded Item Type
    const itemTypeCounts = {};
    transactions.forEach((t) => {
      if (t.itemType) itemTypeCounts[t.itemType] = (itemTypeCounts[t.itemType] || 0) + 1;
    });
    const mostTradedItemType = Object.entries(itemTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    // Mean Market Price (all offers)
    const meanMarketPrice = totalOffers > 0 ? offers.reduce((sum, o) => sum + (o.price || 0), 0) / totalOffers : 0;

    // Largest Animal Herd
    const largestAnimalHerd = animals.reduce((max, a) => Math.max(max, a.amount || 0), 0);

    // Users with Most Animals
    const animalCountByUser = {};
    animals.forEach((a) => {
      animalCountByUser[a.userId] = (animalCountByUser[a.userId] || 0) + (a.amount || 0);
    });
    const usersWithMostAnimals = Object.entries(animalCountByUser).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    // Largest Field (ha)
    const largestField = fields.reduce((max, f) => Math.max(max, f.area || 0), 0);

    // Median Field Area
    const sortedAreas = fields.map((f) => f.area || 0).sort((a, b) => a - b);
    let medianFieldArea = 0;
    if (sortedAreas.length > 0) {
      const mid = Math.floor(sortedAreas.length / 2);
      medianFieldArea = sortedAreas.length % 2 !== 0 ? sortedAreas[mid] : Math.round((sortedAreas[mid - 1] + sortedAreas[mid]) / 2);
    }

    // Top Field Owner (userId with largest total field area)
    const fieldAreaByUser = {};
    fields.forEach((f) => {
      fieldAreaByUser[f.userId] = (fieldAreaByUser[f.userId] || 0) + (f.area || 0);
    });
    const topFieldOwner = Object.entries(fieldAreaByUser).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    // Users with No Fields/Staff/Animals
    const userIds = users.map((u) => u.id);
    const userHasFields = new Set(fields.map((f) => f.userId));
    const userHasStaff = new Set(staff.map((s) => s.userId));
    const userHasAnimals = new Set(animals.map((a) => a.userId));
    const usersWithNoFields = userIds.filter((id) => !userHasFields.has(id)).length;
    const usersWithNoStaff = userIds.filter((id) => !userHasStaff.has(id)).length;
    const usersWithNoAnimals = userIds.filter((id) => !userHasAnimals.has(id)).length;

    // Average Offer Price
    const averageOfferPrice = totalOffers > 0 ? offers.reduce((sum, o) => sum + (o.price || 0), 0) / totalOffers : 0;

    // Average Transaction Value
    const averageTransactionValue =
      totalTransactions > 0 ? transactions.reduce((sum, t) => sum + (t.price || 0), 0) / totalTransactions : 0;

    // Total Marketplace Revenue (sum of all completed transaction prices)
    const totalMarketplaceRevenue = transactions.reduce((sum, t) => sum + (t.price || 0), 0);

    let databaseSummary = {
      totalFiles: 0,
      totalRecords: 0,
      formattedTotalSize: "0 Bytes",
    };

    try {
      const dbInfo = await this.getDatabaseInfo();
      databaseSummary = {
        totalFiles: Number(dbInfo?.totalFiles || 0),
        totalRecords: Number(dbInfo?.totalRecords || 0),
        formattedTotalSize: dbInfo?.formattedTotalSize || "0 Bytes",
      };
    } catch (error) {
      logError("Error collecting database summary for overview:", error);
    }

    return {
      users: { total: totalUsers, active: activeUsers, inactive: inactiveUsers },
      fields: {
        total: totalFields,
        totalArea,
        avgAreaPerField,
        usersWithFields,
        avgAreaPerUser,
      },
      staff: { total: totalStaff, avgAge: avgStaffAge, usersWithStaff },
      animals: { total: totalAnimals, types: animalTypes, usersWithAnimals },
      marketplace: {
        totalOffers,
        activeOffers,
        soldOffers,
        cancelledOffers,
        unavailableOffers,
      },
      transactions: {
        total: totalTransactions,
        totalVolume: totalTransactionVolume,
      },
      financial: {
        totalTransactions: totalFinancialTransactions,
        totalVolume: totalFinancialVolume,
      },
      resources: {
        assignments: {
          total: assignmentsList.length,
          usersWithAssignments: new Set(assignmentsList.map((entry) => Number(entry?.userId || 0))).size,
        },
        docs: {
          total: docsList.length,
        },
        commodities: {
          totalHoldings: holdings.length,
          symbols: commoditiesSymbols.size,
          usersWithHoldings: commoditiesUsers.size,
          totalQuantity: commoditiesTotalQuantity,
          totalInvested: commoditiesTotalInvested,
        },
        messages: {
          total: messages.length,
          conversations: messageConversations.size,
          unread: unreadMessages,
        },
        featureFlags: {
          total: featureFlagEntries.length,
          enabled: enabledFeatureFlags,
          disabled: featureFlagEntries.length - enabledFeatureFlags,
        },
      },
      database: databaseSummary,
      system: { status: systemStatus },
      insights: {
        mostTradedItemType,
        meanMarketPrice,
        largestAnimalHerd,
        usersWithMostAnimals,
        largestField,
        medianFieldArea,
        topFieldOwner,
        usersWithNoFields,
        usersWithNoStaff,
        usersWithNoAnimals,
        averageOfferPrice,
        averageTransactionValue,
        totalMarketplaceRevenue,
      },
    };
  }

  /**
   * Get feature flags for admin dashboard
   */
  async getFeatureFlags(includeDescriptions = true) {
    if (includeDescriptions) {
      return featureFlagsService.getFeaturesWithDescriptions();
    }
    return featureFlagsService.getFeatureFlags();
  }

  /**
   * Update feature flags (partial)
   */
  async updateFeatureFlags(flags) {
    return featureFlagsService.updateFlags(flags);
  }

  /**
   * Reset feature flags to defaults
   */
  async resetFeatureFlags() {
    return featureFlagsService.resetFeatureFlags();
  }

  /**
   * Clear runtime caches and stale runtime data
   */
  async clearRuntimeCache() {
    const expiredTokensRemoved = cleanupExpiredTokens();
    const logsCleared = clearLogList();

    return {
      expiredTokensRemoved,
      logsCleared,
      clearedAt: new Date().toISOString(),
    };
  }

  /**
   * Get logs for export
   */
  async getLogsForExport(options = {}) {
    const level = String(options.level || "all").toLowerCase();
    const logs = getLogList();

    if (level === "all") {
      return logs;
    }

    const normalizedLevel = level === "warning" ? "warn" : level;
    return logs.filter((entry) => String(entry?.level || "").toLowerCase() === normalizedLevel);
  }

  /**
   * Messenger admin console: conversation-level summaries with filters
   */
  async getMessengerConversationsAdmin(query = {}) {
    const pagination = this._normalizePagination(query, { defaultPageSize: 20, maxPageSize: 100 });
    const userId = query.userId ? Number(query.userId) : null;
    const contains = String(query.contains || "")
      .trim()
      .toLowerCase();
    const fromDate = this._safeDate(query.from);
    const toDate = this._safeDate(query.to);
    const mutedOnly = this._parseBooleanQuery(query.mutedOnly);

    if (query.userId && (!Number.isInteger(userId) || userId <= 0)) {
      throw new Error("Validation failed: userId must be a positive integer");
    }

    const users = await this.userDataInstance.getUsers();
    const usersById = new Map(users.map((u) => [Number(u.id), u]));

    const store = await this._getMessagesStore();
    const pairs = new Map();

    for (const message of store.messages) {
      const fromUserId = Number(message?.fromUserId);
      const toUserId = Number(message?.toUserId);
      const createdAt = message?.createdAt ? new Date(message.createdAt) : null;

      if (!Number.isInteger(fromUserId) || !Number.isInteger(toUserId)) {
        continue;
      }

      if (userId && fromUserId !== userId && toUserId !== userId) {
        continue;
      }

      if (fromDate && (!createdAt || createdAt < fromDate)) {
        continue;
      }

      if (toDate && (!createdAt || createdAt > toDate)) {
        continue;
      }

      const text = String(message?.content || "").toLowerCase();
      if (contains && !text.includes(contains)) {
        continue;
      }

      const pairKey = [fromUserId, toUserId].sort((a, b) => a - b).join(":");
      const current = pairs.get(pairKey) || {
        participants: [fromUserId, toUserId],
        messageCount: 0,
        firstMessageAt: null,
        lastMessageAt: null,
        preview: null,
      };

      current.messageCount += 1;

      if (!current.firstMessageAt || (createdAt && createdAt.toISOString() < current.firstMessageAt)) {
        current.firstMessageAt = createdAt ? createdAt.toISOString() : current.firstMessageAt;
      }

      if (!current.lastMessageAt || (createdAt && createdAt.toISOString() > current.lastMessageAt)) {
        current.lastMessageAt = createdAt ? createdAt.toISOString() : current.lastMessageAt;
        current.preview = {
          messageId: Number(message?.id || 0),
          content: String(message?.content || "").slice(0, 120),
          fromUserId,
          toUserId,
        };
      }

      pairs.set(pairKey, current);
    }

    const items = [...pairs.values()]
      .map((entry) => {
        const [leftId, rightId] = entry.participants;
        const leftUser = this._toPublicUser(usersById.get(leftId)) || { id: leftId };
        const rightUser = this._toPublicUser(usersById.get(rightId)) || { id: rightId };
        return {
          ...entry,
          participants: [leftUser, rightUser],
        };
      })
      .filter((entry) => {
        if (mutedOnly !== true) {
          return true;
        }
        const participants = Array.isArray(entry.participants) ? entry.participants : [];
        return participants.some((participant) => {
          const mutedUntil = participant?.messengerMutedUntil;
          if (!mutedUntil) return false;
          const parsed = Date.parse(mutedUntil);
          return !Number.isNaN(parsed) && parsed > Date.now();
        });
      })
      .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")));

    const total = items.length;
    const pagedItems = items.slice(pagination.offset, pagination.offset + pagination.pageSize);

    return {
      items: pagedItems,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.offset + pagedItems.length < total,
      filters: {
        userId,
        contains: contains || null,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
        mutedOnly,
      },
    };
  }

  /**
   * Messenger admin console: message-level view with filters
   */
  async getMessengerMessagesAdmin(query = {}) {
    const pagination = this._normalizePagination(query, { defaultPageSize: 50, maxPageSize: 200 });
    const userId = query.userId ? Number(query.userId) : null;
    const withUserId = query.withUserId ? Number(query.withUserId) : null;
    const contains = String(query.contains || "")
      .trim()
      .toLowerCase();
    const fromDate = this._safeDate(query.from);
    const toDate = this._safeDate(query.to);
    const mutedOnly = this._parseBooleanQuery(query.mutedOnly);

    if (query.userId && (!Number.isInteger(userId) || userId <= 0)) {
      throw new Error("Validation failed: userId must be a positive integer");
    }
    if (query.withUserId && (!Number.isInteger(withUserId) || withUserId <= 0)) {
      throw new Error("Validation failed: withUserId must be a positive integer");
    }

    const users = await this.userDataInstance.getUsers();
    const usersById = new Map(users.map((u) => [Number(u.id), u]));
    const store = await this._getMessagesStore();

    let messages = store.messages.filter((message) => {
      const fromUser = Number(message?.fromUserId);
      const toUser = Number(message?.toUserId);
      const createdAt = message?.createdAt ? new Date(message.createdAt) : null;

      if (!Number.isInteger(fromUser) || !Number.isInteger(toUser)) return false;
      if (userId && fromUser !== userId && toUser !== userId) return false;
      if (withUserId && fromUser !== withUserId && toUser !== withUserId) return false;
      if (fromDate && (!createdAt || createdAt < fromDate)) return false;
      if (toDate && (!createdAt || createdAt > toDate)) return false;
      if (
        contains &&
        !String(message?.content || "")
          .toLowerCase()
          .includes(contains)
      )
        return false;

      if (mutedOnly === true) {
        const sourceUser = usersById.get(fromUser);
        const mutedUntil = sourceUser?.messengerMutedUntil;
        const mutedTimestamp = mutedUntil ? Date.parse(mutedUntil) : NaN;
        if (Number.isNaN(mutedTimestamp) || mutedTimestamp <= Date.now()) {
          return false;
        }
      }

      return true;
    });

    messages.sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));

    const total = messages.length;
    messages = messages.slice(pagination.offset, pagination.offset + pagination.pageSize);

    const items = messages.map((message) => {
      const fromUser = Number(message?.fromUserId);
      const toUser = Number(message?.toUserId);
      return {
        id: Number(message?.id || 0),
        fromUserId: fromUser,
        toUserId: toUser,
        fromUser: this._toPublicUser(usersById.get(fromUser)) || { id: fromUser },
        toUser: this._toPublicUser(usersById.get(toUser)) || { id: toUser },
        content: String(message?.content || ""),
        createdAt: message?.createdAt || null,
        deliveredAt: message?.deliveredAt || null,
        readAt: message?.readAt || null,
        readBy: Array.isArray(message?.readBy) ? message.readBy : [],
      };
    });

    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.offset + items.length < total,
      filters: {
        userId,
        withUserId,
        contains: contains || null,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
        mutedOnly,
      },
    };
  }

  /**
   * Messenger admin console: remove message by id
   */
  async removeMessengerMessageAdmin(messageId) {
    const numericMessageId = Number(messageId);
    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      throw new Error("Validation failed: messageId must be a positive integer");
    }

    const store = await this._getMessagesStore();
    const messages = Array.isArray(store.messages) ? [...store.messages] : [];
    const index = messages.findIndex((message) => Number(message?.id) === numericMessageId);

    if (index < 0) {
      throw new Error("Message not found");
    }

    const [removed] = messages.splice(index, 1);
    const messagesDb = dbManager.getMessagesDatabase();
    await messagesDb.replaceAll({
      ...store,
      messages,
    });

    return {
      id: numericMessageId,
      fromUserId: Number(removed?.fromUserId || 0),
      toUserId: Number(removed?.toUserId || 0),
      createdAt: removed?.createdAt || null,
    };
  }

  /**
   * Mute/unmute a user for messenger
   */
  async setMessengerMuteAdmin(userId, options = {}) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      throw new Error("Validation failed: userId must be a positive integer");
    }

    const user = await this.userDataInstance.findUser(numericUserId);
    if (!user) {
      throw new Error("User not found");
    }

    const mute = options.mute !== false;

    if (!mute) {
      const updated = await this.userDataInstance.updateUser(numericUserId, {
        messengerMutedUntil: null,
        messengerMuteReason: null,
      });
      return this._toPublicUser(updated);
    }

    const durationMinutesRaw = options.durationMinutes ?? 60;
    const durationMinutes = Number(durationMinutesRaw);

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 60 * 24 * 30) {
      throw new Error("Validation failed: durationMinutes must be between 1 and 43200");
    }

    const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
    const reason = options.reason ? String(options.reason).trim().slice(0, 250) : "Muted by administrator";

    const updated = await this.userDataInstance.updateUser(numericUserId, {
      messengerMutedUntil: mutedUntil,
      messengerMuteReason: reason,
    });

    return this._toPublicUser(updated);
  }

  /**
   * Commodities admin console market snapshot and derived risk metrics
   */
  async getCommoditiesMarketStateAdmin() {
    const commoditiesDb = dbManager.getCommoditiesDatabase();
    const storeRaw = await commoditiesDb.getAll();
    const holdings = Array.isArray(storeRaw?.holdings) ? storeRaw.holdings : [];
    const symbols = pricingService.getSupportedSymbols();

    const exposuresBySymbol = new Map();
    let totalMarketValue = 0;

    for (const symbol of symbols) {
      exposuresBySymbol.set(symbol, {
        symbol,
        userCount: 0,
        quantity: 0,
        invested: 0,
        marketValue: 0,
        pnl: 0,
      });
    }

    for (const holding of holdings) {
      const symbol = pricingService.normalizeSymbol(holding?.symbol);
      const quantity = Number(holding?.quantity || 0);
      const totalInvested = Number(holding?.totalInvested || 0);
      const price = pricingService.getCurrentPrice(symbol).price;
      const marketValue = Number((quantity * price).toFixed(2));
      const pnl = Number((marketValue - totalInvested).toFixed(2));

      const entry = exposuresBySymbol.get(symbol) || {
        symbol,
        userCount: 0,
        quantity: 0,
        invested: 0,
        marketValue: 0,
        pnl: 0,
      };

      entry.userCount += 1;
      entry.quantity = Number((entry.quantity + quantity).toFixed(4));
      entry.invested = Number((entry.invested + totalInvested).toFixed(2));
      entry.marketValue = Number((entry.marketValue + marketValue).toFixed(2));
      entry.pnl = Number((entry.pnl + pnl).toFixed(2));

      exposuresBySymbol.set(symbol, entry);
      totalMarketValue = Number((totalMarketValue + marketValue).toFixed(2));
    }

    const exposures = [...exposuresBySymbol.values()].map((entry) => {
      const concentrationPct = totalMarketValue > 0 ? Number(((entry.marketValue / totalMarketValue) * 100).toFixed(2)) : 0;
      const pnlPct = entry.invested > 0 ? Number((((entry.marketValue - entry.invested) / entry.invested) * 100).toFixed(2)) : 0;
      const control = commoditiesAdminControlsService.getControl(entry.symbol);

      return {
        ...entry,
        concentrationPct,
        pnlPct,
        control,
      };
    });

    const anomalies = [];
    for (const exposure of exposures) {
      if (exposure.concentrationPct >= 65) {
        anomalies.push({
          symbol: exposure.symbol,
          severity: "high",
          code: "CONCENTRATION_SPIKE",
          message: `Concentration is ${exposure.concentrationPct}%`,
        });
      }

      if (exposure.pnlPct <= -20) {
        anomalies.push({
          symbol: exposure.symbol,
          severity: "medium",
          code: "UNREALIZED_LOSS",
          message: `Unrealized P/L is ${exposure.pnlPct}%`,
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      symbols,
      controls: commoditiesAdminControlsService.getAllControls(),
      exposures,
      anomalies,
      totals: {
        holdings: holdings.length,
        marketValue: totalMarketValue,
      },
    };
  }

  /**
   * Update runtime commodities symbol control settings
   */
  async updateCommoditySymbolControl(symbol, payload = {}) {
    return commoditiesAdminControlsService.updateControl(symbol, payload);
  }
}

module.exports = new AdminService();
