const dbManager = require("../data/database-manager");

const FEATURE_FLAG_DESCRIPTIONS = {
  alertsEnabled: "Enable or disable the alerts system for animals and operations",
  rolnopolMapEnabled: "Enable or disable the interactive map feature",
};

const PREDEFINED_FEATURE_FLAGS = {
  alertsEnabled: true,
  rolnopolMapEnabled: true,
};

const DEFAULT_FEATURE_FLAGS = {
  flags: {},
  updatedAt: null,
};

class FeatureFlagsService {
  constructor() {
    this.db = dbManager.getFeatureFlagsDatabase();
  }

  _isUnsafeKey(key) {
    return key === "__proto__" || key === "constructor" || key === "prototype";
  }

  _isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  _validateFlags(flags, options = {}) {
    const errors = [];
    const allowEmpty = options.allowEmpty === true;

    if (!this._isPlainObject(flags)) {
      errors.push("Flags must be an object");
    } else {
      const entries = Object.entries(flags);
      if (entries.length === 0 && !allowEmpty) {
        errors.push("At least one flag is required");
      }

      for (const [key, value] of entries) {
        if (typeof key !== "string" || key.trim().length === 0) {
          errors.push("Flag key must be a non-empty string");
          continue;
        }

        if (this._isUnsafeKey(key)) {
          errors.push(`Flag key "${key}" is not allowed`);
          continue;
        }

        if (typeof value !== "boolean") {
          errors.push(`Flag "${key}" must be a boolean`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  _sanitizeFlags(flags) {
    return this._sanitizeFlagsInternal(flags, false);
  }

  _sanitizeFlagsInternal(flags, onlyBooleans) {
    const safeFlags = {};
    for (const [key, value] of Object.entries(flags)) {
      if (this._isUnsafeKey(key)) {
        continue;
      }
      if (onlyBooleans && typeof value !== "boolean") {
        continue;
      }
      safeFlags[key] = value;
    }
    return safeFlags;
  }

  _normalize(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ...DEFAULT_FEATURE_FLAGS };
    }

    const rawFlags = this._isPlainObject(data.flags) ? data.flags : {};
    const flags = this._sanitizeFlagsInternal(rawFlags, true);
    const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : null;

    return {
      ...data,
      flags,
      updatedAt,
    };
  }

  _buildFlagsWithDescriptions(data) {
    const normalized = this._normalize(data);
    const flagsWithDescriptions = {};

    for (const [key, value] of Object.entries(normalized.flags)) {
      flagsWithDescriptions[key] = {
        value,
        description: FEATURE_FLAG_DESCRIPTIONS[key] || "",
      };
    }

    return {
      flags: flagsWithDescriptions,
      updatedAt: normalized.updatedAt,
    };
  }

  async getFeatureFlags() {
    const data = await this.db.getAll();
    return this._normalize(data);
  }

  async getFeaturesWithDescriptions() {
    const data = await this.db.getAll();
    return this._buildFlagsWithDescriptions(data);
  }

  async updateFlags(flags) {
    const validation = this._validateFlags(flags);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    const sanitizedFlags = this._sanitizeFlags(flags);

    const updated = await this.db.update((current) => {
      const normalized = this._normalize(current);
      const persistedFlags = this._sanitizeFlagsInternal(normalized.flags, true);

      // Prevent adding new flags - only allow updating existing ones
      const filteredFlags = {};
      for (const [key, value] of Object.entries(sanitizedFlags)) {
        if (key in persistedFlags) {
          filteredFlags[key] = value;
        }
      }

      return {
        flags: { ...persistedFlags, ...filteredFlags },
        updatedAt: new Date().toISOString(),
      };
    });

    return this._normalize(updated);
  }

  async replaceAllFlags(flags) {
    const validation = this._validateFlags(flags, { allowEmpty: true });
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    const sanitizedFlags = this._sanitizeFlagsInternal(flags, true);

    const next = {
      flags: { ...sanitizedFlags },
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(next);
    const data = await this.db.getAll();
    return this._normalize(data);
  }

  async resetFeatureFlags() {
    const next = {
      flags: { ...PREDEFINED_FEATURE_FLAGS },
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(next);
    const data = await this.db.getAll();
    return this._normalize(data);
  }
}

module.exports = new FeatureFlagsService();
