import { describe, expect, it } from "vitest";

/**
 * The star catalog exists twice — once in the backend service and once in the
 * browser page, which is a standalone IIFE and cannot require the service. That
 * duplication is deliberate, but it is only safe while the two copies are
 * identical: the page projects the sky the backend measured, so a star that
 * exists on one side and not the other is a sky that disagrees with itself.
 */
const service = require("../../services/observatory.service.js");
const page = require("../../public/js/pages/observatory.js");

describe("observatory catalog", () => {
  it("is byte-for-byte the same on the server and in the browser", () => {
    expect(page.STAR_CATALOG).toEqual(service.STAR_CATALOG);
    expect(page.CONSTELLATION_SEGMENTS).toEqual(service.CONSTELLATION_SEGMENTS);
    expect(page.PLANET_CATALOG).toEqual(service.PLANET_CATALOG);
    expect(page.LOCATION_PRESETS).toEqual(service.LOCATION_PRESETS);
  });

  it("holds well-formed, unique stars", () => {
    const { STAR_CATALOG } = service;
    const ids = new Set();
    const names = new Set();
    const positions = new Set();

    STAR_CATALOG.forEach((star) => {
      expect(ids.has(star.id), `duplicate id ${star.id}`).toBe(false);
      expect(names.has(star.name), `duplicate name ${star.name}`).toBe(false);
      ids.add(star.id);
      names.add(star.name);

      // Two catalog entries on the same spot are one star recorded twice.
      const position = `${star.raHours.toFixed(3)},${star.decDeg.toFixed(3)}`;
      expect(positions.has(position), `duplicate position for ${star.id}`).toBe(false);
      positions.add(position);

      expect(star.raHours, star.id).toBeGreaterThanOrEqual(0);
      expect(star.raHours, star.id).toBeLessThan(24);
      expect(star.decDeg, star.id).toBeGreaterThanOrEqual(-90);
      expect(star.decDeg, star.id).toBeLessThanOrEqual(90);
      expect(star.magnitude, star.id).toBeGreaterThan(-2);
      expect(star.magnitude, star.id).toBeLessThan(7);
      expect(star.constellation.trim(), star.id).not.toBe("");
      expect(star.color, star.id).toMatch(/^#[0-9a-f]{6}$/i);
    });

    expect(STAR_CATALOG.length).toBeGreaterThan(380);
  });

  it("draws only figures whose stars it actually has, and never the same line twice", () => {
    const ids = new Set(service.STAR_CATALOG.map((star) => star.id));
    const drawn = new Set();

    service.CONSTELLATION_SEGMENTS.forEach(([fromId, toId]) => {
      expect(ids.has(fromId), `segment references unknown star ${fromId}`).toBe(true);
      expect(ids.has(toId), `segment references unknown star ${toId}`).toBe(true);
      expect(fromId, "a segment cannot join a star to itself").not.toBe(toId);

      const line = [fromId, toId].sort().join("~");
      expect(drawn.has(line), `duplicate segment ${line}`).toBe(false);
      drawn.add(line);
    });

    expect(service.CONSTELLATION_SEGMENTS.length).toBeGreaterThan(350);
  });

  it("covers the sky broadly enough that somewhere is always worth looking at", () => {
    const byConstellation = new Map();
    service.STAR_CATALOG.forEach((star) => {
      byConstellation.set(star.constellation, (byConstellation.get(star.constellation) || 0) + 1);
    });

    expect(byConstellation.size).toBeGreaterThan(80);
    // Both hemispheres, and enough away from the celestial equator that a
    // high-latitude observer still has a populated sky.
    expect(service.STAR_CATALOG.filter((star) => star.decDeg > 45).length).toBeGreaterThan(25);
    expect(service.STAR_CATALOG.filter((star) => star.decDeg < -45).length).toBeGreaterThan(40);
  });

  it("gives most constellations a figure to click on", () => {
    const constellationOf = new Map(service.STAR_CATALOG.map((star) => [star.id, star.constellation]));
    const withFigures = new Set();

    service.CONSTELLATION_SEGMENTS.forEach(([fromId, toId]) => {
      // A segment spanning two constellations is an asterism (the Summer
      // Triangle, say) and belongs to neither — matching how the page labels
      // and hit-tests them.
      if (constellationOf.get(fromId) === constellationOf.get(toId)) {
        withFigures.add(constellationOf.get(fromId));
      }
    });

    expect(withFigures.size).toBeGreaterThan(60);
    ["Orion", "Scorpius", "Ursa Major", "Cassiopeia", "Crux", "Hydra", "Eridanus", "Cancer", "Lepus", "Corona Borealis"].forEach((name) => {
      expect(withFigures.has(name), `${name} has no clickable figure`).toBe(true);
    });
  });
});
