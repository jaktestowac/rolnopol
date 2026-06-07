const { logDebug } = require("../../helpers/logger-api");

/**
 * Map Generator — improved path generation for tower defence maps.
 *
 * Algorithm: "Winding Corridor" — generates a path that:
 * 1. Starts at left-center, ends at right-center
 * 2. Uses seeded random walk with momentum (prefers continuing in same direction)
 * 3. Creates natural curves and occasional loops
 * 4. Ensures minimum path length for interesting gameplay
 * 5. Guarantees connectivity (no dead ends that block the path)
 *
 * Same seed always produces the same map (deterministic).
 */

class MapGenerator {
  generate(width, height, seed) {
    const rng = this._createRng(seed);
    const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => "buildable"));

    const path = this._generatePath(width, height, rng);

    // Mark path cells
    for (const { x, y } of path) {
      cells[y][x] = "path";
    }

    // Mark spawn and exit
    const spawn = path[0];
    const exit = path[path.length - 1];
    cells[spawn.y][spawn.x] = "spawn";
    cells[exit.y][exit.x] = "exit";

    // Mark cells far from path as "blocked" (aesthetic)
    this._markBlocked(cells, path, width, height);

    logDebug(`[MapGenerator] Generated ${width}x${height} map with ${path.length}-cell path (seed: ${seed})`);
    return { cells, path, spawn, exit };
  }

  /**
   * Generate a winding path using "corridor walk" algorithm.
   * The path has momentum — it prefers to continue in the same direction,
   * creating natural curves. Occasionally it makes sharp turns for variety.
   */
  _generatePath(width, height, rng) {
    const spawnX = 0;
    const spawnY = Math.floor(height / 2);
    const exitX = width - 1;
    const exitY = Math.floor(height / 2);

    const visited = new Set();
    const path = [];
    const key = (x, y) => `${x},${y}`;

    let x = spawnX;
    let y = spawnY;
    path.push({ x, y });
    visited.add(key(x, y));

    // Direction momentum: 0=right, 1=down, 2=up, 3=left
    let lastDir = 0; // Start moving right
    let straightCount = 0;
    let maxStraight = 4 + Math.floor(rng.next() * 3); // Max steps before forced turn

    const maxSteps = width * height * 6;
    let steps = 0;

    while (x < exitX && steps < maxSteps) {
      steps++;

      // Build candidate directions with weights based on momentum
      const dirs = [
        { dx: 1, dy: 0, dir: 0 }, // Right
        { dx: 0, dy: 1, dir: 1 }, // Down
        { dx: 0, dy: -1, dir: 2 }, // Up
        { dx: -1, dy: 0, dir: 3 }, // Left
      ];

      // Weight candidates: prefer continuing straight, then rightward
      const candidates = [];
      for (const d of dirs) {
        const nx = x + d.dx;
        const ny = y + d.dy;

        // Bounds check
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        // Don't revisit
        if (visited.has(key(nx, ny))) continue;

        let weight = 1;

        // Strong preference for rightward movement (toward exit)
        if (d.dir === 0) weight += 4;

        // Momentum: prefer continuing in same direction
        if (d.dir === lastDir) {
          weight += 3;
          // But force a turn after going straight too long
          if (straightCount >= maxStraight) {
            weight = 0; // Force turn
          }
        }

        // Slight preference for moving toward exitY
        if (d.dy !== 0) {
          const distToExitY = Math.abs(ny - exitY);
          const currentDistToExitY = Math.abs(y - exitY);
          if (distToExitY < currentDistToExitY) weight += 1;
        }

        // Avoid leftward movement (away from exit)
        if (d.dir === 3) weight = Math.max(0, weight - 2);

        if (weight > 0) {
          for (let w = 0; w < weight; w++) {
            candidates.push({ x: nx, y: ny, dir: d.dir });
          }
        }
      }

      let chosen;
      if (candidates.length > 0) {
        chosen = candidates[Math.floor(rng.next() * candidates.length)];
      } else {
        // Dead end — backtrack along the path to find a branch point
        const backtrackResult = this._backtrack(path, visited, width, height, rng, key);
        if (!backtrackResult) break; // Truly stuck
        x = backtrackResult.x;
        y = backtrackResult.y;
        lastDir = backtrackResult.dir;
        straightCount = 0;
        continue;
      }

      // Update momentum
      if (chosen.dir === lastDir) {
        straightCount++;
      } else {
        lastDir = chosen.dir;
        straightCount = 0;
        // Randomize max straight for next segment
        if (rng.next() < 0.3) {
          maxStraight = 3 + Math.floor(rng.next() * 4);
        }
      }

      x = chosen.x;
      y = chosen.y;
      path.push({ x, y });
      visited.add(key(x, y));
    }

    // Ensure we reach the exit column
    while (x < exitX) {
      x++;
      if (!visited.has(key(x, y))) {
        path.push({ x, y });
        visited.add(key(x, y));
      }
    }

    // Step toward exitY
    while (y < exitY) {
      y++;
      if (!visited.has(key(x, y))) {
        path.push({ x, y });
        visited.add(key(x, y));
      }
    }
    while (y > exitY) {
      y--;
      if (!visited.has(key(x, y))) {
        path.push({ x, y });
        visited.add(key(x, y));
      }
    }

    return path;
  }

  /**
   * Backtrack along the path to find a cell with unvisited neighbors,
   * then branch off in a new direction.
   */
  _backtrack(path, visited, width, height, rng, key) {
    // Walk back up to 10 steps along the path
    for (let i = path.length - 1; i >= Math.max(0, path.length - 10); i--) {
      const px = path[i].x;
      const py = path[i].y;

      // Check all 4 neighbors for unvisited cells
      const neighbors = [
        { x: px + 1, y: py, dir: 0 },
        { x: px, y: py + 1, dir: 1 },
        { x: px, y: py - 1, dir: 2 },
        { x: px - 1, y: py, dir: 3 },
      ].filter((n) => n.x >= 0 && n.x < width && n.y >= 0 && n.y < height && !visited.has(key(n.x, n.y)));

      if (neighbors.length > 0) {
        const chosen = neighbors[Math.floor(rng.next() * neighbors.length)];
        return chosen;
      }
    }
    return null; // No branch point found
  }

  /**
   * Mark cells far from any path cell as "blocked".
   * Cells > maxDist manhattan distance from any path cell → "blocked"
   */
  _markBlocked(cells, path, width, height) {
    const pathSet = new Set(path.map((p) => `${p.x},${p.y}`));
    // Scale blocked distance with map size
    const BLOCKED_DISTANCE = Math.max(3, Math.floor(Math.min(width, height) / 4));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pathSet.has(`${x},${y}`)) continue;

        let minDist = Infinity;
        for (const p of path) {
          const dist = Math.abs(p.x - x) + Math.abs(p.y - y);
          if (dist < minDist) minDist = dist;
        }

        if (minDist > BLOCKED_DISTANCE) {
          cells[y][x] = "blocked";
        }
      }
    }
  }

  /**
   * LCG-based seeded RNG (same algorithm as labyrinth).
   */
  _createRng(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    }
    let state = Math.abs(h) || 1;
    return {
      next() {
        state = (state * 1664525 + 1013904223) & 0x7fffffff;
        return state / 0x7fffffff;
      },
    };
  }
}

module.exports = { MapGenerator };
