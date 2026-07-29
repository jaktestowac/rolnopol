import { describe, it, expect } from "vitest";
const path = require("path");

// The grading-side scoring registry. Its grade()/scoreItem() logic is exercised
// end-to-end over gRPC in agri-academy.grading.test.js, but the pure scoring math
// (partial credit, unknown-type handling, percentage rounding, inclusive pass
// threshold) had no direct unit test — the mirror of the authoring validation
// registry test.
const registry = require(
  path.join(__dirname, "..", "..", "external-services", "agri-academy", "grading-service", "question-types", "index.js"),
);

describe("grading registry — built-ins", () => {
  it("ships single + multi scoring strategies", () => {
    expect(registry.types().sort()).toEqual(["multi", "single"]);
  });

  it("resolve returns null for an unknown type", () => {
    expect(registry.resolve("essay")).toBeNull();
  });

  it("register rejects a malformed strategy", () => {
    expect(() => registry.register({})).toThrow(/type, score/);
    expect(() => registry.register({ type: "x" })).toThrow(/type, score/);
  });

  it("register adds a custom strategy that resolve then returns", () => {
    const strategy = { type: "truefalse", score: () => ({ awarded: 1, max: 1, correct: true }) };
    registry.register(strategy);
    expect(registry.resolve("truefalse")).toBe(strategy);
    expect(registry.types()).toContain("truefalse");
  });
});

describe("grading registry — single scoring", () => {
  const single = registry.resolve("single");

  it("awards full weight for the correct single answer", () => {
    expect(single.score({ key: ["a"], answer: ["a"] })).toEqual({ awarded: 1, max: 1, correct: true });
  });

  it("awards nothing for a wrong answer", () => {
    expect(single.score({ key: ["a"], answer: ["b"] })).toEqual({ awarded: 0, max: 1, correct: false });
  });

  it("treats an empty or multi answer as incorrect", () => {
    expect(single.score({ key: ["a"], answer: [] }).correct).toBe(false);
    expect(single.score({ key: ["a"], answer: ["a", "b"] }).correct).toBe(false);
  });

  it("honors a custom weight", () => {
    expect(single.score({ key: ["a"], answer: ["a"], weight: 3 })).toEqual({ awarded: 3, max: 3, correct: true });
  });
});

describe("grading registry — multi scoring (partial credit)", () => {
  const multi = registry.resolve("multi");

  it("awards full credit for a fully-correct set", () => {
    expect(multi.score({ key: ["a", "c"], answer: ["a", "c"] })).toEqual({ awarded: 2, max: 2, correct: true });
  });

  it("gives partial credit for a subset with no wrong picks", () => {
    expect(multi.score({ key: ["a", "c"], answer: ["a"] })).toEqual({ awarded: 1, max: 2, correct: false });
  });

  it("subtracts wrong picks and floors the award at zero", () => {
    // 1 correct (a) − 1 wrong (b) => raw 0
    expect(multi.score({ key: ["a", "c"], answer: ["a", "b"] })).toEqual({ awarded: 0, max: 2, correct: false });
    // 1 correct (a) − 2 wrong (b, d) would be negative => floored to 0
    expect(multi.score({ key: ["a", "c"], answer: ["a", "b", "d"] }).awarded).toBe(0);
  });

  it("dedupes selected answers before scoring", () => {
    expect(multi.score({ key: ["a", "c"], answer: ["a", "a", "c"] })).toEqual({ awarded: 2, max: 2, correct: true });
  });

  it("scales award and max by weight", () => {
    expect(multi.score({ key: ["a", "b"], answer: ["a", "b"], weight: 3 })).toEqual({ awarded: 6, max: 6, correct: true });
  });
});

describe("grading registry — scoreItem", () => {
  it("delegates to the resolved strategy for a known type", () => {
    expect(registry.scoreItem({ type: "single", key: ["a"], answer: ["a"] })).toEqual({ awarded: 1, max: 1, correct: true });
  });

  it("scores an unknown type 0 but still counts key length toward max", () => {
    expect(registry.scoreItem({ type: "essay", key: ["a", "b"], weight: 2 })).toEqual({ awarded: 0, max: 4, correct: false });
  });

  it("falls back to max 1 for an unknown type with no key", () => {
    expect(registry.scoreItem({ type: "essay" })).toEqual({ awarded: 0, max: 1, correct: false });
  });
});

describe("grading registry — grade aggregation", () => {
  it("aggregates awards into a rounded percentage with a per-question breakdown", () => {
    const items = [
      { type: "single", question_id: "q1", key: ["a"], answer: ["a"] }, // 1 / 1
      { type: "multi", question_id: "q2", key: ["a", "c"], answer: ["a"] }, // 1 / 2
    ];
    const result = registry.grade(items, 60);
    // total awarded 2 / max 3 => 66.67 => 67
    expect(result.score_pct).toBe(67);
    expect(result.passed).toBe(true);
    expect(result.per_question).toEqual([
      { question_id: "q1", correct: true, awarded: 1, max: 1 },
      { question_id: "q2", correct: false, awarded: 1, max: 2 },
    ]);
  });

  it("treats the pass threshold as inclusive", () => {
    const items = [{ type: "single", question_id: "q1", key: ["a"], answer: ["a"] }];
    expect(registry.grade(items, 100).passed).toBe(true); // 100 >= 100
    expect(registry.grade([{ type: "single", question_id: "q1", key: ["a"], answer: ["b"] }], 1).passed).toBe(false); // 0 >= 1
  });

  it("returns 0% for an empty attempt (and passes only a 0 threshold)", () => {
    expect(registry.grade([], 0)).toEqual({ score_pct: 0, passed: true, per_question: [] });
    expect(registry.grade([], 50).passed).toBe(false);
    expect(registry.grade(undefined, 0).score_pct).toBe(0);
  });
});
