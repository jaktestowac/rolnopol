import { describe, expect, it, beforeEach } from "vitest";
const { WaveGenerator } = require("../../services/fd/wave-generator");

describe("WaveGenerator", () => {
  let generator;
  let mockRng;

  beforeEach(() => {
    generator = new WaveGenerator();
    mockRng = { next: () => 0.5 }; // Deterministic mock
  });

  it("generates a queue for wave 1 with default strategy", () => {
    const queue = generator.generate(1, 10, { rng: mockRng });
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((t) => ["grunt", "scout", "brute", "boss"].includes(t))).toBe(true);
  });

  it("wave difficulty scales up", () => {
    const wave1 = generator.generate(1, 10, { rng: mockRng });
    const wave5 = generator.generate(5, 10, { rng: mockRng });
    expect(wave5.length).toBeGreaterThan(wave1.length);
  });

  it("boss appears every 5th wave", () => {
    const wave5 = generator.generate(5, 10, { rng: mockRng });
    expect(wave5).toContain("boss");
  });

  it("endless strategy generates enemies", () => {
    const queue = generator.generate(1, 0, { strategy: "endless", rng: mockRng });
    expect(queue.length).toBeGreaterThan(0);
  });

  it("supports custom strategy registration", () => {
    generator.registerStrategy("bossRush", (wave) => {
      return Array(3 + wave).fill("boss");
    });
    const queue = generator.generate(1, 10, { strategy: "bossRush" });
    expect(queue.every((t) => t === "boss")).toBe(true);
    expect(queue.length).toBe(4); // 3 + 1
  });

  it("falls back to default for unknown strategy", () => {
    const queue = generator.generate(1, 10, { strategy: "unknown", rng: mockRng });
    expect(queue.length).toBeGreaterThan(0);
  });
});
