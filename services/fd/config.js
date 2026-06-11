/**
 * Centralised configuration for Farm Defence.
 * Consolidates size presets, difficulty presets, game‑mode presets and theme definitions.
 * All objects are exported as immutable plain objects.
 */

// Theme definitions are defined in a separate module.
const { DEFAULT_THEMES } = require("./themes");

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

// Size presets – previously duplicated in fd.service.js.
const DEFAULT_SIZE_PRESETS = {
  tiny: { width: 11, height: 11, startGold: 150, startLives: 15, totalWaves: 5 },
  small: { width: 15, height: 15, startGold: 200, startLives: 20, totalWaves: 8 },
  medium: { width: 21, height: 21, startGold: 250, startLives: 20, totalWaves: 10 },
  big: { width: 31, height: 31, startGold: 300, startLives: 25, totalWaves: 15 },
};

module.exports = {
  DEFAULT_SIZE_PRESETS,
  DIFFICULTY_PRESETS,
  GAME_MODES,
  DEFAULT_THEMES,
};
