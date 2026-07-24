import { describe, it, expect, vi, afterEach } from "vitest";

const dbManager = require("../../data/database-manager");
const { getJarCounts } = require("../../services/jar-counts.service");

// Helper to stub a database-manager getter with a getAll() result.
function stubDb(getterName, getAllResult) {
  vi.spyOn(dbManager, getterName).mockReturnValue({
    getAll: async () => getAllResult,
    read: async () => getAllResult,
  });
}

describe("jar-counts.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the five firefly-jar resource buckets with expected shape", async () => {
    stubDb("getFieldsDatabase", [{ id: 1 }, { id: 2 }, { id: 3 }]);
    stubDb("getAnimalsDatabase", [{ amount: 5 }, { amount: 3 }]);
    stubDb("getStaffDatabase", [{ id: 1 }, { id: 2 }]);
    stubDb("getUserDatabase", [{ id: 1 }]);

    const result = await getJarCounts();
    expect(result.map((r) => r.id)).toEqual(["notifications", "fields", "animals", "staff", "users"]);

    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId.fields.count).toBe(3);
    expect(byId.animals.count).toBe(8); // amounts summed, not row count
    expect(byId.staff.count).toBe(2);
    expect(byId.users.count).toBe(1);

    // Each bucket carries display metadata for the frontend.
    for (const bucket of result) {
      expect(bucket).toHaveProperty("color");
      expect(bucket).toHaveProperty("label");
      expect(bucket).toHaveProperty("icon");
    }
  });

  it("degrades each count to 0 when its database throws", async () => {
    const throwingDb = {
      getAll: async () => {
        throw new Error("db down");
      },
      read: async () => {
        throw new Error("db down");
      },
    };
    vi.spyOn(dbManager, "getFieldsDatabase").mockReturnValue(throwingDb);
    vi.spyOn(dbManager, "getAnimalsDatabase").mockReturnValue(throwingDb);
    vi.spyOn(dbManager, "getStaffDatabase").mockReturnValue(throwingDb);
    vi.spyOn(dbManager, "getUserDatabase").mockReturnValue(throwingDb);

    const result = await getJarCounts();
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId.fields.count).toBe(0);
    expect(byId.animals.count).toBe(0);
    expect(byId.staff.count).toBe(0);
    expect(byId.users.count).toBe(0);
  });

  it("ignores non-array database payloads", async () => {
    stubDb("getFieldsDatabase", null);
    stubDb("getAnimalsDatabase", { not: "an array" });
    stubDb("getStaffDatabase", undefined);
    stubDb("getUserDatabase", "nope");

    const result = await getJarCounts();
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId.fields.count).toBe(0);
    expect(byId.animals.count).toBe(0);
    expect(byId.staff.count).toBe(0);
    expect(byId.users.count).toBe(0);
  });
});
