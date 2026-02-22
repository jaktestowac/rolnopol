const dbManager = require("../data/database-manager");
const prometheusMetrics = require("../helpers/prometheus-metrics");

const FEATURE_FLAG_DESCRIPTIONS = {
  alertsEnabled: "Enable or disable the alerts system for animals and operations",
  alertsSeverityFilterEnabled: "Enable or disable severity filter controls on the alerts page",
  rolnopolMapEnabled: "Enable or disable the interactive map feature",
  docsSearchEnabled: "Enable or disable documentation search",
  docsAdvancedSearchEnabled: "Enable or disable advanced search filters on the documentation page",
  registrationStrongPasswordEnabled: "Enable or disable strong password policy during registration",
  contactFormEnabled: "Enable or disable the contact form",
  staffFieldsExportEnabled: "Enable or disable staff/fields/animals JSON exports",
  financialReportsEnabled: "Enable or disable user financial PDF reports",
  financialCsvExportEnabled: "Enable or disable CSV export for financial transaction history",
  prometheusMetricsEnabled: "Enable or disable Prometheus metrics collection endpoint",
  homeWelcomeVideoEnabled: "Enable or disable the homepage welcome promotional video",
  homeStatsSectionEnabled: "Enable or disable advanced statistics section on the homepage",
  messengerEnabled: "Enable or disable internal messenger feature",
  cookieConsentBannerEnabled: "Enable or disable cookie consent banner shown at the bottom of pages",
  promoAdvertsHomeEnabled: "Enable or disable Rolnopol promotional popups on home/dashboard pages",
  promoAdvertsAlertsEnabled: "Enable or disable Rolnopol promotional popups on alerts pages",
};

const FEATURE_FLAG_GROUPS = {
  homepage: ["homeWelcomeVideoEnabled", "homeStatsSectionEnabled"],
  alert: ["alertsEnabled", "alertsSeverityFilterEnabled"],
  map: ["rolnopolMapEnabled"],
  documentation: ["docsSearchEnabled", "docsAdvancedSearchEnabled"],
  registration: ["registrationStrongPasswordEnabled"],
  contact: ["contactFormEnabled"],
  export: ["staffFieldsExportEnabled", "financialReportsEnabled", "financialCsvExportEnabled"],
  monitoring: ["prometheusMetricsEnabled"],
  communication: ["messengerEnabled"],
  privacy: ["cookieConsentBannerEnabled"],
  "marketing (Ads)": ["promoAdvertsHomeEnabled", "promoAdvertsAlertsEnabled"],
};

const PREDEFINED_FEATURE_FLAGS = {
  alertsEnabled: true,
  alertsSeverityFilterEnabled: true,
  rolnopolMapEnabled: true,
  docsSearchEnabled: false,
  docsAdvancedSearchEnabled: false,
  registrationStrongPasswordEnabled: false,
  contactFormEnabled: true,
  staffFieldsExportEnabled: false,
  financialReportsEnabled: false,
  financialCsvExportEnabled: false,
  prometheusMetricsEnabled: false,
  homeWelcomeVideoEnabled: false,
  homeStatsSectionEnabled: false,
  cookieConsentBannerEnabled: false,
  messengerEnabled: false,
  promoAdvertsHomeEnabled: false,
  promoAdvertsAlertsEnabled: false,
};

const DEFAULT_FEATURE_FLAGS = {
  flags: {},
  updatedAt: null,
};

class FeatureFlagsService {
  constructor() {
    this.db = dbManager.getFeatureFlagsDatabase();
  }

  _syncPrometheusMetricsToggle(flags) {
    const enabled = flags?.prometheusMetricsEnabled === true;
    prometheusMetrics.setEnabled(enabled);
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
      groups: FEATURE_FLAG_GROUPS,
      updatedAt: normalized.updatedAt,
    };
  }

  async getFeatureFlags() {
    const data = await this.db.getAll();
    const normalized = this._normalize(data);

    // If the feature flags store is empty or missing some predefined keys,
    // populate it from PREDEFINED_FEATURE_FLAGS and persist the result.
    const defaultFlags = { ...PREDEFINED_FEATURE_FLAGS };
    const existingFlags = this._isPlainObject(normalized.flags) ? normalized.flags : {};

    // Determine if any predefined key is missing or if there are no flags at all
    const missingKeys = Object.keys(defaultFlags).filter((k) => !(k in existingFlags));

    if (Object.keys(existingFlags).length === 0 || missingKeys.length > 0) {
      // Merge defaults with existing values (existing values take precedence)
      const merged = { ...defaultFlags, ...existingFlags };
      const next = { flags: merged, updatedAt: new Date().toISOString() };

      await this.db.replaceAll(next);
      const normalizedNext = this._normalize(next);
      this._syncPrometheusMetricsToggle(normalizedNext.flags);
      return normalizedNext;
    }

    this._syncPrometheusMetricsToggle(normalized.flags);
    return normalized;
  }

  async getFeaturesWithDescriptions() {
    // Ensure the flags are populated before building descriptions
    const data = await this.getFeatureFlags();
    return this._buildFlagsWithDescriptions(data);
  }

  async updateFlags(flags) {
    const validation = this._validateFlags(flags);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Only keep boolean values when merging flags
    const sanitizedFlags = this._sanitizeFlagsInternal(flags, true);

    const updated = await this.db.update((current) => {
      const normalized = this._normalize(current);
      const persistedFlags = this._sanitizeFlagsInternal(normalized.flags, true);

      // Allow adding new flags as well as updating existing ones (merge)
      const mergedFlags = { ...persistedFlags, ...sanitizedFlags };

      return {
        flags: mergedFlags,
        updatedAt: new Date().toISOString(),
      };
    });

    const normalizedUpdated = this._normalize(updated);
    this._syncPrometheusMetricsToggle(normalizedUpdated.flags);
    return normalizedUpdated;
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
    const normalizedData = this._normalize(data);
    this._syncPrometheusMetricsToggle(normalizedData.flags);
    return normalizedData;
  }

  async resetFeatureFlags() {
    const next = {
      flags: { ...PREDEFINED_FEATURE_FLAGS },
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(next);
    const data = await this.db.getAll();
    const normalizedData = this._normalize(data);
    this._syncPrometheusMetricsToggle(normalizedData.flags);
    return normalizedData;
  }
}

module.exports = new FeatureFlagsService();
