import { describe, expect, it } from "vitest";

const {
  CONSTELLATION_SEGMENTS,
  PLANET_CATALOG,
  STAR_CATALOG,
  getMoonPhaseInfo,
  getPlanetObjects,
  getSnapshot,
  getViewport,
  projectAltAzToDome,
  resolveCanvasMetrics,
  resolveObserver,
  resolveViewport,
  unprojectDomeToAltAz,
} = require("../../services/observatory.service.js");

describe("observatory service", () => {
  it("calculates moon phase metadata in valid ranges", () => {
    const moon = getMoonPhaseInfo(new Date("2026-05-31T21:00:00.000Z"));

    expect(moon.raHours).toBeGreaterThanOrEqual(0);
    expect(moon.raHours).toBeLessThan(24);
    expect(moon.decDeg).toBeGreaterThanOrEqual(-90);
    expect(moon.decDeg).toBeLessThanOrEqual(90);
    expect(moon.illuminationPct).toBeGreaterThanOrEqual(0);
    expect(moon.illuminationPct).toBeLessThanOrEqual(100);
    expect(moon.phaseLabel.length).toBeGreaterThan(0);
  });

  it("builds a backend snapshot with observer, moon, and visible sky objects", () => {
    const snapshot = getSnapshot({
      timestamp: "2026-05-31T21:00:00.000Z",
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
      magnitudeLimit: 4.2,
    });

    expect(snapshot.page.pageUrl).toBe("/operator/observatory.html");
    expect(snapshot.observer).toMatchObject({
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
    });
    expect(snapshot.sky.moon).toMatchObject({
      id: "moon",
      name: "Moon",
      type: "moon",
    });
    expect(Array.isArray(snapshot.sky.visibleObjects)).toBe(true);
    expect(Array.isArray(snapshot.sky.constellations)).toBe(true);
    expect(Array.isArray(snapshot.sky.planets)).toBe(true);
    expect(snapshot.sky.planets.some((planet) => planet.id === "venus" && planet.type === "planet")).toBe(true);
    expect(snapshot.sky.featuredObjectId).toBe("moon");
  });

  it("builds planet objects with valid equatorial coordinates", () => {
    const observer = {
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
    };
    const planets = getPlanetObjects({
      date: new Date("2026-05-31T21:00:00.000Z"),
      observer,
    });

    expect(PLANET_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(PLANET_CATALOG.some((planet) => planet.id === "pluto")).toBe(true);
    expect(planets).toHaveLength(PLANET_CATALOG.length);
    expect(planets.every((planet) => planet.type === "planet")).toBe(true);
    expect(planets.every((planet) => planet.raHours >= 0 && planet.raHours < 24)).toBe(true);
    expect(planets.every((planet) => planet.decDeg >= -90 && planet.decDeg <= 90)).toBe(true);
  });

  it("round-trips alt/az through the dome projection", () => {
    const zenith = projectAltAzToDome(90, 137);
    expect(zenith.x).toBeCloseTo(0, 8);
    expect(zenith.y).toBeCloseTo(0, 8);
    // A bearing is meaningless straight overhead, so it reads as north.
    expect(unprojectDomeToAltAz(zenith.x, zenith.y)).toMatchObject({ altitudeDeg: 90, azimuthDeg: 0 });

    [
      [0, 0],
      [0, 90],
      [30, 210],
      [64.5, 318.25],
    ].forEach(([altitudeDeg, azimuthDeg]) => {
      const dome = projectAltAzToDome(altitudeDeg, azimuthDeg);
      const back = unprojectDomeToAltAz(dome.x, dome.y);
      expect(back.altitudeDeg).toBeCloseTo(altitudeDeg, 8);
      expect(back.azimuthDeg).toBeCloseTo(azimuthDeg, 8);
    });

    // North is -y and east is +x, matching how the canvas is drawn.
    expect(projectAltAzToDome(0, 0)).toMatchObject({ x: expect.closeTo(0, 8), y: expect.closeTo(-1, 8) });
    expect(projectAltAzToDome(0, 90)).toMatchObject({ x: expect.closeTo(1, 8), y: expect.closeTo(0, 8) });
  });

  it("clamps the requested viewport into something the dome can actually show", () => {
    expect(resolveViewport({})).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
    expect(resolveViewport({ zoom: 0 }).zoom).toBe(1);
    expect(resolveViewport({ zoom: 1000 }).zoom).toBe(8);

    const overshoot = resolveViewport({ panX: 3, panY: -4 });
    expect(Math.hypot(overshoot.panX, overshoot.panY)).toBeCloseTo(1, 4);
    expect(overshoot.center.altitudeDeg).toBe(0);
  });

  it("derives the aperture from the canvas the caller reports", () => {
    expect(resolveCanvasMetrics(820, 820)).toMatchObject({ width: 820, height: 820, centerX: 410, centerY: 410, radius: 368 });
    // Non-square canvases take the shorter side, and a tiny one still gets a
    // usable aperture rather than a negative radius.
    expect(resolveCanvasMetrics(1200, 600).radius).toBe(258);
    expect(resolveCanvasMetrics(320, 320).radius).toBe(120);
  });

  it("pins coordinates as custom instead of reverse-matching them to a preset", () => {
    const warsaw = { latitudeDeg: 52.2297, longitudeDeg: 21.0122 };

    expect(resolveObserver(warsaw)).toMatchObject({ id: "warsaw", label: "Warsaw, Poland" });
    expect(resolveObserver({ ...warsaw, presetId: "custom" })).toMatchObject({
      id: "custom",
      label: "Custom coordinates",
      ...warsaw,
    });
  });

  it("answers the viewport with the whole dome, flagged by what the aperture shows", () => {
    const query = {
      timestamp: "2026-05-31T21:00:00.000Z",
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
      magnitudeLimit: 4.2,
      width: 820,
      height: 820,
    };
    const wide = getViewport(query);
    const tight = getViewport({ ...query, zoom: 4 });

    expect(wide.dome.objectCount).toBeGreaterThan(10);
    expect(wide.dome.outOfViewCount).toBe(0);
    expect(tight.dome.objectCount).toBe(wide.dome.objectCount);
    expect(tight.dome.inViewCount).toBeLessThan(wide.dome.inViewCount);
    expect(tight.inView.objectIds).toHaveLength(tight.dome.inViewCount);
  });

  it("keeps constellation segments aligned with the expanded star catalog", () => {
    const starIds = new Set(STAR_CATALOG.map((star) => star.id));

    expect(STAR_CATALOG.length).toBeGreaterThan(140);
    expect(starIds.has("alnitak")).toBe(true);
    expect(starIds.has("shaula")).toBe(true);
    expect(starIds.has("sadr")).toBe(true);
    expect(starIds.has("cebalrai")).toBe(true);
    expect(starIds.has("pherkad")).toBe(true);
    expect(starIds.has("dschubba")).toBe(true);
    expect(starIds.has("sadalmelik")).toBe(true);
    expect(starIds.has("aludra")).toBe(true);
    expect(starIds.has("navi")).toBe(true);
    expect(starIds.has("kornephoros")).toBe(true);
    expect(starIds.has("gomeisa")).toBe(true);
    expect(starIds.has("diphda")).toBe(true);
    expect(starIds.has("zaniah")).toBe(true);
    expect(CONSTELLATION_SEGMENTS.length).toBeGreaterThan(135);
    expect(CONSTELLATION_SEGMENTS.every(([fromId, toId]) => starIds.has(fromId) && starIds.has(toId))).toBe(true);
  });
});
