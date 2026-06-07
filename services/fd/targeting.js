/**
 * Targeting Strategies — pluggable functions that select which enemy a tower shoots.
 * Each strategy: (tower, enemies, path) => enemy | null
 *
 * Tower definitions reference a strategy by name (e.g. "nearest", "first").
 */

const TARGETING_STRATEGIES = {
  /** Nearest enemy to the tower (manhattan distance) */
  nearest: (tower, enemies, path) => {
    let best = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      const idx = Math.min(Math.floor(e.pathIndex), path.length - 1);
      const pos = path[idx];
      if (!pos) continue;
      const dist = Math.abs(pos.x - tower.x) + Math.abs(pos.y - tower.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return best;
  },

  /** Enemy furthest along the path (closest to exit) */
  first: (tower, enemies, path) => {
    let best = null;
    let bestIdx = -1;
    for (const e of enemies) {
      if (e.pathIndex > bestIdx) {
        bestIdx = e.pathIndex;
        best = e;
      }
    }
    return best;
  },

  /** Enemy with lowest HP */
  weakest: (tower, enemies, path) => {
    let best = null;
    let bestHp = Infinity;
    for (const e of enemies) {
      if (e.hp < bestHp) {
        bestHp = e.hp;
        best = e;
      }
    }
    return best;
  },

  /** Enemy with highest HP */
  strongest: (tower, enemies, path) => {
    let best = null;
    let bestHp = -1;
    for (const e of enemies) {
      if (e.hp > bestHp) {
        bestHp = e.hp;
        best = e;
      }
    }
    return best;
  },
};

/**
 * Resolve a targeting strategy by name.
 * Falls back to "nearest" if name is unknown.
 */
function resolveTargeting(name) {
  return TARGETING_STRATEGIES[name] || TARGETING_STRATEGIES.nearest;
}

module.exports = { TARGETING_STRATEGIES, resolveTargeting };
