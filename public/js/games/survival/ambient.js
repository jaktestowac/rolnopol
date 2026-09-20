/**
 * Rolnopol Survival — the noises off (PRD 8.13).
 *
 * Lines the journal writes that change nothing: a howl two valleys over, wind in
 * the pines, the smell of rain. They exist so a day of walking reads like a day
 * of walking rather than a list of coordinates.
 *
 * Two rules they hold to, both of them load-bearing:
 *
 * 1. No effects. An ambient line has no access to the player at all — this
 *    module returns a dictionary key and nothing else. That is what makes it
 *    safe to fire them often.
 *
 * 2. No dice. Whether one fires, and which one, is decided by hashing where the
 *    run is, not by drawing from the run's stream. A journal line must never
 *    shift the events of a seed, which is the same rule the message variants
 *    follow (PRD 6.17 and the WP-52 tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rng.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.ambient = factory(root.Survival.rng);
  }
})(typeof self !== "undefined" ? self : globalThis, function (rngModule) {
  "use strict";

  // How often the wild says something, by the moment it might say it.
  const CHANCE = { move: 0.3, dawn: 0.45 };

  /**
   * What a line can be about. Terrain and weather first, because those are what
   * the player is looking at; the general pool catches the rest.
   */
  const CONTEXTS = {
    terrain: ["forest", "swamp", "mountain", "river", "desert", "open"],
    weather: ["heat", "rain", "fog"],
  };

  /**
   * A number from the run's position rather than its dice. Same run, same day,
   * same number of lines written so far means the same result every replay.
   */
  function pick(state, salt) {
    return rngModule.normalizeSeed(state.seed + ":" + state.day + ":" + state.log.length + ":" + salt) / 4294967296;
  }

  /** Which pools this moment can draw from, most specific first. */
  function poolsFor(state, tile) {
    const pools = [];

    if (tile && CONTEXTS.terrain.includes(tile.type)) pools.push("ambient.terrain." + tile.type);
    if (CONTEXTS.weather.includes(state.weather)) pools.push("ambient.weather." + state.weather);
    pools.push("ambient.general");

    return pools;
  }

  /**
   * The key of a line to write now, or null for silence.
   *
   * @param {object} state
   * @param {object|null} tile     where the player is standing
   * @param {"move"|"dawn"} moment
   */
  function lineFor(state, tile, moment) {
    const chance = CHANCE[moment];
    if (chance === undefined) return null;
    if (pick(state, "ambient:" + moment) >= chance) return null;

    const pools = poolsFor(state, tile);
    const index = Math.floor(pick(state, "ambient:pool:" + moment) * pools.length);

    return pools[Math.min(index, pools.length - 1)];
  }

  return { lineFor, poolsFor, CHANCE, CONTEXTS };
});
