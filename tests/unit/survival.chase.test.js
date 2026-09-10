/**
 * Rolnopol Survival — the chase, the deadline, the dry flats and saved runs
 * (WP-65, WP-66, WP-68, WP-69).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const chaser = require("../../public/js/games/survival/chaser.js");
const snapshot = require("../../public/js/games/survival/snapshot.js");
const generator = require("../../public/js/games/survival/map-generator.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const strings = require("../../public/js/games/survival/strings.js");
const hex = require("../../public/js/games/survival/hex.js");

function newGame(scenarioId, options) {
  return game.createGame({
    seed: 9,
    scenarioId,
    difficulty: "normal",
    events: false,
    weather: "clear",
    ...(options || {}),
  });
}

describe("survival desert — WP-65 the dry flats exist now", () => {
  it("gives desert a share of the mix", () => {
    expect(config.TERRAIN_MIX.desert).toBeGreaterThan(0);
    expect(strings.has("terrain.desert")).toBe(true);
  });

  it("puts it on every map, in the declared proportion", () => {
    const expected = config.TERRAIN_MIX.desert * config.MAP.width * config.MAP.height;

    for (let seed = 1; seed <= 20; seed += 1) {
      const map = generator.generateMap({ seed });
      const desert = map.tiles.filter((tile) => tile.type === "desert").length;

      expect(desert, "seed " + seed).toBeGreaterThan(0);
      expect(Math.abs(desert - expected)).toBeLessThanOrEqual(3);
    }
  });

  it("gives it something to say", () => {
    const events = require("../../public/js/games/survival/events.js");
    const onSand = events
      .list()
      .filter((event) => event.terrain && event.terrain.includes("desert"))
      .map((event) => event.id);

    expect(onSand.length).toBeGreaterThanOrEqual(3);
    expect(events.list(null, "forest").map((event) => event.id)).not.toContain("mirage");
  });
});

describe("survival deadline — WP-68 a scenario with a clock", () => {
  it("carries a day limit and says so in its description", () => {
    const scenario = scenarios.getScenario("deadline");

    expect(scenario.dayLimit).toBeGreaterThan(0);
    expect(strings.t(scenario.descriptionKey, { days: scenario.dayLimit })).toContain(String(scenario.dayLimit));
  });

  it("ends the run when the day is missed, with its own line", () => {
    const state = newGame("deadline");

    for (let day = 0; day < 10 && !state.gameOver; day += 1) game.endDay(state);

    expect(state.gameOver).toBe(true);
    expect(state.result).toBe("lost");
    expect(state.log[state.log.length - 1].key).toBe("log.deadline.missed");
  });

  it("still ends on health, and says that instead", () => {
    const state = newGame("deadline");
    state.player.health = 1;
    state.player.water = 0;

    game.endDay(state);

    expect(state.result).toBe("lost");
    expect(state.log[state.log.length - 1].key).toBe("log.loss");
  });

  it("wants the western border, like Survival", () => {
    const state = newGame("deadline");
    const west = hex.offsetToAxial(0, 12);
    state.player.q = west.q;
    state.player.r = west.r;

    expect(scenarios.getScenario("deadline").isWin(state)).toBe(true);
  });
});

describe("survival chase — WP-66 someone on your trail", () => {
  it("puts a hunter on the map, at a distance", () => {
    const state = newGame("chase");

    expect(state.chaser).toBeTruthy();
    expect(hex.distance(state.chaser, state.player)).toBe(config.CHASE.startDistance);
  });

  it("leaves every other scenario alone", () => {
    expect(newGame("lost").chaser).toBeNull();
    expect(newGame("search").chaser).toBeNull();
  });

  it("closes the distance on a player who stands still", () => {
    const state = newGame("chase");
    const before = hex.distance(state.chaser, state.player);

    for (let day = 0; day < 4 && !state.gameOver; day += 1) game.endDay(state);

    expect(hex.distance(state.chaser, state.player)).toBeLessThan(before);
  });

  it("catches them in the end, and says which way the run ended", () => {
    const state = newGame("chase");

    for (let day = 0; day < 30 && !state.gameOver; day += 1) game.endDay(state);

    expect(state.gameOver).toBe(true);
    // Either the wild got them or the hunter did; both have their own line.
    expect(["log.chase.caught", "log.loss"]).toContain(state.log[state.log.length - 1].key);
  });

  it("guesses worse the more lost the player is", () => {
    expect(chaser.errorFor(10)).toBeLessThan(chaser.errorFor(5));
    expect(chaser.errorFor(5)).toBeLessThan(chaser.errorFor(0));
  });

  it("never walks off the map, however bad the guess", () => {
    const state = newGame("chase");
    state.player.orientation = 0;

    for (let day = 0; day < 10 && !state.gameOver; day += 1) {
      game.endDay(state);
      expect(generator.tileAt(state.map, state.chaser.q, state.chaser.r), "day " + day).toBeTruthy();
    }
  });

  it("tells the player how close it feels, without giving a number", () => {
    const state = newGame("chase");

    expect(["near", "far"]).toContain(game.chaserProximity(state));
    expect(game.chaserProximity(newGame("lost"))).toBeNull();
  });

  it("stays out of sight until he is close enough to be seen", () => {
    const state = newGame("chase");

    expect(hex.distance(state.chaser, state.player)).toBeGreaterThan(game.visionRadiusFor(state));
    expect(game.chaserVisible(state)).toBe(false);

    // Put him under the player's nose and he shows up.
    state.chaser.q = state.player.q;
    state.chaser.r = state.player.r + 1;

    expect(game.chaserVisible(state)).toBe(true);
  });

  it("is not visible on ground the player merely explored yesterday", () => {
    const state = newGame("chase");
    for (const tile of state.map.tiles) tile.revealed = true;

    // Everything is on the map, but a person is only where the eyes reach.
    expect(game.chaserVisible(state)).toBe(false);
  });

  it("hides behind the fog when the weather closes in", () => {
    const clear = newGame("chase", { weather: "clear" });
    clear.player.orientation = 10;
    clear.chaser.q = clear.player.q + 3;
    clear.chaser.r = clear.player.r;
    expect(game.chaserVisible(clear)).toBe(true);

    const fog = newGame("chase", { weather: "fog" });
    fog.player.orientation = 10;
    fog.chaser.q = fog.player.q + 3;
    fog.chaser.r = fog.player.r;
    expect(game.chaserVisible(fog)).toBe(false);
  });

  it("writes a line the first time he comes into view", () => {
    const state = newGame("chase");

    for (let day = 0; day < 8 && !state.gameOver; day += 1) game.endDay(state);

    expect(game.chaserVisible(state) || state.gameOver).toBe(true);
    expect(state.log.filter((entry) => entry.key === "log.chase.sighted").length).toBe(1);
  });

  it("has nobody to see in a scenario without a hunter", () => {
    expect(game.chaserVisible(newGame("lost"))).toBe(false);
  });

  it("hunts the same way twice from the same seed", () => {
    function run() {
      const state = newGame("chase");
      for (let day = 0; day < 5 && !state.gameOver; day += 1) game.endDay(state);
      return state.chaser.q + "," + state.chaser.r;
    }

    expect(run()).toBe(run());
  });
});

describe("survival snapshots — WP-69 picking a run back up", () => {
  function playABit(scenarioId) {
    const state = newGame(scenarioId || "search");

    for (let turn = 0; turn < 3 && !state.gameOver; turn += 1) {
      for (const direction of hex.DIRECTIONS) {
        if (!state.gameOver) game.moveTo(state, state.player.q + direction.q, state.player.r + direction.r);
      }
      if (!state.gameOver) game.endDay(state);
    }
    return state;
  }

  it("stores what the player changed, not the map", () => {
    const state = playABit();
    const saved = snapshot.capture(state);

    expect(saved.map).toBeUndefined();
    expect(Array.isArray(saved.flags.revealed)).toBe(true);
    expect(JSON.stringify(saved).length).toBeLessThan(JSON.stringify(state).length / 5);
  });

  it("comes back the same run", () => {
    const state = playABit();
    const restored = snapshot.restore(JSON.parse(JSON.stringify(snapshot.capture(state))));

    expect(restored.day).toBe(state.day);
    expect(restored.rngState).toBe(state.rngState);
    expect(restored.weather).toBe(state.weather);
    expect(restored.player).toEqual(state.player);
    expect(restored.stats).toEqual(state.stats);
    expect(restored.log.length).toBe(state.log.length);
  });

  it("comes back on the same map, with the same ground seen", () => {
    const state = playABit();
    const restored = snapshot.restore(snapshot.capture(state));

    expect(restored.map.tiles.map((tile) => tile.type)).toEqual(state.map.tiles.map((tile) => tile.type));
    expect(restored.map.tiles.filter((tile) => tile.revealed).length).toBe(state.map.tiles.filter((tile) => tile.revealed).length);
    expect(restored.map.tiles.map((tile) => tile.marker)).toEqual(state.map.tiles.map((tile) => tile.marker));
  });

  it("carries on identically from where it was put down", () => {
    const state = playABit();
    const restored = snapshot.restore(snapshot.capture(state));

    game.endDay(state);
    game.endDay(restored);

    expect(restored.log.map((entry) => entry.text)).toEqual(state.log.map((entry) => entry.text));
    expect(restored.player).toEqual(state.player);
  });

  it("keeps the hunter where it was", () => {
    const state = playABit("chase");
    const restored = snapshot.restore(snapshot.capture(state));

    expect(restored.chaser).toEqual(state.chaser);
  });

  it("keeps a waiting question waiting", () => {
    const state = newGame("lost");
    game.triggerEvent(state, "abandonedPack");

    const restored = snapshot.restore(snapshot.capture(state));

    expect(restored.pendingChoice.eventId).toBe("abandonedPack");
    game.resolveChoice(restored, "take");
    expect(restored.pendingChoice).toBeNull();
  });

  it("comes back on the same size of map", () => {
    const state = game.createGame({ seed: 4, scenarioId: "lost", mapSize: "small", events: false, weather: "clear" });
    game.endDay(state);

    const restored = snapshot.restore(JSON.parse(JSON.stringify(snapshot.capture(state))));

    expect(restored.mapSize).toBe("small");
    expect(restored.map.width).toBe(config.MAP_SIZES.small.width);
    expect(restored.map.tiles.map((tile) => tile.type)).toEqual(state.map.tiles.map((tile) => tile.type));
  });

  it("shows the menu rather than a broken game for a save it cannot read", () => {
    expect(snapshot.restore(null)).toBeNull();
    expect(snapshot.restore({ v: 999, seed: 1 })).toBeNull();
  });
});
