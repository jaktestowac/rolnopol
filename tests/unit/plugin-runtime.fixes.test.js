import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import request from "supertest";

// One test per failure mode the runtime used to have. Each of these was reproduced against
// the old runtime before the fix, and none of them produced an error at the time: the
// symptom was a hung request, a body that did not change, code running for a plugin nobody
// registered, or a timer nothing could reach.
//
// The plugins here are written to a temp directory rather than added to plugins/, because
// the point of each one is a mistake a plugin author can make, not behaviour worth shipping.
const runtimeModulePath = "../../modules/plugin-runtime";

describe("plugin runtime — the mistakes it has to survive", () => {
  let tempRoot;
  let pluginsDir;
  let manifestPath;
  let pluginRuntime;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rolnopol-plugin-fixes-"));
    pluginsDir = path.join(tempRoot, "plugins");
    manifestPath = path.join(pluginsDir, "plugins.manifest.json");
    await fs.mkdir(pluginsDir, { recursive: true });
    delete global.__pluginProbe;
  });

  afterEach(async () => {
    if (pluginRuntime && typeof pluginRuntime.shutdown === "function") {
      await pluginRuntime.shutdown();
    }
    vi.resetModules();
    delete global.__pluginProbe;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /** Write one plugin directory, optionally with its own manifest. */
  async function writePlugin(name, source, localManifest) {
    const dir = path.join(pluginsDir, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.js"), source, "utf8");
    if (localManifest) {
      await fs.writeFile(path.join(dir, "plugin.manifest.json"), `${JSON.stringify(localManifest, null, 2)}\n`, "utf8");
    }
  }

  async function writeManifest(plugins) {
    await fs.writeFile(manifestPath, `${JSON.stringify({ plugins }, null, 2)}\n`, "utf8");
  }

  /** Initialize against the temp directory and return an app with the hooks attached. */
  function buildApp(options = {}) {
    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath, ...options });

    const app = express();
    app.use(express.json());
    pluginRuntime.attach(app);

    app.get("/ping", (req, res) => res.json({ ok: true }));
    app.get("/page", (req, res) => res.redirect("/ping"));

    return app;
  }

  it("keeps answering when a plugin stops the chain without sending anything", async () => {
    // `false` means "stop the other plugins". A plugin that returns it without answering
    // used to leave the request with no response and no next(), so the socket just sat there.
    await writePlugin(
      "silent-stopper",
      `module.exports = { name: "silent-stopper", order: 10, enabled: true, onRequest() { return false; } };\n`,
    );
    await writeManifest({ "silent-stopper": { enabled: true } });

    const res = await request(buildApp()).get("/ping").expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it("still lets a plugin answer and short-circuit on purpose", async () => {
    await writePlugin(
      "answering-stopper",
      `module.exports = {
  name: "answering-stopper",
  order: 10,
  enabled: true,
  onRequest({ req, res }) {
    if (req.path !== "/ping") return undefined;
    res.status(202).json({ answeredBy: "answering-stopper" });
    return false;
  },
};
`,
    );
    await writeManifest({ "answering-stopper": { enabled: true } });

    const res = await request(buildApp()).get("/ping").expect(202);

    expect(res.body).toEqual({ answeredBy: "answering-stopper" });
  });

  it("sends the body an onResponse hook returns", async () => {
    await writePlugin(
      "body-rewriter",
      `module.exports = {
  name: "body-rewriter",
  order: 10,
  enabled: true,
  onResponse({ responseBody, responseType }) {
    if (responseType !== "json") return undefined;
    return { ...responseBody, addedBy: "body-rewriter" };
  },
};
`,
    );
    await writeManifest({ "body-rewriter": { enabled: true } });

    const res = await request(buildApp()).get("/ping").expect(200);

    expect(res.body).toEqual({ ok: true, addedBy: "body-rewriter" });
  });

  it("leaves the body alone when the hook returns nothing, and still allows mutation in place", async () => {
    await writePlugin(
      "mutator",
      `module.exports = {
  name: "mutator",
  order: 10,
  enabled: true,
  onResponse({ responseBody, responseType }) {
    if (responseType === "json" && responseBody) responseBody.mutated = true;
    return undefined;
  },
};
`,
    );
    await writeManifest({ mutator: { enabled: true } });

    const res = await request(buildApp()).get("/ping").expect(200);

    expect(res.body).toEqual({ ok: true, mutated: true });
  });

  it("fires onResponse for a redirect, which never reaches res.json or res.send", async () => {
    await writePlugin(
      "response-watcher",
      `module.exports = {
  name: "response-watcher",
  order: 10,
  enabled: true,
  onResponse({ req, responseType }) {
    global.__pluginProbe = global.__pluginProbe || [];
    global.__pluginProbe.push(req.path + ":" + responseType);
  },
};
`,
    );
    await writeManifest({ "response-watcher": { enabled: true } });

    await request(buildApp()).get("/page").expect(302);

    expect(global.__pluginProbe).toEqual(["/page:end"]);
  });

  it("never executes a plugin directory that no manifest mentions", async () => {
    // The require used to happen before the reachability check, so the module body of an
    // unregistered plugin ran anyway — and then the plugin was not in getPlugins(), which
    // made it invisible.
    await writePlugin(
      "unregistered",
      `global.__pluginProbe = "module body ran";\nmodule.exports = { name: "unregistered", order: 10, enabled: true, init() {} };\n`,
    );
    await writeManifest({});

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(global.__pluginProbe).toBeUndefined();
    expect(pluginRuntime.getPlugins()).toEqual([]);
  });

  it("loads a plugin that opts in through its own manifest", async () => {
    await writePlugin(
      "self-declared",
      `module.exports = { name: "self-declared", order: 10, enabled: true, init() { global.__pluginProbe = "init ran"; } };\n`,
      { autoDiscoverable: true },
    );
    await writeManifest({});

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(global.__pluginProbe).toBe("init ran");
  });

  it("runs init once per plugin across two initialize calls, and shuts the first set down", async () => {
    // Two initialize calls used to mean two init calls with only the second set reachable,
    // so the first plugin's timers ran until the process died.
    await writePlugin(
      "counter",
      `module.exports = {
  name: "counter",
  order: 10,
  enabled: true,
  init() {
    global.__pluginProbe = global.__pluginProbe || { inits: 0, shutdowns: 0 };
    global.__pluginProbe.inits += 1;
  },
  shutdown() {
    global.__pluginProbe.shutdowns += 1;
  },
};
`,
    );
    await writeManifest({ counter: { enabled: true } });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(global.__pluginProbe).toEqual({ inits: 2, shutdowns: 1 });

    await pluginRuntime.shutdown();

    // Every instance that was ever initialized has now been shut down exactly once.
    expect(global.__pluginProbe).toEqual({ inits: 2, shutdowns: 2 });
  });

  it("keeps running the plugins ordered after one that throws", async () => {
    await writePlugin(
      "thrower",
      `module.exports = { name: "thrower", order: 10, enabled: true, onRequest() { throw new Error("boom"); } };\n`,
    );
    await writePlugin(
      "survivor",
      `module.exports = {
  name: "survivor",
  order: 20,
  enabled: true,
  onRequest({ res }) {
    if (!res.headersSent) res.setHeader("x-survivor", "ran");
  },
};
`,
    );
    await writeManifest({ thrower: { enabled: true }, survivor: { enabled: true } });

    const res = await request(buildApp()).get("/ping").expect(200);

    expect(res.headers["x-survivor"]).toBe("ran");
    expect(res.body).toEqual({ ok: true });
  });

  it("refuses to attach before initialize, instead of loading every plugin with no services", () => {
    pluginRuntime = require(runtimeModulePath);

    expect(() => pluginRuntime.attach(express())).toThrow(/attach\(app\) called before initialize/);
  });

  it("mounts a registerRoutes router under the plugin namespace", async () => {
    await writePlugin(
      "route-owner",
      `module.exports = {
  name: "route-owner",
  order: 10,
  enabled: true,
  config: { note: "hello" },
  registerRoutes({ router, config }) {
    router.get("/status", (req, res) => res.json({ ok: true, note: config.note }));
  },
};
`,
    );
    await writeManifest({ "route-owner": { enabled: true } });

    const app = buildApp();
    const res = await request(app).get("/api/v1/plugins/route-owner/status").expect(200);

    expect(res.body).toEqual({ ok: true, note: "hello" });
    expect(pluginRuntime.getPlugins()[0].routeMountPath).toBe("/api/v1/plugins/route-owner");
  });

  it("mounts no router for a disabled plugin", async () => {
    await writePlugin(
      "route-owner",
      `module.exports = {
  name: "route-owner",
  order: 10,
  enabled: true,
  registerRoutes({ router }) {
    router.get("/status", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ "route-owner": { enabled: false } });

    await request(buildApp()).get("/api/v1/plugins/route-owner/status").expect(404);
  });

  it("takes order from the manifest, so the run sequence can be changed without editing code", async () => {
    const stamp = (name) => `module.exports = {
  name: "${name}",
  order: 10,
  enabled: true,
  onRequest() {
    global.__pluginProbe = global.__pluginProbe || [];
    global.__pluginProbe.push("${name}");
  },
};
`;
    await writePlugin("first-in-code", stamp("first-in-code"));
    await writePlugin("second-in-code", stamp("second-in-code"));
    await writeManifest({
      "first-in-code": { enabled: true, order: 90 },
      "second-in-code": { enabled: true, order: 20 },
    });

    await request(buildApp()).get("/ping").expect(200);

    expect(global.__pluginProbe).toEqual(["second-in-code", "first-in-code"]);
  });

  it("deep-merges config, so a manifest can override one nested value", async () => {
    await writePlugin(
      "nested-config",
      `module.exports = {
  name: "nested-config",
  order: 10,
  enabled: true,
  config: { limits: { soft: 1, hard: 2 }, tags: ["a"] },
  init({ config }) {
    global.__pluginProbe = config;
  },
};
`,
    );
    await writeManifest({ "nested-config": { enabled: true, config: { limits: { hard: 99 }, tags: ["b"] } } });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(global.__pluginProbe).toEqual({ limits: { soft: 1, hard: 99 }, tags: ["b"] });
  });

  it("leaves res.json alone when no enabled plugin declares onResponse", async () => {
    await writePlugin("request-only", `module.exports = { name: "request-only", order: 10, enabled: true, onRequest() {} };\n`);
    await writeManifest({ "request-only": { enabled: true } });

    const app = buildApp();
    let patched = null;

    app.get("/probe", (req, res) => {
      patched = res.json.name;
      res.json({ ok: true });
    });

    await request(app).get("/probe").expect(200);

    expect(patched).not.toBe("patchedJson");
  });

  it("reports collisions rather than letting sort order decide them", () => {
    pluginRuntime = require(runtimeModulePath);

    const warnings = pluginRuntime._detectCollisions([
      { name: "a", enabled: true, order: 10, pluginFile: "a/index.js", config: { routePath: "/x" } },
      { name: "b", enabled: true, order: 10, pluginFile: "b/index.js", config: { routePath: "/x" } },
      { name: "c", enabled: false, order: 10, pluginFile: "c/index.js", config: {} },
    ]);

    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toContain("share order 10");
    expect(warnings.join(" ")).toContain("both claim /x");
  });
  it("reloads: tears the old set down, and picks up an edited file when asked", async () => {
    const source = (message) => `module.exports = {
  name: "editable",
  order: 10,
  enabled: true,
  init() {
    global.__pluginProbe = global.__pluginProbe || { inits: [], shutdowns: 0 };
    global.__pluginProbe.inits.push("${message}");
  },
  shutdown() {
    global.__pluginProbe.shutdowns += 1;
  },
};
`;

    await writePlugin("editable", source("first"));
    await writeManifest({ editable: { enabled: true } });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    await writePlugin("editable", source("second"));

    const plugins = await pluginRuntime.reload({ reloadModules: true });

    expect(global.__pluginProbe.inits).toEqual(["first", "second"]);
    expect(global.__pluginProbe.shutdowns).toBe(1);
    expect(plugins.map((plugin) => plugin.name)).toEqual(["editable"]);
  });

  it("reuses the cached module when reloadModules is not asked for", async () => {
    const source = (message) => `module.exports = {
  name: "cached",
  order: 10,
  enabled: true,
  init() {
    global.__pluginProbe = global.__pluginProbe || [];
    global.__pluginProbe.push("${message}");
  },
};
`;

    await writePlugin("cached", source("first"));
    await writeManifest({ cached: { enabled: true } });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    await writePlugin("cached", source("second"));
    await pluginRuntime.reload();

    // The edit is on disk but node still has the first version, which is why reload takes
    // an explicit flag rather than guessing.
    expect(global.__pluginProbe).toEqual(["first", "first"]);
  });

  it("honours a code-declared autoDiscoverable only when explicitly allowed", async () => {
    await writePlugin(
      "code-declared",
      `module.exports = {
  name: "code-declared",
  order: 10,
  enabled: true,
  autoDiscoverable: true,
  init() {
    global.__pluginProbe = "init ran";
  },
};
`,
    );
    await writeManifest({});

    pluginRuntime = require(runtimeModulePath);

    pluginRuntime.initialize({ pluginsDir, manifestPath });
    expect(pluginRuntime.getPlugins()).toEqual([]);
    expect(global.__pluginProbe).toBeUndefined();

    pluginRuntime.initialize({ pluginsDir, manifestPath, allowCodeDeclaredDiscovery: true });
    expect(pluginRuntime.getPlugins().map((plugin) => plugin.name)).toEqual(["code-declared"]);
    expect(global.__pluginProbe).toBe("init ran");
  });

  it("configures a plugin by its directory even when its exported name disagrees", async () => {
    // Discovery works off directories, so that is what the manifest key has to match. The
    // plugin still reports its own name everywhere else, and the runtime warns about it.
    await writePlugin(
      "dir-name",
      `module.exports = { name: "exported-name", order: 10, enabled: false, init() { global.__pluginProbe = "init ran"; } };\n`,
    );
    await writeManifest({ "dir-name": { enabled: true, order: 42 } });

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(pluginRuntime.getPlugins()).toEqual([
      expect.objectContaining({ name: "exported-name", enabled: true, order: 42, enabledBy: "global-manifest" }),
    ]);
    expect(global.__pluginProbe).toBe("init ran");
  });

  it("replaces a res.send body too, not only res.json", async () => {
    await writePlugin(
      "send-rewriter",
      `module.exports = {
  name: "send-rewriter",
  order: 10,
  enabled: true,
  onResponse({ responseBody, responseType }) {
    if (responseType !== "send") return undefined;
    return String(responseBody).toUpperCase();
  },
};
`,
    );
    await writeManifest({ "send-rewriter": { enabled: true } });

    const app = buildApp();
    app.get("/text", (req, res) => res.send("quiet field"));

    const res = await request(app).get("/text").expect(200);

    expect(res.text).toBe("QUIET FIELD");
  });

  it("survives a response sent with no body at all", async () => {
    await writePlugin(
      "watcher",
      `module.exports = {
  name: "watcher",
  order: 10,
  enabled: true,
  onResponse({ responseType }) {
    global.__pluginProbe = global.__pluginProbe || [];
    global.__pluginProbe.push(responseType);
  },
};
`,
    );
    await writeManifest({ watcher: { enabled: true } });

    const app = buildApp();
    app.get("/empty", (req, res) => res.status(204).send());

    await request(app).get("/empty").expect(204);

    expect(global.__pluginProbe).toEqual(["end"]);
  });

  it("keeps loading when a plugin's registerRoutes throws", async () => {
    await writePlugin(
      "bad-routes",
      `module.exports = { name: "bad-routes", order: 10, enabled: true, registerRoutes() { throw new Error("boom"); } };\n`,
    );
    await writePlugin(
      "good-routes",
      `module.exports = {
  name: "good-routes",
  order: 20,
  enabled: true,
  registerRoutes({ router }) {
    router.get("/status", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ "bad-routes": { enabled: true }, "good-routes": { enabled: true } });

    const app = buildApp();

    await request(app).get("/api/v1/plugins/good-routes/status").expect(200);
    await request(app).get("/api/v1/plugins/bad-routes/status").expect(404);

    const mounts = pluginRuntime.getPlugins().map((plugin) => plugin.routeMountPath);
    expect(mounts).toEqual([null, "/api/v1/plugins/good-routes"]);
  });

  it("reports which layer decided enabled, and which hooks a plugin declares", async () => {
    await writePlugin("reported", `module.exports = { name: "reported", order: 10, enabled: true, onRequest() {}, shutdown() {} };\n`, {
      autoDiscoverable: true,
    });
    await writeManifest({});

    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({ pluginsDir, manifestPath });

    expect(pluginRuntime.getPlugins()).toEqual([
      {
        name: "reported",
        enabled: true,
        order: 10,
        enabledBy: "code",
        hooks: ["onRequest", "shutdown"],
        // Every plugin resolves a mount path; only one that registers routes is mounted on it.
        mountPath: "/api/v1/plugins/reported",
        routeMountPath: null,
      },
    ]);
  });

  it("filters events by config.eventTypes only, ignoring the superseded spellings", async () => {
    await writePlugin(
      "listener",
      `module.exports = {
  name: "listener",
  order: 10,
  enabled: true,
  config: { eventType: ["field.created"] },
  onEvent({ eventType, pluginState }) {
    pluginState.seen = pluginState.seen || [];
    pluginState.seen.push(eventType);
    global.__pluginProbe = pluginState.seen.slice();
  },
};
`,
    );
    await writeManifest({ listener: { enabled: true } });

    const handlers = [];
    pluginRuntime = require(runtimeModulePath);
    pluginRuntime.initialize({
      pluginsDir,
      manifestPath,
      services: {
        notificationCenter: {
          subscribeEvents: (handler) => {
            handlers.push(handler);
            return () => handlers.splice(handlers.indexOf(handler), 1);
          },
        },
      },
    });

    // config.eventType is not a filter any more, so an unrelated event still arrives.
    handlers[0]({ type: "user.logged-in" });

    expect(global.__pluginProbe).toEqual(["user.logged-in"]);
  });

  it("names two plugins that claim the same identity", () => {
    pluginRuntime = require(runtimeModulePath);

    const warnings = pluginRuntime._detectCollisions([
      { name: "twin", enabled: true, order: 10, pluginFile: "one/index.js", config: {} },
      { name: "twin", enabled: true, order: 20, pluginFile: "two/index.js", config: {} },
    ]);

    expect(warnings.join(" ")).toContain('Duplicate plugin name "twin"');
  });

  it("warns about manifest entries the runtime cannot act on", () => {
    pluginRuntime = require(runtimeModulePath);

    const warnings = pluginRuntime._validateManifest(
      {
        plugins: {
          present: { enabled: true, config: {} },
          absent: { enabled: true },
          typo: { enable: true },
          "bad-order": { order: "first" },
          "not-an-object": "enabled",
        },
      },
      [{ dirName: "present" }, { dirName: "typo" }, { dirName: "bad-order" }, { dirName: "not-an-object" }],
    );

    const joined = warnings.join("\n");
    expect(joined).toContain('Manifest lists "absent"');
    expect(joined).toContain('unknown key "enable"');
    expect(joined).toContain("non-numeric order");
    expect(joined).toContain('"not-an-object" is not an object');
    expect(joined).not.toContain('"present"');
  });

  it("warns about the config shapes it understands", () => {
    pluginRuntime = require(runtimeModulePath);

    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { routePath: "/ok" } })).toEqual([]);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { routePath: 7 } })).toHaveLength(1);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { routePath: "" } })).toHaveLength(1);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { routePaths: "/one" } })).toHaveLength(1);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { routePaths: ["/one"] } })).toEqual([]);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: { eventTypes: { nope: true } } })).toHaveLength(1);
    expect(pluginRuntime._validateConventionalConfig({ name: "a", config: {} })).toEqual([]);
  });
  it("mounts a router on the path from config, overriding the default", async () => {
    await writePlugin(
      "movable",
      `module.exports = {
  name: "movable",
  order: 10,
  enabled: true,
  config: { mountPath: "/api/v1/plugins/somewhere-else" },
  registerRoutes({ router }) {
    router.get("/status", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ movable: { enabled: true } });

    const app = buildApp();

    await request(app).get("/api/v1/plugins/somewhere-else/status").expect(200);
    await request(app).get("/api/v1/plugins/movable/status").expect(404);

    expect(pluginRuntime.getPlugins()[0]).toMatchObject({
      mountPath: "/api/v1/plugins/somewhere-else",
      routeMountPath: "/api/v1/plugins/somewhere-else",
    });
  });

  it("lets a manifest move a plugin's routes without touching its code", async () => {
    await writePlugin(
      "movable",
      `module.exports = {
  name: "movable",
  order: 10,
  enabled: true,
  config: { mountPath: "/api/v1/plugins/movable" },
  registerRoutes({ router, mountPath }) {
    router.get("/where", (req, res) => res.json({ mountPath }));
  },
};
`,
    );
    await writeManifest({ movable: { enabled: true, config: { mountPath: "/api/v1/plugins/moved-by-manifest" } } });

    const app = buildApp();
    const res = await request(app).get("/api/v1/plugins/moved-by-manifest/where").expect(200);

    // The hook is told where it ended up, so nothing has to hardcode the path.
    expect(res.body).toEqual({ mountPath: "/api/v1/plugins/moved-by-manifest" });
  });

  it("injects the resolved mount path into init as well", async () => {
    await writePlugin(
      "announcer",
      `module.exports = {
  name: "announcer",
  order: 10,
  enabled: true,
  config: { mountPath: "/api/v1/plugins/announced" },
  init({ mountPath }) {
    global.__pluginProbe = mountPath;
  },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ announcer: { enabled: true } });

    buildApp();

    expect(global.__pluginProbe).toBe("/api/v1/plugins/announced");
  });

  it("serves a mount path outside the plugin namespace, having warned about it", async () => {
    // Allowed on purpose: this is how a plugin decorates or replaces an app path. The warning
    // is the guardrail, not a refusal.
    await writePlugin(
      "outsider",
      `module.exports = {
  name: "outsider",
  order: 10,
  enabled: true,
  config: { mountPath: "/api/v1/outside" },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ outsider: { enabled: true } });

    await request(buildApp()).get("/api/v1/outside").expect(200);
  });

  it("keeps the query string and the rest of the path when it hands over to a router", async () => {
    await writePlugin(
      "deep",
      `module.exports = {
  name: "deep",
  order: 10,
  enabled: true,
  registerRoutes({ router }) {
    router.get("/one/:id", (req, res) => res.json({ id: req.params.id, q: req.query.q, path: req.path }));
  },
};
`,
    );
    await writeManifest({ deep: { enabled: true } });

    const res = await request(buildApp()).get("/api/v1/plugins/deep/one/42?q=yes").expect(200);

    expect(res.body).toEqual({ id: "42", q: "yes", path: "/one/42" });
  });

  it("restores the url for whatever runs after an unmatched plugin route", async () => {
    await writePlugin(
      "picky",
      `module.exports = {
  name: "picky",
  order: 10,
  enabled: true,
  registerRoutes({ router }) {
    router.get("/known", (req, res) => res.json({ ok: true }));
  },
};
`,
    );
    await writeManifest({ picky: { enabled: true } });

    const app = buildApp();
    app.get("/api/v1/plugins/picky/unknown", (req, res) => res.json({ answeredBy: "the app", url: req.url }));

    const res = await request(app).get("/api/v1/plugins/picky/unknown").expect(200);

    expect(res.body).toEqual({ answeredBy: "the app", url: "/api/v1/plugins/picky/unknown" });
  });

  it("gives a nested mount path its own requests, not the shorter one's", async () => {
    const source = (name, mountPath) => `module.exports = {
  name: "${name}",
  order: 10,
  enabled: true,
  config: { mountPath: "${mountPath}" },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ answeredBy: "${name}" }));
  },
};
`;
    await writePlugin("outer", source("outer", "/api/v1/plugins/shared"));
    await writePlugin("inner", source("inner", "/api/v1/plugins/shared/inner"));
    await writeManifest({ outer: { enabled: true }, inner: { enabled: true } });

    const app = buildApp();

    expect((await request(app).get("/api/v1/plugins/shared").expect(200)).body).toEqual({ answeredBy: "outer" });
    expect((await request(app).get("/api/v1/plugins/shared/inner").expect(200)).body).toEqual({ answeredBy: "inner" });
  });

  it("falls back to the default when the configured mount path is not a path", async () => {
    for (const mountPath of ["", "   ", "relative/path", 42, true]) {
      await writePlugin(
        "fussy",
        `module.exports = {
  name: "fussy",
  order: 10,
  enabled: true,
  config: { mountPath: ${JSON.stringify(mountPath)} },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ ok: true }));
  },
};
`,
      );
      await writeManifest({ fussy: { enabled: true } });

      await request(buildApp()).get("/api/v1/plugins/fussy").expect(200);
      expect(pluginRuntime.getPlugins()[0].mountPath).toBe("/api/v1/plugins/fussy");
    }
  });

  it("drops a trailing slash rather than answering on a doubled one", () => {
    pluginRuntime = require(runtimeModulePath);

    expect(pluginRuntime._resolveMountPath({ name: "x", config: { mountPath: "/api/v1/plugins/x/" } })).toBe("/api/v1/plugins/x");
    expect(pluginRuntime._resolveMountPath({ name: "x", config: { mountPath: "/api/v1/plugins/x//" } })).toBe("/api/v1/plugins/x");
    expect(pluginRuntime._resolveMountPath({ name: "x", config: { mountPath: "  /api/v1/plugins/spaced  " } })).toBe(
      "/api/v1/plugins/spaced",
    );
    expect(pluginRuntime._resolveMountPath({ name: "x", config: {} })).toBe("/api/v1/plugins/x");
    expect(pluginRuntime._resolveMountPath({ name: "x" })).toBe("/api/v1/plugins/x");
  });

  it("keeps the first plugin on a shared mount path and reports the clash", async () => {
    const source = (name) => `module.exports = {
  name: "${name}",
  order: ${name === "first" ? 10 : 20},
  enabled: true,
  config: { mountPath: "/api/v1/plugins/contested" },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ answeredBy: "${name}" }));
  },
};
`;
    await writePlugin("first", source("first"));
    await writePlugin("second", source("second"));
    await writeManifest({ first: { enabled: true }, second: { enabled: true } });

    const app = buildApp();
    const res = await request(app).get("/api/v1/plugins/contested").expect(200);

    // Order decides, and the loser is not silently half-mounted.
    expect(res.body).toEqual({ answeredBy: "first" });
    const [first, second] = pluginRuntime.getPlugins();
    expect(first.routeMountPath).toBe("/api/v1/plugins/contested");
    expect(second.routeMountPath).toBeNull();

    const warnings = pluginRuntime._detectCollisions(pluginRuntime.getPlugins().map((plugin) => ({ ...plugin, registerRoutes() {} })));
    expect(warnings.join(" ")).toContain("both mount on /api/v1/plugins/contested");
  });

  it("follows a mount path that changes on reload", async () => {
    const source = (mountPath) => `module.exports = {
  name: "wanderer",
  order: 10,
  enabled: true,
  config: { mountPath: "${mountPath}" },
  registerRoutes({ router }) {
    router.get("/", (req, res) => res.json({ ok: true }));
  },
};
`;
    await writePlugin("wanderer", source("/api/v1/plugins/here"));
    await writeManifest({ wanderer: { enabled: true } });

    const app = buildApp();
    await request(app).get("/api/v1/plugins/here").expect(200);

    await writePlugin("wanderer", source("/api/v1/plugins/there"));
    await pluginRuntime.reload({ reloadModules: true });

    // The dispatcher reads the current map per request, so no re-attach is needed.
    await request(app).get("/api/v1/plugins/there").expect(200);
    await request(app).get("/api/v1/plugins/here").expect(404);
  });
});
