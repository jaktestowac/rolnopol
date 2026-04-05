const Pet = require("../models/pet");

/**
 * Pet Repository - Data persistence abstraction layer
 * Handles all CRUD operations for pets
 */
class PetRepository {
  constructor(dbManager, filePath = "data/pets.json") {
    this.dbManager = dbManager;
    this.filePath = filePath;
  }

  /**
   * Initialize the pets collection if it doesn't exist
   */
  async initialize() {
    try {
      let data = await this.dbManager.read();
      if (!data || !data.pets) {
        await this.dbManager.write({ pets: [] });
      }
    } catch (error) {
      // File doesn't exist, create it
      await this.dbManager.write({ pets: [] });
    }
  }

  /**
   * Create a new pet
   */
  async create(pet) {
    if (!(pet instanceof Pet)) {
      throw new Error("PetRepository.create: pet must be a Pet instance");
    }

    let data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      data = { pets: [] };
    }

    // Create a new pets array to ensure the write is treated as a fresh update
    const newPets = [...data.pets, pet.toJSON()];
    await this.dbManager.write({ pets: newPets });

    return pet;
  }

  /**
   * Find pet by ID
   */
  async findById(petId) {
    if (!petId) {
      throw new Error("PetRepository.findById: petId is required");
    }

    const data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      return null;
    }

    const petObj = data.pets.find((p) => p.id === petId);

    if (!petObj) {
      return null;
    }

    return Pet.fromJSON(petObj);
  }

  /**
   * Find pet by user ID (users only have 1 pet)
   */
  async findByUserId(userId) {
    if (!userId) {
      throw new Error("PetRepository.findByUserId: userId is required");
    }

    const data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      return null;
    }

    const petObj = data.pets.find((p) => p.userId === userId);

    if (!petObj) {
      return null;
    }

    return Pet.fromJSON(petObj);
  }

  /**
   * Get all pets
   */
  async findAll() {
    const data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      return [];
    }
    return data.pets.map((p) => Pet.fromJSON(p));
  }

  /**
   * Update pet
   */
  async update(pet) {
    if (!(pet instanceof Pet)) {
      throw new Error("PetRepository.update: pet must be a Pet instance");
    }

    let data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      throw new Error(`PetRepository.update: pet database corrupted`);
    }

    const index = data.pets.findIndex((p) => p.id === pet.id);

    if (index === -1) {
      throw new Error(`PetRepository.update: pet with id '${pet.id}' not found`);
    }

    // Create a new pets array to ensure the write is treated as a fresh update
    const newPets = [...data.pets.slice(0, index), pet.toJSON(), ...data.pets.slice(index + 1)];
    await this.dbManager.write({ pets: newPets });

    return pet;
  }

  /**
   * Delete pet by ID
   */
  async delete(petId) {
    if (!petId) {
      throw new Error("PetRepository.delete: petId is required");
    }

    let data = await this.dbManager.read();
    if (!data || !Array.isArray(data.pets)) {
      return false;
    }

    const index = data.pets.findIndex((p) => p.id === petId);

    if (index === -1) {
      return false;
    }

    // Create a new pets array to ensure the write is treated as a fresh update
    const newPets = [...data.pets.slice(0, index), ...data.pets.slice(index + 1)];
    await this.dbManager.write({ pets: newPets });

    return true;
  }

  /**
   * Check if user already has a pet
   */
  async userHasPet(userId) {
    if (!userId) {
      throw new Error("PetRepository.userHasPet: userId is required");
    }

    const pet = await this.findByUserId(userId);
    return pet !== null;
  }
}

module.exports = PetRepository;
