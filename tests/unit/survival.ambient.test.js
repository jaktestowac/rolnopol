/**
 * Rolnopol Survival — the noises off, and how the journal reads (PRD 8.13).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const game = require("../../public/js/games/survival/game.js");
const ambient = require("../../public/js/games/survival/ambient.js");
const strings = require("../../public/js/games/survival/strings.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

const CSS = fs.readFileSync(path.join(__dirname, "../../public/css/pages/survival.css"), "utf8");
const UI = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

const PLAIN = scenarioFrom(
  "amb-plain",
  [".........", ".........", ".........", ".........", ".........", ".........", ".........", ".........", "........."],
  { col: 4, row: 4 },
);

function newGame(options) {
  return game.createGame({
    seed: 1,
    scenarioId: PLAIN,
    difficulty: "normal",
    events: false,
    weather: "clear",
    ...(options || {}),
  });
}

/** Walk east and back so the border stays out of reach. */
function pace(state, times) {
  const there = hex.offsetToAxial(5, 4);
  const back = hex.offsetToAxial(4, 4);

  for (let i = 0; i < times; i += 1) {
    game.moveTo(state, there.q, there.r);
    game.moveTo(state, back.q, back.r);
    if (state.movementLeft <= 0) game.endDay(state);
  }
}

describe("survival ambient — lines that cost nothing", () => {
  it("writes every pool it can draw from", () => {
    const pools = new Set(["ambient.general"]);
    for (const terrain of ambient.CONTEXTS.terrain) pools.add("ambient.terrain." + terrain);
    for (const weather of ambient.CONTEXTS.weather) pools.add("ambient.weather." + weather);

    for (const key of pools) {
      expect(strings.has(key), key + " has no lines").toBe(true);
      expect(strings.count(key), key + " has only one line").toBeGreaterThanOrEqual(2);
    }
  });

  it("says something on the way, without touching anything", () => {
    const state = newGame();
    const before = { ...state.player };

    pace(state, 12);

    const spoken = state.log.filter((entry) => entry.kind === "ambient");
    expect(spoken.length).toBeGreaterThan(0);

    // The only thing a day of walking should have changed is the walking.
    expect(state.player.health).toBe(before.health);
    expect(state.player.orientation).toBe(before.orientation);
  });

  it("never spends the run's luck on a bit of atmosphere", () => {
    // The same rule the message variants follow: writing a line must not shift
    // what the dice do next, or the seed stops replaying.
    const quiet = newGame();
    const chatty = newGame();

    for (let i = 0; i < 20; i += 1) game.maybeAmbient(chatty, "move");

    expect(chatty.rngState).toBe(quiet.rngState);
  });

  it("says the same things in the same order for the same seed", () => {
    const first = newGame();
    const second = newGame();
    pace(first, 10);
    pace(second, 10);

    const spoken = (state) => state.log.filter((entry) => entry.kind === "ambient").map((entry) => entry.text);
    expect(spoken(second)).toEqual(spoken(first));
  });

  it("draws on the ground underfoot and the sky overhead", () => {
    const state = newGame({ weather: "fog" });
    const forest = { type: "forest" };

    expect(ambient.poolsFor(state, forest)).toContain("ambient.terrain.forest");
    expect(ambient.poolsFor(state, forest)).toContain("ambient.weather.fog");
    expect(ambient.poolsFor(state, forest)).toContain("ambient.general");
  });

  it("falls back to the general pool on ground with nothing to say", () => {
    const state = newGame({ weather: "clear" });
    expect(ambient.poolsFor(state, { type: "nowhere" })).toEqual(["ambient.general"]);
  });

  it("stays quiet once the run is over", () => {
    const state = newGame();
    state.gameOver = true;

    expect(game.maybeAmbient(state, "move")).toBeNull();
  });
});

describe("survival journal — one kind of line is not another (PRD 8.13)", () => {
  it("sorts a line by its key, so no call site can forget to", () => {
    expect(game.logKind("ambient.general")).toBe("ambient");
    expect(game.logKind("event.storm.text")).toBe("event");
    expect(game.logKind("condition.fever.tick")).toBe("harm");
    expect(game.logKind("log.noWater")).toBe("harm");
    expect(game.logKind("log.win")).toBe("good");
    expect(game.logKind("log.move")).toBe("move");
    expect(game.logKind("log.camp")).toBe("action");
    expect(game.logKind("weather.heat")).toBe("weather");
    expect(game.logKind("cheat.log.win")).toBe("cheat");
  });

  it("puts a kind on every entry it writes", () => {
    const state = newGame();
    pace(state, 8);

    expect(state.log.every((entry) => typeof entry.kind === "string" && entry.kind.length > 0)).toBe(true);
  });

  it("tells trouble apart from scenery", () => {
    const state = newGame();
    state.player.water = 1;
    game.endDay(state);

    const thirst = state.log.find((entry) => entry.key === "log.noWater");
    expect(thirst.kind).toBe("harm");
  });

  it("carries the kind onto the page and into the end screen", () => {
    expect(UI).toContain("wp-journal__entry--");
    expect(UI).toContain("entry.kind");
  });

  it("gives atmosphere, trouble and events their own look", () => {
    expect(CSS).toContain(".wp-journal__entry--ambient");
    expect(CSS).toContain(".wp-journal__entry--harm");
    expect(CSS).toContain(".wp-journal__entry--event");

    const quiet = CSS.slice(CSS.indexOf(".wp-journal__entry--ambient"));
    expect(quiet.slice(0, quiet.indexOf("}"))).toContain("italic");
  });

  it("uses colours the palette actually defines", () => {
    const palette = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
    const used = [...CSS.matchAll(/var\((--wp-[\w-]+)\)/g)].map((match) => match[1]);

    const undefinedTokens = [...new Set(used)].filter((token) => !palette.includes(token + ":"));
    expect(undefinedTokens).toEqual([]);
  });
});
