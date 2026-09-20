// This plugin demonstrates how a plugin can react to feature flag values
// without importing anything from the main application.
//
// The plugin runtime injects a `services` object during initialization.
// This plugin expects a `featureFlagsService` to be available in that object.
//
// A caution about the gating below: the app's own feature-flag middleware reads the flags
// per request, so a toggle takes effect on the very next one. This plugin answers from a
// cache it refreshes on an interval, which is what keeps `onRequest` synchronous, and that
// means its view of a flag can be up to `refreshIntervalMs` out of date. It is a
// demonstration of the hook, not a replacement for the middleware.

const PLUGIN_NAME = "feature-flag-watcher";
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_ROUTE_PATH = "/api/v1/feature-flag-watcher";
const DEFAULT_GATED_PATH_PREFIX = "/api/v1/messenger";
const DEFAULT_GATING_FLAG = "messengerEnabled";

module.exports = {
  name: PLUGIN_NAME,
  enabled: false,
  autoDiscoverable: true,
  order: 100,

  config: {
    // Where the cached flags can be inspected.
    routePath: DEFAULT_ROUTE_PATH,
    // Requests under this prefix are answered with 404 while `gatingFlag` is explicitly
    // false. Set it to null to watch the flags without gating anything.
    gatedPathPrefix: DEFAULT_GATED_PATH_PREFIX,
    gatingFlag: DEFAULT_GATING_FLAG,
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  },

  init({ services = {}, config, logInfo, logError }) {
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

    const interval = Number.isFinite(Number(config?.refreshIntervalMs))
      ? Math.max(1000, Number(config.refreshIntervalMs))
      : DEFAULT_REFRESH_INTERVAL_MS;

    // Keep a small in-memory cache so that onRequest can stay synchronous.
    refreshFlags();
    this._refreshInterval = setInterval(refreshFlags, interval);

    logInfo("FeatureFlagWatcher: initialized and caching feature flag values", { refreshIntervalMs: interval });
  },

  onRequest({ req, res, config }) {
    const routePath = typeof config?.routePath === "string" ? config.routePath : DEFAULT_ROUTE_PATH;

    // A special endpoint that returns the current cached flag values.
    if (req.method === "GET" && req.path === routePath) {
      res.json({ ok: true, flags: this.currentFlags });
      return false;
    }

    // Gate a family of routes on one flag. Only an explicit `false` gates: an unknown flag
    // is left alone, so a cache that has not loaded yet cannot 404 a working feature.
    // Absent means the default prefix; an explicit null (or anything that is not a string)
    // means "watch the flags, gate nothing".
    const gatedPathPrefix =
      config?.gatedPathPrefix === undefined
        ? DEFAULT_GATED_PATH_PREFIX
        : typeof config.gatedPathPrefix === "string"
          ? config.gatedPathPrefix
          : null;
    const gatingFlag = typeof config?.gatingFlag === "string" ? config.gatingFlag : DEFAULT_GATING_FLAG;

    if (gatedPathPrefix && req.path.startsWith(gatedPathPrefix) && this.currentFlags?.[gatingFlag] === false) {
      res.status(404).json({ ok: false, error: "Resource not found" });
      return false;
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
