import { describe, expect, it, beforeEach } from "vitest";
const { TowerRegistry } = require("../../services/fd/tower-registry");

describe("TowerRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new TowerRegistry();
  });

  it("registers and retrieves a tower type", () => {
    registry.register("archer", { label: "Archer", cost: 50, range: 3, damage: 10, fireRate: 1, icon: "fa-bullseye" });
    const def = registry.get("archer");
    expect(def).toBeDefined();
    expect(def.label).toBe("Archer");
    expect(def.cost).toBe(50);
  });

  it("lists all registered types", () => {
    registry.register("archer", { label: "Archer", cost: 50 });
    registry.register("cannon", { label: "Cannon", cost: 100 });
    const list = registry.list();
    expect(list.length).toBe(2);
  });

  it("returns names array", () => {
    registry.register("archer", { label: "Archer", cost: 50 });
    registry.register("frost", { label: "Frost", cost: 75 });
    expect(registry.names()).toEqual(["archer", "frost"]);
  });

  it("has() checks existence", () => {
    registry.register("archer", { label: "Archer", cost: 50 });
    expect(registry.has("archer")).toBe(true);
    expect(registry.has("laser")).toBe(false);
  });

  it("get() returns undefined for unknown type", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("applies defaults for missing fields", () => {
    registry.register("minimal", {});
    const def = registry.get("minimal");
    expect(def.label).toBe("minimal");
    expect(def.icon).toBe("fa-chess-rook");
    expect(def.targeting).toBe("nearest");
  });
});
