/**
 * Rolnopol Survival — wounds that change how you move (PRD 8.16, faza E).
 *
 * Before this, a wound was a number: so much health off every night. The whole
 * point of the change is that a sprain now belongs in the route planning, and
 * the tests below are written to say exactly that and no more.
 *
 * The one thing checked hardest is the thing most likely to go wrong: a wound
 * must never leave a player with nothing legal to do. PRD 6.8 says walking into
 * a dead end cannot end the run silently, and a limp that blocks the forced
 * march would do precisely that.
 */
import { describe, it, expect } from "vitest";

const config = require("../../public/js/games/survival/config.js");
const game = require("../../public/js/games/survival/game.js");
const hex = require("../../public/js/games/survival/hex.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

function scenarioFrom(id, rows, start) {
  handmade.DEFINITIONS[id] = { id, rows, start };
  const base = scenarios.getScenario("lost");
  scenarios.SCENARIOS[id] = { ...base, id, map: { source: "handmade", id } };
  return id;
}

// Open ground with a ring of swamp round the middle, so the same step can be
// cheap or ruinous depending on what the walker is carrying.
const GROUND = scenarioFrom(
  "wound-ground",
  ["........", "........", "..ssss..", "..s..s..", "..s..s..", "..ssss..", "........", "........"],
  { col: 3, row: 3 },
);

// Nothing but swamp: every neighbour costs 4, which is what corners a player
// with a reduced allowance.
const MIRE = scenarioFrom("wound-mire", ["sssss", "sssss", "sssss", "sssss", "sssss"], { col: 2, row: 2 });

function newGame(id) {
  return game.createGame({ seed: 11, scenarioId: id || GROUND, difficulty: "normal", events: false, weather: "clear" });
}

function healthy() {
  return { health: 10, fatigue: 0, orientation: 10, conditions: [] };
}

function withCondition(id) {
  return { ...healthy(), conditions: [{ id, days: 2 }] };
}

describe("survival wounds — a sprain is a route problem (PRD 8.16)", () => {
  it("costs a movement point for the day", () => {
    expect(config.movementPointsFor(withCondition("sprain"))).toBe(config.movementPointsFor(healthy()) - 1);
  });

  it("makes rough ground rougher and leaves easy ground alone", () => {
    const swamp = { type: "swamp" };
    const open = { type: "open" };

    expect(config.movementCost(swamp, withCondition("sprain"))).toBe(config.movementCost(swamp, healthy()) + 1);
    expect(config.movementCost(open, withCondition("sprain"))).toBe(config.movementCost(open, healthy()));
  });

  it("leaves a road a road", () => {
    // The surcharge is meant to push a limping player onto the trails, so a
    // trail that also charged it would be pushing them nowhere.
    const trail = { type: "mountain", hasTrail: true };
    const ford = { type: "river", hasFord: true };

    expect(config.movementCost(trail, withCondition("sprain"))).toBe(1);
    expect(config.movementCost(ford, withCondition("sprain"))).toBe(1);
  });

  it("charges nothing to a walker nobody asked about", () => {
    // Map generation and the guide call this without a player. Both want what
    // the ground costs, not what it costs somebody in particular.
    for (const type of Object.keys(config.TERRAIN)) {
      expect(config.movementCost({ type })).toBe(config.movementCost({ type }, healthy()));
    }
  });
});

describe("survival wounds — a fever narrows the world (PRD 8.16)", () => {
  it("takes a step off the sight radius", () => {
    expect(config.visionRadius(withCondition("fever"))).toBe(config.visionRadius(healthy()) - 1);
  });

  it("never blinds completely", () => {
    const lost = { ...withCondition("fever"), orientation: 0 };
    expect(config.visionRadius(lost)).toBeGreaterThanOrEqual(1);
  });

  it("uncovers less of the map than the same walk taken well", () => {
    const well = newGame();
    const ill = newGame();
    game.addCondition(ill, "fever");

    const seen = (state) => state.map.tiles.filter((tile) => tile.revealed).length;
    const before = { well: seen(well), ill: seen(ill) };

    game.revealAround(well);
    game.revealAround(ill);

    expect(seen(well) - before.well).toBeGreaterThanOrEqual(seen(ill) - before.ill);
  });
});

describe("survival wounds — the way out is dearer, never shut (PRD 6.8, 8.16)", () => {
  it("still offers a forced march to a player who cannot afford a step", () => {
    const state = newGame(MIRE);
    game.addCondition(state, "sprain");
    state.movementLeft = 1;

    expect(game.affordableNeighbours(state)).toEqual([]);
    expect(game.forcedMarchTarget(state)).not.toBeNull();
  });

  it("charges the wound on top of the march", () => {
    const whole = newGame(MIRE);
    const hurt = newGame(MIRE);
    game.addCondition(hurt, "sprain");

    whole.movementLeft = 1;
    hurt.movementLeft = 1;
    const before = { whole: whole.player.health, hurt: hurt.player.health };

    game.forcedMarch(whole);
    game.forcedMarch(hurt);

    const paid = {
      whole: before.whole - whole.player.health,
      hurt: before.hurt - hurt.player.health,
    };
    expect(paid.hurt).toBe(paid.whole + config.CONDITIONS.sprain.forcedMarchHealth);
  });

  it("never corners a wounded player on ground a healthy one could cross", () => {
    // Every wound the game can hand out, on the worst ground it can hand it out
    // on: there has to be a legal move at the start of every one of those days.
    for (const id of Object.keys(config.CONDITIONS)) {
      const state = newGame(MIRE);
      game.addCondition(state, id);
      state.movementLeft = config.movementPointsFor(state.player);

      const canStep = game.affordableNeighbours(state).length > 0;
      const canForce = game.forcedMarchTarget(state) !== null;
      expect(canStep || canForce, id + " leaves nothing to do").toBe(true);
    }
  });
});

describe("survival wounds — the rules and the page read one table", () => {
  it("knows which wounds do more than tick", () => {
    expect(config.conditionChangesMovement("sprain")).toBe(true);
    expect(config.conditionChangesMovement("fever")).toBe(true);
    expect(config.conditionChangesMovement("dysentery")).toBe(false);
    expect(config.conditionChangesMovement("nothing-like-it")).toBe(false);
  });

  it("adds up what a player is carrying, rather than taking the worst of it", () => {
    const both = {
      ...healthy(),
      conditions: [
        { id: "sprain", days: 1 },
        { id: "bitten", days: 1 },
      ],
    };
    const effects = config.conditionEffects(both);

    expect(effects.forcedMarchHealth).toBe(config.CONDITIONS.sprain.forcedMarchHealth + config.CONDITIONS.bitten.forcedMarchHealth);
    expect(effects.movement).toBe(-1);
  });

  it("ignores a wound it has never heard of", () => {
    const effects = config.conditionEffects({ conditions: [{ id: "moon-sickness", days: 3 }] });
    expect(effects).toEqual({ movement: 0, vision: 0, roughSurcharge: 0, forcedMarchHealth: 0 });
  });

  it("counts a wound taken, so the record can talk about it", () => {
    const state = newGame();
    expect(state.stats.woundsTaken).toBe(0);

    game.addCondition(state, "fever");
    game.addCondition(state, "fever");
    expect(state.stats.woundsTaken, "catching the same thing twice is one wound").toBe(1);

    game.addCondition(state, "sprain");
    expect(state.stats.woundsTaken).toBe(2);
  });

  it("moves a limping player for what the panel says it will cost", () => {
    const state = newGame();
    game.addCondition(state, "sprain");

    const target = state.map.tiles.find((tile) => tile.type === "swamp" && hex.areNeighbors(state.player, tile));
    expect(target, "the fixture puts swamp next to the start").toBeTruthy();

    const quoted = config.movementCost(target, state.player);
    state.movementLeft = quoted;
    const answer = game.moveTo(state, target.q, target.r);

    expect(answer.ok).toBe(true);
    expect(answer.cost).toBe(quoted);
    expect(state.movementLeft).toBe(0);
  });
});
