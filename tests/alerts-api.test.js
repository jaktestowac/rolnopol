import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function createAndLoginUser() {
  const email = `alerts_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "pass123";
  await request(app).post("/api/v1/register").send({ email, password, displayedName: "Alerts User" });
  const res = await request(app).post("/api/v1/login").send({ email, password });
  const token = res.body?.data?.token;
  expect(token).toBeTruthy();
  return token;
}

async function setAlertsEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { alertsEnabled: enabled } })
    .expect(200);
}

describe("Alerts API", () => {
  let token;
  let originalFlags;
  const seed = "2025-09-09";

  beforeAll(async () => {
    token = await createAndLoginUser();
    const flagsRes = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = flagsRes.body?.data?.flags || {};
    await setAlertsEnabled(true);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("GET /api/v1/alerts returns combined data", async () => {
    const res = await request(app).get(`/api/v1/alerts?date=${seed}`).set("token", token).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("upcoming");
    expect(res.body.data).toHaveProperty("history");
    expect(res.body.data).toHaveProperty("today");
    expect(Array.isArray(res.body.data.today.alerts)).toBe(true);
  });

  it("GET /api/v1/alerts/history returns history", async () => {
    const res = await request(app).get(`/api/v1/alerts/history?date=${seed}`).set("token", token).expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.history)).toBe(true);
    expect(res.body.data.seed).toBe(seed);
  });

  it("GET /api/v1/alerts/upcoming returns upcoming", async () => {
    const res = await request(app).get(`/api/v1/alerts/upcoming?date=${seed}`).set("token", token).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.upcoming).toHaveProperty("alerts");
  });

  it("returns no alerts for future seed dates", async () => {
    // pick a date in the future (relative to now)
    const now = new Date();
    const future = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
    const futureSeed = future.toISOString().slice(0, 10);
    const futureNext = new Date(future.getTime());
    futureNext.setUTCDate(futureNext.getUTCDate() + 1);
    const futureNextSeed = futureNext.toISOString().slice(0, 10);

    const res = await request(app).get(`/api/v1/alerts?date=${futureSeed}`).set("token", token).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.seed).toBe(futureSeed);
    expect(res.body.data.today.alerts).toEqual([]);
    expect(res.body.data.upcoming.date).toBe(futureNextSeed);
    expect(res.body.data.upcoming.alerts).toEqual([]);
    expect(res.body.data.history).toEqual([]);
    expect(res.body.message).toBe("We don't have predictions for dates beyond tomorrow.");

    // Also test sub-endpoints
    const resHist = await request(app).get(`/api/v1/alerts/history?date=${futureSeed}`).set("token", token).expect(200);
    expect(resHist.body.success).toBe(true);
    expect(resHist.body.data.history).toEqual([]);
    expect(resHist.body.message).toBe("We don't have predictions for dates beyond tomorrow.");

    const resUp = await request(app).get(`/api/v1/alerts/upcoming?date=${futureSeed}`).set("token", token).expect(200);
    expect(resUp.body.success).toBe(true);
    expect(resUp.body.data.upcoming.date).toBe(futureNextSeed);
    expect(resUp.body.data.upcoming.alerts).toEqual([]);
    expect(resUp.body.message).toBe("We don't have predictions for dates beyond tomorrow.");
  });

  describe("when alerts feature flag is disabled", () => {
    afterEach(async () => {
      await setAlertsEnabled(true);
    });

    it("GET /api/v1/alerts returns 404", async () => {
      await setAlertsEnabled(false);

      const res = await request(app).get(`/api/v1/alerts?date=${seed}`).set("token", token).expect(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Alerts not found");
      expect(typeof res.body.timestamp).toBe("string");
    });

    it("GET /api/v1/alerts/history returns 404", async () => {
      await setAlertsEnabled(false);

      const res = await request(app).get(`/api/v1/alerts/history?date=${seed}`).set("token", token).expect(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Alerts not found");
      expect(typeof res.body.timestamp).toBe("string");
    });

    it("GET /api/v1/alerts/upcoming returns 404", async () => {
      await setAlertsEnabled(false);

      const res = await request(app).get(`/api/v1/alerts/upcoming?date=${seed}`).set("token", token).expect(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Alerts not found");
      expect(typeof res.body.timestamp).toBe("string");
    });
  });
});
