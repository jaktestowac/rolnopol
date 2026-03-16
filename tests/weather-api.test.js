import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function setWeatherEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { weatherPageEnabled: enabled } })
    .expect(200);
}

async function setWeatherInsightsEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { weatherUserInsightsEnabled: enabled } })
    .expect(200);
}

async function setWeatherDataExportEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { weatherWeatherDataExport: enabled } })
    .expect(200);
}

async function createAndLoginUser() {
  const email = `weather_user_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password = "pass123";

  await request(app).post("/api/v1/register").send({ email, password, displayedName: "Weather User" }).expect(201);

  const login = await request(app).post("/api/v1/login").send({ email, password }).expect(200);

  return login.body?.data?.token;
}

describe("Weather API", () => {
  let originalFlags;
  let authToken;

  beforeAll(async () => {
    const flagsRes = await request(app).get("/api/v1/feature-flags").expect(200);
    originalFlags = flagsRes.body?.data?.flags || {};
    await setWeatherEnabled(true);
    await setWeatherInsightsEnabled(true);
    await setWeatherDataExportEnabled(true);
    authToken = await createAndLoginUser();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("GET /api/v1/weather returns deterministic day weather without auth", async () => {
    const date = "2026-08-13";

    const resA = await request(app).get(`/api/v1/weather?date=${date}&region=PL-14`).expect(200);
    const resB = await request(app).get(`/api/v1/weather?date=${date}&region=PL-14`).expect(200);

    expect(resA.body.success).toBe(true);
    expect(resA.body.data.weather).toBeTruthy();
    expect(resA.body.data.weather.date).toBe(date);
    expect(typeof resA.body.data.weather.condition).toBe("string");
    expect(typeof resA.body.data.weather.advisory).toBe("string");
    expect(resA.body.data.weather).toEqual(resB.body.data.weather);
  });

  it("GET /api/v1/weather/regions returns region options from API", async () => {
    const res = await request(app).get("/api/v1/weather/regions").expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.regions)).toBe(true);
    expect(res.body.data.regions.length).toBeGreaterThan(0);
    expect(res.body.data.defaultRegion).toBe("PL-14");
    expect(res.body.data.regions).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PL-14", name: "mazowieckie" })]));
  });

  it("GET /api/v1/weather/forecast returns max 7 upcoming days", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const res = await request(app).get(`/api/v1/weather/forecast?date=${tomorrow}&days=20&region=PL-14`).expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.forecast)).toBe(true);
    expect(res.body.data.forecast.length).toBeLessThanOrEqual(7);
    expect(res.body.data.constraints).toBeTruthy();
    expect(res.body.data.constraints.message).toContain("next 7 upcoming days");
  });

  it("GET /api/v1/weather/forecast outside allowed horizon returns empty forecast with message", async () => {
    const farFuture = new Date(Date.now() + 86400000 * 20).toISOString().slice(0, 10);

    const res = await request(app).get(`/api/v1/weather/forecast?date=${farFuture}&days=7&region=PL-14`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.forecast).toEqual([]);
    expect(res.body.message).toContain("next 7 upcoming days");
  });

  it("GET /api/v1/weather/user-insights requires authenticated user", async () => {
    const res = await request(app).get("/api/v1/weather/user-insights").expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Access token required");
  });

  it("GET /api/v1/weather/user-insights returns personalized panel data for authenticated users", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const res = await request(app).get(`/api/v1/weather/user-insights?date=${tomorrow}&region=PL-14`).set("token", authToken).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.insights).toBeTruthy();
    expect(res.body.data.insights).toHaveProperty("summary");
    expect(res.body.data.insights).toHaveProperty("farmProfile");
    expect(Array.isArray(res.body.data.insights.recommendations)).toBe(true);
  });

  it("GET /api/v1/weather/export/csv works without auth and includes weather columns only", async () => {
    const date = "2026-08-13";

    const res = await request(app).get(`/api/v1/weather/export/csv?date=${date}&region=PL-14&days=3`).expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.text).toContain("date,region,condition,temperatureMinC,temperatureMaxC");
    expect(res.text).not.toContain("farmProfile");
    expect(res.text).not.toContain("recommendations");
    expect(res.text).not.toContain("userContext");
  });

  it("GET /api/v1/weather/export/pdf works without auth and is served as PDF", async () => {
    const date = "2026-08-13";

    const res = await request(app).get(`/api/v1/weather/export/pdf?date=${date}&region=PL-14&days=3`).buffer(true).expect(200);

    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.body).toBeTruthy();
    expect(res.body.length).toBeGreaterThan(100);
  });

  it("GET /api/v1/weather/export/csv returns 404 when weather export feature flag is disabled", async () => {
    await setWeatherDataExportEnabled(false);

    const res = await request(app).get("/api/v1/weather/export/csv").expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Weather export not found");

    await setWeatherDataExportEnabled(true);
  });

  it("GET /api/v1/weather/user-insights returns 404 when insights feature flag is disabled", async () => {
    await setWeatherInsightsEnabled(false);

    const res = await request(app).get("/api/v1/weather/user-insights").set("token", authToken).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Weather insights not found");

    await setWeatherInsightsEnabled(true);
  });

  it("returns 404 when weather feature flag is disabled", async () => {
    await setWeatherEnabled(false);

    const res = await request(app).get("/api/v1/weather").expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Weather not found");

    await setWeatherEnabled(true);
  });
});
