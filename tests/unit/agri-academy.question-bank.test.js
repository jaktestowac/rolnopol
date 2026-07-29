import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral gRPC port BEFORE requiring the service.
const TMP_DB = path.join(os.tmpdir(), `aa-qb-unit-${process.pid}.json`);
process.env.QUESTION_BANK_DB_PATH = TMP_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const QB = path.join(__dirname, "..", "..", "external-services", "agri-academy", "question-bank-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(QB, "config.js"));
const { start } = require(path.join(QB, "server", "index.js"));
const { _internals } = require(path.join(QB, "server", "handlers.js"));
const { buildSeed } = require(path.join(QB, "server", "seed.js"));

// Derive expected counts from the seed itself so the health assertion can never go
// stale when pools are added/removed.
const SEED = buildSeed();
const SEED_POOL_COUNT = Object.keys(SEED.pools).length;
const SEED_QUESTION_COUNT = Object.values(SEED.pools).reduce((n, p) => n + p.length, 0);

let server;
let qb;
let health;
const call = (method, request = {}) => callUnary(qb, method, request);

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "questionbank");
  qb = new proto.QuestionBank(target, grpc.credentials.createInsecure());
  health = new proto.Health(target, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("question-bank — health + seed", () => {
  it("Check reports SERVING with the seeded pools", async () => {
    const reply = await callUnary(health, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.db_initialized).toBe(true);
    expect(reply.version).toBeTruthy();
    expect(reply.exam_count).toBe(SEED_POOL_COUNT); // every seeded pool
    expect(reply.question_count).toBe(SEED_QUESTION_COUNT);
  });
});

describe("question-bank — DrawQuestions (deterministic)", () => {
  it("same seed ⇒ identical draw (selection + option order)", async () => {
    const a = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 5, seed: 42 });
    const b = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 5, seed: 42 });
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
    expect(a.questions[0].options.map((o) => o.id)).toEqual(b.questions[0].options.map((o) => o.id));
    expect(a.total).toBe(16);
  });

  it("different seed ⇒ different draw", async () => {
    const a = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 5, seed: 1 });
    const b = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 5, seed: 2 });
    expect(a.questions.map((q) => q.id)).not.toEqual(b.questions.map((q) => q.id));
  });

  it("caps at the pool size (exhaustion) and returns keys for the exam center", async () => {
    const res = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 999, seed: 7 });
    expect(res.questions).toHaveLength(16);
    expect(Array.isArray(res.questions[0].correct)).toBe(true);
    expect(res.questions[0].correct.length).toBeGreaterThan(0);
  });

  it("empty draw for an unknown exam", async () => {
    const res = await call("DrawQuestions", { exam_id: "nope", count: 3, seed: 1 });
    expect(res.questions).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  it("count <= 0 (or omitted) draws the whole pool, not an empty set", async () => {
    // `count && count > 0 ? min : whole-pool` — a falsy/non-positive count means "all".
    const zero = await call("DrawQuestions", { exam_id: "pesticide-basics", count: 0, seed: 3 });
    expect(zero.questions).toHaveLength(16);
    const omitted = await call("DrawQuestions", { exam_id: "pesticide-basics", seed: 3 });
    expect(omitted.questions).toHaveLength(16);
    const negative = await call("DrawQuestions", { exam_id: "pesticide-basics", count: -5, seed: 3 });
    expect(negative.questions).toHaveLength(16);
  });
});

describe("question-bank — GetAnswerKey", () => {
  it("returns keys for requested question ids", async () => {
    const res = await call("GetAnswerKey", { exam_id: "pesticide-basics", question_ids: ["pb-q1", "pb-q2"] });
    const byId = Object.fromEntries(res.keys.map((k) => [k.question_id, k]));
    expect(byId["pb-q1"].correct).toEqual(["a"]);
    expect(byId["pb-q2"].type).toBe("multi");
  });

  it("empty question_ids returns the WHOLE pool's keys", async () => {
    const res = await call("GetAnswerKey", { exam_id: "pesticide-basics", question_ids: [] });
    expect(res.keys).toHaveLength(16);
    expect(res.keys.every((k) => Array.isArray(k.correct))).toBe(true);
  });

  it("unknown exam yields no keys; unknown requested ids are filtered out", async () => {
    const none = await call("GetAnswerKey", { exam_id: "nope", question_ids: ["x"] });
    expect(none.keys).toHaveLength(0);
    const filtered = await call("GetAnswerKey", { exam_id: "pesticide-basics", question_ids: ["pb-q1", "ghost"] });
    expect(filtered.keys.map((k) => k.question_id)).toEqual(["pb-q1"]);
  });
});

describe("question-bank — write RPCs (authoring)", () => {
  it("Upsert creates then updates by id; List reflects it", async () => {
    await call("UpsertQuestion", {
      exam_id: "exam-write",
      question: {
        id: "w1",
        type: "single",
        text: "First",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
        weight: 1,
      },
    });
    await call("UpsertQuestion", {
      exam_id: "exam-write",
      question: {
        id: "w1",
        type: "single",
        text: "Updated",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["b"],
        weight: 2,
      },
    });
    const list = await call("ListQuestions", { exam_id: "exam-write" });
    expect(list.total).toBe(1);
    expect(list.questions[0].text).toBe("Updated");
    expect(list.questions[0].correct).toEqual(["b"]);
    expect(list.questions[0].weight).toBe(2);
  });

  it("generates DISTINCT ids for successive id-less upserts", async () => {
    const mk = (text) => ({
      exam_id: "exam-autoid",
      question: { type: "single", text, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], weight: 1 },
    });
    const q1 = await call("UpsertQuestion", mk("Auto1"));
    const q2 = await call("UpsertQuestion", mk("Auto2"));
    expect(q1.id).toBeTruthy();
    expect(q2.id).toBeTruthy();
    expect(q1.id).not.toBe(q2.id);
    const list = await call("ListQuestions", { exam_id: "exam-autoid" });
    expect(list.total).toBe(2);
  });

  it("rejects an upsert with no exam_id", async () => {
    await expect(
      call("UpsertQuestion", {
        question: { id: "x", type: "single", text: "x", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] },
      }),
    ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
  });

  it("deleting a nonexistent question is a no-op (deleted:false), pool unchanged", async () => {
    const before = await call("ListQuestions", { exam_id: "exam-write" });
    const del = await call("DeleteQuestion", { exam_id: "exam-write", question_id: "ghost" });
    expect(del.deleted).toBe(false);
    const after = await call("ListQuestions", { exam_id: "exam-write" });
    expect(after.total).toBe(before.total);
  });

  it("deleting against an unknown exam is a no-op (deleted:false)", async () => {
    const del = await call("DeleteQuestion", { exam_id: "no-such-exam", question_id: "w1" });
    expect(del.deleted).toBe(false);
  });

  it("Delete removes a question", async () => {
    const del = await call("DeleteQuestion", { exam_id: "exam-write", question_id: "w1" });
    expect(del.deleted).toBe(true);
    const list = await call("ListQuestions", { exam_id: "exam-write" });
    expect(list.questions.find((q) => q.id === "w1")).toBeUndefined();
  });

  it("rejects an unknown question type (defense in depth)", async () => {
    await expect(
      call("UpsertQuestion", {
        exam_id: "exam-write",
        question: {
          id: "bad",
          type: "ordering",
          text: "x",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          correct: ["a"],
          weight: 1,
        },
      }),
    ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
  });

  it("rejects a single question without exactly one correct option", async () => {
    await expect(
      call("UpsertQuestion", {
        exam_id: "exam-write",
        question: {
          id: "bad2",
          type: "single",
          text: "x",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          correct: ["a", "b"],
          weight: 1,
        },
      }),
    ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
  });
});

// Direct unit tests of the bank's defense-in-depth validator — every rejection
// branch, without a gRPC round-trip. (`null` return = valid.)
describe("question-bank — validateQuestion (defense in depth)", () => {
  const { validateQuestion } = _internals;
  const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }];
  const base = { type: "single", text: "Q", options: opts, correct: ["a"], weight: 1 };

  it("accepts a well-formed single and multi", () => {
    expect(validateQuestion(base)).toBeNull();
    expect(validateQuestion({ ...base, type: "multi", correct: ["a", "b"] })).toBeNull();
  });
  it("rejects a null / non-object question", () => {
    expect(validateQuestion(null)).toMatch(/question required/);
    expect(validateQuestion("nope")).toMatch(/question required/);
  });
  it("rejects an unknown type", () => {
    expect(validateQuestion({ ...base, type: "ordering" })).toMatch(/unknown question type/);
  });
  it("rejects missing/blank text", () => {
    expect(validateQuestion({ ...base, text: "" })).toMatch(/text required/);
  });
  it("rejects fewer than 2 options", () => {
    expect(validateQuestion({ ...base, options: [{ id: "a", text: "A" }] })).toMatch(/at least 2 options/);
  });
  it("rejects duplicate option ids", () => {
    expect(validateQuestion({ ...base, options: [{ id: "a", text: "A" }, { id: "a", text: "B" }] })).toMatch(/option ids must be unique/);
  });
  it("rejects zero correct options", () => {
    expect(validateQuestion({ ...base, correct: [] })).toMatch(/at least one correct/);
  });
  it("rejects a multi with a correct id that references no option", () => {
    expect(validateQuestion({ ...base, type: "multi", correct: ["a", "z"] })).toMatch(/correct must reference option ids/);
  });
});
