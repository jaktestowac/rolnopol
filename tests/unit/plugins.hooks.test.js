import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hook behaviour for the bundled plugins that nothing else exercises.
//
// `plugin-runtime.easter-eggs.test.js` already drives the five easter-egg plugins
// through the real runtime over HTTP. The eight below are not covered anywhere, and
// three of them ship `enabled: true` in code — so their hooks run on every request
// in any deployment whose manifest does not say otherwise.
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
  const routePath = samplePluginRoute.config.routePath;

  it("ignores any path but its own, returning undefined so the pipeline continues", () => {
    const context = hookContext({ req: fakeReq({ path: "/api/v1/ping" }) });

    expect(samplePluginRoute.onRequest(context)).toBeUndefined();
    expect(context.res.captured.json).toBeNull();
  });

  it("answers a GET on its route and short-circuits", () => {
    const context = hookContext({ req: fakeReq({ method: "GET", path: routePath }), config: samplePluginRoute.config });

    expect(samplePluginRoute.onRequest(context)).toBe(false);
    expect(context.res.captured.json).toEqual({ message: "Hello from sample-plugin-route (GET)" });
  });

  it("echoes the body on a POST", () => {
    const body = { seed: "wheat" };
    const context = hookContext({
      req: fakeReq({ method: "POST", path: routePath, body }),
      config: samplePluginRoute.config,
    });

    expect(samplePluginRoute.onRequest(context)).toBe(false);
    expect(context.res.captured.json).toEqual({ message: "Hello from sample-plugin-route (POST)", body });
  });

  it("answers 405 for any other method, and still short-circuits", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const context = hookContext({ req: fakeReq({ method, path: routePath }), config: samplePluginRoute.config });

      expect(samplePluginRoute.onRequest(context)).toBe(false);
      expect(context.res.captured.status).toBe(405);
      expect(context.res.captured.json).toEqual({ error: "Method not allowed" });
    }
  });

  it("follows a reconfigured route path instead of its default", () => {
    const config = { routePath: "/api/moved-elsewhere" };

    const onDefault = hookContext({ req: fakeReq({ path: routePath }), config });
    expect(samplePluginRoute.onRequest(onDefault)).toBeUndefined();

    const onConfigured = hookContext({ req: fakeReq({ path: config.routePath }), config });
    expect(samplePluginRoute.onRequest(onConfigured)).toBe(false);
  });

  it("announces its route on init", () => {
    const context = { ...loggers(), config: samplePluginRoute.config };

    samplePluginRoute.init(context);

    expect(context.logInfo).toHaveBeenCalledWith("sample-plugin-route initialized", { routePath });
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
