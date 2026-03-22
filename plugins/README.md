# Plugins

This folder contains application plugins that can be loaded by the **plugin runtime**.

## How plugins are discovered

The runtime scans `plugins/` for subdirectories containing an `index.js` entrypoint.

A plugin will be loaded if **either**:

- It is listed in the global manifest: `plugins.manifest.json`, **or**
- It is marked `autoDiscoverable: true` in either:
  - the plugin code export (`plugins/<name>/index.js`), or
  - the plugin-local manifest (`plugins/<name>/plugin.manifest.json`)

## Enable / disable precedence

The runtime resolves `enabled` using the following precedence (highest wins):

1. **Global manifest** (`plugins.manifest.json`) - overrides everything
2. **Local plugin manifest** (`plugins/<name>/plugin.manifest.json`)
3. **Plugin code default** (`plugins/<name>/index.js`)
4. **Fallback**: if `enabled` is not specified anywhere, the plugin defaults to **enabled**

> This is why you may see `enabled` in both `index.js` and `plugin.manifest.json` (or the global manifest). The manifest is the authoritative “runtime config” layer.

## Plugin structure

Each plugin should export an object with at least:

- `name` (string)
- `init({ logInfo, logError, logDebug, config })` (optional)
- `enabled` (boolean, optional; default is `true`)
- `order` (number, optional; used to sort plugin init order)
  - Lower numbers run earlier; the runtime sorts plugins ascending by `order`.
  - If omitted, a plugin defaults to `order: 1000`.
  - When multiple plugins share the same `order`, their relative init order is not explicitly guaranteed.

Plugins can optionally implement:

- `onRequest({ req, res, pluginContext, config, logInfo, logError, logDebug })` to hook into HTTP request processing.

## Examples

- `auto-discoverable-plugin/` is configured to be auto-discovered and disabled by default.
- `response-size-logger-plugin/` and `startup-info-plugin/` are simple, manual plugins that may be enabled via `plugins.manifest.json`.
- `teapot-blocker-plugin/` is an auto-discoverable runtime plugin that intercepts every request in `onRequest`, returns HTTP 418, and stops further middleware/routing.
