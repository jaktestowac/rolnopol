/**
 * Buddy Module - Index file
 * Exports all models, repositories, services, and configuration
 */

// Models
const Pet = require("./models/pet");
const Personality = require("./models/personality");

// Repositories
const PetRepository = require("./repositories/petRepository");

// Services
const PetService = require("./services/pet.service");
const petNameGenerator = require("./services/pet-name-generator.service");
const petAsciiRenderer = require("./services/pet-ascii-renderer.service");
const petPersonality = require("./services/pet-personality.service");
const petSpeciesService = require("./services/pet-species.service");

// Configuration
const petSpecies = require("./config/pet-species");
const petAscii = require("./config/pet-ascii");
const petResponses = require("./config/pet-responses");

module.exports = {
  models: {
    Pet,
    Personality,
  },
  repositories: {
    PetRepository,
  },
  services: {
    PetService,
    petNameGenerator,
    petAsciiRenderer,
    petPersonality,
    petSpeciesService,
  },
  config: {
    petSpecies,
    petAscii,
    petResponses,
  },
};
