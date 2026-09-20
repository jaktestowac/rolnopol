/**
 * Rolnopol Survival — the turn loop (PRD WP-04 to WP-16).
 *
 * Movement tests run on hand-drawn maps so the cost of every neighbour is known
 * up front; the generated map is used only where reproducibility is the point.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");
const hex = require("../../public/js/games/survival/hex.js");

/**
 * Register a hand-drawn map and a scenario that uses it. Win and loss come from
 * the shipped "lost" scenario, so these tests exercise the real conditions.
 */
function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

// Start sits at offset (2,2) -> axial (1,2). Its six neighbours in offset are
// (3,2) (1,2) (2,1) (1,1) (1,3) (2,3).
const OPEN_PLAIN = scenarioFrom(
  "test-open-plain",
  [".........", ".........", ".........", ".........", ".........", ".........", ".........", ".........", "........."],
  { col: 4, row: 4 },
);

const MOUNTAIN_EAST = scenarioFrom("test-mountain-east", [".......", ".......", "...ms..", ".......", "......."], { col: 2, row: 2 });

const SWAMP_RING = scenarioFrom("test-swamp-ring", [".....", ".ss..", ".s.s.", ".ss..", "....."], { col: 2, row: 2 });

/**
 * Release-1 rules are tested without the nightly event roll: a test of thirst
 * should fail because thirst broke, not because a storm rolled in. Events have
 * their own file.
 */
function newGame(scenarioId) {
  return game.createGame({ seed: 1, scenarioId, difficulty: "normal", events: false, weather: "clear" });
}

function offset(state, col, row) {
  const axial = hex.offsetToAxial(col, row);
  return [axial.q, axial.r];
}

function lastLogKey(state) {
  return state.log[state.log.length - 1].key;
}

describe("survival game — WP-04 moving to a neighbour", () => {
  it("moves onto an adjacent hex", () => {
    const state = newGame(OPEN_PLAIN);
    const answer = game.moveTo(state, ...offset(state, 5, 4));

    expect(answer.ok).toBe(true);
    expect(game.currentTile(state).col).toBe(5);
    expect(state.stats.hexesTravelled).toBe(1);
    expect(lastLogKey(state)).toBe("log.move");
  });

  it("refuses a hex two steps away and says so in the journal", () => {
    const state = newGame(OPEN_PLAIN);
    const answer = game.moveTo(state, ...offset(state, 6, 4));

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("not-neighbour");
    expect(game.currentTile(state).col).toBe(4);
    expect(lastLogKey(state)).toBe("log.moveNotNeighbour");
  });
});

describe("survival game — WP-05 the movement budget", () => {
  it("subtracts the terrain cost and keeps the rest for the day", () => {
    const state = newGame(MOUNTAIN_EAST);
    expect(state.movementLeft).toBe(6);

    game.moveTo(state, ...offset(state, 3, 2));
    expect(state.movementLeft).toBe(3);

    // Reading the state again must not refill the pool (the WP-05 bug in 6.2).
    expect(state.movementLeft).toBe(3);
    expect(state.spentToday).toBe(3);
  });

  it("refills only when the day turns over", () => {
    const state = newGame(MOUNTAIN_EAST);
    game.moveTo(state, ...offset(state, 3, 2));
    game.endDay(state);

    expect(state.day).toBe(2);
    expect(state.movementLeft).toBe(config.movementPointsFor(state.player));
    expect(state.spentToday).toBe(0);
  });
});

describe("survival game — WP-06 terrain costs", () => {
  it("refuses a swamp when only three points are left", () => {
    const state = newGame(MOUNTAIN_EAST);
    game.moveTo(state, ...offset(state, 3, 2));
    expect(state.movementLeft).toBe(3);

    const answer = game.moveTo(state, ...offset(state, 4, 2));
    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe("too-expensive");
    expect(lastLogKey(state)).toBe("log.moveTooExpensive");
  });

  it("charges one point for a trail or a ford regardless of what is underneath", () => {
    expect(config.movementCost({ type: "swamp" })).toBe(4);
    expect(config.movementCost({ type: "swamp", hasTrail: true })).toBe(1);
    expect(config.movementCost({ type: "river", hasFord: true })).toBe(1);
  });
});

describe("survival game — WP-07 the forced march", () => {
  it("offers the cheapest neighbour when nothing is affordable", () => {
    const state = newGame(SWAMP_RING);
    state.movementLeft = 2; // worn down by a long day

    const target = game.forcedMarchTarget(state);
    expect(target).toBeTruthy();
    expect(target.type).toBe("swamp");
  });

  it("charges health and fatigue for it", () => {
    const state = newGame(SWAMP_RING);
    state.movementLeft = 2;
    const before = { health: state.player.health, fatigue: state.player.fatigue };

    const answer = game.forcedMarch(state);

    expect(answer.ok).toBe(true);
    expect(state.player.health).toBe(before.health - config.FORCED_MARCH.healthCost);
    expect(state.stats.forcedMarches).toBe(1);
    expect(state.movementLeft).toBe(0);

    // The march is paid for on top of what the swamp itself does (PRD 7.4), so
    // forcing your way into bad ground costs twice.
    expect(state.player.fatigue).toBe(before.fatigue + config.FORCED_MARCH.fatigueCost + config.TERRAIN_EFFECTS.swamp.fatigue);
  });

  it("refuses when affordable ground is still there", () => {
    const state = newGame(SWAMP_RING);
    expect(state.movementLeft).toBe(6);

    const answer = game.forcedMarch(state);
    expect(answer.ok).toBe(false);
    expect(state.player.health).toBe(config.START.health);
    expect(lastLogKey(state)).toBe("log.forcedMarchRefused");
  });
});

describe("survival game — WP-08 and WP-09 the end of the day", () => {
  it("advances the day and eats a ration of each", () => {
    const state = newGame(OPEN_PLAIN);
    const water = state.player.water;
    const food = state.player.food;

    game.endDay(state);

    expect(state.day).toBe(2);
    expect(state.player.water).toBe(water - 1);
    expect(state.player.food).toBe(food - 1);
    expect(state.player.health).toBe(10);
  });

  it("takes two health when the canteen runs dry, and logs it", () => {
    const state = newGame(OPEN_PLAIN);
    state.player.water = 1;

    game.endDay(state);

    expect(state.player.water).toBe(0);
    expect(state.player.health).toBe(8);
    expect(state.log.some((entry) => entry.key === "log.noWater")).toBe(true);
  });

  it("stacks hunger, thirst and exhaustion", () => {
    const state = newGame(OPEN_PLAIN);
    state.player.water = 1;
    state.player.food = 1;
    state.player.fatigue = 10;

    game.endDay(state);

    // -2 thirst, -1 hunger, -1 exhaustion.
    expect(state.player.health).toBe(6);
  });
});

describe("survival game — WP-10 fatigue from marching", () => {
  it("adds one fatigue for every three points spent", () => {
    const state = newGame(OPEN_PLAIN);

    // Six points of open ground, back and forth so the edge stays out of reach.
    const there = offset(state, 5, 4);
    const back = offset(state, 4, 4);
    for (let i = 0; i < 3; i += 1) {
      game.moveTo(state, ...there);
      game.moveTo(state, ...back);
    }
    expect(state.spentToday).toBe(6);

    game.endDay(state);
    expect(state.player.fatigue).toBe(2);
  });

  it("leaves a short day unpunished", () => {
    const state = newGame(OPEN_PLAIN);
    game.moveTo(state, ...offset(state, 5, 4));
    game.endDay(state);
    expect(state.player.fatigue).toBe(0);
  });
});

describe("survival game — WP-11 movement points from condition", () => {
  it("matches the table in PRD 7.2", () => {
    const cases = [
      [10, 0, 6],
      [7, 3, 5],
      [5, 6, 4],
      [3, 8, 2],
      [1, 10, 1],
    ];

    for (const [health, fatigue, expected] of cases) {
      expect(config.movementPointsFor({ health, fatigue, carryingNpc: false })).toBe(expected);
    }
  });

  it("never drops below one point", () => {
    expect(config.movementPointsFor({ health: 0, fatigue: 10, carryingNpc: true })).toBe(1);
  });
});

describe("survival game — WP-12 and WP-13 winning and losing", () => {
  it("wins the moment the player steps onto an edge hex", () => {
    const escape = scenarioFrom("test-escape", [".....", ".....", ".....", ".....", "....."], { col: 2, row: 2 });
    const state = newGame(escape);

    game.moveTo(state, ...offset(state, 3, 2));
    expect(state.gameOver).toBe(false);

    game.moveTo(state, ...offset(state, 4, 2));
    expect(state.gameOver).toBe(true);
    expect(state.result).toBe("won");
    expect(state.log.some((entry) => entry.key === "log.win")).toBe(true);
  });

  it("loses at zero health and blocks every action afterwards", () => {
    const state = newGame(OPEN_PLAIN);
    state.player.health = 2;
    state.player.water = 1;

    game.endDay(state);

    expect(state.player.health).toBe(0);
    expect(state.gameOver).toBe(true);
    expect(state.result).toBe("lost");
    expect(state.player.alive).toBe(false);

    const move = game.moveTo(state, ...offset(state, 5, 4));
    expect(move.ok).toBe(false);
    expect(game.endDay(state).ok).toBe(false);
  });
});

describe("survival game — WP-14 and WP-15 the record of the run", () => {
  it("summarises the expedition for the end screen and the backend", () => {
    const state = newGame(OPEN_PLAIN);
    game.moveTo(state, ...offset(state, 5, 4));
    game.endDay(state);

    expect(game.summary(state)).toEqual({
      cheatsUsed: false,
      days: state.day,
      hexesTravelled: 1,
      health: state.player.health,
      water: state.player.water,
      food: state.player.food,
      eventsSeen: 0,
      forcedMarches: 0,
    });
  });

  it("keeps the whole journal in state and shows only the tail", () => {
    const state = newGame(OPEN_PLAIN);
    for (let day = 0; day < 20; day += 1) game.endDay(state);

    expect(state.log.length).toBeGreaterThan(20);
    expect(game.visibleLog(state)).toHaveLength(config.LOG.visibleEntries);
    expect(game.visibleLog(state)[0]).toEqual(state.log[state.log.length - 1]);
  });
});

describe("survival game — WP-16 reproducibility", () => {
  it("replays identically from the same seed and the same moves", () => {
    function play() {
      const state = game.createGame({ seed: 777, scenarioId: "lost", difficulty: "normal" });

      for (let turn = 0; turn < 12 && !state.gameOver; turn += 1) {
        for (const direction of hex.DIRECTIONS) {
          if (state.gameOver) break;
          game.moveTo(state, state.player.q + direction.q, state.player.r + direction.r);
        }
        if (!state.gameOver) game.endDay(state);
      }
      return state;
    }

    const first = play();
    const second = play();

    expect(second.log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text));
    expect(second.player).toEqual(first.player);
    expect(second.stats).toEqual(first.stats);
  });

  it("keeps Math.random out of the game logic", () => {
    const dir = path.join(__dirname, "../../public/js/games/survival");
    const offenders = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".js"))
      .filter((file) => fs.readFileSync(path.join(dir, file), "utf8").includes("Math.random"));

    expect(offenders).toEqual([]);
  });
});
