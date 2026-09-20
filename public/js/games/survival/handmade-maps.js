/**
 * Rolnopol Survival — maps drawn by hand (PRD 6.11, WP-37).
 *
 * Scenarios that depend on where things are, rather than on what the terrain
 * feels like, cannot use the generator: markers scattered over random ground
 * produce a rescue target behind a wall of swamp. Those scenarios name a map
 * from this registry instead.
 *
 * Release 1 ships no scenario that needs one. `proving-ground` exists so the
 * seam is exercised and testable rather than theoretical.
 *
 * Legend: . open  f forest  m mountain  r river  s swamp  d desert
 * Uppercase marks an overlay on the same terrain:
 *   T trail  W water source  F food source  C cabin
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./hex.js"), require("./map-generator.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.handmadeMaps = factory(root.Survival.hex, root.Survival.mapGenerator);
  }
})(typeof self !== "undefined" ? self : globalThis, function (hex, mapGenerator) {
  "use strict";

  const TERRAIN_BY_SYMBOL = {
    ".": "open",
    f: "forest",
    m: "mountain",
    r: "river",
    s: "swamp",
    d: "desert",
    T: "open",
    W: "open",
    F: "forest",
    C: "open",
  };

  const OVERLAY_BY_SYMBOL = {
    T: "hasTrail",
    W: "hasWaterSource",
    F: "hasFoodSource",
    C: "hasCabin",
  };

  /** Turn rows of symbols into the same tile shape the generator produces. */
  function parseHandmadeMap(definition) {
    const rows = definition.rows;
    const height = rows.length;
    const width = rows[0].length;
    const map = { width, height, tiles: [], byKey: {}, handmadeId: definition.id };

    for (let row = 0; row < height; row += 1) {
      if (rows[row].length !== width) {
        throw new Error("Handmade map " + definition.id + " has a ragged row at index " + row);
      }

      for (let col = 0; col < width; col += 1) {
        const symbol = rows[row][col];
        const type = TERRAIN_BY_SYMBOL[symbol];
        if (!type) {
          throw new Error("Handmade map " + definition.id + " uses an unknown symbol: " + symbol);
        }

        const axial = hex.offsetToAxial(col, row);
        const tile = {
          q: axial.q,
          r: axial.r,
          col,
          row,
          type,
          hasTrail: false,
          hasFord: false,
          hasCabin: false,
          hasWaterSource: false,
          hasFoodSource: false,
          marker: null,
          markerInspected: false,
          revealed: false,
          visited: false,
          searchedWater: false,
          searchedFood: false,
        };

        const overlay = OVERLAY_BY_SYMBOL[symbol];
        if (overlay) tile[overlay] = true;

        map.tiles.push(tile);
      }
    }

    mapGenerator.buildIndex(map);

    const start = hex.offsetToAxial(definition.start.col, definition.start.row);
    map.start = { q: start.q, r: start.r };
    map.attempts = 1;
    map.relaxed = [];
    return map;
  }

  const DEFINITIONS = {
    "proving-ground": {
      id: "proving-ground",
      start: { col: 2, row: 2 },
      rows: ["..f.m.", ".fTWf.", "srT..m", ".ssF.f", "f..C..", "..m..r"],
    },
  };

  function getHandmadeMap(id) {
    const definition = DEFINITIONS[id];
    if (!definition) throw new Error("Unknown handmade map: " + id);
    return parseHandmadeMap(definition);
  }

  function listHandmadeMaps() {
    return Object.keys(DEFINITIONS);
  }

  return { parseHandmadeMap, getHandmadeMap, listHandmadeMaps, DEFINITIONS };
});
