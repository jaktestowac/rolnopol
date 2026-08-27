/**
 * Rolnopol Survival — the hunter (PRD 10.5, WP-66).
 *
 * The chase was kept out of three releases for one reason: it needs a model of
 * what the other side knows. That model is this file, and it is deliberately
 * small.
 *
 * The hunter never sees the player. Each day it guesses where they are, off by
 * a few hexes, and walks towards the guess on its own movement budget. The size
 * of the error comes from the player's own bearings, which reads oddly until you
 * say it out loud: someone who knows exactly where they are moves in a straight
 * line and is easy to follow, while someone lost wanders and leaves a trail that
 * makes no sense.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./hex.js"), require("./config.js"), require("./map-generator.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.chaser = factory(root.Survival.hex, root.Survival.config, root.Survival.mapGenerator);
  }
})(typeof self !== "undefined" ? self : globalThis, function (hex, config, mapGenerator) {
  "use strict";

  /** How far the hunter's guess can be off, by the player's bearings. */
  function errorFor(orientation) {
    const step = config.CHASE.errorByOrientation.find((entry) => orientation >= entry.orientation);
    return step ? step.error : config.CHASE.errorByOrientation[config.CHASE.errorByOrientation.length - 1].error;
  }

  function passable(tile) {
    return !!tile && config.movementCost(tile) <= config.CHASE.movement;
  }

  /**
   * Put the hunter on the map, a set distance behind the player and on ground it
   * can actually walk off. Falls back to the furthest passable tile it can find,
   * because a chase scenario with no chaser is not a scenario.
   */
  function place(state, rng) {
    const wanted = config.CHASE.startDistance;
    const candidates = state.map.tiles.filter((tile) => passable(tile) && hex.distance(tile, state.player) === wanted);

    const pool = candidates.length
      ? candidates
      : state.map.tiles.filter(passable).sort((a, b) => hex.distance(b, state.player) - hex.distance(a, state.player));

    const spot = candidates.length ? candidates[rng.int(candidates.length)] : pool[0];
    if (!spot) return null;

    state.chaser = { q: spot.q, r: spot.r, estimate: { q: state.player.q, r: state.player.r } };
    return state.chaser;
  }

  /** Redraw the guess: the player's real hex, pushed off by the day's error. */
  function guess(state, roll) {
    const error = errorFor(state.player.orientation);
    let q = state.player.q;
    let r = state.player.r;

    for (let step = 0; step < error; step += 1) {
      const direction = hex.DIRECTIONS[Math.floor(roll() * hex.DIRECTIONS.length)];
      q += direction.q;
      r += direction.r;
    }

    // A guess off the map is no guess at all; fall back to the last known hex.
    const tile = mapGenerator.tileAt(state.map, q, r);
    return tile ? { q, r } : { q: state.player.q, r: state.player.r };
  }

  /**
   * One day of pursuit: guess, then walk towards the guess until the budget runs
   * out. The hunter pays the same terrain costs the player does, so a swamp
   * between you and it is worth as much as a day of walking.
   */
  function advance(state, roll) {
    if (!state.chaser) return null;

    state.chaser.estimate = guess(state, roll);
    let budget = config.CHASE.movement;

    while (budget > 0) {
      const here = { q: state.chaser.q, r: state.chaser.r };
      const options = hex
        .neighbors(here.q, here.r)
        .map((spot) => mapGenerator.tileAt(state.map, spot.q, spot.r))
        .filter((tile) => tile && config.movementCost(tile) <= budget);

      if (options.length === 0) break;

      options.sort((a, b) => {
        const byDistance = hex.distance(a, state.chaser.estimate) - hex.distance(b, state.chaser.estimate);
        if (byDistance !== 0) return byDistance;
        const byCost = config.movementCost(a) - config.movementCost(b);
        if (byCost !== 0) return byCost;
        return hex.key(a.q, a.r).localeCompare(hex.key(b.q, b.r));
      });

      const step = options[0];
      // Standing still beats walking away from the guess.
      if (hex.distance(step, state.chaser.estimate) >= hex.distance(here, state.chaser.estimate)) break;

      budget -= config.movementCost(step);
      state.chaser.q = step.q;
      state.chaser.r = step.r;
    }

    return state.chaser;
  }

  function hasCaught(state) {
    return !!state.chaser && state.chaser.q === state.player.q && state.chaser.r === state.player.r;
  }

  /** How close it feels, for the panel. Not the exact distance: this is a hunt. */
  function proximity(state) {
    if (!state.chaser) return null;
    return hex.distance(state.chaser, state.player) <= 3 ? "near" : "far";
  }

  return { place, advance, guess, hasCaught, proximity, errorFor };
});
