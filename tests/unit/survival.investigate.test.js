/**
 * Rolnopol Survival — looking at what is on your hex.
 *
 * Springs, forage patches, cabins and expedition markers used to be invisible
 * to the player: two of them only nudged a search chance, and the other two
 * fired by themselves on arrival. They are one deliberate action now, and most
 * of them can go two ways.
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

// Start at offset (2,2). W = spring, F = forage, C = cabin, . = open ground.
const SPRING = scenarioFrom("inv-spring", [".....", ".....", "..W..", ".....", "....."], { col: 2, row: 2 });
const FORAGE = scenarioFrom("inv-forage", [".....", ".....", "..F..", ".....", "....."], { col: 2, row: 2 });
const CABIN = scenarioFrom("inv-cabin", [".....", ".....", "..C..", ".....", "....."], { col: 2, row: 2 });
const EMPTY = scenarioFrom("inv-empty", [".....", ".....", ".....", ".....", "....."], { col: 2, row: 2 });

function newGame(scenarioId, seed) {
  return game.createGame({ seed: seed || 1, scenarioId, difficulty: "normal", events: false, weather: "clear" });
}

/**
 * Play the same tile across many seeds and collect which way it went. The
 * outcomes are seeded, so this is a census rather than a gamble.
 */
function outcomesAcrossSeeds(scenarioId, seeds) {
  const seen = {};
  for (let seed = 1; seed <= seeds; seed += 1) {
    const state = newGame(scenarioId, seed);
    const answer = game.investigate(state);
    seen[answer.outcome] = (seen[answer.outcome] || 0) + 1;
  }
  return seen;
}

function logKeys(state) {
  return state.log.map((entry) => entry.key);
}

describe("survival investigate — when the button is there at all", () => {
  it("offers nothing on plain ground", () => {
    const state = newGame(EMPTY);
    expect(game.investigateTarget(state)).toBeNull();
  });

  it("names what is under the player", () => {
    expect(game.investigateTarget(newGame(SPRING))).toBe("spring");
    expect(game.investigateTarget(newGame(FORAGE))).toBe("forage");
    expect(game.investigateTarget(newGame(CABIN))).toBe("cabin");
  });

  it("puts a waiting person above the scenery", () => {
    const state = newGame(CABIN);
    game.currentTile(state).marker = "npc";
    game.currentTile(state).markerInspected = false;

    expect(game.investigateTarget(state)).toBe("marker");
  });

  it("stops offering once the place has given up what it had", () => {
    const state = newGame(SPRING);
    game.investigate(state);
    expect(game.investigateTarget(state)).toBeNull();
  });

  it("costs a point of the day, less than searching blind", () => {
    const state = newGame(SPRING);
    game.investigate(state);

    expect(state.movementLeft).toBe(config.MOVEMENT.base - config.INVESTIGATE.cost);
    expect(config.INVESTIGATE.cost).toBeLessThan(config.SEARCH.cost);
  });

  it("refuses politely when there is nothing to look at", () => {
    const state = newGame(EMPTY);
    const answer = game.investigate(state);

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("nothing-here");
    expect(state.movementLeft).toBe(config.MOVEMENT.base);
    expect(logKeys(state)).toContain("log.investigate.nothing");
  });

  it("refuses when the day has run out", () => {
    const state = newGame(SPRING);
    state.movementLeft = 0;

    expect(game.investigate(state).reason).toBe("no-points");
    expect(game.investigateTarget(state)).toBe("spring");
  });
});

describe("survival investigate — a spring", () => {
  it("fills the canteen outright", () => {
    const state = newGame(SPRING);
    state.player.water = 1;

    game.investigate(state);

    expect(state.player.water).toBe(config.RESOURCES.water.max);
  });

  it("is sometimes the wrong water", () => {
    const outcomes = outcomesAcrossSeeds(SPRING, 60);

    expect(outcomes.spring).toBeGreaterThan(0);
    expect(outcomes["spring-tainted"]).toBeGreaterThan(0);
    expect(outcomes["spring-tainted"]).toBeLessThan(outcomes.spring);
  });

  it("costs health when it is", () => {
    let tainted = null;
    for (let seed = 1; seed <= 60 && !tainted; seed += 1) {
      const state = newGame(SPRING, seed);
      if (game.investigate(state).outcome === "spring-tainted") tainted = state;
    }

    expect(tainted).toBeTruthy();
    expect(tainted.player.health).toBe(config.START.health - config.INVESTIGATE.spring.taintedDamage);
    expect(logKeys(tainted)).toContain("log.investigate.springTainted");
  });
});

describe("survival investigate — a forage patch", () => {
  it("brings back at least the difficulty's refill", () => {
    const state = newGame(FORAGE);
    state.player.food = 0;

    game.investigate(state);

    expect(state.player.food).toBeGreaterThanOrEqual(config.DIFFICULTIES.normal.refill);
  });

  it("sometimes brings back more", () => {
    const outcomes = outcomesAcrossSeeds(FORAGE, 60);

    expect(outcomes.forage).toBeGreaterThan(0);
    expect(outcomes["forage-good"]).toBeGreaterThan(0);
  });

  it("counts the bonus on top of the refill", () => {
    let good = null;
    for (let seed = 1; seed <= 60 && !good; seed += 1) {
      const state = newGame(FORAGE, seed);
      state.player.food = 0;
      if (game.investigate(state).outcome === "forage-good") good = state;
    }

    expect(good).toBeTruthy();
    expect(good.player.food).toBe(config.DIFFICULTIES.normal.refill + config.INVESTIGATE.forage.goodHaulBonus);
  });
});

describe("survival investigate — a cabin", () => {
  it("always means shelter: fatigue gone, canteen full", () => {
    const state = newGame(CABIN);
    state.player.fatigue = 9;
    state.player.water = 1;

    game.investigate(state);

    expect(state.player.fatigue).toBe(0);
    expect(state.player.water).toBe(config.RESOURCES.water.max);
    expect(logKeys(state)).toContain("log.investigate.cabin");
  });

  it("can hold stores, a chart, or nothing at all", () => {
    const outcomes = outcomesAcrossSeeds(CABIN, 80);

    expect(Object.keys(outcomes).sort()).toEqual(["cabin-bare", "cabin-chart", "cabin-supplies"]);
    expect(outcomes["cabin-supplies"]).toBeGreaterThan(outcomes["cabin-bare"] / 2);
  });

  it("hands over food when it holds stores", () => {
    let supplies = null;
    for (let seed = 1; seed <= 80 && !supplies; seed += 1) {
      const state = newGame(CABIN, seed);
      state.player.food = 0;
      if (game.investigate(state).outcome === "cabin-supplies") supplies = state;
    }

    expect(supplies).toBeTruthy();
    expect(supplies.player.food).toBe(config.INVESTIGATE.cabin.suppliesFood);
  });

  it("hands over bearings and a wider view when it holds a chart", () => {
    let chart = null;
    for (let seed = 1; seed <= 80 && !chart; seed += 1) {
      const state = newGame(CABIN, seed);
      if (game.investigate(state).outcome === "cabin-chart") chart = state;
    }

    expect(chart).toBeTruthy();
    expect(chart.player.orientation).toBe(config.START.orientation + config.INVESTIGATE.cabin.chartOrientation);

    const seen = chart.map.tiles.filter((tile) => tile.revealed).length;
    const withinChart = chart.map.tiles.filter(
      (tile) => hex.distance(tile, chart.player) <= config.INVESTIGATE.cabin.chartRevealRadius,
    ).length;
    expect(seen).toBeGreaterThanOrEqual(withinChart);
  });

  it("gives up its night only once", () => {
    const state = newGame(CABIN);
    game.investigate(state);

    state.player.fatigue = 7;
    const second = game.investigate(state);

    expect(second.ok).toBe(false);
    expect(state.player.fatigue).toBe(7);
  });
});

describe("survival investigate — nothing happens by itself any more", () => {
  it("leaves a cabin alone until the player looks at it", () => {
    const walkIn = scenarioFrom("inv-cabin-east", [".......", ".......", "...C...", ".......", "......."], {
      col: 2,
      row: 2,
    });
    const state = newGame(walkIn);
    state.player.fatigue = 8;

    const east = hex.offsetToAxial(3, 2);
    game.moveTo(state, east.q, east.r);

    // Walking in used to empty the fatigue on its own. Now it waits.
    expect(state.player.fatigue).toBe(8);
    expect(game.investigateTarget(state)).toBe("cabin");

    game.investigate(state);
    expect(state.player.fatigue).toBe(0);
  });

  it("leaves an expedition marker unread until the player checks it", () => {
    const state = game.createGame({ seed: 11, scenarioId: "search", difficulty: "normal", events: false });
    const target = state.map.tiles.find((tile) => tile.marker === "npc");

    state.player.q = target.q;
    state.player.r = target.r;

    expect(state.objective.foundTarget).toBe(false);
    expect(game.investigateTarget(state)).toBe("marker");

    const answer = game.investigate(state);

    expect(answer.outcome).toBe("npc");
    expect(state.objective.foundTarget).toBe(true);
    expect(state.gameOver).toBe(true);
  });
});
