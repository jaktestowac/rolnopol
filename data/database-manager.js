const path = require("path");
const JSONDatabase = require("./json-database");

/**
 * Global Database Manager - Provides singleton JSONDatabase instances
 * to prevent multiple instances for the same resources and ensure proper synchronization
 */
class DatabaseManager {
  constructor() {
    this.instances = new Map();
    this.basePath = path.join(__dirname);
  }

  /**
   * Get a singleton JSONDatabase instance for a specific resource
   * @param {string} resourceName - The name of the resource (e.g., 'fields', 'animals', 'financial')
   * @param {string} fileName - The filename (e.g., 'fields.json', 'animals.json')
   * @param {*} defaultData - Default data structure if file doesn't exist
   * @returns {JSONDatabase} Singleton instance
   */
  getDatabase(resourceName, fileName, defaultData = []) {
    const key = `${resourceName}:${fileName}`;

    if (!this.instances.has(key)) {
      const filePath = path.join(this.basePath, fileName);
      const instance = new JSONDatabase(filePath, defaultData);
      this.instances.set(key, instance);

      // Log the creation of new database instance
      const { logDebug } = require("../helpers/logger-api");
      logDebug(`Created new database instance: ${key}`, { filePath });
    }

    return this.instances.get(key);
  }

  /**
   * Get fields database singleton
   */
  getFieldsDatabase() {
    return this.getDatabase("fields", "fields.json", []);
  }

  /**
   * Get animals database singleton
   */
  getAnimalsDatabase() {
    return this.getDatabase("animals", "animals.json", []);
  }

  /**
   * Get staff database singleton
   */
  getStaffDatabase() {
    return this.getDatabase("staff", "staff.json", []);
  }

  /**
   * Get assignments database singleton
   */
  getAssignmentsDatabase() {
    return this.getDatabase("assignments", "assignments.json", []);
  }

  /**
   * Get financial database singleton
   */
  getFinancialDatabase() {
    return this.getDatabase("financial", "financial.json", {
      accounts: [],
      counters: {
        lastAccountId: 0,
        lastTransactionId: 0,
      },
    });
  }

  /**
   * Get marketplace database singleton
   */
  getMarketplaceDatabase() {
    return this.getDatabase("marketplace", "marketplace.json", {
      offers: [],
      transactions: [],
      counters: {
        lastListingId: 0,
        lastTransactionId: 0,
      },
    });
  }

  /**
   * Get feature flags database singleton
   */
  getFeatureFlagsDatabase() {
    const defaultFlags = require("./feature-flags.json");
    return this.getDatabase("feature-flags", "feature-flags.json", defaultFlags);
  }

  /**
   * Get users database singleton
   */
  getUsersDatabase() {
    return this.getDatabase("users", "users.json", []);
  }

  /**
   * Get messages database singleton
   */
  getMessagesDatabase() {
    return this.getDatabase("messages", "messages.json", {
      messages: [],
    });
  }

  /**
   * Get a custom database singleton
   */
  getCustomDatabase(resourceName, fileName, defaultData = []) {
    return this.getDatabase(resourceName, fileName, defaultData);
  }

  /**
   * Clear all database instances (useful for testing)
   */
  clearAll() {
    this.instances.clear();
  }

  /**
   * Get status of all database instances
   */
  getStatus() {
    const status = {};
    for (const [key, instance] of this.instances) {
      status[key] = {
        filePath: instance.filePath,
        semaphoreStatus: instance.getSemaphoreStatus(),
      };
    }
    return status;
  }

  /**
   * Get the number of active database instances
   */
  getInstanceCount() {
    return this.instances.size;
  }

  /**
   * Get database health and statistics
   */
  getHealthStats() {
    const stats = {
      totalInstances: this.instances.size,
      instances: {},
      semaphores: {},
    };

    for (const [key, instance] of this.instances) {
      const semaphoreStatus = instance.getSemaphoreStatus();
      stats.instances[key] = {
        filePath: instance.filePath,
        exists: require("fs").existsSync(instance.filePath),
      };
      stats.semaphores[key] = semaphoreStatus;
    }

    return stats;
  }

  /**
   * Validate all database instances
   */
  async validateAll() {
    const results = {};

    for (const [key, instance] of this.instances) {
      try {
        await instance.read();
        results[key] = { status: "ok", error: null };
      } catch (error) {
        results[key] = { status: "error", error: error.message };
      }
    }

    return results;
  }

  /**
   * Reload all managed databases from disk
   */
  async reloadAllFromDisk() {
    for (const db of this.instances.values()) {
      if (typeof db.reloadFromDisk === "function") {
        await db.reloadFromDisk();
      }
    }
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    const stats = {
      instances: this.instances.size,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };

    return stats;
  }
}

// Export a singleton instance
module.exports = new DatabaseManager();
