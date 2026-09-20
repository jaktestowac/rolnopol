/**
 * Rolnopol Survival — the cheat console (PRD 8.8).
 *
 * Two things matter here beyond "the button works": a cheat cannot push a value
 * somewhere the game itself could not, and a run that used one says so.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const game = require("../../public/js/games/survival/game.js");
const cheats = require("../../public/js/games/survival/cheats.js");
const config = require("../../public/js/games/survival/config.js");
const strings = require("../../public/js/games/survival/strings.js");
const snapshot = require("../../public/js/games/survival/snapshot.js");

const HTML = fs.readFileSync(path.join(__dirname, "../../public/operator/survival.html"), "utf8");
const UI = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");

function newGame(options) {
  return game.createGame({
    seed: 3,
    scenarioId: "lost",
    difficulty: "normal",
    events: false,
    weather: "clear",
    ...(options || {}),
  });
}

describe("survival cheats — what the console is made of", () => {
  it("ships a handful of buttons and a handful of dials", () => {
    const actions = cheats.list().filter((cheat) => cheat.kind === "action");
    const dials = cheats.list().filter((cheat) => cheat.kind !== "action");

    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(dials.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every entry a label and a tooltip that explains it", () => {
    for (const cheat of cheats.list()) {
      expect(strings.has(cheat.labelKey), cheat.id + " has no label").toBe(true);
      expect(strings.has(cheat.tooltipKey), cheat.id + " has no tooltip").toBe(true);
      expect(strings.t(cheat.tooltipKey).length, cheat.id + " has a useless tooltip").toBeGreaterThan(20);
    }
  });

  it("declares a kind the panel knows how to draw", () => {
    for (const cheat of cheats.list()) {
      expect(["action", "value", "choice"], cheat.id).toContain(cheat.kind);
      if (cheat.kind === "value") {
        expect(typeof cheat.min, cheat.id).toBe("number");
        expect(typeof cheat.max, cheat.id).toBe("number");
      }
      if (cheat.kind === "choice") expect(typeof cheat.options, cheat.id).toBe("function");
    }
  });

  it("does nothing for a name nobody registered", () => {
    const state = newGame();
    const answer = cheats.apply(state, "godMode");

    expect(answer.ok).toBe(false);
    expect(state.cheatsUsed).toBe(false);
  });
});

describe("survival cheats — the buttons", () => {
  it("uncovers the whole map", () => {
    const state = newGame();
    expect(state.map.tiles.every((tile) => tile.revealed)).toBe(false);

    cheats.apply(state, "revealMap");

    expect(state.map.tiles.every((tile) => tile.revealed)).toBe(true);
  });

  it("fills the stores and empties the fatigue", () => {
    const state = newGame();
    state.player.water = 1;
    state.player.food = 2;
    state.player.health = 3;
    state.player.fatigue = 9;

    cheats.apply(state, "fillStores");

    expect(state.player.water).toBe(config.RESOURCES.water.max);
    expect(state.player.food).toBe(config.RESOURCES.food.max);
    expect(state.player.health).toBe(config.RESOURCES.health.max);
    expect(state.player.fatigue).toBe(0);
  });

  it("treats every wound and illness", () => {
    const state = newGame();
    game.addCondition(state, "fever");
    game.addCondition(state, "sprain");

    cheats.apply(state, "heal");

    expect(state.player.conditions).toHaveLength(0);
  });

  it("puts the day's movement back", () => {
    const state = newGame();
    state.movementLeft = 1;

    cheats.apply(state, "refillMovement");

    expect(state.movementLeft).toBe(config.movementPointsFor(state.player));
  });

  it("runs a whole day at once", () => {
    const state = newGame();
    const water = state.player.water;

    cheats.apply(state, "skipDay");

    expect(state.day).toBe(2);
    expect(state.player.water).toBe(water - config.END_OF_DAY.waterLoss);
  });

  it("ends the run either way, and writes it down", () => {
    const won = newGame();
    cheats.apply(won, "winNow");
    expect(won.gameOver).toBe(true);
    expect(won.result).toBe("won");
    expect(won.log[won.log.length - 1].key).toBe("cheat.log.win");

    const lost = newGame();
    cheats.apply(lost, "loseNow");
    expect(lost.result).toBe("lost");
    expect(lost.player.alive).toBe(false);
  });

  it("fires any event by name, choices included", () => {
    const state = newGame();

    cheats.apply(state, "fireEvent", "abandonedPack");

    expect(state.stats.eventsSeen).toBe(1);
    expect(state.pendingChoice.eventId).toBe("abandonedPack");
  });

  it("pins the sky", () => {
    const state = newGame();

    cheats.apply(state, "setWeather", "heat");

    expect(state.weather).toBe("heat");
    game.endDay(state);
    expect(state.weather).toBe("heat");
  });

  it("ignores weather nobody has written", () => {
    const state = newGame();
    cheats.apply(state, "setWeather", "hurricane");
    expect(state.weather).toBe("clear");
  });
});

describe("survival cheats — the dials still obey the game", () => {
  it("sets a resource straight to a value", () => {
    const state = newGame();

    cheats.apply(state, "set-food", 12);

    expect(state.player.food).toBe(12);
  });

  it("cannot push a value past what the game allows", () => {
    const state = newGame();

    cheats.apply(state, "set-water", 99);
    cheats.apply(state, "set-health", -50);

    expect(state.player.water).toBe(config.RESOURCES.water.max);
    expect(state.player.health).toBe(config.RESOURCES.health.min);
  });

  it("reads back what is there now, so the panel is not lying", () => {
    const state = newGame();
    state.player.orientation = 4;

    expect(cheats.get("set-orientation").read(state)).toBe(4);
    expect(cheats.get("setWeather").read(state)).toBe("clear");
  });

  it("sets the movement left without going silly", () => {
    const state = newGame();

    cheats.apply(state, "set-movement", 5);
    expect(state.movementLeft).toBe(5);

    cheats.apply(state, "set-movement", 999);
    expect(state.movementLeft).toBeLessThanOrEqual(20);
  });
});

describe("survival cheats — a helped run says so", () => {
  it("marks the run the first time one is used", () => {
    const state = newGame();
    expect(state.cheatsUsed).toBe(false);

    cheats.apply(state, "heal");

    expect(state.cheatsUsed).toBe(true);
  });

  it("carries the mark into the result the backend gets", () => {
    const clean = newGame();
    const helped = newGame();
    cheats.apply(helped, "fillStores");

    expect(game.summary(clean).cheatsUsed).toBe(false);
    expect(game.summary(helped).cheatsUsed).toBe(true);
  });

  it("carries it through a saved run as well", () => {
    const state = newGame();
    cheats.apply(state, "revealMap");

    const restored = snapshot.restore(JSON.parse(JSON.stringify(snapshot.capture(state))));

    expect(restored.cheatsUsed).toBe(true);
  });
});

describe("survival cheats — the panel", () => {
  it("is on the page, collapsible, and says how to open it", () => {
    expect(HTML).toContain('id="wpCheats"');
    expect(HTML).toContain('id="wpCheatsFold"');
    expect(HTML).toContain('id="wpCheatActions"');
    expect(HTML).toContain('id="wpCheatDials"');
    expect(strings.t("cheat.hint")).toContain("~");
  });

  it("opens on the tilde, from the menu as well as from a run", () => {
    expect(UI).toContain('event.key === "~"');
    expect(UI).toContain("toggleCheats");
  });

  it("draws itself from the registry rather than by hand", () => {
    for (const cheat of cheats.list()) {
      expect(HTML, cheat.id + " is hard-coded in the page").not.toContain('data-cheat="' + cheat.id + '"');
    }
    expect(UI).toContain("cheats.list()");
  });

  it("hangs the tooltip on every control", () => {
    expect(UI).toContain("tooltipKey");
    expect(UI).toContain('title="');
  });

  it("owns up to it on the end screen", () => {
    expect(HTML).toContain('id="wpEndCheated"');
    expect(strings.has("end.cheated")).toBe(true);
  });
});
