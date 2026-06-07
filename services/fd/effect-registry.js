const { logDebug } = require("../../helpers/logger-api");

/**
 * Effect Registry — pluggable buff/debuff definitions.
 * Each effect has an onApply, onTick, and onExpire lifecycle.
 * Duration is in ticks (0 = instant).
 */
class EffectRegistry {
  constructor() {
    this.effects = new Map();
  }

  /**
   * Register an effect type.
   * @param {string} name
   * @param {object} definition
   * @param {string}   definition.label     - Display name
   * @param {number}   definition.duration  - Duration in ticks (0 = instant)
   * @param {function} definition.onApply   - (enemy) => void — called when effect is applied
   * @param {function} definition.onTick    - (enemy) => void — called each tick while active
   * @param {function} definition.onExpire  - (enemy, originalValue) => void — called when duration expires
   */
  register(name, definition) {
    const entry = {
      name,
      label: definition.label || name,
      duration: definition.duration || 0,
      onApply: definition.onApply || (() => {}),
      onTick: definition.onTick || (() => {}),
      onExpire: definition.onExpire || (() => {}),
    };
    this.effects.set(name, entry);
    logDebug(`[EffectRegistry] Registered effect: ${name}`);
  }

  get(name) {
    return this.effects.get(name);
  }
  has(name) {
    return this.effects.has(name);
  }
  names() {
    return [...this.effects.keys()];
  }
}

// ── Built-in registrations ──────────────────────────────────────────
const effectRegistry = new EffectRegistry();

effectRegistry.register("slow", {
  label: "Slow",
  duration: 4, // 4 ticks ≈ 2 seconds at 500ms tick
  onApply(enemy) {
    enemy._originalSpeed = enemy.speed;
    enemy.speed = enemy.speed * 0.5;
  },
  onExpire(enemy) {
    if (enemy._originalSpeed !== undefined) {
      enemy.speed = enemy._originalSpeed;
      delete enemy._originalSpeed;
    }
  },
});

effectRegistry.register("splash", {
  label: "Splash",
  duration: 0, // instant — handled by tick-engine using tower.splash radius
});

effectRegistry.register("burn", {
  label: "Burn",
  duration: 6, // 6 ticks ≈ 3 seconds at 500ms tick
  onTick(enemy) {
    enemy.hp -= 3; // 3 damage per tick
  },
});

module.exports = { EffectRegistry, effectRegistry };
