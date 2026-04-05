/**
 * Pet species configuration
 * Defines all species, their metadata, and rarity distribution
 */

const SPECIES_METADATA = {
  swan: {
    name: "Swan",
    description: "Graceful and serene, gliding through life with elegance",
    rarity: "common",
    weight: 45,
  },
  flamingo: {
    name: "Flamingo",
    description: "Elegant and graceful, standing tall with style",
    rarity: "common",
    weight: 45,
  },
  cat: {
    name: "Cat",
    description: "Independent and mysterious, on their own schedule",
    rarity: "common",
    weight: 45,
  },
  penguin: {
    name: "Penguin",
    description: "A serene Arctic oracle",
    rarity: "common",
    weight: 45,
  },
  hedgehog: {
    name: "Hedgehog",
    description: "Prickly on the outside, soft-hearted within",
    rarity: "common",
    weight: 45,
  },
  otter: {
    name: "Otter",
    description: "Playful and mischievous, always ready for adventure",
    rarity: "common",
    weight: 45,
  },
  squirrel: {
    name: "Squirrel",
    description: "Nimble and energetic, always gathering treasures",
    rarity: "common",
    weight: 45,
  },
  slime: {
    name: "Slime",
    description: "Gooey and formless, flows with the rhythm of life",
    rarity: "uncommon",
    weight: 30,
  },
  raven: {
    name: "Raven",
    description: "Intelligent and mysterious, keeper of ancient secrets",
    rarity: "uncommon",
    weight: 30,
  },
  koi: {
    name: "Koi",
    description: "Graceful and meditative, swimming through calm waters",
    rarity: "uncommon",
    weight: 30,
  },
  fox: {
    name: "Fox",
    description: "Cunning and clever, always three steps ahead",
    rarity: "uncommon",
    weight: 30,
  },
  panda: {
    name: "Panda",
    description: "Gentle giant with a heart of bamboo",
    rarity: "uncommon",
    weight: 30,
  },
  bee: {
    name: "Bee",
    description: "Busy and productive, working tirelessly for the hive",
    rarity: "uncommon",
    weight: 30,
  },
  jellyfish: {
    name: "Jellyfish",
    description: "Ethereal and flowing, drifting with the currents",
    rarity: "rare",
    weight: 15,
  },
  phoenix: {
    name: "Phoenix",
    description: "Rises from ashes, eternal and majestic",
    rarity: "rare",
    weight: 15,
  },
  alien: {
    name: "Alien",
    description: "Mysterious visitor from distant stars, oddly charming",
    rarity: "rare",
    weight: 15,
  },
  dragon: {
    name: "Dragon",
    description: "Majestic and powerful, truly legendary",
    rarity: "epic",
    weight: 8,
  },
  chonk: {
    name: "Chonk",
    description: "The absolute unit of all pets, round and wholesome",
    rarity: "legendary",
    weight: 2,
  },
};

const RARITY_LEVELS = {
  common: { label: "★ COMMON", color: "#888888" },
  uncommon: { label: "★★ UNCOMMON", color: "#4CAF50" },
  rare: { label: "★★★ RARE", color: "#2196F3" },
  epic: { label: "★★★★ EPIC", color: "#9C27B0" },
  legendary: { label: "★★★★★ LEGENDARY", color: "#FFD700" },
};

const CUSTOMIZATION_OPTIONS = {
  eyes: ["·", "✦", "×", "◉", "@", "°"],
};

/**
 * Get all species names
 */
function getAllSpecies() {
  return Object.keys(SPECIES_METADATA);
}

/**
 * Get species metadata by name
 */
function getSpeciesMetadata(speciesName) {
  const metadata = SPECIES_METADATA[speciesName];
  if (!metadata) {
    throw new Error(`PetSpecies.getSpeciesMetadata: unknown species '${speciesName}'`);
  }
  return metadata;
}

/**
 * Get rarity label and styling by rarity name
 */
function getRarityInfo(rarityName) {
  const info = RARITY_LEVELS[rarityName];
  if (!info) {
    throw new Error(`PetSpecies.getRarityInfo: unknown rarity '${rarityName}'`);
  }
  return info;
}

/**
 * Select a random species based on weighted rarity distribution
 * Uses weighted random selection to maintain rarity distribution
 */
function selectRandomSpecies() {
  const species = getAllSpecies();
  const totalWeight = species.reduce((sum, name) => sum + SPECIES_METADATA[name].weight, 0);

  let random = Math.random() * totalWeight;
  for (const name of species) {
    random -= SPECIES_METADATA[name].weight;
    if (random <= 0) {
      return name;
    }
  }

  // Fallback (should never happen, but safe)
  return species[0];
}

/**
 * Get rarity of a species
 */
function getSpeciesRarity(speciesName) {
  return getSpeciesMetadata(speciesName).rarity;
}

module.exports = {
  SPECIES_METADATA,
  RARITY_LEVELS,
  CUSTOMIZATION_OPTIONS,
  getAllSpecies,
  getSpeciesMetadata,
  getRarityInfo,
  selectRandomSpecies,
  getSpeciesRarity,
};
