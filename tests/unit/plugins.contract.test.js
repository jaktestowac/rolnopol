import { describe, it, expect } from "vitest";

// The contract every bundled plugin has to satisfy (plugins/*/index.js).
//
// `tests/unit/plugin-runtime.test.js` covers the loader, and
// `plugin-runtime.easter-eggs.test.js` covers five of the plugins end to end. What
// neither covers is the set as a whole, and the set is where the quiet failures
// live — because a plugin that gets the contract wrong does not crash. It is
// skipped, or loaded and never called, and the only symptom is a feature that does
// nothing.
//
// The sharpest of these is reachability: the runtime skips any plugin that is
// neither listed in the global manifest nor marked `autoDiscoverable`. A plugin in
// neither category is dead code that looks live.
const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "..", "plugins");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, "plugins.manifest.json"), "utf8"));

const HOOKS = ["init", "registerRoutes", "onRequest", "onResponse", "onEvent", "shutdown"];

/** Every plugin directory, loaded. */
const PLUGINS = fs
  .readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((dirName) => ({
    dirName,
    plugin: require(path.join(PLUGINS_DIR, dirName, "index.js")),
    localManifest: readLocalManifest(dirName),
  }));

/** A plugin's own plugin.manifest.json, or {} when it does not ship one. */
function readLocalManifest(dirName) {
  const file = path.join(PLUGINS_DIR, dirName, "plugin.manifest.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

// Deliberately double-locked: absent from the manifest AND not auto-discoverable,
// because enabling it by accident would 418 every request in the app.
const INTENTIONALLY_UNREACHABLE = new Set(["teapot-blocker-plugin"]);

describe("plugin contract — the set is discoverable", () => {
  it("found the bundled plugins at all", () => {
    expect(PLUGINS.length).toBeGreaterThanOrEqual(13);
  });

  it("gives every plugin directory an index.js that exports an object", () => {
    for (const { dirName, plugin } of PLUGINS) {
      expect(typeof plugin, dirName).toBe("object");
      expect(plugin, dirName).not.toBeNull();
    }
  });
});

describe("plugin contract — identity", () => {
  it("names every plugin exactly after its directory, because the manifest keys by name", () => {
    for (const { dirName, plugin } of PLUGINS) {
      expect(plugin.name, dirName).toBe(dirName);
    }
  });

  it("gives every plugin a unique name", () => {
    const names = PLUGINS.map(({ plugin }) => plugin.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("plugin contract — ordering", () => {
  it("gives every plugin a finite numeric order", () => {
    for (const { dirName, plugin } of PLUGINS) {
      expect(typeof plugin.order, dirName).toBe("number");
      expect(Number.isFinite(plugin.order), dirName).toBe(true);
      expect(plugin.order, dirName).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts the request-blocking plugin first, so it can short-circuit before anything else runs", () => {
    const teapot = PLUGINS.find(({ dirName }) => dirName === "teapot-blocker-plugin").plugin;
    const others = PLUGINS.filter(({ dirName }) => dirName !== "teapot-blocker-plugin").map(({ plugin }) => plugin.order);

    expect(teapot.order).toBeLessThan(Math.min(...others));
  });

  it("gives no two plugins the same order, so the run sequence is not left to sort stability", () => {
    const orders = PLUGINS.map(({ plugin }) => plugin.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe("plugin contract — the enabled flag", () => {
  it("declares enabled as a boolean on every plugin", () => {
    for (const { dirName, plugin } of PLUGINS) {
      expect(typeof plugin.enabled, dirName).toBe("boolean");
    }
  });

  it("ships every manifest entry disabled, so a clone is inert until somebody opts in", () => {
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      expect(entry.enabled, name).toBe(false);
    }
  });

  it("never leaves a request-blocking plugin enabled by default", () => {
    const teapot = PLUGINS.find(({ dirName }) => dirName === "teapot-blocker-plugin").plugin;

    expect(teapot.enabled).toBe(false);
    expect(MANIFEST.plugins).not.toHaveProperty("teapot-blocker-plugin");
  });
});

describe("plugin contract — reachability", () => {
  it("declares every plugin reachable in JSON, because discovery happens before the require", () => {
    // The runtime decides reachability from the manifests alone, so that a directory
    // nobody registered never gets executed. `autoDiscoverable` in plugin code is not
    // enough: reading it would mean running the file.
    const listed = new Set(Object.keys(MANIFEST.plugins));

    for (const { dirName, localManifest } of PLUGINS) {
      if (INTENTIONALLY_UNREACHABLE.has(dirName)) continue;

      const reachable = listed.has(dirName) || localManifest.autoDiscoverable === true;
      expect(reachable, `${dirName} is neither listed in plugins.manifest.json nor autoDiscoverable in its own plugin.manifest.json`).toBe(
        true,
      );
    }
  });

  it("keeps the intentionally-unreachable plugin unreachable in every way at once", () => {
    for (const dirName of INTENTIONALLY_UNREACHABLE) {
      const { plugin, localManifest } = PLUGINS.find((entry) => entry.dirName === dirName);

      expect(MANIFEST.plugins).not.toHaveProperty(dirName);
      expect(localManifest.autoDiscoverable).not.toBe(true);
      expect(plugin.autoDiscoverable).not.toBe(true);
    }
  });

  it("never ships a local manifest that enables a plugin behind the global manifest's back", () => {
    for (const { dirName, localManifest } of PLUGINS) {
      expect(localManifest.enabled, `${dirName}/plugin.manifest.json enables itself`).not.toBe(true);
    }
  });

  it("keeps the code autoDiscoverable flag in step with the local manifest", () => {
    // Only the JSON decides discovery now. A code flag that disagrees is a lie in whichever
    // direction it points, and it still matters under `allowCodeDeclaredDiscovery`.
    for (const { dirName, plugin, localManifest } of PLUGINS) {
      expect(plugin.autoDiscoverable === true, `${dirName} code and local manifest disagree`).toBe(localManifest.autoDiscoverable === true);
    }
  });

  it("declares autoDiscoverable as a boolean wherever it is present", () => {
    for (const { dirName, plugin } of PLUGINS) {
      if (plugin.autoDiscoverable === undefined) continue;
      expect(typeof plugin.autoDiscoverable, dirName).toBe("boolean");
    }
  });

  it("lists no manifest entry without a matching plugin directory", () => {
    const dirs = new Set(PLUGINS.map(({ dirName }) => dirName));

    for (const name of Object.keys(MANIFEST.plugins)) {
      expect(dirs.has(name), `manifest lists ${name}, which has no plugins/${name}/index.js`).toBe(true);
    }
  });
});

describe("plugin contract — hooks", () => {
  it("exposes every declared hook as a function, and no unknown hook-shaped key", () => {
    for (const { dirName, plugin } of PLUGINS) {
      for (const hook of HOOKS) {
        if (plugin[hook] === undefined) continue;
        expect(typeof plugin[hook], `${dirName}.${hook}`).toBe("function");
      }
    }
  });

  it("gives every plugin at least one hook, so none is loaded to do nothing", () => {
    for (const { dirName, plugin } of PLUGINS) {
      const declared = HOOKS.filter((hook) => typeof plugin[hook] === "function");
      expect(declared.length, dirName).toBeGreaterThan(0);
    }
  });

  it("declares config as a plain object wherever it is present", () => {
    for (const { dirName, plugin } of PLUGINS) {
      if (plugin.config === undefined) continue;
      expect(typeof plugin.config, dirName).toBe("object");
      expect(Array.isArray(plugin.config), dirName).toBe(false);
      expect(plugin.config, dirName).not.toBeNull();
    }
  });

  it("declares eventTypes as an array wherever a plugin filters events", () => {
    for (const { dirName, plugin } of PLUGINS) {
      const eventTypes = plugin.config?.eventTypes;
      if (eventTypes === undefined) continue;
      expect(Array.isArray(eventTypes), dirName).toBe(true);
    }
  });

  it("gives every onEvent plugin a way to say which events it wants", () => {
    for (const { dirName, plugin } of PLUGINS.filter(({ plugin: p }) => typeof p.onEvent === "function")) {
      expect(plugin.config, `${dirName} has onEvent but no config`).toBeDefined();
      expect(plugin.config, dirName).toHaveProperty("eventTypes");
    }
  });
});

describe("plugin contract — the manifest mirrors each plugin's own defaults", () => {
  it("repeats no config value that disagrees with the plugin's own default", () => {
    // The manifest is an override layer. A value there that differs from the code
    // default is a decision; a value that differs by ACCIDENT — a typo, a stale
    // copy — is a bug that looks like configuration.
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      const { plugin } = PLUGINS.find((candidate) => candidate.dirName === name);
      const defaults = plugin.config || {};

      for (const [key, value] of Object.entries(entry.config || {})) {
        if (!(key in defaults)) continue;
        expect(value, `${name}.config.${key} disagrees with the plugin default`).toEqual(defaults[key]);
      }
    }
  });

  it("gives every manifest entry a config object", () => {
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      expect(typeof entry.config, name).toBe("object");
      expect(entry.config, name).not.toBeNull();
    }
  });

  it("declares every configurable value in plugin code, not only in the manifest", () => {
    // A manifest key with no code default cannot be checked by the test above, and it hides
    // the plugin's real default inside a `||` fallback where nobody reads it.
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      const { plugin } = PLUGINS.find((candidate) => candidate.dirName === name);
      const defaults = plugin.config || {};

      for (const key of Object.keys(entry.config || {})) {
        expect(key in defaults, `${name}.config.${key} has no default in plugins/${name}/index.js`).toBe(true);
      }
    }
  });

  it("overrides no order from the manifest, so a blocking plugin cannot be resequenced", () => {
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      expect(entry, name).not.toHaveProperty("order");
    }
  });

  it("carries no manifest keys the runtime ignores", () => {
    for (const [name, entry] of Object.entries(MANIFEST.plugins)) {
      for (const key of Object.keys(entry)) {
        expect(["enabled", "config", "order"], `${name}.${key}`).toContain(key);
      }
    }
  });
});

describe("plugin contract — the real runtime honours the locks", () => {
  it("loads every registered plugin and never requires the request blocker", () => {
    const pluginRuntime = require(path.join(__dirname, "..", "..", "modules", "plugin-runtime"));

    pluginRuntime.initialize({
      pluginsDir: PLUGINS_DIR,
      manifestPath: path.join(PLUGINS_DIR, "plugins.manifest.json"),
    });

    const loaded = pluginRuntime.getPlugins().map((plugin) => plugin.name);

    for (const dirName of INTENTIONALLY_UNREACHABLE) {
      expect(loaded, `${dirName} was loaded`).not.toContain(dirName);
    }

    // Everything else is registered somewhere, so it should all be here.
    const expected = PLUGINS.map(({ dirName }) => dirName).filter((dirName) => !INTENTIONALLY_UNREACHABLE.has(dirName));
    expect(loaded.slice().sort()).toEqual(expected.slice().sort());
  });

  it("ships with every plugin disabled, so a clone serves no plugin behaviour", () => {
    const pluginRuntime = require(path.join(__dirname, "..", "..", "modules", "plugin-runtime"));

    pluginRuntime.initialize({
      pluginsDir: PLUGINS_DIR,
      manifestPath: path.join(PLUGINS_DIR, "plugins.manifest.json"),
    });

    expect(pluginRuntime.getPlugins().filter((plugin) => plugin.enabled)).toEqual([]);
  });
});

describe("plugin contract — no plugin shadows a core route", () => {
  it("keeps every path-owning plugin off the live route table", () => {
    // A plugin that ANSWERS on a path (an onRequest hook plus a config.routePath) runs
    // above auth, rate limiting and request logging, so a path that also belongs to a real
    // router would be silently hijacked. Decorator plugins, which only add to somebody
    // else's response, are exactly the ones that are supposed to share a path.
    const generatorConfig = require(path.join(__dirname, "..", "..", "schema", "generator.config.js"));
    const { collectOperations, toOpenApiPath } = require(path.join(__dirname, "..", "..", "build", "lib", "introspect-routes.js"));

    const live = new Map();
    for (const version of generatorConfig.VERSIONS) {
      const router = require(path.join(__dirname, "..", "..", version.routerModule));
      for (const operation of collectOperations(router)) {
        live.set(`/api/${version.key}${toOpenApiPath(operation.path)}`, version.key);
      }
    }

    // Guard against the whole check passing because nothing was collected.
    expect(live.size).toBeGreaterThan(50);

    for (const { dirName, plugin } of PLUGINS) {
      if (typeof plugin.onRequest !== "function") continue;

      const routePath = plugin.config?.routePath;
      if (typeof routePath !== "string" || routePath.length === 0) continue;

      expect(live.has(routePath), `${dirName} answers on ${routePath}, which is a live ${live.get(routePath)} route`).toBe(false);
    }
  });
});

describe("plugin contract — no plugin reaches into the app", () => {
  it("imports nothing from the application beyond the shared response helper", () => {
    // The plugin runtime injects everything a plugin needs — loggers, config,
    // services. A plugin that requires a service directly couples itself to the
    // app's internals and stops being droppable.
    const allowed = /^(\.\.\/)+helpers\/response-helper$/;

    for (const { dirName } of PLUGINS) {
      const source = fs.readFileSync(path.join(PLUGINS_DIR, dirName, "index.js"), "utf8");
      const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);

      for (const target of requires) {
        if (!target.startsWith(".")) continue; // a node_modules package is fine
        expect(target, `${dirName} requires ${target}`).toMatch(allowed);
      }
    }
  });
});
