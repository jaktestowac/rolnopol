/**
 * Pet Name Generator Service
 * Generates random pet names based on species and personality
 */

const PET_NAMES = {
  common: [
    "Rune",
    "Echo",
    "Pixel",
    "Nova",
    "Sage",
    "Milo",
    "Luna",
    "Aurora",
    "Cosmo",
    "Scout",
    "Pepper",
    "Jasper",
    "Riley",
    "Blaze",
    "Indie",
    "Moss",
    "Ember",
    "Spark",
    "Ash",
    "Cloud",
  ],
  uncommon: [
    "Cipher",
    "Nexus",
    "Flux",
    "Quantum",
    "Oracle",
    "Phantom",
    "Galaxy",
    "Prism",
    "Entropy",
    "Zephyr",
    "Meridian",
    "Catalyst",
    "Obsidian",
    "Stellar",
    "Void",
    "Mirage",
    "Epoch",
    "Axiom",
  ],
  rare: [
    "Fenrir",
    "Anubis",
    "Morpheus",
    "Leviathan",
    "Chimera",
    "Sphinx",
    "Valkyrie",
    "Cerberus",
    "Basilisk",
    "Goliath",
    "Titan",
    "Kaiju",
    "Behemoth",
  ],
  epic: ["Ascendant", "Seraphim", "Dragonborn", "Godling", "Alchemy", "Infinity", "Eternity", "Supreme", "Apex", "Crown"],
  legendary: ["Chonkinator", "Unit", "THE LEGEND", "ChonkLord", "Absolute", "Perfection", "Infinity Plus One", "Chonkalicious"],
};

const SPECIES_NAME_HINTS = {
  swan: ["Grace", "Float", "Glide", "Serene"],
  flamingo: ["Pink", "Stride", "Grace", "Elegant"],
  cat: ["Whisker", "Shadow", "Sleek", "Prowl"],
  penguin: ["Waddle", "Chill", "Freeze", "Slide"],
  snail: ["Shell", "Slow", "Glide", "Path"],
  otter: ["Slip", "Splash", "Frolic", "Dart"],
  squirrel: ["Zippy", "Nutty", "Bushy", "Dash"],
  slime: ["Goo", "Slurp", "Flow", "Glob"],
  raven: ["Caw", "Shadow", "Dark", "Wise"],
  koi: ["Swim", "Gold", "Flow", "Zen"],
  fox: ["Trick", "Sly", "Cunning", "Wiley"],
  hedgehog: ["Prickle", "Snuggle", "Spike", "Quill"],
  panda: ["Bamboo", "Gentle", "Munch", "Tumble"],
  bee: ["Buzz", "Hive", "Nectar", "Sting"],
  phoenix: ["Flame", "Rise", "Ashes", "Rebirth"],
  alien: ["Zyx", "Cosmic", "Blip", "Xeno"],
  jellyfish: ["Drift", "Float", "Glow", "Wave"],
  dragon: ["Inferno", "Gold", "Wings", "Draconic"],
  chonk: ["Chonk", "Absolute", "Unit", "Perfect"],
};

/**
 * Get a random name from a pool
 */
function getRandomFromPool(pool) {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error("getRandomFromPool: pool must be non-empty array");
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate a random pet name based on rarity
 * Optionally influenced by species
 */
function generateName(rarity, species = null) {
  if (!rarity || typeof rarity !== "string") {
    throw new Error("generateName: rarity is required and must be a string");
  }

  const pool = PET_NAMES[rarity];
  if (!pool) {
    throw new Error(`generateName: unknown rarity '${rarity}'`);
  }

  // 30% chance to create hybrid name for non-legendary rarities
  if (rarity !== "legendary" && species && SPECIES_NAME_HINTS[species] && Math.random() < 0.3) {
    const hint = getRandomFromPool(SPECIES_NAME_HINTS[species]);
    const commonName = getRandomFromPool(PET_NAMES.common);
    return `${hint}${commonName}`;
  }

  return getRandomFromPool(pool);
}

module.exports = {
  PET_NAMES,
  SPECIES_NAME_HINTS,
  generateName,
};
