/**
 * Rolnopol Survival — wounds, illnesses, weather and camp (WP-60 to WP-63).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const strings = require("../../public/js/games/survival/strings.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

const PLAIN = scenarioFrom("cond-plain", [".....", ".....", ".....", ".....", "....."], { col: 2, row: 2 });
const FOREST = scenarioFrom("cond-forest", [".....", ".....", "..f..", ".....", "....."], { col: 2, row: 2 });
const CABIN = scenarioFrom("cond-cabin", [".....", ".....", "..C..", ".....", "....."], { col: 2, row: 2 });

function newGame(scenarioId, options) {
  return game.createGame({
    seed: 1,
    scenarioId: scenarioId || PLAIN,
    difficulty: "normal",
    events: false,
    weather: "clear",
    ...(options || {}),
  });
}

function logKeys(state) {
  return state.log.map((entry) => entry.key);
}

describe("survival conditions — WP-60 wounds with a clock on them", () => {
  it("names every condition the config declares", () => {
    for (const id of Object.keys(config.CONDITIONS)) {
      expect(strings.has("condition." + id + ".name"), id + " has no name").toBe(true);
      expect(strings.has("condition." + id + ".starts"), id + " has no opening line").toBe(true);
      expect(strings.has("condition." + id + ".tick"), id + " has no nightly line").toBe(true);
      expect(strings.has("condition." + id + ".ends"), id + " has no closing line").toBe(true);
    }
  });

  it("takes a bite and says so", () => {
    const state = newGame();

    game.addCondition(state, "bitten");

    expect(game.hasCondition(state, "bitten")).toBe(true);
    expect(state.player.conditions[0].days).toBe(config.CONDITIONS.bitten.days);
    expect(logKeys(state)).toContain("condition.bitten.starts");
  });

  it("bites again every night, and then runs out", () => {
    const state = newGame();
    game.addCondition(state, "bitten");
    const health = state.player.health;

    game.endDay(state);
    expect(state.player.health).toBe(health - 1 - 0);
    expect(state.player.conditions[0].days).toBe(config.CONDITIONS.bitten.days - 1);

    game.endDay(state);
    game.endDay(state);

    expect(game.hasCondition(state, "bitten")).toBe(false);
    expect(logKeys(state)).toContain("condition.bitten.ends");
  });

  it("restarts the clock rather than stacking the same illness twice", () => {
    const state = newGame();
    game.addCondition(state, "fever");
    state.player.conditions[0].days = 1;

    game.addCondition(state, "fever");

    expect(state.player.conditions).toHaveLength(1);
    expect(state.player.conditions[0].days).toBe(config.CONDITIONS.fever.days);
  });

  it("takes water as well as health when the illness calls for it", () => {
    const state = newGame();
    game.addCondition(state, "dysentery");
    const water = state.player.water;

    game.endDay(state);

    // One ration for the day, one more to the illness.
    expect(state.player.water).toBe(water - config.END_OF_DAY.waterLoss - 1);
  });

  it("ignores a condition nobody declared", () => {
    const state = newGame();
    expect(game.addCondition(state, "scurvy")).toBeNull();
    expect(state.player.conditions).toHaveLength(0);
  });

  it("survives a round trip through JSON", () => {
    const state = newGame();
    game.addCondition(state, "sprain");

    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.player.conditions[0]).toEqual({ id: "sprain", days: config.CONDITIONS.sprain.days });
  });
});

describe("survival conditions — WP-61 what treats them", () => {
  it("clears everything at a cabin", () => {
    const state = newGame(CABIN);
    game.addCondition(state, "fever");
    game.addCondition(state, "sprain");

    game.investigate(state);

    expect(state.player.conditions).toHaveLength(0);
    expect(logKeys(state)).toContain("log.treated");
  });

  it("clears everything at a camp fire", () => {
    const state = newGame(FOREST);
    game.addCondition(state, "fever");

    game.makeCamp(state);

    expect(state.player.conditions).toHaveLength(0);
  });

  it("only shortens them when the player just lies down", () => {
    const state = newGame();
    game.addCondition(state, "fever");

    game.rest(state);

    // One day off for the rest, one more for the night that passed.
    expect(game.hasCondition(state, "fever")).toBe(true);
    expect(state.player.conditions[0].days).toBe(config.CONDITIONS.fever.days - 2);
  });
});

describe("survival weather — WP-62", () => {
  it("names every kind of weather the config declares", () => {
    for (const name of Object.keys(config.WEATHER)) {
      expect(strings.has("weather." + name + ".name"), name + " has no name").toBe(true);
      expect(strings.has("weather." + name), name + " has no line").toBe(true);
    }
  });

  it("drinks the canteen twice as fast in the heat", () => {
    const clear = newGame(PLAIN, { weather: "clear" });
    const heat = newGame(PLAIN, { weather: "heat" });
    const before = clear.player.water;

    game.endDay(clear);
    game.endDay(heat);

    expect(clear.player.water).toBe(before - config.END_OF_DAY.waterLoss);
    expect(heat.player.water).toBe(before - config.END_OF_DAY.waterLoss * 2);
  });

  it("blinds a player who knows exactly where they are, when the fog comes down", () => {
    const clear = newGame(PLAIN, { weather: "clear" });
    const fog = newGame(PLAIN, { weather: "fog" });
    clear.player.orientation = 10;
    fog.player.orientation = 10;

    expect(game.visionRadiusFor(clear)).toBe(3);
    expect(game.visionRadiusFor(fog)).toBe(2);
  });

  it("never blinds anyone completely", () => {
    const fog = newGame(PLAIN, { weather: "fog" });
    fog.player.orientation = 0;

    expect(game.visionRadiusFor(fog)).toBe(1);
  });

  it("fills the canteen when it rains, and hides the horizon", () => {
    const state = newGame(PLAIN, { weather: "clear" });
    state.player.water = 2;
    state.forcedWeather = "rain";

    game.rollWeather(state);

    expect(state.player.water).toBe(3);
    expect(state.player.orientation).toBe(config.START.orientation - 1);
  });

  it("draws a new sky every morning", () => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = game.createGame({ seed, scenarioId: PLAIN, difficulty: "normal", events: false });
      seen.add(state.weather);
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("survival camp — WP-63", () => {
  it("needs wood: a forest or a cabin, not open ground", () => {
    expect(game.canMakeCamp(newGame(FOREST))).toBe(true);
    expect(game.canMakeCamp(newGame(CABIN))).toBe(true);
    expect(game.canMakeCamp(newGame(PLAIN))).toBe(false);
  });

  it("refuses politely on ground that cannot hold a fire", () => {
    const state = newGame(PLAIN);
    const answer = game.makeCamp(state);

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("wrong-ground");
    expect(logKeys(state)).toContain("log.campImpossible");
    expect(state.day).toBe(1);
  });

  it("beats a plain rest and costs the same day", () => {
    const rested = newGame(FOREST);
    const camped = newGame(FOREST);
    rested.player.fatigue = 9;
    camped.player.fatigue = 9;

    game.rest(rested);
    game.makeCamp(camped);

    expect(camped.player.fatigue).toBeLessThan(rested.player.fatigue);
    expect(camped.day).toBe(2);
  });

  it("keeps the night quieter than an open camp would be", () => {
    const state = newGame(FOREST);
    game.makeCamp(state);

    // The fire burns for one night only.
    expect(state.campfireTonight).toBe(false);
  });
});
