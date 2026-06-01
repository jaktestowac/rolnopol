import { describe, expect, it } from "vitest";

const {
  CONSTELLATION_SEGMENTS,
  PLANET_CATALOG,
  STAR_CATALOG,
  buildConstellationFilterOptions,
  calculateLocalSiderealTime,
  calculatePlanetEquatorialPosition,
  equatorialToHorizontal,
  filterVisibleObjects,
  getConstellationLabels,
  getPlanetObjects,
  getVisibleStars,
  matchesObjectFilters,
  normalizeDegrees,
  normalizeHours,
  projectAltAzToCanvas,
} = require("../../public/js/pages/observatory.js");

describe("observatory page astronomy helpers", () => {
  it("keeps angular helpers within expected ranges", () => {
    expect(normalizeDegrees(725)).toBe(5);
    expect(normalizeDegrees(-45)).toBe(315);
    expect(normalizeHours(27.5)).toBeCloseTo(3.5, 8);
    expect(normalizeHours(-1.25)).toBeCloseTo(22.75, 8);
  });

  it("calculates a zenith object when declination matches latitude and hour angle is zero", () => {
    const date = new Date("2026-05-31T00:00:00.000Z");
    const latitudeDeg = 52.2297;
    const longitudeDeg = 21.0122;
    const localSiderealTime = calculateLocalSiderealTime(date, longitudeDeg);

    const object = equatorialToHorizontal(
      {
        raHours: localSiderealTime,
        decDeg: latitudeDeg,
      },
      date,
      latitudeDeg,
      longitudeDeg,
    );

    expect(object.altitudeDeg).toBeGreaterThan(89.99);
    expect(object.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(object.azimuthDeg).toBeLessThan(360);
  });

  it("projects the zenith to the center of the canvas and the horizon to the rim", () => {
    const zenith = projectAltAzToCanvas(90, 0, 200);
    const horizonEast = projectAltAzToCanvas(0, 90, 200);

    expect(zenith.x).toBeCloseTo(0, 8);
    expect(zenith.y).toBeCloseTo(0, 8);
    expect(horizonEast.x).toBeCloseTo(200, 8);
    expect(horizonEast.y).toBeCloseTo(0, 8);
  });

  it("returns only stars above the horizon and within the requested magnitude limit", () => {
    const stars = getVisibleStars({
      date: new Date("2026-05-31T22:00:00.000Z"),
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
      magnitudeLimit: 1.2,
    });

    expect(stars.length).toBeGreaterThan(0);
    expect(stars.every((star) => star.altitudeDeg > 0)).toBe(true);
    expect(stars.every((star) => star.magnitude <= 1.2)).toBe(true);
  });

  it("builds constellation labels from visible same-constellation segments", () => {
    const labels = getConstellationLabels(
      [
        { id: "betelgeuse", type: "star", constellation: "Orion", canvasX: 100, canvasY: 120 },
        { id: "bellatrix", type: "star", constellation: "Orion", canvasX: 140, canvasY: 100 },
        { id: "rigel", type: "star", constellation: "Orion", canvasX: 130, canvasY: 170 },
        { id: "sirius", type: "star", constellation: "Canis Major", canvasX: 220, canvasY: 210 },
        { id: "procyon", type: "star", constellation: "Canis Minor", canvasX: 245, canvasY: 195 },
      ],
      [{ fromId: "betelgeuse", toId: "bellatrix" }, ["bellatrix", "rigel"], { fromId: "sirius", toId: "procyon" }],
    );

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      name: "Orion",
      starCount: 3,
    });
    expect(labels[0].x).toBeCloseTo(123.33, 1);
    expect(labels[0].y).toBeLessThan(100);
  });

  it("calculates known planet positions within valid sky ranges", () => {
    const venus = calculatePlanetEquatorialPosition(
      PLANET_CATALOG.find((planet) => planet.id === "venus"),
      new Date("2026-05-31T21:00:00.000Z"),
    );
    const planets = getPlanetObjects({
      date: new Date("2026-05-31T21:00:00.000Z"),
      latitudeDeg: 52.2297,
      longitudeDeg: 21.0122,
    });

    expect(PLANET_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(PLANET_CATALOG.some((planet) => planet.id === "pluto")).toBe(true);
    expect(venus.raHours).toBeGreaterThanOrEqual(0);
    expect(venus.raHours).toBeLessThan(24);
    expect(venus.decDeg).toBeGreaterThanOrEqual(-90);
    expect(venus.decDeg).toBeLessThanOrEqual(90);
    expect(planets).toHaveLength(PLANET_CATALOG.length);
    expect(planets.every((planet) => planet.type === "planet")).toBe(true);
  });

  it("filters visible objects by type, constellation, and search query", () => {
    const objects = [
      { id: "moon", name: "Moon", type: "moon", constellation: "Lunar orbit" },
      { id: "venus", name: "Venus", type: "planet", constellation: "Gemini" },
      { id: "jupiter", name: "Jupiter", type: "planet", constellation: "Cancer" },
      { id: "sirius", name: "Sirius", type: "star", constellation: "Canis Major" },
    ];

    expect(matchesObjectFilters(objects[1], { objectType: "planet" })).toBe(true);
    expect(matchesObjectFilters(objects[0], { objectType: "planet" })).toBe(false);
    expect(filterVisibleObjects(objects, { objectType: "solar-system", constellation: "Gemini" })).toEqual([objects[1]]);
    expect(filterVisibleObjects(objects, { objectType: "all", searchQuery: "major" })).toEqual([objects[3]]);
    expect(buildConstellationFilterOptions(objects, { objectType: "planet" })).toEqual(["all", "Cancer", "Gemini"]);
  });

  it("exports an expanded helper catalog with valid constellation connections", () => {
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
