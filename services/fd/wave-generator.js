const { logDebug } = require("../../helpers/logger-api");

/**
 * Wave Generator — pluggable wave generation strategies with difficulty scaling
 * and enemy level progression.
 *
 * Enemy levels: each enemy spawned in wave N gets level = ceil(N / 3).
 * Level scaling: +20% HP and +10% speed per level above 1.
 *
 * Difficulty presets:
 *   easy    — 0.7x HP, 0.8x speed, 1.3x gold
 *   normal  — 1.0x HP, 1.0x speed, 1.0x gold
 *   hard    — 1.5x HP, 1.3x speed, 0.8x gold
 *   insane  — 2.0x HP, 1.6x speed, 0.6x gold, -50g, -5 lives
 *
 * Enemy tiers (unlock by wave):
 *   Tier 1 (wave 1+):  grunt, scout
 *   Tier 2 (wave 3+):  brute, fast, swarm
 *   Tier 3 (wave 5+):  healer, shielded, armored
 *   Tier 4 (wave 8+):  ghost, titan
 *   Tier 5 (wave 12+): phantom, boss
 */

const DIFFICULTY_PRESETS = {
  easy: {
    label: "Easy",
    hpMultiplier: 0.7,
    speedMultiplier: 0.8,
    goldMultiplier: 1.3,
    rewardMultiplier: 1.2,
    startGoldBonus: 100,
    livesBonus: 5,
    description: "Relaxed farming. Weaker enemies, more gold.",
  },
  normal: {
    label: "Normal",
    hpMultiplier: 1.0,
    speedMultiplier: 1.0,
    goldMultiplier: 1.0,
    rewardMultiplier: 1.0,
    startGoldBonus: 0,
    livesBonus: 0,
    description: "Balanced challenge.",
  },
  hard: {
    label: "Hard",
    hpMultiplier: 1.5,
    speedMultiplier: 1.3,
    goldMultiplier: 0.8,
    rewardMultiplier: 0.9,
    startGoldBonus: -25,
    livesBonus: -3,
    description: "Tough enemies, less gold. For experienced farmers.",
  },
  insane: {
    label: "Insane",
    hpMultiplier: 2.0,
    speedMultiplier: 1.6,
    goldMultiplier: 0.6,
    rewardMultiplier: 0.8,
    startGoldBonus: -50,
    livesBonus: -5,
    description: "Brutal. Enemies are fast, tanky, and relentless. Good luck.",
  },
};

const GAME_MODES = {
  classic: {
    label: "Classic",
    description: "Finite waves. Clear all waves to win.",
    infinite: false,
  },
  endless: {
    label: "Endless",
    description: "Infinite waves. Survive as long as you can.",
    infinite: true,
  },
  rush: {
    label: "Rush",
    description: "Fast waves with bonus gold. High intensity.",
    infinite: false,
    spawnGap: 1,
    goldMultiplier: 1.5,
  },
};

// Enemy tier definitions — which enemies appear at which wave
// Boss is special: it's added separately every N waves, but also
// available for random selection at higher tiers.
const ENEMY_TIERS = {
  tier1: { waves: [1, Infinity], enemies: ["grunt", "scout"] },
  tier2: { waves: [3, Infinity], enemies: ["brute", "fast", "swarm"] },
  tier3: { waves: [5, Infinity], enemies: ["healer", "shielded", "armored"] },
  tier4: { waves: [8, Infinity], enemies: ["ghost", "titan"] },
  tier5: { waves: [12, Infinity], enemies: ["phantom"] },
};

class WaveGenerator {
  constructor() {
    this.strategies = new Map();
    this.registerBuiltInStrategies();
  }

  registerStrategy(name, generator) {
    this.strategies.set(name, generator);
    logDebug(`[WaveGenerator] Registered strategy: ${name}`);
  }

  generate(waveNumber, totalWaves, { strategy = "classic", difficulty = "normal", rng } = {}) {
    const gen = this.strategies.get(strategy) || this.strategies.get("classic");
    return gen(waveNumber, totalWaves, rng, difficulty);
  }

  /**
   * Get the enemy level for a given wave.
   * Level = ceil(wave / 3), so wave 1-3 = level 1, wave 4-6 = level 2, etc.
   */
  getEnemyLevel(waveNumber) {
    return Math.max(1, Math.ceil(waveNumber / 3));
  }

  /**
   * Get available enemy types for a given wave (based on tier unlocks).
   */
  getAvailableEnemies(waveNumber) {
    const available = [];
    const tiers = Object.values(ENEMY_TIERS);
    for (let i = 0; i < tiers.length; i++) {
      if (waveNumber >= tiers[i].waves[0]) {
        for (let j = 0; j < tiers[i].enemies.length; j++) {
          available.push(tiers[i].enemies[j]);
        }
      }
    }
    return available;
  }

  getDifficulty(difficulty = "normal") {
    return DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
  }

  getGameMode(mode = "classic") {
    return GAME_MODES[mode] || GAME_MODES.classic;
  }

  listDifficulties() {
    return Object.entries(DIFFICULTY_PRESETS).map(([name, d]) => ({
      name,
      label: d.label,
      description: d.description,
    }));
  }

  listGameModes() {
    return Object.entries(GAME_MODES).map(([name, m]) => ({
      name,
      label: m.label,
      description: m.description,
      infinite: m.infinite,
    }));
  }

  registerBuiltInStrategies() {
    // ── Classic mode: finite escalating waves with tiered enemies ──
    this.registerStrategy("classic", (wave, total, rng, difficulty) => {
      const diff = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
      const queue = [];
      const available = this.getAvailableEnemies(wave);

      // Base count scales with wave and difficulty
      const baseCount = Math.floor((3 + wave * 2) * diff.hpMultiplier);

      // Distribute enemies across available tiers
      // Early waves: mostly tier 1, later waves: more tier 2+
      for (let i = 0; i < baseCount; i++) {
        const r = rng ? rng.next() : Math.random();
        const enemy = this._pickEnemy(available, r, wave);
        if (enemy) queue.push(enemy);
      }

      // Boss every 5 waves (or every 3 on insane)
      const bossInterval = difficulty === "insane" ? 3 : 5;
      if (wave % bossInterval === 0) {
        queue.push("boss");
      }

      // Insane: double boss count
      if (difficulty === "insane" && wave % bossInterval === 0) {
        queue.push("boss");
      }

      return this._shuffle(queue, rng);
    });

    // ── Endless mode: infinite scaling with all tiers ──────────────
    this.registerStrategy("endless", (wave, total, rng, difficulty) => {
      const diff = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
      const queue = [];
      const available = this.getAvailableEnemies(wave);
      const count = Math.floor((5 + wave * 3) * diff.hpMultiplier);

      for (let i = 0; i < count; i++) {
        const r = rng ? rng.next() : Math.random();
        const enemy = this._pickEnemy(available, r, wave);
        if (enemy) queue.push(enemy);
      }

      // Boss every 4 waves (every 2 on insane)
      const bossInterval = difficulty === "insane" ? 2 : 4;
      if (wave % bossInterval === 0) {
        queue.push("boss");
        if (difficulty === "insane") queue.push("boss");
      }

      return queue;
    });

    // ── Rush mode: fast waves, more enemies, bonus gold ───────────
    this.registerStrategy("rush", (wave, total, rng, difficulty) => {
      const diff = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
      const queue = [];
      const available = this.getAvailableEnemies(wave);
      const count = Math.floor((4 + wave * 2.5) * diff.hpMultiplier);

      for (let i = 0; i < count; i++) {
        const r = rng ? rng.next() : Math.random();
        // Rush favors faster enemies
        const enemy = this._pickEnemyRush(available, r);
        if (enemy) queue.push(enemy);
      }

      // Boss every 4 waves
      if (wave % 4 === 0 && available.includes("boss")) {
        queue.push("boss");
      }

      return queue;
    });
  }

  /**
   * Pick an enemy from available types based on wave progression.
   * Higher waves favor tougher enemies.
   */
  _pickEnemy(available, r, wave) {
    if (available.length === 0) return "grunt";

    // Weight distribution: favor tougher enemies at higher waves
    const weights = available.map((type) => {
      switch (type) {
        case "grunt":
          return Math.max(10, 40 - wave * 2);
        case "scout":
          return Math.max(8, 30 - wave);
        case "swarm":
          return Math.max(5, 15 - wave * 0.5);
        case "fast":
          return 15 + wave;
        case "brute":
          return wave >= 3 ? 12 + wave : 0;
        case "healer":
          return wave >= 5 ? 8 + wave * 0.5 : 0;
        case "shielded":
          return wave >= 5 ? 10 + wave * 0.5 : 0;
        case "armored":
          return wave >= 5 ? 8 + wave * 0.3 : 0;
        case "ghost":
          return wave >= 8 ? 10 + wave * 0.5 : 0;
        case "titan":
          return wave >= 8 ? 6 + wave * 0.3 : 0;
        case "phantom":
          return wave >= 12 ? 8 + wave * 0.3 : 0;
        case "boss":
          return 0; // Bosses are added separately
        default:
          return 10;
      }
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) return available[0];

    let cumulative = 0;
    const roll = r * totalWeight;
    for (let i = 0; i < available.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) return available[i];
    }
    return available[available.length - 1];
  }

  /**
   * Pick enemy for rush mode — favors fast enemies.
   */
  _pickEnemyRush(available, r) {
    if (available.length === 0) return "grunt";

    const weights = available.map((type) => {
      switch (type) {
        case "scout":
          return 30;
        case "fast":
          return 35;
        case "swarm":
          return 25;
        case "grunt":
          return 20;
        case "shielded":
          return 15;
        case "brute":
          return 10;
        case "armored":
          return 8;
        case "ghost":
          return 12;
        case "healer":
          return 5;
        case "titan":
          return 5;
        case "phantom":
          return 5;
        case "boss":
          return 0;
        default:
          return 10;
      }
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let cumulative = 0;
    const roll = r * totalWeight;
    for (let i = 0; i < available.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) return available[i];
    }
    return available[available.length - 1];
  }

  _shuffle(arr, rng) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng.next() : Math.random()) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

module.exports = { WaveGenerator, DIFFICULTY_PRESETS, GAME_MODES };
