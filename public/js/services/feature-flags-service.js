/**
 * Feature Flags Service
 * Provides feature flag access with short-lived client-side caching.
 */
class FeatureFlagsService {
  constructor() {
    this.apiService = null;
    this._flagsCache = null;
    this._cacheTimestamp = 0;
    this._cacheTtlMs = 30000;
    this._inFlight = null;
  }

  /**
   * Initialize the service
   * @param {App} app - Application instance
   */
  init(app) {
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

  /**
   * Fetch all feature flags (no caching).
   */
  async getFlags() {
    this._ensureApiService();
    return this.apiService.get("feature-flags");
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
    return this.apiService.request("PATCH", "feature-flags", { body: { flags } });
  }

  /**
   * Replace all feature flags.
   * @param {Object} flags - Full flags map to replace
   */
  async replaceFlags(flags) {
    this._ensureApiService();
    this._clearCache();
    return this.apiService.put("feature-flags", { flags });
  }

  /**
   * Reset all feature flags to predefined defaults.
   */
  async resetFlags() {
    this._ensureApiService();
    this._clearCache();
    return this.apiService.post("feature-flags/reset", {});
  }
}

window.FeatureFlagsService = FeatureFlagsService;
