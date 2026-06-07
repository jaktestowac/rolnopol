import { describe, expect, it, beforeEach } from "vitest";
const { EffectRegistry } = require("../../services/fd/effect-registry");

describe("EffectRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new EffectRegistry();
  });

  it("registers and retrieves an effect", () => {
    registry.register("slow", { label: "Slow", duration: 4 });
    const def = registry.get("slow");
    expect(def).toBeDefined();
    expect(def.label).toBe("Slow");
    expect(def.duration).toBe(4);
  });

  it("has() checks existence", () => {
    registry.register("slow", { duration: 4 });
    expect(registry.has("slow")).toBe(true);
    expect(registry.has("burn")).toBe(false);
  });

  it("names() returns all effect names", () => {
    registry.register("slow", {});
    registry.register("burn", {});
    expect(registry.names()).toEqual(["slow", "burn"]);
  });

  it("onApply lifecycle is called", () => {
    let applied = false;
    registry.register("slow", {
      duration: 4,
      onApply(enemy) {
        applied = true;
        enemy.speed *= 0.5;
      },
    });

    const enemy = { speed: 2 };
    const def = registry.get("slow");
    def.onApply(enemy);
    expect(applied).toBe(true);
    expect(enemy.speed).toBe(1);
  });

  it("onTick and onExpire lifecycle", () => {
    let tickCount = 0;
    let expired = false;
    registry.register("burn", {
      duration: 3,
      onTick(enemy) {
        tickCount++;
        enemy.hp -= 5;
      },
      onExpire(enemy) {
        expired = true;
      },
    });

    const enemy = { hp: 30 };
    const def = registry.get("burn");
    def.onTick(enemy);
    def.onTick(enemy);
    expect(tickCount).toBe(2);
    expect(enemy.hp).toBe(20);

    def.onExpire(enemy);
    expect(expired).toBe(true);
  });
});
