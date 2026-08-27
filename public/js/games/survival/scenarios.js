/**
 * Rolnopol Survival — scenarios (PRD 10, WP-12, WP-13, WP-30, WP-31, WP-32, WP-37).
 *
 * A scenario owns four things and nothing else: where the map comes from, what
 * gets placed on it, when the run is won, and when it is lost. The rest of the
 * game asks the scenario and never checks an id, so "walk out west" is an entry
 * in this table rather than an `if` in the turn loop.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./hex.js"),
      require("./map-generator.js"),
      require("./handmade-maps.js"),
      require("./markers.js"),
      require("./chaser.js"),
      require("./config.js"),
    );
  } else {
    root.Survival = root.Survival || {};
    root.Survival.scenarios = factory(
      root.Survival.hex,
      root.Survival.mapGenerator,
      root.Survival.handmadeMaps,
      root.Survival.markers,
      root.Survival.chaser,
      root.Survival.config,
    );
  }
})(typeof self !== "undefined" ? self : globalThis, function (hex, mapGenerator, handmadeMaps, markers, chaser, config) {
  "use strict";

  function playerTile(state) {
    return mapGenerator.tileAt(state.map, state.player.q, state.player.r);
  }

  function sidesUnderPlayer(state) {
    const tile = playerTile(state);
    return tile ? hex.edgeSides(tile, state.map.width, state.map.height) : [];
  }

  function diedOfExposure(state) {
    return state.player.health <= 0;
  }

  const SCENARIOS = {
    lost: {
      id: "lost",
      nameKey: "scenario.lost.name",
      descriptionKey: "scenario.lost.description",
      map: { source: "generated" },
      isWin(state) {
        return sidesUnderPlayer(state).length > 0;
      },
      isLoss: diedOfExposure,
    },

    // Same wild, one exit. The journey stops being "walk to the nearest border"
    // and starts being a route you have to hold to (WP-30).
    survival: {
      id: "survival",
      // Which borders count, for anything that needs to plan a route.
      targetSides: ["west"],
      nameKey: "scenario.survival.name",
      descriptionKey: "scenario.survival.description",
      map: { source: "generated" },
      isWin(state) {
        return sidesUnderPlayer(state).includes("west");
      },
      isLoss: diedOfExposure,
    },

    // Somebody is out there, and three of the four signs are wrong (WP-31).
    search: {
      id: "search",
      nameKey: "scenario.search.name",
      descriptionKey: "scenario.search.description",
      map: { source: "generated" },
      setup(state, rng) {
        markers.placeMarkers(state.map, rng, { decoys: 3 });
      },
      isWin(state) {
        return state.objective.foundTarget;
      },
      isLoss: diedOfExposure,
    },

    // Finding them is half of it. Carrying them out costs a point of movement
    // every day until you reach a border or a cabin (WP-32).
    rescue: {
      id: "rescue",
      nameKey: "scenario.rescue.name",
      descriptionKey: "scenario.rescue.description",
      map: { source: "generated" },
      carriesTarget: true,
      setup(state, rng) {
        markers.placeMarkers(state.map, rng, { decoys: 2 });
      },
      isWin(state) {
        if (!state.player.carryingNpc) return false;
        const tile = playerTile(state);
        return sidesUnderPlayer(state).length > 0 || (!!tile && tile.hasCabin);
      },
      isLoss: diedOfExposure,
    },

    // The pickup leaves on a fixed day. Same western ridge as Survival, with a
    // clock on it (WP-68).
    deadline: {
      id: "deadline",
      // Which borders count, for anything that needs to plan a route.
      targetSides: ["west"],
      nameKey: "scenario.deadline.name",
      descriptionKey: "scenario.deadline.description",
      map: { source: "generated" },
      dayLimit: 7,
      isWin(state) {
        return sidesUnderPlayer(state).includes("west");
      },
      isLoss(state) {
        return diedOfExposure(state) || state.day > SCENARIOS.deadline.dayLimit;
      },
      lossReason(state) {
        return diedOfExposure(state) ? "log.loss" : "log.deadline.missed";
      },
    },

    // Somebody is walking your trail (WP-66). Any border will do, if you get
    // there first.
    chase: {
      id: "chase",
      nameKey: "scenario.chase.name",
      descriptionKey: "scenario.chase.description",
      map: { source: "generated" },
      hasChaser: true,
      setup(state, rng) {
        chaser.place(state, rng);
      },
      isWin(state) {
        return sidesUnderPlayer(state).length > 0;
      },
      isLoss(state) {
        return diedOfExposure(state) || chaser.hasCaught(state);
      },
      lossReason(state) {
        return diedOfExposure(state) ? "log.loss" : "log.chase.caught";
      },
    },
  };

  /**
   * What a player has to have done before a scenario appears (PRD 8.18).
   *
   * Nothing. Every expedition is open from the first visit — that is a decided
   * product call, not an oversight, and 6.31 records why it was reversed.
   *
   * The table is kept rather than deleted because everything that reads it —
   * the menu cards, the progress endpoint, `isUnlocked` — already handles a
   * requirement being present. Putting one back is one line here and no change
   * anywhere else. An entry is `null` for "always open", or
   * `{ finished, wins }` for a rung.
   */
  const UNLOCKS = {
    lost: null,
    search: null,
    survival: null,
    deadline: null,
    rescue: null,
    chase: null,
  };

  /**
   * Which scenarios this player may start, in menu order.
   * @param {{finished: number, wins: number}} progress
   */
  function unlockedScenarios(progress) {
    const finished = (progress && progress.finished) || 0;
    const wins = (progress && progress.wins) || 0;

    return Object.keys(SCENARIOS).filter((id) => {
      const needed = UNLOCKS[id];
      if (!needed) return true;
      return finished >= (needed.finished || 0) && wins >= (needed.wins || 0);
    });
  }

  function isUnlocked(id, progress) {
    return unlockedScenarios(progress).includes(id);
  }

  function requirementFor(id) {
    return UNLOCKS[id] || null;
  }

  function getScenario(id) {
    return SCENARIOS[id] || null;
  }

  function listScenarios() {
    return Object.keys(SCENARIOS);
  }

  /**
   * Resolve the scenario's map source. The two branches are the whole point of
   * WP-37: swapping `source` in the definition above changes nothing else.
   */
  function buildMap(scenario, seed, mapSize) {
    const source = (scenario.map && scenario.map.source) || "generated";

    if (source === "handmade") {
      return handmadeMaps.getHandmadeMap(scenario.map.id);
    }
    if (source === "generated") {
      // A scenario may pin its own dimensions; otherwise the player's chosen
      // size decides, and that choice is recorded so the seed stays replayable.
      const preset = config.mapSizeOf(mapSize);
      return mapGenerator.generateMap({
        seed,
        width: (scenario.map && scenario.map.width) || preset.width,
        height: (scenario.map && scenario.map.height) || preset.height,
      });
    }
    throw new Error("Unknown map source: " + source);
  }

  return { SCENARIOS, UNLOCKS, getScenario, listScenarios, buildMap, unlockedScenarios, isUnlocked, requirementFor };
});
