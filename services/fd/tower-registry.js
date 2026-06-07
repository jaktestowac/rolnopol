const { logDebug } = require("../../helpers/logger-api");

/**
 * Tower Registry — pluggable tower type definitions.
 * Each tower type is registered at startup and looked up by name.
 * Adding a new tower = one register() call, zero core changes.
 *
 * Icon convention: FontAwesome solid (fas) class names.
 * Stored as "fa-*" part only; frontend renders as <i class="fas fa-*"></i>
 */
class TowerRegistry {
  constructor() {
    this.types = new Map();
  }

  /**
   * Register a tower type.
   * @param {string} name       - Unique key: "archer", "cannon", "frost"
   * @param {object} definition - Tower definition object
   */
  register(name, definition) {
    const entry = {
      name,
      label: definition.label || name,
      cost: definition.cost || 50,
      range: definition.range || 3,
      damage: definition.damage || 10,
      fireRate: definition.fireRate || 1,
      targeting: definition.targeting || "nearest",
      onHit: definition.onHit || null,
      splash: definition.splash || 0,
      icon: definition.icon || "fa-chess-rook",
      description: definition.description || "",
    };
    this.types.set(name, entry);
    logDebug(`[TowerRegistry] Registered tower type: ${name}`);
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
}

// ── Built-in registrations ──────────────────────────────────────────
const towerRegistry = new TowerRegistry();

towerRegistry.register("archer", {
  label: "Archer",
  cost: 50,
  range: 3,
  damage: 10,
  fireRate: 1,
  targeting: "nearest",
  icon: "fa-bullseye",
  description: "Basic tower. Reliable damage.",
});

towerRegistry.register("cannon", {
  label: "Cannon",
  cost: 100,
  range: 2,
  damage: 30,
  fireRate: 0.5,
  targeting: "nearest",
  splash: 1,
  icon: "fa-bomb",
  description: "Slow but powerful. Splash damage.",
});

towerRegistry.register("frost", {
  label: "Frost",
  cost: 75,
  range: 3,
  damage: 5,
  fireRate: 1,
  targeting: "nearest",
  onHit: ["slow"],
  icon: "fa-snowflake",
  description: "Slows enemies. Low damage.",
});

towerRegistry.register("fire", {
  label: "Fire",
  cost: 120,
  range: 2,
  damage: 15,
  fireRate: 0.8,
  targeting: "nearest",
  onHit: ["burn"],
  icon: "fa-fire",
  description: "Burns enemies over time.",
});

towerRegistry.register("lightning", {
  label: "Lightning",
  cost: 150,
  range: 3,
  damage: 12,
  fireRate: 0.6,
  targeting: "nearest",
  chain: 2,
  icon: "fa-bolt",
  description: "Chain lightning hits multiple enemies.",
});

module.exports = { TowerRegistry, towerRegistry };
