import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function resetChaosEngine() {
  await request(app).post("/api/v1/chaos-engine/reset").expect(200);
}

describe("Chaos Engine API", () => {
  afterAll(async () => {
    await resetChaosEngine();
  });

  it("GET /api/v1/chaos-engine returns mode, config and presets", async () => {
    const res = await request(app).get("/api/v1/chaos-engine").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("mode");
    expect(res.body.data).toHaveProperty("config");
    expect(res.body.data).toHaveProperty("presets");
    expect(res.body.data.presets).toHaveProperty("off");
    expect(res.body.data.presets).toHaveProperty("custom");
    expect(res.body.data.presets).toHaveProperty("level5");
    expect(res.headers.etag).toBeUndefined();
  });

  it("requests are completely unaffected when chaos engine is off", async () => {
    // ensure engine is explicitly turned off (reset also defaults to off)
    await request(app).patch("/api/v1/chaos-engine").send({ mode: "off" }).expect(200);

    const res = await request(app).get("/api/v1/about").expect(200);
    expect(res.body.success).toBe(true);
    // no chaos headers should be present
    expect(res.headers["x-chaos-effect"]).toBeUndefined();
    expect(res.headers["x-chaos-latency-ms"]).toBeUndefined();
    expect(res.headers["x-chaos-mirrored"]).toBeUndefined();

    await resetChaosEngine();
  });

  it("PATCH /api/v1/chaos-engine can switch to predefined level", async () => {
    const res = await request(app).patch("/api/v1/chaos-engine").send({ mode: "level2" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe("level2");
    expect(res.body.data.config.enabled).toBe(true);
    expect(res.body.data.config.latency.enabled).toBe(true);
    expect(res.body.data.customConfig.latency.maxMs).toBe(300);
    expect(res.body.data.customConfig.errorInjection.statusCodes).toEqual([500, 502]);

    await resetChaosEngine();
  });

  it("mode change keeps custom configuration synchronized with selected preset", async () => {
    const res = await request(app).patch("/api/v1/chaos-engine").send({ mode: "level4" }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe("level4");
    expect(res.body.data.customConfig.responseLoss.enabled).toBe(true);
    expect(res.body.data.customConfig.responseLoss.probability).toBe(0.06);
    expect(res.body.data.customConfig.latency.minMs).toBe(250);
    expect(res.body.data.customConfig.latency.maxMs).toBe(1200);
    expect(res.body.data.customConfig.errorInjection.statusCodes).toEqual([500, 502, 503, 504]);

    await resetChaosEngine();
  });

  it("PATCH /api/v1/chaos-engine saves custom config and sets custom mode", async () => {
    const customConfig = {
      enabled: true,
      latency: { enabled: true, probability: 0.1, minMs: 10, maxMs: 20 },
      responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
      errorInjection: { enabled: true, probability: 0.2, statusCodes: [500, 503], message: "Custom synthetic fault" },
      scope: {
        methods: ["GET", "POST"],
        excludePaths: ["/v1/chaos-engine"],
        includePaths: ["/v1/foo"],
        queryParams: { a: "b" },
        headers: { "x-test": "1" },
        hostnames: ["example.com"],
        roles: ["tester"],
        ipRanges: ["1.2.3.4"],
        geolocation: ["us"],
        percentOfTraffic: 99,
      },
    };

    const res = await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe("custom");
    expect(res.body.data.customConfig.errorInjection.statusCodes).toEqual([500, 503]);
    expect(res.body.data.config.errorInjection.message).toContain("Custom synthetic fault");
    // verify enhanced scope round-trips
    const returned = res.body.data.customConfig.scope;
    expect(returned.includePaths).toEqual(["/v1/foo"]);
    expect(returned.queryParams).toEqual({ a: "b" });
    expect(returned.headers).toEqual({ "x-test": "1" });
    expect(returned.hostnames).toEqual(["example.com"]);
    expect(returned.roles).toEqual(["tester"]);
    expect(returned.ipRanges).toEqual(["1.2.3.4"]);
    expect(returned.geolocation).toEqual(["us"]);
    expect(returned.percentOfTraffic).toBe(99);

    await resetChaosEngine();
  });

  it("PUT /api/v1/chaos-engine validates payload", async () => {
    const res = await request(app).put("/api/v1/chaos-engine").send({ customConfig: {} }).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Validation failed");
  });

  it("injects synthetic error responses when configured", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: true, probability: 1, statusCodes: [503], message: "Forced chaos error" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 100 },
        },
      })
      .expect(200);

    const impacted = await request(app).get("/api/v1/about").expect(503);
    expect(impacted.body.success).toBe(false);
    expect(impacted.body.error).toContain("Forced chaos error");
    expect(impacted.headers["x-chaos-effect"]).toBe("error-injection");

    await resetChaosEngine();
  });

  // new tests for richer response-loss modes
  it("drops the connection when responseLoss mode is drop", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: true, probability: 1, mode: "drop", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], message: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"] },
        },
      })
      .expect(200);

    // supertest will reject the promise if the socket is destroyed mid-flight
    await expect(request(app).get("/api/v1/about")).rejects.toThrow(/socket hang up|ECONNRESET/);

    await resetChaosEngine();
  });

  it("returns a truncated/partial body when responseLoss mode is partial", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: true, probability: 1, mode: "partial", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], message: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"] },
        },
      })
      .expect(200);

    // the request should fail because the connection is torn down after a few bytes
    await expect(request(app).get("/api/v1/about")).rejects.toThrow(/socket hang up|ECONNRESET/);

    await resetChaosEngine();
  });

  // additional feature tests
  it("supports random status code ranges when randomStatus is true", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: {
            enabled: true,
            probability: 1,
            statusCodes: [400, 402],
            randomStatus: true,
            message: "range",
          },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 100 },
        },
      })
      .expect(200);

    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      const r = await request(app).get("/api/v1/about");
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThanOrEqual(402);
      seen.add(r.status);
    }
    expect(seen.size).toBeGreaterThan(1);

    await resetChaosEngine();
  });

  it("stateful scenario triggers failure after configured count", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "" },
          stateful: { enabled: true, requestCount: 2 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 100 },
        },
      })
      .expect(200);

    await request(app).get("/api/v1/about").expect(200);
    await request(app).get("/api/v1/about").expect(200);
    const bad = await request(app).get("/api/v1/about").expect(500);
    expect(bad.headers["x-chaos-effect"]).toBe("stateful-trigger");
    // next request should succeed again since counter resets
    await request(app).get("/api/v1/about").expect(200);

    await resetChaosEngine();
  });

  it("traffic-based targeting respects percentOfTraffic", async () => {
    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: true, probability: 1, statusCodes: [503], message: "" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: false, probability: 0, targetUrl: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 0 },
        },
      })
      .expect(200);

    // 0 percent traffic should never inject an error
    await request(app).get("/api/v1/about").expect(200);
    await request(app).get("/api/v1/about").expect(200);

    await resetChaosEngine();
  });

  it("mirroring pushes entries when enabled", async () => {
    // clear any leftover data
    const middleware = require("../middleware/chaos-engine.middleware");
    if (middleware.getMirroredRequests) {
      middleware.getMirroredRequests().length = 0;
    }

    await request(app)
      .patch("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], randomStatus: false, message: "" },
          stateful: { enabled: false, requestCount: 0 },
          mirroring: { enabled: true, probability: 1, targetUrl: "http://dummy" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine"], percentOfTraffic: 100 },
        },
      })
      .expect(200);

    await request(app).get("/api/v1/about").expect(200);
    const list = middleware.getMirroredRequests();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty("method", "GET");

    await resetChaosEngine();
  });
});
