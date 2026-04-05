const { randomUUID } = require("crypto");
const Personality = require("./personality");

/**
 * Pet entity class with validation
 * Represents a single pet buddy instance
 */
class Pet {
  constructor({
    id = randomUUID(),
    userId,
    name,
    species,
    rarity,
    customization = { eyes: "◉" },
    personality,
    totalPets = 0,
    totalTalks = 0,
    totalAskedForHelp = 0,
    hatchedAt = new Date().toISOString(),
    lastInteraction = null,
  }) {
    this.validate({ userId, name, species, rarity, personality });

    this.id = id;
    this.userId = userId;
    this.name = name;
    this.species = species;
    this.rarity = rarity;
    this.customization = customization;
    // Convert plain object to Personality instance if needed
    this.personality = personality instanceof Personality ? personality : new Personality(personality);
    this.totalPets = totalPets;
    this.totalTalks = totalTalks;
    this.totalAskedForHelp = totalAskedForHelp;
    this.hatchedAt = hatchedAt;
    this.lastInteraction = lastInteraction;
  }

  /**
   * Validate required fields and constraints
   */
  validate({ userId, name, species, rarity, personality }) {
    if (!userId || typeof userId !== "string") {
      throw new Error("Pet.validate: userId is required and must be a string");
    }
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new Error("Pet.validate: name is required and must be non-empty string");
    }
    if (!species || typeof species !== "string") {
      throw new Error("Pet.validate: species is required and must be a string");
    }
    if (!rarity || typeof rarity !== "string") {
      throw new Error("Pet.validate: rarity is required and must be a string");
    }
    if (!personality || typeof personality !== "object") {
      throw new Error("Pet.validate: personality is required and must be an object");
    }
  }

  /**
   * Increment pet interaction count
   */
  incrementPets() {
    this.totalPets += 1;
    this.updateLastInteraction();
    return this;
  }

  /**
   * Increment talk interaction count
   */
  incrementTalks() {
    this.totalTalks += 1;
    this.updateLastInteraction();
    return this;
  }

  /**
   * Increment ask-for-help interaction count
   */
  incrementAskedForHelp() {
    this.totalAskedForHelp += 1;
    this.updateLastInteraction();
    return this;
  }

  /**
   * Update last interaction timestamp
   */
  updateLastInteraction() {
    this.lastInteraction = new Date().toISOString();
  }

  /**
   * Update customization (eyes)
   */
  updateCustomization(customization) {
    this.customization = { ...this.customization, ...customization };
    return this;
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      species: this.species,
      rarity: this.rarity,
      customization: this.customization,
      personality: this.personality.toJSON(),
      totalPets: this.totalPets,
      totalTalks: this.totalTalks,
      totalAskedForHelp: this.totalAskedForHelp,
      hatchedAt: this.hatchedAt,
      lastInteraction: this.lastInteraction,
    };
  }

  /**
   * Static factory method to create from plain object
   */
  static fromJSON(obj) {
    return new Pet(obj);
  }
}

module.exports = Pet;
