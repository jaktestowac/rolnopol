const { logDebug } = require("../../helpers/logger-api");

/**
 * Enemy Registry — pluggable enemy type definitions.
 * Each enemy type is registered at startup and looked up by name.
 * createInstance() builds a runtime enemy object from a type name.
 *
 * Icon convention: FontAwesome solid (fas) class names.
 */
class EnemyRegistry {
  constructor() {
    this.types = new Map();
  }

  register(name, definition) {
    const entry = {
      name,
      label: definition.label || name,
      hp: definition.hp || 30,
      speed: definition.speed || 1,
      reward: definition.reward || 10,
      icon: definition.icon || "fa-bug",
      color: definition.color || null,
      description: definition.description || "",
    };
    this.types.set(name, entry);
    logDebug(`[EnemyRegistry] Registered enemy type: ${name}`);
  }

  get(name) {
    return this.types.get(name);
  }
  list() {
    return [...this.types.values()];
  }
  names() {
    return [...this.types.keys()];
  }
  has(name) {
    return this.types.has(name);
  }

  /**
   * Create a runtime enemy instance from a type name.
   * @param {string} name       - Enemy type key
   * @param {string} id         - Unique instance id
   * @param {object} options    - Optional scaling options
   * @param {number} options.level      - Enemy level (1+), scales HP and speed
   * @param {number} options.hpMult     - Difficulty HP multiplier
   * @param {number} options.speedMult  - Difficulty speed multiplier
   * @param {number} options.rewardMult - Difficulty reward multiplier
   * @returns {object} Runtime enemy object
   */
  createInstance(name, id, options = {}) {
    const def = this.get(name);
    if (!def) throw new Error(`Unknown enemy type: ${name}`);

    const level = options.level || 1;
    const hpMult = options.hpMult || 1;
    const speedMult = options.speedMult || 1;
    const rewardMult = options.rewardMult || 1;

    // Level scaling: +20% HP and +10% speed per level above 1
    const levelHpMult = 1 + (level - 1) * 0.2;
    const levelSpeedMult = 1 + (level - 1) * 0.1;

    const baseHp = Math.floor(def.hp * hpMult * levelHpMult);
    const baseSpeed = def.speed * speedMult * levelSpeedMult;
    const reward = Math.floor(def.reward * rewardMult * levelHpMult);

    return {
      id,
      type: name,
      level,
      hp: baseHp,
      maxHp: baseHp,
      speed: Math.round(baseSpeed * 100) / 100,
      reward,
      pathIndex: 0,
      effects: [],
    };
  }
}

// ── Built-in registrations ──────────────────────────────────────────
const enemyRegistry = new EnemyRegistry();

enemyRegistry.register("grunt", { label: "Grunt", hp: 30, speed: 1, reward: 10, icon: "fa-bug" });
enemyRegistry.register("scout", { label: "Scout", hp: 15, speed: 2, reward: 8, icon: "fa-feather" });
enemyRegistry.register("brute", { label: "Brute", hp: 80, speed: 0.5, reward: 25, icon: "fa-shield" });
enemyRegistry.register("boss", { label: "Boss", hp: 200, speed: 0.5, reward: 100, icon: "fa-dragon" });
enemyRegistry.register("healer", { label: "Healer", hp: 40, speed: 0.8, reward: 20, icon: "fa-heart-pulse" });
enemyRegistry.register("shielded", { label: "Shielded", hp: 60, speed: 0.7, reward: 18, icon: "fa-shield-halved" });
enemyRegistry.register("fast", { label: "Fast", hp: 20, speed: 1.5, reward: 12, icon: "fa-bolt" });
enemyRegistry.register("armored", { label: "Armored", hp: 150, speed: 0.9, reward: 15, icon: "fa-helmet-safety" });
enemyRegistry.register("swarm", { label: "Swarm", hp: 10, speed: 1.2, reward: 5, icon: "fa-bacteria" });
enemyRegistry.register("ghost", { label: "Ghost", hp: 25, speed: 1, reward: 15, icon: "fa-ghost", color: "#aaa" });
enemyRegistry.register("titan", { label: "Titan", hp: 350, speed: 0.4, reward: 150, icon: "fa-gopuram" });
enemyRegistry.register("phantom", { label: "Phantom", hp: 50, speed: 1.8, reward: 30, icon: "fa-wand-sparkles", color: "#c8a2ff" });

module.exports = { EnemyRegistry, enemyRegistry };
