const { existsSync, readdirSync, statSync, readFileSync } = require("fs");
const path = require("path");
const { logInfo, logError, logDebug } = require("../../helpers/logger-api");

/**
 * Plugin runtime configuration precedence (highest to lowest):
 *
 * 1) Global manifest (`plugins.manifest.json`) - overrides everything.
 * 2) Local plugin manifest (`plugins/<plugin>/plugin.manifest.json`) - overrides code defaults.
 * 3) Plugin code defaults (`plugins/<plugin>/index.js`) - used when no manifest overrides.
 * 4) Fallback - if `enabled` is not explicitly set anywhere, the plugin defaults to enabled.
 *
 * This is why you can have `enabled` in both the plugin code and the manifest; the manifest
 * always wins, and the code value is treated as a default.
 */

const DEFAULT_MANIFEST_FILE = "plugins.manifest.json";
const DEFAULT_PLUGIN_MANIFEST_FILE = "plugin.manifest.json";

const state = {
  initialized: false,
  plugins: [],
  pluginsDir: null,
  manifestPath: null,
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
  return true;
}

function _resolveConfig(pluginDef, localPluginConfig, globalManifestPluginConfig) {
  const codeConfig = _isObject(pluginDef.config) ? pluginDef.config : {};
  const localConfig = _isObject(localPluginConfig) && _isObject(localPluginConfig.config) ? localPluginConfig.config : {};
  const globalConfig =
    _isObject(globalManifestPluginConfig) && _isObject(globalManifestPluginConfig.config) ? globalManifestPluginConfig.config : {};

  return {
    ...codeConfig,
    ...localConfig,
    ...globalConfig,
  };
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

function _discoverPluginEntryFiles(pluginsDir) {
  if (!pluginsDir || !existsSync(pluginsDir)) {
    return [];
  }

  const entries = readdirSync(pluginsDir, { withFileTypes: true });
  const pluginEntryFiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginIndex = path.join(pluginsDir, entry.name, "index.js");
    if (existsSync(pluginIndex) && statSync(pluginIndex).isFile()) {
      pluginEntryFiles.push(pluginIndex);
    }
  }

  return pluginEntryFiles;
}

function initialize(options = {}) {
  const pluginsDir = options.pluginsDir || path.resolve(__dirname, "../../plugins");
  const manifestPath = options.manifestPath || path.join(pluginsDir, DEFAULT_MANIFEST_FILE);

  const manifest = _loadManifest(manifestPath);
  const pluginFiles = _discoverPluginEntryFiles(pluginsDir);
  const loaded = [];

  for (const pluginFile of pluginFiles) {
    try {
      const pluginDef = _safeRequire(pluginFile);
      if (!pluginDef || typeof pluginDef !== "object") {
        logError("Plugin runtime: plugin does not export an object", { pluginFile });
        continue;
      }

      const pluginName = pluginDef.name;
      if (!pluginName || typeof pluginName !== "string") {
        logError("Plugin runtime: plugin has invalid or missing name", { pluginFile });
        continue;
      }

      const localPluginManifestPath = path.join(path.dirname(pluginFile), DEFAULT_PLUGIN_MANIFEST_FILE);
      const localPluginConfig = _loadPluginManifest(localPluginManifestPath);
      const isInGlobalManifest = Object.prototype.hasOwnProperty.call(manifest.plugins, pluginName);
      const globalManifestPluginConfig = isInGlobalManifest ? manifest.plugins[pluginName] : {};
      const isAutoDiscoverable = _isAutoDiscoverable(pluginDef, localPluginConfig);

      if (!isInGlobalManifest && !isAutoDiscoverable) {
        logDebug("Plugin runtime: skipping unregistered plugin", {
          plugin: pluginName,
          pluginFile,
          reason: "not-in-global-manifest-and-not-auto-discoverable",
        });
        continue;
      }

      const enabled = _resolveEnabled(pluginDef, localPluginConfig, globalManifestPluginConfig);
      const config = _resolveConfig(pluginDef, localPluginConfig, globalManifestPluginConfig);

      loaded.push({
        ...pluginDef,
        enabled,
        config,
      });
    } catch (error) {
      logError("Plugin runtime: failed loading plugin", { pluginFile, error: error.message });
    }
  }

  loaded.sort((a, b) => {
    const aOrder = Number.isFinite(a.order) ? a.order : 1000;
    const bOrder = Number.isFinite(b.order) ? b.order : 1000;
    return aOrder - bOrder;
  });

  state.plugins = loaded;
  state.initialized = true;
  state.pluginsDir = pluginsDir;
  state.manifestPath = manifestPath;

  const enabledPlugins = loaded.filter((p) => p.enabled).map((p) => p.name);
  const disabledPlugins = loaded.filter((p) => !p.enabled).map((p) => p.name);

  logInfo("Plugin runtime initialized");
  logDebug("Plugin runtime initialized", {
    pluginsDir,
    manifestPath,
    loadedPlugins: loaded.map((p) => p.name),
    enabledPlugins,
    disabledPlugins,
  });

  for (const plugin of loaded) {
    if (!plugin.enabled || typeof plugin.init !== "function") {
      continue;
    }

    try {
      plugin.init({ logInfo, logError, logDebug, config: plugin.config });
    } catch (error) {
      logError("Plugin runtime: plugin init failed", { plugin: plugin.name, error: error.message });
    }
  }
}

function attach(app) {
  if (!state.initialized) {
    initialize();
  }

  const activePlugins = state.plugins.filter((plugin) => plugin.enabled);

  app.use((req, res, next) => {
    req.pluginContext = req.pluginContext || {};

    try {
      for (const plugin of activePlugins) {
        if (typeof plugin.onRequest !== "function") {
          continue;
        }

        const result = plugin.onRequest({
          req,
          res,
          pluginContext: req.pluginContext,
          config: plugin.config,
          logInfo,
          logError,
          logDebug,
        });

        if (result === false) {
          return;
        }

        if (res.headersSent) {
          return;
        }
      }
    } catch (error) {
      logError("Plugin runtime: onRequest failed", { error: error.message });
    }

    next();
  });

  app.use((req, res, next) => {
    let hooksApplied = false;

    const applyResponseHooks = ({ responseBody, responseType }) => {
      if (hooksApplied) {
        return;
      }
      hooksApplied = true;

      for (const plugin of activePlugins) {
        if (typeof plugin.onResponse !== "function") {
          continue;
        }

        try {
          plugin.onResponse({
            req,
            res,
            responseBody,
            responseType,
            pluginContext: req.pluginContext || {},
            config: plugin.config,
            logInfo,
            logError,
            logDebug,
          });
        } catch (error) {
          logError("Plugin runtime: onResponse failed", {
            plugin: plugin.name,
            error: error.message,
          });
        }
      }
    };

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body) => {
      applyResponseHooks({ responseBody: body, responseType: "json" });
      return originalJson(body);
    };

    res.send = (body) => {
      applyResponseHooks({ responseBody: body, responseType: "send" });
      return originalSend(body);
    };

    next();
  });
}

async function shutdown() {
  const activePlugins = state.plugins.filter((plugin) => plugin.enabled);

  for (const plugin of activePlugins) {
    if (typeof plugin.shutdown !== "function") {
      continue;
    }

    try {
      await plugin.shutdown({ logInfo, logError, logDebug, config: plugin.config });
    } catch (error) {
      logError("Plugin runtime: plugin shutdown failed", { plugin: plugin.name, error: error.message });
    }
  }
}

function getPlugins() {
  return state.plugins.map((plugin) => ({
    name: plugin.name,
    enabled: plugin.enabled,
    order: Number.isFinite(plugin.order) ? plugin.order : 1000,
  }));
}

module.exports = {
  initialize,
  attach,
  shutdown,
  getPlugins,
};
