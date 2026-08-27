/**
 * Rolnopol Survival — procedural map generation (PRD 6.11, WP-01, WP-02, WP-36).
 *
 * The generator is a pure function of the seed. Same seed in, same map out, on
 * the server and in the browser alike, which is why the backend only stores the
 * seed and never a copy of the map.
 *
 * Terrain counts are exact by construction: the mix from the config is turned
 * into a bag of tile types, shuffled, and then clustered by *swapping* tiles.
 * Swapping never changes the counts, so the proportions survive the pass that
 * makes the map look like terrain instead of noise.
 *
 * A generated map still has to be playable. The validation from PRD 6.11 runs
 * after generation, and a map that fails it is thrown away and generated again
 * from a derived seed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rng.js"), require("./hex.js"), require("./config.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.mapGenerator = factory(root.Survival.rng, root.Survival.hex, root.Survival.config);
  }
})(typeof self !== "undefined" ? self : globalThis, function (rngModule, hex, config) {
  "use strict";

  /** Look a tile up by axial coordinates. Returns null outside the map. */
  function tileAt(map, q, r) {
    const index = map.byKey[hex.key(q, r)];
    return index === undefined ? null : map.tiles[index];
  }

  function buildIndex(map) {
    map.byKey = {};
    map.tiles.forEach((tile, index) => {
      map.byKey[hex.key(tile.q, tile.r)] = index;
    });

    // Neighbours by index, worked out once. The smoothing pass asks for them
    // millions of times on a large map, and doing it through string keys was
    // most of what made a 128 by 128 map slow to generate.
    map.neighborIndex = map.tiles.map((tile) =>
      hex
        .neighbors(tile.q, tile.r)
        .map((spot) => map.byKey[hex.key(spot.q, spot.r)])
        .filter((index) => index !== undefined),
    );

    return map;
  }

  /**
   * Exact tile count per terrain type, plus the tiles reserved for special
   * locations. Specials are open ground carrying a cabin, a spring or a forage
   * spot, so they come out of the open share rather than being a terrain of
   * their own — that is what keeps the mix in PRD 8.1 adding up to 100%.
   * Rounding leftovers land on open ground, the one type always affordable.
   */
  function terrainCounts(total, width) {
    const counts = {};
    let assigned = 0;

    for (const type of Object.keys(config.TERRAIN_MIX)) {
      if (type === "open") continue;
      counts[type] = Math.round(config.TERRAIN_MIX[type] * total);
      assigned += counts[type];
    }

    // Wider map, denser resupply (PRD 8.10). Without the width the caller gets
    // the standard share, which is what every small map wants anyway.
    counts.special = Math.round(config.specialShareFor(width || 0) * total);
    counts.open = total - assigned - counts.special;
    return counts;
  }

  function terrainBag(total, width) {
    const counts = terrainCounts(total, width);
    const bag = [];

    for (const type of Object.keys(counts)) {
      if (type === "special") continue;
      for (let i = 0; i < counts[type]; i += 1) bag.push(type);
    }
    // The reserved specials start life as open ground; placeSpecials marks them.
    for (let i = 0; i < counts.special; i += 1) bag.push("open");
    return bag;
  }

  function freshTile(col, row, type) {
    const axial = hex.offsetToAxial(col, row);
    return {
      q: axial.q,
      r: axial.r,
      col,
      row,
      type,
      hasTrail: false,
      hasFord: false,
      hasCabin: false,
      hasWaterSource: false,
      hasFoodSource: false,
      marker: null,
      markerInspected: false,
      // Fog of war (WP-28): the game reveals what the player can see.
      revealed: false,
      visited: false,
      searchedWater: false,
      searchedFood: false,
    };
  }

  function sameNeighbourCount(map, index, type) {
    const neighbours = map.neighborIndex[index];
    let count = 0;

    for (let i = 0; i < neighbours.length; i += 1) {
      if (map.tiles[neighbours[i]].type === type) count += 1;
    }
    return count;
  }

  /**
   * Cluster terrain by swapping tile types. A swap is kept only when it puts
   * more like next to like, so the tile counts stay exactly where the bag put
   * them while the map stops looking like static.
   */
  function smooth(map, rng) {
    const passes = config.MAP.smoothingPasses;

    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 0; i < map.tiles.length; i += 1) {
        const j = rng.int(map.tiles.length);
        const a = map.tiles[i];
        const b = map.tiles[j];
        if (i === j || a.type === b.type) continue;

        const before = sameNeighbourCount(map, i, a.type) + sameNeighbourCount(map, j, b.type);
        const after = sameNeighbourCount(map, i, b.type) + sameNeighbourCount(map, j, a.type);

        if (after > before) {
          const swapped = a.type;
          a.type = b.type;
          b.type = swapped;
        }
      }
    }
  }

  /**
   * Turn the river tiles into an actual watercourse (WP-64).
   *
   * Smoothing leaves rivers as puddles, which makes a ford meaningless: there is
   * nothing to cross. This walks a course from one edge towards another and then
   * *swaps* types along it, so the terrain counts from the bag survive exactly
   * while every river tile ends up next to another one.
   */
  function carveRiver(map, rng) {
    const existing = map.tiles.filter((tile) => tile.type === "river");
    if (existing.length === 0) return;

    // Grow the course one tile at a time from a border, each new tile touching
    // the last. Growing beats walking: a walk can bounce between two tiles it
    // has already been to and never finish.
    const border = map.tiles.filter((tile) => hex.edgeSides(tile, map.width, map.height).length > 0);
    const heading = hex.DIRECTIONS[rng.int(hex.DIRECTIONS.length)];
    let tip = border[rng.int(border.length)];

    const course = [tip];
    const seen = new Set([hex.key(tip.q, tip.r)]);

    function freshNeighbours(tile) {
      return hex
        .neighbors(tile.q, tile.r)
        .map((spot) => tileAt(map, spot.q, spot.r))
        .filter((candidate) => candidate && !seen.has(hex.key(candidate.q, candidate.r)));
    }

    while (course.length < existing.length) {
      let next = null;

      // Mostly hold the heading, so the result reads as a river rather than a
      // stain; `riverBends` is how often it wanders.
      if (rng.next() >= config.MAP.riverBends) {
        const straight = tileAt(map, tip.q + heading.q, tip.r + heading.r);
        if (straight && !seen.has(hex.key(straight.q, straight.r))) next = straight;
      }

      if (!next) {
        const options = freshNeighbours(tip);
        if (options.length) next = options[rng.int(options.length)];
      }

      // The tip is boxed in by its own course: grow from anywhere along it.
      if (!next) {
        const frontier = course.flatMap(freshNeighbours);
        if (frontier.length === 0) break;
        next = frontier[rng.int(frontier.length)];
      }

      seen.add(hex.key(next.q, next.r));
      course.push(next);
      tip = next;
    }

    // Every tile the course claims hands its old terrain to a river tile left
    // stranded elsewhere, so the bag's proportions come out untouched.
    const stranded = existing.filter((candidate) => !seen.has(hex.key(candidate.q, candidate.r)));
    let spare = 0;

    for (const step of course) {
      if (step.type === "river") continue;
      const donor = stranded[spare];
      if (!donor) break;
      spare += 1;

      donor.type = step.type;
      step.type = "river";
    }
  }

  /**
   * Cabins, springs and foraging spots. They only ever land on open ground,
   * because terrainCounts() reserved exactly this many open tiles for them.
   */
  function placeSpecials(map, rng) {
    const wanted = terrainCounts(map.tiles.length, map.width).special;
    const candidates = map.tiles.filter((tile) => tile.type === "open");
    rng.shuffle(candidates);

    // Counted out rather than dealt round-robin, so the mix in the config is
    // the mix on the map (PRD 8.10).
    const mix = config.SPECIAL_MIX;
    const forage = Math.round(wanted * mix.forage);
    const spring = Math.round(wanted * mix.spring);

    for (let i = 0; i < wanted && i < candidates.length; i += 1) {
      const tile = candidates[i];

      if (i < forage) {
        tile.hasFoodSource = true;
      } else if (i < forage + spring) {
        tile.hasWaterSource = true;
      } else {
        tile.hasCabin = true;
        tile.hasWaterSource = true;
      }
    }
  }

  /**
   * Trails are the only way to cross bad terrain cheaply, so they are what turns
   * the map into a set of routes rather than a cost field. A trail crossing a
   * river leaves a ford behind.
   */
  function carveTrails(map, rng) {
    // Big country first gets its roads, then the local paths on top.
    if (map.width >= config.MAP.roadsFromWidth) {
      carveRoad(map, rng, hex.DIRECTIONS[0]);
      carveRoad(map, rng, hex.DIRECTIONS[rng.int(hex.DIRECTIONS.length)]);
    }

    const count = config.trailCountFor(map.width, map.height);
    const length = config.trailLengthFor(map.width);

    for (let t = 0; t < count; t += 1) {
      let tile = map.tiles[rng.int(map.tiles.length)];
      const steps = rng.range(length.min, length.max);

      for (let step = 0; step < steps && tile; step += 1) {
        tile.hasTrail = true;
        if (tile.type === "river") tile.hasFord = true;

        const options = hex
          .neighbors(tile.q, tile.r)
          .map((spot) => tileAt(map, spot.q, spot.r))
          .filter(Boolean);
        tile = options.length ? options[rng.int(options.length)] : null;
      }
    }
  }

  /**
   * Cut a road right across the map, through the middle (PRD 8.10).
   *
   * A trail wanders and ends; a road starts at one border, passes the ground the
   * player wakes on, and comes out the other side. It is the difference between
   * a large map being long and a large map being impossible: trail hexes cost
   * one point and cost no fatigue, so a road is roughly twice the daily distance
   * of open country and none of the wear.
   */
  function carveRoad(map, rng, heading) {
    const centre = hex.offsetToAxial(Math.floor(map.width / 2), Math.floor(map.height / 2));
    const back = { q: -heading.q, r: -heading.r };

    for (const direction of [heading, back]) {
      let tile = tileAt(map, centre.q, centre.r);

      while (tile) {
        tile.hasTrail = true;
        if (tile.type === "river") tile.hasFord = true;

        // Mostly straight, with enough of a bend that it reads as a road rather
        // than a ruler.
        const bend = rng.next() < config.MAP.roadBends;
        const step = bend ? hex.DIRECTIONS[rng.int(hex.DIRECTIONS.length)] : direction;
        const next = tileAt(map, tile.q + step.q, tile.r + step.r);

        tile = next || tileAt(map, tile.q + direction.q, tile.r + direction.r);
      }
    }
  }

  /** Tiles the player can reach ignoring the daily budget, PRD 6.11. */
  function reachableFrom(map, start) {
    const limit = config.MAP.reachableCostLimit;
    const seen = new Set([hex.key(start.q, start.r)]);
    const queue = [start];
    const reached = [];

    // Walked with an index rather than `shift()`. On a 128 by 128 map the queue
    // holds thousands of tiles and shifting each one off the front is O(n),
    // which turned a linear sweep into a quadratic one.
    for (let head = 0; head < queue.length; head += 1) {
      const tile = queue[head];
      reached.push(tile);

      for (const spot of hex.neighbors(tile.q, tile.r)) {
        const next = tileAt(map, spot.q, spot.r);
        if (!next) continue;
        const id = hex.key(next.q, next.r);
        if (seen.has(id)) continue;
        if (config.movementCost(next) > limit) continue;
        seen.add(id);
        queue.push(next);
      }
    }

    return reached;
  }

  function hasWaterNear(map, start) {
    return map.tiles.some(
      (tile) => (tile.type === "river" || tile.hasWaterSource) && hex.distance(tile, start) <= config.MAP.waterSearchRadius,
    );
  }

  /**
   * Where the player wakes up: the dead centre of the map (PRD 6.11), never on a
   * swamp or a mountain.
   *
   * The radius only widens when the centre tile itself is unusable, and then by
   * one ring at a time. Falling back to "any passable tile" would happily wake
   * the player in a corner, two steps from the border they are trying to reach.
   */
  function chooseStart(map, rng) {
    const centre = { col: Math.floor(map.width / 2), row: Math.floor(map.height / 2) };
    const centreAxial = hex.offsetToAxial(centre.col, centre.row);
    const passable = map.tiles.filter((tile) => tile.type !== "swamp" && tile.type !== "mountain");
    const limit = Math.floor(Math.min(map.width, map.height) / 4);

    for (let radius = config.MAP.startRadius; radius <= limit; radius += 1) {
      const candidates = passable.filter((tile) => hex.distance(tile, centreAxial) <= radius);
      if (candidates.length > 0) return candidates[rng.int(candidates.length)];
    }

    return passable[0] || map.tiles[0];
  }

  /** One generation attempt, before validation. */
  function buildCandidate(seed, attempt, width, height) {
    const rng = rngModule.createRng(seed).derive(attempt);
    const bag = rng.shuffle(terrainBag(width * height, width));

    const map = { width, height, tiles: [], byKey: {} };
    let index = 0;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        map.tiles.push(freshTile(col, row, bag[index]));
        index += 1;
      }
    }
    buildIndex(map);

    smooth(map, rng);
    carveRiver(map, rng);
    placeSpecials(map, rng);
    carveTrails(map, rng);

    const start = chooseStart(map, rng);
    map.start = { q: start.q, r: start.r };
    return map;
  }

  /**
   * Check a candidate against PRD 6.11. `relaxWater` is what the generator falls
   * back to after ten refusals: a hard map beats a map that never appears.
   */
  function validate(map, options) {
    const relaxWater = !!(options && options.relaxWater);
    const start = tileAt(map, map.start.q, map.start.r);
    const problems = [];

    if (!start) return { ok: false, problems: ["no-start"] };
    if (start.type === "swamp" || start.type === "mountain") problems.push("start-terrain");

    const sides = new Set();
    for (const tile of reachableFrom(map, start)) {
      for (const side of hex.edgeSides(tile, map.width, map.height)) sides.add(side);
    }
    if (sides.size < config.MAP.minReachableEdgeSides) problems.push("edges");

    if (!relaxWater && !hasWaterNear(map, start)) problems.push("water");

    return { ok: problems.length === 0, problems, reachableSides: Array.from(sides) };
  }

  /**
   * Generate a playable map for a seed.
   * Returns the map plus how it was reached: `attempts` and, when the water
   * rule had to be dropped, `relaxed`.
   */
  function generateMap(options) {
    const settings = options || {};
    const width = settings.width || config.MAP.width;
    const height = settings.height || config.MAP.height;
    const seed = settings.seed;
    const maxAttempts = settings.maxAttempts || config.MAP.maxGenerationAttempts;

    let last = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = buildCandidate(seed, attempt, width, height);
      const verdict = validate(candidate, { relaxWater: false });
      last = candidate;
      if (verdict.ok) {
        candidate.attempts = attempt + 1;
        candidate.relaxed = [];
        return candidate;
      }
    }

    // Ten refusals in a row means the seed cannot afford water near the start.
    // Drop that rule, keep the rest, and say so out loud in the result.
    for (let attempt = maxAttempts; attempt < maxAttempts * 2; attempt += 1) {
      const candidate = buildCandidate(seed, attempt, width, height);
      const verdict = validate(candidate, { relaxWater: true });
      last = candidate;
      if (verdict.ok) {
        candidate.attempts = attempt + 1;
        candidate.relaxed = ["water"];
        return candidate;
      }
    }

    last.attempts = maxAttempts * 2;
    last.relaxed = ["water", "edges"];
    return last;
  }

  return {
    generateMap,
    validate,
    reachableFrom,
    hasWaterNear,
    tileAt,
    buildIndex,
    terrainBag,
    terrainCounts,
    carveRiver,
    carveRoad,
  };
});
