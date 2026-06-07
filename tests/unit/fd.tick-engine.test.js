import { describe, expect, it, beforeEach } from "vitest";
const { TickEngine } = require("../../services/fd/tick-engine");
const { enemyRegistry } = require("../../services/fd/enemy-registry");
const { towerRegistry } = require("../../services/fd/tower-registry");
const { effectRegistry } = require("../../services/fd/effect-registry");

describe("TickEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new TickEngine();
  });

  it("has 10 built-in steps in correct order", () => {
    expect(engine.steps.length).toBe(10);
    const orders = engine.steps.map((s) => s.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it("supports registering custom steps", () => {
    let customCalled = false;
    engine.registerStep("custom", 25, (state) => {
      customCalled = true;
    });
    // Should now have 11 steps
    expect(engine.steps.length).toBe(11);
    // Custom step should be between move(20) and target(30)
    const customIdx = engine.steps.findIndex((s) => s.name === "custom");
    expect(engine.steps[customIdx - 1].name).toBe("move");
    expect(engine.steps[customIdx + 1].name).toBe("target");
  });

  it("run executes all steps", () => {
    const state = {
      wave: { status: "preparing", enemiesSpawned: 0, enemiesTotal: 0, spawnTimer: 0, queue: [] },
      enemies: [],
      towers: [],
      projectiles: [],
      map: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      resources: { gold: 100, lives: 20 },
      stats: { enemiesKilled: 0, enemiesLeaked: 0, wavesCompleted: 0, totalDamageDealt: 0, gameOver: false, victory: false },
      _counters: { enemyId: 0, projId: 0 },
    };

    // Should not throw
    engine.run(state, { towerRegistry, enemyRegistry, effectRegistry });
    expect(state.stats.gameOver).toBe(false);
  });

  it("tick moves enemies along path", () => {
    const state = {
      wave: { status: "active", enemiesSpawned: 5, enemiesTotal: 5, spawnTimer: 0, queue: [] },
      enemies: [{ id: "e1", type: "grunt", hp: 30, maxHp: 30, speed: 1, reward: 10, pathIndex: 2, effects: [] }],
      towers: [],
      projectiles: [],
      map: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
        ],
      },
      resources: { gold: 100, lives: 20 },
      stats: { enemiesKilled: 0, enemiesLeaked: 0, wavesCompleted: 0, totalDamageDealt: 0, gameOver: false, victory: false },
      _counters: { enemyId: 1, projId: 0 },
    };

    engine.run(state, { towerRegistry, enemyRegistry, effectRegistry });
    expect(state.enemies[0].pathIndex).toBe(3);
  });

  it("enemy reaching exit deducts a life", () => {
    const state = {
      wave: { status: "active", enemiesSpawned: 1, enemiesTotal: 1, spawnTimer: 0, queue: [] },
      enemies: [{ id: "e1", type: "grunt", hp: 30, maxHp: 30, speed: 1, reward: 10, pathIndex: 4, effects: [] }],
      towers: [],
      projectiles: [],
      map: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
        ],
      },
      resources: { gold: 100, lives: 20 },
      stats: { enemiesKilled: 0, enemiesLeaked: 0, wavesCompleted: 0, totalDamageDealt: 0, gameOver: false, victory: false },
      _counters: { enemyId: 1, projId: 0 },
    };

    engine.run(state, { towerRegistry, enemyRegistry, effectRegistry });
    expect(state.resources.lives).toBe(19);
    expect(state.stats.enemiesLeaked).toBe(1);
  });

  it("dead enemies award gold", () => {
    const state = {
      wave: { status: "active", enemiesSpawned: 1, enemiesTotal: 1, spawnTimer: 0, queue: [] },
      enemies: [{ id: "e1", type: "grunt", hp: -5, maxHp: 30, speed: 1, reward: 10, pathIndex: 2, effects: [] }],
      towers: [],
      projectiles: [],
      map: {
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
      resources: { gold: 100, lives: 20 },
      stats: { enemiesKilled: 0, enemiesLeaked: 0, wavesCompleted: 0, totalDamageDealt: 0, gameOver: false, victory: false },
      _counters: { enemyId: 1, projId: 0 },
    };

    engine.run(state, { towerRegistry, enemyRegistry, effectRegistry });
    expect(state.resources.gold).toBe(110);
    expect(state.stats.enemiesKilled).toBe(1);
    expect(state.enemies.length).toBe(0);
  });
});
