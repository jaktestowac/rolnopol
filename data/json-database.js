const fs = require("fs").promises;
const path = require("path");
const { logDebug, logError, logInfo } = require("../helpers/logger-api");

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

/** Distinguishes temp files written by this process from each other. */
let writeSequence = 0;

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
    this.writeDebounceMs = JSONDatabase.resolveWriteDebounceMs(filePath);
    this.flushTimer = null;
    this.flushInProgress = false;
    this.hasPendingChanges = false;
    this.pendingPersistPromise = null;
    this.pendingPersistResolve = null;
    this.pendingPersistReject = null;

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
   * Resolve write debounce interval from environment
   */
  static resolveWriteDebounceMs(filePath) {
    const rawValue = process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    if (rawValue == null || rawValue === "") {
      const fileName = path.basename(filePath || "").toLowerCase();
      if (fileName === "users.json" || fileName === "financial.json") {
        return 1000;
      }
      return 15;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return 15;
    }

    return Math.max(0, Math.floor(parsed));
  }

  static isTransientWriteError(error) {
    return ["EBUSY", "EPERM", "EACCES", "UNKNOWN"].includes(error?.code);
  }

  /**
   * Write a database file without ever truncating the one already on disk.
   *
   * `fs.writeFile` opens the target with O_TRUNC, so the file is 0 bytes for as long as the
   * write takes. Any reader in that window sees an empty file, and a process that dies (or
   * a second process writing the same path, which the in-process semaphore cannot see)
   * leaves it empty for good. This writes a temp file beside the target and renames it over,
   * which is atomic: readers see either the old file or the new one.
   */
  static async writeFileWithRetry(filePath, content, options = {}) {
    // A database file is never legitimately empty. Refusing here means no bug upstream can
    // turn a populated file into a blank one.
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error(`Refusing to write empty content to ${filePath}`);
    }

    // Renaming over an existing file is where Windows says EPERM: a reader with the target
    // open, a virus scanner, or another writer renaming onto the same path. All of those
    // clear in milliseconds, so this waits rather than giving up, and jitters the delay so
    // competing writers do not retry in lockstep.
    const attempts = Number.isInteger(options.attempts) ? options.attempts : 10;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // A fresh name per attempt, and per process, so two writers never share a temp file.
      writeSequence += 1;
      const tempPath = `${filePath}.${process.pid}.${writeSequence}.tmp`;

      try {
        await fs.writeFile(tempPath, content, "utf8");
        await fs.rename(tempPath, filePath);
        return;
      } catch (error) {
        lastError = error;

        // The target is untouched on any failure, so the worst case is the old contents.
        try {
          await fs.unlink(tempPath);
        } catch {
          // The temp file may never have been created. Nothing to clean up.
        }

        if (!JSONDatabase.isTransientWriteError(error) || attempt === attempts) {
          break;
        }
        const backoffMs = 15 * attempt + Math.floor(Math.random() * 15);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
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
   * Keep the content of a file that could not be parsed, so restoring defaults over it does
   * not destroy the only copy of whatever went wrong. One file per database, overwritten.
   */
  async preserveUnreadableFile(fileContent) {
    const backupPath = `${this.filePath}.corrupt.bak`;

    try {
      await fs.writeFile(backupPath, fileContent, "utf8");
      logError(`Kept the unreadable file for inspection: ${backupPath}`);
    } catch (error) {
      logError(`Could not keep a copy of the unreadable file: ${backupPath}`, error);
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
            // Falling back to defaults overwrites whatever was there, so keep a copy of it.
            // Unparseable content is still evidence of what went wrong.
            await this.preserveUnreadableFile(fileContent);
            this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
            await this.persist({ immediate: true }); // Save default data
          }
        } else {
          // An empty file carries nothing worth preserving, but it should never be here:
          // writes go through a rename, so a truncated file means something outside this
          // process wrote it.
          logError(`Empty database file, restoring defaults: ${this.filePath}`);
          this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
          await this.persist({ immediate: true }); // Save default data
        }
      } else {
        this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
        await this.persist({ immediate: true }); // Save initial data
      }

      this.isInitialized = true;
      logDebug(`Initialized database: ${this.filePath}`);
    } catch (error) {
      logError(`Failed to initialize database: ${this.filePath}`, error);
      this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
      this.isInitialized = true;
    }
  }

  /**
   * Persist data to JSON file (only one thread can write at a time)
   */
  async _flushPendingChanges() {
    if (this.flushInProgress) {
      return;
    }

    if (!this.hasPendingChanges) {
      if (this.pendingPersistResolve) {
        this.pendingPersistResolve();
      }
      this.pendingPersistPromise = null;
      this.pendingPersistResolve = null;
      this.pendingPersistReject = null;
      return;
    }

    this.flushInProgress = true;
    await globalWriteSemaphore.acquire();
    try {
      while (this.hasPendingChanges) {
        this.hasPendingChanges = false;

        // Validate that data can be serialized to JSON
        let jsonString;
        try {
          jsonString = JSON.stringify(this.data, null, 2);
        } catch (serializeError) {
          throw new Error(`Invalid data structure: ${serializeError.message}`);
        }

        // Direct write (safe since only one thread can write)
        await JSONDatabase.writeFileWithRetry(this.filePath, jsonString);
        logDebug(`Persisted data to ${this.filePath}`);
      }

      if (this.pendingPersistResolve) {
        this.pendingPersistResolve();
      }
      this.pendingPersistPromise = null;
      this.pendingPersistResolve = null;
      this.pendingPersistReject = null;
    } catch (error) {
      if (this.pendingPersistReject) {
        this.pendingPersistReject(new Error(`Failed to persist database: ${error.message}`));
      }
      this.pendingPersistPromise = null;
      this.pendingPersistResolve = null;
      this.pendingPersistReject = null;
    } finally {
      this.flushInProgress = false;
      globalWriteSemaphore.release();

      if (this.hasPendingChanges) {
        const delayMs = this.writeDebounceMs;
        if (delayMs === 0) {
          void this._flushPendingChanges();
        } else {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this._flushPendingChanges();
          }, delayMs);
        }
      }
    }
  }

  /**
   * Persist data to JSON file (coalesced and serialized)
   */
  async persist(options = {}) {
    const immediate = options && options.immediate === true;
    this.hasPendingChanges = true;

    if (!this.pendingPersistPromise) {
      this.pendingPersistPromise = new Promise((resolve, reject) => {
        this.pendingPersistResolve = resolve;
        this.pendingPersistReject = reject;
      });
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const delayMs = immediate ? 0 : this.writeDebounceMs;
    if (delayMs === 0) {
      void this._flushPendingChanges();
    } else {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this._flushPendingChanges();
      }, delayMs);
    }

    return this.pendingPersistPromise;
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
            logError(`JSON parsing error on reload for ${this.filePath}:`, parseError);
            this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
          }
        } else {
          this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
        }
      } else {
        this.data = Array.isArray(this.defaultData) ? [...this.defaultData] : this.defaultData;
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
    const targetedProtected = this.data.some((record) => predicate(record) && JSONDatabase.isRecordProtected(record));
    if (targetedProtected) {
      throw JSONDatabase.createReadOnlyError("Cannot update protected record(s)");
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
    const attemptingToDeleteProtected = this.data.some((record) => predicate(record) && JSONDatabase.isRecordProtected(record));
    if (attemptingToDeleteProtected) {
      throw JSONDatabase.createReadOnlyError("Cannot delete protected record(s)");
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
  async replaceAll(newData, options = {}) {
    await this.ensureInitialized();
    // Update in-memory data
    this.data = newData;

    // Persist to file
    await this.persist(options);
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
  async write(newData, options = {}) {
    return await this.replaceAll(newData, options);
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
