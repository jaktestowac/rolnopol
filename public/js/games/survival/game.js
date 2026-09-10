/**
 * Rolnopol Survival — the turn loop (PRD 7, WP-04 to WP-16).
 *
 * Pure state in, pure state out. Nothing here touches the DOM, the network or
 * the clock, which is what lets the same file run under vitest and in the
 * browser, and what makes a seed reproduce a run move for move.
 *
 * The two rules worth remembering when reading this file:
 *   - Movement is a daily budget, not one step per day (PRD 6.1). `movementLeft`
 *     lives in the state and is only ever subtracted from.
 *   - A player can always move somewhere (PRD 6.8). When nothing is affordable,
 *     the forced march opens up, and it costs health.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./hex.js"),
      require("./config.js"),
      require("./map-generator.js"),
      require("./scenarios.js"),
      require("./strings.js"),
      require("./rng.js"),
      require("./events.js"),
      require("./chaser.js"),
      require("./ambient.js"),
    );
  } else {
    root.Survival = root.Survival || {};
    root.Survival.game = factory(
      root.Survival.hex,
      root.Survival.config,
      root.Survival.mapGenerator,
      root.Survival.scenarios,
      root.Survival.strings,
      root.Survival.rng,
      root.Survival.events,
      root.Survival.chaser,
      root.Survival.ambient,
    );
  }
})(
  typeof self !== "undefined" ? self : globalThis,
  function (hex, config, mapGenerator, scenarios, strings, rngModule, events, chaser, ambient) {
    "use strict";

    /**
     * Lines that read differently when the player is in trouble (WP-53, WP-54).
     * First condition that holds and has a written line wins; water comes before
     * hunger because it kills first.
     */
    const LOG_QUALIFIERS = {
      "log.move": [
        ["thirsty", (state) => state.player.water === 0],
        ["spent", (state) => state.player.fatigue >= 8],
      ],
      "log.dayBreaks": [
        ["thirst", (state) => state.player.water === 0],
        ["hunger", (state) => state.player.food === 0],
        ["spent", (state) => state.player.fatigue >= 8],
      ],
    };

    /**
     * What sort of line this is, so the journal can look like a journal rather
     * than a wall of identical text (PRD 8.13).
     *
     * Worked out from the key rather than passed in at every call site: there are
     * some sixty places that write to the journal, and a rule in one place cannot
     * be forgotten in one of them.
     */
    const LOG_KINDS = [
      [/^ambient\./, "ambient"],
      [/^event\./, "event"],
      [/^condition\./, "harm"],
      [/^weather\./, "weather"],
      [/^cheat\./, "cheat"],
      [/^terrainEffect\./, "terrain"],
      [/^log\.(noWater|noFood|exhausted|swampIllness|forcedMarch$|loss|deadline|chase\.caught)/, "harm"],
      [/^log\.(win|marker\.npc|marker\.carrying|treated|cabin)/, "good"],
      [/^log\.(move|dayBreaks|marchTold)/, "move"],
      [/^log\.(rest|camp|search|investigate|checkMap|marker)/, "action"],
    ];

    function logKind(key) {
      const match = LOG_KINDS.find(([pattern]) => pattern.test(key));
      return match ? match[1] : "system";
    }

    function qualifiedKey(state, key) {
      const rules = LOG_QUALIFIERS[key];
      if (!rules) return key;

      for (const [suffix, holds] of rules) {
        const candidate = key + "." + suffix;
        if (holds(state) && strings.has(candidate)) return candidate;
      }
      return key;
    }

    /**
     * Which variant of a line to use (WP-52).
     *
     * Deliberately not a draw from the run's stream: a journal entry must not
     * shift the events of a seed. The index is a hash of where the run is, so it
     * is stable for a seed and varied within it.
     */
    function variantIndex(state, key) {
      return rngModule.normalizeSeed(state.seed + ":" + state.day + ":" + state.log.length + ":" + key);
    }

    function addLog(state, key, params) {
      const chosen = qualifiedKey(state, key);
      const index = strings.count(chosen) > 1 ? variantIndex(state, chosen) : 0;

      state.log.push({
        day: state.day,
        key: chosen,
        kind: logKind(chosen),
        params: params || null,
        text: strings.t(chosen, params, index),
      });
    }

    /**
     * Let the wild say something (PRD 8.13). Never touches the player: the whole
     * point of these lines is that they cost nothing and mean nothing.
     */
    function maybeAmbient(state, moment) {
      if (state.gameOver) return null;

      const key = ambient.lineFor(state, currentTile(state), moment);
      if (!key) return null;

      addLog(state, key);
      return key;
    }

    function tileAt(state, q, r) {
      return mapGenerator.tileAt(state.map, q, r);
    }

    function currentTile(state) {
      return tileAt(state, state.player.q, state.player.r);
    }

    function terrainName(tile) {
      if (!tile) return strings.t("hud.none");
      if (tile.hasTrail) return strings.t("terrain.trail");
      if (tile.hasFord) return strings.t("terrain.ford");
      return strings.t("terrain." + tile.type);
    }

    /**
     * The only way a resource ever changes (PRD 6.5, WP-24). Everything clamps to
     * the range in the config, so no event, terrain or action can push a canteen
     * past full or health below zero.
     */
    function change(state, resource, delta) {
      state.player[resource] = config.clampResource(resource, state.player[resource] + delta);
    }

    /**
     * One draw from the run's stream. The position lives in the state as a plain
     * number, so a run stays serialisable and a seed still replays exactly
     * (PRD 9.1, WP-16).
     */
    function roll(state) {
      const rng = rngModule.createRng(state.seed);
      rng.restore(state.rngState);
      const value = rng.next();
      state.rngState = rng.snapshot();
      return value;
    }

    /**
     * Start a run. The seed decides the map and every roll after it, so this is
     * the only place randomness enters the game.
     */
    function createGame(options) {
      const settings = options || {};
      const scenarioId = settings.scenarioId || "lost";
      const scenario = scenarios.getScenario(scenarioId);
      if (!scenario) throw new Error("Unknown scenario: " + scenarioId);

      const difficultyName = config.DIFFICULTIES[settings.difficulty] ? settings.difficulty : config.DEFAULT_DIFFICULTY;
      const difficulty = config.difficultyOf(difficultyName);
      const seed = settings.seed;
      const mapSize = config.MAP_SIZES[settings.mapSize] ? settings.mapSize : config.DEFAULT_MAP_SIZE;
      const map = scenarios.buildMap(scenario, seed, mapSize);

      const player = {
        q: map.start.q,
        r: map.start.r,
        health: config.START.health,
        water: difficulty.water,
        food: difficulty.food,
        fatigue: config.START.fatigue,
        orientation: config.START.orientation,
        carryingNpc: false,
        alive: true,
        // Wounds and illnesses, each with its own clock (WP-60).
        conditions: [],
      };

      const state = {
        seed,
        // A separate stream from the one the map was drawn with, so a change to
        // map generation does not shuffle every event of an old seed.
        rngState: rngModule.createRng(seed).derive("play").snapshot(),
        scenarioId,
        difficulty: difficultyName,
        // Recorded, because the seed alone no longer describes the map.
        mapSize,
        // Debug and test seam: `events: false` runs the day accounting without the
        // nightly roll, so a test of thirst is a test of thirst alone.
        eventsEnabled: settings.events !== false,
        day: 1,
        movementLeft: config.movementPointsFor(player),
        spentToday: 0,
        spentOffTrail: 0,
        player,
        map,
        log: [],
        stats: { hexesTravelled: 0, eventsSeen: 0, forcedMarches: 0, trailHexes: 0, camps: 0, cabinsUsed: 0, woundsTaken: 0 },
        // Every hex stood on, in order, start included (PRD 8.17). Kept as plain
        // numbers so it survives a snapshot and a JSON record unchanged.
        route: [],
        objective: { foundTarget: false, inspected: 0 },
        weather: "clear",
        chaser: null,
        // Debug and test seam, like `events: false`: pin the sky so a test of
        // thirst is not quietly a test of a heatwave.
        forcedWeather: config.WEATHER[settings.weather] ? settings.weather : null,
        // Follow-ups an event has lined up for a later day (WP-59).
        scheduled: [],
        // An event waiting on the player to decide (WP-57). Ids only, so the
        // whole run stays serialisable.
        pendingChoice: null,
        campfireTonight: false,
        // Set by the cheat console (PRD 8.8). Travels with the result, so a run
        // that was helped cannot be read as one that was not.
        cheatsUsed: false,
        gameOver: false,
        result: null,
      };

      const start = currentTile(state);
      if (start) start.visited = true;
      state.route.push(state.player.q, state.player.r);

      // Whatever the scenario puts on the map is placed from its own stream, so
      // adding a scenario cannot shift the events of an existing seed.
      if (typeof scenario.setup === "function") {
        scenario.setup(state, rngModule.createRng(seed).derive("setup"));
      }

      rollWeather(state);
      revealAround(state);
      addLog(state, "log.start");
      return state;
    }

    function scenarioOf(state) {
      return scenarios.getScenario(state.scenarioId);
    }

    function checkWin(state) {
      const scenario = scenarioOf(state);
      if (!state.gameOver && scenario.isWin(state)) {
        state.gameOver = true;
        state.result = "won";
        addLog(state, "log.win");
      }
      return state.gameOver;
    }

    function checkLoss(state) {
      const scenario = scenarioOf(state);
      if (!state.gameOver && scenario.isLoss(state)) {
        state.gameOver = true;
        state.result = "lost";
        state.player.alive = false;
        // A scenario that can end in more than one way says which one it was.
        addLog(state, scenario.lossReason ? scenario.lossReason(state) : "log.loss");
      }
      return state.gameOver;
    }

    // ── wounds, illnesses and weather (WP-60, WP-62) ────────────────────────────

    function hasCondition(state, id) {
      return state.player.conditions.some((condition) => condition.id === id);
    }

    /**
     * Take a wound or an illness. Catching the same thing twice does not stack it,
     * it restarts its clock — two fevers at once is bookkeeping, not drama.
     */
    function addCondition(state, id) {
      const settings = config.CONDITIONS[id];
      if (!settings) return null;

      const existing = state.player.conditions.find((condition) => condition.id === id);
      if (existing) {
        existing.days = Math.max(existing.days, settings.days);
        return existing;
      }

      const condition = { id, days: settings.days };
      state.player.conditions.push(condition);
      state.stats.woundsTaken += 1;
      addLog(state, "condition." + id + ".starts");
      return condition;
    }

    /** Treatment: a cabin or a fire ends what a night of lying down only shortens. */
    function clearConditions(state) {
      if (state.player.conditions.length === 0) return 0;
      const healed = state.player.conditions.length;

      state.player.conditions = [];
      addLog(state, "log.treated");
      return healed;
    }

    /** One night of every wound and illness the player is carrying. */
    function tickConditions(state) {
      const surviving = [];

      for (const condition of state.player.conditions) {
        const settings = config.CONDITIONS[condition.id];
        if (settings && settings.daily) {
          for (const resource of Object.keys(settings.daily)) change(state, resource, settings.daily[resource]);
        }
        addLog(state, "condition." + condition.id + ".tick");

        condition.days -= 1;
        if (condition.days > 0) surviving.push(condition);
        else addLog(state, "condition." + condition.id + ".ends");
      }

      state.player.conditions = surviving;
    }

    /** Draw tomorrow's weather (WP-62). Rain arrives with its own gift and price. */
    function rollWeather(state) {
      let picked = state.forcedWeather;

      // A pinned sky skips the draw, not the weather: locked rain still rains.
      if (!picked) {
        const draw = roll(state);
        let running = 0;
        picked = "clear";

        for (const name of Object.keys(config.WEATHER)) {
          running += config.WEATHER[name].chance;
          if (draw < running) {
            picked = name;
            break;
          }
        }
      }

      state.weather = picked;
      const weather = config.WEATHER[picked];

      if (weather.water) change(state, "water", weather.water);
      if (weather.orientation) change(state, "orientation", weather.orientation);
      if (picked !== "clear") addLog(state, "weather." + picked);

      return picked;
    }

    /**
     * Can the player actually see the hunter right now?
     *
     * Only within the current sight radius, not on any hex that was explored at
     * some point: a person walks, and yesterday's view of a ridge says nothing
     * about who is standing on it today. Beyond that range the panel's
     * near/distant readout is all there is, which is the point of a chase.
     */
    function chaserVisible(state) {
      if (!state.chaser) return false;
      return hex.distance(state.chaser, state.player) <= visionRadiusFor(state);
    }

    /** How far the player sees, once the sky has had its say (WP-62). */
    function visionRadiusFor(state) {
      const weather = config.WEATHER[state.weather] || { vision: 0 };
      return Math.max(1, config.visionRadius(state.player) + (weather.vision || 0));
    }

    // ── fog of war (PRD 16, WP-28) ──────────────────────────────────────────────

    /**
     * Uncover what the player can see from where they stand. Radius comes from
     * their bearings, so losing the plot literally narrows the map.
     */
    /**
     * Water, forage and shelter: the things you can pick out at a distance
     * (PRD 8.10).
     */
    function isLandmark(tile) {
      // Boolean, not the last truthy operand: this is a predicate and callers
      // compare it.
      return !!(tile && (tile.type === "river" || tile.hasWaterSource || tile.hasFoodSource || tile.hasCabin));
    }

    function revealAround(state, radius) {
      const distance = radius === undefined ? visionRadiusFor(state) : radius;
      // A line of green or the glint of water carries further than the ability to
      // tell one field from the next.
      const landmarkDistance = distance + config.LANDMARK_VISION.bonusRadius;
      const here = { q: state.player.q, r: state.player.r };
      let uncovered = 0;

      for (const tile of state.map.tiles) {
        if (tile.revealed) continue;

        const away = hex.distance(tile, here);
        if (away > distance && !(away <= landmarkDistance && isLandmark(tile))) continue;

        tile.revealed = true;
        uncovered += 1;
      }

      return uncovered;
    }

    /**
     * Arriving on a marked hex settles what the marker was (WP-31, WP-32).
     * A false lead is rubbed off the map; the real one either ends the search or
     * gets picked up and carried, depending on the scenario.
     */
    function inspectMarker(state, tile) {
      if (!tile || !tile.marker || tile.markerInspected) return null;

      tile.markerInspected = true;
      state.objective.inspected += 1;

      if (tile.marker !== "npc") {
        tile.marker = null;
        addLog(state, "log.marker.decoy");
        return "decoy";
      }

      state.objective.foundTarget = true;
      addLog(state, "log.marker.npc");

      if (scenarioOf(state).carriesTarget) {
        state.player.carryingNpc = true;
        addLog(state, "log.marker.carrying");
      }

      return "npc";
    }

    /**
     * What the ground does to you on arrival (PRD 7.4, WP-21). This is on top of
     * the movement it cost to get there: the dry flats charge water for the day
     * you spend crossing them, not for the distance.
     */
    function applyTerrainEffects(state, tile) {
      const effects = config.TERRAIN_EFFECTS[tile.type];
      if (effects) {
        for (const resource of Object.keys(effects)) change(state, resource, effects[resource]);
        addLog(state, "terrainEffect." + tile.type);
      }
    }

    function enter(state, tile, cost) {
      state.movementLeft -= cost;
      state.spentToday += cost;
      // A day on a road is not a day of breaking trail, so only the rough going
      // counts towards the evening's fatigue (PRD 8.10).
      if (!tile.hasTrail && !tile.hasFord) state.spentOffTrail += cost;
      else state.stats.trailHexes += 1;
      state.player.q = tile.q;
      state.player.r = tile.r;
      tile.visited = true;
      state.stats.hexesTravelled += 1;
      state.route.push(tile.q, tile.r);
    }

    /**
     * Move onto an adjacent hex (WP-04, WP-05, WP-06).
     * Refusals are logged rather than thrown: the journal is the only channel the
     * player reads, so a refused move has to say why in it.
     */
    function moveTo(state, q, r) {
      if (state.gameOver) {
        addLog(state, "log.gameOver");
        return { ok: false, reason: "game-over" };
      }
      if (state.pendingChoice) return { ok: false, reason: "choice-pending" };

      const target = tileAt(state, q, r);
      if (!target) return { ok: false, reason: "off-map" };

      if (!hex.areNeighbors(state.player, target)) {
        addLog(state, "log.moveNotNeighbour");
        return { ok: false, reason: "not-neighbour" };
      }

      const cost = config.movementCost(target, state.player);
      if (state.movementLeft <= 0) {
        addLog(state, "log.moveNoPoints");
        return { ok: false, reason: "no-points" };
      }
      if (cost > state.movementLeft) {
        addLog(state, "log.moveTooExpensive", { terrain: terrainName(target), cost, left: state.movementLeft });
        return { ok: false, reason: "too-expensive", cost };
      }

      enter(state, target, cost);
      addLog(state, "log.move", { terrain: terrainName(target) });
      applyTerrainEffects(state, target);
      revealAround(state);
      maybeAmbient(state, "move");
      checkWin(state);

      return { ok: true, cost };
    }

    /** Neighbours the player could enter with the points left today. */
    function affordableNeighbours(state) {
      return hex
        .neighbors(state.player.q, state.player.r)
        .map((spot) => tileAt(state, spot.q, spot.r))
        .filter((tile) => tile && config.movementCost(tile, state.player) <= state.movementLeft);
    }

    /**
     * The cheapest way out when nothing is affordable (PRD 6.8). Ties break on
     * direction order, so the offer is the same for the same state.
     */
    function forcedMarchTarget(state) {
      if (state.gameOver || state.movementLeft <= 0) return null;
      if (affordableNeighbours(state).length > 0) return null;

      let best = null;
      let bestCost = Infinity;
      for (const spot of hex.neighbors(state.player.q, state.player.r)) {
        const tile = tileAt(state, spot.q, spot.r);
        if (!tile) continue;
        const cost = config.movementCost(tile, state.player);
        if (cost < bestCost) {
          best = tile;
          bestCost = cost;
        }
      }
      return best;
    }

    /** Take the forced march (WP-07). Costs health and fatigue, never refused twice. */
    function forcedMarch(state) {
      const target = forcedMarchTarget(state);
      if (!target) {
        addLog(state, "log.forcedMarchRefused");
        return { ok: false, reason: "not-needed" };
      }

      state.player.q = target.q;
      state.player.r = target.r;
      target.visited = true;
      state.stats.hexesTravelled += 1;
      state.stats.forcedMarches += 1;
      state.route.push(target.q, target.r);
      state.movementLeft = 0;

      // Breaking through on a bad leg costs more than breaking through whole
      // (PRD 8.16). It is never refused, only dearer: this is the one move that
      // must always be available (PRD 6.8).
      const wounded = config.conditionEffects(state.player).forcedMarchHealth;
      change(state, "health", -(config.FORCED_MARCH.healthCost + wounded));
      change(state, "fatigue", config.FORCED_MARCH.fatigueCost);
      addLog(state, "log.forcedMarch", { terrain: terrainName(target) });
      applyTerrainEffects(state, target);
      revealAround(state);

      if (!checkWin(state)) checkLoss(state);
      return { ok: true };
    }

    // ── actions other than moving ───────────────────────────────────────────────

    /** Guard shared by every action: nothing happens after the run is over. */
    function refuseWhenOver(state) {
      if (!state.gameOver) return null;
      addLog(state, "log.gameOver");
      return { ok: false, reason: "game-over" };
    }

    /** No action goes through while an event is waiting on an answer (WP-57). */
    function refuseWhilePending(state) {
      if (!state.pendingChoice) return null;
      return { ok: false, reason: "choice-pending" };
    }

    function spend(state, cost) {
      if (state.movementLeft < cost) {
        addLog(state, "log.noTimeForAction");
        return false;
      }
      state.movementLeft -= cost;
      state.spentToday += cost;
      state.spentOffTrail += cost;
      return true;
    }

    /**
     * Spend what is left of the day recovering (WP-18).
     * Rest closes the day, so it competes with distance rather than topping it up.
     */
    function rest(state) {
      const refused = refuseWhenOver(state) || refuseWhilePending(state);
      if (refused) return refused;

      // Lying down does not cure anything, it only takes a day off the clock.
      for (const condition of state.player.conditions) condition.days = Math.max(1, condition.days - 1);

      change(state, "fatigue", -config.REST.fatigueRelief);

      // Recovery needs fuel. Resting on an empty stomach only stops the bleeding.
      if (state.player.water > 0 && state.player.food > 0) {
        change(state, "health", config.REST.healthGain);
        addLog(state, "log.restFed");
      } else {
        addLog(state, "log.restHungry");
      }

      state.movementLeft = 0;
      endDay(state);
      return { ok: true };
    }

    /** Ground that gives you wood and a windbreak (WP-63). */
    function canMakeCamp(state) {
      const tile = currentTile(state);
      if (!tile) return false;
      return config.CAMP.terrain.includes(tile.type) || tile.hasCabin;
    }

    /**
     * Build a camp and light a fire (koncepcja 8.6, WP-63).
     *
     * More than a rest: it treats wounds, and the fire keeps the night quieter.
     * It costs the whole day and it needs the right ground, so it is a place you
     * plan to reach rather than a button you press when tired.
     */
    function makeCamp(state) {
      const refused = refuseWhenOver(state) || refuseWhilePending(state);
      if (refused) return refused;

      if (!canMakeCamp(state)) {
        addLog(state, "log.campImpossible");
        return { ok: false, reason: "wrong-ground" };
      }

      change(state, "fatigue", -config.CAMP.fatigueRelief);
      if (state.player.water > 0 && state.player.food > 0) change(state, "health", config.CAMP.healthGain);
      state.stats.camps += 1;
      addLog(state, "log.camp");
      clearConditions(state);

      state.campfireTonight = true;
      state.movementLeft = 0;
      endDay(state);
      return { ok: true };
    }

    /** Chance of finding what you are looking for on this tile (PRD 7.5). */
    function searchChance(kind, tile) {
      if (kind === "water" && (tile.hasWaterSource || tile.type === "river")) return config.SEARCH.sourceChance;
      if (kind === "food" && tile.hasFoodSource) return config.SEARCH.sourceChance;
      const table = config.SEARCH[kind];
      return table[tile.type] === undefined ? 0 : table[tile.type];
    }

    /**
     * Search the tile for water or food (WP-19, WP-20).
     *
     * One attempt per tile per resource. Without that rule the cheapest strategy
     * is standing still and re-rolling, which drains the tension out of the whole
     * game (PRD 13).
     */
    function search(state, kind) {
      const refused = refuseWhenOver(state) || refuseWhilePending(state);
      if (refused) return refused;

      const tile = currentTile(state);
      const flag = kind === "water" ? "searchedWater" : "searchedFood";

      if (tile[flag]) {
        addLog(state, "log.searchExhausted." + kind);
        return { ok: false, reason: "already-searched" };
      }
      if (!spend(state, config.SEARCH.cost)) return { ok: false, reason: "no-points" };

      tile[flag] = true;
      const chance = searchChance(kind, tile);
      const found = roll(state) < chance;

      if (!found) {
        addLog(state, "log.searchFailed." + kind);
        return { ok: true, found: false };
      }

      const gained = config.difficultyOf(state.difficulty).refill;
      change(state, kind, gained);
      addLog(state, "log.searchFound." + kind, { amount: gained });

      // Swamp water keeps its promise and its price.
      if (kind === "water" && tile.type === "swamp" && roll(state) < config.SEARCH.swampIllnessChance) {
        change(state, "health", -config.SEARCH.swampIllnessDamage);
        addLog(state, "log.swampIllness");
        checkLoss(state);
      }

      return { ok: true, found: true, gained };
    }

    // ── investigating the hex you are standing on ───────────────────────────────

    /**
     * What, if anything, is worth a closer look right here.
     * Returns one of "marker", "cabin", "spring", "forage", or null when the tile
     * has nothing left to give. Order matters: a cabin's spring is part of the
     * cabin, and a person waiting to be found outranks the scenery.
     */
    function investigateTarget(state) {
      const tile = currentTile(state);
      if (!tile) return null;

      if (tile.marker && !tile.markerInspected) return "marker";
      if (tile.hasCabin && !tile.cabinUsed) return "cabin";
      if (tile.hasWaterSource && !tile.springUsed) return "spring";
      if (tile.hasFoodSource && !tile.forageUsed) return "forage";
      return null;
    }

    function investigateSpring(state, tile) {
      tile.springUsed = true;
      change(state, "water", config.RESOURCES.water.max);

      if (roll(state) < config.INVESTIGATE.spring.taintedChance) {
        change(state, "health", -config.INVESTIGATE.spring.taintedDamage);
        addLog(state, "log.investigate.springTainted");
        return "spring-tainted";
      }

      addLog(state, "log.investigate.spring");
      return "spring";
    }

    function investigateForage(state, tile) {
      tile.forageUsed = true;
      const settings = config.INVESTIGATE.forage;
      const base = config.difficultyOf(state.difficulty).refill;

      if (roll(state) < settings.goodHaulChance) {
        change(state, "food", base + settings.goodHaulBonus);
        addLog(state, "log.investigate.forageGood", { amount: base + settings.goodHaulBonus });
        return "forage-good";
      }

      change(state, "food", base);
      addLog(state, "log.investigate.forage", { amount: base });
      return "forage";
    }

    /**
     * A cabin always means shelter: fatigue gone, canteen full. What else it holds
     * is drawn once — a store of food, someone's chart, or four walls and nothing
     * more.
     */
    function investigateCabin(state, tile) {
      tile.cabinUsed = true;
      state.stats.cabinsUsed += 1;
      change(state, "fatigue", -config.CABIN.fatigueRelief);
      if (config.CABIN.waterToFull) change(state, "water", config.RESOURCES.water.max);
      addLog(state, "log.investigate.cabin");
      clearConditions(state);

      const settings = config.INVESTIGATE.cabin;
      const draw = roll(state);

      if (draw < settings.suppliesChance) {
        change(state, "food", settings.suppliesFood);
        addLog(state, "log.investigate.cabinSupplies", { amount: settings.suppliesFood });
        return "cabin-supplies";
      }

      if (draw < settings.suppliesChance + settings.chartChance) {
        change(state, "orientation", settings.chartOrientation);
        revealAround(state, settings.chartRevealRadius);
        addLog(state, "log.investigate.cabinChart");
        return "cabin-chart";
      }

      addLog(state, "log.investigate.cabinBare");
      return "cabin-bare";
    }

    /**
     * Look at what is on this hex. One point of the day, and each place gives up
     * what it has once.
     */
    function investigate(state) {
      const refused = refuseWhenOver(state) || refuseWhilePending(state);
      if (refused) return refused;

      const target = investigateTarget(state);
      if (!target) {
        addLog(state, "log.investigate.nothing");
        return { ok: false, reason: "nothing-here" };
      }
      if (!spend(state, config.INVESTIGATE.cost)) return { ok: false, reason: "no-points" };

      const tile = currentTile(state);
      let outcome;

      if (target === "marker") outcome = inspectMarker(state, tile);
      else if (target === "cabin") outcome = investigateCabin(state, tile);
      else if (target === "spring") outcome = investigateSpring(state, tile);
      else outcome = investigateForage(state, tile);

      if (!checkWin(state)) checkLoss(state);
      return { ok: true, target, outcome };
    }

    /**
     * Study the map and the ground (WP-29). Two points of the day buys two points
     * of bearings and a look two hexes out — and because vision radius follows
     * bearings, the second one keeps paying after the action is over.
     */
    function checkMap(state) {
      const refused = refuseWhenOver(state) || refuseWhilePending(state);
      if (refused) return refused;
      if (!spend(state, config.CHECK_MAP.cost)) return { ok: false, reason: "no-points" };

      change(state, "orientation", config.CHECK_MAP.orientationGain);
      const uncovered = revealAround(state, config.CHECK_MAP.revealRadius);
      addLog(state, "log.checkMap", { orientation: state.player.orientation });

      return { ok: true, uncovered };
    }

    function searchWater(state) {
      return search(state, "water");
    }

    function searchFood(state) {
      return search(state, "food");
    }

    // ── events ──────────────────────────────────────────────────────────────────

    /**
     * Chance of something happening tonight (WP-23). Difficulty sets the floor;
     * a player who has lost their bearings walks into more trouble.
     */
    function eventChance(state) {
      const base = config.difficultyOf(state.difficulty).eventChance;
      const lost = state.player.orientation <= config.EVENTS.lowOrientationAt;
      return base + (lost ? config.EVENTS.lowOrientationBonus : 0);
    }

    /** The handle an event gets. It cannot reach the player any other way. */
    function effectsFor(state) {
      return {
        change: (resource, delta) => change(state, resource, delta),
        roll: () => roll(state),
        tile: () => currentTile(state),
        log: (key, params) => addLog(state, key, params),
        addCondition: (id) => addCondition(state, id),
        hasCondition: (id) => hasCondition(state, id),
        schedule: (eventId, days, options) => scheduleEvent(state, eventId, days, options),
      };
    }

    /**
     * Line an event up for a later day (WP-59). `requiresCondition` is what makes
     * a bite that gets treated stop turning into a fever.
     */
    function scheduleEvent(state, eventId, days, options) {
      // A countdown rather than a target day: "in two days" then means the same
      // thing wherever in the turn the clock happens to be read.
      const entry = { eventId, daysLeft: days };
      if (options && options.requiresCondition) entry.requiresCondition = options.requiresCondition;

      state.scheduled.push(entry);
      return entry;
    }

    /** Fire whatever an earlier event lined up for tonight. */
    function runScheduled(state) {
      if (state.scheduled.length === 0) return [];

      const waiting = [];
      const fired = [];

      for (const entry of state.scheduled) {
        entry.daysLeft -= 1;
        if (entry.daysLeft > 0) {
          waiting.push(entry);
          continue;
        }

        // The follow-up only lands if what caused it is still untreated. Either
        // way its turn has come and gone: a cured bite does not lurk forever.
        if (entry.requiresCondition && !hasCondition(state, entry.requiresCondition)) continue;
        triggerEvent(state, entry.eventId);
        fired.push(entry.eventId);
      }

      state.scheduled = waiting;
      return fired;
    }

    /**
     * Fire one event by name. Also the console hook behind WP-22.
     *
     * An event with choices stops here: it writes its line, puts the options on
     * the table, and waits. Nothing else happens until the player answers.
     */
    function triggerEvent(state, id) {
      const event = events.get(id);
      if (!event) return { ok: false, reason: "unknown-event" };

      addLog(state, event.logKey);
      state.stats.eventsSeen += 1;
      state.lastEventId = id;

      if (event.choices) {
        state.pendingChoice = {
          eventId: id,
          choices: event.choices.map((choice) => ({ id: choice.id, labelKey: choice.labelKey })),
        };
        return { ok: true, id, pending: true };
      }

      event.apply(effectsFor(state));
      return { ok: true, id };
    }

    /**
     * Answer a waiting event (WP-57).
     *
     * Walking away is an answer too: without an id, the cautious option is taken,
     * so closing the window can never be better than deciding.
     */
    function resolveChoice(state, choiceId) {
      if (!state.pendingChoice) return { ok: false, reason: "nothing-pending" };

      const event = events.get(state.pendingChoice.eventId);
      const options = (event && event.choices) || [];
      const chosen = options.find((choice) => choice.id === choiceId) || options.find((choice) => choice.cautious) || options[0];

      state.pendingChoice = null;
      if (!chosen) return { ok: false, reason: "no-choices" };

      chosen.apply(effectsFor(state));
      if (!checkWin(state)) checkLoss(state);

      return { ok: true, choiceId: chosen.id };
    }

    /**
     * The nightly roll. Tone is drawn first, then an event from that pool, so
     * difficulty can tilt the mix towards trouble without touching the pools.
     */
    function maybeTriggerEvent(state) {
      if (!state.eventsEnabled) return null;
      if (roll(state) >= eventChance(state)) return null;

      // A fire keeps the night quieter without making it safe (WP-63).
      const negativeShare =
        config.difficultyOf(state.difficulty).negativeShare - (state.campfireTonight ? config.CAMP.negativeShareRelief : 0);

      const tone = roll(state) < negativeShare ? "bad" : "good";
      const here = currentTile(state);
      const pool = events.list(tone, here ? here.type : undefined);
      if (pool.length === 0) return null;

      const picked = pool[Math.floor(roll(state) * pool.length)];
      triggerEvent(state, picked.id);
      return picked.id;
    }

    /**
     * Close the day (WP-08, WP-09, WP-10, WP-11).
     * Order matters: the march is paid for first, then the day's rations, then
     * what the shortages do to the body.
     */
    function endDay(state) {
      if (state.gameOver) {
        addLog(state, "log.gameOver");
        return { ok: false, reason: "game-over" };
      }

      const fatigueGain = Math.floor(state.spentOffTrail / config.MOVEMENT.pointsPerFatigue);
      if (fatigueGain > 0) {
        change(state, "fatigue", fatigueGain);
        addLog(state, "log.marchTold", { fatigue: state.player.fatigue });
      }

      // Heat drinks the canteen twice as fast (WP-62).
      const weather = config.WEATHER[state.weather] || { waterFactor: 1 };
      const waterLoss = config.END_OF_DAY.waterLoss * (weather.waterFactor || 1);

      change(state, "water", -waterLoss);
      change(state, "food", -config.END_OF_DAY.foodLoss);

      if (state.player.water === 0) {
        change(state, "health", -config.END_OF_DAY.noWaterDamage);
        addLog(state, "log.noWater");
      }
      if (state.player.food === 0) {
        change(state, "health", -config.END_OF_DAY.noFoodDamage);
        addLog(state, "log.noFood");
      }
      if (state.player.fatigue >= config.END_OF_DAY.exhaustionAt) {
        change(state, "health", -config.END_OF_DAY.exhaustionDamage);
        addLog(state, "log.exhausted");
      }

      tickConditions(state);
      runScheduled(state);
      maybeTriggerEvent(state);
      state.campfireTonight = false;

      // The hunter walks after everything else has had its turn (WP-66).
      if (state.chaser) {
        const before = { proximity: chaser.proximity(state), seen: chaserVisible(state) };
        chaser.advance(state, () => roll(state));

        const after = { proximity: chaser.proximity(state), seen: chaserVisible(state) };
        if (after.proximity !== before.proximity) addLog(state, "log.chase." + after.proximity);
        // Coming into view is worth its own line: it is the moment the abstract
        // pursuit becomes a person on a hex.
        if (after.seen && !before.seen) addLog(state, "log.chase.sighted");
      }

      if (checkLoss(state)) return { ok: true, gameOver: true };

      state.day += 1;
      state.spentToday = 0;
      state.spentOffTrail = 0;
      state.movementLeft = config.movementPointsFor(state.player);
      rollWeather(state);

      // A night's events can move the player's bearings either way, so the view
      // is redrawn before the new day rather than after the first step.
      revealAround(state);
      addLog(state, "log.dayBreaks", { day: state.day });
      maybeAmbient(state, "dawn");

      return { ok: true, gameOver: false };
    }

    /** The tail of the journal the panel shows (WP-15). The state keeps all of it. */
    function visibleLog(state, count) {
      const limit = count || config.LOG.visibleEntries;
      return state.log.slice(-limit).reverse();
    }

    /** What the end screen shows and what the backend stores (WP-14, WP-42). */
    function summary(state) {
      return {
        cheatsUsed: !!state.cheatsUsed,
        days: state.day,
        hexesTravelled: state.stats.hexesTravelled,
        health: state.player.health,
        water: state.player.water,
        food: state.player.food,
        eventsSeen: state.stats.eventsSeen,
        forcedMarches: state.stats.forcedMarches,
      };
    }

    /**
     * Everything an achievement or a chronicle needs, flattened (PRD 8.17,
     * 8.18). A plain object rather than the live state, so the rules that read
     * it cannot reach into the game and change it.
     */
    function describeRun(state) {
      const scenario = scenarioOf(state);

      return {
        won: state.result === "won",
        finished: !!state.gameOver,
        scenarioId: state.scenarioId,
        mapSize: state.mapSize,
        difficulty: state.difficulty,
        cheatsUsed: !!state.cheatsUsed,
        days: state.day,
        hexesTravelled: state.stats.hexesTravelled,
        trailHexes: state.stats.trailHexes || 0,
        camps: state.stats.camps || 0,
        cabinsUsed: state.stats.cabinsUsed || 0,
        woundsTaken: state.stats.woundsTaken || 0,
        forcedMarches: state.stats.forcedMarches,
        eventsSeen: state.stats.eventsSeen,
        health: state.player.health,
        water: state.player.water,
        food: state.player.food,
        fatigue: state.player.fatigue,
        orientation: state.player.orientation,
        markersInspected: state.objective.inspected || 0,
        carriedSurvivor: !!scenario.carriesTarget && !!state.objective.foundTarget,
        wounded: state.player.conditions.length > 0,
      };
    }

    return {
      createGame,
      moveTo,
      forcedMarch,
      forcedMarchTarget,
      affordableNeighbours,
      rest,
      makeCamp,
      canMakeCamp,
      searchWater,
      searchFood,
      searchChance,
      checkMap,
      investigate,
      investigateTarget,
      revealAround,
      isLandmark,
      inspectMarker,
      chaserProximity: (state) => chaser.proximity(state),
      chaserVisible,
      endDay,
      eventChance,
      triggerEvent,
      maybeTriggerEvent,
      resolveChoice,
      scheduleEvent,
      runScheduled,
      addCondition,
      hasCondition,
      clearConditions,
      tickConditions,
      rollWeather,
      visionRadiusFor,
      tileAt,
      currentTile,
      terrainName,
      visibleLog,
      summary,
      describeRun,
      addLog,
      logKind,
      maybeAmbient,
      change,
      roll,
    };
  },
);
