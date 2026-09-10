/**
 * Rolnopol Survival — the four expeditions (PRD WP-12, WP-30, WP-31, WP-32).
 */
import { describe, it, expect } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const config = require("../../public/js/games/survival/config.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const markers = require("../../public/js/games/survival/markers.js");
const generator = require("../../public/js/games/survival/map-generator.js");
const strings = require("../../public/js/games/survival/strings.js");

function newGame(scenarioId, seed) {
  return game.createGame({ seed: seed || 11, scenarioId, difficulty: "normal", events: false });
}

/** Put the player on a tile without walking there, then settle the outcome. */
function teleport(state, col, row) {
  const axial = hex.offsetToAxial(col, row);
  state.player.q = axial.q;
  state.player.r = axial.r;
}

function scenarioOf(state) {
  return scenarios.getScenario(state.scenarioId);
}

function markedTiles(state) {
  return state.map.tiles.filter((tile) => tile.marker);
}

describe("survival scenarios — the shipped six", () => {
  it("registers all six, each with its own text", () => {
    expect(scenarios.listScenarios().sort()).toEqual(["chase", "deadline", "lost", "rescue", "search", "survival"]);

    for (const id of scenarios.listScenarios()) {
      const scenario = scenarios.getScenario(id);
      expect(strings.has(scenario.nameKey), id + " has no name").toBe(true);
      expect(strings.has(scenario.descriptionKey), id + " has no description").toBe(true);
    }
  });

  it("loses every expedition the same way: at zero health", () => {
    for (const id of scenarios.listScenarios()) {
      const state = newGame(id);
      state.player.health = 0;
      expect(scenarios.getScenario(id).isLoss(state), id).toBe(true);
    }
  });

  it("fills the description of every scenario, day limits included", () => {
    for (const id of scenarios.listScenarios()) {
      const scenario = scenarios.getScenario(id);
      const text = strings.t(scenario.descriptionKey, { days: scenario.dayLimit });
      expect(text, id + " has an unfilled placeholder").not.toContain("{");
    }
  });
});

describe("survival scenarios — WP-12 Lost", () => {
  it("ends at any border", () => {
    const state = newGame("lost");

    teleport(state, 0, 10);
    expect(scenarioOf(state).isWin(state)).toBe(true);

    teleport(state, state.map.width - 1, 10);
    expect(scenarioOf(state).isWin(state)).toBe(true);
  });
});

describe("survival scenarios — WP-30 Survival", () => {
  it("ends at the western border", () => {
    const state = newGame("survival");
    teleport(state, 0, 12);
    expect(scenarioOf(state).isWin(state)).toBe(true);
  });

  it("does not end at the eastern one", () => {
    const state = newGame("survival");
    teleport(state, state.map.width - 1, 12);
    expect(scenarioOf(state).isWin(state)).toBe(false);
  });

  it("does not end in the middle either", () => {
    const state = newGame("survival");
    teleport(state, 12, 12);
    expect(scenarioOf(state).isWin(state)).toBe(false);
  });
});

describe("survival scenarios — WP-31 Search", () => {
  it("puts one person and three false leads on the map", () => {
    const state = newGame("search");
    const marked = markedTiles(state);

    expect(marked).toHaveLength(4);
    expect(marked.filter((tile) => tile.marker === "npc")).toHaveLength(1);
    expect(marked.filter((tile) => tile.marker === "decoy")).toHaveLength(3);
  });

  it("keeps every marker reachable and away from the doorstep", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = game.createGame({ seed, scenarioId: "search", difficulty: "normal", events: false });
      const start = generator.tileAt(state.map, state.map.start.q, state.map.start.r);
      const reachable = new Set(generator.reachableFrom(state.map, start).map((tile) => hex.key(tile.q, tile.r)));

      for (const tile of markedTiles(state)) {
        expect(reachable.has(hex.key(tile.q, tile.r)), `seed ${seed}: marker is cut off`).toBe(true);
        expect(hex.distance(tile, start), `seed ${seed}: marker is on the doorstep`).toBeGreaterThanOrEqual(
          config.MARKERS.minDistanceFromStart,
        );
      }
    }
  });

  it("rubs a false lead off the map and says so", () => {
    const state = newGame("search");
    const decoy = markedTiles(state).find((tile) => tile.marker === "decoy");

    const kind = game.inspectMarker(state, decoy);

    expect(kind).toBe("decoy");
    expect(decoy.marker).toBeNull();
    expect(state.objective.foundTarget).toBe(false);
    expect(state.log[state.log.length - 1].key).toBe("log.marker.decoy");
  });

  it("checks a lead once and never again", () => {
    const state = newGame("search");
    const decoy = markedTiles(state).find((tile) => tile.marker === "decoy");

    game.inspectMarker(state, decoy);
    expect(game.inspectMarker(state, decoy)).toBeNull();
    expect(state.objective.inspected).toBe(1);
  });

  it("ends the moment the real one is found", () => {
    const state = newGame("search");
    const target = markedTiles(state).find((tile) => tile.marker === "npc");

    expect(scenarioOf(state).isWin(state)).toBe(false);
    game.inspectMarker(state, target);

    expect(state.objective.foundTarget).toBe(true);
    expect(scenarioOf(state).isWin(state)).toBe(true);
    expect(state.player.carryingNpc).toBe(false);
  });
});

describe("survival scenarios — WP-32 Rescue", () => {
  it("puts one person and two false leads on the map", () => {
    const state = newGame("rescue");
    const marked = markedTiles(state);

    expect(marked).toHaveLength(3);
    expect(marked.filter((tile) => tile.marker === "npc")).toHaveLength(1);
  });

  it("does not end when the survivor is found, only picked up", () => {
    const state = newGame("rescue");
    const target = markedTiles(state).find((tile) => tile.marker === "npc");

    game.inspectMarker(state, target);

    expect(state.player.carryingNpc).toBe(true);
    expect(scenarioOf(state).isWin(state)).toBe(false);
    expect(state.log.some((entry) => entry.key === "log.marker.carrying")).toBe(true);
  });

  it("costs a movement point a day to carry them", () => {
    const state = newGame("rescue");
    const before = config.movementPointsFor(state.player);

    state.player.carryingNpc = true;

    expect(config.movementPointsFor(state.player)).toBe(before - config.MOVEMENT.carryingNpcPenalty);
    expect(before).toBe(config.MOVEMENT.base);
  });

  it("ends at a border with the survivor, and not without them", () => {
    const state = newGame("rescue");
    teleport(state, 0, 12);

    expect(scenarioOf(state).isWin(state)).toBe(false);

    state.player.carryingNpc = true;
    expect(scenarioOf(state).isWin(state)).toBe(true);
  });

  it("ends at a cabin too", () => {
    const state = newGame("rescue");
    const cabin = state.map.tiles.find((tile) => tile.hasCabin);

    state.player.carryingNpc = true;
    teleport(state, cabin.col, cabin.row);

    expect(scenarioOf(state).isWin(state)).toBe(true);
  });
});

describe("survival scenarios — markers stay reproducible", () => {
  it("places the same markers for the same seed", () => {
    const first = newGame("search", 777);
    const second = newGame("search", 777);

    const positions = (state) =>
      markedTiles(state)
        .map((tile) => tile.marker + "@" + tile.col + "," + tile.row)
        .sort();

    expect(positions(second)).toEqual(positions(first));
  });

  it("places different markers for a different seed", () => {
    const a = newGame("search", 100);
    const b = newGame("search", 200);

    const positions = (state) =>
      markedTiles(state)
        .map((tile) => tile.col + "," + tile.row)
        .sort()
        .join("|");

    expect(positions(a)).not.toBe(positions(b));
  });

  it("spreads markers out rather than stacking them", () => {
    const state = newGame("search", 42);
    const marked = markedTiles(state);

    for (let i = 0; i < marked.length; i += 1) {
      for (let j = i + 1; j < marked.length; j += 1) {
        expect(hex.distance(marked[i], marked[j])).toBeGreaterThanOrEqual(config.MARKERS.minSpacing);
      }
    }
  });

  it("leaves the generated map alone when nothing asks for markers", () => {
    const state = newGame("lost");
    expect(markedTiles(state)).toHaveLength(0);
  });

  it("still places a target on a map with barely any room", () => {
    const map = generator.generateMap({ seed: 3 });
    const rng = require("../../public/js/games/survival/rng.js").createRng(3);

    const placed = markers.placeMarkers(map, rng, { decoys: 12 });

    expect(placed.target).toBeTruthy();
    expect(placed.decoys.length).toBeGreaterThan(0);
  });
});
