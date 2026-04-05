/**
 * Pet Personality Service
 * Handles personality-based responses and interactions
 */

const Personality = require("../models/personality");
const { getInteractionResponse, getHelpResponse, getPersonalityQuip } = require("../config/pet-responses");

/**
 * Generate personality for a pet based on species (optional biasing)
 */
function generatePersonality(species = null) {
  // For now, pure random. In future, could bias by species
  // e.g., ducks always have higher chaos, owls have higher wisdom
  return Personality.generateRandom();
}

/**
 * Get personality-based message for an interaction
 */
function getInteractionMessage(pet, interactionType) {
  if (!pet || typeof pet !== "object") {
    throw new Error("getInteractionMessage: pet object is required");
  }
  if (!interactionType || typeof interactionType !== "string") {
    throw new Error("getInteractionMessage: interactionType is required");
  }

  return getInteractionResponse(interactionType, pet.personality, pet.name);
}

/**
 * Get personality description text
 */
function describePersonality(personality) {
  if (!personality || typeof personality !== "object") {
    throw new Error("describePersonality: personality object is required");
  }

  const { farming, patience, chaos, wisdom } = personality;
  const traits = [];

  const buckets = {
    farming: farming >= 70 ? "green-thumbed" : farming >= 40 ? "steady" : "scatterbrained",
    patience: patience >= 70 ? "enduring" : patience >= 40 ? "grounded" : "eager",
    chaos: chaos >= 70 ? "wild-hearted" : chaos >= 40 ? "curious" : "predictable",
    wisdom: wisdom >= 70 ? "ancient-minded" : wisdom >= 40 ? "thoughtful" : "playful",
  };

  traits.push(`a ${buckets.farming} companion`);
  traits.push(`with ${buckets.patience} energy`);
  traits.push(`a ${buckets.chaos} streak`);
  traits.push(`and a ${buckets.wisdom} outlook`);

  const extremes = [];
  if (wisdom >= 80 && chaos <= 30) extremes.push("calm sage");
  if (chaos >= 80 && patience <= 30) extremes.push("mischief maker");
  if (farming >= 80 && wisdom >= 60) extremes.push("garden philosopher");
  if (farming <= 30 && chaos >= 70) extremes.push("free-spirited explorer");
  if (patience <= 20 && wisdom >= 60) extremes.push("quick-witted spark");

  const balance = [];
  if (farming >= 50 && wisdom >= 50 && chaos <= 50) balance.push("quietly dependable");
  if (patience >= 50 && chaos >= 50 && wisdom <= 50) balance.push("playfully resilient");
  if (farming <= 40 && patience <= 40 && chaos <= 40) balance.push("slow-burning steady soul");

  if (extremes.length > 0) {
    traits.push(`often feels like ${extremes.join(" or ")}`);
  } else if (balance.length > 0) {
    traits.push(`tends to be ${balance[0]}`);
  }

  const flavorLines = [];
  if (wisdom >= 75) flavorLines.push("loves quiet moments of insight");
  if (chaos >= 65) flavorLines.push("thrives on surprising detours");
  if (farming >= 65) flavorLines.push("finds comfort in routine and growth");
  if (patience >= 65) flavorLines.push("waits for the right moment to shine");
  if (patience <= 25) flavorLines.push("acts first and wonders later");
  if (chaos <= 25) flavorLines.push("prefers the path already known");

  if (flavorLines.length > 0) {
    traits.push(flavorLines[Math.floor(Math.random() * flavorLines.length)]);
  }

  return traits.join(", ");
}

/**
 * Get help-specific response based on personality
 */
function getHelpAdvice(pet, question = null) {
  if (!pet || typeof pet !== "object") {
    throw new Error("getHelpAdvice: pet object is required");
  }

  const message = getHelpResponse(pet.personality, pet.name);
  const quip = getPersonalityQuip(pet.personality);

  return {
    message,
    quip,
  };
}

/**
 * Get reaction to being petted based on personality
 */
function getPetReaction(pet) {
  if (!pet || typeof pet !== "object") {
    throw new Error("getPetReaction: pet object is required");
  }

  const message = getInteractionMessage(pet, "pet");

  // 30% chance for personality quip
  let quip = null;
  if (Math.random() < 0.3) {
    quip = getPersonalityQuip(pet.personality);
  }

  return {
    message,
    quip,
  };
}

/**
 * Get reaction to talking with pet based on personality
 */
function getTalkReaction(pet, userMessage = null) {
  if (!pet || typeof pet !== "object") {
    throw new Error("getTalkReaction: pet object is required");
  }

  const message = getInteractionMessage(pet, "talk");
  const quip = getPersonalityQuip(pet.personality);

  return {
    message,
    quip,
  };
}

/**
 * Compare two personalities (for future matchmaking, etc)
 */
function comparePersonalities(personality1, personality2) {
  if (!personality1 || !personality2) {
    throw new Error("comparePersonalities: both personalities are required");
  }

  const stats1 = personality1.getAll();
  const stats2 = personality2.getAll();

  let similarity = 0;
  for (const stat of ["farming", "patience", "chaos", "wisdom"]) {
    similarity += 100 - Math.abs(stats1[stat] - stats2[stat]);
  }

  return similarity / 400; // 0-1 scale
}

module.exports = {
  generatePersonality,
  getInteractionMessage,
  describePersonality,
  getHelpAdvice,
  getPetReaction,
  getTalkReaction,
  comparePersonalities,
};
