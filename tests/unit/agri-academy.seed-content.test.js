import { describe, it, expect } from "vitest";
const path = require("path");

// The question bank self-seeds ~100 hand-written farm-safety questions across 11
// pools — the actual certification content a freshly booted ecosystem is taken
// against. The gRPC test only draws from ONE pool and checks counts, so a typo in
// any other pool (a `correct` id pointing at a missing option, a `single` with two
// correct answers, duplicate option ids, an ungradeable question) would ship
// silently. This validates EVERY seeded question against the bank's own validator
// AND against the real grading engine.
const QB = path.join(__dirname, "..", "..", "external-services", "agri-academy", "question-bank-service");
const GR = path.join(__dirname, "..", "..", "external-services", "agri-academy", "grading-service");

const { buildSeed } = require(path.join(QB, "server", "seed.js"));
const { _internals } = require(path.join(QB, "server", "handlers.js"));
const gradingRegistry = require(path.join(GR, "question-types", "index.js"));

const { validateQuestion } = _internals;
const SEED = buildSeed();

// Flatten to [examId, question] pairs for per-question assertions with context.
const allQuestions = Object.entries(SEED.pools).flatMap(([examId, pool]) => pool.map((q) => [examId, q]));

describe("agri-academy seed — pool structure", () => {
  it("seeds the expected exam pools", () => {
    const expected = [
      "pesticide-basics",
      "tractor-safety",
      "demo-quiz",
      "exam-5",
      "exam-6",
      "exam-7",
      "exam-8",
      "exam-9",
      "exam-10",
      "exam-11",
      "exam-12",
    ];
    expect(Object.keys(SEED.pools).sort()).toEqual([...expected].sort());
  });

  it("every pool is non-empty", () => {
    for (const [examId, pool] of Object.entries(SEED.pools)) {
      expect(pool.length, `pool ${examId} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("question ids are unique within each pool", () => {
    for (const [examId, pool] of Object.entries(SEED.pools)) {
      const ids = pool.map((q) => q.id);
      expect(new Set(ids).size, `pool ${examId} has duplicate question ids`).toBe(ids.length);
    }
  });

  it("seeds a substantial question set (regression guard on total count)", () => {
    expect(allQuestions.length).toBeGreaterThanOrEqual(90);
  });
});

describe("agri-academy seed — every question is well-formed", () => {
  it("passes the bank's defense-in-depth validator", () => {
    for (const [examId, q] of allQuestions) {
      expect(validateQuestion(q), `${examId}/${q.id} failed validation`).toBeNull();
    }
  });

  it("single questions have exactly one correct option; multi have at least one", () => {
    for (const [examId, q] of allQuestions) {
      if (q.type === "single") {
        expect(q.correct.length, `${examId}/${q.id} single must have exactly one correct`).toBe(1);
      } else {
        expect(q.correct.length, `${examId}/${q.id} multi must have >= 1 correct`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("every correct id references a real option, and option ids are unique", () => {
    for (const [examId, q] of allQuestions) {
      const optionIds = q.options.map((o) => o.id);
      expect(new Set(optionIds).size, `${examId}/${q.id} duplicate option ids`).toBe(optionIds.length);
      for (const c of q.correct) {
        expect(optionIds, `${examId}/${q.id} correct '${c}' not an option`).toContain(c);
      }
    }
  });

  it("every option has non-empty text and each question has a positive weight", () => {
    for (const [examId, q] of allQuestions) {
      expect(Number(q.weight), `${examId}/${q.id} weight must be positive`).toBeGreaterThan(0);
      for (const o of q.options) {
        expect(String(o.text).trim().length, `${examId}/${q.id} option '${o.id}' has blank text`).toBeGreaterThan(0);
      }
    }
  });
});

describe("agri-academy seed — content is gradeable end-to-end", () => {
  // Map a seeded question to a grading item: the answer key IS the correct set.
  const toGradeItem = (q, answer) => ({ type: q.type, question_id: q.id, key: q.correct, answer, weight: q.weight });

  it("answering every question with its key scores full marks", () => {
    for (const [examId, q] of allQuestions) {
      const { awarded, max, correct } = gradingRegistry.scoreItem(toGradeItem(q, q.correct));
      expect(max, `${examId}/${q.id} has zero max`).toBeGreaterThan(0);
      expect(awarded, `${examId}/${q.id} correct answer not full marks`).toBe(max);
      expect(correct, `${examId}/${q.id} correct answer not marked correct`).toBe(true);
    }
  });

  it("an empty answer never scores full marks", () => {
    for (const [examId, q] of allQuestions) {
      const { awarded, max } = gradingRegistry.scoreItem(toGradeItem(q, []));
      expect(awarded, `${examId}/${q.id} empty answer scored full`).toBeLessThan(max);
    }
  });

  it("a full-key attempt grades to 100% and passes", () => {
    for (const [examId, pool] of Object.entries(SEED.pools)) {
      const items = pool.map((q) => toGradeItem(q, q.correct));
      const result = gradingRegistry.grade(items, 100);
      expect(result.score_pct, `pool ${examId} did not grade to 100%`).toBe(100);
      expect(result.passed, `pool ${examId} did not pass at 100%`).toBe(true);
    }
  });
});
