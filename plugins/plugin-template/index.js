module.exports = {
  // Unique plugin name (required). Keep it identical to the directory name: discovery works
  // off directories, so that is what both manifests are keyed by, and a plugin whose name
  // disagrees reports one identity in the logs while being configured under another.
  name: "plugin-template",

  // Optional ordering priority (lower = earlier). Can be overridden from either manifest.
  order: 1000,

  // Whether the plugin is enabled by default when loaded
  enabled: false,

  // Discovery is decided before this file is required, so it has to be readable from JSON:
  // either list the plugin in plugins/plugins.manifest.json, or add a
  // plugins/<plugin>/plugin.manifest.json containing { "autoDiscoverable": true }.
  // The flag below only matters when the runtime is started with
  // `allowCodeDeclaredDiscovery: true`, which reopens the hole of running unregistered code.
  autoDiscoverable: false,

  // Default config values. Every value a plugin reads should have its default HERE rather
  // than as a fallback inside a hook: the manifests are an override layer, and a manifest
  // key with no default here cannot be checked against anything.
  //
  // Manifest layers deep-merge over these: the global manifest wins over
  // plugin.manifest.json, which wins over what is written here. Arrays are replaced whole.
  config: {
    // Notification center event types this plugin wants. An empty list means every event.
    // This is the ONLY place the runtime looks for the filter.
    eventTypes: [],
  },

  // ---------------------------------------------------------------------------
  // Every hook below is optional. All of them except `shutdown` are called
  // SYNCHRONOUSLY and their promises are NOT awaited, so an `async` hook races the rest of
  // the request; the runtime logs a warning if one returns a promise.
  //
  // The runtime loads a shallow copy of this object, so `this` is a per-load instance:
  // state stored on `this` in `init` is visible to the other hooks, and is not the same
  // object other code sees when it requires this file directly.
  // ---------------------------------------------------------------------------

  // Called once on startup (if plugin enabled)
  // Receives core logging helpers, resolved config, and the injected services
  init({ logInfo, logError, logDebug, config, services }) {
    logInfo("plugin-template initialized", { config });
  },

  // Called once on startup, after `init`, for plugins that want real Express routes.
  // The router is mounted at /api/v1/plugins/<plugin-name>, which is why a plugin cannot
  // shadow a core route this way. Prefer this over matching paths inside `onRequest`.
  registerRoutes({ router, config, logInfo }) {
    // Example:
    // router.get("/status", (req, res) => {
    //   res.json({ ok: true, plugin: "plugin-template", config });
    // });
  },

  // Called on each request before route handlers.
  // Return `false` to stop the remaining plugins for this request. If nothing has answered
  // by then, the runtime continues to the route handlers rather than leaving the request
  // hanging, and logs that the chain was stopped without a response.
  onRequest({ req, res, pluginContext, config, services, logInfo, logError, logDebug }) {
    // Example:
    // pluginContext.example = "value";
    // req.headers["x-my-header"] = "custom";
    // return false; // prevent other plugins from running
  },

  // Called before the response body is sent.
  //
  // `responseType` is "json" or "send" when the body came from res.json / res.send, and
  // "end" for everything else: sendFile, redirects, streams, bodyless responses. Returning
  // a value replaces the body for "json" and "send" only; on "end" the hook can observe but
  // not rewrite. Returning `undefined` always leaves the body untouched, and mutating a
  // JSON body in place works for every type.
  onResponse({ req, res, responseBody, responseType, pluginContext, config, services, logInfo, logError, logDebug }) {
    // Example, replacing the body:
    // if (responseType === "json" && responseBody && typeof responseBody === "object") {
    //   return { ...responseBody, pluginTemplate: "This response was modified by plugin-template" };
    // }
    // Example, mutating in place instead:
    // if (responseType === "json" && responseBody && typeof responseBody === "object") {
    //   responseBody.modifiedBy = "plugin-template";
    // }
    // Example, setting a header (only while the headers are still open):
    // if (!res.headersSent) res.setHeader("x-template-plugin", "active");
  },

  // Called whenever the notification center publishes a matching event.
  // Use config.eventTypes to limit which events reach this hook.
  //
  // `pluginState` is per-load state, unlike the `pluginContext` of onRequest/onResponse,
  // which lives for one request. Only the event hooks see it, so state that both an event
  // and a request need belongs on `this`.
  onEvent({ event, eventType, pluginState, config, services, logInfo, logError, logDebug }) {
    // Example:
    // if (eventType === "field.created") {
    //   logInfo("plugin-template observed field.created", { event, config });
    // }
    // You can keep cross-event state in pluginState.
    // pluginState.lastEvent = eventType;
  },

  // Called on graceful shutdown, and again before a reload replaces this plugin (if plugin
  // enabled). This is the one hook the runtime awaits, so clean up timers and handles here.
  async shutdown({ logInfo, logError, logDebug, config }) {
    logInfo("plugin-template shutdown", { config });
  },
};
