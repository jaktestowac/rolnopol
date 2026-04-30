const { randomBytes, randomUUID, createHmac, timingSafeEqual } = require("crypto");
const dbManager = require("../data/database-manager");
const UserDataSingleton = require("../data/user-data-singleton");
const { JWT_SECRET } = require("../data/settings");
const featureFlagsService = require("../services/feature-flags.service");
const { logDebug, logError } = require("../helpers/logger-api");

const DEFAULT_STORE = {
  version: 1,
  keys: [],
  updatedAt: null,
};

const API_KEY_SCOPES = Object.freeze(["staff", "animals", "fields", "user-account", "chatbot", "all"]);

const SCOPE_ALIASES = Object.freeze({
  user: "user-account",
  useraccount: "user-account",
  user_account: "user-account",
  "user account": "user-account",
  account: "user-account",
  assistant: "chatbot",
  chat: "chatbot",
  "assistant-chat": "chatbot",
});

const MAX_ACTIVE_KEYS_PER_USER = 20;
const DEFAULT_LABEL = "Personal integration key";

class PersonalApiKeyService {
  constructor() {
    this.db = dbManager.getPersonalApiKeysDatabase();
    this.userDataInstance = UserDataSingleton.getInstance();
    this.hashSecret = process.env.API_KEY_HASH_SECRET || JWT_SECRET || "rolnopol-personal-api-keys";
  }

  async listKeys(userId) {
    const user = await this._ensureActiveUser(userId);
    const store = await this._getStore();

    return store.keys
      .filter((record) => Number(record.userId) === Number(user.id))
      .sort((left, right) => {
        if (!!left.revokedAt !== !!right.revokedAt) {
          return left.revokedAt ? 1 : -1;
        }
        return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
      })
      .map((record) => this._toPublicRecord(record));
  }

  listAvailableScopes() {
    return [...API_KEY_SCOPES];
  }

  async createKey(userId, input = {}) {
    const user = await this._ensureActiveUser(userId);
    const label = this._sanitizeLabel(input.label);
    const scopes = this._normalizeScopes(input.scopes);
    const store = await this._getStore();

    const activeCount = store.keys.filter((record) => Number(record.userId) === Number(user.id) && !record.revokedAt).length;
    if (activeCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new Error(`Validation failed: maximum of ${MAX_ACTIVE_KEYS_PER_USER} active API keys reached`);
    }

    const rawKey = this._generateRawKey();
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      userId: Number(user.id),
      label,
      scopes,
      keyHash: this._hashKey(rawKey),
      keyPreview: this._buildPreview(rawKey),
      keyPrefix: this._buildPrefix(rawKey),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      regeneratedAt: null,
      revokedAt: null,
    };

    await this.db.update((current) => {
      const normalized = this._normalizeStore(current);
      return {
        ...normalized,
        keys: [...normalized.keys, record],
        updatedAt: now,
      };
    });

    logDebug("Created personal API key", {
      userId: user.id,
      apiKeyId: record.id,
      scopes,
    });

    return {
      key: this._toPublicRecord(record),
      rawKey,
    };
  }

  async revokeKey(userId, keyId) {
    const user = await this._ensureActiveUser(userId);
    const record = await this._updateOwnedKey(user.id, keyId, (existing, now) => {
      if (existing.revokedAt) {
        throw new Error("API key already revoked");
      }

      return {
        ...existing,
        revokedAt: now,
        updatedAt: now,
      };
    });

    logDebug("Revoked personal API key", {
      userId: user.id,
      apiKeyId: record.id,
    });

    return this._toPublicRecord(record);
  }

  async regenerateKey(userId, keyId) {
    const user = await this._ensureActiveUser(userId);
    const rawKey = this._generateRawKey();

    const record = await this._updateOwnedKey(user.id, keyId, (existing, now) => {
      if (existing.revokedAt) {
        throw new Error("Cannot regenerate a revoked API key");
      }

      return {
        ...existing,
        keyHash: this._hashKey(rawKey),
        keyPreview: this._buildPreview(rawKey),
        keyPrefix: this._buildPrefix(rawKey),
        regeneratedAt: now,
        updatedAt: now,
        lastUsedAt: null,
      };
    });

    logDebug("Regenerated personal API key", {
      userId: user.id,
      apiKeyId: record.id,
    });

    return {
      key: this._toPublicRecord(record),
      rawKey,
    };
  }

  async authenticateApiKey(rawApiKey, req) {
    const normalizedKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
    if (!normalizedKey) {
      return { valid: false, reason: "missing" };
    }

    const flags = await featureFlagsService.getFeatureFlags();
    if (flags?.flags?.personalApiKeysEnabled !== true) {
      return { valid: false, reason: "feature_disabled" };
    }

    const store = await this._getStore();
    const keyHash = this._hashKey(normalizedKey);
    const record = store.keys.find((candidate) => !candidate.revokedAt && this._safeCompare(candidate.keyHash, keyHash));

    if (!record) {
      return { valid: false, reason: "invalid" };
    }

    const user = await this.userDataInstance.findUser(record.userId);
    if (!user || user.isActive !== true) {
      return { valid: false, reason: "invalid" };
    }

    const requiredScope = this.resolveRequiredScope(req);
    const grantedScopes = this._normalizeScopes(record.scopes, { allowDefault: true });

    if (!this.isScopeAllowed(grantedScopes, requiredScope)) {
      return {
        valid: false,
        reason: "insufficient_scope",
        requiredScope,
        apiKey: this._toPublicRecord(record),
      };
    }

    const lastUsedAt = new Date().toISOString();
    await this._touchLastUsed(record.id, lastUsedAt);

    return {
      valid: true,
      userId: String(user.id),
      requiredScope,
      apiKey: this._toPublicRecord({
        ...record,
        lastUsedAt,
      }),
    };
  }

  resolveRequiredScope(req) {
    const rawPath =
      typeof req?.originalUrl === "string" && req.originalUrl.length > 0 ? req.originalUrl : `${req?.baseUrl || ""}${req?.path || ""}`;
    const pathname = String(rawPath || "")
      .split("?")[0]
      .toLowerCase();

    if (pathname.startsWith("/api/v1/users/profile/api-keys")) {
      return "session-only";
    }

    if (pathname === "/api/v1/authorization" || pathname.startsWith("/api/v1/users")) {
      return "user-account";
    }

    if (pathname.startsWith("/api/v1/staff")) {
      return "staff";
    }

    if (pathname.startsWith("/api/v1/animals")) {
      return "animals";
    }

    if (pathname.startsWith("/api/v1/fields")) {
      return "fields";
    }

    if (pathname.startsWith("/api/v1/assistant-chat")) {
      return "chatbot";
    }

    return "all";
  }

  isScopeAllowed(scopes, requiredScope) {
    const normalizedScopes = this._normalizeScopes(scopes, { allowDefault: true });

    if (requiredScope === "session-only") {
      return false;
    }

    if (normalizedScopes.includes("all")) {
      return true;
    }

    return normalizedScopes.includes(requiredScope);
  }

  async _ensureActiveUser(userId) {
    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (user.isActive !== true) {
      throw new Error("Account is deactivated");
    }

    return user;
  }

  async _getStore() {
    const current = await this.db.getAll();
    return this._normalizeStore(current);
  }

  _normalizeStore(current) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return {
        ...DEFAULT_STORE,
        keys: [],
      };
    }

    const keys = Array.isArray(current.keys)
      ? current.keys
          .filter((record) => record && typeof record === "object" && record.id && record.keyHash)
          .map((record) => ({
            id: String(record.id),
            userId: Number(record.userId),
            label: this._sanitizeLabel(record.label, { allowDefault: true }),
            scopes: this._normalizeScopes(record.scopes, { allowDefault: true }),
            keyHash: String(record.keyHash),
            keyPreview: typeof record.keyPreview === "string" ? record.keyPreview : null,
            keyPrefix: typeof record.keyPrefix === "string" ? record.keyPrefix : null,
            createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
            updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
            lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : null,
            regeneratedAt: typeof record.regeneratedAt === "string" ? record.regeneratedAt : null,
            revokedAt: typeof record.revokedAt === "string" ? record.revokedAt : null,
          }))
      : [];

    return {
      version: Number(current.version) || DEFAULT_STORE.version,
      keys,
      updatedAt: typeof current.updatedAt === "string" ? current.updatedAt : null,
    };
  }

  _sanitizeLabel(label, options = {}) {
    const allowDefault = options.allowDefault !== false;
    const normalized = typeof label === "string" ? label.trim() : "";

    if (!normalized) {
      if (allowDefault) {
        return DEFAULT_LABEL;
      }
      throw new Error("Validation failed: label is required");
    }

    if (normalized.length > 80) {
      throw new Error("Validation failed: label must be 80 characters or fewer");
    }

    return normalized;
  }

  _normalizeScopes(scopes, options = {}) {
    const allowDefault = options.allowDefault === true;

    if (!Array.isArray(scopes) || scopes.length === 0) {
      return allowDefault ? ["all"] : ["all"];
    }

    const normalizedScopes = [];

    for (const scope of scopes) {
      if (typeof scope !== "string") {
        throw new Error("Validation failed: scopes must contain strings only");
      }

      const trimmed = scope.trim().toLowerCase();
      if (!trimmed) {
        continue;
      }

      const mapped = SCOPE_ALIASES[trimmed] || trimmed;
      if (!API_KEY_SCOPES.includes(mapped)) {
        throw new Error(`Validation failed: unsupported scope \"${scope}\"`);
      }

      if (!normalizedScopes.includes(mapped)) {
        normalizedScopes.push(mapped);
      }
    }

    if (normalizedScopes.length === 0) {
      return ["all"];
    }

    if (normalizedScopes.includes("all")) {
      return ["all"];
    }

    return normalizedScopes;
  }

  _generateRawKey() {
    return `rpk_live_${randomBytes(24).toString("base64url")}`;
  }

  _hashKey(rawKey) {
    return createHmac("sha256", this.hashSecret).update(String(rawKey)).digest("hex");
  }

  _safeCompare(left, right) {
    if (typeof left !== "string" || typeof right !== "string") {
      return false;
    }

    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    try {
      return timingSafeEqual(leftBuffer, rightBuffer);
    } catch (error) {
      return false;
    }
  }

  _buildPreview(rawKey) {
    const normalized = String(rawKey);
    if (normalized.length <= 18) {
      return normalized;
    }

    return `${normalized.slice(0, 12)}...${normalized.slice(-4)}`;
  }

  _buildPrefix(rawKey) {
    return String(rawKey).slice(0, 12);
  }

  _toPublicRecord(record) {
    return {
      id: record.id,
      userId: Number(record.userId),
      label: record.label,
      scopes: this._normalizeScopes(record.scopes, { allowDefault: true }),
      keyPreview: record.keyPreview,
      keyPrefix: record.keyPrefix,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
      regeneratedAt: record.regeneratedAt,
      revokedAt: record.revokedAt,
      isRevoked: !!record.revokedAt,
    };
  }

  async _touchLastUsed(keyId, lastUsedAt) {
    try {
      await this.db.update((current) => {
        const normalized = this._normalizeStore(current);
        return {
          ...normalized,
          keys: normalized.keys.map((record) => {
            if (String(record.id) !== String(keyId)) {
              return record;
            }

            return {
              ...record,
              lastUsedAt,
            };
          }),
          updatedAt: normalized.updatedAt,
        };
      });
    } catch (error) {
      logError("Failed to update personal API key lastUsedAt", {
        apiKeyId: keyId,
        error: error?.message || error,
      });
    }
  }

  async _updateOwnedKey(userId, keyId, updater) {
    let nextRecord = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const normalized = this._normalizeStore(current);
      const recordIndex = normalized.keys.findIndex((record) => String(record.id) === String(keyId));

      if (recordIndex === -1) {
        throw new Error("API key not found");
      }

      const existing = normalized.keys[recordIndex];
      if (Number(existing.userId) !== Number(userId)) {
        throw new Error("API key not found");
      }

      nextRecord = updater(existing, now);
      const nextKeys = [...normalized.keys];
      nextKeys[recordIndex] = nextRecord;

      return {
        ...normalized,
        keys: nextKeys,
        updatedAt: now,
      };
    });

    return nextRecord;
  }
}

module.exports = new PersonalApiKeyService();
module.exports.API_KEY_SCOPES = API_KEY_SCOPES;
