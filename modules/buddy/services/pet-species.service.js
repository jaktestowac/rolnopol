/**
 * Pet Species Service
 * Handles species selection with weighted rarity distribution
 */

const { getAllSpecies, getSpeciesMetadata, getRarityInfo, selectRandomSpecies, getSpeciesRarity } = require("../config/pet-species");

/**
 * Get all available species
 */
function listSpecies() {
  return getAllSpecies().map((name) => ({
    name,
    ...getSpeciesMetadata(name),
  }));
}

/**
 * Get species info by name
 */
function getSpecies(speciesName) {
  if (!speciesName || typeof speciesName !== "string") {
    throw new Error("getSpecies: speciesName is required and must be a string");
  }

  const metadata = getSpeciesMetadata(speciesName);
  return {
    name: speciesName,
    ...metadata,
  };
}

/**
 * Get species by rarity
 */
function getSpeciesByRarity(rarity) {
  if (!rarity || typeof rarity !== "string") {
    throw new Error("getSpeciesByRarity: rarity is required and must be a string");
  }

  const rarityInfo = getRarityInfo(rarity);
  const species = getAllSpecies().filter((name) => getSpeciesRarity(name) === rarity);

  return {
    rarity,
    ...rarityInfo,
    species: species.map((name) => ({
      name,
      ...getSpeciesMetadata(name),
    })),
  };
}

/**
 * Select random species respecting rarity distribution
 */
function selectSpecies() {
  return selectRandomSpecies();
}

/**
 * Get rarity distribution summary
 */
function getRarityDistribution() {
  const distribution = {};
  const allSpecies = getAllSpecies();
  const total = allSpecies.length;

  for (const species of allSpecies) {
    const rarity = getSpeciesRarity(species);
    if (!distribution[rarity]) {
      distribution[rarity] = [];
    }
    distribution[rarity].push(species);
  }

  // Calculate percentages
  const summary = {};
  for (const [rarity, species] of Object.entries(distribution)) {
    summary[rarity] = {
      count: species.length,
      percentage: Math.round((species.length / total) * 100),
      species,
      ...getRarityInfo(rarity),
    };
  }

  return summary;
}

/**
 * Validate species exists
 */
function isValidSpecies(speciesName) {
  if (typeof speciesName !== "string") {
    return false;
  }
  try {
    getSpeciesMetadata(speciesName);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  listSpecies,
  getSpecies,
  getSpeciesByRarity,
  selectSpecies,
  getRarityDistribution,
  isValidSpecies,
};
