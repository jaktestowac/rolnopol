/**
 * Personality value object
 * Immutable representation of pet personality stats
 * Each stat ranges from 0-100
 */
class Personality {
  constructor({ farming, patience, chaos, wisdom }) {
    this.validate({ farming, patience, chaos, wisdom });
    this.farming = farming;
    this.patience = patience;
    this.chaos = chaos;
    this.wisdom = wisdom;
  }

  /**
   * Validate that all stats are provided and are in valid range [0-100]
   */
  validate({ farming, patience, chaos, wisdom }) {
    const stats = { farming, patience, chaos, wisdom };
    for (const [name, value] of Object.entries(stats)) {
      if (value === undefined || value === null) {
        throw new Error(`Personality.validate: ${name} is required and must be a number between 0-100`);
      }
      if (typeof value !== "number" || value < 0 || value > 100) {
        throw new Error(`Personality.validate: ${name} must be a number between 0-100, got ${value}`);
      }
    }
  }

  /**
   * Get stat value by name
   */
  getStat(statName) {
    if (!this.hasOwnProperty(statName)) {
      throw new Error(`Personality.getStat: unknown stat '${statName}'`);
    }
    return this[statName];
  }

  /**
   * Get all stats as object
   */
  getAll() {
    return {
      farming: this.farming,
      patience: this.patience,
      chaos: this.chaos,
      wisdom: this.wisdom,
    };
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON() {
    return this.getAll();
  }

  /**
   * Static factory method to create from plain object
   */
  static fromJSON(obj) {
    return new Personality(obj);
  }

  /**
   * Generate random personality stats for variety
   */
  static generateRandom() {
    const generate = () => Math.floor(Math.random() * 101);
    return new Personality({
      farming: generate(),
      patience: generate(),
      chaos: generate(),
      wisdom: generate(),
    });
  }
}

module.exports = Personality;
