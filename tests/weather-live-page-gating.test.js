import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setLiveEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { weatherLiveStreamEnabled: enabled } })
    .expect(200);
}

describe("Weather Live HTML page gating", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns a 404 page when the feature flag is disabled", async () => {
    await setLiveEnabled(false);

    const res = await request(app).get("/weather-live.html").expect(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the weather live page when the feature flag is enabled", async () => {
    await setLiveEnabled(true);

    const res = await request(app).get("/weather-live.html").expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Weather Live - Rolnopol");
    expect(res.text).toContain('id="weatherLiveAlerts"');
  });

  it("redirects /weather-live to /weather-live.html when enabled", async () => {
    await setLiveEnabled(true);

    const res = await request(app).get("/weather-live").expect(302);
    expect(res.headers.location).toBe("/weather-live.html");
  });
});
