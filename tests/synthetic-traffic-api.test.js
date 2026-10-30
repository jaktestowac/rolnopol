import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";

// Synthetic monitoring support, end to end through the real app: the contract a
// student's Playwright monitor is written against (echo headers, the
// syntheticMonitoringEnabled hot toggle, /api/logs?synthetic=, the `traffic`
// metrics label). The classifier's full decision table lives in the unit suite.
const app = require("../api/index.js");
const settings = require("../data/settings");
const logger = require("../helpers/logger-api");

const TOKEN = "integration-synthetic-token";

async function patchFlags(flags) {
  await request(app).patch("/api/v1/feature-flags").send({ flags }).expect(200);
}

function trafficCounter(metricsText, traffic, route = "/api/v1/healthcheck") {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `rolnopol_http_requests_total\\{method="GET",route="${escapedRoute}",status_code="200",traffic="${traffic}"\\}\\s+(\\d+)`,
  );
  const match = metricsText.match(pattern);
  return match ? Number(match[1]) : 0;
}

describe("Synthetic monitoring API", () => {
  let originalFlags;
  let originalToken;

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = res.body.data.flags || {};
  });

  afterAll(async () => {
    await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
  });

  beforeEach(async () => {
    originalToken = settings.SYNTHETIC_TOKEN;
    settings.SYNTHETIC_TOKEN = TOKEN;
    await patchFlags({ syntheticMonitoringEnabled: true });
  });

  afterEach(() => {
    settings.SYNTHETIC_TOKEN = originalToken;
  });

  it("is a monitoring flag that defaults to enabled", async () => {
    const res = await request(app).get("/api/v1/feature-flags").expect(200);
    expect(res.body.data.flags).toHaveProperty("syntheticMonitoringEnabled", true);
  });

  it("echoes nothing for a regular request", async () => {
    const res = await request(app).get("/api/v1/healthcheck").expect(200);
    expect(res.headers["x-synthetic-traffic"]).toBeUndefined();
    expect(res.headers["x-synthetic-verified"]).toBeUndefined();
  });

  it("echoes the unverified tier for X-Synthetic-Test, and for a wrong token", async () => {
    const bare = await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Test", "true").expect(200);
    expect(bare.headers["x-synthetic-traffic"]).toBe("synthetic");
    expect(bare.headers["x-synthetic-verified"]).toBe("false");

    const wrong = await request(app)
      .get("/api/v1/healthcheck")
      .set("X-Synthetic-Test", "true")
      .set("X-Synthetic-Token", "not-the-token")
      .expect(200);
    expect(wrong.headers["x-synthetic-traffic"]).toBe("synthetic");
    expect(wrong.headers["x-synthetic-verified"]).toBe("false");
  });

  it("echoes the verified tier for the configured token", async () => {
    const res = await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(res.headers["x-synthetic-traffic"]).toBe("synthetic_verified");
    expect(res.headers["x-synthetic-verified"]).toBe("true");
  });

  it("stops recognising synthetic traffic when the flag is switched off, without a restart", async () => {
    await patchFlags({ syntheticMonitoringEnabled: false });
    const off = await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(off.headers["x-synthetic-traffic"]).toBeUndefined();

    await patchFlags({ syntheticMonitoringEnabled: true });
    const on = await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Token", TOKEN).expect(200);
    expect(on.headers["x-synthetic-traffic"]).toBe("synthetic_verified");
  });

  describe("GET /api/logs?synthetic=", () => {
    let logRequestSnapshot;

    beforeEach(() => {
      logRequestSnapshot = settings.LOG_REQUEST;
      settings.LOG_REQUEST = true;
      logger.clearLogList();
    });

    afterEach(() => {
      settings.LOG_REQUEST = logRequestSnapshot;
      logger.clearLogList();
    });

    it("separates synthetic request entries from user ones", async () => {
      await request(app).get("/api/v1/about?who=user").expect(200);
      await request(app).get("/api/v1/about?who=monitor").set("X-Synthetic-Token", TOKEN).expect(200);

      const synthetic = await request(app).get("/api/logs?synthetic=true").expect(200);
      const syntheticUrls = synthetic.body.logs.map((entry) => entry.url);
      expect(syntheticUrls).toContain("/api/v1/about?who=monitor");
      expect(syntheticUrls).not.toContain("/api/v1/about?who=user");
      expect(synthetic.body.logs.every((entry) => entry.synthetic === true)).toBe(true);
      const monitorEntry = synthetic.body.logs.find((entry) => entry.url === "/api/v1/about?who=monitor");
      expect(monitorEntry.verified).toBe(true);

      const user = await request(app).get("/api/logs?synthetic=false").expect(200);
      const userUrls = user.body.logs.map((entry) => entry.url);
      expect(userUrls).toContain("/api/v1/about?who=user");
      expect(userUrls).not.toContain("/api/v1/about?who=monitor");
    });

    it("ignores an unrecognised filter value and returns both kinds", async () => {
      await request(app).get("/api/v1/about?who=user").expect(200);
      await request(app).get("/api/v1/about?who=monitor").set("X-Synthetic-Test", "true").expect(200);

      const res = await request(app).get("/api/logs?synthetic=maybe").expect(200);
      const urls = res.body.logs.map((entry) => entry.url);
      expect(urls).toEqual(expect.arrayContaining(["/api/v1/about?who=user", "/api/v1/about?who=monitor"]));
    });
  });

  it("splits request metrics by the traffic label", async () => {
    await patchFlags({ prometheusMetricsEnabled: false });
    await patchFlags({ prometheusMetricsEnabled: true }); // disabling clears the counters

    await request(app).get("/api/v1/healthcheck").expect(200);
    await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Test", "true").expect(200);
    await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Token", TOKEN).expect(200);
    await request(app).get("/api/v1/healthcheck").set("X-Synthetic-Token", TOKEN).expect(200);

    const res = await request(app).get("/api/v1/metrics").expect(200);
    expect(trafficCounter(res.text, "user")).toBe(1);
    expect(trafficCounter(res.text, "synthetic")).toBe(1);
    expect(trafficCounter(res.text, "synthetic_verified")).toBe(2);
    expect(res.text).toMatch(
      /rolnopol_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/healthcheck",status_code="200",traffic="synthetic_verified"\} 2/,
    );
  });
});
