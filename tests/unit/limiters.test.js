import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

// The six rate limiters (api/limiters.js).
//
// Two things make these worth testing despite being almost entirely declarative.
//
// The first is the test-env escape hatch. `resolveMax` raises every ceiling to a
// million under NODE_ENV=test, and it has to: the integration suites fire hundreds
// of requests through one process, and without it they would start returning 429
// somewhere in the middle. Break `resolveMax` and the failure lands as a flake in
// whichever suite happens to be long that week, nowhere near the cause.
//
// The second is `rateLimitType`. It is a self-description read by
// `build/lib/introspect-routes.js` to decide whether an operation can answer 429
// in the generated OpenAPI document. Nothing at runtime reads it, so nothing at
// runtime notices when it is wrong — the schema just quietly stops documenting a
// response the API really does return.
const limiters = require("../../api/limiters");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { RATE_LIMIT_WINDOW_MS, HIGH_RATE_LIMIT_WINDOW_MS } = require("../../data/settings");

const LIMITER_NAMES = ["apiLimiter", "apiHighLimiter", "strictLimiter", "authLimiter", "verifyLimiter", "adminDashboardLimiter"];
const TEST_SAFE_MAX = 1_000_000;

/** Mount one limiter and make a single request through it. */
async function callThrough(limiter, path = "/probe") {
  const app = express();
  app.get(path, limiter, (req, res) => res.json({ ok: true }));
  return request(app).get(path);
}

/** The `RateLimit-Policy` header, split into its max and its window in seconds. */
function policyOf(response) {
  const [max, window] = String(response.headers["ratelimit-policy"] || "").split(";w=");
  return { max: Number(max), windowSeconds: Number(window) };
}

describe("limiters — the exported set", () => {
  it("exports exactly the six limiters, and nothing else", () => {
    expect(Object.keys(limiters).sort()).toEqual([...LIMITER_NAMES].sort());
  });

  it("exports each one as express middleware", () => {
    for (const name of LIMITER_NAMES) {
      expect(typeof limiters[name]).toBe("function");
      expect(limiters[name]).toHaveLength(3);
    }
  });

  it("gives each limiter its own instance, so one endpoint's traffic cannot exhaust another's budget", () => {
    const instances = LIMITER_NAMES.map((name) => limiters[name]);
    expect(new Set(instances).size).toBe(instances.length);
  });
});

describe("limiters — the NODE_ENV=test escape hatch", () => {
  it("runs under the test environment this hatch exists for", () => {
    // If this fails, every assertion below is measuring something else.
    expect(process.env.NODE_ENV === "test" || process.env.VITEST === "true").toBe(true);
  });

  it("raises every ceiling to the test-safe maximum", async () => {
    for (const name of LIMITER_NAMES) {
      const response = await callThrough(limiters[name]);
      expect(response.status).toBe(200);
      expect(policyOf(response).max).toBe(TEST_SAFE_MAX);
    }
  });

  it("does not throttle a burst far larger than the production ceiling", async () => {
    // Production allows 100 per 30s. 150 sequential requests through the same
    // limiter must all pass, or the integration suites cannot run in one process.
    const app = express();
    app.get("/burst", limiters.apiLimiter, (req, res) => res.json({ ok: true }));
    const agent = request(app);

    const statuses = [];
    for (let index = 0; index < 150; index += 1) {
      statuses.push((await agent.get("/burst")).status);
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it("leaves the strictest limiter just as unthrottled — verification is the tightest in production", async () => {
    const app = express();
    app.get("/verify", limiters.verifyLimiter, (req, res) => res.json({ ok: true }));
    const agent = request(app);

    for (let index = 0; index < 60; index += 1) {
      expect((await agent.get("/verify")).status).toBe(200);
    }
  });
});

describe("limiters — windows are NOT masked by the test hatch", () => {
  // `resolveMax` touches the ceiling only. The windows are real in every
  // environment, and they are the half of the config that says what each limiter
  // is for.
  it("gives the general and strict limiters the configured standard window", async () => {
    const expected = RATE_LIMIT_WINDOW_MS / 1000;

    for (const name of ["apiLimiter", "strictLimiter", "authLimiter", "adminDashboardLimiter"]) {
      expect(policyOf(await callThrough(limiters[name])).windowSeconds).toBe(expected);
    }
  });

  it("gives the high-volume limiter the high-volume window", async () => {
    expect(policyOf(await callThrough(limiters.apiHighLimiter)).windowSeconds).toBe(HIGH_RATE_LIMIT_WINDOW_MS / 1000);
  });

  it("gives verification its own five-minute window, longer than every other limiter's", async () => {
    const verify = policyOf(await callThrough(limiters.verifyLimiter));
    const api = policyOf(await callThrough(limiters.apiLimiter));

    expect(verify.windowSeconds).toBe(300);
    expect(verify.windowSeconds).toBeGreaterThan(api.windowSeconds);
  });
});

describe("limiters — response headers", () => {
  it("emits the standard RateLimit headers", async () => {
    const response = await callThrough(limiters.apiLimiter);

    expect(response.headers).toHaveProperty("ratelimit-limit");
    expect(response.headers).toHaveProperty("ratelimit-remaining");
    expect(response.headers).toHaveProperty("ratelimit-reset");
    expect(response.headers).toHaveProperty("ratelimit-policy");
  });

  it("does not emit the legacy X-RateLimit headers", async () => {
    const response = await callThrough(limiters.apiLimiter);

    for (const header of Object.keys(response.headers)) {
      expect(header).not.toMatch(/^x-ratelimit-/);
    }
  });

  it("counts down remaining from the limit", async () => {
    const app = express();
    app.get("/count", limiters.authLimiter, (req, res) => res.json({ ok: true }));
    const agent = request(app);

    const first = await agent.get("/count");
    const second = await agent.get("/count");

    expect(Number(second.headers["ratelimit-remaining"])).toBeLessThan(Number(first.headers["ratelimit-remaining"]));
  });
});

describe("limiters — the rateLimitType self-description", () => {
  it("tags every limiter", () => {
    for (const name of LIMITER_NAMES) {
      expect(typeof limiters[name].rateLimitType).toBe("string");
      expect(limiters[name].rateLimitType.length).toBeGreaterThan(0);
    }
  });

  it("gives each limiter a distinct tag, so the generator cannot conflate two", () => {
    const tags = LIMITER_NAMES.map((name) => limiters[name].rateLimitType);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("uses the exact tags the OpenAPI generator reads", () => {
    expect(limiters.apiLimiter.rateLimitType).toBe("api");
    expect(limiters.apiHighLimiter.rateLimitType).toBe("high");
    expect(limiters.strictLimiter.rateLimitType).toBe("strict");
    expect(limiters.authLimiter.rateLimitType).toBe("auth");
    expect(limiters.verifyLimiter.rateLimitType).toBe("verify");
    expect(limiters.adminDashboardLimiter.rateLimitType).toBe("admin");
  });

  it("round-trips through createRateLimiter for every type that factory names", () => {
    // The tags are documented as matching createRateLimiter's `type` argument.
    // This is the assertion that keeps that comment true.
    for (const type of ["api", "high", "auth", "verify", "admin"]) {
      expect(createRateLimiter(type).rateLimitType).toBe(type);
    }
  });

  it("falls back to the general limiter for an unknown type, strict included", () => {
    // `strict` is a real tag with no case in createRateLimiter — routes reach that
    // limiter by importing it directly, not through the factory. Pinned so the
    // asymmetry is a decision on record rather than a surprise.
    expect(createRateLimiter("strict").rateLimitType).toBe("api");
    expect(createRateLimiter("nonsense").rateLimitType).toBe("api");
    expect(createRateLimiter().rateLimitType).toBe("api");
  });

  it("returns the very same instances the module exports, not copies", () => {
    expect(createRateLimiter("auth")).toBe(limiters.authLimiter);
    expect(createRateLimiter("verify")).toBe(limiters.verifyLimiter);
    expect(createRateLimiter("admin")).toBe(limiters.adminDashboardLimiter);
    expect(createRateLimiter("high")).toBe(limiters.apiHighLimiter);
    expect(createRateLimiter("api")).toBe(limiters.apiLimiter);
  });
});
