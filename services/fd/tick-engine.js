const { logDebug } = require("../../helpers/logger-api");
const { resolveTargeting } = require("./targeting");

/**
 * Tick Engine — ordered pipeline of simulation steps.
 * Each step is a pure function: (state, registries) => void
 * Steps are registered with an execution order and run in sequence.
 *
 * Extensible: registerStep("healAura", 25, fn) inserts between move(20) and target(30).
 */

class TickEngine {
  constructor() {
    this.steps = [];
    this.registerBuiltInSteps();
  }

  /**
   * Register a tick step.
   * @param {string}   name  - Step name (for debugging)
   * @param {number}   order - Execution order (lower = earlier)
   * @param {function} step  - (state, registries) => void
   */
  registerStep(name, order, step) {
    this.steps.push({ name, order, step });
    this.steps.sort((a, b) => a.order - b.order);
    logDebug(`[TickEngine] Registered step: ${name} (order: ${order})`);
  }

  /**
   * Run all steps in order.
   * @param {object} state     - Mutable game state
   * @param {object} registries - { towerRegistry, enemyRegistry, effectRegistry }
   */
  run(state, registries) {
    for (const { step } of this.steps) {
      step(state, registries);
    }
  }

  registerBuiltInSteps() {
    this.registerStep("spawn", 10, spawnEnemies);
    this.registerStep("move", 20, moveEnemies);
    this.registerStep("target", 30, processTowers);
    this.registerStep("projectile", 40, processProjectiles);
    this.registerStep("damage", 50, applyDamage);
    this.registerStep("effects", 55, processEffects);
    this.registerStep("cleanup", 60, cleanupDead);
    this.registerStep("leaks", 70, checkLeaks);
    this.registerStep("waveEnd", 80, checkWaveComplete);
    this.registerStep("endCheck", 90, checkEndConditions);
  }
}

// ── Step implementations (pure functions, testable independently) ────

function spawnEnemies(state, { enemyRegistry }) {
  if (state.wave.status !== "active") return;
  if (state.wave.spawnTimer > 0) {
    state.wave.spawnTimer--;
    return;
  }
  if (state.wave.enemiesSpawned >= state.wave.enemiesTotal) return;

  const type = state.wave.queue[state.wave.enemiesSpawned];
  if (!type) return;

  // Calculate enemy level based on wave number
  const level = Math.max(1, Math.ceil(state.wave.current / 3));

  // Get difficulty multipliers from state
  const diffPreset = state._difficultyPreset || { hpMultiplier: 1, speedMultiplier: 1, rewardMultiplier: 1 };

  const enemy = enemyRegistry.createInstance(type, `enemy-${++state._counters.enemyId}`, {
    level,
    hpMult: diffPreset.hpMultiplier,
    speedMult: diffPreset.speedMultiplier,
    rewardMult: diffPreset.rewardMultiplier,
  });

  state.enemies.push(enemy);
  state.wave.enemiesSpawned++;
  state.wave.spawnTimer = 2; // Spawn gap between enemies
}

function moveEnemies(state) {
  for (const enemy of state.enemies) {
    enemy.pathIndex += enemy.speed;
  }
}

function processTowers(state, { towerRegistry }) {
  for (const tower of state.towers) {
    if (tower.cooldown > 0) {
      tower.cooldown--;
      continue;
    }

    const def = towerRegistry.get(tower.type);
    if (!def) continue;

    // Find enemies in range
    const candidates = getEnemiesInRange(tower, def.range, state.enemies, state.map.path);
    if (candidates.length === 0) continue;

    // Resolve targeting strategy
    const strategy = resolveTargeting(def.targeting);
    const target = strategy(tower, candidates, state.map.path);
    if (!target) continue;

    // Create projectile
    state.projectiles.push({
      id: `proj-${++state._counters.projId}`,
      fromX: tower.x,
      fromY: tower.y,
      targetId: target.id,
      damage: def.damage,
      towerType: tower.type,
      onHit: def.onHit,
      splash: def.splash,
      progress: 0,
    });

    tower.cooldown = Math.max(1, Math.round(1 / def.fireRate));
  }
}

function processProjectiles(state) {
  for (const proj of state.projectiles) {
    if (proj.progress < 1) {
      proj.progress += 0.5; // 2 ticks to arrive
    }
  }
}

function applyDamage(state, { effectRegistry }) {
  for (const proj of state.projectiles) {
    if (proj.progress < 1) continue;

    const target = state.enemies.find((e) => e.id === proj.targetId);
    if (!target) continue;

    target.hp -= proj.damage;
    state.stats.totalDamageDealt += proj.damage;

    // Apply on-hit effects
    if (proj.onHit && effectRegistry) {
      for (const effectName of proj.onHit) {
        const effect = effectRegistry.get(effectName);
        if (effect && effect.onApply) {
          effect.onApply(target);
          if (effect.duration > 0) {
            target.effects.push({
              name: effectName,
              remaining: effect.duration,
              originalValue: target._originalSpeed,
            });
          }
        }
      }
    }

    // Splash damage
    if (proj.splash > 0) {
      const targetIdx = Math.min(Math.floor(target.pathIndex), state.map.path.length - 1);
      const targetPos = state.map.path[targetIdx];
      if (targetPos) {
        for (const other of state.enemies) {
          if (other.id === target.id) continue;
          const otherIdx = Math.min(Math.floor(other.pathIndex), state.map.path.length - 1);
          const otherPos = state.map.path[otherIdx];
          if (!otherPos) continue;
          const dist = Math.abs(otherPos.x - targetPos.x) + Math.abs(otherPos.y - targetPos.y);
          if (dist <= proj.splash) {
            other.hp -= Math.floor(proj.damage * 0.5);
          }
        }
      }
    }
  }
}

function processEffects(state, { effectRegistry }) {
  if (!effectRegistry) return;
  for (const enemy of state.enemies) {
    for (let i = enemy.effects.length - 1; i >= 0; i--) {
      const eff = enemy.effects[i];
      const def = effectRegistry.get(eff.name);
      if (!def) continue;
      if (def.onTick) def.onTick(enemy);
      eff.remaining--;
      if (eff.remaining <= 0) {
        if (def.onExpire) def.onExpire(enemy, eff.originalValue);
        enemy.effects.splice(i, 1);
      }
    }
  }
}

function cleanupDead(state) {
  const alive = [];
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) {
      state.resources.gold += enemy.reward;
      state.stats.enemiesKilled++;
    } else {
      alive.push(enemy);
    }
  }
  state.enemies = alive;
  // Remove arrived projectiles
  state.projectiles = state.projectiles.filter((p) => p.progress < 1);
}

function checkLeaks(state) {
  const onPath = [];
  for (const enemy of state.enemies) {
    if (enemy.pathIndex >= state.map.path.length - 1) {
      state.resources.lives--;
      state.stats.enemiesLeaked++;
    } else {
      onPath.push(enemy);
    }
  }
  state.enemies = onPath;
}

function checkWaveComplete(state) {
  if (state.wave.status !== "active") return;
  if (state.wave.enemiesSpawned >= state.wave.enemiesTotal && state.enemies.length === 0) {
    state.wave.status = "complete";
    state.stats.wavesCompleted++;
  }
}

function checkEndConditions(state) {
  if (state.resources.lives <= 0) {
    state.stats.gameOver = true;
  }
  if (state.wave.current >= state.wave.total && state.wave.status === "complete") {
    state.stats.victory = true;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function getEnemiesInRange(tower, range, enemies, path) {
  const result = [];
  for (const e of enemies) {
    const idx = Math.min(Math.floor(e.pathIndex), path.length - 1);
    const pos = path[idx];
    if (!pos) continue;
    const dist = Math.abs(pos.x - tower.x) + Math.abs(pos.y - tower.y);
    if (dist <= range) {
      result.push(e);
    }
  }
  return result;
}

module.exports = { TickEngine };
