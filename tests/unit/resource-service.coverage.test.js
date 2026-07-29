import ResourceService from "../../services/resource.service.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Keep the notification pipeline inert so these unit tests stay deterministic
// and never schedule background work.
const notificationCenter = require("../../modules/notification-center");
const dbManager = require("../../data/database-manager");

describe("resource.service (coverage)", () => {
  beforeEach(() => {
    vi.spyOn(notificationCenter, "publish").mockResolvedValue({ accepted: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getFieldsByUserId", () => {
    it("returns only the fields owned by the user", async () => {
      const service = new ResourceService("fields");
      const rows = [
        { id: 1, userId: 5 },
        { id: 2, userId: 6 },
        { id: 3, userId: 5 },
      ];
      vi.spyOn(service.db, "find").mockImplementation(async (predicate) => rows.filter(predicate));

      const result = await service.getFieldsByUserId(5);
      expect(result).toEqual([
        { id: 1, userId: 5 },
        { id: 3, userId: 5 },
      ]);
    });
  });

  describe("_matchesSearch", () => {
    it("matches field-specific columns", () => {
      const service = new ResourceService("fields");
      const field = { name: "North Plot", area: 12, district: "Krakow", cropType: "wheat" };
      expect(service._matchesSearch(field, "wheat")).toBe(true);
      expect(service._matchesSearch(field, "krak")).toBe(true);
      expect(service._matchesSearch(field, "nothere")).toBe(false);
    });

    it("matches staff-specific columns", () => {
      const service = new ResourceService("staff");
      const staff = { name: "Alice", surname: "Nowak", position: "Vet", salary: 5000 };
      expect(service._matchesSearch(staff, "vet")).toBe(true);
      expect(service._matchesSearch(staff, "5000")).toBe(true);
      expect(service._matchesSearch(staff, "kowalski")).toBe(false);
    });

    it("falls back to all values for other resource types (animals)", () => {
      const service = new ResourceService("animals");
      const animal = { type: "cow", amount: 3, note: "healthy" };
      expect(service._matchesSearch(animal, "healthy")).toBe(true);
      expect(service._matchesSearch(animal, "cow")).toBe(true);
      expect(service._matchesSearch(animal, "missing")).toBe(false);
    });

    it("returns false for non-object input", () => {
      const service = new ResourceService("fields");
      expect(service._matchesSearch(null, "x")).toBe(false);
      expect(service._matchesSearch(undefined, "x")).toBe(false);
    });
  });

  describe("list pagination edge cases", () => {
    it("clamps requested page above the last page and caps the limit at 100", async () => {
      const service = new ResourceService("fields");
      const items = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, userId: 2, name: `F${i}` }));
      vi.spyOn(service.db, "find").mockResolvedValue(items);

      const result = await service.list(2, { paginate: true, page: 99, limit: 999 });
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 100,
        totalItems: 5,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
      expect(result.items).toHaveLength(5);
    });

    it("returns an empty page shape when there are no items", async () => {
      const service = new ResourceService("fields");
      vi.spyOn(service.db, "find").mockResolvedValue([]);

      const result = await service.list(2, { paginate: true });
      expect(result.items).toEqual([]);
      expect(result.pagination).toMatchObject({ totalItems: 0, totalPages: 1, page: 1 });
    });
  });

  describe("create (staff branch)", () => {
    it("creates a staff record and returns it with the assigned id", async () => {
      const service = new ResourceService("staff");
      vi.spyOn(service.db, "add").mockResolvedValue();
      vi.spyOn(service.db, "find").mockResolvedValue([
        { id: 1, userId: 2, name: "Bob", surname: "K" },
        { id: 2, userId: 2, name: "Carol", surname: "M" },
      ]);

      const result = await service.create(2, { name: "Carol", surname: "M" });
      expect(result).toEqual({ id: 2, userId: 2, name: "Carol", surname: "M" });
    });
  });

  describe("delete / update input validation", () => {
    it("delete rejects an invalid user id", async () => {
      const service = new ResourceService("fields");
      await expect(service.delete(0, 1)).rejects.toThrow("Invalid user ID format");
      await expect(service.delete("abc", 1)).rejects.toThrow("Invalid user ID format");
    });

    it("delete rejects an invalid resource id", async () => {
      const service = new ResourceService("fields");
      await expect(service.delete(1, -3)).rejects.toThrow("Invalid resource ID format");
      await expect(service.delete(1, 1.5)).rejects.toThrow("Invalid resource ID format");
    });

    it("update rejects invalid ids", async () => {
      const service = new ResourceService("fields");
      await expect(service.update(0, 1, {})).rejects.toThrow("Invalid user ID format");
      await expect(service.update(1, 0, {})).rejects.toThrow("Invalid resource ID format");
    });

    it("update returns null when the record is not found", async () => {
      const service = new ResourceService("fields");
      vi.spyOn(service.db, "updateRecords").mockResolvedValue([]);
      const result = await service.update(2, 999, { name: "x" });
      expect(result == null).toBe(true);
    });
  });

  describe("validateAnimal", () => {
    it("returns no errors for a valid animal", () => {
      const service = new ResourceService("animals");
      expect(service.validateAnimal({ type: "cow", amount: 2 })).toEqual([]);
      expect(service.validateAnimal({ type: "cow", amount: 2, fieldId: 3 })).toEqual([]);
    });

    it("flags an invalid type", () => {
      const service = new ResourceService("animals");
      const errors = service.validateAnimal({ type: "dragonfly", amount: 1 });
      expect(errors.some((e) => e.includes("Invalid animal type"))).toBe(true);
    });

    it("flags a non-positive amount", () => {
      const service = new ResourceService("animals");
      expect(service.validateAnimal({ type: "cow", amount: 0 })).toContain("Amount must be a positive number.");
      expect(service.validateAnimal({ type: "cow" })).toContain("Amount must be a positive number.");
    });

    it("flags a non-numeric fieldId", () => {
      const service = new ResourceService("animals");
      expect(service.validateAnimal({ type: "cow", amount: 1, fieldId: "abc" })).toContain("fieldId must be a number if provided.");
    });
  });

  describe("createAnimal", () => {
    it("throws a 400 error when validation fails", async () => {
      const service = new ResourceService("animals");
      let thrown;
      try {
        await service.createAnimal(2, { type: "nope", amount: 0 });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.status).toBe(400);
    });

    it("creates an animal and normalizes amount/fieldId to numbers", async () => {
      const service = new ResourceService("animals");
      let stored;
      vi.spyOn(service.db, "add").mockImplementation(async (item) => {
        stored = item;
      });
      vi.spyOn(service.db, "find").mockResolvedValue([{ id: 9, userId: 2, type: "cow", amount: 3, fieldId: 4 }]);

      const result = await service.createAnimal(2, { type: "cow", amount: "3", fieldId: "4" });
      expect(stored).toMatchObject({ userId: 2, type: "cow", amount: 3, fieldId: 4 });
      expect(result).toEqual({ id: 9, userId: 2, type: "cow", amount: 3, fieldId: 4 });
    });
  });

  describe("updateAnimal", () => {
    it("rejects invalid ids", async () => {
      const service = new ResourceService("animals");
      await expect(service.updateAnimal(0, 1, {})).rejects.toThrow("Invalid user ID format");
      await expect(service.updateAnimal(1, 0, {})).rejects.toThrow("Invalid animal ID format");
    });

    it("throws a 400 error for an invalid partial update", async () => {
      const service = new ResourceService("animals");
      let thrown;
      try {
        await service.updateAnimal(2, 1, { type: "griffon" });
      } catch (err) {
        thrown = err;
      }
      expect(thrown.status).toBe(400);
    });

    it("applies only the provided fields", async () => {
      const service = new ResourceService("animals");
      vi.spyOn(service.db, "findOne").mockResolvedValue({ id: 1, userId: 2, type: "cow", amount: 1, fieldId: 3 });
      vi.spyOn(service.db, "updateRecords").mockImplementation(async (predicate, updater) => {
        const item = { id: 1, userId: 2, type: "cow", amount: 1, fieldId: 3 };
        return [updater(item)];
      });

      const result = await service.updateAnimal(2, 1, { amount: "5" });
      expect(result).toMatchObject({ id: 1, userId: 2, type: "cow", amount: 5, fieldId: 3 });
    });

    it("clears fieldId when explicitly set to null", async () => {
      const service = new ResourceService("animals");
      vi.spyOn(service.db, "findOne").mockResolvedValue({ id: 1, userId: 2, type: "cow", amount: 1, fieldId: 3 });
      vi.spyOn(service.db, "updateRecords").mockImplementation(async (predicate, updater) => [updater({ id: 1, userId: 2, type: "cow", amount: 1, fieldId: 3 })]);

      const result = await service.updateAnimal(2, 1, { fieldId: null });
      expect(result.fieldId).toBeUndefined();
    });
  });

  describe("assignStaffToField / removeAssignment validation", () => {
    it("assignStaffToField rejects invalid ids", async () => {
      const service = new ResourceService("fields");
      await expect(service.assignStaffToField(0, 1, 1)).rejects.toThrow("Invalid user ID format");
      await expect(service.assignStaffToField(1, 0, 1)).rejects.toThrow("Invalid field ID format");
      await expect(service.assignStaffToField(1, 1, 0)).rejects.toThrow("Invalid staff ID format");
    });

    it("removeAssignment rejects invalid ids", async () => {
      const service = new ResourceService("fields");
      await expect(service.removeAssignment(0, 1)).rejects.toThrow("Invalid user ID format");
      await expect(service.removeAssignment(1, 0)).rejects.toThrow("Invalid assignment ID format");
    });
  });

  describe("listDistricts", () => {
    it("returns an empty array for non-fields resource types", async () => {
      const service = new ResourceService("staff");
      expect(await service.listDistricts(1)).toEqual([]);
    });

    it("aggregates across all fields when no userId is supplied", async () => {
      const service = new ResourceService("fields");
      const fields = [
        { id: 1, userId: 1, districtName: "Krakow", area: 10 },
        { id: 2, userId: 2, districtName: "Krakow", area: 5 },
        { id: 3, userId: 1, districtName: "Warszawa", area: 20 },
        { id: 4, userId: 3, districtName: "", area: 3 },
      ];
      vi.spyOn(service.db, "find").mockImplementation(async (predicate) => fields.filter(predicate));

      const result = await service.listDistricts();
      expect(result).toEqual({
        Krakow: { fieldsCount: 2, fieldsAreaHa: 15 },
        Warszawa: { fieldsCount: 1, fieldsAreaHa: 20 },
      });
    });

    it("returns zeroed stats for an unknown single district lookup", async () => {
      const service = new ResourceService("fields");
      vi.spyOn(service.db, "find").mockResolvedValue([{ id: 1, userId: 1, districtName: "Krakow", area: 10 }]);

      const result = await service.listDistricts(undefined, "Gdansk");
      expect(result).toEqual({ districtName: "Gdansk", fieldsCount: 0, fieldsAreaHa: 0 });
    });
  });

  describe("cascadeDelete (static)", () => {
    it("removes assignments for a deleted field", async () => {
      const assignmentsDb = dbManager.getAssignmentsDatabase();
      let updater;
      vi.spyOn(assignmentsDb, "update").mockImplementation(async (fn) => {
        updater = fn;
      });

      await ResourceService.cascadeDelete({ type: "field", id: 7 });
      expect(updater).toBeTypeOf("function");
      expect(updater([{ id: 1, fieldId: 7 }, { id: 2, fieldId: 8 }])).toEqual([{ id: 2, fieldId: 8 }]);
    });

    it("removes assignments for a deleted staff member", async () => {
      const assignmentsDb = dbManager.getAssignmentsDatabase();
      let updater;
      vi.spyOn(assignmentsDb, "update").mockImplementation(async (fn) => {
        updater = fn;
      });

      await ResourceService.cascadeDelete({ type: "staff", id: 4 });
      expect(updater([{ id: 1, staffId: 4 }, { id: 2, staffId: 5 }])).toEqual([{ id: 2, staffId: 5 }]);
    });

    it("detaches a deleted animal from its field rather than deleting the row", async () => {
      const animalsDb = dbManager.getAnimalsDatabase();
      let updater;
      vi.spyOn(animalsDb, "update").mockImplementation(async (fn) => {
        updater = fn;
      });

      await ResourceService.cascadeDelete({ type: "animal", id: 2 });
      const next = updater([{ id: 2, fieldId: 9 }, { id: 3, fieldId: 9 }]);
      expect(next[0]).toMatchObject({ id: 2, fieldId: undefined });
      expect(next[1]).toMatchObject({ id: 3, fieldId: 9 });
    });

    it("removes every owned resource type for a deleted user", async () => {
      const fieldsDb = dbManager.getFieldsDatabase();
      const staffDb = dbManager.getStaffDatabase();
      const animalsDb = dbManager.getAnimalsDatabase();
      const assignmentsDb = dbManager.getAssignmentsDatabase();
      const avatarsDb = dbManager.getUserAvatarsDatabase();

      const captured = {};
      for (const [key, db] of Object.entries({ fieldsDb, staffDb, animalsDb, assignmentsDb, avatarsDb })) {
        vi.spyOn(db, "update").mockImplementation(async (fn) => {
          captured[key] = fn;
        });
      }

      await ResourceService.cascadeDelete({ type: "user", userId: 3 });

      expect(captured.fieldsDb([{ userId: 3 }, { userId: 4 }])).toEqual([{ userId: 4 }]);
      expect(captured.staffDb([{ userId: 3 }, { userId: 4 }])).toEqual([{ userId: 4 }]);
      expect(captured.animalsDb([{ userId: 3 }, { userId: 4 }])).toEqual([{ userId: 4 }]);
      expect(captured.assignmentsDb([{ userId: 3 }, { userId: 4 }])).toEqual([{ userId: 4 }]);
      const avatarResult = captured.avatarsDb({ version: 1, avatars: [{ userId: 3 }, { userId: 4 }] });
      expect(avatarResult.avatars).toEqual([{ userId: 4 }]);
    });

    it("rejects an invalid field id", async () => {
      await expect(ResourceService.cascadeDelete({ type: "field", id: 0 })).rejects.toThrow("Invalid field ID format");
    });

    it("rejects an invalid user id", async () => {
      await expect(ResourceService.cascadeDelete({ type: "user", userId: -1 })).rejects.toThrow("Invalid user ID format");
    });
  });
});
