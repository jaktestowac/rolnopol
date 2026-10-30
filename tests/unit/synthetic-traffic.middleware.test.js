import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Synthetic monitoring support (middleware/synthetic-traffic.middleware.js).
//
// The classifier is the whole contract a student's monitor is written against,
// so every row of the decision table is pinned here. The privilege it grants is
// narrow on purpose: verified traffic skips the general API limiters and nothing
// else — auth throttling and the chaos engine still apply.
const syntheticTraffic = require("../../middleware/synthetic-traffic.middleware");
const settings = require("../../data/settings");
const logger = require("../../helpers/logger-api");

const { classifySyntheticTraffic, isVerifiedSynthetic, TRAFFIC } = syntheticTraffic;
const TOKEN = "s3cret-token";

describe("classifySyntheticTraffic — decision table", () => {
  const classify = (overrides) =>
    classifySyntheticTraffic({ testHeader: undefined, tokenHeader: undefined, configuredToken: TOKEN, ...overrides });

  it("treats a request without synthetic headers as user traffic", () => {
    expect(classify({})).toBe(TRAFFIC.USER);
  });

  it("labels X-Synthetic-Test: true as unverified synthetic traffic", () => {
    expect(classify({ testHeader: "true" })).toBe(TRAFFIC.SYNTHETIC);
  });

  it("matches the test header case-insensitively", () => {
    expect(classify({ testHeader: "TRUE" })).toBe(TRAFFIC.SYNTHETIC);
    expect(classify({ testHeader: " True " })).toBe(TRAFFIC.SYNTHETIC);
  });

  it("does not accept truthy look-alikes for the test header", () => {
    for (const value of ["1", "yes", "on", "", "false"]) {
      expect(classify({ testHeader: value })).toBe(TRAFFIC.USER);
    }
  });

  it("verifies a matching token, with or without the test header", () => {
    expect(classify({ tokenHeader: TOKEN })).toBe(TRAFFIC.SYNTHETIC_VERIFIED);
    expect(classify({ testHeader: "true", tokenHeader: TOKEN })).toBe(TRAFFIC.SYNTHETIC_VERIFIED);
  });

  it("fails soft on a wrong token: synthetic, never rejected and never verified", () => {
    expect(classify({ testHeader: "true", tokenHeader: "wrong" })).toBe(TRAFFIC.SYNTHETIC);
    expect(classify({ tokenHeader: "wrong" })).toBe(TRAFFIC.SYNTHETIC);
  });

  it("compares tokens of a different length without throwing", () => {
    expect(() => classify({ tokenHeader: `${TOKEN}-longer` })).not.toThrow();
    expect(classify({ tokenHeader: TOKEN.slice(0, 3) })).toBe(TRAFFIC.SYNTHETIC);
  });

  it("never verifies when no token is configured on the server", () => {
    expect(classify({ tokenHeader: "", configuredToken: "" })).toBe(TRAFFIC.USER);
    expect(classify({ testHeader: "true", tokenHeader: "anything", configuredToken: "" })).toBe(TRAFFIC.SYNTHETIC);
  });

  it("ignores both headers when the feature is disabled", () => {
    expect(classify({ testHeader: "true", tokenHeader: TOKEN, isFeatureEnabled: false })).toBe(TRAFFIC.USER);
  });
});

describe("synthetic traffic middleware", () => {
  let originalToken;

  beforeEach(() => {
    originalToken = settings.SYNTHETIC_TOKEN;
    settings.SYNTHETIC_TOKEN = TOKEN;
    syntheticTraffic.setEnabled(true);
  });

  afterEach(() => {
    settings.SYNTHETIC_TOKEN = originalToken;
    syntheticTraffic.setEnabled(true);
  });

  function buildApp() {
    const app = express();
    app.use(syntheticTraffic);
    app.get("/probe", (req, res) => res.json({ traffic: req.syntheticTraffic }));
    return app;
  }

  it("tags user traffic and adds no synthetic headers", async () => {
    const res = await request(buildApp()).get("/probe").expect(200);
    expect(res.body.traffic).toBe("user");
    expect(res.headers["x-synthetic-traffic"]).toBeUndefined();
    expect(res.headers["x-synthetic-verified"]).toBeUndefined();
  });

  it("echoes the unverified tier so a monitor can assert on it", async () => {
    const res = await request(buildApp()).get("/probe").set("X-Synthetic-Test", "true").expect(200);
    expect(res.body.traffic).toBe("synthetic");
    expect(res.headers["x-synthetic-traffic"]).toBe("synthetic");
    expect(res.headers["x-synthetic-verified"]).toBe("false");
  });

  it("echoes the verified tier for a valid token", async () => {
    const res = await request(buildApp()).get("/probe").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(res.body.traffic).toBe("synthetic_verified");
    expect(res.headers["x-synthetic-traffic"]).toBe("synthetic_verified");
    expect(res.headers["x-synthetic-verified"]).toBe("true");
  });

  it("reads the configured token at request time", async () => {
    settings.SYNTHETIC_TOKEN = "";
    const res = await request(buildApp()).get("/probe").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(res.body.traffic).toBe("synthetic");
  });

  it("follows the hot toggle", async () => {
    syntheticTraffic.setEnabled(false);
    expect(syntheticTraffic.isEnabled()).toBe(false);
    const res = await request(buildApp()).get("/probe").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(res.body.traffic).toBe("user");
    expect(res.headers["x-synthetic-traffic"]).toBeUndefined();
  });
});

describe("rate limiting — only the general API limiters skip verified traffic", () => {
  // In the test env every limiter's ceiling is a million (see limiters.test.js), so
  // the real limiters are loaded once more with production ceilings to see them bite.
  let limiters;
  const envSnapshot = {};

  beforeEach(() => {
    for (const key of ["NODE_ENV", "VITEST"]) envSnapshot[key] = process.env[key];
    process.env.NODE_ENV = "production";
    process.env.VITEST = "false";
    const limitersPath = require.resolve("../../api/limiters");
    delete require.cache[limitersPath];
    limiters = require(limitersPath);
    delete require.cache[limitersPath];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function appWith(limiter, traffic) {
    const app = express();
    app.use((req, res, next) => {
      req.syntheticTraffic = traffic;
      next();
    });
    app.get("/probe", limiter, (req, res) => res.json({ ok: true }));
    return app;
  }

  async function statusesAfter(app, count) {
    const statuses = new Set();
    for (let i = 0; i < count; i += 1) {
      const res = await request(app).get("/probe");
      statuses.add(res.status);
    }
    return statuses;
  }

  it("isVerifiedSynthetic is true only for the verified tier", () => {
    expect(isVerifiedSynthetic({ syntheticTraffic: "synthetic_verified" })).toBe(true);
    expect(isVerifiedSynthetic({ syntheticTraffic: "synthetic" })).toBe(false);
    expect(isVerifiedSynthetic({ syntheticTraffic: "user" })).toBe(false);
    expect(isVerifiedSynthetic({})).toBe(false);
  });

  it("apiLimiter throttles user and unverified traffic past the limit", async () => {
    const overLimit = settings.RATE_LIMIT_MAX_REQUESTS + 1;
    expect(await statusesAfter(appWith(limiters.apiLimiter, "user"), overLimit)).toContain(429);
    expect(await statusesAfter(appWith(limiters.apiLimiter, "synthetic"), overLimit)).toContain(429);
  });

  it("apiLimiter lets verified synthetic traffic through past the limit", async () => {
    const overLimit = settings.RATE_LIMIT_MAX_REQUESTS + 1;
    const statuses = await statusesAfter(appWith(limiters.apiLimiter, "synthetic_verified"), overLimit);
    expect([...statuses]).toEqual([200]);
  });

  it("authLimiter keeps throttling verified synthetic traffic", async () => {
    // authLimiter allows 1000 per window outside the test env
    const statuses = await statusesAfter(appWith(limiters.authLimiter, "synthetic_verified"), 1001);
    expect(statuses).toContain(429);
  }, 60000);
});

describe("request logging — synthetic fields", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = settings.LOG_REQUEST;
    settings.LOG_REQUEST = true;
    logger.clearLogList();
    logger.setLogLevel("TRACE");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    settings.LOG_REQUEST = snapshot;
    logger.clearLogList();
    vi.restoreAllMocks();
  });

  const fakeReq = (syntheticTraffic) => ({ method: "GET", originalUrl: "/api/v1/about", body: {}, syntheticTraffic });

  it("marks verified, unverified and user entries", () => {
    logger.logRequest(fakeReq("synthetic_verified"));
    logger.logRequest(fakeReq("synthetic"));
    logger.logRequest(fakeReq("user"));
    const [user, unverified, verified] = logger.getLogList();
    expect(verified).toMatchObject({ synthetic: true, verified: true });
    expect(unverified).toMatchObject({ synthetic: true, verified: false });
    expect(user).toMatchObject({ synthetic: false, verified: false });
  });

  it("treats a request that never passed the middleware as user traffic", () => {
    logger.logRequest(fakeReq(undefined));
    expect(logger.getLogList()[0]).toMatchObject({ synthetic: false, verified: false });
  });

  it("prefixes synthetic console lines", () => {
    logger.logRequest(fakeReq("synthetic"));
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[REQUEST\]\[SYNTHETIC\] /));
  });
});

describe("chaos mirroring — the synthetic token never leaves the process", () => {
  const chaosEngineMiddleware = require("../../middleware/chaos-engine.middleware");

  it("strips X-Synthetic-Token but keeps X-Synthetic-Test", () => {
    const mirrored = chaosEngineMiddleware.mirrorHeaders({
      "x-synthetic-test": "true",
      "x-synthetic-token": TOKEN,
      accept: "application/json",
    });
    expect(mirrored).not.toHaveProperty("x-synthetic-token");
    expect(mirrored).toMatchObject({ "x-synthetic-test": "true", accept: "application/json" });
  });
});
