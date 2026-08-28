const { existsSync, readdirSync, statSync, readFileSync } = require("fs");
const path = require("path");
const express = require("express");
const { logInfo, logError, logDebug, logWarning } = require("../../helpers/logger-api");

/**
 * Plugin runtime configuration precedence (highest to lowest):
 *
 * 1) Global manifest (`plugins.manifest.json`) - overrides everything.
 * 2) Local plugin manifest (`plugins/<plugin>/plugin.manifest.json`) - overrides code defaults.
 * 3) Plugin code defaults (`plugins/<plugin>/index.js`) - used when no manifest overrides.
 * 4) Fallback - if `enabled` is not explicitly set anywhere, the plugin defaults to disabled.
 *
 * This is why you can have `enabled` in both the plugin code and the manifest; the manifest
 * always wins, and the code value is treated as a default. The same chain applies to
 * `config` (deep-merged, later layers winning) and to `order`.
 *
 * Discovery is deliberately decided BEFORE a plugin's `index.js` is required: a directory
 * that no manifest mentions never gets executed, so dropping a folder into `plugins/` is
 * not enough to run code. Reachability therefore has to be readable from JSON:
 *
 *   - the plugin is a key in the global manifest, or
 *   - its own `plugin.manifest.json` says `"autoDiscoverable": true`.
 *
 * `autoDiscoverable: true` in plugin code alone is not enough, because reading it means
 * running the file. Pass `allowCodeDeclaredDiscovery: true` to `initialize()` to fall back
 * to the old behaviour (it requires the module to ask, which is the hole it reopens).
 *
 * Hooks a plugin may export, all optional:
 *
 *   init({ logInfo, logError, logDebug, config, services })
 *   registerRoutes({ router, config, services, logInfo, logError, logDebug })
 *   onRequest({ req, res, pluginContext, config, services, ...loggers })
 *   onResponse({ req, res, responseBody, responseType, pluginContext, config, services, ...loggers })
 *   onEvent({ event, eventType, pluginContext, config, services, ...loggers })
 *   shutdown({ logInfo, logError, logDebug, config })
 *
 * `init`, `onRequest`, `onResponse` and `onEvent` are called synchronously and their
 * promises are NOT awaited; returning one is logged as a mistake. Only `shutdown` is
 * awaited. `onRequest` returning `false` stops the remaining plugins for that request; if
 * nothing has answered by then the runtime continues to the route handlers rather than
 * leaving the request hanging. `onResponse` may return a replacement body for `res.json`
 * and `res.send`; returning `undefined` leaves the body alone.
 */

const DEFAULT_MANIFEST_FILE = "plugins.manifest.json";
const DEFAULT_PLUGIN_MANIFEST_FILE = "plugin.manifest.json";
const DEFAULT_ORDER = 1000;

/** Routers from `registerRoutes` mount here, one segment per plugin name. */
const PLUGIN_ROUTE_NAMESPACE = "/api/v1/plugins";

/** Hook names, in the order they are documented and reported by `getPlugins()`. */
const HOOK_NAMES = ["init", "registerRoutes", "onRequest", "onResponse", "onEvent", "shutdown"];

/** Keys that would change an object's shape rather than its contents. */
const UNSAFE_CONFIG_KEYS = ["__proto__", "constructor", "prototype"];

/** Superseded ways of naming the event filter, kept only to warn about them. */
const LEGACY_EVENT_KEYS = ["eventType", "events"];

const state = {
  initialized: false,
  plugins: [],
  requestHooks: [],
  responseHooks: [],
  pluginRouters: new Map(),
  pluginsDir: null,
  manifestPath: null,
  services: {},
  eventSubscriptions: [],
};

function _safeRequire(modulePath) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(modulePath);
}

function _isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function _loadManifest(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) {
    return { plugins: {} };
  }

  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!_isObject(parsed)) {
      return { plugins: {} };
    }
    if (!_isObject(parsed.plugins)) {
      return { plugins: {} };
    }
    return parsed;
  } catch (error) {
    logError("Plugin runtime: failed to parse plugin manifest", { manifestPath, error: error.message });
    return { plugins: {} };
  }
}

function _loadPluginManifest(pluginManifestPath) {
  if (!pluginManifestPath || !existsSync(pluginManifestPath)) {
    return {};
  }

  try {
    const raw = readFileSync(pluginManifestPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!_isObject(parsed)) {
      return {};
    }

    return parsed;
  } catch (error) {
    logError("Plugin runtime: failed to parse local plugin manifest", {
      pluginManifestPath,
      error: error.message,
    });
    return {};
  }
}

function _resolveEnabled(pluginDef, localPluginConfig, globalManifestPluginConfig) {
  if (_isObject(globalManifestPluginConfig) && typeof globalManifestPluginConfig.enabled === "boolean") {
    return globalManifestPluginConfig.enabled;
  }
  if (_isObject(localPluginConfig) && typeof localPluginConfig.enabled === "boolean") {
    return localPluginConfig.enabled;
  }
  if (typeof pluginDef.enabled === "boolean") {
    return pluginDef.enabled;
  }
  return false;
}

/** Which layer decided `enabled`, for `getPlugins()` and the startup log. */
function _resolveEnabledSource(pluginDef, localPluginConfig, globalManifestPluginConfig) {
  if (_isObject(globalManifestPluginConfig) && typeof globalManifestPluginConfig.enabled === "boolean") {
    return "global-manifest";
  }
  if (_isObject(localPluginConfig) && typeof localPluginConfig.enabled === "boolean") {
    return "local-manifest";
  }
  if (typeof pluginDef.enabled === "boolean") {
    return "code";
  }
  return "default";
}

/**
 * Deep merge for config layers. Plain objects merge key by key so a manifest can override
 * one nested value without restating its siblings; arrays are replaced wholesale, because
 * a partial array override has no obvious meaning.
 */
function _mergeConfig(base, override) {
  if (!_isObject(base) || !_isObject(override)) {
    return override === undefined ? base : override;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    // Config arrives from JSON files, so a key like `__proto__` is reachable by anyone who
    // can write a manifest. Assigning it would change the merged object's prototype rather
    // than add a value, and `key in result` would answer for inherited keys like
    // `constructor` as well.
    if (UNSAFE_CONFIG_KEYS.includes(key)) {
      logWarning("Plugin runtime: ignoring unsafe config key", { key });
      continue;
    }

    const hasKey = Object.prototype.hasOwnProperty.call(result, key);
    result[key] = hasKey ? _mergeConfig(result[key], value) : value;
  }
  return result;
}

function _resolveConfig(pluginDef, localPluginConfig, globalManifestPluginConfig) {
  const codeConfig = _isObject(pluginDef.config) ? pluginDef.config : {};
  const localConfig = _isObject(localPluginConfig) && _isObject(localPluginConfig.config) ? localPluginConfig.config : {};
  const globalConfig =
    _isObject(globalManifestPluginConfig) && _isObject(globalManifestPluginConfig.config) ? globalManifestPluginConfig.config : {};

  return _mergeConfig(_mergeConfig(codeConfig, localConfig), globalConfig);
}

/**
 * `order` follows the same chain as `enabled`, so the sequence plugins run in can be
 * changed from the manifest. It is the field that decides who wins when two plugins want
 * the same request, and it used to be editable only by changing plugin code.
 */
function _resolveOrder(pluginDef, localPluginConfig, globalManifestPluginConfig) {
  const candidates = [
    _isObject(globalManifestPluginConfig) ? globalManifestPluginConfig.order : undefined,
    _isObject(localPluginConfig) ? localPluginConfig.order : undefined,
    _isObject(pluginDef) ? pluginDef.order : undefined,
  ];

  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_ORDER;
}

function _isAutoDiscoverable(pluginDef, localPluginConfig) {
  if (_isObject(localPluginConfig) && localPluginConfig.autoDiscoverable === true) {
    return true;
  }

  if (_isObject(pluginDef) && pluginDef.autoDiscoverable === true) {
    return true;
  }

  return false;
}

function _normalizeEventTypeList(value) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

  const normalized = rawValues.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);

  if (normalized.includes("*")) {
    return [];
  }

  return normalized;
}

/**
 * The event filter is `config.eventTypes` and nothing else. It used to be readable from six
 * places, which meant a typo in any of them looked like "subscribe to everything"; the
 * superseded spellings now produce a warning instead of quietly working.
 */
function _getPluginEventTypes(plugin) {
  const config = _isObject(plugin?.config) ? plugin.config : {};

  const legacyKeys = [
    ...LEGACY_EVENT_KEYS.filter((key) => config[key] !== undefined).map((key) => `config.${key}`),
    ...["eventTypes", ...LEGACY_EVENT_KEYS].filter((key) => plugin?.[key] !== undefined),
  ];

  if (legacyKeys.length > 0) {
    logWarning("Plugin runtime: ignoring superseded event-filter keys, use config.eventTypes", {
      plugin: plugin?.name,
      ignored: legacyKeys,
    });
  }

  return _normalizeEventTypeList(config.eventTypes);
}

function _clearEventSubscriptions() {
  for (const subscription of state.eventSubscriptions) {
    if (typeof subscription?.unsubscribe !== "function") {
      continue;
    }

    try {
      subscription.unsubscribe();
    } catch (error) {
      logError("Plugin runtime: failed to unsubscribe event listener", {
        plugin: subscription?.pluginName,
        error: error.message,
      });
    }
  }

  state.eventSubscriptions = [];
}

/** Warn when a hook hands back a promise the runtime is never going to await. */
function _warnOnPromise(plugin, hookName, result) {
  if (result && typeof result.then === "function") {
    logWarning("Plugin runtime: hook returned a promise, which the runtime does not await", {
      plugin: plugin?.name,
      hook: hookName,
    });
  }

  return result;
}

function _registerPluginEventListener(plugin, services) {
  if (!plugin || typeof plugin.onEvent !== "function") {
    return;
  }

  const notificationCenter = services?.notificationCenter;
  if (!notificationCenter || typeof notificationCenter.subscribeEvents !== "function") {
    return;
  }

  const eventTypes = _getPluginEventTypes(plugin);
  const eventTypeFilter = eventTypes.length > 0 ? new Set(eventTypes) : null;

  const unsubscribe = notificationCenter.subscribeEvents((event) => {
    if (!event || typeof event.type !== "string") {
      return;
    }

    if (eventTypeFilter && !eventTypeFilter.has(event.type)) {
      return;
    }

    try {
      const result = plugin.onEvent({
        event,
        eventType: event.type,
        // Deliberately not called pluginContext: that name means per-request state in
        // onRequest and onResponse, and this object lives as long as the load.
        pluginState: plugin.eventContext,
        config: plugin.config,
        services,
        logInfo,
        logError,
        logDebug,
      });
      _warnOnPromise(plugin, "onEvent", result);
    } catch (error) {
      logError("Plugin runtime: onEvent failed", {
        plugin: plugin.name,
        eventType: event.type,
        error: error.message,
      });
    }
  });

  if (typeof unsubscribe === "function") {
    state.eventSubscriptions.push({ pluginName: plugin.name, unsubscribe });
  }
}

/**
 * Every candidate directory, described from JSON alone. Nothing here executes plugin code,
 * which is what lets `initialize` decide reachability before requiring anything.
 */
function _discoverPluginCandidates(pluginsDir) {
  if (!pluginsDir || !existsSync(pluginsDir)) {
    return [];
  }

  const candidates = [];

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryFile = path.join(pluginsDir, entry.name, "index.js");
    if (!existsSync(entryFile) || !statSync(entryFile).isFile()) {
      continue;
    }

    candidates.push({
      dirName: entry.name,
      entryFile,
      localPluginConfig: _loadPluginManifest(path.join(pluginsDir, entry.name, DEFAULT_PLUGIN_MANIFEST_FILE)),
    });
  }

  return candidates;
}

/** Keys a global manifest entry may carry. Anything else is a typo doing nothing. */
const MANIFEST_ENTRY_KEYS = ["enabled", "config", "order"];

/**
 * Mistakes in the manifest itself. Both of these used to be silent: an unknown key reads as
 * "unspecified", which for `enabled` means disabled, and an entry naming a directory that is
 * not there looks exactly like a plugin that failed to load.
 */
function _validateManifest(manifest, candidates) {
  const warnings = [];
  const directories = new Set(candidates.map((candidate) => candidate.dirName));

  for (const [name, entry] of Object.entries(manifest.plugins)) {
    if (!directories.has(name)) {
      warnings.push(`Manifest lists "${name}", which has no plugins/${name}/index.js`);
    }

    if (!_isObject(entry)) {
      warnings.push(`Manifest entry "${name}" is not an object`);
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!MANIFEST_ENTRY_KEYS.includes(key)) {
        warnings.push(`Manifest entry "${name}" carries unknown key "${key}", which the runtime ignores`);
      }
    }

    if (entry.order !== undefined && !Number.isFinite(entry.order)) {
      warnings.push(`Manifest entry "${name}" has a non-numeric order, which is ignored`);
    }
  }

  return warnings;
}

/**
 * The three config keys the runtime itself understands. A wrong shape here does not throw,
 * it changes what a plugin matches: a `routePaths` string reads as "no filter at all", and a
 * `routePath` that is not a string matches nothing, so the plugin looks simply dead.
 */
function _validateConventionalConfig(plugin) {
  const warnings = [];
  const config = _isObject(plugin.config) ? plugin.config : {};

  if (config.routePath !== undefined && (typeof config.routePath !== "string" || config.routePath.length === 0)) {
    warnings.push(`"${plugin.name}" has a config.routePath that is not a non-empty string, so it will never match a request`);
  }

  if (config.routePaths !== undefined && !Array.isArray(config.routePaths)) {
    warnings.push(`"${plugin.name}" has a config.routePaths that is not an array`);
  }

  if (config.eventTypes !== undefined && !Array.isArray(config.eventTypes) && typeof config.eventTypes !== "string") {
    warnings.push(`"${plugin.name}" has a config.eventTypes that is neither an array nor a string, so no event will be filtered out`);
  }

  return warnings;
}

/** Duplicates that would otherwise be decided by sort stability or by whoever runs first. */
function _detectCollisions(plugins) {
  const warnings = [];
  const enabled = plugins.filter((plugin) => plugin.enabled);

  const byName = new Map();
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) {
      warnings.push(`Duplicate plugin name "${plugin.name}": ${byName.get(plugin.name)} and ${plugin.pluginFile}`);
      continue;
    }
    byName.set(plugin.name, plugin.pluginFile);
  }

  const byOrder = new Map();
  for (const plugin of enabled) {
    if (byOrder.has(plugin.order)) {
      warnings.push(
        `Plugins "${byOrder.get(plugin.order)}" and "${plugin.name}" share order ${plugin.order}; the run sequence is arbitrary`,
      );
      continue;
    }
    byOrder.set(plugin.order, plugin.name);
  }

  const byRoutePath = new Map();
  for (const plugin of enabled) {
    const routePath = plugin.config?.routePath;
    if (typeof routePath !== "string" || routePath.length === 0) {
      continue;
    }
    if (byRoutePath.has(routePath)) {
      warnings.push(`Plugins "${byRoutePath.get(routePath)}" and "${plugin.name}" both claim ${routePath}`);
      continue;
    }
    byRoutePath.set(routePath, plugin.name);
  }

  return warnings;
}

function _shutdownPlugin(plugin) {
  if (typeof plugin.shutdown !== "function") {
    return undefined;
  }

  try {
    return plugin.shutdown({ logInfo, logError, logDebug, config: plugin.config });
  } catch (error) {
    logError("Plugin runtime: plugin shutdown failed", { plugin: plugin.name, error: error.message });
    return undefined;
  }
}

/**
 * Drop everything the previous `initialize()` set up. Without this a second initialize ran
 * `init` twice and left the first set of plugins holding their timers, with no handle on
 * them: `shutdown()` only ever saw the newest instances.
 */
function _teardownLoadedPlugins() {
  _clearEventSubscriptions();

  for (const plugin of state.plugins.filter((candidate) => candidate.enabled)) {
    const result = _shutdownPlugin(plugin);
    if (result && typeof result.then === "function") {
      result.then(undefined, (error) =>
        logError("Plugin runtime: plugin shutdown rejected", { plugin: plugin.name, error: error?.message }),
      );
    }
  }

  state.plugins = [];
  state.requestHooks = [];
  state.responseHooks = [];
  state.pluginRouters = new Map();
}

/** Routers built once per initialize, dispatched by plugin name at request time. */
function _buildPluginRouters(plugins, services) {
  const routers = new Map();

  for (const plugin of plugins) {
    if (typeof plugin.registerRoutes !== "function") {
      continue;
    }

    const router = express.Router();

    try {
      plugin.registerRoutes({ router, config: plugin.config, services, logInfo, logError, logDebug });
      routers.set(plugin.name, router);
      logDebug("Plugin runtime: mounted plugin routes", {
        plugin: plugin.name,
        mountPath: `${PLUGIN_ROUTE_NAMESPACE}/${plugin.name}`,
      });
    } catch (error) {
      logError("Plugin runtime: registerRoutes failed", { plugin: plugin.name, error: error.message });
    }
  }

  return routers;
}

function initialize(options = {}) {
  const pluginsDir = options.pluginsDir || path.resolve(__dirname, "../../plugins");
  const manifestPath = options.manifestPath || path.join(pluginsDir, DEFAULT_MANIFEST_FILE);
  const services = _isObject(options.services) ? options.services : {};
  const allowCodeDeclaredDiscovery = options.allowCodeDeclaredDiscovery === true;

  _teardownLoadedPlugins();

  const manifest = _loadManifest(manifestPath);
  const candidates = _discoverPluginCandidates(pluginsDir);
  const loaded = [];

  for (const warning of _validateManifest(manifest, candidates)) {
    logWarning("Plugin runtime: manifest", { warning });
  }

  for (const candidate of candidates) {
    const { dirName, entryFile, localPluginConfig } = candidate;

    try {
      const isInGlobalManifest = Object.prototype.hasOwnProperty.call(manifest.plugins, dirName);
      const declaredInJson = isInGlobalManifest || localPluginConfig.autoDiscoverable === true;

      // Deciding this before the require is the whole point: an unregistered directory
      // must not get the chance to run anything at all.
      if (!declaredInJson && !allowCodeDeclaredDiscovery) {
        logDebug("Plugin runtime: skipping unregistered plugin without requiring it", {
          plugin: dirName,
          pluginFile: entryFile,
          reason: "not-in-global-manifest-and-no-local-manifest-opt-in",
        });
        continue;
      }

      const pluginDef = _safeRequire(entryFile);
      if (!pluginDef || typeof pluginDef !== "object") {
        logError("Plugin runtime: plugin does not export an object", { pluginFile: entryFile });
        continue;
      }

      const pluginName = pluginDef.name;
      if (!pluginName || typeof pluginName !== "string") {
        logError("Plugin runtime: plugin has invalid or missing name", { pluginFile: entryFile });
        continue;
      }

      // Discovery works off directories, so that is what the manifests are keyed by. A
      // plugin whose exported name disagrees reports one identity in the logs and is
      // configured under another.
      if (pluginName !== dirName) {
        logWarning("Plugin runtime: plugin name does not match its directory, which is what both manifests key by", {
          plugin: pluginName,
          directory: dirName,
        });
      }

      if (!declaredInJson && !_isAutoDiscoverable(pluginDef, localPluginConfig)) {
        logDebug("Plugin runtime: skipping unregistered plugin", {
          plugin: pluginName,
          pluginFile: entryFile,
          reason: "not-in-global-manifest-and-not-auto-discoverable",
        });
        continue;
      }

      const globalManifestPluginConfig = isInGlobalManifest ? manifest.plugins[dirName] : {};

      loaded.push({
        ...pluginDef,
        enabled: _resolveEnabled(pluginDef, localPluginConfig, globalManifestPluginConfig),
        enabledBy: _resolveEnabledSource(pluginDef, localPluginConfig, globalManifestPluginConfig),
        config: _resolveConfig(pluginDef, localPluginConfig, globalManifestPluginConfig),
        order: _resolveOrder(pluginDef, localPluginConfig, globalManifestPluginConfig),
        pluginFile: entryFile,
        eventContext: {},
      });
    } catch (error) {
      logError("Plugin runtime: failed loading plugin", { pluginFile: entryFile, error: error.message });
    }
  }

  // Name breaks ties so two plugins sharing an order still run in a fixed sequence.
  loaded.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  state.plugins = loaded;
  state.initialized = true;
  state.pluginsDir = pluginsDir;
  state.manifestPath = manifestPath;
  state.services = services;

  const enabledPlugins = loaded.filter((plugin) => plugin.enabled);

  state.requestHooks = enabledPlugins.filter((plugin) => typeof plugin.onRequest === "function");
  state.responseHooks = enabledPlugins.filter((plugin) => typeof plugin.onResponse === "function");

  logInfo("Plugin runtime initialized");
  logDebug("Plugin runtime initialized", {
    pluginsDir,
    manifestPath,
    loadedPlugins: loaded.map((plugin) => plugin.name),
    enabledPlugins: enabledPlugins.map((plugin) => plugin.name),
    disabledPlugins: loaded.filter((plugin) => !plugin.enabled).map((plugin) => plugin.name),
  });

  for (const warning of _detectCollisions(loaded)) {
    logWarning("Plugin runtime: collision", { warning });
  }

  for (const plugin of enabledPlugins) {
    for (const warning of _validateConventionalConfig(plugin)) {
      logWarning("Plugin runtime: config", { warning });
    }
  }

  for (const plugin of enabledPlugins) {
    try {
      if (typeof plugin.init === "function") {
        _warnOnPromise(plugin, "init", plugin.init({ logInfo, logError, logDebug, config: plugin.config, services }));
      }
    } catch (error) {
      logError("Plugin runtime: plugin init failed", { plugin: plugin.name, error: error.message });
    }

    _registerPluginEventListener(plugin, services);
  }

  state.pluginRouters = _buildPluginRouters(enabledPlugins, services);
}

/**
 * Tear the current set down and load it again, optionally picking up edited plugin files.
 * `initialize()` alone reuses whatever node has already cached.
 */
async function reload(options = {}) {
  const pluginsDir = options.pluginsDir || state.pluginsDir || path.resolve(__dirname, "../../plugins");

  await shutdown();

  if (options.reloadModules === true) {
    for (const candidate of _discoverPluginCandidates(pluginsDir)) {
      try {
        delete require.cache[require.resolve(candidate.entryFile)];
      } catch (error) {
        logError("Plugin runtime: failed to evict plugin from the require cache", {
          pluginFile: candidate.entryFile,
          error: error.message,
        });
      }
    }
  }

  initialize({
    pluginsDir,
    manifestPath: options.manifestPath || state.manifestPath,
    services: _isObject(options.services) ? options.services : state.services,
    allowCodeDeclaredDiscovery: options.allowCodeDeclaredDiscovery === true,
  });

  return getPlugins();
}

function _attachRequestHooks(app) {
  app.use((req, res, next) => {
    // Read the live list rather than a snapshot, so a reload cannot leave the request
    // path running plugins the event path has already dropped.
    const hooks = state.requestHooks;
    if (hooks.length === 0) {
      return next();
    }

    req.pluginContext = req.pluginContext || {};

    for (const plugin of hooks) {
      let result;

      try {
        result = plugin.onRequest({
          req,
          res,
          pluginContext: req.pluginContext,
          config: plugin.config,
          services: state.services,
          logInfo,
          logError,
          logDebug,
        });
        _warnOnPromise(plugin, "onRequest", result);
      } catch (error) {
        // Per plugin, so one bad hook cannot cancel the plugins ordered after it, and the
        // log says which one to go and look at.
        logError("Plugin runtime: onRequest failed", { plugin: plugin.name, error: error.message });

        if (res.headersSent) {
          return undefined;
        }
        continue;
      }

      if (res.headersSent) {
        return undefined;
      }

      if (result === false) {
        // `false` means "stop the other plugins". A plugin that stops the chain without
        // answering used to strand the request until the client gave up.
        logDebug("Plugin runtime: onRequest stopped the plugin chain without answering", {
          plugin: plugin.name,
          method: req.method,
          path: req.originalUrl || req.path,
        });
        break;
      }
    }

    return next();
  });
}

function _attachResponseHooks(app) {
  app.use((req, res, next) => {
    const hooks = state.responseHooks;
    if (hooks.length === 0) {
      // Nothing to observe, so `res.json` and `res.send` are left alone. In the shipped
      // configuration every plugin is disabled, and this is the branch that runs.
      return next();
    }

    let hooksApplied = false;

    /**
     * @param replaceable json/send can adopt a hook's returned body. The `end` path cannot:
     *   it carries encodings and stream chunks, so hooks there only observe.
     */
    const applyResponseHooks = (responseBody, responseType, replaceable) => {
      if (hooksApplied) {
        return responseBody;
      }
      hooksApplied = true;

      let body = responseBody;

      for (const plugin of hooks) {
        try {
          const result = plugin.onResponse({
            req,
            res,
            responseBody: body,
            responseType,
            pluginContext: req.pluginContext || {},
            config: plugin.config,
            services: state.services,
            logInfo,
            logError,
            logDebug,
          });

          if (replaceable && result !== undefined) {
            body = result;
          }
        } catch (error) {
          logError("Plugin runtime: onResponse failed", {
            plugin: plugin.name,
            error: error.message,
          });
        }
      }

      return body;
    };

    const originalJson = res.json;
    const originalSend = res.send;
    const originalEnd = res.end;

    res.json = function patchedJson(...args) {
      if (args.length === 0) {
        return originalJson.apply(this, args);
      }

      const [body, ...rest] = args;
      return originalJson.call(this, applyResponseHooks(body, "json", true), ...rest);
    };

    res.send = function patchedSend(...args) {
      if (args.length === 0) {
        return originalSend.apply(this, args);
      }

      const [body, ...rest] = args;
      return originalSend.call(this, applyResponseHooks(body, "send", true), ...rest);
    };

    res.end = function patchedEnd(...args) {
      // The last choke point: sendFile (every HTML page), redirects, streams and bodyless
      // responses never reach json or send, and used to skip onResponse entirely.
      const chunk = typeof args[0] === "string" || Buffer.isBuffer(args[0]) ? args[0] : undefined;
      applyResponseHooks(chunk, "end", false);
      return originalEnd.apply(this, args);
    };

    return next();
  });
}

function _attachPluginRoutes(app) {
  app.use(`${PLUGIN_ROUTE_NAMESPACE}/:pluginName`, (req, res, next) => {
    const router = state.pluginRouters.get(req.params.pluginName);
    if (!router) {
      return next();
    }

    return router(req, res, next);
  });
}

function attach(app) {
  if (!state.initialized) {
    // Initializing here used to happen silently, with no services, so any plugin that
    // needed one loaded and did nothing. A missing initialize is a wiring mistake.
    throw new Error("Plugin runtime: attach(app) called before initialize(). Call initialize({ services }) first.");
  }

  _attachRequestHooks(app);
  _attachResponseHooks(app);
  _attachPluginRoutes(app);
}

async function shutdown() {
  _clearEventSubscriptions();

  for (const plugin of state.plugins.filter((candidate) => candidate.enabled)) {
    try {
      await _shutdownPlugin(plugin);
    } catch (error) {
      logError("Plugin runtime: plugin shutdown failed", { plugin: plugin.name, error: error.message });
    }
  }

  // Cleared so a following initialize (or a second shutdown) cannot shut the same
  // instances down twice. Nothing is loaded any more, and getPlugins() says so.
  state.plugins = [];
  state.requestHooks = [];
  state.responseHooks = [];
  state.pluginRouters = new Map();
  state.initialized = false;
}

function getPlugins() {
  return state.plugins.map((plugin) => ({
    name: plugin.name,
    enabled: plugin.enabled,
    order: Number.isFinite(plugin.order) ? plugin.order : DEFAULT_ORDER,
    enabledBy: plugin.enabledBy,
    hooks: HOOK_NAMES.filter((hook) => typeof plugin[hook] === "function"),
    routeMountPath: state.pluginRouters.has(plugin.name) ? `${PLUGIN_ROUTE_NAMESPACE}/${plugin.name}` : null,
  }));
}

module.exports = {
  initialize,
  reload,
  attach,
  shutdown,
  getPlugins,

  HOOK_NAMES,
  PLUGIN_ROUTE_NAMESPACE,

  // Expose private helpers for property-based tests
  _isObject,
  _loadManifest,
  _loadPluginManifest,
  _resolveEnabled,
  _resolveConfig,
  _resolveOrder,
  _mergeConfig,
  _isAutoDiscoverable,
  _detectCollisions,
  _validateManifest,
  _validateConventionalConfig,
};
