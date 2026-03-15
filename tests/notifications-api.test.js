import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const featureFlagsService = require("../services/feature-flags.service");

describe("Notifications API", () => {
  let originalNotificationCenterEnabled = false;

  beforeAll(async () => {
    const data = await featureFlagsService.getFeatureFlags();
    originalNotificationCenterEnabled = data?.flags?.notificationCenterEnabled === true;
  });

  afterAll(async () => {
    await featureFlagsService.updateFlags({
      notificationCenterEnabled: originalNotificationCenterEnabled,
    });
  });

  it("returns 404 for /notifications endpoints when feature is disabled", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: false });

    await request(app).get("/api/v1/notifications/health").expect(404);
    await request(app).get("/api/v1/notifications/events").expect(404);
    await request(app).get("/api/v1/notifications/test-event").expect(404);
    await request(app).post("/api/v1/notifications/test-event").send({ userId: "api-test-user" }).expect(404);
  });

  it("GET /api/v1/notifications/health returns module health payload when feature is enabled", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: true });

    const res = await request(app).get("/api/v1/notifications/health").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("status");
    expect(res.body.data).toHaveProperty("module");
    expect(res.body.data.module).toHaveProperty("enabled");
    expect(res.body.data).toHaveProperty("featureFlags");
    expect(res.body.data.featureFlags).toHaveProperty("notificationCenterEnabled");
    expect(res.body.data).toHaveProperty("endpoints");
    expect(res.body.data.endpoints.testEvent.get).toBe("/api/v1/notifications/test-event");
    expect(["healthy", "disabled", "degraded"]).toContain(res.body.data.status);
  });

  it("GET /api/v1/notifications/events returns events collection payload when feature is enabled", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: true });

    const res = await request(app).get("/api/v1/notifications/events?limit=10&offset=0").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("items");
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("offset");
    expect(res.body.data).toHaveProperty("module");
    expect(res.body.data).toHaveProperty("featureFlags");
    expect(res.body.data.featureFlags).toHaveProperty("notificationCenterEnabled");
    expect(res.body.data).toHaveProperty("endpoints");
    expect(res.body.data.endpoints.testEvent.post).toBe("/api/v1/notifications/test-event");
  });

  it("POST /api/v1/notifications/test-event returns trigger result payload when feature is enabled", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: true });

    const res = await request(app).post("/api/v1/notifications/test-event").send({ userId: "api-test-user", note: "smoke" }).expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("accepted");
    expect(res.body.data).toHaveProperty("event");
    expect(res.body.data).toHaveProperty("correlationId");
    expect(res.body.data).toHaveProperty("featureFlags");
    expect(res.body.data.featureFlags).toHaveProperty("notificationCenterEnabled");
    expect(res.body.data.event.type).toBe("notification.test.triggered");
  });

  it("GET /api/v1/notifications/test-event triggers event using query payload when feature is enabled", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: true });

    const res = await request(app).get("/api/v1/notifications/test-event?userId=get-user&note=get-smoke").expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("accepted");
    expect(res.body.data).toHaveProperty("event");
    expect(res.body.data).toHaveProperty("correlationId");
    expect(res.body.data).toHaveProperty("featureFlags");
    expect(res.body.data.featureFlags).toHaveProperty("notificationCenterEnabled");
    expect(res.body.data.event.type).toBe("notification.test.triggered");
    expect(res.body.data.event.payload.userId).toBe("get-user");
  });

  it("forceFail marks test-event as failed even when policy is not found", async () => {
    await featureFlagsService.updateFlags({ notificationCenterEnabled: true });

    const triggerRes = await request(app)
      .post("/api/v1/notifications/test-event")
      .send({ userId: "api-test-user", forceFail: true, forceFailReason: "api-test-force-fail" })
      .expect(202);

    expect(triggerRes.body.success).toBe(true);
    expect(triggerRes.body.data.accepted).toBe(true);
    const correlationId = triggerRes.body.data.correlationId;
    expect(typeof correlationId).toBe("string");
    expect(correlationId.length).toBeGreaterThan(0);

    const deadline = Date.now() + 16000;
    let matches = [];
    let failedMatch = null;

    while (Date.now() < deadline) {
      const eventsRes = await request(app)
        .get(`/api/v1/notifications/events?correlationId=${encodeURIComponent(correlationId)}`)
        .expect(200);

      expect(eventsRes.body.success).toBe(true);
      expect(Array.isArray(eventsRes.body.data.items)).toBe(true);

      matches = eventsRes.body.data.items.filter((x) => x.correlationId === correlationId);
      failedMatch = matches.find((x) => x.status === "failed");

      if (failedMatch) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(matches.length).toBeGreaterThan(0);
    expect(failedMatch).toBeTruthy();
    expect(failedMatch.status).toBe("failed");
    expect(String(failedMatch.error || "")).toContain("forced_fail:api-test-force-fail");
  }, 20000);
});
