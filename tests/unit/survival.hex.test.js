/**
 * Rolnopol Survival — hex geometry (PRD WP-03).
 */
import { describe, it, expect } from "vitest";

const hex = require("../../public/js/games/survival/hex.js");

describe("survival hex — coordinates", () => {
  it("round-trips offset and axial coordinates", () => {
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        const axial = hex.offsetToAxial(col, row);
        const back = hex.axialToOffset(axial.q, axial.r);
        expect(back).toEqual({ col, row });
      }
    }
  });

  it("gives every inner tile of a 12x12 map exactly six neighbours", () => {
    const present = new Set();
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        const axial = hex.offsetToAxial(col, row);
        present.add(hex.key(axial.q, axial.r));
      }
    }

    // Inner tiles only: the rectangle's own border is checked by edgeSides below.
    for (let row = 1; row < 11; row += 1) {
      for (let col = 1; col < 11; col += 1) {
        const axial = hex.offsetToAxial(col, row);
        const inside = hex.neighbors(axial.q, axial.r).filter((spot) => present.has(hex.key(spot.q, spot.r)));
        expect(inside).toHaveLength(6);
      }
    }
  });

  it("treats only adjacent tiles as neighbours", () => {
    const centre = { q: 0, r: 0 };
    expect(hex.areNeighbors(centre, { q: 1, r: 0 })).toBe(true);
    expect(hex.areNeighbors(centre, { q: 2, r: 0 })).toBe(false);
    expect(hex.areNeighbors(centre, { q: 0, r: 0 })).toBe(false);
  });

  it("measures distance in hexes, not in rows", () => {
    expect(hex.distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hex.distance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2);
    expect(hex.distance({ q: 0, r: 0 }, { q: -1, r: 2 })).toBe(2);
  });
});

describe("survival hex — map edges", () => {
  const width = 12;
  const height = 12;

  it("names the sides a border tile sits on", () => {
    expect(hex.edgeSides({ col: 0, row: 5 }, width, height)).toEqual(["west"]);
    expect(hex.edgeSides({ col: 11, row: 5 }, width, height)).toEqual(["east"]);
    expect(hex.edgeSides({ col: 5, row: 0 }, width, height)).toEqual(["north"]);
  });

  it("counts a corner as two sides", () => {
    expect(hex.edgeSides({ col: 0, row: 0 }, width, height).sort()).toEqual(["north", "west"]);
  });

  it("reports inner tiles as not on an edge", () => {
    expect(hex.isEdge({ col: 6, row: 6 }, width, height)).toBe(false);
    expect(hex.isEdge({ col: 0, row: 6 }, width, height)).toBe(true);
  });
});
