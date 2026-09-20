/**
 * Rolnopol Survival — every balance number in one place (PRD 7 and 8.4).
 *
 * Nothing else in the game may hard-code a cost, a cap or a penalty. Tuning the
 * game has to be editing this file, not hunting through the logic.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.config = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Terrain types and their movement cost (PRD 7.3). `trail` and `ford` are
  // overlays rather than types, handled in movementCost() below.
  const TERRAIN = {
    open: { cost: 1 },
    forest: { cost: 2 },
    desert: { cost: 2 },
    mountain: { cost: 3 },
    river: { cost: 3 },
    swamp: { cost: 4 },
  };

  const TERRAIN_TYPES = Object.keys(TERRAIN);

  // Share of the map per terrain type (PRD 8.1 WP-02). "special" is not a
  // terrain: it is an open tile carrying a cabin, a water source or a food
  // source, so it is counted separately by the generator.
  // Desert was in the terrain table from the first release and never once
  // appeared on a map, because the mix had no room for it (WP-65). Its share
  // comes out of open ground, the type the map had most of.
  const TERRAIN_MIX = {
    open: 0.32,
    forest: 0.25,
    desert: 0.08,
    mountain: 0.1,
    river: 0.1,
    swamp: 0.1,
  };
  const SPECIAL_SHARE = 0.05;

  /**
   * Springs and forage get denser as the map grows (PRD 8.10).
   *
   * Not for fairness but for arithmetic: the water clock is six days whatever
   * the map, so a journey four times longer needs four times as many places to
   * stop, and a constant 5% does not give them.
   */
  const SPECIAL_SHARE_BY_WIDTH = [
    { width: 64, share: 0.1 },
    { width: 48, share: 0.085 },
    { width: 32, share: 0.07 },
    { width: 0, share: 0.05 },
  ];

  /**
   * What the special tiles are (PRD 8.10).
   *
   * Forage is the most common of the three because food is what a long
   * expedition actually runs out of: water can be searched for on any river,
   * and there are hundreds of river hexes, while a berry patch or game trail is
   * the only reliable meal. Cabins stay rare — they are the big prize.
   */
  const SPECIAL_MIX = { forage: 0.45, spring: 0.35, cabin: 0.2 };

  const RESOURCES = {
    health: { min: 0, max: 10 },
    water: { min: 0, max: 8 },
    food: { min: 0, max: 16 },
    fatigue: { min: 0, max: 10 },
    orientation: { min: 0, max: 10 },
  };

  // Difficulty (PRD 8.4). Release 1 uses the starting resources; refill and
  // event chance are read by release 2 and live here already so the table stays
  // in one piece.
  // The event chances were calibrated for a longer expedition. With runs ending
  // in three or four days, 0.2/0.3/0.4 left a third of them with no event at
  // all, so eighteen written events were never read. Measured with the balance
  // bot: at these numbers 10% of runs see nothing, down from 34%, and the win
  // rate barely moves — events turn out to be a content dial, not a balance one.
  const DIFFICULTIES = {
    easy: { water: 8, food: 14, refill: 4, eventChance: 0.4, negativeShare: 0.4 },
    normal: { water: 6, food: 10, refill: 3, eventChance: 0.6, negativeShare: 0.55 },
    hard: { water: 4, food: 8, refill: 2, eventChance: 0.8, negativeShare: 0.7 },
  };

  const DEFAULT_DIFFICULTY = "normal";

  const MOVEMENT = {
    base: 6,
    minimum: 1,
    // Movement points lost at or below each health value (PRD 7.2).
    healthPenalties: [7, 4, 2],
    // Movement points lost at or above each fatigue value.
    fatiguePenalties: [4, 7],
    carryingNpcPenalty: 1,
    // Fatigue gained per this many movement points spent in a day (PRD 6.3).
    pointsPerFatigue: 3,
  };

  // Walking into a dead end must never end the game silently (PRD 6.8).
  const FORCED_MARCH = { healthCost: 1, fatigueCost: 2 };

  const END_OF_DAY = {
    waterLoss: 1,
    foodLoss: 1,
    noWaterDamage: 2,
    noFoodDamage: 1,
    exhaustionDamage: 1,
    exhaustionAt: 10,
  };

  // What a day away from marching buys (PRD 7.3, 8.2 WP-18).
  const REST = { fatigueRelief: 3, healthGain: 1 };

  // Searching for water and food (PRD 7.5). One attempt per tile per resource,
  // otherwise a player stands on one hex and rolls until the dice agree.
  const SEARCH = {
    cost: 2,
    water: { river: 1.0, swamp: 0.4, forest: 0.3, mountain: 0.2, open: 0.1, desert: 0.05 },
    food: { forest: 0.5, swamp: 0.25, mountain: 0.2, open: 0.15, desert: 0.05, river: 0.1 },
    // Marked springs and forage spots always deliver, whatever they sit on.
    sourceChance: 1.0,
    swampIllnessChance: 0.25,
    swampIllnessDamage: 1,
  };

  // What entering a tile does beyond costing movement (PRD 7.4).
  const TERRAIN_EFFECTS = {
    mountain: { fatigue: 1, orientation: 1 },
    swamp: { fatigue: 2, orientation: -1 },
    desert: { water: -1 },
    forest: { orientation: -1 },
  };

  // A cabin is the one place that undoes a bad week, and only the first time.
  const CABIN = { fatigueRelief: 10, waterToFull: true };

  /**
   * Investigating what is on the hex you are standing on (springs, forage
   * spots, cabins, expedition markers).
   *
   * Cheaper than searching blind, because the thing is already in front of you:
   * one point rather than two. Each place gives up what it has once, and most of
   * them can go two ways, so walking to a marked hex is a bet rather than a
   * pickup.
   */
  const INVESTIGATE = {
    cost: 1,
    spring: {
      // Fills the canteen outright, which is what makes a spring worth a detour.
      taintedChance: 0.2,
      taintedDamage: 1,
    },
    forage: {
      // On top of the difficulty's refill.
      goodHaulChance: 0.35,
      goodHaulBonus: 2,
    },
    cabin: {
      // Three ways a cabin can go, drawn in this order against one roll.
      suppliesChance: 0.4,
      suppliesFood: 4,
      chartChance: 0.3,
      chartOrientation: 3,
      chartRevealRadius: 3,
    },
  };

  /**
   * The chase (WP-66). The hunter moves on its own budget and never sees the
   * player directly: it walks towards where it thinks they are, and that guess
   * is worse when the player is lost, because a lost player wanders.
   */
  const CHASE = {
    movement: 4,
    // How far the guess can be off, by the player's own bearings.
    errorByOrientation: [
      { orientation: 8, error: 1 },
      { orientation: 4, error: 2 },
      { orientation: 0, error: 4 },
    ],
    // Hexes between the player and the hunter at the start.
    startDistance: 7,
  };

  const EVENTS = {
    lowOrientationAt: 3,
    lowOrientationBonus: 0.05,
  };

  /**
   * Wounds and illnesses (WP-60). A condition is a named thing with a clock on
   * it, not a one-off subtraction: it bites every night until it runs out or
   * somebody treats it.
   */
  const CONDITIONS = {
    bitten: { days: 3, daily: { health: -1 }, forcedMarchHealth: 1 },
    fever: { days: 3, daily: { health: -1, fatigue: 1 }, vision: -1 },
    dysentery: { days: 2, daily: { health: -1, water: -1 } },
    sprain: { days: 2, daily: { fatigue: 2 }, movement: -1, roughSurcharge: 1, forcedMarchHealth: 1 },
  };

  /**
   * Ground a bad ankle turns into a problem (PRD 8.16).
   *
   * A trail or a ford is exempt on purpose: a road is a road whatever state
   * your leg is in, and the surcharge is meant to push a limping player onto
   * the roads rather than off the map.
   */
  const ROUGH_TERRAIN = ["forest", "mountain", "swamp"];

  /**
   * What the wounds a player is carrying do to the way they move (PRD 8.16).
   *
   * The point of this table is that a wound is no longer only a number ticking
   * off health every night. A sprain costs a movement point and makes rough
   * ground rougher; a fever narrows what you can see. Both change the route you
   * would pick, which is what a wound ought to do.
   *
   * Nothing here can stop a player moving. The forced march (6.8) stays
   * available whatever they are carrying, because a wound that soft-locks the
   * run is a defect, not a difficulty. Wounds only make it cost more.
   */
  function conditionEffects(player) {
    const effects = { movement: 0, vision: 0, roughSurcharge: 0, forcedMarchHealth: 0 };

    for (const condition of (player && player.conditions) || []) {
      const rules = CONDITIONS[condition.id];
      if (!rules) continue;

      effects.movement += rules.movement || 0;
      effects.vision += rules.vision || 0;
      effects.roughSurcharge += rules.roughSurcharge || 0;
      effects.forcedMarchHealth += rules.forcedMarchHealth || 0;
    }

    return effects;
  }

  /** Does this condition change anything besides the nightly toll? */
  function conditionChangesMovement(id) {
    const rules = CONDITIONS[id];
    if (!rules) return false;
    return !!(rules.movement || rules.vision || rules.roughSurcharge || rules.forcedMarchHealth);
  }

  /**
   * Weather (WP-62). Rolled for each new day. `waterFactor` multiplies the
   * day's ration, `vision` shifts the sight radius on top of what bearings give,
   * so fog blinds a player who knows exactly where they are.
   */
  const WEATHER = {
    clear: { chance: 0.45, waterFactor: 1, vision: 0 },
    heat: { chance: 0.2, waterFactor: 2, vision: 0 },
    rain: { chance: 0.2, waterFactor: 1, water: 1, orientation: -1, vision: 0 },
    fog: { chance: 0.15, waterFactor: 1, vision: -1 },
  };

  // Making camp (koncepcja 8.6, WP-63). More than a rest and it treats what
  // ails you, but it needs wood: forest or a cabin, and the whole day.
  const CAMP = {
    fatigueRelief: 6,
    healthGain: 1,
    terrain: ["forest"],
    // A fire keeps the night quieter: the share of bad events drops by this.
    negativeShareRelief: 0.25,
  };

  // How far the player can see, by how well they know where they are (PRD 16).
  // Read top down: the first threshold the player meets wins.
  const VISION = [
    { orientation: 8, radius: 3 },
    { orientation: 4, radius: 2 },
    { orientation: 0, radius: 1 },
  ];

  /**
   * Landmarks are seen from further off than ordinary ground (PRD 8.10).
   *
   * A ridge shows you a line of green and the glint of water long before you
   * can tell one field from another. Without this a player on a large map walks
   * blind past rivers, which is precisely how the 128 by 128 map turned out to
   * be unwinnable: the water was there, and there was no way to aim at it.
   */
  const LANDMARK_VISION = { bonusRadius: 4 };

  // Studying the map: two points of the day for two points of bearings and a
  // look at what lies two hexes out (PRD 8.5, WP-29).
  const CHECK_MAP = { cost: 2, orientationGain: 2, revealRadius: 2 };

  // Where the search and rescue scenarios put their markers (PRD 6.11).
  // The distances are what keep a rescue target from sitting next to the start
  // or all four markers from landing in the same corner.
  const MARKERS = {
    minDistanceFromStart: 6,
    minSpacing: 4,
    reachableCostLimit: 3,
  };

  /**
   * Map sizes the player can pick from (menu, PRD 8.9).
   *
   * The size is the honest difficulty dial: on a bigger map the border is
   * further away, so water and food have time to matter. `standard` is the
   * 24 by 24 settled on in 6.14 and stays the default.
   */
  const MAP_SIZES = {
    small: { width: 16, height: 16 },
    standard: { width: 24, height: 24 },
    large: { width: 32, height: 32 },
    vast: { width: 40, height: 40 },
    immense: { width: 48, height: 48 },
    colossal: { width: 64, height: 64 },
    endless: { width: 128, height: 128 },
  };

  const DEFAULT_MAP_SIZE = "standard";

  const MAP = {
    // 24x24 rather than the 12x12 the PRD first named. On a 12x12 map the start
    // sits four or five hexes from a border, and a day of open ground covers
    // six, so the run ended on day one and nothing in release 2 ever fired.
    // Measured with the balance bot: 12x12 won 99% of runs in a median of one
    // day; 24x24 wins 82% in a median of four.
    width: 24,
    height: 24,
    // Map validation (PRD 6.11).
    minReachableEdgeSides: 2,
    // The player wakes in the dead centre. Any drift towards a border shortens
    // the journey twice over: it is nearer the exit and further from nothing.
    // The generator widens this only if the centre tile itself is unusable.
    startRadius: 0,
    reachableCostLimit: 3,
    waterSearchRadius: 4,
    maxGenerationAttempts: 10,
    // Swap passes that cluster terrain without changing the tile counts.
    smoothingPasses: 6,
    // Rivers are carved as a watercourse rather than left as puddles (WP-64).
    riverBends: 0.35,
    // Trails and springs are counted per area, not per map (PRD 8.10). Three
    // short trails are a feature on a 24 by 24 map and a rounding error on a
    // 128 by 128 one, and a journey four times longer needs four times the
    // places to stop.
    tilesPerTrail: 260,
    trailLengthFactor: { min: 0.25, max: 0.5 },
    /**
     * Old roads that cross the whole map, not just wander about it (PRD 8.10).
     *
     * Only on the large maps, and for a reason: on a small map the border is a
     * day or two away and a road out would hand the run to the player. On a
     * 128 by 128 map the border is sixty hexes away, which at a sustainable
     * pace is over a month of walking, and no amount of extra water fixes that.
     * A road someone else already cut is what makes such a crossing thinkable.
     */
    roadsFromWidth: 32,
    roadBends: 0.2,
    trailCount: 3,
    trailLength: { min: 4, max: 8 },
  };

  const LOG = { visibleEntries: 8 };

  const START = { health: 10, fatigue: 0, orientation: 6 };

  /**
   * Movement cost of entering a tile (PRD 7.3). Trails and fords override the
   * terrain underneath, which is what makes them worth walking towards.
   */
  /**
   * What one step onto this hex costs (PRD 7.2).
   *
   * `player` is optional and only wounds read it: called without one, this
   * answers what the ground costs an unhurt walker, which is what map
   * generation and the guide want.
   */
  function movementCost(tile, player) {
    if (!tile) return Infinity;
    if (tile.hasTrail || tile.hasFord) return 1;

    const terrain = TERRAIN[tile.type];
    const cost = terrain ? terrain.cost : 1;
    if (!player || !ROUGH_TERRAIN.includes(tile.type)) return cost;

    return cost + conditionEffects(player).roughSurcharge;
  }

  /** Movement points available for a fresh day (PRD 7.2). */
  function movementPointsFor(player) {
    let points = MOVEMENT.base;

    for (const threshold of MOVEMENT.healthPenalties) {
      if (player.health <= threshold) points -= 1;
    }
    for (const threshold of MOVEMENT.fatiguePenalties) {
      if (player.fatigue >= threshold) points -= 1;
    }
    if (player.carryingNpc) points -= MOVEMENT.carryingNpcPenalty;
    points += conditionEffects(player).movement;

    return Math.max(MOVEMENT.minimum, points);
  }

  /** How much of a map of this width is a spring, a forage spot or a cabin. */
  function specialShareFor(width) {
    const step = SPECIAL_SHARE_BY_WIDTH.find((entry) => width >= entry.width);
    return step ? step.share : SPECIAL_SHARE;
  }

  /** How many trails a map of this size should carry (PRD 8.10). */
  function trailCountFor(width, height) {
    return Math.max(MAP.trailCount, Math.round((width * height) / MAP.tilesPerTrail));
  }

  /** How long each of them runs, in hexes. */
  function trailLengthFor(width) {
    return {
      min: Math.max(MAP.trailLength.min, Math.round(width * MAP.trailLengthFactor.min)),
      max: Math.max(MAP.trailLength.max, Math.round(width * MAP.trailLengthFactor.max)),
    };
  }

  /** A named map size, falling back to the standard one. */
  function mapSizeOf(name) {
    return MAP_SIZES[name] || MAP_SIZES[DEFAULT_MAP_SIZE];
  }

  /** How far the player sees right now (PRD 16, WP-28). */
  function visionRadius(player) {
    const match = VISION.find((step) => player.orientation >= step.orientation);
    const radius = match ? match.radius : 1;

    // A fever narrows the world to what is under your feet (PRD 8.16).
    return Math.max(1, radius + conditionEffects(player).vision);
  }

  /** Clamp a resource to its declared range (PRD 6.5). */
  function clampResource(name, value) {
    const range = RESOURCES[name];
    if (!range) return value;
    return Math.min(range.max, Math.max(range.min, value));
  }

  function difficultyOf(name) {
    return DIFFICULTIES[name] || DIFFICULTIES[DEFAULT_DIFFICULTY];
  }

  return {
    TERRAIN,
    TERRAIN_TYPES,
    TERRAIN_MIX,
    SPECIAL_SHARE,
    SPECIAL_SHARE_BY_WIDTH,
    SPECIAL_MIX,
    RESOURCES,
    DIFFICULTIES,
    DEFAULT_DIFFICULTY,
    MOVEMENT,
    FORCED_MARCH,
    END_OF_DAY,
    REST,
    SEARCH,
    TERRAIN_EFFECTS,
    CABIN,
    INVESTIGATE,
    EVENTS,
    CHASE,
    CONDITIONS,
    ROUGH_TERRAIN,
    WEATHER,
    CAMP,
    VISION,
    CHECK_MAP,
    LANDMARK_VISION,
    MARKERS,
    MAP,
    MAP_SIZES,
    DEFAULT_MAP_SIZE,
    LOG,
    START,
    movementCost,
    movementPointsFor,
    visionRadius,
    mapSizeOf,
    trailCountFor,
    trailLengthFor,
    specialShareFor,
    clampResource,
    difficultyOf,
    conditionEffects,
    conditionChangesMovement,
  };
});
