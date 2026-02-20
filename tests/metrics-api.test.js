import { describe, it, expect } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

function getRouteCounter(metricsText, route, method = "GET", statusCode = "200") {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `rolnopol_http_requests_total\\{method="${method}",route="${escapedRoute}",status_code="${statusCode}"\\}\\s+(\\d+)`,
  );
  const match = metricsText.match(pattern);
  return match ? Number(match[1]) : 0;
}

describe("Metrics API", () => {
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

    expect(countAfterReEnable).toBe(countBeforeDisable);

    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });
});
