const fs = require("fs").promises;
const path = require("path");
const { logDebug, logError } = require("../helpers/logger-api");

/**
 * Semaphore implementation for controlling concurrent access
 */
class Semaphore {
  constructor() {
    this.waiting = [];
    this.count = 0;
    this.holder = null;
  }

  async acquire() {
    if (this.count > 0) {
      await new Promise((resolve) => this.waiting.push(resolve));
    }
    this.count++;
    this.holder = Date.now();
  }

  release() {
    this.count--;
    this.holder = null;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    }
  }

  getStatus() {
    return {
      count: this.count,
      waiting: this.waiting.length,
      holder: this.holder,
    };
  }
}

/**
 * Global write semaphore to ensure only one thread writes to JSON files
 */
const globalWriteSemaphore = new Semaphore();

/**
 * In-Memory JSON Database with file persistence
 * Loads all data into memory at startup, only writes to files
 */
class JSONDatabase {
  constructor(filePath, defaultData = []) {
    this.filePath = filePath;
    this.defaultData = defaultData;
    this.data = null; // Will be loaded into memory
    this.isInitialized = false;

    // Ensure directory exists
    this.ensureDirectory();
  }

  /**
   * Determine whether a record is marked as protected
   */
  static isRecordProtected(record) {
    return !!(record && record.protected === true);
  }

  /**
   * Create a standardized read-only error
   */
  static createReadOnlyError(message = "Protected record is read-only") {
    const err = new Error(message);
    err.status = 403; // so controllers can map to HTTP status
    err.code = "READ_ONLY";
    return err;
  }

  /**
   * Ensure the directory exists
   */
  ensureDirectory() {
    const dir = path.dirname(this.filePath);
    if (!require("fs").existsSync(dir)) {
      require("fs").mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize database by loading data into memory
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      if (require("fs").existsSync(this.filePath)) {
        const fileContent = await fs.readFile(this.filePath, "utf8");

        if (fileContent && fileContent.trim() !== "") {
          try {
            this.data = JSON.parse(fileContent);
            logDebug(`Loaded data into memory: ${this.filePath}`);
          } catch (parseError) {
            logError(`JSON parsing error for ${this.filePath}:`, parseError);
            this.data = Array.isArray(this.defaultData)
              ? [...this.defaultData]
              : this.defaultData;
            await this.persist(); // Save default data
          }
        } else {
          this.data = Array.isArray(this.defaultData)
            ? [...this.defaultData]
            : this.defaultData;
          await this.persist(); // Save default data
        }
      } else {
        this.data = Array.isArray(this.defaultData)
          ? [...this.defaultData]
          : this.defaultData;
        await this.persist(); // Save initial data
      }

      this.isInitialized = true;
      logDebug(`Initialized database: ${this.filePath}`);
    } catch (error) {
      logError(`Failed to initialize database: ${this.filePath}`, error);
      this.data = Array.isArray(this.defaultData)
        ? [...this.defaultData]
        : this.defaultData;
      this.isInitialized = true;
    }
  }

  /**
   * Persist data to JSON file (only one thread can write at a time)
   */
  async persist() {
    await globalWriteSemaphore.acquire();
    try {
      // Validate that data can be serialized to JSON
      let jsonString;
      try {
        jsonString = JSON.stringify(this.data, null, 2);
      } catch (serializeError) {
        throw new Error(`Invalid data structure: ${serializeError.message}`);
      }

      // Direct write (safe since only one thread can write)
      await fs.writeFile(this.filePath, jsonString, "utf8");
      logDebug(`Persisted data to ${this.filePath}`);
    } catch (error) {
      throw new Error(`Failed to persist database: ${error.message}`);
    } finally {
      globalWriteSemaphore.release();
    }
  }

  /**
   * Force reload data from disk, replacing in-memory data
   */
  async reloadFromDisk() {
    try {
      if (require("fs").existsSync(this.filePath)) {
        const fileContent = await fs.readFile(this.filePath, "utf8");
        if (fileContent && fileContent.trim() !== "") {
          try {
            this.data = JSON.parse(fileContent);
            logDebug(`Reloaded data from disk: ${this.filePath}`);
          } catch (parseError) {
            logError(
              `JSON parsing error on reload for ${this.filePath}:`,
              parseError,
            );
            this.data = Array.isArray(this.defaultData)
              ? [...this.defaultData]
              : this.defaultData;
          }
        } else {
          this.data = Array.isArray(this.defaultData)
            ? [...this.defaultData]
            : this.defaultData;
        }
      } else {
        this.data = Array.isArray(this.defaultData)
          ? [...this.defaultData]
          : this.defaultData;
      }
      this.isInitialized = true;
    } catch (error) {
      logError(`Failed to reload data from disk for ${this.filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get all records (from memory)
   */
  async getAll() {
    await this.ensureInitialized();
    return Array.isArray(this.data) ? [...this.data] : this.data;
  }

  /**
   * Read all data (backward compatibility method)
   */
  async read() {
    return await this.getAll();
  }

  /**
   * Find records matching a predicate (from memory)
   */
  async find(predicate) {
    await this.ensureInitialized();
    return Array.isArray(this.data) ? this.data.filter(predicate) : [];
  }

  /**
   * Find a single record matching a predicate (from memory)
   */
  async findOne(predicate) {
    await this.ensureInitialized();
    return Array.isArray(this.data) ? this.data.find(predicate) : null;
  }

  /**
   * Add a new record with atomic ID generation
   */
  async add(record) {
    await this.ensureInitialized();

    if (!Array.isArray(this.data)) {
      this.data = [];
    }

    // Create a deep copy to avoid mutation
    const newData = [...this.data];

    // Assign numeric ID if not present
    if (record.id == null) {
      let maxId = 0;
      for (const item of newData) {
        if (typeof item.id === "number" && item.id > maxId) maxId = item.id;
      }
      record.id = maxId + 1;
    }

    // Create a copy of the record to avoid reference issues
    const newRecord = { ...record };
    newData.push(newRecord);

    // Update in-memory data
    this.data = newData;

    // Persist to file
    await this.persist();

    return newRecord;
  }

  /**
   * Update records matching a predicate
   */
  async updateRecords(predicate, updateFn) {
    await this.ensureInitialized();

    if (!Array.isArray(this.data)) {
      throw new Error("Cannot update records in non-array data");
    }

    // Detect attempts to modify protected records
    const targetedProtected = this.data.some(
      (record) => predicate(record) && JSONDatabase.isRecordProtected(record),
    );
    if (targetedProtected) {
      throw JSONDatabase.createReadOnlyError(
        "Cannot update protected record(s)",
      );
    }

    const newData = this.data.map((record) => {
      if (predicate(record)) {
        return updateFn({ ...record });
      }
      return record;
    });

    // Update in-memory data
    this.data = newData;

    // Persist to file
    await this.persist();

    return newData;
  }

  /**
   * Remove records matching a predicate
   */
  async remove(predicate) {
    await this.ensureInitialized();

    if (!Array.isArray(this.data)) {
      throw new Error("Cannot remove records from non-array data");
    }

    // Prevent deleting protected records
    const attemptingToDeleteProtected = this.data.some(
      (record) => predicate(record) && JSONDatabase.isRecordProtected(record),
    );
    if (attemptingToDeleteProtected) {
      throw JSONDatabase.createReadOnlyError(
        "Cannot delete protected record(s)",
      );
    }

    const newData = this.data.filter((record) => !predicate(record));

    // Update in-memory data
    this.data = newData;

    // Persist to file
    await this.persist();

    return newData;
  }

  /**
   * Replace all data atomically
   */
  async replaceAll(newData) {
    await this.ensureInitialized();
    // Update in-memory data
    this.data = newData;

    // Persist to file
    await this.persist();
  }

  /**
   * Backward-compatibility: update data via transform function
   * updateFn receives the whole data and must return the new data
   */
  async update(updateFn) {
    await this.ensureInitialized();

    if (typeof updateFn !== "function") {
      throw new Error("update(updateFn) requires a function");
    }

    const current = Array.isArray(this.data) ? [...this.data] : this.data;
    const next = updateFn(current);

    // Reuse replaceAll validation to enforce protected rules
    await this.replaceAll(next);
    return this.data;
  }

  /**
   * Write data (backward compatibility method)
   */
  async write(newData) {
    return await this.replaceAll(newData);
  }

  /**
   * Ensure database is initialized
   */
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Get semaphore status for debugging
   */
  getSemaphoreStatus() {
    return {
      ...globalWriteSemaphore.getStatus(),
      filePath: this.filePath,
      isInitialized: this.isInitialized,
      dataType: Array.isArray(this.data) ? "array" : "object",
      dataLength: Array.isArray(this.data) ? this.data.length : "N/A",
    };
  }

  /**
   * Clear all semaphores (useful for testing)
   */
  static clearSemaphores() {
    // Reset the global write semaphore
    globalWriteSemaphore.count = 0;
    globalWriteSemaphore.waiting = [];
    globalWriteSemaphore.holder = null;
  }

  /**
   * Get statistics about all semaphores (useful for monitoring)
   */
  static getSemaphoreStats() {
    return {
      globalWriteSemaphore: globalWriteSemaphore.getStatus(),
    };
  }

  /**
   * Static method to read JSON array (for backward compatibility)
   */
  static async readJsonArray(filePath) {
    try {
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

module.exports = JSONDatabase;
