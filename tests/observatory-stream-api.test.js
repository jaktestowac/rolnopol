import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function parseSnapshots(sseBody) {
  return sseBody
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .filter((payload) => payload?.simulation);
}

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

describe("Observatory live sky stream (SSE)", () => {
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

  it("streams SSE snapshot frames matching the REST snapshot shape, and closes at the limit", async () => {
    const res = await request(app)
      .get("/api/v1/observatory/stream")
      .query({
        latitude: 52.2297,
        longitude: 21.0122,
        magnitudeLimit: 4.2,
        timestamp: "2026-05-31T21:00:00.000Z",
        tickIntervalMs: 100,
        limit: 3,
      })
      .buffer(true)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-cache");

    const body = res.text;
    expect(countOccurrences(body, "event: snapshot")).toBe(3);
    expect(countOccurrences(body, "event: complete")).toBe(1);
    expect(body).toContain("id: 1");

    const [firstSnapshot] = parseSnapshots(body);
    expect(firstSnapshot.page).toMatchObject({ title: "Operator Observatory", pageUrl: "/operator/observatory.html" });
    expect(firstSnapshot.observer).toMatchObject({ latitudeDeg: 52.2297, longitudeDeg: 21.0122 });
    expect(firstSnapshot.sky).toEqual(
      expect.objectContaining({
        moon: expect.objectContaining({ id: "moon", name: "Moon" }),
        planets: expect.any(Array),
        visibleObjects: expect.any(Array),
        constellations: expect.any(Array),
      }),
    );
  }, 15000);

  it("advances the simulated clock between ticks according to timeScale", async () => {
    const res = await request(app)
      .get("/api/v1/observatory/stream")
      .query({
        latitude: 52.2297,
        longitude: 21.0122,
        timestamp: "2026-05-31T21:00:00.000Z",
        timeScale: 3600,
        tickIntervalMs: 100,
        limit: 2,
      })
      .buffer(true)
      .expect(200);

    const snapshots = parseSnapshots(res.text);

    expect(snapshots.length).toBe(2);
    const firstTs = new Date(snapshots[0].simulation.requestedTimestamp).getTime();
    const secondTs = new Date(snapshots[1].simulation.requestedTimestamp).getTime();
    // timeScale=3600 over a ~100ms real tick should advance simulated time by
    // roughly 100*3600ms (~6 minutes); assert it moved forward substantially
    // rather than pin an exact value (real tick spacing has scheduler jitter).
    expect(secondTs).toBeGreaterThan(firstTs + 60000);
  }, 15000);

  it("keeps the simulated clock effectively frozen when timeScale is 0", async () => {
    const res = await request(app)
      .get("/api/v1/observatory/stream")
      .query({
        latitude: 52.2297,
        longitude: 21.0122,
        timestamp: "2026-05-31T21:00:00.000Z",
        timeScale: 0,
        tickIntervalMs: 60000,
        limit: 1,
      })
      .buffer(true)
      .expect(200);

    // With no interval registered for a paused stream, only the initial
    // snapshot (sent immediately on connect) satisfies limit=1.
    const snapshots = parseSnapshots(res.text);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].simulation.requestedTimestamp).toBe("2026-05-31T21:00:00.000Z");
  }, 15000);

  it("reflects a requested presetId in every streamed snapshot's observer", async () => {
    const res = await request(app)
      .get("/api/v1/observatory/stream")
      .query({
        presetId: "sydney",
        timestamp: "2026-05-31T21:00:00.000Z",
        tickIntervalMs: 80,
        limit: 3,
      })
      .buffer(true)
      .expect(200);

    const snapshots = parseSnapshots(res.text);
    expect(snapshots).toHaveLength(3);
    snapshots.forEach((snapshot) => {
      expect(snapshot.observer).toMatchObject({ id: "sydney", latitudeDeg: -33.8688, longitudeDeg: 151.2093 });
    });
  }, 15000);

  it("applies magnitudeLimit consistently across streamed ticks", async () => {
    const res = await request(app)
      .get("/api/v1/observatory/stream")
      .query({
        latitude: 52.2297,
        longitude: 21.0122,
        timestamp: "2026-05-31T21:00:00.000Z",
        magnitudeLimit: 1,
        tickIntervalMs: 80,
        limit: 2,
      })
      .buffer(true)
      .expect(200);

    const snapshots = parseSnapshots(res.text);
    expect(snapshots).toHaveLength(2);
    snapshots.forEach((snapshot) => {
      expect(snapshot.sky.magnitudeLimit).toBe(1);
      expect(snapshot.sky.visibleObjects.every((object) => object.magnitude <= 1)).toBe(true);
    });
  }, 15000);

  it("returns 400 JSON (not a hung stream) for an invalid timestamp", async () => {
    const res = await request(app).get("/api/v1/observatory/stream").query({ timestamp: "not-a-date" }).expect(400);

    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Invalid observatory timestamp");
  });
});
