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

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Scan a range of days/regions (with jitter disabled) to find one whose base
// conditions trip exactly one severe-weather alert. Used to make the alert
// de-duplication assertion deterministic without hardcoding a magic date.
async function findSingleAlertDay() {
  const regions = ["PL-14", "PL-22", "PL-28", "PL-30", "PL-02", "PL-24"];
  const start = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 120; i += 1) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    for (const region of regions) {
      const res = await request(app).get(`/api/v1/weather/live?region=${region}&date=${date}&variance=0`).expect(200);
      const alerts = res.body?.data?.alerts || [];
      if (alerts.length === 1) {
        return { region, date, alertKey: alerts[0].key };
      }
    }
  }
  return null;
}

describe("Weather Live API (SSE)", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await setLiveEnabled(true);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("GET /api/v1/weather/live returns a JSON conditions snapshot", async () => {
    const res = await request(app).get("/api/v1/weather/live?region=PL-14&date=2026-08-13&variance=0").expect(200);

    expect(res.body.success).toBe(true);
    const { conditions, alerts } = res.body.data;
    expect(conditions).toBeTruthy();
    expect(conditions.region).toBe("PL-14");
    expect(conditions.date).toBe("2026-08-13");
    expect(typeof conditions.condition).toBe("string");
    expect(typeof conditions.temperatureC).toBe("number");
    expect(conditions.base).toBeTruthy();
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("GET /api/v1/weather/live is deterministic with variance=0", async () => {
    const url = "/api/v1/weather/live?region=PL-14&date=2026-08-13&variance=0";
    const a = await request(app).get(url).expect(200);
    const b = await request(app).get(url).expect(200);
    // observedAt is a real wall-clock timestamp; everything else is deterministic.
    const { observedAt: _a, ...condA } = a.body.data.conditions;
    const { observedAt: _b, ...condB } = b.body.data.conditions;
    expect(condA).toEqual(condB);
  });

  it("GET /api/v1/weather/live/stream streams SSE conditions frames and closes at the limit", async () => {
    const res = await request(app)
      .get("/api/v1/weather/live/stream?region=PL-14&date=2026-08-13&intervalMs=250&limit=3")
      .buffer(true)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-cache");

    const body = res.text;
    expect(countOccurrences(body, "event: conditions")).toBe(3);
    expect(body).toContain("id: 1");
    expect(body).toContain("event: complete");
    expect(body).toContain("data:");
  }, 15000);

  it("emits an alert event exactly once while a threshold stays tripped", async () => {
    const found = await findSingleAlertDay();
    expect(found, "expected to find a day with a single severe-weather alert").toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/weather/live/stream?region=${found.region}&date=${found.date}&variance=0&intervalMs=100&limit=4`)
      .buffer(true)
      .expect(200);

    const body = res.text;
    // Four identical (variance=0) conditions frames, but the alert is emitted once.
    expect(countOccurrences(body, "event: conditions")).toBe(4);
    expect(countOccurrences(body, "event: alert")).toBe(1);
    expect(body).toContain(`"key":"${found.alertKey}"`);
  }, 20000);

  it("returns 404 for both endpoints when the feature flag is disabled", async () => {
    await setLiveEnabled(false);

    const snapshot = await request(app).get("/api/v1/weather/live").expect(404);
    expect(snapshot.body.success).toBe(false);
    expect(snapshot.body.error).toBe("Weather live not found");

    const stream = await request(app).get("/api/v1/weather/live/stream").expect(404);
    expect(stream.body.success).toBe(false);
    expect(stream.body.error).toBe("Weather live not found");

    await setLiveEnabled(true);
  });
});
