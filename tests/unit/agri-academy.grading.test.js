import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");

// Ephemeral gRPC port + silent logs BEFORE requiring the service.
process.env.GRADING_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const GR = path.join(__dirname, "..", "..", "external-services", "agri-academy", "grading-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(GR, "config.js"));
const { start } = require(path.join(GR, "server", "index.js"));
const registry = require(path.join(GR, "question-types", "index.js"));

let server;
let grading;
let health;
const grade = (items, passPct) => callUnary(grading, "GradeAttempt", { items, pass_pct: passPct });

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "grading");
  grading = new proto.Grading(target, grpc.credentials.createInsecure());
  health = new proto.Health(target, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
});

describe("grading — health", () => {
  it("Check reports SERVING", async () => {
    const reply = await callUnary(health, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.version).toBeTruthy();
  });
});

describe("grading — single (exact)", () => {
  const single = (answer) => ({ question_id: "q", type: "single", answer, key: ["a"], weight: 1 });

  it("awards full weight for the right option", async () => {
    const r = await grade([single(["a"])], 100);
    expect(r.score_pct).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.per_question[0].correct).toBe(true);
  });

  it("awards zero for the wrong option", async () => {
    const r = await grade([single(["b"])], 1);
    expect(r.score_pct).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.per_question[0].correct).toBe(false);
  });

  it("awards zero for an empty answer", async () => {
    const r = await grade([single([])], 1);
    expect(r.score_pct).toBe(0);
  });
});

describe("grading — multi (partial credit)", () => {
  const multi = (answer) => ({ question_id: "q", type: "multi", answer, key: ["a", "c"], weight: 1 });

  it("full credit for the exact set", async () => {
    const r = await grade([multi(["a", "c"])], 100);
    expect(r.score_pct).toBe(100);
    expect(r.per_question[0].correct).toBe(true);
  });

  it("partial credit for one of two correct", async () => {
    // correctSelected 1, wrongSelected 0 → 1 of max 2 = 50%
    const r = await grade([multi(["a"])], 60);
    expect(r.score_pct).toBe(50);
    expect(r.passed).toBe(false);
    expect(r.per_question[0].correct).toBe(false);
  });

  it("a wrong pick cancels a right pick (floored at 0)", async () => {
    // correctSelected 1 (a), wrongSelected 1 (b) → max(0, 0) = 0
    const r = await grade([multi(["a", "b"])], 1);
    expect(r.score_pct).toBe(0);
  });

  it("over-selecting never scores negative", async () => {
    // a,c correct + b wrong → (2 - 1) = 1 of max 2 = 50%
    const r = await grade([multi(["a", "b", "c"])], 1);
    expect(r.score_pct).toBe(50);
  });
});

describe("grading — pass threshold boundary", () => {
  // Two single questions, one right → 50%.
  const items = [
    { question_id: "q1", type: "single", answer: ["a"], key: ["a"], weight: 1 },
    { question_id: "q2", type: "single", answer: ["a"], key: ["b"], weight: 1 },
  ];

  it("exactly passPct passes (inclusive)", async () => {
    const r = await grade(items, 50);
    expect(r.score_pct).toBe(50);
    expect(r.passed).toBe(true);
  });

  it("one over passPct fails", async () => {
    const r = await grade(items, 51);
    expect(r.score_pct).toBe(50);
    expect(r.passed).toBe(false);
  });
});

describe("grading — mixed weights", () => {
  it("weights the percentage by question weight", async () => {
    // single weight 3 wrong (0/3), single weight 1 right (1/1) → 1 of 4 = 25%
    const items = [
      { question_id: "q1", type: "single", answer: ["b"], key: ["a"], weight: 3 },
      { question_id: "q2", type: "single", answer: ["a"], key: ["a"], weight: 1 },
    ];
    const r = await grade(items, 60);
    expect(r.score_pct).toBe(25);
  });

  it("empty attempt scores 0%", async () => {
    const r = await grade([], 0);
    expect(r.score_pct).toBe(0);
    expect(r.passed).toBe(true); // 0 >= 0
  });
});

describe("grading — extensibility seam (registry)", () => {
  it("a new scoring strategy becomes usable after register()", () => {
    expect(registry.resolve("truefalse")).toBeNull();
    registry.register({
      type: "truefalse",
      score(item) {
        const correct = (item.answer || [])[0] === (item.key || [])[0];
        return { awarded: correct ? item.weight || 1 : 0, max: item.weight || 1, correct };
      },
    });
    const r = registry.grade([{ question_id: "q", type: "truefalse", answer: ["t"], key: ["t"], weight: 1 }], 100);
    expect(r.score_pct).toBe(100);
  });

  it("register() rejects a malformed strategy", () => {
    expect(() => registry.register({ type: "broken" })).toThrow();
  });
});

// Pure edge/negative cases driven straight through the registry (no gRPC), where
// per-question awarded/max detail is easiest to assert.
describe("grading — edge & negative cases (registry)", () => {
  it("an unresolved type scores 0 but still counts toward max (honest total)", () => {
    const r = registry.grade([{ question_id: "q", type: "ordering", key: ["a", "b"], weight: 1, answer: ["a"] }], 0);
    expect(r.per_question[0]).toMatchObject({ awarded: 0, max: 2, correct: false });
    expect(r.score_pct).toBe(0);
    expect(r.passed).toBe(true); // 0 >= 0
  });

  it("an unresolved type with no key still contributes max 1 (keyLen||1)", () => {
    const r = registry.grade([{ question_id: "q", type: "mystery", weight: 2, answer: [] }], 0);
    expect(r.per_question[0].max).toBe(2); // (0 || 1) * 2
  });

  it("single: selecting MORE than one option is wrong (not a lucky match)", () => {
    const r = registry.grade([{ question_id: "q", type: "single", key: ["a"], weight: 1, answer: ["a", "b"] }], 0);
    expect(r.per_question[0]).toMatchObject({ awarded: 0, correct: false });
  });

  it("single: no answer scores 0", () => {
    const r = registry.grade([{ question_id: "q", type: "single", key: ["a"], weight: 1, answer: [] }], 0);
    expect(r.score_pct).toBe(0);
  });

  it("multi: empty answer scores 0 but max reflects the key×weight", () => {
    const r = registry.grade([{ question_id: "q", type: "multi", key: ["a", "c"], weight: 1, answer: [] }], 0);
    expect(r.per_question[0]).toMatchObject({ awarded: 0, max: 2, correct: false });
  });

  it("multi: weight scales both awarded and max (partial credit)", () => {
    // key {a,c} weight 2, answer {a}: correctSelected 1 → awarded 1*2=2, max 2*2=4 → 50%.
    const r = registry.grade([{ question_id: "q", type: "multi", key: ["a", "c"], weight: 2, answer: ["a"] }], 0);
    expect(r.per_question[0]).toMatchObject({ awarded: 2, max: 4, correct: false });
    expect(r.score_pct).toBe(50);
  });

  it("multi: duplicate answers are de-duped (count once)", () => {
    const r = registry.grade([{ question_id: "q", type: "multi", key: ["a", "c"], weight: 1, answer: ["a", "a"] }], 0);
    expect(r.per_question[0].awarded).toBe(1); // not 2
  });

  it("multi: a wrong selection cancels a right one, floored at 0", () => {
    const r = registry.grade([{ question_id: "q", type: "multi", key: ["a", "c"], weight: 1, answer: ["a", "x"] }], 0);
    expect(r.per_question[0].awarded).toBe(0);
  });

  it("rounds the percentage (1 of 3 singles → 33%)", () => {
    const one = (id, right) => ({ question_id: id, type: "single", key: ["a"], weight: 1, answer: right ? ["a"] : ["b"] });
    const r = registry.grade([one("q1", true), one("q2", false), one("q3", false)], 0);
    expect(r.score_pct).toBe(33);
  });

  it("tolerates malformed items and a null item list without throwing", () => {
    expect(() => registry.grade(null, 0)).not.toThrow();
    const r = registry.grade([{ question_id: "q", type: "single", answer: ["a"] /* no key */ }], 0);
    expect(r.per_question[0].max).toBe(0); // key.length 0 → single max 0
    expect(r.score_pct).toBe(0); // maxTotal 0 → 0%, no divide-by-zero
  });
});
