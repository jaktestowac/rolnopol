import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function resetChaosEngine() {
  const res = await request(app).post("/api/v1/chaos-engine/reset").expect(200);
}

function getRouteCounter(metricsText, route, method = "GET", statusCode = "200") {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `rolnopol_http_requests_total\\{method="${method}",route="${escapedRoute}",status_code="${statusCode}"\\}\\s+(\\d+)`,
  );
  const match = metricsText.match(pattern);
  return match ? Number(match[1]) : 0;
}

function getChaosCounter(metricsText, effect, route) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`rolnopol_chaos_events_total\\{effect="${effect}",mode="([^"]+)",route="${escapedRoute}"\\}\\s+(\\d+)`);
  const match = metricsText.match(pattern);
  return match ? Number(match[2]) : 0;
}

describe("Metrics API", () => {
  beforeEach(async () => {
    // ensure chaos engine is disabled before each test
    console.log("[metrics test] calling resetChaosEngine");
    await resetChaosEngine();
    // verify engine state is off
    const info = await request(app).get("/api/v1/chaos-engine").expect(200);
    console.log("[metrics test] chaos state after reset", info.body.data);
  });
  it("GET /api/v1/metrics is disabled by default via feature flag", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: false } })
      .expect(200);

    const res = await request(app).get("/api/v1/metrics").expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("not found");
    expect(res.headers.etag).toBeUndefined();

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  it("GET /api/v1/metrics returns Prometheus format when enabled", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    // Generate some traffic before scraping metrics
    await request(app).get("/api/v1/healthcheck").expect(200);

    const res = await request(app).get("/api/v1/metrics").expect(200);

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# HELP rolnopol_http_requests_total");
    expect(res.text).toContain("rolnopol_http_requests_total");
    expect(res.text).toContain("rolnopol_process_uptime_seconds");
    expect(res.headers.etag).toBeUndefined();

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  it("hot-toggle disables and re-enables runtime collection", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    await request(app).get("/api/v1/healthcheck").expect(200);
    const beforeDisable = await request(app).get("/api/v1/metrics").expect(200);
    const countBeforeDisable = getRouteCounter(beforeDisable.text, "/api/v1/healthcheck");

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: false } })
      .expect(200);

    await request(app).get("/api/v1/healthcheck").expect(200);

    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    const afterReEnable = await request(app).get("/api/v1/metrics").expect(200);
    const countAfterReEnable = getRouteCounter(afterReEnable.text, "/api/v1/healthcheck");

    // counters are cleared when metrics collection is disabled, so we expect zero after re-enable
    expect(countAfterReEnable).toBe(0);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  it("records chaos engine events in metrics when effects occur", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    await request(app)
      .put("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
          errorInjection: { enabled: true, probability: 1, statusCodes: [500], message: "Metric test" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine", "/metrics"] },
        },
      })
      .expect(200);

    for (let i = 0; i < 3; i += 1) {
      await request(app).get("/api/v1/healthcheck").expect(500);
    }

    const res = await request(app).get("/api/v1/metrics").expect(200);
    // middleware is mounted on '/api', so recorded paths exclude that prefix
    const chaosCount = getChaosCounter(res.text, "error-injection", "/v1/healthcheck");
    expect(chaosCount).toBeGreaterThanOrEqual(3);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    await request(app).post("/api/v1/chaos-engine/reset").expect(200);
  });

  it("records response-loss events in metrics when drop mode is active", async () => {
    // make sure metrics collection is on
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    await request(app)
      .put("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: true, probability: 1, mode: "drop", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], message: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine", "/metrics"] },
        },
      })
      .expect(200);

    // fire a few requests which should be torn down by the middleware
    for (let i = 0; i < 3; i += 1) {
      try {
        await request(app).get("/api/v1/healthcheck");
      } catch (e) {
        // expected connection error
      }
    }

    const res = await request(app).get("/api/v1/metrics").expect(200);
    const chaosCount = getChaosCounter(res.text, "response-loss", "/v1/healthcheck");
    expect(chaosCount).toBeGreaterThanOrEqual(3);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    await request(app).post("/api/v1/chaos-engine/reset").expect(200);
  });

  it("records response-loss events in metrics when partial mode is active", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    await request(app)
      .put("/api/v1/chaos-engine")
      .send({
        mode: "custom",
        customConfig: {
          enabled: true,
          latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
          responseLoss: { enabled: true, probability: 1, mode: "partial", timeoutMs: 1000 },
          errorInjection: { enabled: false, probability: 0, statusCodes: [500], message: "" },
          scope: { methods: ["GET"], excludePaths: ["/v1/chaos-engine", "/metrics"] },
        },
      })
      .expect(200);

    for (let i = 0; i < 3; i += 1) {
      try {
        await request(app).get("/api/v1/healthcheck");
      } catch (e) {
        // expect torn connection
      }
    }

    const res2 = await request(app).get("/api/v1/metrics").expect(200);
    const chaosCount2 = getChaosCounter(res2.text, "response-loss", "/v1/healthcheck");
    expect(chaosCount2).toBeGreaterThanOrEqual(3);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    await request(app).post("/api/v1/chaos-engine/reset").expect(200);
  });

  it("honors enhanced scope filters", async () => {
    const originalRes = await request(app).get("/api/v1/feature-flags").expect(200);
    const originalFlags = originalRes.body.data.flags || {};
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { prometheusMetricsEnabled: true } })
      .expect(200);

    // helper to configure chaos with given scope and then perform a request
    async function shouldApply(scope, reqBuilder, expectedStatus) {
      console.log("checking scope", JSON.stringify(scope));
      // start with clean state so that previous runs don't leak scope fields
      await resetChaosEngine();
      // always protect chaos endpoints from being targeted by the scoped filter
      const safeScope = { ...scope };
      if (!safeScope.excludePaths) safeScope.excludePaths = [];
      // ensure reset endpoint never participates
      if (!safeScope.excludePaths.includes("/v1/chaos-engine/reset")) {
        safeScope.excludePaths.push("/v1/chaos-engine/reset");
      }
      await request(app)
        .put("/api/v1/chaos-engine")
        .send({
          mode: "custom",
          customConfig: {
            enabled: true,
            latency: { enabled: false, probability: 0, minMs: 0, maxMs: 0 },
            responseLoss: { enabled: false, probability: 0, mode: "timeout", timeoutMs: 1200 },
            errorInjection: { enabled: true, probability: 1, statusCodes: [500], message: "Scope test" },
            scope: safeScope,
          },
        })
        .expect(200);
      const res = await reqBuilder();
      console.log("result status", res.status, "expected", expectedStatus);
      expect(res.status).toBe(expectedStatus);
    }

    // path inclusion
    await shouldApply({ includePaths: ["/v1/healthcheck"] }, () => request(app).get("/api/v1/healthcheck"), 500);
    await shouldApply({ includePaths: ["/v1/other"] }, () => request(app).get("/api/v1/healthcheck"), 200);

    // query parameters (clear excludePaths so we can hit healthcheck)
    await shouldApply({ queryParams: { foo: "bar" }, excludePaths: [] }, () => request(app).get("/api/v1/healthcheck?foo=bar"), 500);
    await shouldApply({ queryParams: { foo: "baz" }, excludePaths: [] }, () => request(app).get("/api/v1/healthcheck?foo=bar"), 200);

    // headers (clear excludePaths so path isn't blocked)
    await shouldApply(
      { headers: { "x-test": "foo" }, excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("x-test", "foo"),
      500,
    );
    await shouldApply(
      { headers: { "x-test": "foo" }, excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("x-test", "bar"),
      200,
    );

    // hostname match (clear excludePaths so healthcheck isn't blocked)
    await shouldApply(
      { hostnames: ["example.com"], excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("Host", "example.com"),
      500,
    );
    await shouldApply(
      { hostnames: ["foo.com"], excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("Host", "example.com"),
      200,
    );

    // roles via header
    await shouldApply(
      { roles: ["admin"], excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("x-user-roles", "admin"),
      500,
    );
    await shouldApply(
      { roles: ["admin"], excludePaths: [] },
      () => request(app).get("/api/v1/healthcheck").set("x-user-roles", "user"),
      200,
    );

    // ip range regex (local address may be ::ffff:127.0.0.1)
    await shouldApply({ ipRanges: ["/127\\.0\\.0\\.1$/"], excludePaths: [] }, () => request(app).get("/api/v1/healthcheck"), 500);
    await shouldApply({ ipRanges: ["10.0.0.1"], excludePaths: [] }, () => request(app).get("/api/v1/healthcheck"), 200);

    // geolocation header
    await shouldApply({ geolocation: ["us"], excludePaths: [] }, () => request(app).get("/api/v1/healthcheck").set("x-geo", "us"), 500);
    await shouldApply({ geolocation: ["eu"], excludePaths: [] }, () => request(app).get("/api/v1/healthcheck").set("x-geo", "us"), 200);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    await request(app).post("/api/v1/chaos-engine/reset").expect(200);
  });
});
