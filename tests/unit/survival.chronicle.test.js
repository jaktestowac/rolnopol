/**
 * Rolnopol Survival — the expedition as something you can tell (PRD 8.17, faza C).
 *
 * Nothing here is a new game rule. Every one of these facts was already in the
 * run and simply never read: where the player walked, what the journal already
 * sorted by kind (PRD 8.13), and the seed that rebuilds the map. What the tests
 * hold onto is that the reading is honest — the route is the route actually
 * taken, and the picture does not uncover ground the player never saw.
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const chronicle = require("../../public/js/games/survival/chronicle.js");
const snapshot = require("../../public/js/games/survival/snapshot.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

const PLAIN = scenarioFrom(
  "chron-plain",
  ["........", "........", "........", "........", "........", "........", "........", "........"],
  { col: 3, row: 3 },
);

const MIRE = scenarioFrom("chron-mire", ["sssss", "sssss", "sssss", "sssss", "sssss"], { col: 2, row: 2 });

function newGame(id) {
  return game.createGame({ seed: 5, scenarioId: id || PLAIN, difficulty: "normal", events: false, weather: "clear" });
}

/** Walk east, staying short of the border so the run does not end mid-test. */
function walkEast(state, steps) {
  for (let i = 1; i <= steps; i += 1) {
    const target = hex.offsetToAxial(3 + i, 3);
    game.moveTo(state, target.q, target.r);
  }
}

/** Walk east and back, so the border never ends the run mid-test. */
function pace(state, times) {
  const there = hex.offsetToAxial(4, 3);
  const back = hex.offsetToAxial(3, 3);

  for (let i = 0; i < times; i += 1) {
    game.moveTo(state, there.q, there.r);
    game.moveTo(state, back.q, back.r);
    if (state.movementLeft <= 0) game.endDay(state);
  }
}

describe("survival chronicle — the route walked", () => {
  it("starts where the player started", () => {
    const state = newGame();
    const steps = chronicle.routeOf(state);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ q: state.player.q, r: state.player.r });
  });

  it("records every step, in order", () => {
    const state = newGame();
    pace(state, 3);

    const steps = chronicle.routeOf(state);
    expect(steps).toHaveLength(state.stats.hexesTravelled + 1);
    expect(steps[steps.length - 1]).toEqual({ q: state.player.q, r: state.player.r });
  });

  it("records a forced march too, which is still a step somebody took", () => {
    const state = newGame(MIRE);
    state.movementLeft = 1;
    const before = chronicle.routeOf(state).length;

    expect(game.forcedMarch(state).ok).toBe(true);
    expect(chronicle.routeOf(state)).toHaveLength(before + 1);
  });

  it("survives being parked and picked up again (WP-69)", () => {
    const state = newGame();
    pace(state, 2);

    const restored = snapshot.restore(snapshot.capture(state));
    expect(chronicle.routeOf(restored)).toEqual(chronicle.routeOf(state));
  });

  it("gives a run restored from an older save somewhere to start from", () => {
    // Version 1 saves predate the route trace. They are still readable, and the
    // run picks the trace up from where the player is standing (PRD 8.14, debt).
    const state = newGame();
    pace(state, 2);

    const old = { ...snapshot.capture(state), v: 1 };
    delete old.route;

    const restored = snapshot.restore(old);
    expect(restored).not.toBeNull();
    expect(chronicle.routeOf(restored)).toEqual([{ q: restored.player.q, r: restored.player.r }]);
  });
});

describe("survival chronicle — the map as a picture", () => {
  it("marks where it began and where it ended", () => {
    const state = newGame();
    walkEast(state, 2);

    const drawing = chronicle.picture(state);
    const start = drawing.cells.filter((cell) => cell.start);
    const end = drawing.cells.filter((cell) => cell.end);

    expect(start).toHaveLength(1);
    expect(end).toHaveLength(1);
    expect(start[0], "a walk that went somewhere ends somewhere else").not.toBe(end[0]);
    expect(drawing.cells.some((cell) => cell.route)).toBe(true);
  });

  it("marks a round trip once, where it began and ended", () => {
    const state = newGame();
    pace(state, 2);

    const drawing = chronicle.picture(state);
    const here = drawing.cells.filter((cell) => cell.start);

    expect(here).toHaveLength(1);
    expect(here[0].end, "walking back to the start ends at the start").toBe(true);
  });

  it("keeps the fog", () => {
    const state = newGame();
    const drawing = chronicle.picture(state);

    const unseen = state.map.tiles.filter((tile) => !tile.revealed).length;
    expect(unseen, "the fixture starts with ground still unseen").toBeGreaterThan(0);
    expect(drawing.cells.some((cell) => !cell.revealed)).toBe(true);
  });

  it("lifts the fog when asked to, and not before", () => {
    const state = newGame();
    const blind = chronicle.picture(state, { revealedOnly: true });
    const open = chronicle.picture(state, { revealedOnly: false });

    const seen = (drawing) => drawing.cells.filter((cell) => cell.revealed).length;
    expect(seen(open)).toBeGreaterThan(seen(blind));
  });

  it("samples a map too big to draw hex for hex", () => {
    const big = game.createGame({ seed: 3, scenarioId: "lost", difficulty: "normal", mapSize: "endless", events: false });
    const drawing = chronicle.picture(big, { maxWidth: 32 });

    expect(big.map.width).toBe(128);
    expect(drawing.scale).toBeGreaterThan(1);
    expect(drawing.width).toBeLessThanOrEqual(32);
    expect(drawing.cells).toHaveLength(drawing.width * drawing.height);
  });

  it("draws a small map at full size", () => {
    const drawing = chronicle.picture(newGame(), { maxWidth: 32 });
    expect(drawing.scale).toBe(1);
    expect(drawing.width).toBe(8);
  });

  it("turns into text without a browser anywhere near it", () => {
    const state = newGame();
    walkEast(state, 2);

    const text = chronicle.pictureText(chronicle.picture(state));
    expect(text).toContain("S");
    expect(text).toContain("X");
    expect(text.split("\n")[0], "leading fog is trimmed").not.toBe("");
  });
});

describe("survival chronicle — what was worth remembering", () => {
  it("takes trouble and events, and leaves the walking out of it", () => {
    const state = newGame();
    pace(state, 6);
    state.player.water = 1;
    game.endDay(state);

    const kinds = new Set(chronicle.moments(state).map((moment) => moment.kind));
    for (const kind of kinds) expect(chronicle.MOMENT_KINDS).toContain(kind);
    expect(kinds.has("move")).toBe(false);
    expect(kinds.has("ambient")).toBe(false);
  });

  it("counts a thing that happens three nights running as one thing", () => {
    const state = newGame();
    game.addCondition(state, "fever");
    game.tickConditions(state);
    game.tickConditions(state);

    const ticks = chronicle.moments(state).filter((moment) => moment.key === "condition.fever.tick");
    expect(ticks).toHaveLength(1);
  });

  it("never grows past what the end screen can show", () => {
    const state = newGame();
    for (let day = 1; day <= 30; day += 1) {
      game.addLog(state, "event.storm" + day + ".text");
      state.day += 1;
    }

    const kept = chronicle.moments(state);
    expect(kept).toHaveLength(chronicle.MOMENT_LIMIT);
    expect(kept[0].day, "how it started is kept").toBe(1);
    expect(kept[kept.length - 1].day, "and how it finished").toBe(30);
  });

  it("hands the record keys, not sentences", () => {
    const state = newGame();
    pace(state, 4);
    state.player.water = 1;
    game.endDay(state);

    for (const moment of chronicle.momentKeys(state)) {
      expect(Object.keys(moment).sort()).toEqual(["day", "key", "kind"]);
    }
  });
});

describe("survival chronicle — the report a player can paste anywhere", () => {
  it("carries the seed, so the map can be walked again", () => {
    const state = newGame();
    pace(state, 2);
    state.result = "won";

    const text = chronicle.report(state, { achievements: ["wayOut"] });
    expect(text).toContain(String(state.seed));
    expect(text).toContain("You made it out");
    expect(text).toContain("Way out");
  });

  it("says when the run was helped along", () => {
    const state = newGame();
    state.cheatsUsed = true;
    expect(chronicle.report(state)).toContain("Cheats were used");
  });

  it("reads as text and nothing else", () => {
    const state = newGame();
    pace(state, 2);

    const text = chronicle.report(state);
    expect(text).not.toContain("<");
    expect(text.endsWith("\n")).toBe(true);
  });
});
