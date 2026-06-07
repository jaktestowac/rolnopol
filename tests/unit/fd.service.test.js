import { describe, expect, it, beforeEach } from "vitest";
const farmDefenceService = require("../../services/fd.service");

describe("FarmDefenceService", () => {
  beforeEach(() => {
    farmDefenceService.resetFarmDefence({ seed: "fd-unit-seed", size: "tiny" }, { logCreation: false });
  });

  it("returns a snapshot with map, resources, and capabilities", () => {
    const snapshot = farmDefenceService.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.map).toBeDefined();
    expect(snapshot.resources).toBeDefined();
    expect(snapshot.capabilities).toBeDefined();
    expect(snapshot.id).toContain("fd-");
  });

  it("generates deterministic maps from seed", () => {
    farmDefenceService.resetFarmDefence({ seed: "same-seed", size: "tiny" }, { logCreation: false });
    const snap1 = farmDefenceService.getSnapshot();

    farmDefenceService.resetFarmDefence({ seed: "same-seed", size: "tiny" }, { logCreation: false });
    const snap2 = farmDefenceService.getSnapshot();

    expect(snap1.grid).toEqual(snap2.grid);
  });

  it("lists themes and sizes", () => {
    const themes = farmDefenceService.listThemes();
    const sizes = farmDefenceService.listSizes();
    expect(themes.map((t) => t.name)).toContain("obsidian");
    expect(themes.map((t) => t.name)).toContain("fields");
    expect(sizes.map((s) => s.name)).toContain("tiny");
    expect(sizes.map((s) => s.name)).toContain("medium");
  });

  it("lists tower and enemy types", () => {
    const towers = farmDefenceService.listTowerTypes();
    const enemies = farmDefenceService.listEnemyTypes();
    expect(towers.map((t) => t.name)).toContain("archer");
    expect(enemies.map((e) => e.name)).toContain("grunt");
  });

  it("placeTower validates cell type and gold", () => {
    const snapshot = farmDefenceService.getSnapshot();
    const grid = snapshot.grid;

    // Find buildable cell
    let bx = -1,
      by = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "buildable") {
          bx = x;
          by = y;
          break;
        }
      }
      if (bx >= 0) break;
    }
    expect(bx).toBeGreaterThanOrEqual(0);

    const result = farmDefenceService.applyAction("placeTower", { x: bx, y: by, type: "archer" });
    expect(result.action).toBe("placeTower");
    expect(result.snapshot.towers.length).toBeGreaterThan(0);
  });

  it("placeTower rejects unknown type", () => {
    expect(() => farmDefenceService.applyAction("placeTower", { x: 0, y: 0, type: "laser" })).toThrow("Unknown tower type");
  });

  it("placeTower rejects non-buildable cell", () => {
    const snapshot = farmDefenceService.getSnapshot();
    const grid = snapshot.grid;
    // Find a path cell
    let px = -1,
      py = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "path") {
          px = x;
          py = y;
          break;
        }
      }
      if (px >= 0) break;
    }
    if (px < 0) return;
    expect(() => farmDefenceService.applyAction("placeTower", { x: px, y: py, type: "archer" })).toThrow();
  });

  it("startWave generates enemy queue and sets status active", () => {
    const result = farmDefenceService.applyAction("startWave");
    expect(result.action).toBe("startWave");
    expect(result.snapshot.wave.status).toBe("active");
    expect(result.snapshot.wave.enemiesTotal).toBeGreaterThan(0);
  });

  it("tick processes during active wave", () => {
    farmDefenceService.applyAction("startWave");
    const result = farmDefenceService.applyAction("tick");
    expect(result.action).toBe("tick");
  });

  it("tick is no-op when wave is preparing", () => {
    const before = farmDefenceService.getSnapshot();
    farmDefenceService.applyAction("tick");
    const after = farmDefenceService.getSnapshot();
    expect(after.revision).toBe(before.revision); // No revision change
  });

  it("accepts action aliases", () => {
    const result = farmDefenceService.applyAction("next");
    expect(result.action).toBe("startWave");
  });

  it("setTheme changes the theme", () => {
    const result = farmDefenceService.applyAction("setTheme", { theme: "fields" });
    expect(result.snapshot.theme).toBe("fields");
  });

  it("setTheme rejects unknown theme", () => {
    expect(() => farmDefenceService.applyAction("setTheme", { theme: "neon" })).toThrow("Unknown theme");
  });

  it("sellTower refunds partial gold", () => {
    const snapshot = farmDefenceService.getSnapshot();
    const grid = snapshot.grid;
    let bx = -1,
      by = -1;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x].t === "buildable") {
          bx = x;
          by = y;
          break;
        }
      }
      if (bx >= 0) break;
    }
    if (bx < 0) return;

    const placed = farmDefenceService.applyAction("placeTower", { x: bx, y: by, type: "archer" });
    const towerId = placed.snapshot.towers.find((t) => t.x === bx && t.y === by).id;

    const goldBefore = placed.snapshot.resources.gold;
    const result = farmDefenceService.applyAction("sellTower", { towerId });
    expect(result.snapshot.resources.gold).toBeGreaterThan(goldBefore);
  });

  it("reset creates fresh state", () => {
    farmDefenceService.applyAction("startWave");
    farmDefenceService.resetFarmDefence({ seed: "fresh", size: "tiny" }, { logCreation: false });
    const snapshot = farmDefenceService.getSnapshot();
    expect(snapshot.wave.status).toBe("preparing");
    expect(snapshot.towers.length).toBe(0);
    expect(snapshot.enemies.length).toBe(0);
  });

  it("getUpdates returns changes since revision", () => {
    const snap = farmDefenceService.getSnapshot();
    const rev = snap.revision;

    farmDefenceService.applyAction("startWave");

    const updates = farmDefenceService.getUpdates(rev);
    expect(updates.changed).toBe(true);
    expect(updates.events.length).toBeGreaterThan(0);
  });
});
