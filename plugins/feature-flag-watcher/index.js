// This plugin demonstrates how a plugin can react to feature flag values
// without importing anything from the main application.
//
// The plugin runtime injects a `services` object during initialization.
// This plugin expects a `featureFlagsService` to be available in that object.

const PLUGIN_NAME = "feature-flag-watcher";
const FLAG_REFRESH_INTERVAL_MS = 30_000;

module.exports = {
  name: PLUGIN_NAME,
  enabled: false,
  autoDiscoverable: true,
  order: 100,

  init({ services = {}, logInfo, logError }) {
    this.featureFlagsService = services.featureFlagsService;
    this.currentFlags = {};

    if (!this.featureFlagsService || typeof this.featureFlagsService.getFeatureFlags !== "function") {
      logError("FeatureFlagWatcher: missing or invalid featureFlagsService, plugin will remain enabled but inactive");
      return;
    }

    const refreshFlags = async () => {
      try {
        const data = await this.featureFlagsService.getFeatureFlags();
        this.currentFlags = data?.flags || {};
      } catch (error) {
        logError("FeatureFlagWatcher: failed to refresh feature flags", { error: error instanceof Error ? error.message : error });
      }
    };

    // Keep a small in-memory cache so that onRequest can be synchronous.
    refreshFlags();
    this._refreshInterval = setInterval(refreshFlags, FLAG_REFRESH_INTERVAL_MS);

    logInfo("FeatureFlagWatcher: initialized and caching feature flag values");
  },

  onRequest({ req, res }) {
    // Example: a special endpoint that returns the current cached flag values.
    if (req.method === "GET" && req.path === "/api/v1/feature-flag-watcher") {
      return res.json({
        ok: true,
        flags: this.currentFlags,
      });
    }

    // Example: gate a specific route based on a flag.
    // If the messenger feature is disabled, return 404 for messenger routes.
    if (req.path.startsWith("/api/v1/messenger") && this.currentFlags.messengerEnabled === false) {
      res.status(404).json({ ok: false, error: "Resource not found" });
      return false; // stop processing further middleware
    }

    return undefined;
  },

  shutdown() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  },
};
