/**
 * Rolnopol Survival — procedural map generation (PRD WP-01, WP-02, WP-36, WP-37).
 */
import { describe, it, expect } from "vitest";

const generator = require("../../public/js/games/survival/map-generator.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const config = require("../../public/js/games/survival/config.js");
const hex = require("../../public/js/games/survival/hex.js");

function isSpecial(tile) {
  return tile.hasCabin || tile.hasWaterSource || tile.hasFoodSource;
}

function terrainTally(map) {
  const tally = { open: 0, forest: 0, mountain: 0, river: 0, swamp: 0, special: 0 };
  for (const tile of map.tiles) {
    if (isSpecial(tile)) tally.special += 1;
    else tally[tile.type] += 1;
  }
  return tally;
}

describe("survival map generator — WP-01 reproducibility", () => {
  it("gives the same map for the same seed", () => {
    const first = generator.generateMap({ seed: 4242 });
    const second = generator.generateMap({ seed: 4242 });

    expect(second.tiles.map((tile) => tile.type)).toEqual(first.tiles.map((tile) => tile.type));
    expect(second.start).toEqual(first.start);
  });

  it("gives a different map for a different seed", () => {
    const a = generator
      .generateMap({ seed: 1 })
      .tiles.map((tile) => tile.type)
      .join("");
    const b = generator
      .generateMap({ seed: 2 })
      .tiles.map((tile) => tile.type)
      .join("");
    expect(a).not.toBe(b);
  });

  it("builds a map the size the config asks for", () => {
    const map = generator.generateMap({ seed: 7 });
    expect(map.width).toBe(config.MAP.width);
    expect(map.height).toBe(config.MAP.height);
    expect(map.tiles).toHaveLength(config.MAP.width * config.MAP.height);
    expect(map.tiles.every((tile) => config.TERRAIN[tile.type])).toBe(true);
  });

  it("keeps the walk out of the wild long enough to be a walk", () => {
    // The whole reason the map grew past 12x12: a border within one day's
    // marching turns the survival game into a stroll (see the release-2 note).
    for (let seed = 1; seed <= 50; seed += 1) {
      const map = generator.generateMap({ seed });
      const start = generator.tileAt(map, map.start.q, map.start.r);
      const toEdge = Math.min(start.col, map.width - 1 - start.col, start.row, map.height - 1 - start.row);

      expect(toEdge, `seed ${seed} starts ${toEdge} hexes from a border`).toBeGreaterThan(config.MOVEMENT.base);
    }
  });
});

describe("survival map generator — the size the player picked", () => {
  it("offers a spread of sizes, each with a name on screen", () => {
    const strings = require("../../public/js/games/survival/strings.js");
    const names = Object.keys(config.MAP_SIZES);

    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names).toContain(config.DEFAULT_MAP_SIZE);

    for (const name of names) {
      expect(strings.has("mapSize." + name), name + " has no label").toBe(true);
      expect(config.MAP_SIZES[name].width).toBeGreaterThan(0);
    }
  });

  it("builds the map the scenario was asked for", () => {
    const game = require("../../public/js/games/survival/game.js");

    for (const name of Object.keys(config.MAP_SIZES)) {
      const preset = config.MAP_SIZES[name];
      const state = game.createGame({ seed: 5, scenarioId: "lost", mapSize: name, events: false });

      expect(state.map.width, name).toBe(preset.width);
      expect(state.map.height, name).toBe(preset.height);
      expect(state.mapSize, name).toBe(name);
    }
  });

  it("keeps the border further away the bigger the map", () => {
    const game = require("../../public/js/games/survival/game.js");

    const distances = ["small", "standard", "large", "vast"].map((name) => {
      const state = game.createGame({ seed: 5, scenarioId: "lost", mapSize: name, events: false });
      const tile = game.currentTile(state);
      return Math.min(tile.col, state.map.width - 1 - tile.col, tile.row, state.map.height - 1 - tile.row);
    });

    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeLessThan(distances[distances.length - 1]);
  });

  it("falls back to the standard map for a size nobody defined", () => {
    const game = require("../../public/js/games/survival/game.js");
    const state = game.createGame({ seed: 5, scenarioId: "lost", mapSize: "continental", events: false });

    expect(state.mapSize).toBe(config.DEFAULT_MAP_SIZE);
    expect(state.map.width).toBe(config.MAP_SIZES[config.DEFAULT_MAP_SIZE].width);
  });

  it("holds the terrain mix at every size", () => {
    for (const name of Object.keys(config.MAP_SIZES)) {
      const preset = config.MAP_SIZES[name];
      const total = preset.width * preset.height;
      const map = generator.generateMap({ seed: 12, width: preset.width, height: preset.height });
      const tally = terrainTally(map);
      const tolerance = Math.max(3, Math.round(total * 0.02));

      expect(Math.abs(tally.forest - config.TERRAIN_MIX.forest * total), name).toBeLessThanOrEqual(tolerance);
      // The resupply share grows with the map (PRD 8.10), so the expectation
      // has to ask the config what this width is supposed to carry.
      expect(Math.abs(tally.special - config.specialShareFor(preset.width) * total), name).toBeLessThanOrEqual(tolerance);
    }
  });

  it("builds even the largest map in a reasonable time", () => {
    const preset = config.MAP_SIZES[Object.keys(config.MAP_SIZES).pop()];
    const started = Date.now();

    generator.generateMap({ seed: 1, width: preset.width, height: preset.height });

    // A generous ceiling: this guards against an accidental quadratic, not
    // against a slow machine.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("makes resupply denser as the map grows (PRD 8.10)", () => {
    const shares = ["small", "standard", "large", "immense", "endless"].map((name) => config.specialShareFor(config.MAP_SIZES[name].width));

    expect(shares).toEqual([...shares].sort((a, b) => a - b));
    expect(shares[shares.length - 1]).toBeGreaterThan(shares[0]);
  });

  it("gives forage the largest share of the special tiles", () => {
    const map = generator.generateMap({ seed: 3, width: 32, height: 32 });
    const forage = map.tiles.filter((tile) => tile.hasFoodSource).length;
    const springs = map.tiles.filter((tile) => tile.hasWaterSource && !tile.hasCabin).length;
    const cabins = map.tiles.filter((tile) => tile.hasCabin).length;

    expect(forage).toBeGreaterThan(cabins);
    expect(springs).toBeGreaterThan(cabins);
    expect(forage + springs + cabins).toBeGreaterThan(0);
  });

  it("cuts a road across the big maps, and leaves the small ones alone", () => {
    const big = generator.generateMap({ seed: 1, width: 64, height: 64 });
    const small = generator.generateMap({ seed: 1, width: 16, height: 16 });

    const trailShare = (map) => map.tiles.filter((tile) => tile.hasTrail).length / map.tiles.length;

    expect(config.MAP.roadsFromWidth).toBeGreaterThan(16);
    expect(trailShare(big)).toBeGreaterThan(trailShare(small));
  });

  it("runs that road from the middle of the map to a border", () => {
    // The point of the road: on the largest map the border is sixty hexes off,
    // and a road is the difference between a long walk and an impossible one.
    for (let seed = 1; seed <= 5; seed += 1) {
      const map = generator.generateMap({ seed, width: 64, height: 64 });
      const start = generator.tileAt(map, map.start.q, map.start.r);

      const seen = new Set();
      const queue = [];
      const push = (tile) => {
        if (!tile || !(tile.hasTrail || tile.hasFord)) return;
        const key = hex.key(tile.q, tile.r);
        if (seen.has(key)) return;
        seen.add(key);
        queue.push(tile);
      };

      push(start);
      for (const spot of hex.neighbors(start.q, start.r)) push(generator.tileAt(map, spot.q, spot.r));

      let reachedBorder = false;
      for (let head = 0; head < queue.length && !reachedBorder; head += 1) {
        const tile = queue[head];
        if (hex.edgeSides(tile, map.width, map.height).length > 0) reachedBorder = true;
        for (const spot of hex.neighbors(tile.q, tile.r)) push(generator.tileAt(map, spot.q, spot.r));
      }

      expect(reachedBorder, "seed " + seed + " has no road out").toBe(true);
    }
  });

  it("indexes each tile's neighbours once instead of looking them up by string", () => {
    const map = generator.generateMap({ seed: 2, width: 16, height: 16 });

    expect(map.neighborIndex).toHaveLength(map.tiles.length);
    // A tile in the middle has all six; the index holds positions, not objects.
    const middle = map.tiles.findIndex((tile) => tile.col === 8 && tile.row === 8);
    expect(map.neighborIndex[middle]).toHaveLength(6);
    expect(map.neighborIndex[middle].every((index) => typeof index === "number")).toBe(true);
  });

  it("still puts a playable start on the smallest map", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const preset = config.MAP_SIZES.small;
      const map = generator.generateMap({ seed, width: preset.width, height: preset.height });
      const start = generator.tileAt(map, map.start.q, map.start.r);

      expect(start, "seed " + seed).toBeTruthy();
      expect(["swamp", "mountain"], "seed " + seed).not.toContain(start.type);
    }
  });
});

describe("survival map generator — WP-02 terrain mix", () => {
  it("holds the declared proportions across 50 consecutive seeds", () => {
    const total = config.MAP.width * config.MAP.height;
    const expected = {
      open: config.TERRAIN_MIX.open * total,
      forest: config.TERRAIN_MIX.forest * total,
      mountain: config.TERRAIN_MIX.mountain * total,
      river: config.TERRAIN_MIX.river * total,
      swamp: config.TERRAIN_MIX.swamp * total,
      special: config.SPECIAL_SHARE * total,
    };

    for (let seed = 1000; seed < 1050; seed += 1) {
      const tally = terrainTally(generator.generateMap({ seed }));

      for (const type of Object.keys(expected)) {
        // Tolerance scales with the map: three hexes on a 12x12, still a
        // fraction of a percent on a 24x24.
        const tolerance = Math.max(3, Math.round(total * 0.02));
        expect(Math.abs(tally[type] - expected[type]), `seed ${seed}, ${type}: ${tally[type]}`).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it("clusters terrain instead of scattering it", () => {
    const map = generator.generateMap({ seed: 99 });
    let touching = 0;
    let pairs = 0;

    for (const tile of map.tiles) {
      for (const spot of hex.neighbors(tile.q, tile.r)) {
        const other = generator.tileAt(map, spot.q, spot.r);
        if (!other) continue;
        pairs += 1;
        if (other.type === tile.type) touching += 1;
      }
    }

    // Pure noise at this mix sits near 0.28; clustering has to beat that clearly.
    expect(touching / pairs).toBeGreaterThan(0.45);
  });
});

describe("survival map generator — WP-36 playability", () => {
  it("passes the PRD 6.11 checks on 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const map = generator.generateMap({ seed });
      const start = generator.tileAt(map, map.start.q, map.start.r);

      expect(start, `seed ${seed} has no start tile`).toBeTruthy();
      expect(["swamp", "mountain"], `seed ${seed} starts on bad ground`).not.toContain(start.type);

      const sides = new Set();
      for (const tile of generator.reachableFrom(map, start)) {
        for (const side of hex.edgeSides(tile, map.width, map.height)) sides.add(side);
      }
      expect(sides.size, `seed ${seed} reaches only ${sides.size} edge sides`).toBeGreaterThanOrEqual(2);

      // Water may be dropped after ten refusals, and the map says so when it was.
      if (!map.relaxed.includes("water")) {
        expect(generator.hasWaterNear(map, start), `seed ${seed} has no water near the start`).toBe(true);
      }
    }
  });

  it("rarely needs more than a couple of attempts", () => {
    let attempts = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      attempts += generator.generateMap({ seed }).attempts;
    }
    expect(attempts / 100).toBeLessThan(3);
  });

  it("reports which rule it had to drop", () => {
    const map = generator.generateMap({ seed: 12345 });
    expect(Array.isArray(map.relaxed)).toBe(true);
  });
});

describe("survival map generator — WP-37 map source", () => {
  it("builds a generated map when the scenario asks for one", () => {
    const scenario = scenarios.getScenario("lost");
    const map = scenarios.buildMap(scenario, 555);
    expect(map.width).toBe(config.MAP.width);
    expect(map.handmadeId).toBeUndefined();
  });

  it("builds a hand-drawn map from the same call, with no change to game code", () => {
    const scenario = {
      ...scenarios.getScenario("lost"),
      map: { source: "handmade", id: "proving-ground" },
    };

    const map = scenarios.buildMap(scenario, 555);
    expect(map.handmadeId).toBe("proving-ground");
    expect(map.width).toBe(6);
    expect(map.tiles).toHaveLength(36);
  });

  it("refuses an unknown source rather than guessing", () => {
    const scenario = { ...scenarios.getScenario("lost"), map: { source: "nonsense" } };
    expect(() => scenarios.buildMap(scenario, 1)).toThrow(/Unknown map source/);
  });

  it("parses overlays in hand-drawn maps", () => {
    const map = handmade.getHandmadeMap("proving-ground");
    expect(map.tiles.some((tile) => tile.hasTrail)).toBe(true);
    expect(map.tiles.some((tile) => tile.hasWaterSource)).toBe(true);
    expect(map.tiles.some((tile) => tile.hasCabin)).toBe(true);
    expect(map.tiles.some((tile) => tile.hasFoodSource)).toBe(true);
  });
});
