module.exports = {
  name: "teapot-blocker-plugin",
  order: 0, // Run before all other plugins to block requests early
  enabled: false,
  autoDiscoverable: false, // This plugin is not auto-discoverable because it would block all requests if enabled without explicit intent

  onRequest({ req, res, pluginContext, config, logInfo, logError, logDebug }) {
    try {
      logInfo("Plugin teapot-blocker-plugin: blocking request", {
        method: req.method,
        path: req.originalUrl,
        clientIp: req.ip,
      });

      if (!res.headersSent) {
        res.status(418).json({
          error: "I'm a teapot",
          message: config?.message || "I refuse to brew coffee",
          plugin: "teapot-blocker-plugin",
        });
      }
    } catch (error) {
      logError("Plugin teapot-blocker-plugin: failed to send teapot response", { error: error.message });
      if (!res.headersSent) {
        res.status(418).send("I'm a teapot");
      }
    }

    // Returning false short-circuits the request pipeline in plugin runtime.
    return false;
  },
};
