/**
 * Rolnopol Survival — resting, searching and terrain (PRD WP-18 to WP-21, WP-25).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");
const hex = require("../../public/js/games/survival/hex.js");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

// Start at offset (2,2) -> axial (1,2); its east neighbour is offset (3,2).
const PLAIN = scenarioFrom("act-plain", [".....", ".....", ".....", ".....", "....."], { col: 2, row: 2 });
const RIVER_START = scenarioFrom("act-river", [".....", ".....", "..r..", ".....", "....."], { col: 2, row: 2 });
const FOREST_START = scenarioFrom("act-forest", [".....", ".....", "..f..", ".....", "....."], { col: 2, row: 2 });
const DESERT_EAST = scenarioFrom("act-desert", [".......", ".......", "...d...", ".......", "......."], { col: 2, row: 2 });
const MOUNTAIN_EAST = scenarioFrom("act-mountain", [".......", ".......", "...m...", ".......", "......."], { col: 2, row: 2 });
const SWAMP_EAST = scenarioFrom("act-swamp", [".......", ".......", "...s...", ".......", "......."], { col: 2, row: 2 });
const CABIN_EAST = scenarioFrom("act-cabin", [".......", ".......", "...C...", ".......", "......."], { col: 2, row: 2 });

function newGame(scenarioId, options) {
  return game.createGame({ seed: 1, scenarioId, difficulty: "normal", events: false, weather: "clear", ...(options || {}) });
}

function offset(col, row) {
  const axial = hex.offsetToAxial(col, row);
  return [axial.q, axial.r];
}

function logKeys(state) {
  return state.log.map((entry) => entry.key);
}

describe("survival actions — WP-18 rest", () => {
  it("takes three off the fatigue and closes the day", () => {
    const state = newGame(PLAIN);
    state.player.fatigue = 6;
    state.player.health = 8;

    game.rest(state);

    expect(state.player.fatigue).toBe(3);
    expect(state.player.health).toBe(9);
    expect(state.day).toBe(2);
    expect(state.spentToday).toBe(0);
    expect(logKeys(state)).toContain("log.restFed");
  });

  it("gives no health back on an empty stomach", () => {
    const state = newGame(PLAIN);
    state.player.fatigue = 5;
    state.player.health = 6;
    state.player.food = 0;

    game.rest(state);

    // -1 health from the hunger at the end of the day, none back from resting.
    expect(state.player.health).toBe(5);
    expect(state.player.fatigue).toBe(2);
    expect(logKeys(state)).toContain("log.restHungry");
  });

  it("competes with distance instead of topping it up", () => {
    const state = newGame(PLAIN);
    game.moveTo(state, ...offset(3, 2));
    expect(state.movementLeft).toBe(5);

    game.rest(state);
    expect(state.day).toBe(2);
  });
});

describe("survival actions — WP-19 searching for water", () => {
  it("always finds water on a river, and pays two movement for it", () => {
    const state = newGame(RIVER_START);
    state.player.water = 2;

    const answer = game.searchWater(state);

    expect(answer.found).toBe(true);
    expect(state.player.water).toBe(2 + config.DIFFICULTIES.normal.refill);
    expect(state.movementLeft).toBe(6 - config.SEARCH.cost);
    expect(logKeys(state)).toContain("log.searchFound.water");
  });

  it("stops at a full canteen instead of overflowing", () => {
    const state = newGame(RIVER_START);
    state.player.water = config.RESOURCES.water.max - 1;

    game.searchWater(state);

    expect(state.player.water).toBe(config.RESOURCES.water.max);
  });

  it("refuses a second attempt on the same tile", () => {
    const state = newGame(RIVER_START);
    game.searchWater(state);
    const movementLeft = state.movementLeft;

    const answer = game.searchWater(state);

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("already-searched");
    expect(state.movementLeft).toBe(movementLeft);
    expect(logKeys(state)).toContain("log.searchExhausted.water");
  });

  it("lets a new tile be searched again", () => {
    const state = newGame(RIVER_START);
    game.searchWater(state);
    game.moveTo(state, ...offset(3, 2));

    expect(game.currentTile(state).searchedWater).toBe(false);
  });

  it("follows the chance table, springs included", () => {
    expect(game.searchChance("water", { type: "river" })).toBe(1);
    expect(game.searchChance("water", { type: "open", hasWaterSource: true })).toBe(1);
    expect(game.searchChance("water", { type: "desert" })).toBe(0.05);
    expect(game.searchChance("food", { type: "forest" })).toBe(0.5);
    expect(game.searchChance("food", { type: "open", hasFoodSource: true })).toBe(1);
  });

  it("refuses when the day is too far gone to search", () => {
    const state = newGame(RIVER_START);
    state.movementLeft = 1;

    const answer = game.searchWater(state);

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("no-points");
    expect(logKeys(state)).toContain("log.noTimeForAction");
  });
});

describe("survival actions — WP-20 foraging", () => {
  it("costs two movement and writes the outcome down either way", () => {
    const found = newGame(FOREST_START, { seed: 4 });
    game.searchFood(found);

    expect(found.movementLeft).toBe(6 - config.SEARCH.cost);
    expect(logKeys(found).some((key) => key.startsWith("log.searchFound.food") || key.startsWith("log.searchFailed.food"))).toBe(true);
  });

  it("finds food every time on a marked forage spot", () => {
    const forage = scenarioFrom("act-forage", [".....", ".....", "..F..", ".....", "....."], { col: 2, row: 2 });
    const state = newGame(forage);
    const food = state.player.food;

    expect(game.searchFood(state).found).toBe(true);
    expect(state.player.food).toBe(food + config.DIFFICULTIES.normal.refill);
  });
});

describe("survival actions — WP-21 what the ground does on arrival", () => {
  it("charges the dry flats a canteen on top of the movement", () => {
    const state = newGame(DESERT_EAST);
    const water = state.player.water;

    game.moveTo(state, ...offset(3, 2));

    expect(state.player.water).toBe(water - 1);
    expect(logKeys(state)).toContain("terrainEffect.desert");
  });

  it("trades a climb for a view", () => {
    const state = newGame(MOUNTAIN_EAST);
    game.moveTo(state, ...offset(3, 2));

    expect(state.player.fatigue).toBe(config.TERRAIN_EFFECTS.mountain.fatigue);
    expect(state.player.orientation).toBe(config.START.orientation + config.TERRAIN_EFFECTS.mountain.orientation);
  });

  it("makes the swamp cost twice: movement and body", () => {
    const state = newGame(SWAMP_EAST);
    game.moveTo(state, ...offset(3, 2));

    expect(state.movementLeft).toBe(6 - 4);
    expect(state.player.fatigue).toBe(2);
    expect(state.player.orientation).toBe(config.START.orientation - 1);
  });

  it("leaves a cabin to the player rather than opening it for them", () => {
    const state = newGame(CABIN_EAST);
    state.player.fatigue = 8;
    state.player.water = 2;

    game.moveTo(state, ...offset(3, 2));

    // Arriving does nothing on its own; the cabin is a place you go into.
    // What it holds lives in survival.investigate.test.js.
    expect(state.player.fatigue).toBe(8);
    expect(state.player.water).toBe(2);
    expect(game.investigateTarget(state)).toBe("cabin");
  });
});

describe("survival actions — WP-25 difficulty", () => {
  it("changes the resources the expedition starts with", () => {
    for (const name of Object.keys(config.DIFFICULTIES)) {
      const state = game.createGame({ seed: 1, scenarioId: PLAIN, difficulty: name, events: false, weather: "clear" });
      expect(state.player.water).toBe(config.DIFFICULTIES[name].water);
      expect(state.player.food).toBe(config.DIFFICULTIES[name].food);
    }
  });

  it("changes how much a successful search brings back", () => {
    for (const name of Object.keys(config.DIFFICULTIES)) {
      const state = game.createGame({ seed: 1, scenarioId: RIVER_START, difficulty: name, events: false, weather: "clear" });
      // Drained first, so the refill is measured rather than the cap (WP-24).
      state.player.water = 0;
      game.searchWater(state);
      expect(state.player.water).toBe(config.DIFFICULTIES[name].refill);
    }
  });

  it("falls back to normal for a difficulty nobody defined", () => {
    const state = game.createGame({ seed: 1, scenarioId: PLAIN, difficulty: "brutal", events: false, weather: "clear" });
    expect(state.difficulty).toBe(config.DEFAULT_DIFFICULTY);
  });
});
