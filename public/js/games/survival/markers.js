/**
 * Rolnopol Survival — placing the people you are looking for (PRD 6.11, WP-31, WP-32).
 *
 * The PRD calls for hand-drawn maps in the search and rescue scenarios, and
 * gives the reason: markers scattered over random ground produce a target in a
 * corner behind a wall of swamp. That reason is about *placement*, not terrain,
 * so this module solves it directly — the map still comes from the seed, and
 * markers are placed under rules that a corner-behind-a-swamp cannot satisfy:
 *
 *   - only on ground the player can actually walk to from the start,
 *   - never closer to the start than `minDistanceFromStart`,
 *   - never within `minSpacing` of another marker.
 *
 * The hand-drawn route stays open: a scenario that names a map from the
 * registry keeps whatever markers that map carries (WP-37).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./hex.js"), require("./config.js"), require("./map-generator.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.markers = factory(root.Survival.hex, root.Survival.config, root.Survival.mapGenerator);
  }
})(typeof self !== "undefined" ? self : globalThis, function (hex, config, mapGenerator) {
  "use strict";

  /**
   * Tiles worth putting a marker on: reachable, far enough out to be a journey,
   * and not a swamp nobody would stand in.
   */
  function candidates(map, start) {
    const settings = config.MARKERS;
    const reachable = mapGenerator.reachableFrom(map, start);

    return reachable.filter((tile) => {
      if (tile.type === "swamp" || tile.type === "river") return false;
      if (config.movementCost(tile) > settings.reachableCostLimit) return false;
      return hex.distance(tile, start) >= settings.minDistanceFromStart;
    });
  }

  function farEnoughFromPlaced(tile, placed) {
    return placed.every((other) => hex.distance(tile, other) >= config.MARKERS.minSpacing);
  }

  /**
   * Put one target and a number of false leads on the map.
   * Returns the tiles it marked, target first, so a scenario can remember where
   * the real one is without searching the map again.
   *
   * If the rules cannot be met — a cramped map, too many markers — spacing is
   * relaxed before anything else, because a marker that never gets placed is a
   * scenario that cannot be won.
   */
  function placeMarkers(map, rng, options) {
    const settings = options || {};
    const decoyCount = settings.decoys === undefined ? 3 : settings.decoys;
    const start = mapGenerator.tileAt(map, map.start.q, map.start.r);
    const pool = rng.shuffle(candidates(map, start));
    const placed = [];

    function take(kind, respectSpacing) {
      const tile = pool.find((candidate) => !candidate.marker && (!respectSpacing || farEnoughFromPlaced(candidate, placed)));
      if (!tile) return null;

      tile.marker = kind;
      tile.markerInspected = false;
      placed.push(tile);
      return tile;
    }

    const target = take("npc", true) || take("npc", false);
    if (!target) return { target: null, decoys: [] };

    const decoys = [];
    for (let i = 0; i < decoyCount; i += 1) {
      const decoy = take("decoy", true) || take("decoy", false);
      if (decoy) decoys.push(decoy);
    }

    return { target, decoys };
  }

  return { placeMarkers, candidates };
});
