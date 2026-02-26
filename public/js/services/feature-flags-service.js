/**
 * Feature Flags Service
 * Provides feature flag access with short-lived client-side caching.
 */
class FeatureFlagsService {
  constructor() {
    this.apiService = null;
    this.app = null;
    this._flagsCache = null;
    this._cacheTimestamp = 0;
    this._cacheTtlMs = 30000;
    this._inFlight = null;
    this._storageKey = "rolnopol.featureFlagsCache.v1";

    this._hydrateCacheFromStorage();
  }

  /**
   * Initialize the service
   * @param {App} app - Application instance
   */
  init(app) {
    this.app = app;
    this.apiService = app.getModule("apiService");
  }

  _ensureApiService() {
    if (!this.apiService) {
      throw new Error("ApiService is not available");
    }
  }

  _clearCache() {
    this._flagsCache = null;
    this._cacheTimestamp = 0;
    this._clearStoredCache();
  }

  _isCacheValid() {
    if (!this._flagsCache) {
      return false;
    }
    return Date.now() - this._cacheTimestamp < this._cacheTtlMs;
  }

  _extractFlags(response) {
    const payload = response?.data?.data;
    if (!response?.success || !payload || typeof payload.flags !== "object") {
      return null;
    }
    return payload.flags;
  }

  _hydrateCacheFromStorage() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(this._storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const flags = parsed.flags;
      const timestamp = Number(parsed.timestamp);
      if (!flags || typeof flags !== "object" || !Number.isFinite(timestamp)) {
        return;
      }

      if (Date.now() - timestamp >= this._cacheTtlMs) {
        this._clearStoredCache();
        return;
      }

      this._flagsCache = flags;
      this._cacheTimestamp = timestamp;
    } catch (error) {
      this._clearStoredCache();
    }
  }

  _persistCacheToStorage() {
    if (typeof window === "undefined" || !window.localStorage || !this._flagsCache) {
      return;
    }

    try {
      window.localStorage.setItem(
        this._storageKey,
        JSON.stringify({
          flags: this._flagsCache,
          timestamp: this._cacheTimestamp,
        }),
      );
    } catch (error) {
      // Ignore storage quota/privacy mode issues.
    }
  }

  _clearStoredCache() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(this._storageKey);
    } catch (error) {
      // Ignore storage access issues.
    }
  }

  /**
   * Fetch all feature flags (no caching).
   * @param {Object} options - Optional options
   * @param {boolean} options.descriptions - Include descriptions for each flag
   */
  async getFlags(options = {}) {
    this._ensureApiService();
    const params = new URLSearchParams();
    if (options.descriptions) {
      params.append("descriptions", "true");
    }
    const query = params.toString();
    const endpoint = query ? `feature-flags?${query}` : "feature-flags";
    return this.apiService.get(endpoint);
  }

  /**
   * Fetch feature flags with a short-lived cache.
   */
  async getFlagsCached() {
    if (this._isCacheValid()) {
      return this._flagsCache;
    }

    if (this._inFlight) {
      return this._inFlight;
    }

    return this.refreshFlags();
  }

  /**
   * Force refresh of feature flags and update cache.
   */
  async refreshFlags() {
    this._ensureApiService();

    if (this._inFlight) {
      return this._inFlight;
    }

    this._inFlight = (async () => {
      const response = await this.apiService.get("feature-flags");
      const flags = this._extractFlags(response);

      if (!flags) {
        throw new Error("Failed to load feature flags");
      }

      this._flagsCache = flags;
      this._cacheTimestamp = Date.now();
      this._persistCacheToStorage();
      return this._flagsCache;
    })();

    try {
      return await this._inFlight;
    } finally {
      this._inFlight = null;
    }
  }

  /**
   * Check if a feature flag is enabled.
   * @param {string} flagKey - Feature flag key
   * @param {boolean} defaultValue - Default value when flag is missing
   */
  async isEnabled(flagKey, defaultValue = false) {
    if (!flagKey) {
      return defaultValue;
    }

    try {
      const flags = await this.getFlagsCached();
      if (!flags || typeof flags !== "object") {
        return defaultValue;
      }
      if (!Object.prototype.hasOwnProperty.call(flags, flagKey)) {
        return defaultValue;
      }
      return !!flags[flagKey];
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Patch feature flags.
   * @param {Object} flags - Partial flags to update
   */
  async updateFlags(flags) {
    this._ensureApiService();
    this._clearCache();
    const response = this.apiService.request("PATCH", "feature-flags", { body: { flags } });
    this._emitFlagsChangedEvent();
    return response;
  }

  /**
   * Replace all feature flags.
   * @param {Object} flags - Full flags map to replace
   */
  async replaceFlags(flags) {
    this._ensureApiService();
    this._clearCache();
    const response = this.apiService.put("feature-flags", { flags });
    this._emitFlagsChangedEvent();
    return response;
  }

  /**
   * Reset all feature flags to predefined defaults.
   */
  async resetFlags() {
    this._ensureApiService();
    this._clearCache();
    const response = this.apiService.post("feature-flags/reset", {});
    this._emitFlagsChangedEvent();
    return response;
  }

  /**
   * Emit a feature flags changed event
   */
  _emitFlagsChangedEvent() {
    if (this.app && typeof this.app.getEventBus === "function") {
      const eventBus = this.app.getEventBus();
      if (eventBus) {
        eventBus.emit("feature-flags:changed");
      }
    }
  }
}

window.FeatureFlagsService = FeatureFlagsService;
