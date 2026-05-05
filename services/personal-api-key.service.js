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
const API_KEY_MODES = Object.freeze(["read", "write"]);
const DEFAULT_API_KEY_MODE = "write";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRATION = "never";
const API_KEY_EXPIRATION_OPTIONS = Object.freeze([
  Object.freeze({ value: "1d", label: "1 day", days: 1 }),
  Object.freeze({ value: "7d", label: "7 days", days: 7 }),
  Object.freeze({ value: "14d", label: "14 days", days: 14 }),
  Object.freeze({ value: "30d", label: "30 days", days: 30 }),
  Object.freeze({ value: "365d", label: "1 year", days: 365 }),
  Object.freeze({ value: "never", label: "No expiration date", days: null }),
]);
const API_KEY_EXPIRATION_LOOKUP = Object.freeze(
  API_KEY_EXPIRATION_OPTIONS.reduce((lookup, option) => {
    lookup[option.value] = option;
    return lookup;
  }, {}),
);

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
        const statusWeight = this._getStatusSortWeight(left) - this._getStatusSortWeight(right);
        if (statusWeight !== 0) {
          return statusWeight;
        }

        return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
      })
      .map((record) => this._toPublicRecord(record));
  }

  listAvailableScopes() {
    return [...API_KEY_SCOPES];
  }

  listAvailableModes() {
    return [...API_KEY_MODES];
  }

  listAvailableExpirationOptions() {
    return API_KEY_EXPIRATION_OPTIONS.map((option) => ({ ...option }));
  }

  async createKey(userId, input = {}) {
    const user = await this._ensureActiveUser(userId);
    const label = this._sanitizeLabel(input.label);
    const scopes = this._normalizeScopes(input.scopes);
    const mode = this._normalizeMode(input.mode);
    const expiration = this._normalizeExpiration(input.expiration);
    const store = await this._getStore();

    const activeCount = store.keys.filter(
      (record) => Number(record.userId) === Number(user.id) && !record.revokedAt && !this._isExpired(record),
    ).length;
    if (activeCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new Error(`Validation failed: maximum of ${MAX_ACTIVE_KEYS_PER_USER} active API keys reached`);
    }

    const rawKey = this._generateRawKey();
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const record = {
      id: randomUUID(),
      userId: Number(user.id),
      label,
      scopes,
      mode,
      expiration,
      expiresAt: this._calculateExpiresAt(expiration, nowDate),
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
      mode,
      expiration,
      expiresAt: record.expiresAt,
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

  async regenerateKey(userId, keyId, input = {}) {
    const user = await this._ensureActiveUser(userId);
    const rawKey = this._generateRawKey();

    const record = await this._updateOwnedKey(user.id, keyId, (existing, now) => {
      if (existing.revokedAt) {
        throw new Error("Cannot regenerate a revoked API key");
      }

      const expiration = this._normalizeExpiration(
        Object.prototype.hasOwnProperty.call(input, "expiration") ? input.expiration : existing.expiration,
        { allowDefault: true },
      );
      const mode = this._normalizeMode(Object.prototype.hasOwnProperty.call(input, "mode") ? input.mode : existing.mode, {
        allowDefault: true,
      });

      return {
        ...existing,
        mode,
        expiration,
        expiresAt: this._calculateExpiresAt(expiration, now),
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
      mode: record.mode,
      expiration: record.expiration,
      expiresAt: record.expiresAt,
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

    if (this._isExpired(record)) {
      return {
        valid: false,
        reason: "expired",
        apiKey: this._toPublicRecord(record),
      };
    }

    const user = await this.userDataInstance.findUser(record.userId);
    if (!user || user.isActive !== true) {
      return { valid: false, reason: "invalid" };
    }

    const requiredScope = this.resolveRequiredScope(req);
    const grantedScopes = this._normalizeScopes(record.scopes, { allowDefault: true });
    const requiredAccess = this.resolveRequiredAccess(req);
    const grantedMode = this._normalizeMode(record.mode, { allowDefault: true, allowInvalidAsDefault: true });

    if (!this.isScopeAllowed(grantedScopes, requiredScope)) {
      return {
        valid: false,
        reason: "insufficient_scope",
        requiredScope,
        apiKey: this._toPublicRecord(record),
      };
    }

    if (!this.isModeAllowed(grantedMode, requiredAccess)) {
      return {
        valid: false,
        reason: "insufficient_mode",
        requiredAccess,
        apiKey: this._toPublicRecord(record),
      };
    }

    const lastUsedAt = new Date().toISOString();
    await this._touchLastUsed(record.id, lastUsedAt);

    return {
      valid: true,
      userId: String(user.id),
      requiredScope,
      requiredAccess,
      apiKey: this._toPublicRecord({
        ...record,
        lastUsedAt,
      }),
    };
  }

  resolveRequiredAccess(req) {
    const method = typeof req?.method === "string" ? req.method.trim().toUpperCase() : "";

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return "read";
    }

    return "write";
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

  isModeAllowed(mode, requiredAccess) {
    const normalizedMode = this._normalizeMode(mode, { allowDefault: true, allowInvalidAsDefault: true });

    if (normalizedMode === "write") {
      return true;
    }

    return requiredAccess === "read";
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
            mode: this._normalizeMode(record.mode, { allowDefault: true, allowInvalidAsDefault: true }),
            expiration: this._normalizeExpiration(record.expiration, { allowDefault: true, allowInvalidAsDefault: true }),
            expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
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

  _normalizeMode(mode, options = {}) {
    const allowDefault = options.allowDefault !== false;
    const allowInvalidAsDefault = options.allowInvalidAsDefault === true;
    const normalized = typeof mode === "string" ? mode.trim().toLowerCase() : "";

    if (!normalized) {
      if (allowDefault) {
        return DEFAULT_API_KEY_MODE;
      }

      throw new Error("Validation failed: mode is required");
    }

    if (!API_KEY_MODES.includes(normalized)) {
      if (allowDefault && allowInvalidAsDefault) {
        return DEFAULT_API_KEY_MODE;
      }

      throw new Error(`Validation failed: unsupported mode \"${mode}\"`);
    }

    return normalized;
  }

  _normalizeExpiration(expiration, options = {}) {
    const allowDefault = options.allowDefault !== false;
    const allowInvalidAsDefault = options.allowInvalidAsDefault === true;
    const normalized = typeof expiration === "string" ? expiration.trim().toLowerCase() : "";

    if (!normalized) {
      if (allowDefault) {
        return DEFAULT_EXPIRATION;
      }

      throw new Error("Validation failed: expiration is required");
    }

    if (!API_KEY_EXPIRATION_LOOKUP[normalized]) {
      if (allowDefault && allowInvalidAsDefault) {
        return DEFAULT_EXPIRATION;
      }

      throw new Error(`Validation failed: unsupported expiration \"${expiration}\"`);
    }

    return normalized;
  }

  _calculateExpiresAt(expiration, referenceTime = Date.now()) {
    const normalizedExpiration = this._normalizeExpiration(expiration, { allowDefault: true, allowInvalidAsDefault: true });
    const option = API_KEY_EXPIRATION_LOOKUP[normalizedExpiration] || API_KEY_EXPIRATION_LOOKUP[DEFAULT_EXPIRATION];

    if (!option || option.days == null) {
      return null;
    }

    const baseTime = referenceTime instanceof Date ? referenceTime.getTime() : new Date(referenceTime).getTime();
    if (!Number.isFinite(baseTime)) {
      return null;
    }

    return new Date(baseTime + option.days * DAY_IN_MS).toISOString();
  }

  _isExpired(record, referenceTime = Date.now()) {
    if (!record || typeof record.expiresAt !== "string" || record.expiresAt.trim().length === 0) {
      return false;
    }

    const expiresAtMs = new Date(record.expiresAt).getTime();
    const referenceMs = referenceTime instanceof Date ? referenceTime.getTime() : new Date(referenceTime).getTime();

    if (!Number.isFinite(expiresAtMs) || !Number.isFinite(referenceMs)) {
      return false;
    }

    return expiresAtMs <= referenceMs;
  }

  _getStatusSortWeight(record) {
    if (record?.revokedAt) {
      return 2;
    }

    if (this._isExpired(record)) {
      return 1;
    }

    return 0;
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
    const expiration = this._normalizeExpiration(record?.expiration, { allowDefault: true, allowInvalidAsDefault: true });
    const mode = this._normalizeMode(record?.mode, { allowDefault: true, allowInvalidAsDefault: true });
    const isExpired = this._isExpired(record);

    return {
      id: record.id,
      userId: Number(record.userId),
      label: record.label,
      scopes: this._normalizeScopes(record.scopes, { allowDefault: true }),
      mode,
      expiration,
      expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
      keyPreview: record.keyPreview,
      keyPrefix: record.keyPrefix,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
      regeneratedAt: record.regeneratedAt,
      revokedAt: record.revokedAt,
      isExpired,
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
module.exports.API_KEY_MODES = API_KEY_MODES;
module.exports.API_KEY_EXPIRATION_OPTIONS = API_KEY_EXPIRATION_OPTIONS;
