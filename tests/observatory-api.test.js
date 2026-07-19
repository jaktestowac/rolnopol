import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

async function setObservatoryEnabled(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { observatoryEnabled: enabled } })
    .expect(200);
}

describe("Observatory REST API", () => {
  let originalFlags;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await setObservatoryEnabled(true);
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  it("returns a deterministic snapshot for the same inputs", async () => {
    const query = { latitude: 52.2297, longitude: 21.0122, magnitudeLimit: 4.2, timestamp: "2026-05-31T21:00:00.000Z" };

    const resA = await request(app).get("/api/v1/observatory").query(query).expect(200);
    const resB = await request(app).get("/api/v1/observatory").query(query).expect(200);

    expect(resA.body.success).toBe(true);
    expect(resA.body.data.sky.moon).toEqual(resB.body.data.sky.moon);
    expect(resA.body.data.sky.planets).toEqual(resB.body.data.sky.planets);
    expect(resA.body.data.sky.visibleObjects).toEqual(resB.body.data.sky.visibleObjects);
  });

  it("resolves a known preset by id and reflects it in the observer", async () => {
    const res = await request(app)
      .get("/api/v1/observatory")
      .query({ presetId: "tokyo", timestamp: "2026-05-31T21:00:00.000Z" })
      .expect(200);

    expect(res.body.data.observer).toMatchObject({
      id: "tokyo",
      label: "Tokyo, Japan",
      latitudeDeg: 35.6762,
      longitudeDeg: 139.6503,
    });
  });

  it("falls back to custom coordinates when no preset matches", async () => {
    const res = await request(app)
      .get("/api/v1/observatory")
      .query({ latitude: 10, longitude: 15, timestamp: "2026-05-31T21:00:00.000Z" })
      .expect(200);

    expect(res.body.data.observer).toMatchObject({
      id: "custom",
      latitudeDeg: 10,
      longitudeDeg: 15,
    });
  });

  it("clamps out-of-range coordinates instead of erroring", async () => {
    const res = await request(app)
      .get("/api/v1/observatory")
      .query({ latitude: 500, longitude: -900, timestamp: "2026-05-31T21:00:00.000Z" })
      .expect(200);

    expect(res.body.data.observer.latitudeDeg).toBeLessThanOrEqual(90);
    expect(res.body.data.observer.latitudeDeg).toBeGreaterThanOrEqual(-90);
    expect(res.body.data.observer.longitudeDeg).toBeLessThanOrEqual(180);
    expect(res.body.data.observer.longitudeDeg).toBeGreaterThanOrEqual(-180);
  });

  it("narrows the visible object count as the magnitude limit tightens", async () => {
    const base = { latitude: 52.2297, longitude: 21.0122, timestamp: "2026-05-31T21:00:00.000Z" };

    const wide = await request(app)
      .get("/api/v1/observatory")
      .query({ ...base, magnitudeLimit: 6 })
      .expect(200);
    const narrow = await request(app)
      .get("/api/v1/observatory")
      .query({ ...base, magnitudeLimit: 1 })
      .expect(200);

    expect(narrow.body.data.sky.visibleObjects.length).toBeLessThanOrEqual(wide.body.data.sky.visibleObjects.length);
    expect(narrow.body.data.sky.visibleObjects.every((object) => object.magnitude <= 1)).toBe(true);
  });

  it("returns the full planet catalog regardless of visibility, with correct sky-object shape", async () => {
    const res = await request(app)
      .get("/api/v1/observatory")
      .query({ latitude: 52.2297, longitude: 21.0122, timestamp: "2026-05-31T21:00:00.000Z" })
      .expect(200);

    const { planets } = res.body.data.sky;
    expect(planets.length).toBeGreaterThanOrEqual(8);
    expect(planets.map((planet) => planet.id)).toEqual(expect.arrayContaining(["mercury", "venus", "mars", "pluto"]));
    planets.forEach((planet) => {
      expect(planet).toHaveProperty("altitudeDeg");
      expect(planet).toHaveProperty("azimuthDeg");
      expect(typeof planet.visible).toBe("boolean");
    });
  });

  it("advances the moon phase across a lunar month", async () => {
    const day1 = await request(app).get("/api/v1/observatory").query({ timestamp: "2026-05-01T00:00:00.000Z" }).expect(200);
    const day15 = await request(app).get("/api/v1/observatory").query({ timestamp: "2026-05-15T00:00:00.000Z" }).expect(200);

    expect(day1.body.data.sky.moon.phaseLabel).not.toBe(day15.body.data.sky.moon.phaseLabel);
    expect(day1.body.data.sky.moon.ageDays).not.toBeCloseTo(day15.body.data.sky.moon.ageDays, 0);
  });

  it("defaults to the current time when no timestamp is provided", async () => {
    const res = await request(app).get("/api/v1/observatory").query({ latitude: 52.2297, longitude: 21.0122 }).expect(200);

    expect(res.body.data.simulation.requestedTimestamp).toBeTruthy();
    const requested = new Date(res.body.data.simulation.requestedTimestamp).getTime();
    expect(Math.abs(Date.now() - requested)).toBeLessThan(60000);
  });

  it("returns 400 with a helpful error for an invalid timestamp", async () => {
    const res = await request(app).get("/api/v1/observatory").query({ timestamp: "not-a-real-date" }).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Invalid observatory timestamp");
  });

  it("lists every supported location preset for the sidebar dropdown", async () => {
    const res = await request(app).get("/api/v1/observatory").query({ timestamp: "2026-05-31T21:00:00.000Z" }).expect(200);

    const presetIds = res.body.data.presets.map((preset) => preset.id);
    expect(presetIds).toEqual(expect.arrayContaining(["warsaw", "greenwich", "tenerife", "new-york", "tokyo", "sydney", "cape-town"]));
  });
});
