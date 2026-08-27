/**
 * Rolnopol Survival — saving a run so it can be picked up again (WP-69).
 *
 * The `snapshot` field has been sitting empty in the expedition record since
 * release 1 (PRD 9.2). This is what fills it.
 *
 * It does not store the map. The map comes from the seed, and so do the marker
 * placements and where the hunter started, so all a snapshot has to carry is
 * what the player has *changed*: which hexes they have seen, walked, searched
 * and used up. Those are lists of tile indices, a few hundred numbers rather
 * than 576 objects — which is the same argument PRD 6.12 makes for keeping the
 * record small.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./game.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.snapshot = factory(root.Survival.game);
  }
})(typeof self !== "undefined" ? self : globalThis, function (game) {
  "use strict";

  const VERSION = 2;

  // Saves this build can still open. Version 1 predates the route trace and the
  // extra counters (PRD 8.17): it is read by filling those in, which is what the
  // quality-debt note in 8.14 asked for the first time the shape moved.
  const READABLE = [1, 2];

  // Counters a version 1 save has never heard of. Spread over whatever it does
  // carry, so a restored run adds to a number instead of to `undefined`.
  const DEFAULT_STATS = { hexesTravelled: 0, eventsSeen: 0, forcedMarches: 0, trailHexes: 0, camps: 0, cabinsUsed: 0, woundsTaken: 0 };

  // Tile flags a player can turn on but never off. Restoring is a matter of
  // switching these back on for the indices the snapshot lists.
  const TILE_FLAGS = [
    "revealed",
    "visited",
    "searchedWater",
    "searchedFood",
    "cabinUsed",
    "springUsed",
    "forageUsed",
    "markerInspected",
    "hasTrail",
  ];

  function indicesWhere(tiles, flag) {
    const found = [];
    tiles.forEach((tile, index) => {
      if (tile[flag]) found.push(index);
    });
    return found;
  }

  /** Everything that cannot be worked out again from the seed. */
  function capture(state) {
    const flags = {};
    for (const flag of TILE_FLAGS) flags[flag] = indicesWhere(state.map.tiles, flag);

    // A false lead the player has already dismissed is gone from the map, and
    // regenerating from the seed would put it back.
    const clearedMarkers = [];
    state.map.tiles.forEach((tile, index) => {
      if (tile.markerInspected && !tile.marker) clearedMarkers.push(index);
    });

    return {
      v: VERSION,
      seed: state.seed,
      scenarioId: state.scenarioId,
      difficulty: state.difficulty,
      mapSize: state.mapSize,
      eventsEnabled: state.eventsEnabled,
      forcedWeather: state.forcedWeather,
      day: state.day,
      movementLeft: state.movementLeft,
      spentToday: state.spentToday,
      spentOffTrail: state.spentOffTrail,
      rngState: state.rngState,
      weather: state.weather,
      player: { ...state.player, conditions: state.player.conditions.map((condition) => ({ ...condition })) },
      stats: { ...state.stats },
      route: state.route || [],
      objective: { ...state.objective },
      scheduled: state.scheduled.map((entry) => ({ ...entry })),
      pendingChoice: state.pendingChoice,
      chaser: state.chaser ? { ...state.chaser, estimate: { ...state.chaser.estimate } } : null,
      campfireTonight: state.campfireTonight,
      cheatsUsed: !!state.cheatsUsed,
      gameOver: state.gameOver,
      result: state.result,
      log: state.log,
      flags,
      clearedMarkers,
    };
  }

  /**
   * Rebuild the run. The map, the markers and the hunter's starting hex all come
   * back from the seed; the snapshot only has to say what happened since.
   *
   * Returns null for a snapshot this build cannot read, so an old save shows the
   * menu rather than a broken game.
   */
  function restore(snapshot) {
    if (!snapshot || !READABLE.includes(snapshot.v)) return null;

    const state = game.createGame({
      seed: snapshot.seed,
      scenarioId: snapshot.scenarioId,
      difficulty: snapshot.difficulty,
      mapSize: snapshot.mapSize,
      events: snapshot.eventsEnabled !== false,
      weather: snapshot.forcedWeather || undefined,
    });

    state.day = snapshot.day;
    state.movementLeft = snapshot.movementLeft;
    state.spentToday = snapshot.spentToday;
    state.spentOffTrail = snapshot.spentOffTrail || 0;
    state.rngState = snapshot.rngState;
    state.weather = snapshot.weather;
    state.player = { ...snapshot.player, conditions: (snapshot.player.conditions || []).map((c) => ({ ...c })) };
    state.stats = { ...DEFAULT_STATS, ...snapshot.stats };
    // A version 1 save has no route. The run picks one up from where it stands
    // rather than pretending to remember one it never recorded.
    state.route = Array.isArray(snapshot.route) && snapshot.route.length ? snapshot.route.slice() : [snapshot.player.q, snapshot.player.r];
    state.objective = { ...snapshot.objective };
    state.scheduled = (snapshot.scheduled || []).map((entry) => ({ ...entry }));
    state.pendingChoice = snapshot.pendingChoice || null;
    state.chaser = snapshot.chaser ? { ...snapshot.chaser, estimate: { ...snapshot.chaser.estimate } } : null;
    state.campfireTonight = !!snapshot.campfireTonight;
    state.cheatsUsed = !!snapshot.cheatsUsed;
    state.gameOver = !!snapshot.gameOver;
    state.result = snapshot.result || null;
    state.log = snapshot.log || [];

    // The freshly generated map knows nothing yet, so start it blank and switch
    // on only what the snapshot recorded.
    for (const tile of state.map.tiles) {
      for (const flag of TILE_FLAGS) tile[flag] = false;
    }
    for (const flag of TILE_FLAGS) {
      for (const index of (snapshot.flags && snapshot.flags[flag]) || []) {
        const tile = state.map.tiles[index];
        if (tile) tile[flag] = true;
      }
    }
    for (const index of snapshot.clearedMarkers || []) {
      const tile = state.map.tiles[index];
      if (tile) tile.marker = null;
    }

    return state;
  }

  return { capture, restore, VERSION, READABLE, DEFAULT_STATS, TILE_FLAGS };
});
