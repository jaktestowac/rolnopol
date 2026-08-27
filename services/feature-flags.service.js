const dbManager = require("../data/database-manager");
const prometheusMetrics = require("../helpers/prometheus-metrics");
const featureFlagIni = require("./feature-flag-ini.service");

const FEATURE_FLAG_DESCRIPTIONS = {
  alertsEnabled: "Enable or disable the alerts system for animals and operations",
  alertsSeverityFilterEnabled: "Enable or disable severity filter controls on the alerts page",
  alertsAiAssistantEnabled: "Enable or disable the AI alerts assistant widget on the alerts page and its public API",
  celebrationEventsEnabled: "Enable or disable celebration events on the alerts page and its public API",
  terminalPorkySplitPersonalityEnabled:
    "Enable or disable Porky's split-personality night schedule in the operator terminal when no celebration-event persona is active",
  profileAvatarUploadEnabled: "Enable or disable custom avatar uploads on the profile page",
  rolnopolMapEnabled: "Enable or disable the interactive map feature",
  docsSearchEnabled: "Enable or disable documentation search",
  docsAdvancedSearchEnabled: "Enable or disable advanced search filters on the documentation page",
  docsAiAssistantEnabled: "Enable or disable the AI documentation assistant widget on the docs page and its public API",
  registrationStrongPasswordEnabled: "Enable or disable strong password policy during registration",
  twoFactorAuthEnabled: "Enable or disable user-managed two-factor (2FA) authentication during login and on the account security page",
  contactFormEnabled: "Enable or disable the contact form",
  staffFieldsExportEnabled: "Enable or disable staff/fields/animals JSON exports",
  financialReportsEnabled: "Enable or disable user financial PDF reports",
  financialCsvExportEnabled: "Enable or disable CSV export for financial transaction history",
  financialCommoditiesEnabled: "Enable or disable commodities monitoring endpoints and UI",
  financialCommoditiesTradingEnabled:
    "Enable or disable commodities buy endpoint and trading UI actions (Requires financialCommoditiesEnabled to be enabled)",
  financialCommoditiesMarketDeskEnabled:
    "Enable or disable the Market desk on the commodities page: an embedded same-origin ticker iframe with a nested frame, plus the shadow-DOM converter and spread badge (Requires financialCommoditiesEnabled to be enabled)",
  prometheusMetricsEnabled: "Enable or disable Prometheus metrics collection endpoint /api/v1/metrics",
  homeWelcomeVideoEnabled: "Enable or disable the homepage welcome promotional video",
  homeStatsSectionEnabled: "Enable or disable advanced statistics section on the homepage",
  homeModernRestyleEnabled: "Enable or disable modern redesigned homepage layout and styling",
  homeInstrumentalityRestyleEnabled: "Enable or disable the Instrumentality-inspired homepage layout and styling",
  messengerEnabled: "Enable or disable internal messenger feature",
  assistantChatEnabled: "Enable or disable AI assistant chat modal and API for authenticated users",
  notificationCenterEnabled: "Enable or disable event-driven multi-channel notification center module",
  weatherPageEnabled: "Enable or disable weather module API and weather page visibility",
  weatherWeatherDataExport: "Enable or disable anonymous weather data export (CSV and PDF) without personalized user insights",
  weatherUserInsightsEnabled: "Enable or disable personalized weather insights panel for authenticated users",
  weatherTrendChartEnabled: "Enable or disable compact trend chart with temperature, humidity, and wind on weather page",
  weatherLiveStreamEnabled:
    "Enable or disable the public Weather Live conditions & alerts page, its nav link, and the Server-Sent Events (SSE) stream endpoints",
  personalApiKeysEnabled: "Enable or disable personal API keys for user-managed integrations",
  integrationsWebhooksEnabled: "Enable or disable user-managed webhook integrations and delivery activity logs",
  cookieConsentBannerEnabled: "Enable or disable cookie consent banner shown at the bottom of pages",
  promoAdvertsHomeEnabled: "Enable or disable Rolnopol promotional popups on home/dashboard pages",
  promoAdvertsAlertsEnabled: "Enable or disable Rolnopol promotional popups on alerts pages",
  promoAdvertsGeneralAdEnabled: "Enable or disable Rolnopol promotional popups on any general page",
  promoAdvertsBottomBannerEnabled: "Enable or disable Rolnopol promotional banner fixed at the bottom of pages",
  petBuddyEnabled: "Enable or disable the pet buddy companion system",
  rolnopolFarmlogEnabled: "Enable or disable the Rolnopol Blog Space (Farmlog) feature",
  rolnopolFarmlogEngagementEnabled: "Enable or disable Farmlog likes, favorites, and most-liked post ranking",
  taskManagerEnabled: "Enable or disable the user task manager module",
  taskLabEnabled:
    "Enable or disable the TaskLab module (gRPC client to the standalone TaskLab service, REST API, and dashboard) for logged-in users",
  greenhouseControlRoomEnabled:
    "Enable or disable the greenhouse control room module (gRPC client to the standalone greenhouse service, REST API, and dashboard)",
  farmStayEnabled: "Enable or disable the FarmStay module (gRPC client to the standalone FarmStay service, REST API, and dashboard)",
  agriAcademyEnabled:
    "Enable or disable the AgriAcademy module (HTTP client to the standalone AgriAcademy exam-center and authoring gateways, REST API, and pages) for logged-in users",
  observatoryEnabled:
    "Enable or disable the Observatory sky-dome page with stars and constellations tracking, and the observatory REST/SSE endpoints (public, no login required)",
  crewOfficeEnabled:
    "Enable or disable the whole Crew Office module (GraphQL crew management over the existing staff records — pages, graph endpoint, module-owned stores, and all four pillars: work, holidays, training, tools) for logged-in users only",
  survivalGameEnabled:
    "Enable or disable Rolnopol Survival (the hex survival game page and its expedition-record REST API) for logged-in users only",
};

const FEATURE_FLAG_GROUPS = {
  homepage: ["homeWelcomeVideoEnabled", "homeStatsSectionEnabled", "homeModernRestyleEnabled", "homeInstrumentalityRestyleEnabled"],
  alert: ["alertsEnabled", "alertsSeverityFilterEnabled", "alertsAiAssistantEnabled", "celebrationEventsEnabled"],
  profile: ["profileAvatarUploadEnabled"],
  map: ["rolnopolMapEnabled"],
  documentation: ["docsSearchEnabled", "docsAdvancedSearchEnabled", "docsAiAssistantEnabled"],
  registration: ["registrationStrongPasswordEnabled"],
  security: ["twoFactorAuthEnabled"],
  contact: ["contactFormEnabled"],
  export: ["staffFieldsExportEnabled", "financialReportsEnabled", "financialCsvExportEnabled", "weatherWeatherDataExport"],
  financial: ["financialCommoditiesEnabled", "financialCommoditiesTradingEnabled", "financialCommoditiesMarketDeskEnabled"],
  monitoring: ["prometheusMetricsEnabled"],
  communication: ["messengerEnabled", "assistantChatEnabled", "terminalPorkySplitPersonalityEnabled"],
  notifications: ["notificationCenterEnabled"],
  weather: [
    "weatherPageEnabled",
    "weatherWeatherDataExport",
    "weatherUserInsightsEnabled",
    "weatherTrendChartEnabled",
    "weatherLiveStreamEnabled",
  ],
  integrations: ["personalApiKeysEnabled", "integrationsWebhooksEnabled"],
  privacy: ["cookieConsentBannerEnabled"],
  "marketing (Ads)": [
    "promoAdvertsHomeEnabled",
    "promoAdvertsAlertsEnabled",
    "promoAdvertsGeneralAdEnabled",
    "promoAdvertsBottomBannerEnabled",
  ],
  gameplay: ["petBuddyEnabled"],
  farmlog: ["rolnopolFarmlogEnabled", "rolnopolFarmlogEngagementEnabled"],
  productivity: ["taskManagerEnabled", "taskLabEnabled"],
  greenhouse: ["greenhouseControlRoomEnabled"],
  farmStay: ["farmStayEnabled"],
  agriAcademy: ["agriAcademyEnabled"],
  observatory: ["observatoryEnabled"],
  crewOffice: ["crewOfficeEnabled"],
  survival: ["survivalGameEnabled"],
};

const EXPERIMENTAL_FEATURE_FLAGS = [
  "homeStatsSectionEnabled",
  "homeModernRestyleEnabled",
  "homeInstrumentalityRestyleEnabled",
  "profileAvatarUploadEnabled",
  "docsSearchEnabled",
  "docsAdvancedSearchEnabled",
  "docsAiAssistantEnabled",
  "alertsAiAssistantEnabled",
  "celebrationEventsEnabled",
  "terminalPorkySplitPersonalityEnabled",
  "profileAvatarUploadEnabled",
  "registrationStrongPasswordEnabled",
  "twoFactorAuthEnabled",
  "financialCommoditiesEnabled",
  "financialCommoditiesTradingEnabled",
  "financialCommoditiesMarketDeskEnabled",
  "prometheusMetricsEnabled",
  "messengerEnabled",
  "assistantChatEnabled",
  "notificationCenterEnabled",
  "weatherUserInsightsEnabled",
  "weatherTrendChartEnabled",
  "weatherLiveStreamEnabled",
  "personalApiKeysEnabled",
  "integrationsWebhooksEnabled",
  "promoAdvertsHomeEnabled",
  "promoAdvertsAlertsEnabled",
  "promoAdvertsGeneralAdEnabled",
  "promoAdvertsBottomBannerEnabled",
  "petBuddyEnabled",
  "rolnopolFarmlogEnabled",
  "rolnopolFarmlogEngagementEnabled",
  "taskManagerEnabled",
  "taskLabEnabled",
  "greenhouseControlRoomEnabled",
  "farmStayEnabled",
  "agriAcademyEnabled",
  "observatoryEnabled",
  "crewOfficeEnabled",
  "survivalGameEnabled",
];

const PREDEFINED_FEATURE_FLAGS = {
  alertsEnabled: true,
  alertsSeverityFilterEnabled: true,
  alertsAiAssistantEnabled: false,
  celebrationEventsEnabled: false,
  terminalPorkySplitPersonalityEnabled: false,
  profileAvatarUploadEnabled: false,
  rolnopolMapEnabled: true,
  docsSearchEnabled: false,
  docsAdvancedSearchEnabled: false,
  docsAiAssistantEnabled: false,
  registrationStrongPasswordEnabled: false,
  twoFactorAuthEnabled: false,
  contactFormEnabled: true,
  staffFieldsExportEnabled: false,
  financialReportsEnabled: false,
  financialCsvExportEnabled: false,
  financialCommoditiesEnabled: false,
  financialCommoditiesTradingEnabled: false,
  financialCommoditiesMarketDeskEnabled: false,
  prometheusMetricsEnabled: false,
  homeWelcomeVideoEnabled: false,
  homeStatsSectionEnabled: false,
  homeModernRestyleEnabled: false,
  homeInstrumentalityRestyleEnabled: false,
  cookieConsentBannerEnabled: false,
  messengerEnabled: false,
  assistantChatEnabled: false,
  notificationCenterEnabled: false,
  weatherPageEnabled: false,
  weatherWeatherDataExport: false,
  weatherUserInsightsEnabled: false,
  weatherTrendChartEnabled: false,
  weatherLiveStreamEnabled: false,
  personalApiKeysEnabled: false,
  integrationsWebhooksEnabled: false,
  promoAdvertsHomeEnabled: false,
  promoAdvertsAlertsEnabled: false,
  promoAdvertsGeneralAdEnabled: false,
  promoAdvertsBottomBannerEnabled: false,
  petBuddyEnabled: false,
  rolnopolFarmlogEnabled: false,
  rolnopolFarmlogEngagementEnabled: false,
  taskManagerEnabled: false,
  taskLabEnabled: false,
  greenhouseControlRoomEnabled: false,
  farmStayEnabled: false,
  agriAcademyEnabled: false,
  observatoryEnabled: false,
  crewOfficeEnabled: false,
  survivalGameEnabled: true,
};

const DEFAULT_FEATURE_FLAGS = {
  flags: {},
  updatedAt: null,
};

// Thrown by write paths when the payload tries to change a flag pinned by
// feature-flags.ini. The controller maps this to HTTP 409.
const PINNED_FLAG_ERROR_CODE = "FEATURE_FLAG_PINNED";

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

  /**
   * Apply feature-flags.ini overrides on top of already-resolved flag values.
   * The INI file is the highest authority in the precedence chain:
   *   PREDEFINED_FEATURE_FLAGS -> data/feature-flags.json -> feature-flags.ini
   *
   * Synchronous on purpose: the INI content is parsed once at startup, so
   * callers that only have the raw JSON store at hand (see api/index.js) can
   * resolve effective values without going through the async read path.
   *
   * @param {Object} flags raw/stored flag values
   * @returns {Object} effective flag values
   */
  applyIniOverrides(flags) {
    const effective = this._isPlainObject(flags) ? { ...flags } : {};

    for (const [key, value] of Object.entries(featureFlagIni.getEnforcedOverrides())) {
      if (this._isUnsafeKey(key) || typeof value !== "boolean") {
        continue;
      }
      effective[key] = value;
    }

    return effective;
  }

  /**
   * Wrap a resolved store payload with its effective (INI-overridden) values,
   * keeping the persisted values available as `storedFlags` so callers can show
   * what the store would say without the file.
   */
  _withIniOverrides(resolved) {
    const storedFlags = this._isPlainObject(resolved?.flags) ? resolved.flags : {};

    return {
      ...resolved,
      flags: this.applyIniOverrides(storedFlags),
      storedFlags,
      overrides: this.getIniOverrideReport(),
    };
  }

  /**
   * What feature-flags.ini is currently doing, enriched with the keys it
   * declares that are not known feature flags. Safe to expose over the API.
   */
  getIniOverrideReport() {
    const report = featureFlagIni.getReport();
    const unknownKeys = report.declaredKeys.filter((key) => !(key in PREDEFINED_FEATURE_FLAGS));

    // An unknown flag name is the last problem kind, and only this layer knows
    // which names are real. It is a warning, not a rejection: the value is still
    // applied so a flag added in a later release can be configured up front.
    const problems = [
      ...report.problems,
      ...unknownKeys.map((key) => ({
        kind: "unknown-flag",
        key,
        message: `"${key}" is not a known feature flag — it is applied anyway, check the spelling`,
      })),
    ];

    return { ...report, unknownKeys, problems, hasProblems: problems.length > 0 };
  }

  /**
   * Reject a write that would change a flag pinned by an enforcing INI file.
   * Writes that repeat the pinned value are allowed through so that idempotent
   * bulk updates (e.g. the admin page restoring a full flag set) still work.
   */
  _assertNoPinnedConflicts(flags) {
    if (!this._isPlainObject(flags)) {
      return;
    }

    const conflicts = [];
    for (const [key, value] of Object.entries(flags)) {
      if (typeof value !== "boolean" || !featureFlagIni.isPinned(key)) {
        continue;
      }
      const pinnedValue = featureFlagIni.getPinnedValue(key);
      if (pinnedValue !== value) {
        conflicts.push({ key, pinnedValue, requestedValue: value });
      }
    }

    if (conflicts.length === 0) {
      return;
    }

    const details = conflicts.map((conflict) => `${conflict.key} (pinned to ${conflict.pinnedValue})`).join(", ");
    const error = new Error(
      `Pinned by ${featureFlagIni.getReport().source}: ${details}. Edit the file and restart the app to change these flags.`,
    );
    error.code = PINNED_FLAG_ERROR_CODE;
    error.conflicts = conflicts;
    throw error;
  }

  _buildFlagsWithDescriptions(data) {
    const normalized = this._normalize(data);
    const storedFlags = this._isPlainObject(data?.storedFlags) ? data.storedFlags : normalized.flags;
    const overrides = this._isPlainObject(data?.overrides) ? data.overrides : this.getIniOverrideReport();
    const flagsWithDescriptions = {};

    for (const [key, value] of Object.entries(normalized.flags)) {
      const entry = {
        value,
        description: FEATURE_FLAG_DESCRIPTIONS[key] || "",
      };

      if (featureFlagIni.isPinned(key)) {
        entry.overriddenBy = overrides.source;
        entry.storedValue = Object.prototype.hasOwnProperty.call(storedFlags, key) ? storedFlags[key] : null;
      }

      flagsWithDescriptions[key] = entry;
    }

    return {
      flags: flagsWithDescriptions,
      experimentalFlags: EXPERIMENTAL_FEATURE_FLAGS.filter((flag) => flag in normalized.flags),
      groups: FEATURE_FLAG_GROUPS,
      updatedAt: normalized.updatedAt,
      overrides,
    };
  }

  async getFeatureFlags() {
    const data = await this.db.getAll();
    const normalized = this._normalize(data);

    // If the feature flags store is empty or missing some predefined keys,
    // populate it from PREDEFINED_FEATURE_FLAGS and persist the result.
    const defaultFlags = { ...PREDEFINED_FEATURE_FLAGS };
    const existingFlags = this._isPlainObject(normalized.flags) ? normalized.flags : {};

    const experimentalFlags = EXPERIMENTAL_FEATURE_FLAGS.filter((flag) => flag in defaultFlags);
    normalized.experimentalFlags = experimentalFlags;

    // Determine if any predefined key is missing or if there are no flags at all
    const missingKeys = Object.keys(defaultFlags).filter((k) => !(k in existingFlags));

    let resolved = normalized;

    if (Object.keys(existingFlags).length === 0 || missingKeys.length > 0) {
      // Merge defaults with existing values (existing values take precedence)
      const merged = { ...defaultFlags, ...existingFlags };

      const next = { flags: merged, updatedAt: new Date().toISOString() };

      await this.db.replaceAll(next);
      resolved = this._normalize(next);
      resolved.experimentalFlags = experimentalFlags;
    }

    // feature-flags.ini wins over the persisted store on every read.
    const effective = this._withIniOverrides(resolved);
    this._syncPrometheusMetricsToggle(effective.flags);
    return effective;
  }

  /**
   * The boot step for feature-flags.ini: report anything wrong with the file,
   * seed the store from it, and describe what it overrode. Called once from
   * api/index.js before the app starts serving requests.
   *
   * Loggers are injected so this is testable and so the caller decides which log
   * channel the messages land in. It NEVER throws and NEVER rejects — a broken
   * configuration file must not be able to stop the app from starting.
   *
   * @param {Object} loggers
   * @param {Function} loggers.logWarning
   * @param {Function} [loggers.logDebug]
   * @returns {Promise<{applied: boolean, changed: Array, report: Object}>}
   */
  async applyIniOverridesAtBoot({ logWarning, logDebug } = {}) {
    const warn = typeof logWarning === "function" ? logWarning : () => {};
    const debug = typeof logDebug === "function" ? logDebug : () => {};

    let report = null;
    try {
      report = this.getIniOverrideReport();

      if (report.hasProblems) {
        warn(
          `🟡 [${report.source}] ${report.problems.length} problem(s) found — the app is starting normally, applying the valid entries only`,
        );
        for (const problem of report.problems) {
          warn(`🟡 [${report.source}] ${problem.message}`);
        }
      }

      if (!report.active) {
        debug(`[${report.source}] not applied`, {
          exists: report.exists,
          mode: report.mode,
          skippedReason: report.skippedReason,
        });
        return { applied: false, changed: [], report };
      }

      const seed = await this.seedStoreFromIni();

      warn(`🧰 [${report.source}] active (mode: ${report.mode}) — ${report.count} flag(s) overridden: ${report.keys.join(", ")}`);
      for (const change of seed.changed) {
        warn(`🧰 [${report.source}] ${change.key}: ${change.from === null ? "(unset)" : change.from} -> ${change.to}`);
      }
      if (report.enforcing) {
        warn(`🧰 [${report.source}] these flags are pinned — edit the file and restart the app to change them`);
      }

      return seed;
    } catch (error) {
      // Boot continues regardless: the app simply runs on its stored flags.
      warn(`🟡 [feature-flags.ini] could not be applied, continuing with the stored feature flags`, {
        error: error instanceof Error ? error.message : error,
      });
      return { applied: false, changed: [], report };
    }
  }

  /**
   * Merge feature-flags.ini values into the JSON store. Called once at boot so
   * the persisted file agrees with the effective configuration; the read-through
   * layer keeps enforcing them afterwards.
   *
   * @returns {Promise<{applied: boolean, changed: Array<{key: string, from: boolean|null, to: boolean}>, report: Object}>}
   */
  async seedStoreFromIni() {
    const overrides = featureFlagIni.getSeedOverrides();
    const report = this.getIniOverrideReport();

    if (Object.keys(overrides).length === 0) {
      return { applied: false, changed: [], report };
    }

    // Resolve first so every predefined key exists before we diff.
    const resolved = await this.getFeatureFlags();
    const stored = this._sanitizeFlagsInternal(this._isPlainObject(resolved.storedFlags) ? resolved.storedFlags : resolved.flags, true);

    const changed = [];
    const nextFlags = { ...stored };

    for (const [key, value] of Object.entries(overrides)) {
      if (this._isUnsafeKey(key) || typeof value !== "boolean") {
        continue;
      }
      const previous = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
      if (previous !== value) {
        changed.push({ key, from: previous, to: value });
      }
      nextFlags[key] = value;
    }

    if (changed.length > 0) {
      await this.db.replaceAll({ flags: nextFlags, updatedAt: new Date().toISOString() });
    }

    return { applied: true, changed, report };
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
    this._assertNoPinnedConflicts(sanitizedFlags);

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

    const normalizedUpdated = this._withIniOverrides(this._normalize(updated));
    this._syncPrometheusMetricsToggle(normalizedUpdated.flags);
    return normalizedUpdated;
  }

  async replaceAllFlags(flags) {
    const validation = this._validateFlags(flags, { allowEmpty: true });
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    const sanitizedFlags = this._sanitizeFlagsInternal(flags, true);
    this._assertNoPinnedConflicts(sanitizedFlags);

    const next = {
      flags: { ...sanitizedFlags },
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(next);
    const data = await this.db.getAll();
    const normalizedData = this._withIniOverrides(this._normalize(data));
    this._syncPrometheusMetricsToggle(normalizedData.flags);
    return normalizedData;
  }

  // Resets the persisted store to the predefined defaults. feature-flags.ini
  // sits above the store, so pinned flags keep their file value afterwards.
  async resetFeatureFlags() {
    const next = {
      flags: { ...PREDEFINED_FEATURE_FLAGS },
      updatedAt: new Date().toISOString(),
    };

    await this.db.replaceAll(next);
    const data = await this.db.getAll();
    const normalizedData = this._withIniOverrides(this._normalize(data));
    this._syncPrometheusMetricsToggle(normalizedData.flags);
    return normalizedData;
  }
}

module.exports = new FeatureFlagsService();
module.exports.PINNED_FLAG_ERROR_CODE = PINNED_FLAG_ERROR_CODE;
module.exports.PREDEFINED_FEATURE_FLAGS = PREDEFINED_FEATURE_FLAGS;
