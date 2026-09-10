/**
 * Rolnopol Survival — the balance bot (PRD WP-26, 3).
 *
 * A deliberately plain player: head for the nearest edge, drink when the canteen
 * runs low, rest when the body gives out. It is not meant to play well. It is
 * meant to play the *same way every time*, so a change to a cost or a penalty
 * shows up as a moved win rate rather than as a feeling.
 *
 * From the console:
 *   Survival.balanceBot.runBalance(100)
 *   Survival.balanceBot.runBalance(100, { difficulty: "hard" })
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./game.js"), require("./config.js"), require("./hex.js"), require("./scenarios.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.balanceBot = factory(root.Survival.game, root.Survival.config, root.Survival.hex, root.Survival.scenarios);
  }
})(typeof self !== "undefined" ? self : globalThis, function (game, config, hex, scenarios) {
  "use strict";

  const DEFAULTS = {
    seed: 1,
    scenarioId: "lost",
    difficulty: config.DEFAULT_DIFFICULTY,
    mapSize: config.DEFAULT_MAP_SIZE,
    maxDays: 60,
  };

  const SIDE_DISTANCE = {
    west: (tile) => tile.col,
    east: (tile, map) => map.width - 1 - tile.col,
    north: (tile) => tile.row,
    south: (tile, map) => map.height - 1 - tile.row,
  };

  /**
   * How far this tile is from a border that would end the run.
   *
   * A scenario that only counts one border (Survival, Deadline) makes the whole
   * map a different shape, and a bot walking to the nearest edge would report
   * those as unwinnable rather than measure them.
   */
  function edgeDistance(tile, map, sides) {
    const wanted = sides && sides.length ? sides : ["west", "east", "north", "south"];
    return Math.min(...wanted.map((side) => SIDE_DISTANCE[side](tile, map)));
  }

  /**
   * Water the player has actually seen and could still drink from.
   * Landmarks show up beyond the sight radius (PRD 8.10), so on a large map
   * there is usually something on the map to aim at.
   */
  function nearestRevealed(state, matches) {
    let best = null;
    let bestDistance = Infinity;

    for (const tile of state.map.tiles) {
      if (!tile.revealed || !matches(tile)) continue;

      const away = hex.distance(tile, state.player);
      if (away < bestDistance) {
        best = tile;
        bestDistance = away;
      }
    }

    return best;
  }

  function thirstTarget(state) {
    if (state.player.water > 2) return null;
    return nearestRevealed(state, (tile) => tile.type === "river" || (tile.hasWaterSource && !tile.springUsed));
  }

  function hungerTarget(state) {
    if (state.player.food > 2) return null;
    return nearestRevealed(state, (tile) => (tile.hasFoodSource && !tile.forageUsed) || tile.hasCabin);
  }

  /**
   * What the bot is walking towards: water when the canteen is nearly out, the
   * person it is looking for if there is one, otherwise the nearest border that
   * counts.
   *
   * Water first is what a person does, and without it the bot walks in a
   * straight line until it dies of thirst — which is what made the largest map
   * read as unwinnable rather than merely hard.
   */
  function goalDistance(state, tile) {
    // Thirst first: it kills in two days, hunger in ten.
    const water = thirstTarget(state);
    if (water) return hex.distance(tile, water);

    const food = hungerTarget(state);
    if (food) return hex.distance(tile, food);

    const marked = state.map.tiles.filter((candidate) => candidate.marker && !candidate.markerInspected);
    if (marked.length > 0) {
      return Math.min(...marked.map((target) => hex.distance(tile, target)));
    }

    const scenario = scenarios.getScenario(state.scenarioId);
    return edgeDistance(tile, state.map, scenario && scenario.targetSides);
  }

  /**
   * One day, played by the rules of thumb above. Returns nothing: it mutates the
   * run the way a player's clicks would.
   */
  function playDay(state) {
    const player = state.player;

    // Anything standing on this hex is a point well spent: it is cheaper than
    // searching blind and it is the only way to reach a cabin or a marker.
    if (game.investigateTarget(state) && state.movementLeft >= config.INVESTIGATE.cost) {
      game.investigate(state);
      if (state.gameOver) return;
    }

    const tile = game.currentTile(state);

    // Thirst first. Everything else can wait a day; water cannot.
    if (player.water <= 1 && !tile.searchedWater && game.searchChance("water", tile) >= 0.3) {
      game.searchWater(state);
    } else if (player.food <= 1 && !tile.searchedFood && game.searchChance("food", tile) >= 0.3) {
      game.searchFood(state);
    }

    // A body this worn covers no ground anyway, so trade the day for the repair.
    // A fire is the better trade when the ground allows it: it treats wounds and
    // keeps the night quieter.
    const hurt = player.conditions.length > 0;
    if ((player.fatigue >= 7 || hurt) && player.water > 0 && player.food > 0) {
      if (game.canMakeCamp(state)) game.makeCamp(state);
      else if (player.fatigue >= 7) game.rest(state);
      else return endTheDay(state);
      settleChoice(state);
      return;
    }

    while (!state.gameOver && state.movementLeft > 0) {
      const options = game.affordableNeighbours(state);
      if (options.length === 0) break;

      options.sort((a, b) => {
        const byEdge = goalDistance(state, a) - goalDistance(state, b);
        if (byEdge !== 0) return byEdge;
        // Same distance, take the road: it costs one point and no fatigue.
        const byTrail = (b.hasTrail || b.hasFord ? 1 : 0) - (a.hasTrail || a.hasFord ? 1 : 0);
        if (byTrail !== 0) return byTrail;
        // Costed for the walker as they are, wounds included (PRD 8.16).
        const byCost = config.movementCost(a, state.player) - config.movementCost(b, state.player);
        if (byCost !== 0) return byCost;
        return hex.key(a.q, a.r).localeCompare(hex.key(b.q, b.r));
      });

      const target = options[0];
      const here = game.currentTile(state);
      const onRoad = here.hasTrail || here.hasFord;

      // Nothing nearby gets us closer to where we are going: stop burning the
      // day on it. Stepping sideways onto a road is the exception — a road is
      // worth a hex of ground, which is the whole reason someone cut it.
      const closer = goalDistance(state, target) < goalDistance(state, here);
      const stepsOntoRoad = !onRoad && (target.hasTrail || target.hasFord);
      if (!closer && !stepsOntoRoad) break;
      if (!game.moveTo(state, target.q, target.r).ok) break;
    }

    if (state.gameOver) return;
    endTheDay(state);
  }

  /**
   * The bot always takes the careful option when an event asks (WP-57).
   * That is a bias, and a deliberate one: it makes the measurement a floor
   * rather than a coin toss, so a balance change shows up as a moved number.
   */
  function settleChoice(state) {
    if (state.pendingChoice) game.resolveChoice(state);
  }

  function endTheDay(state) {
    // Boxed in by ground we cannot afford — pay in blood rather than stand still.
    if (game.forcedMarchTarget(state)) game.forcedMarch(state);
    if (!state.gameOver) game.endDay(state);
    settleChoice(state);
  }

  /** Play one seed to the end. `timeout` means the bot walked in circles. */
  function playGame(options) {
    const settings = { ...DEFAULTS, ...(options || {}) };
    const state = game.createGame(settings);

    while (!state.gameOver && state.day <= settings.maxDays) playDay(state);

    return {
      seed: settings.seed,
      result: state.gameOver ? state.result : "timeout",
      days: state.day,
      hexesTravelled: state.stats.hexesTravelled,
      eventsSeen: state.stats.eventsSeen,
      forcedMarches: state.stats.forcedMarches,
      // What actually pressed on this run, for reading a balance change.
      lowestWater: state.player.water,
      conditionsLeft: state.player.conditions.length,
    };
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /**
   * Play `games` consecutive seeds and report how they went.
   * Seeds run in sequence from `options.seed`, so the whole batch is one number
   * away from being reproduced exactly.
   */
  function runBalance(games, options) {
    const settings = { ...DEFAULTS, ...(options || {}) };
    const count = games || 100;
    const runs = [];

    for (let i = 0; i < count; i += 1) {
      runs.push(playGame({ ...settings, seed: settings.seed + i }));
    }

    const wins = runs.filter((run) => run.result === "won").length;
    const losses = runs.filter((run) => run.result === "lost").length;
    const timeouts = runs.filter((run) => run.result === "timeout").length;

    return {
      games: count,
      difficulty: settings.difficulty,
      mapSize: settings.mapSize,
      firstSeed: settings.seed,
      wins,
      losses,
      timeouts,
      winRate: wins / count,
      medianDays: median(runs.map((run) => run.days)),
      medianHexes: median(runs.map((run) => run.hexesTravelled)),
      runs,
    };
  }

  return { runBalance, playGame, edgeDistance, goalDistance, thirstTarget, hungerTarget, settleChoice };
});
