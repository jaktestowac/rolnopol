import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const app = require("../api/index.js");

const BASE = {
  latitude: 52.2297,
  longitude: 21.0122,
  magnitudeLimit: 4.2,
  timestamp: "2026-05-31T21:00:00.000Z",
  width: 820,
  height: 820,
};

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

function getViewport(query) {
  return request(app)
    .get("/api/v1/observatory/viewport")
    .query({ ...BASE, ...query })
    .expect(200);
}

describe("Observatory viewport API", () => {
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

  it("answers the whole dome with canvas coordinates for every object", async () => {
    const res = await getViewport({});
    const { viewport, dome, inView } = res.body.data;

    expect(res.body.success).toBe(true);
    expect(viewport).toMatchObject({
      zoom: 1,
      panX: 0,
      panY: 0,
      magnitudeLimit: 4.2,
      canvas: { width: 820, height: 820, centerX: 410, centerY: 410, radius: 368 },
    });
    // Nothing panned: the aperture looks straight up.
    expect(viewport.center).toMatchObject({ altitudeDeg: 90, azimuthDeg: 0 });

    expect(dome.objectCount).toBeGreaterThan(10);
    expect(dome.objects).toHaveLength(dome.objectCount);
    expect(dome.inViewCount + dome.outOfViewCount).toBe(dome.objectCount);
    expect(inView.objectIds).toHaveLength(inView.objectCount);

    dome.objects.forEach((object) => {
      expect(object.altitudeDeg).toBeGreaterThan(0);
      expect(object.magnitude).toBeLessThanOrEqual(4.2);
      expect(Math.hypot(object.domeX, object.domeY)).toBeLessThanOrEqual(1);
      expect(typeof object.canvasX).toBe("number");
      expect(typeof object.inView).toBe("boolean");
    });

    // At zoom 1 the whole dome fits inside the aperture, which is the baseline
    // every zoomed assertion below is measured against.
    expect(dome.outOfViewCount).toBe(0);
  });

  it("keeps the full dome while zooming pushes objects out of the aperture", async () => {
    const wide = await getViewport({ zoom: 1 });
    const tight = await getViewport({ zoom: 3 });

    // The dome does not shrink — only the slice of it the aperture shows does.
    expect(tight.body.data.dome.objectCount).toBe(wide.body.data.dome.objectCount);
    expect(tight.body.data.dome.inViewCount).toBeLessThan(wide.body.data.dome.inViewCount);
    expect(tight.body.data.dome.outOfViewCount).toBeGreaterThan(0);

    // Zooming about the zenith keeps the highest objects; what leaves is what
    // was nearest the horizon.
    const stillShown = new Set(tight.body.data.inView.objectIds);
    const droppedAltitudes = wide.body.data.dome.objects.filter((object) => !stillShown.has(object.id)).map((o) => o.altitudeDeg);
    const keptAltitudes = tight.body.data.dome.objects.filter((object) => object.inView).map((o) => o.altitudeDeg);
    expect(Math.min(...keptAltitudes)).toBeGreaterThan(Math.max(...droppedAltitudes));
  });

  it("reports the panned aperture centre in alt/az and clamps a pan to the horizon", async () => {
    const east = await getViewport({ panX: 0.5, panY: 0 });
    expect(east.body.data.viewport.center).toMatchObject({ altitudeDeg: 45, azimuthDeg: 90 });

    const north = await getViewport({ panX: 0, panY: -1 });
    expect(north.body.data.viewport.center).toMatchObject({ altitudeDeg: 0, azimuthDeg: 0 });

    // A drag that overshoots lands on the rim rather than off the dome.
    const overshoot = await getViewport({ panX: 9, panY: 9 });
    expect(Math.hypot(overshoot.body.data.viewport.panX, overshoot.body.data.viewport.panY)).toBeCloseTo(1, 4);
    expect(overshoot.body.data.viewport.center.altitudeDeg).toBe(0);
  });

  it("clamps zoom to the range the page can actually reach", async () => {
    const under = await getViewport({ zoom: 0.1 });
    const over = await getViewport({ zoom: 500 });

    expect(under.body.data.viewport.zoom).toBe(1);
    expect(over.body.data.viewport.zoom).toBe(8);
  });

  it("applies the same frontend filters the page does", async () => {
    const unfiltered = await getViewport({});
    const planetsOnly = await getViewport({ objectType: "planet" });

    expect(planetsOnly.body.data.viewport.filters).toMatchObject({ objectType: "planet", constellation: "all", search: "" });
    expect(planetsOnly.body.data.dome.objects.every((object) => object.type === "planet")).toBe(true);
    expect(planetsOnly.body.data.dome.objectCount).toBeLessThan(unfiltered.body.data.dome.objectCount);

    // Search against a constellation that is genuinely up at this instant, so
    // the assertion is about the filter and not about the sky.
    const constellation = unfiltered.body.data.dome.objects.find((object) => object.type === "star").constellation;
    const searched = await getViewport({ search: constellation.toLowerCase() });
    expect(searched.body.data.dome.objectCount).toBeGreaterThan(0);
    expect(searched.body.data.dome.objects.every((object) => object.constellation === constellation)).toBe(true);
  });

  it("scales the aperture with the canvas the caller reports", async () => {
    const small = await getViewport({ width: 400, height: 400 });
    const large = await getViewport({ width: 1200, height: 1200 });

    expect(small.body.data.viewport.canvas.radius).toBe(158);
    expect(large.body.data.viewport.canvas.radius).toBe(558);
    // Same sky, same dome coordinates — only the pixel mapping differs.
    expect(small.body.data.dome.objectCount).toBe(large.body.data.dome.objectCount);
    expect(small.body.data.dome.objects[0].domeX).toBe(large.body.data.dome.objects[0].domeX);
    expect(small.body.data.dome.objects[0].canvasX).not.toBe(large.body.data.dome.objects[0].canvasX);
  });

  it("groups the drawn lines into figures a viewer could click on", async () => {
    const res = await getViewport({});
    const { dome, inView } = res.body.data;
    const objectsById = new Map(dome.objects.map((object) => [object.id, object]));

    expect(dome.constellationCount).toBeGreaterThan(15);
    expect(dome.constellations).toHaveLength(dome.constellationCount);

    dome.constellations.forEach((figure) => {
      expect(figure.starCount).toBeGreaterThanOrEqual(2);
      expect(figure.segmentCount).toBeGreaterThanOrEqual(1);
      expect(figure.starIds).toHaveLength(figure.starCount);
      expect(figure.inViewCount).toBeLessThanOrEqual(figure.starCount);

      // Every star it claims is really on the dome, in this figure.
      figure.starIds.forEach((id) => {
        expect(objectsById.get(id)?.constellation).toBe(figure.name);
      });

      // The brightest is the brightest, not merely the first.
      const magnitudes = figure.starIds.map((id) => objectsById.get(id).magnitude);
      expect(objectsById.get(figure.brightestObjectId).magnitude).toBe(Math.min(...magnitudes));
    });

    expect(inView.constellationNames.sort()).toEqual(
      dome.constellations
        .filter((figure) => figure.inView)
        .map((figure) => figure.name)
        .sort(),
    );
  });

  it("keeps every figure on the dome while zooming takes them out of view", async () => {
    const wide = await getViewport({ zoom: 1 });
    const tight = await getViewport({ zoom: 4 });

    expect(tight.body.data.dome.constellationCount).toBe(wide.body.data.dome.constellationCount);
    expect(tight.body.data.inView.constellationNames.length).toBeLessThan(wide.body.data.inView.constellationNames.length);
  });

  it("is deterministic for the same inputs and rejects an invalid timestamp", async () => {
    const first = await getViewport({ zoom: 2, panX: 0.1 });
    const second = await getViewport({ zoom: 2, panX: 0.1 });
    expect(first.body.data.dome).toEqual(second.body.data.dome);

    const invalid = await request(app).get("/api/v1/observatory/viewport").query({ timestamp: "not-a-real-date" }).expect(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error).toContain("Invalid observatory timestamp");
  });

  it("returns 404 when the observatory flag is off", async () => {
    await setObservatoryEnabled(false);

    const res = await request(app).get("/api/v1/observatory/viewport").expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Observatory not found");

    await setObservatoryEnabled(true);
  });
});

describe("Observatory observer pinning", () => {
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

  it("stops relabelling coordinates as a preset once the caller pins them as custom", async () => {
    const query = { latitude: 52.2297, longitude: 21.0122, timestamp: "2026-05-31T21:00:00.000Z" };

    // Warsaw's own coordinates: without a pin the backend recognises them...
    const recognised = await request(app).get("/api/v1/observatory").query(query).expect(200);
    expect(recognised.body.data.observer).toMatchObject({ id: "warsaw", label: "Warsaw, Poland" });

    // ...and with `presetId=custom` it takes the caller at their word, which is
    // what keeps the page's location control from snapping back to the preset.
    const pinned = await request(app)
      .get("/api/v1/observatory")
      .query({ ...query, presetId: "custom" })
      .expect(200);
    expect(pinned.body.data.observer).toMatchObject({
      id: "custom",
      label: "Custom coordinates",
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
    });

    // A real preset id still resolves as before — the pin changes nothing but
    // the reverse-matching of unnamed coordinates.
    const preset = await request(app).get("/api/v1/observatory").query({ presetId: "tokyo", timestamp: query.timestamp }).expect(200);
    expect(preset.body.data.observer).toMatchObject({ id: "tokyo", label: "Tokyo, Japan", latitudeDeg: 35.6762 });
  });

  it("pins the observer on the viewport endpoint too", async () => {
    const res = await getViewport({ presetId: "custom" });
    expect(res.body.data.observer).toMatchObject({ id: "custom", label: "Custom coordinates" });
  });
});
