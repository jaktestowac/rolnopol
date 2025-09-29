import ResourceService from "../../services/resource.service.js";
import { describe, it, expect, vi } from "vitest";

describe("resource.service", () => {
  it("should throw error for invalid resource type", () => {
    expect(() => new ResourceService("invalid")).toThrow(
      "Unsupported resource type",
    );
  });

  it("should delegate to db for fields", async () => {
    const service = new ResourceService("fields");
    const spy = vi.spyOn(service.db, "getAll").mockResolvedValue([{ id: 1 }]);
    const result = await service.db.getAll();
    expect(result).toEqual([{ id: 1 }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should list resources for user", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "find").mockResolvedValue([{ id: 1, userId: 2 }]);
    const result = await service.list(2);
    expect(result).toEqual([{ id: 1, userId: 2 }]);
  });

  it("should create resource for user", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "add").mockResolvedValue();
    vi.spyOn(service.db, "find").mockResolvedValue([
      { id: 1, userId: 2 },
      { id: 2, userId: 2 },
    ]);
    const result = await service.create(2, { name: "Field" });
    expect(result).toEqual({ id: 2, userId: 2 });
  });

  it("should delete resource and cascade", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "remove").mockResolvedValue();
    const cascadeSpy = vi
      .spyOn(ResourceService, "cascadeDelete")
      .mockResolvedValue();
    const result = await service.delete(2, 3);
    expect(result).toBe(true);
    expect(cascadeSpy).toHaveBeenCalled();
  });

  it("should update resource", async () => {
    const service = new ResourceService("fields");
    vi.spyOn(service.db, "updateRecords").mockResolvedValue([
      { id: 1, userId: 2, name: "Updated" },
    ]);
    const result = await service.update(2, 1, { name: "Updated" });
    expect(result).toEqual({ id: 1, userId: 2, name: "Updated" });
  });

  it("should validate animal with errors", () => {
    const service = new ResourceService("animals");
    const errors = service.validateAnimal({
      type: "invalid",
      amount: 0,
      fieldId: "bad",
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should create animal successfully", async () => {
    const service = new ResourceService("animals");
    vi.spyOn(service, "validateAnimal").mockReturnValue([]);
    vi.spyOn(service.db, "add").mockResolvedValue();
    vi.spyOn(service.db, "find").mockResolvedValue([
      { id: 1, userId: 2 },
      { id: 2, userId: 2 },
    ]);
    const result = await service.createAnimal(2, { type: "cow", amount: 1 });
    expect(result).toEqual({ id: 2, userId: 2 });
  });

  it("should update animal successfully", async () => {
    const service = new ResourceService("animals");
    vi.spyOn(service.db, "updateRecords").mockResolvedValue([
      { id: 1, userId: 2, type: "cow", amount: 2 },
    ]);
    const result = await service.updateAnimal(2, 1, { type: "cow", amount: 2 });
    expect(result).toEqual({ id: 1, userId: 2, type: "cow", amount: 2 });
  });

  it("should assign staff to field", async () => {
    const service = new ResourceService("fields");
    const assignmentsDb =
      require("../../data/database-manager").getAssignmentsDatabase();
    vi.spyOn(assignmentsDb, "add").mockResolvedValue();
    vi.spyOn(assignmentsDb, "find").mockResolvedValue([
      { id: 1, userId: 2, fieldId: 3, staffId: 4 },
    ]);
    const result = await service.assignStaffToField(2, 3, 4);
    expect(result).toEqual({ id: 1, userId: 2, fieldId: 3, staffId: 4 });
  });

  it("should list assignments", async () => {
    const service = new ResourceService("fields");
    const assignmentsDb =
      require("../../data/database-manager").getAssignmentsDatabase();
    vi.spyOn(assignmentsDb, "find").mockResolvedValue([{ id: 1, userId: 2 }]);
    const result = await service.listAssignments(2);
    expect(result).toEqual([{ id: 1, userId: 2 }]);
  });

  it("should remove assignment", async () => {
    const service = new ResourceService("fields");
    const assignmentsDb =
      require("../../data/database-manager").getAssignmentsDatabase();
    vi.spyOn(assignmentsDb, "remove").mockResolvedValue();
    const result = await service.removeAssignment(2, 5);
    expect(result).toBe(true);
  });
});
