import { describe, it, expect, beforeEach } from "vitest";
const Pet = require("../../modules/buddy/models/pet.js");
const Personality = require("../../modules/buddy/models/personality.js");

describe("Pet Model", () => {
  describe("constructor", () => {
    it("should create a valid pet instance", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      expect(pet.userId).toBe("user-123");
      expect(pet.name).toBe("Fluffy");
      expect(pet.species).toBe("duck");
      expect(pet.rarity).toBe("common");
      expect(pet.id).toBeDefined();
      expect(pet.personality).toBeInstanceOf(Personality);
    });

    it("should accept plain personality object and convert to Personality instance", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: { farming: 50, patience: 50, chaos: 50, wisdom: 50 },
      });

      expect(pet.personality).toBeInstanceOf(Personality);
      expect(pet.personality.farming).toBe(50);
    });

    it("should set default customization", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      expect(pet.customization).toEqual({ eyes: "◉", hat: null });
    });

    it("should allow custom customization", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        customization: { eyes: "×", hat: "crown" },
      });

      expect(pet.customization).toEqual({ eyes: "×", hat: "crown" });
    });

    it("should throw error if userId is missing", () => {
      expect(() => {
        new Pet({
          name: "Fluffy",
          species: "duck",
          rarity: "common",
          personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        });
      }).toThrow("userId is required");
    });

    it("should throw error if name is missing", () => {
      expect(() => {
        new Pet({
          userId: "user-123",
          species: "duck",
          rarity: "common",
          personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        });
      }).toThrow("name is required");
    });

    it("should throw error if species is missing", () => {
      expect(() => {
        new Pet({
          userId: "user-123",
          name: "Fluffy",
          rarity: "common",
          personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        });
      }).toThrow("species is required");
    });

    it("should throw error if personality is invalid", () => {
      expect(() => {
        new Pet({
          userId: "user-123",
          name: "Fluffy",
          species: "duck",
          rarity: "common",
          personality: { invalid: true },
        });
      }).toThrow();
    });
  });

  describe("interactions", () => {
    let pet;

    beforeEach(() => {
      pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        totalPets: 0,
        totalTalks: 0,
        totalAskedForHelp: 0,
      });
    });

    it("should increment pet count", () => {
      pet.incrementPets();
      expect(pet.totalPets).toBe(1);

      pet.incrementPets();
      expect(pet.totalPets).toBe(2);
    });

    it("should increment talk count", () => {
      pet.incrementTalks();
      expect(pet.totalTalks).toBe(1);

      pet.incrementTalks();
      expect(pet.totalTalks).toBe(2);
    });

    it("should increment ask-for-help count", () => {
      pet.incrementAskedForHelp();
      expect(pet.totalAskedForHelp).toBe(1);

      pet.incrementAskedForHelp();
      expect(pet.totalAskedForHelp).toBe(2);
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON correctly", () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        customization: { eyes: "◉", hat: null },
        totalPets: 5,
        totalTalks: 3,
        totalAskedForHelp: 1,
      });

      const json = pet.toJSON();

      expect(json).toEqual({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        customization: { eyes: "◉", hat: null },
        personality: { farming: 50, patience: 50, chaos: 50, wisdom: 50 },
        totalPets: 5,
        totalTalks: 3,
        totalAskedForHelp: 1,
        hatchedAt: pet.hatchedAt,
        lastInteraction: pet.lastInteraction,
      });

      // Personality should be a plain object, not Personality instance
      expect(json.personality).not.toBeInstanceOf(Personality);
      expect(typeof json.personality).toBe("object");
    });

    it("should deserialize from JSON correctly", () => {
      const jsonData = {
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        customization: { eyes: "◉", hat: null },
        personality: { farming: 50, patience: 50, chaos: 50, wisdom: 50 },
        totalPets: 5,
        totalTalks: 3,
        totalAskedForHelp: 1,
        hatchedAt: "2024-01-10T08:00:00Z",
        lastInteraction: null,
      };

      const pet = Pet.fromJSON(jsonData);

      expect(pet.id).toBe("pet-1");
      expect(pet.userId).toBe("user-123");
      expect(pet.name).toBe("Fluffy");
      expect(pet.personality).toBeInstanceOf(Personality);
      expect(pet.personality.farming).toBe(50);
    });

    it("should roundtrip correctly through toJSON and fromJSON", () => {
      const original = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        customization: { eyes: "×", hat: "crown" },
      });

      const json = original.toJSON();
      const restored = Pet.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.name).toBe(original.name);
      expect(restored.species).toBe(original.species);
      expect(restored.customization).toEqual(original.customization);
      expect(restored.personality.farming).toBe(original.personality.farming);
    });
  });

  describe("updateCustomization", () => {
    it("should update eyes", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      pet.updateCustomization({ eyes: "×" });

      expect(pet.customization.eyes).toBe("×");
    });

    it("should update hat", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      pet.updateCustomization({ hat: "crown" });

      expect(pet.customization.hat).toBe("crown");
    });

    it("should preserve existing values when partial update", () => {
      const pet = new Pet({
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        customization: { eyes: "◉", hat: "crown" },
      });

      pet.updateCustomization({ eyes: "×" });

      expect(pet.customization.eyes).toBe("×");
      expect(pet.customization.hat).toBe("crown");
    });
  });
});

describe("Personality Model", () => {
  describe("constructor", () => {
    it("should create valid personality", () => {
      const personality = new Personality({
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      });

      expect(personality.farming).toBe(42);
      expect(personality.patience).toBe(18);
      expect(personality.chaos).toBe(37);
      expect(personality.wisdom).toBe(77);
    });

    it("should validate stats are in 0-100 range", () => {
      expect(() => {
        new Personality({ farming: -1, patience: 50, chaos: 50, wisdom: 50 });
      }).toThrow();

      expect(() => {
        new Personality({ farming: 101, patience: 50, chaos: 50, wisdom: 50 });
      }).toThrow();
    });

    it("should throw error if required stats are missing", () => {
      expect(() => {
        new Personality({ farming: 50, patience: 50 });
      }).toThrow();
    });
  });

  describe("getAll", () => {
    it("should return all personality stats", () => {
      const personality = new Personality({
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      });

      const stats = personality.getAll();

      expect(stats).toEqual({
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      });
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON as plain object", () => {
      const personality = new Personality({
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      });

      const json = personality.toJSON();

      expect(json).toEqual({
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      });
      expect(json).not.toBeInstanceOf(Personality);
    });

    it("should deserialize from JSON", () => {
      const jsonData = {
        farming: 42,
        patience: 18,
        chaos: 37,
        wisdom: 77,
      };

      const personality = Personality.fromJSON(jsonData);

      expect(personality).toBeInstanceOf(Personality);
      expect(personality.farming).toBe(42);
    });
  });

  describe("generateRandom", () => {
    it("should generate random personality with valid stats", () => {
      const personality = Personality.generateRandom();

      expect(personality.farming).toBeGreaterThanOrEqual(0);
      expect(personality.farming).toBeLessThanOrEqual(100);
      expect(personality.patience).toBeGreaterThanOrEqual(0);
      expect(personality.patience).toBeLessThanOrEqual(100);
      expect(personality.chaos).toBeGreaterThanOrEqual(0);
      expect(personality.chaos).toBeLessThanOrEqual(100);
      expect(personality.wisdom).toBeGreaterThanOrEqual(0);
      expect(personality.wisdom).toBeLessThanOrEqual(100);
    });

    it("should generate different personalities on multiple calls", () => {
      const p1 = Personality.generateRandom();
      const p2 = Personality.generateRandom();

      // While theoretically they could be the same, the probability is extremely low
      // This tests that randomness is working
      expect([p1.farming, p1.patience, p1.chaos, p1.wisdom]).not.toEqual([p2.farming, p2.patience, p2.chaos, p2.wisdom]);
    });
  });
});
