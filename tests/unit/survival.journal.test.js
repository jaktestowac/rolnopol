/**
 * Rolnopol Survival — how the journal reads (WP-52, WP-53, WP-54, WP-64).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const strings = require("../../public/js/games/survival/strings.js");
const hex = require("../../public/js/games/survival/hex.js");
const generator = require("../../public/js/games/survival/map-generator.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

const ROWS = [];
for (let row = 0; row < 9; row += 1) ROWS.push(".".repeat(9));

handmade.DEFINITIONS["journal-plain"] = { id: "journal-plain", rows: ROWS, start: { col: 4, row: 4 } };
scenarios.SCENARIOS["journal-plain"] = {
  ...scenarios.getScenario("lost"),
  id: "journal-plain",
  map: { source: "handmade", id: "journal-plain" },
};

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

function newGame(options) {
  return game.createGame({
    seed: 1,
    scenarioId: "journal-plain",
    difficulty: "normal",
    events: false,
    weather: "clear",
    ...(options || {}),
  });
}

/** Walk east and back, so the edge stays out of reach. */
function pace(state, times) {
  const there = hex.offsetToAxial(5, 4);
  const back = hex.offsetToAxial(4, 4);

  for (let i = 0; i < times; i += 1) {
    game.moveTo(state, there.q, there.r);
    game.moveTo(state, back.q, back.r);
    if (state.movementLeft <= 0) game.endDay(state);
  }
}

describe("survival journal — WP-52 the same thing said differently", () => {
  it("keeps several ways of saying the common lines", () => {
    expect(strings.count("log.move")).toBeGreaterThanOrEqual(3);
    expect(strings.count("log.dayBreaks")).toBeGreaterThanOrEqual(3);
    expect(strings.count("log.searchFailed.water")).toBeGreaterThanOrEqual(3);
  });

  it("does not repeat itself ten times in a row", () => {
    const state = newGame();
    pace(state, 10);

    const moves = new Set(state.log.filter((entry) => entry.key === "log.move").map((entry) => entry.text));
    expect(moves.size).toBeGreaterThanOrEqual(3);
  });

  it("says the same things in the same order for the same seed", () => {
    const first = newGame();
    const second = newGame();
    pace(first, 8);
    pace(second, 8);

    expect(second.log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text));
  });

  it("does not spend the run's luck on picking a wording", () => {
    // A journal line must never shift what the dice do next: two runs that
    // differ only in how much was written must roll the same events.
    const quiet = newGame();
    const chatty = newGame();

    for (let i = 0; i < 12; i += 1) game.addLog(chatty, "log.dayBreaks", { day: 1 });

    expect(chatty.rngState).toBe(quiet.rngState);
  });

  it("leaves button labels alone", () => {
    expect(strings.t("action.endDay")).toBe("End day");
    expect(strings.t("action.endDay", null, 7)).toBe("End day");
  });
});

describe("survival journal — WP-53 lines that know how bad it is", () => {
  it("writes a different line when the canteen is empty", () => {
    const fed = newGame();
    const parched = newGame();
    parched.player.water = 0;

    const east = hex.offsetToAxial(5, 4);
    game.moveTo(fed, east.q, east.r);
    game.moveTo(parched, east.q, east.r);

    expect(fed.log[fed.log.length - 1].key).toBe("log.move");
    expect(parched.log[parched.log.length - 1].key).toBe("log.move.thirsty");
  });

  it("writes a different line when the body is spent", () => {
    const state = newGame();
    state.player.fatigue = 9;

    const east = hex.offsetToAxial(5, 4);
    game.moveTo(state, east.q, east.r);

    expect(state.log[state.log.length - 1].key).toBe("log.move.spent");
  });

  it("falls back to the plain line when nothing is wrong", () => {
    const state = newGame();
    const east = hex.offsetToAxial(5, 4);
    game.moveTo(state, east.q, east.r);

    expect(state.log[state.log.length - 1].key).toBe("log.move");
  });
});

describe("survival journal — WP-54 the morning line names the worst of it", () => {
  /**
   * The day-break line, wherever it sits. Dawn can be followed by a line of
   * atmosphere (PRD 8.13), so "the last entry" stopped being a safe way to
   * find it — the claim under test was always about which morning line was
   * chosen, not about nothing following it.
   */
  function dayBreakKey(state) {
    const entry = [...state.log].reverse().find((line) => line.key.startsWith("log.dayBreaks"));
    return entry && entry.key;
  }

  it("puts thirst above hunger, because thirst kills first", () => {
    const state = newGame();
    state.player.water = 1;
    state.player.food = 1;

    game.endDay(state);

    expect(dayBreakKey(state)).toBe("log.dayBreaks.thirst");
  });

  it("names hunger when there is water", () => {
    const state = newGame();
    state.player.food = 1;

    game.endDay(state);

    expect(dayBreakKey(state)).toBe("log.dayBreaks.hunger");
  });

  it("names exhaustion when the stores hold", () => {
    const state = newGame();
    state.player.fatigue = 9;

    game.endDay(state);

    expect(dayBreakKey(state)).toBe("log.dayBreaks.spent");
  });

  it("opens the day plainly when nothing is wrong", () => {
    const state = newGame();
    game.endDay(state);

    expect(dayBreakKey(state)).toBe("log.dayBreaks");
  });
});

describe("survival travel — a road is easier walking (PRD 8.10)", () => {
  it("charges no march fatigue for a day spent on a trail", () => {
    const road = scenarioFrom("journal-road", ["TTTTT", "TTTTT", "TTTTT", "TTTTT", "TTTTT"], { col: 2, row: 2 });
    const rough = scenarioFrom("journal-rough", ["fffff", "fffff", "fffff", "fffff", "fffff"], { col: 2, row: 2 });

    for (const scenarioId of [road, rough]) {
      const state = game.createGame({ seed: 1, scenarioId, difficulty: "normal", events: false, weather: "clear" });
      const there = hex.offsetToAxial(3, 2);
      const back = hex.offsetToAxial(2, 2);

      game.moveTo(state, there.q, there.r);
      game.moveTo(state, back.q, back.r);
      game.moveTo(state, there.q, there.r);
      game.endDay(state);

      if (scenarioId === road) expect(state.player.fatigue, "road").toBe(0);
      else expect(state.player.fatigue, "rough ground").toBeGreaterThan(0);
    }
  });

  it("still counts a day spent searching as work", () => {
    const road = scenarioFrom("journal-road2", ["TTTTT", "TTTTT", "TTTTT", "TTTTT", "TTTTT"], { col: 2, row: 2 });
    const state = game.createGame({ seed: 1, scenarioId: road, difficulty: "normal", events: false, weather: "clear" });

    game.searchWater(state);
    game.searchFood(state);
    game.endDay(state);

    expect(state.player.fatigue).toBeGreaterThan(0);
  });
});

describe("survival sight — landmarks carry further (PRD 8.10)", () => {
  it("shows water and forage from beyond the sight radius", () => {
    const near = scenarioFrom(
      "journal-spring",
      [".........", ".........", ".........", ".........", "....W....", ".........", ".........", ".........", "........."],
      { col: 4, row: 4 },
    );
    const state = game.createGame({ seed: 1, scenarioId: near, difficulty: "normal", events: false, weather: "clear" });

    // Put a spring outside the sight radius but inside the landmark radius.
    const sight = game.visionRadiusFor(state);
    const far = state.map.tiles.find((tile) => hex.distance(tile, state.player) === sight + 2 && !tile.hasWaterSource);
    for (const tile of state.map.tiles) tile.revealed = false;

    far.hasWaterSource = true;
    game.revealAround(state);

    expect(far.revealed, "a spring two hexes past the sight radius").toBe(true);
  });

  it("keeps ordinary ground hidden at that distance", () => {
    const plain = scenarioFrom(
      "journal-plain2",
      [".........", ".........", ".........", ".........", ".........", ".........", ".........", ".........", "........."],
      { col: 4, row: 4 },
    );
    const state = game.createGame({ seed: 1, scenarioId: plain, difficulty: "normal", events: false, weather: "clear" });

    const sight = game.visionRadiusFor(state);
    const far = state.map.tiles.find((tile) => hex.distance(tile, state.player) === sight + 2);

    expect(game.isLandmark(far)).toBe(false);
    expect(far.revealed).toBe(false);
  });

  it("counts rivers, springs, forage and cabins as landmarks, and nothing else", () => {
    expect(game.isLandmark({ type: "river" })).toBe(true);
    expect(game.isLandmark({ type: "open", hasWaterSource: true })).toBe(true);
    expect(game.isLandmark({ type: "open", hasFoodSource: true })).toBe(true);
    expect(game.isLandmark({ type: "open", hasCabin: true })).toBe(true);
    expect(game.isLandmark({ type: "forest" })).toBe(false);
    expect(game.isLandmark({ type: "mountain" })).toBe(false);
  });
});

describe("survival map — WP-64 rivers that are actually rivers", () => {
  it("leaves no river hex stranded on its own, across 100 seeds", () => {
    let stranded = 0;
    let checked = 0;

    for (let seed = 1; seed <= 100; seed += 1) {
      const map = generator.generateMap({ seed });

      for (const tile of map.tiles) {
        if (tile.type !== "river") continue;
        checked += 1;

        const touching = hex
          .neighbors(tile.q, tile.r)
          .map((spot) => generator.tileAt(map, spot.q, spot.r))
          .some((other) => other && other.type === "river");

        if (!touching) stranded += 1;
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(stranded).toBe(0);
  });

  it("carves the course without changing the terrain counts", () => {
    const total = generator.terrainCounts(24 * 24);

    for (let seed = 1; seed <= 20; seed += 1) {
      const map = generator.generateMap({ seed });
      const rivers = map.tiles.filter((tile) => tile.type === "river").length;

      expect(rivers, "seed " + seed).toBe(total.river);
    }
  });
});
