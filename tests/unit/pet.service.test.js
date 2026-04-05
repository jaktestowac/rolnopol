import { describe, it, expect, vi, beforeEach } from "vitest";
const PetService = require("../../modules/buddy/services/pet.service.js");
const Pet = require("../../modules/buddy/models/pet.js");
const Personality = require("../../modules/buddy/models/personality.js");

describe("PetService", () => {
  let petRepository;
  let petService;

  beforeEach(() => {
    // Create mock repository
    petRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByUserId: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      userHasPet: vi.fn(),
    };

    petService = new PetService(petRepository);
  });

  describe("hatchPet", () => {
    it("should create a new pet for user", async () => {
      const userId = "user-123";
      petRepository.findByUserId.mockResolvedValue(null);
      petRepository.create.mockResolvedValue(
        new Pet({
          id: "pet-1",
          userId,
          name: "Fluffy",
          species: "duck",
          rarity: "common",
          personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        }),
      );

      const result = await petService.hatchPet(userId);

      expect(petRepository.findByUserId).toHaveBeenCalledWith(userId);
      expect(petRepository.create).toHaveBeenCalled();
      expect(result.userId).toBe(userId);
      expect(result.species).toBeDefined();
      expect(result.personality).toBeInstanceOf(Personality);
    });

    it("should throw error if user already has pet", async () => {
      const userId = "user-123";
      const existingPet = new Pet({
        id: "pet-1",
        userId,
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findByUserId.mockResolvedValue(existingPet);

      await expect(petService.hatchPet(userId)).rejects.toThrow("ALREADY_HAS_PET");
    });

    it("should throw error if userId is not string", async () => {
      await expect(petService.hatchPet(null)).rejects.toThrow("userId is required");
      await expect(petService.hatchPet(123)).rejects.toThrow("userId is required");
    });
  });

  describe("getPetByUserId", () => {
    it("should return user's pet", async () => {
      const userId = "user-123";
      const pet = new Pet({
        id: "pet-1",
        userId,
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findByUserId.mockResolvedValue(pet);

      const result = await petService.getPetByUserId(userId);

      expect(result).toBe(pet);
      expect(petRepository.findByUserId).toHaveBeenCalledWith(userId);
    });

    it("should return null if user has no pet", async () => {
      const userId = "user-123";
      petRepository.findByUserId.mockResolvedValue(null);

      const result = await petService.getPetByUserId(userId);

      expect(result).toBeNull();
    });
  });

  describe("getPetById", () => {
    it("should return pet by ID", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findById.mockResolvedValue(pet);

      const result = await petService.getPetById("pet-1");

      expect(result).toBe(pet);
      expect(petRepository.findById).toHaveBeenCalledWith("pet-1");
    });

    it("should throw error if pet not found", async () => {
      petRepository.findById.mockResolvedValue(null);

      await expect(petService.getPetById("pet-1")).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("releasePet", () => {
    it("should delete pet successfully", async () => {
      petRepository.delete.mockResolvedValue(true);

      const result = await petService.releasePet("pet-1");

      expect(result).toBe(true);
      expect(petRepository.delete).toHaveBeenCalledWith("pet-1");
    });

    it("should throw error if pet not found", async () => {
      petRepository.delete.mockResolvedValue(false);

      await expect(petService.releasePet("pet-1")).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("updateCustomization", () => {
    it("should update pet customization", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findById.mockResolvedValue(pet);
      petRepository.update.mockResolvedValue(pet);

      const customization = { eyes: "×", hat: "crown" };
      const result = await petService.updateCustomization("pet-1", customization);

      expect(result).toBeDefined();
      expect(petRepository.update).toHaveBeenCalled();
    });
  });

  describe("petPet interaction", () => {
    it("should increment pet count and return message", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        totalPets: 0,
      });

      petRepository.findById.mockResolvedValue(pet);
      petRepository.update.mockResolvedValue(pet);

      const result = await petService.petPet("pet-1");

      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("totalPets");
      expect(petRepository.update).toHaveBeenCalled();
    });
  });

  describe("talkToPet interaction", () => {
    it("should increment talk count and return message", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        totalTalks: 0,
      });

      petRepository.findById.mockResolvedValue(pet);
      petRepository.update.mockResolvedValue(pet);

      const result = await petService.talkToPet("pet-1", "Hello!");

      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("totalTalks");
      expect(petRepository.update).toHaveBeenCalled();
    });
  });

  describe("askForHelp interaction", () => {
    it("should increment help count and return advice", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
        totalAskedForHelp: 0,
      });

      petRepository.findById.mockResolvedValue(pet);
      petRepository.update.mockResolvedValue(pet);

      const result = await petService.askForHelp("pet-1", "How do I code?");

      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("helpMessage");
      expect(result).toHaveProperty("totalAskedForHelp");
      expect(petRepository.update).toHaveBeenCalled();
    });
  });

  describe("getPetPresentation", () => {
    it("should return full pet presentation with ASCII art", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findById.mockResolvedValue(pet);

      const result = await petService.getPetPresentation("pet-1");

      expect(result).toHaveProperty("id", "pet-1");
      expect(result).toHaveProperty("name", "Fluffy");
      expect(result).toHaveProperty("ascii");
      expect(result).toHaveProperty("personality");
      expect(result.ascii).toBeTruthy();
    });
  });

  describe("renderPetAscii", () => {
    it("should render ASCII art for pet", async () => {
      const pet = new Pet({
        id: "pet-1",
        userId: "user-123",
        name: "Fluffy",
        species: "duck",
        rarity: "common",
        personality: new Personality({ farming: 50, patience: 50, chaos: 50, wisdom: 50 }),
      });

      petRepository.findById.mockResolvedValue(pet);

      const ascii = await petService.renderPetAscii("pet-1");

      expect(ascii).toBeTruthy();
      expect(typeof ascii).toBe("string");
      expect(ascii.length).toBeGreaterThan(0);
    });
  });
});
