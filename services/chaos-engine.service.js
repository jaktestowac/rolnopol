const dbManager = require("../data/database-manager");
const {
  CHAOS_ENGINE_DEFAULT_SCOPE,
  CHAOS_ENGINE_DEFAULT_CUSTOM_CONFIG,
  CHAOS_ENGINE_DEFAULT_DATA,
} = require("../data/chaos-engine.defaults");

const ALLOWED_MODES = ["off", "custom", "level1", "level2", "level3", "level4", "level5"];
// modes supported by the middleware when responseLoss.enabled is true
// * timeout  - return a 504 after a configurable delay (existing behaviour)
// * drop     - immediately destroy the socket (simulates TCP RST/connection reset)
// * partial  - write part of a body and then kill the socket mid-stream
// * reset    - alias for `drop` (matches newer terminology)
const ALLOWED_LOSS_MODES = ["timeout", "drop", "partial", "reset"];
const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const DEFAULT_SCOPE = CHAOS_ENGINE_DEFAULT_SCOPE;
const DEFAULT_CUSTOM_CONFIG = CHAOS_ENGINE_DEFAULT_CUSTOM_CONFIG;

const PRESET_DEFINITIONS = {
  off: {
    label: "Off",
    description: "No perturbation. API behaves normally.",
    config: {
      enabled: false,
      latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
      responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1000 },
      errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "Synthetic chaos error" },
      stateful: { enabled: false, requestCount: 0 },
      mirroring: { enabled: false, probability: 0, targetUrl: "" },
      scope: DEFAULT_SCOPE,
    },
  },
  custom: {
    label: "Custom",
    description: "User-defined chaos parameters.",
    config: DEFAULT_CUSTOM_CONFIG,
  },
  level1: {
    label: "Level 1 - Gentle",
    description: "Mild latency and rare errors.",
    config: {
      enabled: true,
      latency: { enabled: true, probability: 0.2, minMs: 40, maxMs: 150 },
      responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
      errorInjection: { enabled: true, probability: 0.01, statusCodes: [500], message: "Chaos L1: synthetic error" },
      scope: DEFAULT_SCOPE,
    },
  },
  level2: {
    label: "Level 2 - Choppy",
    description: "Noticeable latency, occasional failures.",
    config: {
      enabled: true,
      latency: { enabled: true, probability: 0.35, minMs: 90, maxMs: 300 },
      responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1400 },
      errorInjection: { enabled: true, probability: 0.03, statusCodes: [500, 502], message: "Chaos L2: injected server fault" },
      scope: DEFAULT_SCOPE,
    },
  },
  level3: {
    label: "Level 3 - Turbulent",
    description: "Frequent latency spikes and random faults.",
    config: {
      enabled: true,
      latency: { enabled: true, probability: 0.5, minMs: 150, maxMs: 650 },
      responseLoss: { enabled: true, probability: 0.02, mode: "timeout", timeoutMs: 1800 },
      errorInjection: { enabled: true, probability: 0.07, statusCodes: [500, 502, 503], message: "Chaos L3: simulated outage pocket" },
      scope: DEFAULT_SCOPE,
    },
  },
  level4: {
    label: "Level 4 - Severe",
    description: "Heavy disruption with response loss.",
    config: {
      enabled: true,
      latency: { enabled: true, probability: 0.7, minMs: 250, maxMs: 1200 },
      responseLoss: { enabled: true, probability: 0.06, mode: "timeout", timeoutMs: 2200 },
      errorInjection: {
        enabled: true,
        probability: 0.12,
        statusCodes: [500, 502, 503, 504],
        message: "Chaos L4: severe synthetic instability",
      },
      scope: DEFAULT_SCOPE,
    },
  },
  level5: {
    label: "Level 5 - Mayhem",
    description: "Maximum chaos with drops, errors, and large delay jitter.",
    config: {
      enabled: true,
      latency: { enabled: true, probability: 0.85, minMs: 400, maxMs: 2200 },
      // level5 ramps up to full-drop; keep ``drop`` here but it's now one of several
      // loss modes.  other presets may be configured manually via API/UI later.
      responseLoss: { enabled: true, probability: 0.12, mode: "drop", timeoutMs: 2500 },
      errorInjection: {
        enabled: true,
        probability: 0.2,
        statusCodes: [500, 502, 503, 504],
        message: "Chaos L5: complete synthetic disorder",
      },
      scope: DEFAULT_SCOPE,
    },
  },
};

const DEFAULT_DATA = CHAOS_ENGINE_DEFAULT_DATA;

class ChaosEngineService {
  constructor() {
    this.db = dbManager.getChaosEngineDatabase();
    // Configuration caching with TTL
    this.configCache = null;
    this.configCacheTimestamp = 0;
    this.CACHE_TTL_MS = 10000;  // Cache for 10s to reduce disk reads
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _validateRegexPattern(pattern) {
    const str = String(pattern || "");
    
    // Reject obvious ReDoS patterns
    const dangerousPatterns = [
      /\(\w\+\)\+/,        // (a+)+ - nested quantifiers
      /\(\w\*\)\+/,        // (a*)+ - nested quantifiers
      /\w\+\w\+/,          // a+b+ - multiple quantified groups
      /\+\+/,              // ++ - double quantifier
      /\*\+/,              // *+ - conflicting quantifiers
      /\+\*/,              // +* - conflicting quantifiers
    ];
    
    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(str)) {
        throw new Error(`Regex pattern may cause ReDoS: ${str}`);
      }
    }
    
    // Limit pattern length to prevent DoS
    if (str.length > 500) {
      throw new Error("Regex pattern too long (max 500 chars)");
    }
  }

  _isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  _toBoolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
  }

  _clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  _sanitizeStatusCodes(codes, fallback) {
    if (!Array.isArray(codes)) {
      return this._clone(fallback);
    }

    const parsed = codes.map((code) => Number(code)).filter((code) => Number.isInteger(code) && code >= 400 && code <= 599);

    if (parsed.length === 0) {
      return this._clone(fallback);
    }

    return [...new Set(parsed)];
  }

  _sanitizeMethods(methods, fallback) {
    if (!Array.isArray(methods)) {
      return this._clone(fallback);
    }

    const parsed = methods
      .map((method) =>
        String(method || "")
          .toUpperCase()
          .trim(),
      )
      .filter((method) => ALLOWED_METHODS.includes(method));

    if (parsed.length === 0) {
      return this._clone(fallback);
    }

    return [...new Set(parsed)];
  }

  _sanitizePaths(paths, fallback) {
    // paths must be an array if provided; explicit empty arrays are allowed
    if (!Array.isArray(paths)) {
      return this._clone(fallback);
    }

    const parsed = paths
      .map((path) => String(path || "").trim())
      .filter((path) => path.length > 0)
      .map((path) => {
        // Validate pattern before using to prevent ReDoS
        this._validateRegexPattern(path);
        return path.startsWith("/") ? path : `/${path}`;
      });

    // unlike before we no longer fall back when user intentionally supplies []
    // return a clone of the sanitized list (might be empty)
    return [...new Set(parsed)];
  }

  _sanitizeStringArray(arr, fallback) {
    if (!Array.isArray(arr)) {
      return this._clone(fallback);
    }
    const parsed = arr
      .map((item) => {
        const str = String(item || "").trim();
        // Validate patterns in array to prevent ReDoS
        if (str.length > 0) {
          this._validateRegexPattern(str);
        }
        return str;
      })
      .filter((item) => item.length > 0);
    if (parsed.length === 0) {
      return this._clone(fallback);
    }
    return [...new Set(parsed)];
  }

  _sanitizeKeyValueMap(map, fallback) {
    if (!this._isPlainObject(map)) {
      return this._clone(fallback);
    }
    const out = {};
    for (const [key, val] of Object.entries(map)) {
      const k = String(key || "").trim();
      if (k === "") continue;
      out[k] = String(val || "");
    }
    if (Object.keys(out).length === 0) {
      return this._clone(fallback);
    }
    return out;
  }

  _sanitizeConfig(inputConfig = {}, fallbackConfig = DEFAULT_CUSTOM_CONFIG) {
    const source = this._isPlainObject(inputConfig) ? inputConfig : {};
    const fallback = this._isPlainObject(fallbackConfig) ? fallbackConfig : DEFAULT_CUSTOM_CONFIG;

    const latencySource = this._isPlainObject(source.latency) ? source.latency : {};
    const latencyFallback = fallback.latency || DEFAULT_CUSTOM_CONFIG.latency;
    let minMs = this._clamp(latencySource.minMs, 0, 30000, latencyFallback.minMs);
    let maxMs = this._clamp(latencySource.maxMs, 0, 30000, latencyFallback.maxMs);
    if (minMs > maxMs) {
      const tmp = minMs;
      minMs = maxMs;
      maxMs = tmp;
    }

    const responseLossSource = this._isPlainObject(source.responseLoss) ? source.responseLoss : {};
    const responseLossFallback = fallback.responseLoss || DEFAULT_CUSTOM_CONFIG.responseLoss;
    const responseLossMode = String(responseLossSource.mode || responseLossFallback.mode || "timeout").toLowerCase();

    const errorSource = this._isPlainObject(source.errorInjection) ? source.errorInjection : {};
    const errorFallback = fallback.errorInjection || DEFAULT_CUSTOM_CONFIG.errorInjection;

    const statefulSource = this._isPlainObject(source.stateful) ? source.stateful : {};
    const statefulFallback = fallback.stateful || DEFAULT_CUSTOM_CONFIG.stateful;

    const mirroringSource = this._isPlainObject(source.mirroring) ? source.mirroring : {};
    const mirroringFallback = fallback.mirroring || DEFAULT_CUSTOM_CONFIG.mirroring;

    const scopeSource = this._isPlainObject(source.scope) ? source.scope : {};
    const scopeFallback = fallback.scope || DEFAULT_SCOPE;

    const percentOfTraffic = this._clamp(scopeSource.percentOfTraffic, 0, 100, scopeFallback.percentOfTraffic || 100);

    return {
      enabled: this._toBoolean(source.enabled, fallback.enabled),
      latency: {
        enabled: this._toBoolean(latencySource.enabled, latencyFallback.enabled),
        probability: this._clamp(latencySource.probability, 0, 1, latencyFallback.probability),
        minMs,
        maxMs,
      },
      responseLoss: {
        enabled: this._toBoolean(responseLossSource.enabled, responseLossFallback.enabled),
        probability: this._clamp(responseLossSource.probability, 0, 1, responseLossFallback.probability),
        mode: ALLOWED_LOSS_MODES.includes(responseLossMode) ? responseLossMode : responseLossFallback.mode,
        timeoutMs: this._clamp(responseLossSource.timeoutMs, 100, 120000, responseLossFallback.timeoutMs),
      },
      errorInjection: {
        enabled: this._toBoolean(errorSource.enabled, errorFallback.enabled),
        probability: this._clamp(errorSource.probability, 0, 1, errorFallback.probability),
        statusCodes: this._sanitizeStatusCodes(errorSource.statusCodes, errorFallback.statusCodes),
        randomStatus: this._toBoolean(errorSource.randomStatus, errorFallback.randomStatus),
        message: String(errorSource.message || errorFallback.message || "Synthetic chaos error").slice(0, 400),
      },
      stateful: {
        enabled: this._toBoolean(statefulSource.enabled, statefulFallback.enabled),
        requestCount: this._clamp(statefulSource.requestCount, 0, 100000, statefulFallback.requestCount),
      },
      mirroring: {
        enabled: this._toBoolean(mirroringSource.enabled, mirroringFallback.enabled),
        probability: this._clamp(mirroringSource.probability, 0, 1, mirroringFallback.probability),
        targetUrl: String(mirroringSource.targetUrl || mirroringFallback.targetUrl || "").trim(),
      },
      scope: {
        methods: this._sanitizeMethods(scopeSource.methods, scopeFallback.methods || DEFAULT_SCOPE.methods),
        excludePaths: this._sanitizePaths(scopeSource.excludePaths, scopeFallback.excludePaths || DEFAULT_SCOPE.excludePaths),
        includePaths: this._sanitizePaths(scopeSource.includePaths, scopeFallback.includePaths || DEFAULT_SCOPE.includePaths),
        queryParams: this._sanitizeKeyValueMap(scopeSource.queryParams, scopeFallback.queryParams || {}),
        headers: this._sanitizeKeyValueMap(scopeSource.headers, scopeFallback.headers || {}),
        hostnames: this._sanitizeStringArray(scopeSource.hostnames, scopeFallback.hostnames || DEFAULT_SCOPE.hostnames),
        roles: this._sanitizeStringArray(scopeSource.roles, scopeFallback.roles || DEFAULT_SCOPE.roles),
        ipRanges: this._sanitizeStringArray(scopeSource.ipRanges, scopeFallback.ipRanges || DEFAULT_SCOPE.ipRanges),
        geolocation: this._sanitizeStringArray(scopeSource.geolocation, scopeFallback.geolocation || DEFAULT_SCOPE.geolocation),
        percentOfTraffic,
      },
    };
  }

  _normalizeData(rawData) {
    const source = this._isPlainObject(rawData) ? rawData : {};
    const modeRaw = String(source.mode || DEFAULT_DATA.mode).toLowerCase();
    const mode = ALLOWED_MODES.includes(modeRaw) ? modeRaw : "off";

    const customSource = this._isPlainObject(source.customConfig) ? source.customConfig : DEFAULT_CUSTOM_CONFIG;
    const customConfig = this._sanitizeConfig(customSource, DEFAULT_CUSTOM_CONFIG);

    return {
      mode,
      customConfig,
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    };
  }

  _resolveConfig(mode, customConfig) {
    if (mode === "custom") {
      return this._sanitizeConfig(customConfig, DEFAULT_CUSTOM_CONFIG);
    }

    const preset = PRESET_DEFINITIONS[mode] || PRESET_DEFINITIONS.off;
    return this._sanitizeConfig(preset.config, preset.config);
  }

  _buildPresetsView() {
    const out = {};
    for (const mode of ALLOWED_MODES) {
      const preset = PRESET_DEFINITIONS[mode];
      out[mode] = {
        label: preset.label,
        description: preset.description,
      };
    }
    return out;
  }

  _validatePayload(payload, options = {}) {
    const errors = [];
    const source = this._isPlainObject(payload) ? payload : null;

    if (!source) {
      errors.push("Payload must be an object");
    } else {
      if (Object.prototype.hasOwnProperty.call(source, "mode")) {
        const mode = String(source.mode || "").toLowerCase();
        if (!ALLOWED_MODES.includes(mode)) {
          errors.push(`Unsupported mode: ${source.mode}`);
        }
      }

      if (Object.prototype.hasOwnProperty.call(source, "customConfig") && !this._isPlainObject(source.customConfig)) {
        errors.push("customConfig must be an object");
      }

      const requireMode = options.requireMode === true;
      if (requireMode && !Object.prototype.hasOwnProperty.call(source, "mode")) {
        errors.push("mode is required");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async _persistNormalized(nextData) {
    const normalized = this._normalizeData(nextData);
    const payload = {
      ...normalized,
      updatedAt: new Date().toISOString(),
    };
    await this.db.replaceAll(payload);
    return this._normalizeData(payload);
  }

  _toPublicPayload(normalized) {
    const resolvedConfig = this._resolveConfig(normalized.mode, normalized.customConfig);
    return {
      mode: normalized.mode,
      config: resolvedConfig,
      customConfig: normalized.customConfig,
      presets: this._buildPresetsView(),
      updatedAt: normalized.updatedAt,
    };
  }

  async getChaosEngineConfig() {
    const now = Date.now();
    
    // Check if cache is still valid
    if (
      this.configCache !== null &&
      (now - this.configCacheTimestamp) < this.CACHE_TTL_MS
    ) {
      // Cache hit - return cached data
      return this.configCache;
    }

    // Cache miss - read from database
    const data = await this.db.getAll();
    const normalized = this._normalizeData(data);
    const result = this._toPublicPayload(normalized);
    
    // Update cache
    this.configCache = result;
    this.configCacheTimestamp = now;
    
    return result;
  }

  _invalidateCache() {
    this.configCache = null;
    this.configCacheTimestamp = 0;
  }

  async getRuntimeConfig() {
    const data = await this.db.getAll();
    const normalized = this._normalizeData(data);
    return this._resolveConfig(normalized.mode, normalized.customConfig);
  }

  async patchChaosEngineConfig(payload) {
    const validation = this._validatePayload(payload);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    const currentRaw = await this.db.getAll();
    const current = this._normalizeData(currentRaw);

    const mode = Object.prototype.hasOwnProperty.call(payload, "mode") ? String(payload.mode).toLowerCase() : current.mode;

    let customConfig;
    if (Object.prototype.hasOwnProperty.call(payload, "customConfig")) {
      customConfig = this._sanitizeConfig(payload.customConfig, current.customConfig);
    } else if (Object.prototype.hasOwnProperty.call(payload, "mode") && mode !== "custom") {
      // Keep Custom configuration synchronized with selected preset mode.
      customConfig = this._resolveConfig(mode, current.customConfig);
    } else {
      customConfig = current.customConfig;
    }

    const persisted = await this._persistNormalized({
      mode,
      customConfig,
      updatedAt: current.updatedAt,
    });

    // Invalidate cache so next request gets fresh config
    this._invalidateCache();

    return this._toPublicPayload(persisted);
  }

  async replaceChaosEngineConfig(payload) {
    const validation = this._validatePayload(payload, { requireMode: true });
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    const mode = String(payload.mode || "").toLowerCase();
    const customConfig = this._sanitizeConfig(payload.customConfig || DEFAULT_CUSTOM_CONFIG, DEFAULT_CUSTOM_CONFIG);

    const persisted = await this._persistNormalized({
      mode,
      customConfig,
      updatedAt: null,
    });

    // Invalidate cache so next request gets fresh config
    this._invalidateCache();

    return this._toPublicPayload(persisted);
  }

  async resetChaosEngineConfig() {
    const persisted = await this._persistNormalized(this._clone(DEFAULT_DATA));
    
    // Invalidate cache so next request gets fresh config
    this._invalidateCache();
    
    return this._toPublicPayload(persisted);
  }
}

module.exports = new ChaosEngineService();
