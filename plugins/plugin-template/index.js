module.exports = {
  // Unique plugin name (required)
  name: "plugin-template",

  // Optional ordering priority (lower = earlier)
  order: 1000,

  // Whether the plugin is enabled by default when loaded
  enabled: false,

  // If true, this plugin can be loaded without being listed in plugins/plugins.manifest.json
  autoDiscoverable: false,

  // Optional default config values (can be overridden by local or global manifests)
  config: {},

  // Called once on startup (if plugin enabled)
  // Receives core logging helpers and resolved config
  init({ logInfo, logError, logDebug, config }) {
    logInfo("plugin-template initialized", { config });
  },

  // Called on each request before route handlers
  // Returning `false` will stop further plugin hooks for that request
  onRequest({ req, res, pluginContext, config, logInfo, logError, logDebug }) {
    // Example:
    // pluginContext.example = "value";
    // req.headers["x-my-header"] = "custom";
    // return false; // prevent other plugins from running
  },

  // Called before response body is sent (json/send)
  onResponse({ req, res, responseBody, responseType, pluginContext, config, logInfo, logError, logDebug }) {
    // Example:
    // res.setHeader("x-template-plugin", "active");
  },

  // Called on graceful shutdown (if plugin enabled)
  async shutdown({ logInfo, logError, logDebug, config }) {
    logInfo("plugin-template shutdown", { config });
  },
};
