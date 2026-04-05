/**
 * Pet Service
 * Core business logic for pet management, hatching, and interactions
 * Orchestrates repositories and other services
 */

const Pet = require("../models/pet");
const Personality = require("../models/personality");
const { generateName } = require("./pet-name-generator.service");
const { generatePersonality, getInteractionMessage } = require("./pet-personality.service");
const { selectSpecies } = require("./pet-species.service");
const { renderPet } = require("./pet-ascii-renderer.service");

/**
 * Main PetService class
 * Requires dependency injection of petRepository
 */
class PetService {
  constructor(petRepository) {
    if (!petRepository) {
      throw new Error("PetService: petRepository is required");
    }
    this.repository = petRepository;
  }

  /**
   * Initialize the service (setup database)
   */
  async initialize() {
    await this.repository.initialize();
  }

  /**
   * Hatch a new pet for a user
   * Users can only have one pet
   */
  async hatchPet(userId) {
    if (!userId || typeof userId !== "string") {
      throw new Error("PetService.hatchPet: userId is required and must be a string");
    }

    // Check if user already has a pet
    const existingPet = await this.repository.findByUserId(userId);
    if (existingPet) {
      throw new Error(`ALREADY_HAS_PET: User already has a pet named "${existingPet.name}"`);
    }

    // Select random species
    const species = selectSpecies();

    // Generate personality and name
    const personality = generatePersonality(species);
    const name = generateName(personality.rarity || require("../config/pet-species").getSpeciesRarity(species), species);

    // Get rarity
    const { getSpeciesRarity } = require("../config/pet-species");
    const rarity = getSpeciesRarity(species);

    // Create pet entity
    const pet = new Pet({
      userId,
      name,
      species,
      rarity,
      personality,
      customization: {
        eyes: "◉",
      },
    });

    // Save to repository
    await this.repository.create(pet);

    return pet;
  }

  /**
   * Get user's pet
   */
  async getPetByUserId(userId) {
    if (!userId || typeof userId !== "string") {
      throw new Error("PetService.getPetByUserId: userId is required and must be a string");
    }

    const pet = await this.repository.findByUserId(userId);
    return pet; // Returns null if not found, controller will handle the 404
  }

  /**
   * Get pet by ID
   */
  async getPetById(petId) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.getPetById: petId is required and must be a string");
    }

    const pet = await this.repository.findById(petId);
    if (!pet) {
      throw new Error("NOT_FOUND: Pet not found");
    }

    return pet;
  }

  /**
   * Get all pets (admin/debug only)
   */
  async getAllPets() {
    return await this.repository.findAll();
  }

  /**
   * Release pet (delete)
   */
  async releasePet(petId) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.releasePet: petId is required and must be a string");
    }

    const deleted = await this.repository.delete(petId);
    if (!deleted) {
      throw new Error("NOT_FOUND: Pet not found");
    }

    return true;
  }

  /**
   * Update pet customization (eyes)
   */
  async updateCustomization(petId, customization) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.updateCustomization: petId is required");
    }
    if (!customization || typeof customization !== "object") {
      throw new Error("PetService.updateCustomization: customization object is required");
    }

    const pet = await this.getPetById(petId);
    pet.updateCustomization(customization);

    await this.repository.update(pet);
    return pet;
  }

  /**
   * Pet interaction - increment count and return response
   */
  async petPet(petId) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.petPet: petId is required");
    }

    const pet = await this.getPetById(petId);
    pet.incrementPets();

    const message = getInteractionMessage(pet, "pet");

    await this.repository.update(pet);

    return {
      message,
      totalPets: pet.totalPets,
    };
  }

  /**
   * Talk interaction - increment count and return response
   */
  async talkToPet(petId, userMessage = "") {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.talkToPet: petId is required");
    }

    const pet = await this.getPetById(petId);
    pet.incrementTalks();

    const message = getInteractionMessage(pet, "talk");

    await this.repository.update(pet);

    return {
      message,
      totalTalks: pet.totalTalks,
    };
  }

  /**
   * Ask for help interaction - increment count and return response
   */
  async askForHelp(petId, question = "") {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.askForHelp: petId is required");
    }

    const pet = await this.getPetById(petId);
    pet.incrementAskedForHelp();

    const { getHelpAdvice } = require("./pet-personality.service");
    const { message: helpMessage, quip } = getHelpAdvice(pet, question);

    const message = getInteractionMessage(pet, "ask_help");

    await this.repository.update(pet);

    return {
      message,
      helpMessage,
      quip,
      totalAskedForHelp: pet.totalAskedForHelp,
    };
  }

  /**
   * Get ASCII representation of pet
   */
  async renderPetAscii(petId) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.renderPetAscii: petId is required");
    }

    const pet = await this.getPetById(petId);
    return renderPet(pet.species, pet.customization);
  }

  /**
   * Get full pet presentation (for API response)
   */
  async getPetPresentation(petId) {
    if (!petId || typeof petId !== "string") {
      throw new Error("PetService.getPetPresentation: petId is required");
    }

    const pet = await this.getPetById(petId);
    const ascii = renderPet(pet.species, pet.customization);
    const { describePersonality } = require("./pet-personality.service");
    const { getRarityInfo } = require("../config/pet-species");

    const rarityInfo = getRarityInfo(pet.rarity);
    const personalityDesc = describePersonality(pet.personality);

    return {
      id: pet.id,
      userId: pet.userId,
      name: pet.name,
      species: pet.species,
      rarity: pet.rarity,
      rarityLabel: rarityInfo.label,
      ascii,
      customization: pet.customization,
      personality: pet.personality.getAll(),
      personalityDescription: personalityDesc,
      totalPets: pet.totalPets,
      totalTalks: pet.totalTalks,
      totalAskedForHelp: pet.totalAskedForHelp,
      hatchedAt: pet.hatchedAt,
      lastInteraction: pet.lastInteraction,
    };
  }
}

module.exports = PetService;
