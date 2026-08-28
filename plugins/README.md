# Plugins

This folder contains application plugins that can be loaded by the **plugin runtime**
(`modules/plugin-runtime/index.js`).

## How plugins are discovered

The runtime scans `plugins/` for subdirectories containing an `index.js` entrypoint, and
decides whether to load each one **before requiring it**. That is deliberate: a directory
nobody registered must not get the chance to run code just by being dropped in here.

Because the decision happens before the require, reachability has to be readable from JSON.
A plugin is **loaded** if **either**:

- it is a key in the global manifest `plugins.manifest.json`, or
- its own `plugins/<name>/plugin.manifest.json` says `"autoDiscoverable": true`.

`autoDiscoverable: true` in plugin **code** is not enough, because reading it means running
the file. Start the runtime with `initialize({ allowCodeDeclaredDiscovery: true })` to fall
back to the old behaviour, which reopens exactly that hole.

Discovery only answers **"does the runtime load this plugin at all?"**. Whether a loaded
plugin is **enabled** is resolved separately.

| In global manifest? | `autoDiscoverable: true` in the local manifest? | Loaded? | Notes                                                  |
| ------------------- | ----------------------------------------------- | ------- | ------------------------------------------------------ |
| Yes                 | Yes                                             | Yes     | Manifest registration alone is enough.                 |
| Yes                 | No                                              | Yes     | Still loaded, because it is explicitly registered.     |
| No                  | Yes                                             | Yes     | The plugin opts itself in without global registration. |
| No                  | No                                              | No      | Skipped as unregistered, and never required.           |

## Enable / disable precedence

`enabled`, `config` and `order` all resolve through the same chain (highest wins):

1. **Global manifest** (`plugins.manifest.json`)
2. **Local plugin manifest** (`plugins/<name>/plugin.manifest.json`)
3. **Plugin code default** (`plugins/<name>/index.js`)
4. **Fallback**: `enabled` unspecified anywhere means **disabled**; `order` unspecified means
   `1000`; `config` layers deep-merge, with arrays replaced whole rather than merged.

> This is why you may see `enabled` in both `index.js` and a manifest. The manifest is the
> authoritative runtime config layer, and the code value is a default.

| Global manifest `enabled` | Local manifest `enabled` | Code `enabled` | Result       | Why                                        |
| ------------------------- | ------------------------ | -------------- | ------------ | ------------------------------------------ |
| `true`                    | `false`                  | `false`        | **Enabled**  | Global manifest wins.                      |
| `false`                   | `true`                   | `true`         | **Disabled** | Global manifest wins.                      |
| _unset_                   | `true`                   | `false`        | **Enabled**  | Local manifest wins when global is absent. |
| _unset_                   | _unset_                  | `false`        | **Disabled** | Code default is used.                      |
| _unset_                   | _unset_                  | _unset_        | **Disabled** | Final fallback is disabled.                |

The shipped `plugins.manifest.json` carries **registration and `enabled` only**. Every
default value lives in the plugin's own `config` block, because the manifest is an override
layer: a value repeated there is duplication somebody has to keep in sync by hand, and a
value with no code default cannot be checked against anything.
`tests/unit/plugins.contract.test.js` enforces both rules.

A manifest entry may carry `enabled`, `config` and `order`. Any other key is ignored, and the
runtime warns about it at startup, along with entries naming a directory that is not there.

## Plugin structure

Each plugin exports an object. Only `name` is required, and it has to match the directory
name, because both manifests key by name.

- `name` (string, required)
- `enabled` (boolean, optional, default `false`)
- `order` (number, optional, default `1000`) sorts the run sequence, lower first. Plugins
  sharing an order run in name order, and the runtime logs a warning naming both.
- `config` (object, optional) default values for the manifest layers to override.

The runtime loads a **shallow copy** of this object, so `this` inside a hook is a per-load
instance: state stored on `this` in `init` is visible to the other hooks, and is not the same
object other code sees when it requires the file directly.

### Hooks

All six are optional. Only `shutdown` is awaited; the rest are called synchronously, and a
hook that returns a promise is logged as a mistake rather than awaited.

| Hook                                                       | When it runs and what it may do                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init({ config, services, ...loggers })`                   | Once at startup, for enabled plugins.                                                                                                                                                                                                                      |
| `registerRoutes({ router, config, services, ...loggers })` | Once at startup. The Express router is mounted at `/api/v1/plugins/<name>`, so plugin routes cannot shadow core routes. Prefer this over matching paths inside `onRequest`.                                                                                |
| `onRequest({ req, res, pluginContext, config, services })` | Per request, before the route handlers. Return `false` to stop the remaining plugins; if nothing answered, the runtime continues to the routes rather than leaving the request hanging. One plugin throwing does not cancel the plugins ordered after it.  |
| `onResponse({ req, res, responseBody, responseType, … })`  | Before the body goes out. `responseType` is `"json"` or `"send"` when the body came from `res.json` / `res.send`, where returning a value **replaces** the body, and `"end"` for everything else (sendFile, redirects, streams), where hooks observe only. |
| `onEvent({ event, eventType, pluginState, config, … })`    | Per notification-center event, filtered by `config.eventTypes`. An empty list means every event. This is the only place the runtime reads the filter.                                                                                                      |
| `shutdown({ config, ...loggers })`                         | On graceful shutdown, and again before a reload replaces the plugin. Clear timers and handles here.                                                                                                                                                        |

`pluginContext` in `onRequest` and `onResponse` is per-request state. The event hooks get
`pluginState` instead, which lives as long as the load. They are separate objects with
separate lifetimes, which is why they have separate names, and state that both a request and
an event need belongs on `this`.

### Runtime notes

- `attach(app)` throws if `initialize()` has not run, rather than loading every plugin with
  no injected services.
- `initialize()` shuts the previously loaded set down before loading again, so a second call
  cannot leave a plugin's timers running with nothing holding a handle on them.
  `reload({ reloadModules: true })` also evicts plugin files from the require cache.
- When no enabled plugin declares `onResponse`, `res.json` and `res.send` are left untouched.
- At startup the runtime warns about collisions (two enabled plugins sharing an `order` or a
  `config.routePath`, two plugins sharing a name) and about the three config keys it
  understands being the wrong shape: `routePath`, `routePaths`, `eventTypes`.

## Examples

- `plugin-template/` is the starting point for a new plugin, with every hook stubbed and the
  contract written out.
- `sample-plugin-route/` is the reference for a plugin that owns endpoints: it uses
  `registerRoutes`, so its routes live under `/api/v1/plugins/sample-plugin-route`.
- `auto-discoverable-plugin/` opts itself in through its own `plugin.manifest.json`, and is
  disabled by default.
- `response-size-logger-plugin/` and `startup-info-plugin/` are simple observers. Like every
  bundled plugin they ship disabled, in both their code and the manifest.
- `secret-garden-route-plugin/`, `firefly-notification-plugin/`, `harvest-moon-header-plugin/`,
  `barn-whisper-ping-plugin/` and `starlit-statistics-plugin/` are the easter eggs, and are
  covered end to end in `tests/unit/plugin-runtime.easter-eggs.test.js`.
- `teapot-blocker-plugin/` answers every request with HTTP 418 and stops the pipeline. It is
  registered **nowhere**, in neither manifest, so the runtime never even requires it. Enabling
  it takes a deliberate manifest entry, which is the point.

## Tests

`npm run plugins:test` runs the plugin suites: the loader, the per-plugin hook decisions, the
easter eggs over HTTP, the regression tests for the mistakes the runtime has to survive, and
the property tests on the precedence helpers.
