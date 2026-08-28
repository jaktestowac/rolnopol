import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Hook behaviour for the bundled plugins that nothing else exercises.
//
// `plugin-runtime.easter-eggs.test.js` already drives the five easter-egg plugins
// through the real runtime over HTTP. The eight below are not covered anywhere, and
// three of them ship `enabled: true` in code (response-size-logger, startup-info,
// test-header) — so the moment a manifest registers one without saying `enabled: false`,
// its hooks run on every request.
//
// Hooks are called directly here rather than through the runtime, with the exact
// context shape `modules/plugin-runtime/index.js` builds. That keeps each assertion
// about one plugin's decision rather than about the loader, which has its own suite.
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "..", "plugins");
const load = (name) => require(path.join(PLUGINS_DIR, name, "index.js"));

const teapotBlocker = load("teapot-blocker-plugin");
const responseSizeLogger = load("response-size-logger-plugin");
const testHeader = load("test-header-plugin");
const startupInfo = load("startup-info-plugin");
const samplePluginRoute = load("sample-plugin-route");
const featureFlagWatcher = load("feature-flag-watcher");
const autoDiscoverable = load("auto-discoverable-plugin");
const pluginTemplate = load("plugin-template");
const currentTime = load("current-time-plugin");

/** The logger trio the runtime injects into every hook. */
const loggers = () => ({ logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn() });

/** A request double matching what express hands the runtime's middleware. */
const fakeReq = ({ method = "GET", path: reqPath = "/api/v1/ping", query = {}, body, originalUrl, ip = "127.0.0.1" } = {}) => ({
  method,
  path: reqPath,
  originalUrl: originalUrl ?? reqPath,
  query,
  body,
  ip,
});

/** A response double recording status, json, and set headers. */
function fakeRes({ headersSent = false, statusCode = 200 } = {}) {
  const captured = { status: null, json: null, sent: null, headers: {} };
  return {
    captured,
    headersSent,
    statusCode,
    status(code) {
      captured.status = code;
      this.statusCode = code;
      return this;
    },
    json(payload) {
      captured.json = payload;
      return this;
    },
    send(payload) {
      captured.sent = payload;
      return this;
    },
    setHeader(name, value) {
      captured.headers[String(name).toLowerCase()] = value;
      return this;
    },
  };
}

/** The full onRequest/onResponse context, with per-call overrides. */
const hookContext = (overrides = {}) => ({
  req: fakeReq(),
  res: fakeRes(),
  pluginContext: {},
  config: {},
  services: {},
  ...loggers(),
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("teapot-blocker-plugin", () => {
  it("blocks every request with 418 and short-circuits the pipeline", () => {
    const context = hookContext();

    const result = teapotBlocker.onRequest(context);

    expect(result).toBe(false); // false is what stops the runtime
    expect(context.res.captured.status).toBe(418);
    expect(context.res.captured.json).toMatchObject({ error: "I'm a teapot", plugin: "teapot-blocker-plugin" });
  });

  it("blocks whatever the method and path are — there is no allowlist", () => {
    for (const req of [
      fakeReq({ method: "POST", path: "/api/v1/login" }),
      fakeReq({ method: "GET", path: "/" }),
      fakeReq({ method: "DELETE", path: "/api/v1/fields/1" }),
    ]) {
      const context = hookContext({ req, res: fakeRes() });

      expect(teapotBlocker.onRequest(context)).toBe(false);
      expect(context.res.captured.status).toBe(418);
    }
  });

  it("uses the configured refusal message, falling back to its own", () => {
    const custom = hookContext({ config: { message: "no coffee here" } });
    teapotBlocker.onRequest(custom);
    expect(custom.res.captured.json.message).toBe("no coffee here");

    const bare = hookContext();
    teapotBlocker.onRequest(bare);
    expect(bare.res.captured.json.message).toBe("I refuse to brew coffee");
  });

  it("tolerates a null config rather than throwing on the message lookup", () => {
    const context = hookContext({ config: null });

    expect(teapotBlocker.onRequest(context)).toBe(false);
    expect(context.res.captured.status).toBe(418);
  });

  it("still short-circuits when the response has already been sent, without writing twice", () => {
    const context = hookContext({ res: fakeRes({ headersSent: true }) });

    expect(teapotBlocker.onRequest(context)).toBe(false);
    expect(context.res.captured.status).toBeNull();
    expect(context.res.captured.json).toBeNull();
  });

  it("logs every block, so an accidentally-enabled teapot is visible in the logs", () => {
    const context = hookContext({ req: fakeReq({ method: "PUT", originalUrl: "/api/v1/fields/2" }) });

    teapotBlocker.onRequest(context);

    expect(context.logInfo).toHaveBeenCalledWith(
      "Plugin teapot-blocker-plugin: blocking request",
      expect.objectContaining({ method: "PUT", path: "/api/v1/fields/2", clientIp: "127.0.0.1" }),
    );
  });

  it("falls back to a plain-text teapot if sending JSON throws", () => {
    const res = fakeRes();
    res.json = () => {
      throw new Error("stream closed");
    };
    const context = hookContext({ res });

    expect(teapotBlocker.onRequest(context)).toBe(false);
    expect(res.captured.sent).toBe("I'm a teapot");
    expect(context.logError).toHaveBeenCalled();
  });

  it("lets the error escape when both send paths fail, for the runtime to catch", () => {
    // The runtime wraps onRequest in its own try/catch and calls next() — so the
    // honest behaviour here is to throw, not to swallow and pretend it answered.
    const res = fakeRes();
    res.json = () => {
      throw new Error("stream closed");
    };
    res.send = () => {
      throw new Error("also closed");
    };

    expect(() => teapotBlocker.onRequest(hookContext({ res }))).toThrow("also closed");
  });
});

describe("response-size-logger-plugin", () => {
  const sizeFrom = (calls) => calls[0][1].sizeBytes;

  it("measures a Buffer by its byte length", () => {
    const context = hookContext({ responseBody: Buffer.from("hello"), responseType: "send" });

    responseSizeLogger.onResponse(context);

    expect(sizeFrom(context.logInfo.mock.calls)).toBe(5);
  });

  it("measures a string in UTF-8 bytes, not characters", () => {
    const context = hookContext({ responseBody: "żółć", responseType: "send" });

    responseSizeLogger.onResponse(context);

    expect(sizeFrom(context.logInfo.mock.calls)).toBe(Buffer.byteLength("żółć", "utf8"));
    expect(sizeFrom(context.logInfo.mock.calls)).toBeGreaterThan("żółć".length);
  });

  it("measures an object by its serialised length", () => {
    const body = { ok: true, count: 2 };
    const context = hookContext({ responseBody: body, responseType: "json" });

    responseSizeLogger.onResponse(context);

    expect(sizeFrom(context.logInfo.mock.calls)).toBe(Buffer.byteLength(JSON.stringify(body), "utf8"));
  });

  it("reports zero for a null or undefined body", () => {
    for (const responseBody of [null, undefined]) {
      const context = hookContext({ responseBody, responseType: "send" });
      responseSizeLogger.onResponse(context);
      expect(sizeFrom(context.logInfo.mock.calls)).toBe(0);
    }
  });

  it("reports zero rather than throwing on a circular body", () => {
    const body = { name: "loop" };
    body.self = body;
    const context = hookContext({ responseBody: body, responseType: "json" });

    expect(() => responseSizeLogger.onResponse(context)).not.toThrow();
    expect(sizeFrom(context.logInfo.mock.calls)).toBe(0);
  });

  it("reports zero for a body JSON.stringify turns into undefined", () => {
    // A bare function or symbol serialises to `undefined`, which Buffer.byteLength
    // would reject — the try/catch is what keeps this a log line, not a 500.
    for (const responseBody of [() => {}, Symbol("nope")]) {
      const context = hookContext({ responseBody, responseType: "send" });
      expect(() => responseSizeLogger.onResponse(context)).not.toThrow();
      expect(sizeFrom(context.logInfo.mock.calls)).toBe(0);
    }
  });

  it("logs the request and response identity alongside the size", () => {
    const context = hookContext({
      req: fakeReq({ method: "POST", originalUrl: "/api/v1/fields?page=2" }),
      res: fakeRes({ statusCode: 201 }),
      responseBody: "x",
      responseType: "send",
    });

    responseSizeLogger.onResponse(context);

    expect(context.logInfo).toHaveBeenCalledWith(
      "Plugin response-size-logger",
      expect.objectContaining({
        plugin: "response-size-logger-plugin",
        method: "POST",
        path: "/api/v1/fields?page=2",
        statusCode: 201,
        responseType: "send",
        sizeBytes: 1,
      }),
    );
  });

  it("only observes — it never returns a value that would alter the response", () => {
    const context = hookContext({ responseBody: { ok: true }, responseType: "json" });

    expect(responseSizeLogger.onResponse(context)).toBeUndefined();
    expect(context.responseBody).toEqual({ ok: true });
  });

  it("logs nothing for a response whose size it cannot know", () => {
    // sendFile, redirects and streams reach onResponse through res.end with no body.
    const context = hookContext({ responseBody: undefined, responseType: "end" });

    responseSizeLogger.onResponse(context);

    expect(context.logInfo).not.toHaveBeenCalled();
  });

  it("measures an empty string and an empty object as their real sizes", () => {
    const empty = hookContext({ responseBody: "", responseType: "send" });
    responseSizeLogger.onResponse(empty);
    expect(sizeFrom(empty.logInfo.mock.calls)).toBe(0);

    const object = hookContext({ responseBody: {}, responseType: "json" });
    responseSizeLogger.onResponse(object);
    expect(sizeFrom(object.logInfo.mock.calls)).toBe(2); // "{}"
  });
});

describe("test-header-plugin", () => {
  it("sets its default header when config says nothing", () => {
    const context = hookContext();

    testHeader.onResponse(context);

    expect(context.res.captured.headers["x-rolnopol-plugin-test"]).toBe("enabled");
  });

  it("honours a configured header name and value", () => {
    const context = hookContext({ config: { headerName: "x-custom", headerValue: "on" } });

    testHeader.onResponse(context);

    expect(context.res.captured.headers["x-custom"]).toBe("on");
    expect(context.res.captured.headers).not.toHaveProperty("x-rolnopol-plugin-test");
  });

  it("falls back per field, not all-or-nothing", () => {
    const context = hookContext({ config: { headerName: "x-only-name" } });

    testHeader.onResponse(context);

    expect(context.res.captured.headers["x-only-name"]).toBe("enabled");
  });

  it("does nothing once headers are sent, rather than throwing", () => {
    const context = hookContext({ res: fakeRes({ headersSent: true }) });

    expect(() => testHeader.onResponse(context)).not.toThrow();
    expect(context.res.captured.headers).toEqual({});
  });
});

describe("startup-info-plugin", () => {
  it("logs its default message on init", () => {
    const context = { ...loggers(), config: {} };

    startupInfo.init(context);

    expect(context.logInfo).toHaveBeenCalledWith("startup-info-plugin initialized", { plugin: "startup-info-plugin" });
  });

  it("logs a configured message instead", () => {
    const context = { ...loggers(), config: { message: "Startup info plugin loaded" } };

    startupInfo.init(context);

    expect(context.logInfo).toHaveBeenCalledWith("Startup info plugin loaded", { plugin: "startup-info-plugin" });
  });

  it("declares no request-path hooks — it is a startup announcement only", () => {
    expect(startupInfo.onRequest).toBeUndefined();
    expect(startupInfo.onResponse).toBeUndefined();
  });
});

describe("sample-plugin-route", () => {
  /** The plugin's own router, mounted where the runtime would mount it. */
  function buildApp(config = samplePluginRoute.config) {
    const app = express();
    app.use(express.json());

    const router = express.Router();
    samplePluginRoute.registerRoutes({ router, config, ...loggers() });
    app.use("/api/v1/plugins/sample-plugin-route", router);

    return app;
  }

  it("owns routes instead of intercepting requests, so it cannot shadow a core path", () => {
    expect(typeof samplePluginRoute.registerRoutes).toBe("function");
    expect(samplePluginRoute.onRequest).toBeUndefined();
  });

  it("answers a GET on its mount path", async () => {
    const res = await request(buildApp()).get("/api/v1/plugins/sample-plugin-route").expect(200);

    expect(res.body).toEqual({ message: "Hello from sample-plugin-route (GET)" });
  });

  it("echoes the body on a POST", async () => {
    const body = { seed: "wheat" };
    const res = await request(buildApp()).post("/api/v1/plugins/sample-plugin-route").send(body).expect(200);

    expect(res.body).toEqual({ message: "Hello from sample-plugin-route (POST)", body });
  });

  it("answers 405 for any other method", async () => {
    for (const method of ["put", "patch", "delete"]) {
      const res = await request(buildApp())[method]("/api/v1/plugins/sample-plugin-route").expect(405);

      expect(res.body).toEqual({ error: "Method not allowed" });
    }
  });

  it("uses the configured greeting, falling back to its own", async () => {
    const configured = await request(buildApp({ greeting: "Dzien dobry" }))
      .get("/api/v1/plugins/sample-plugin-route")
      .expect(200);
    expect(configured.body.message).toBe("Dzien dobry (GET)");

    const bare = await request(buildApp({})).get("/api/v1/plugins/sample-plugin-route").expect(200);
    expect(bare.body.message).toBe("Hello from sample-plugin-route (GET)");
  });

  it("announces the mount path the runtime resolved for it", () => {
    // The runtime injects the resolved path, so the plugin never repeats it.
    const context = { ...loggers(), config: samplePluginRoute.config, mountPath: "/api/v1/plugins/moved" };

    samplePluginRoute.init(context);

    expect(context.logInfo).toHaveBeenCalledWith("sample-plugin-route initialized", { mountPath: "/api/v1/plugins/moved" });
  });
});

describe("feature-flag-watcher", () => {
  const flagService = (flags) => ({ getFeatureFlags: vi.fn(async () => ({ flags })) });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    featureFlagWatcher.shutdown();
  });

  it("caches the flags on init so onRequest can stay synchronous", async () => {
    const services = { featureFlagsService: flagService({ messengerEnabled: true }) };

    featureFlagWatcher.init({ services, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    expect(featureFlagWatcher.currentFlags).toEqual({ messengerEnabled: true });
  });

  it("refreshes the cache on its interval", async () => {
    const service = flagService({ messengerEnabled: true });
    featureFlagWatcher.init({ services: { featureFlagsService: service }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    expect(service.getFeatureFlags).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getFeatureFlags).toHaveBeenCalledTimes(2);
  });

  it("stays loaded but inactive when the injected service is missing or wrong-shaped", () => {
    for (const services of [{}, { featureFlagsService: null }, { featureFlagsService: {} }]) {
      const context = { services, ...loggers() };

      featureFlagWatcher.init(context);

      expect(context.logError).toHaveBeenCalled();
      expect(featureFlagWatcher.currentFlags).toEqual({});
    }
  });

  it("survives a flag read that rejects, keeping the last good cache", async () => {
    const service = { getFeatureFlags: vi.fn().mockRejectedValue(new Error("flags file locked")) };
    const context = { services: { featureFlagsService: service }, ...loggers() };

    featureFlagWatcher.init(context);
    await vi.advanceTimersByTimeAsync(0);

    expect(featureFlagWatcher.currentFlags).toEqual({});
    expect(context.logError).toHaveBeenCalledWith("FeatureFlagWatcher: failed to refresh feature flags", expect.any(Object));
  });

  it("treats a payload with no flags key as an empty flag set", async () => {
    featureFlagWatcher.init({ services: { featureFlagsService: { getFeatureFlags: async () => ({}) } }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    expect(featureFlagWatcher.currentFlags).toEqual({});
  });

  it("serves the cached flags on its own inspection endpoint", async () => {
    featureFlagWatcher.init({ services: { featureFlagsService: flagService({ messengerEnabled: false }) }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    const context = hookContext({ req: fakeReq({ path: "/api/v1/feature-flag-watcher" }) });
    featureFlagWatcher.onRequest(context);

    expect(context.res.captured.json).toEqual({ ok: true, flags: { messengerEnabled: false } });
  });

  it("404s messenger routes only while the flag is explicitly false", async () => {
    featureFlagWatcher.init({ services: { featureFlagsService: flagService({ messengerEnabled: false }) }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    const blocked = hookContext({ req: fakeReq({ path: "/api/v1/messenger/conversations" }) });
    expect(featureFlagWatcher.onRequest(blocked)).toBe(false);
    expect(blocked.res.captured.status).toBe(404);
  });

  it("lets messenger routes through when the flag is true or simply unknown", async () => {
    for (const flags of [{ messengerEnabled: true }, {}]) {
      featureFlagWatcher.shutdown();
      featureFlagWatcher.init({ services: { featureFlagsService: flagService(flags) }, ...loggers() });
      await vi.advanceTimersByTimeAsync(0);

      const context = hookContext({ req: fakeReq({ path: "/api/v1/messenger/conversations" }) });
      expect(featureFlagWatcher.onRequest(context)).toBeUndefined();
      expect(context.res.captured.status).toBeNull();
    }
  });

  it("ignores every other path", async () => {
    featureFlagWatcher.init({ services: { featureFlagsService: flagService({ messengerEnabled: false }) }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    const context = hookContext({ req: fakeReq({ path: "/api/v1/fields" }) });

    expect(featureFlagWatcher.onRequest(context)).toBeUndefined();
  });

  it("clears its interval on shutdown, so a reload does not leave a timer running", async () => {
    const service = flagService({});
    featureFlagWatcher.init({ services: { featureFlagsService: service }, ...loggers() });
    await vi.advanceTimersByTimeAsync(0);

    featureFlagWatcher.shutdown();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(service.getFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it("is safe to shut down twice", () => {
    featureFlagWatcher.init({ services: { featureFlagsService: flagService({}) }, ...loggers() });

    expect(() => {
      featureFlagWatcher.shutdown();
      featureFlagWatcher.shutdown();
    }).not.toThrow();
  });
});

describe("auto-discoverable-plugin", () => {
  it("is loadable without a manifest entry", () => {
    expect(autoDiscoverable.autoDiscoverable).toBe(true);
  });

  it("logs its configured feature on init, defaulting when unset", () => {
    const configured = { ...loggers(), config: { feature: "irrigation" } };
    autoDiscoverable.init(configured);
    expect(configured.logInfo).toHaveBeenCalledWith(
      "auto-discoverable-plugin initialized",
      expect.objectContaining({ feature: "irrigation" }),
    );

    const bare = { ...loggers(), config: {} };
    autoDiscoverable.init(bare);
    expect(bare.logInfo).toHaveBeenCalledWith("auto-discoverable-plugin initialized", expect.objectContaining({ feature: "example" }));
  });
});

describe("plugin-template", () => {
  it("declares every hook, so a copy starts from the full contract", () => {
    for (const hook of ["init", "onRequest", "onResponse", "onEvent", "shutdown"]) {
      expect(typeof pluginTemplate[hook]).toBe("function");
    }
  });

  it("does nothing on the request path — a copied template must not change behaviour", () => {
    const request = hookContext();
    const response = hookContext({ responseBody: { ok: true }, responseType: "json" });

    expect(pluginTemplate.onRequest(request)).toBeUndefined();
    expect(pluginTemplate.onResponse(response)).toBeUndefined();
    expect(pluginTemplate.onEvent({ event: {}, eventType: "field.created", ...loggers(), config: {} })).toBeUndefined();

    expect(request.res.captured).toEqual({ status: null, json: null, sent: null, headers: {} });
    expect(response.responseBody).toEqual({ ok: true });
  });

  it("subscribes to every event by default, via an empty eventTypes list", () => {
    expect(pluginTemplate.config.eventTypes).toEqual([]);
  });

  it("logs on init and awaits cleanly on shutdown", async () => {
    const context = { ...loggers(), config: {} };

    pluginTemplate.init(context);
    expect(context.logInfo).toHaveBeenCalledWith("plugin-template initialized", { config: {} });

    await expect(pluginTemplate.shutdown(context)).resolves.toBeUndefined();
  });
});

describe("current-time-plugin", () => {
  /** The plugin's own router, mounted where the runtime would mount it. */
  function buildApp(config = currentTime.config) {
    const app = express();
    const router = express.Router();
    currentTime.registerRoutes({ router, config, ...loggers() });
    app.use("/api/v1/plugins/current-time-plugin", router);
    return app;
  }

  const mountPath = "/api/v1/plugins/current-time-plugin";

  it("owns a route instead of intercepting requests", () => {
    expect(typeof currentTime.registerRoutes).toBe("function");
    expect(currentTime.onRequest).toBeUndefined();
    expect(currentTime.onResponse).toBeUndefined();
  });

  it("answers with the time in three forms", async () => {
    const before = Date.now();
    const res = await request(buildApp()).get(mountPath).expect(200);
    const after = Date.now();

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Current server time");

    const { iso, epochMs, timeZone, local } = res.body.data;

    // The epoch is the same instant as the ISO string, and both fall inside the request.
    expect(Date.parse(iso)).toBe(epochMs);
    expect(epochMs).toBeGreaterThanOrEqual(before);
    expect(epochMs).toBeLessThanOrEqual(after);
    expect(typeof timeZone).toBe("string");
    expect(local.length).toBeGreaterThan(0);
  });

  it("moves with the clock rather than answering from a cached instant", async () => {
    const app = buildApp();
    const first = await request(app).get(mountPath).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await request(app).get(mountPath).expect(200);

    expect(second.body.data.epochMs).toBeGreaterThan(first.body.data.epochMs);
  });

  it("answers in the requested time zone, which wins over its config", async () => {
    const res = await request(buildApp({ timeZone: "Europe/Warsaw" }))
      .get(`${mountPath}?timeZone=Asia/Tokyo`)
      .expect(200);

    expect(res.body.data.timeZone).toBe("Asia/Tokyo");
  });

  it("uses the configured zone when the request asks for nothing", async () => {
    const res = await request(buildApp({ timeZone: "UTC", locale: "en-GB" }))
      .get(mountPath)
      .expect(200);

    expect(res.body.data.timeZone).toBe("UTC");
    // The same instant, rendered in UTC, so the ISO hour is the one shown.
    expect(res.body.data.local).toContain(String(new Date(res.body.data.epochMs).getUTCFullYear()));
  });

  it("falls back to the server's own zone when nothing is configured", async () => {
    const res = await request(buildApp({})).get(mountPath).expect(200);

    expect(res.body.data.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("refuses a time zone that does not exist, instead of throwing a RangeError", async () => {
    const res = await request(buildApp()).get(`${mountPath}?timeZone=Mars/Olympus_Mons`).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Unknown time zone");
    expect(res.body.details).toContain("Mars/Olympus_Mons");
  });

  it("ignores an empty timeZone parameter rather than treating it as a zone", async () => {
    const res = await request(buildApp({ timeZone: "UTC" }))
      .get(`${mountPath}?timeZone=%20`)
      .expect(200);

    expect(res.body.data.timeZone).toBe("UTC");
  });

  it("renders the same instant in the configured locale", async () => {
    const british = await request(buildApp({ timeZone: "UTC", locale: "en-GB" }))
      .get(mountPath)
      .expect(200);
    const polish = await request(buildApp({ timeZone: "UTC", locale: "pl-PL" }))
      .get(mountPath)
      .expect(200);

    expect(polish.body.data.local).not.toBe(british.body.data.local);
  });

  it("answers 405 for any other method", async () => {
    for (const method of ["post", "put", "patch", "delete"]) {
      const res = await request(buildApp())[method](mountPath).expect(405);
      expect(res.body.error).toBe("Method not allowed");
    }
  });

  it("announces the injected mount path and its effective zone on init", () => {
    const context = { ...loggers(), config: { timeZone: "UTC" }, mountPath: "/api/v1/plugins/clock" };

    currentTime.init(context);

    expect(context.logInfo).toHaveBeenCalledWith("current-time-plugin initialized", {
      mountPath: "/api/v1/plugins/clock",
      timeZone: "UTC",
    });
  });
});
