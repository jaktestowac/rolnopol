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
  config: {
    // Optional notification center event types to listen for.
    // Leave empty to receive every notification-center event.
    eventTypes: [],
  },

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
    // You can also modify the response body if it's JSON:
    // if (responseType === "json" && typeof responseBody === "object") {
    //   responseBody.pluginTemplate = "This response was modified by plugin-template";
    //   return responseBody; // return modified body to be sent
    // }
    // You can detect endpoints and modify behavior accordingly:
    // if (req.path === "/api/some-endpoint") {
    //   logInfo("plugin-template: modifying response for /api/some-endpoint");
    //   if (responseType === "json" && typeof responseBody === "object") {
    //     responseBody.modifiedBy = "plugin-template";
    //     return responseBody;
    //   }
    // }
  },

  // Called whenever the notification center publishes a matching event.
  // Use config.eventTypes to limit which events reach this hook.
  onEvent({ event, eventType, pluginContext, config, logInfo, logError, logDebug }) {
    // Example:
    // if (eventType === "field.created") {
    //   logInfo("plugin-template observed field.created", { event, config });
    // }
    // You can keep cross-event state in pluginContext.
    // pluginContext.lastEvent = eventType;
  },

  // Called on graceful shutdown (if plugin enabled)
  async shutdown({ logInfo, logError, logDebug, config }) {
    logInfo("plugin-template shutdown", { config });
  },
};
