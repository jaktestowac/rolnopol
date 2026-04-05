const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const databaseManager = require("../data/database-manager");
const featureFlagsService = require("../services/feature-flags.service");
const buddyModule = require("../modules/buddy");
const { PetService } = buddyModule.services;
const { PetRepository } = buddyModule.repositories;

class BuddyController {
  constructor() {
    const petsDb = databaseManager.getPetsDatabase();
    this.petRepository = new PetRepository(petsDb);
    this.petService = new PetService(this.petRepository);
  }

  async _fetchPetOrRespondNotFound(req, res) {
    try {
      const pet = await this.petService.getPetById(req.params.id);
      return pet;
    } catch (error) {
      if (error.message && error.message.includes("NOT_FOUND")) {
        res.status(404).json(
          formatResponseBody({
            error: "Pet not found",
          }),
        );
        return null;
      }
      throw error;
    }
  }

  /**
   * POST /api/v1/buddy - Hatch a new pet
   */
  async hatchPet(req, res) {
    try {
      // Check feature flag
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const userId = req.user.userId;

      if (!userId) {
        return res.status(400).json(
          formatResponseBody({
            error: "User ID is required",
          }),
        );
      }

      const pet = await this.petService.hatchPet(userId);
      const ascii = await this.petService.renderPetAscii(pet.id);

      return res.status(201).json(
        formatResponseBody({
          data: {
            id: pet.id,
            userId: pet.userId,
            name: pet.name,
            species: pet.species,
            rarity: pet.rarity,
            ascii,
            personality: pet.personality.getAll(),
            customization: pet.customization,
            totalPets: pet.totalPets,
            totalTalks: pet.totalTalks,
            totalAskedForHelp: pet.totalAskedForHelp,
            hatchedAt: pet.hatchedAt,
            message: `✨ ${pet.name} the ${pet.species.toUpperCase()} has hatched! (${pet.rarity})`,
          },
        }),
      );
    } catch (error) {
      logError("Error hatching pet:", error);

      // Handle "already has pet" error
      if (error.message && error.message.includes("ALREADY_HAS_PET")) {
        return res.status(409).json(
          formatResponseBody({
            error: error.message,
          }),
        );
      }

      return res.status(500).json(
        formatResponseBody({
          error: "Failed to hatch pet",
        }),
      );
    }
  }

  /**
   * GET /api/v1/buddy - Get current user's pet
   */
  async getPet(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const userId = req.user.userId;

      if (!userId) {
        return res.status(400).json(
          formatResponseBody({
            error: "User ID is required",
          }),
        );
      }

      const pet = await this.petService.getPetByUserId(userId);

      if (!pet) {
        return res.status(404).json(
          formatResponseBody({
            error: "You do not have a pet yet. Hatch one first!",
          }),
        );
      }

      const presentation = await this.petService.getPetPresentation(pet.id);

      return res.status(200).json(formatResponseBody({ data: presentation }));
    } catch (error) {
      logError("Error getting pet:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to retrieve pet",
        }),
      );
    }
  }

  /**
   * GET /api/v1/buddy/:id - Get pet by ID
   */
  async getPetById(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      const presentation = await this.petService.getPetPresentation(petId);

      return res.status(200).json(formatResponseBody({ data: presentation }));
    } catch (error) {
      logError("Error getting pet by ID:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to retrieve pet",
        }),
      );
    }
  }

  /**
   * DELETE /api/v1/buddy/:id - Release/delete pet
   */
  async releasePet(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      // Verify user owns this pet
      if (pet.userId !== req.user.userId) {
        return res.status(403).json(
          formatResponseBody({
            error: "You can only release your own pet",
          }),
        );
      }

      await this.petService.releasePet(petId);

      return res.status(200).json(
        formatResponseBody({
          data: {
            message: `${pet.name} has been released. Goodbye, friend!`,
          },
        }),
      );
    } catch (error) {
      logError("Error releasing pet:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to release pet",
        }),
      );
    }
  }

  /**
   * PATCH /api/v1/buddy/:id - Update customization (eyes, hat)
   */
  async updateCustomization(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;
      const { customization = {}, eyes } = req.body;
      const requestedCustomization = { ...customization };

      if (eyes !== undefined) {
        requestedCustomization.eyes = eyes;
      }

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      // Verify user owns this pet
      if (pet.userId !== req.user.userId) {
        return res.status(403).json(
          formatResponseBody({
            error: "You can only customize your own pet",
          }),
        );
      }

      const finalCustomization = requestedCustomization;

      if (!finalCustomization || Object.keys(finalCustomization).length === 0) {
        return res.status(400).json(
          formatResponseBody({
            error: "No customization fields provided",
          }),
        );
      }

      await this.petService.updateCustomization(petId, finalCustomization);

      const updatedPet = await this.petService.getPetById(petId);
      const presentation = await this.petService.getPetPresentation(petId);

      return res.status(200).json(
        formatResponseBody({
          data: {
            ...presentation,
            message: `${updatedPet.name} looks even better now!`,
          },
        }),
      );
    } catch (error) {
      logError("Error updating customization:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to update pet customization",
        }),
      );
    }
  }

  /**
   * POST /api/v1/buddy/:id/pet - Pet interaction
   */
  async petPet(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      // Verify user owns this pet
      if (pet.userId !== req.user.userId) {
        return res.status(403).json(
          formatResponseBody({
            error: "You can only pet your own pet",
          }),
        );
      }

      const result = await this.petService.petPet(petId);

      return res.status(200).json(
        formatResponseBody({
          data: {
            message: result.message,
            totalPets: result.totalPets,
          },
        }),
      );
    } catch (error) {
      logError("Error petting pet:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to pet your companion",
        }),
      );
    }
  }

  /**
   * POST /api/v1/buddy/:id/talk - Talk interaction
   */
  async talkToPet(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;
      const { message } = req.body;

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json(
          formatResponseBody({
            error: "Message is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      // Verify user owns this pet
      if (pet.userId !== req.user.userId) {
        return res.status(403).json(
          formatResponseBody({
            error: "You can only talk to your own pet",
          }),
        );
      }

      const result = await this.petService.talkToPet(petId, message);

      return res.status(200).json(
        formatResponseBody({
          data: {
            message: result.message,
            totalTalks: result.totalTalks,
          },
        }),
      );
    } catch (error) {
      logError("Error talking to pet:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to talk to your companion",
        }),
      );
    }
  }

  /**
   * POST /api/v1/buddy/:id/ask-help - Ask for help interaction
   */
  async askForHelp(req, res) {
    try {
      const flags = await featureFlagsService.getFeatureFlags();
      if (!flags.flags?.petBuddyEnabled) {
        return res.status(403).json(
          formatResponseBody({
            error: "Pet Buddy feature is not enabled",
          }),
        );
      }

      const petId = req.params.id;
      const { message } = req.body;

      if (!petId) {
        return res.status(400).json(
          formatResponseBody({
            error: "Pet ID is required",
          }),
        );
      }

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json(
          formatResponseBody({
            error: "Question is required",
          }),
        );
      }

      const pet = await this._fetchPetOrRespondNotFound(req, res);
      if (!pet) {
        return;
      }

      // Verify user owns this pet
      if (pet.userId !== req.user.userId) {
        return res.status(403).json(
          formatResponseBody({
            error: "You can only ask your own pet for help",
          }),
        );
      }

      const result = await this.petService.askForHelp(petId, message);

      return res.status(200).json(
        formatResponseBody({
          data: {
            message: result.message,
            helpMessage: result.helpMessage,
            quip: result.quip,
            totalAskedForHelp: result.totalAskedForHelp,
          },
        }),
      );
    } catch (error) {
      logError("Error asking pet for help:", error);
      return res.status(500).json(
        formatResponseBody({
          error: "Failed to ask your companion for help",
        }),
      );
    }
  }
}

module.exports = new BuddyController();
