const dbManager = require("./database-manager");
const { updateEntityTimestamp } = require("../helpers/entity.helpers");
const { logDebug, logError } = require("../helpers/logger-api");

const DEFAULT_STORE = {
  version: 1,
  keys: [],
  updatedAt: null,
};

class TwoFactorAuthDatabase {
  constructor() {
    this.db = dbManager.getTwoFactorAuthDatabase();
  }

  async _normalizeUserId(userId) {
    const numericId = Number(userId);
    if (Number.isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
      throw new Error("Invalid user ID format");
    }
    return numericId;
  }

  _normalizeRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const numericUserId = Number(record.userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return null;
    }

    return {
      enabled: record.enabled === true,
      secret: typeof record.secret === "string" ? record.secret : null,
      pendingSecret: typeof record.pendingSecret === "string" ? record.pendingSecret : null,
      enabledAt: typeof record.enabledAt === "string" ? record.enabledAt : null,
      setupGeneratedAt: typeof record.setupGeneratedAt === "string" ? record.setupGeneratedAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
      userId: numericUserId,
    };
  }

  _normalizeStore(current) {
    const rawKeys = Array.isArray(current) ? current : Array.isArray(current?.keys) ? current.keys : [];
    const keys = rawKeys.map((record) => this._normalizeRecord(record)).filter(Boolean);

    return {
      version: Number(current?.version) || DEFAULT_STORE.version,
      keys,
      updatedAt: typeof current?.updatedAt === "string" ? current.updatedAt : null,
    };
  }

  async _getStore() {
    const current = await this.db.getAll();
    return this._normalizeStore(current);
  }

  async findByUserId(userId) {
    try {
      const numericId = await this._normalizeUserId(userId);
      const store = await this._getStore();
      return store.keys.find((record) => record.userId === numericId) || null;
    } catch (error) {
      logError("Error finding two-factor auth record by user ID", error);
      throw error;
    }
  }

  async setRecordForUser(userId, record) {
    try {
      const numericId = await this._normalizeUserId(userId);
      const normalizedRecord = updateEntityTimestamp({ ...record, userId: numericId });
      const now = normalizedRecord.updatedAt;

      await this.db.update((current) => {
        const store = this._normalizeStore(current);
        const existingIndex = store.keys.findIndex((item) => item.userId === numericId);
        const keys =
          existingIndex >= 0
            ? store.keys.map((item, index) => (index === existingIndex ? { ...normalizedRecord } : item))
            : [...store.keys, { ...normalizedRecord }];

        return {
          ...store,
          keys,
          updatedAt: now,
        };
      });

      logDebug("Two-factor auth record saved for user", { userId: numericId });
      return await this.findByUserId(numericId);
    } catch (error) {
      logError("Error saving two-factor auth record", error);
      throw error;
    }
  }

  async deleteRecordByUserId(userId) {
    try {
      const numericId = await this._normalizeUserId(userId);
      let removed = false;
      const now = new Date().toISOString();

      await this.db.update((current) => {
        const store = this._normalizeStore(current);
        const keys = store.keys.filter((record) => record.userId !== numericId);
        removed = keys.length !== store.keys.length;

        return {
          ...store,
          keys,
          updatedAt: removed ? now : store.updatedAt,
        };
      });

      return removed;
    } catch (error) {
      logError("Error deleting two-factor auth record", error);
      throw error;
    }
  }
}

module.exports = TwoFactorAuthDatabase;
