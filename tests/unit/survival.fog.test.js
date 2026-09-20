/**
 * Rolnopol Survival — fog of war and studying the map (PRD WP-28, WP-29).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

const ROWS = [];
for (let row = 0; row < 11; row += 1) ROWS.push(".".repeat(11));

handmade.DEFINITIONS["fog-plain"] = { id: "fog-plain", rows: ROWS, start: { col: 5, row: 5 } };
scenarios.SCENARIOS["fog-plain"] = {
  ...scenarios.getScenario("lost"),
  id: "fog-plain",
  map: { source: "handmade", id: "fog-plain" },
};

function newGame(options) {
  return game.createGame({ seed: 1, scenarioId: "fog-plain", difficulty: "normal", events: false, weather: "clear", ...(options || {}) });
}

function revealedCount(state) {
  return state.map.tiles.filter((tile) => tile.revealed).length;
}

function tilesWithin(state, radius) {
  return state.map.tiles.filter((tile) => hex.distance(tile, state.player) <= radius).length;
}

describe("survival fog — WP-28 what the player can see", () => {
  it("starts with everything hidden but the ground around the player", () => {
    const state = newGame();

    expect(revealedCount(state)).toBe(tilesWithin(state, config.visionRadius(state.player)));
    expect(revealedCount(state)).toBeLessThan(state.map.tiles.length);
  });

  it("reads the radius off the player's bearings", () => {
    expect(config.visionRadius({ orientation: 0 })).toBe(1);
    expect(config.visionRadius({ orientation: 3 })).toBe(1);
    expect(config.visionRadius({ orientation: 4 })).toBe(2);
    expect(config.visionRadius({ orientation: 7 })).toBe(2);
    expect(config.visionRadius({ orientation: 8 })).toBe(3);
    expect(config.visionRadius({ orientation: 10 })).toBe(3);
  });

  it("sees further with better bearings", () => {
    const clear = newGame();
    clear.player.orientation = 10;
    game.revealAround(clear);

    const lost = newGame();
    lost.player.orientation = 1;
    game.revealAround(lost);

    expect(revealedCount(clear)).toBeGreaterThan(revealedCount(lost));
  });

  it("uncovers new ground as the player walks", () => {
    const state = newGame();
    const before = revealedCount(state);

    const east = hex.offsetToAxial(6, 5);
    game.moveTo(state, east.q, east.r);

    expect(revealedCount(state)).toBeGreaterThan(before);
  });

  it("never covers ground back up", () => {
    const state = newGame();
    const east = hex.offsetToAxial(6, 5);
    game.moveTo(state, east.q, east.r);
    const seen = state.map.tiles.filter((tile) => tile.revealed).map((tile) => hex.key(tile.q, tile.r));

    // Bearings collapse, the player walks back, and the map keeps what it knew.
    state.player.orientation = 0;
    const back = hex.offsetToAxial(5, 5);
    game.moveTo(state, back.q, back.r);

    const stillSeen = new Set(state.map.tiles.filter((tile) => tile.revealed).map((tile) => hex.key(tile.q, tile.r)));
    expect(seen.every((key) => stillSeen.has(key))).toBe(true);
  });

  it("always shows the six hexes a player could step onto", () => {
    const state = newGame();
    state.player.orientation = 0;
    game.revealAround(state);

    for (const spot of hex.neighbors(state.player.q, state.player.r)) {
      const tile = game.tileAt(state, spot.q, spot.r);
      if (tile) expect(tile.revealed, `neighbour ${spot.q},${spot.r} is hidden`).toBe(true);
    }
  });
});

describe("survival fog — WP-29 studying the map", () => {
  it("buys bearings and a look around for two movement", () => {
    const state = newGame();
    const before = { orientation: state.player.orientation, revealed: revealedCount(state) };

    const answer = game.checkMap(state);

    expect(answer.ok).toBe(true);
    expect(state.movementLeft).toBe(6 - config.CHECK_MAP.cost);
    expect(state.player.orientation).toBe(before.orientation + config.CHECK_MAP.orientationGain);
    expect(revealedCount(state)).toBeGreaterThanOrEqual(before.revealed);
  });

  it("uncovers a full two hexes out even from bad bearings", () => {
    const state = newGame();
    state.player.orientation = 0;

    game.checkMap(state);

    expect(revealedCount(state)).toBe(tilesWithin(state, config.CHECK_MAP.revealRadius));
  });

  it("keeps what it uncovered after the player moves on", () => {
    const state = newGame();
    game.checkMap(state);
    const seen = revealedCount(state);

    const east = hex.offsetToAxial(6, 5);
    game.moveTo(state, east.q, east.r);

    expect(revealedCount(state)).toBeGreaterThanOrEqual(seen);
  });

  it("refuses when the day cannot pay for it", () => {
    const state = newGame();
    state.movementLeft = 1;

    const answer = game.checkMap(state);

    expect(answer.ok).toBe(false);
    expect(state.player.orientation).toBe(config.START.orientation);
  });

  it("cannot push bearings past their ceiling", () => {
    const state = newGame();
    state.player.orientation = config.RESOURCES.orientation.max;

    game.checkMap(state);

    expect(state.player.orientation).toBe(config.RESOURCES.orientation.max);
  });
});
