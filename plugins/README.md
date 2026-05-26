# Plugins

This folder contains application plugins that can be loaded by the **plugin runtime**.

## How plugins are discovered

The runtime scans `plugins/` for subdirectories containing an `index.js` entrypoint.

A plugin is **loaded/discovered** if **either**:

- It is listed in the global manifest: `plugins.manifest.json`, **or**
- It is marked `autoDiscoverable: true` in either:
  - the plugin code export (`plugins/<name>/index.js`), or
  - the plugin-local manifest (`plugins/<name>/plugin.manifest.json`)

Discovery only answers **"does the runtime load this plugin at all?"**.
Whether the loaded plugin is actually **enabled** is resolved separately.

| In global manifest? | `autoDiscoverable: true` in code or local manifest? | Loaded by runtime? | Notes                                                      |
| ------------------- | --------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Yes                 | Yes                                                 | Yes                | Global manifest registration is enough to load it.         |
| Yes                 | No                                                  | Yes                | Still loaded because it is explicitly registered.          |
| No                  | Yes                                                 | Yes                | Auto-discovery allows loading without global registration. |
| No                  | No                                                  | No                 | The runtime skips it as unregistered.                      |

## Enable / disable precedence

The runtime resolves `enabled` using the following precedence (highest wins):

1. **Global manifest** (`plugins.manifest.json`) - overrides everything
2. **Local plugin manifest** (`plugins/<name>/plugin.manifest.json`)
3. **Plugin code default** (`plugins/<name>/index.js`)
4. **Fallback**: if `enabled` is not specified anywhere, the plugin defaults to **disabled**

> This is why you may see `enabled` in both `index.js` and `plugin.manifest.json` (or the global manifest). The manifest is the authoritative “runtime config” layer.

So if a plugin has `enabled: false` in `plugins/<name>/index.js`, but `plugins.manifest.json` says `enabled: true`, the plugin is **enabled**. The **global manifest wins**.

| Global manifest `enabled` | Local manifest `enabled` | Code `enabled` | Final result | Why                                        |
| ------------------------- | ------------------------ | -------------- | ------------ | ------------------------------------------ |
| `true`                    | `false`                  | `false`        | **Enabled**  | Global manifest wins.                      |
| `false`                   | `true`                   | `true`         | **Disabled** | Global manifest wins.                      |
| _unset_                   | `true`                   | `false`        | **Enabled**  | Local manifest wins when global is absent. |
| _unset_                   | _unset_                  | `false`        | **Disabled** | Code default is used.                      |
| _unset_                   | _unset_                  | _unset_        | **Disabled** | Final fallback is disabled.                |

## Plugin structure

Each plugin should export an object with at least:

- `name` (string)
- `init({ logInfo, logError, logDebug, config })` (optional)
- `enabled` (boolean, optional; default is `false`)
- `order` (number, optional; used to sort plugin init order)
  - Lower numbers run earlier; the runtime sorts plugins ascending by `order`.
  - If omitted, a plugin defaults to `order: 1000`.
  - When multiple plugins share the same `order`, their relative init order is not explicitly guaranteed.

Plugins can optionally implement:

- `onRequest({ req, res, pluginContext, config, logInfo, logError, logDebug })` to hook into HTTP request processing.
- `onResponse({ req, res, responseBody, responseType, pluginContext, config, logInfo, logError, logDebug })` to inspect or modify outgoing responses.
- `onEvent({ event, eventType, pluginContext, config, services, logInfo, logError, logDebug })` to listen for notification-center events.

To scope event listeners, set `config.eventTypes` to a string or array of notification event types. If omitted, the plugin will receive all notification-center events.

## Examples

- `auto-discoverable-plugin/` is configured to be auto-discovered and disabled by default.
- `response-size-logger-plugin/` and `startup-info-plugin/` are simple, manual plugins that may be enabled via `plugins.manifest.json`.
- `teapot-blocker-plugin/` is an auto-discoverable runtime plugin that intercepts every request in `onRequest`, returns HTTP 418, and stops further middleware/routing.
