/**
 * Rolnopol Survival — seeded random number generator (PRD WP-16).
 *
 * The whole game is reproducible from one seed: the map, the starting tile and
 * every roll. The platform's unseeded generator must never appear anywhere in
 * game code — a unit test greps for it — otherwise two runs of the same seed
 * diverge and both the balance bot and bug reports become worthless.
 *
 * Algorithm: mulberry32. 32 bits of state, one multiply-xor round, good enough
 * for a survival prototype and short enough to audit at a glance.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.rng = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /**
   * Turn any seed into a 32-bit unsigned integer.
   * Numbers are truncated, everything else goes through FNV-1a so that
   * "expedition-7" is a usable seed too.
   */
  function normalizeSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) {
      return Math.abs(Math.trunc(seed)) >>> 0;
    }

    const text = String(seed == null ? "" : seed);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Create an independent generator. Two generators built from the same seed
   * produce the same sequence.
   */
  function createRng(seed) {
    const initial = normalizeSeed(seed);
    let state = initial === 0 ? 1 : initial;

    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      seed: initial,

      /** Float in [0, 1). */
      next,

      /** Integer in [0, maxExclusive). */
      int(maxExclusive) {
        if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
        return Math.floor(next() * maxExclusive);
      },

      /** Integer in [min, max], both inclusive. */
      range(min, max) {
        if (max < min) return min;
        return min + Math.floor(next() * (max - min + 1));
      },

      /** True with the given probability. */
      chance(probability) {
        return next() < probability;
      },

      /** Uniformly pick one element. Returns undefined for an empty list. */
      pick(list) {
        if (!Array.isArray(list) || list.length === 0) return undefined;
        return list[Math.floor(next() * list.length)];
      },

      /** Fisher-Yates, in place, so callers own the copy decision. */
      shuffle(list) {
        for (let i = list.length - 1; i > 0; i -= 1) {
          const j = Math.floor(next() * (i + 1));
          const tmp = list[i];
          list[i] = list[j];
          list[j] = tmp;
        }
        return list;
      },

      /**
       * A related but independent generator. Used for generator retries, so
       * attempt 2 of seed 42 is deterministic without colliding with seed 43.
       */
      derive(salt) {
        return createRng(normalizeSeed(String(initial) + ":" + String(salt)));
      },

      /**
       * The whole generator is one 32-bit number, so a run can carry its
       * position in the stream inside plain serialisable state instead of
       * holding a live object (PRD 9.1).
       */
      snapshot() {
        return state;
      },

      restore(value) {
        state = value >>> 0 === 0 ? 1 : value >>> 0;
        return state;
      },
    };
  }

  return { createRng, normalizeSeed };
});
