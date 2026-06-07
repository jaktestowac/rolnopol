import { describe, expect, it, beforeEach } from "vitest";
const { MapGenerator } = require("../../services/fd/map-generator");

describe("MapGenerator", () => {
  let generator;

  beforeEach(() => {
    generator = new MapGenerator();
  });

  it("generates a map with correct dimensions", () => {
    const map = generator.generate(11, 11, "test-seed");
    expect(map.cells.length).toBe(11);
    expect(map.cells[0].length).toBe(11);
  });

  it("generates a valid path from spawn to exit", () => {
    const map = generator.generate(11, 11, "test-seed");
    expect(map.path.length).toBeGreaterThan(0);
    expect(map.spawn).toBeDefined();
    expect(map.exit).toBeDefined();
    expect(map.spawn.x).toBe(0);
    expect(map.exit.x).toBe(10);
  });

  it("marks spawn and exit cells", () => {
    const map = generator.generate(11, 11, "test-seed");
    expect(map.cells[map.spawn.y][map.spawn.x]).toBe("spawn");
    expect(map.cells[map.exit.y][map.exit.x]).toBe("exit");
  });

  it("generates deterministic maps from same seed", () => {
    const map1 = generator.generate(15, 15, "same-seed");
    const map2 = generator.generate(15, 15, "same-seed");
    expect(map1.cells).toEqual(map2.cells);
    expect(map1.path).toEqual(map2.path);
  });

  it("generates different maps from different seeds", () => {
    const map1 = generator.generate(15, 15, "seed-a");
    const map2 = generator.generate(15, 15, "seed-b");
    // Paths should differ (very unlikely to be identical)
    expect(map1.path).not.toEqual(map2.path);
  });

  it("marks cells as buildable, path, or blocked", () => {
    const map = generator.generate(11, 11, "test-seed");
    const validTypes = new Set(["buildable", "path", "blocked", "spawn", "exit"]);
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        expect(validTypes.has(map.cells[y][x])).toBe(true);
      }
    }
  });

  it("path cells are contiguous", () => {
    const map = generator.generate(11, 11, "test-seed");
    for (let i = 1; i < map.path.length; i++) {
      const prev = map.path[i - 1];
      const curr = map.path[i];
      const dist = Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y);
      expect(dist).toBeLessThanOrEqual(1); // Adjacent cells
    }
  });
});
