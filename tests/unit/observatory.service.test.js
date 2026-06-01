import { describe, expect, it } from "vitest";

const {
  CONSTELLATION_SEGMENTS,
  PLANET_CATALOG,
  STAR_CATALOG,
  getMoonPhaseInfo,
  getPlanetObjects,
  getSnapshot,
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
