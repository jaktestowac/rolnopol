import { describe, expect, it, beforeEach } from "vitest";
const { EnemyRegistry } = require("../../services/fd/enemy-registry");

describe("EnemyRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new EnemyRegistry();
  });

  it("registers and retrieves an enemy type", () => {
    registry.register("grunt", { label: "Grunt", hp: 30, speed: 1, reward: 10, icon: "fa-bug" });
    const def = registry.get("grunt");
    expect(def).toBeDefined();
    expect(def.hp).toBe(30);
  });

  it("createInstance builds a runtime enemy", () => {
    registry.register("grunt", { label: "Grunt", hp: 30, speed: 1, reward: 10, icon: "fa-bug" });
    const enemy = registry.createInstance("grunt", "enemy-1");
    expect(enemy.id).toBe("enemy-1");
    expect(enemy.type).toBe("grunt");
    expect(enemy.hp).toBe(30);
    expect(enemy.maxHp).toBe(30);
    expect(enemy.speed).toBe(1);
    expect(enemy.pathIndex).toBe(0);
    expect(enemy.effects).toEqual([]);
  });

  it("createInstance throws for unknown type", () => {
    expect(() => registry.createInstance("unknown", "enemy-1")).toThrow("Unknown enemy type");
  });

  it("lists all registered types", () => {
    registry.register("grunt", { hp: 30 });
    registry.register("boss", { hp: 200 });
    expect(registry.list().length).toBe(2);
    expect(registry.names()).toEqual(["grunt", "boss"]);
  });
});
