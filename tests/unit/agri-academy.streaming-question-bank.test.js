import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral gRPC port BEFORE requiring the service.
const TMP_DB = path.join(os.tmpdir(), `aa-qb-stream-${process.pid}.json`);
process.env.QUESTION_BANK_DB_PATH = TMP_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const { grpc, loadPackage, callUnary } = require("../helpers/grpc-harness");
const { waitUntil } = require("../helpers/stream-http");
const QB = path.join(__dirname, "..", "..", "external-services", "agri-academy", "question-bank-service");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require(path.join(QB, "config.js"));
const { start } = require(path.join(QB, "server", "index.js"));
const { _internals } = require(path.join(QB, "server", "handlers.js"));

// A pool big enough that the client can cancel long before the server could have
// finished it, so "the handler stopped" is a real assertion and not a coincidence.
const BIG_EXAM = "stream-big";
const BIG_POOL_SIZE = 120;
const SMALL_EXAM = "stream-small";
const SMALL_POOL_SIZE = 5;

let server;
let qb;

function question(id, i) {
  return {
    id,
    type: i % 3 === 0 ? "multi" : "single",
    text: `Question ${id}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    correct: i % 3 === 0 ? ["a", "b"] : ["a"],
    weight: (i % 3) + 1,
  };
}

/** Collect a whole server stream. Rejects on a non-CANCELLED error status. */
function drain(stream) {
  return new Promise((resolve, reject) => {
    const frames = [];
    stream.on("data", (f) => frames.push(f));
    stream.on("end", () => resolve({ frames, completed: true }));
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve({ frames, completed: false }) : reject(err)));
  });
}

/** Read N frames, then cancel. Resolves with what arrived. */
function takeThenCancel(stream, n) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let cancelled = false;
    stream.on("data", (f) => {
      frames.push(f);
      if (frames.length >= n && !cancelled) {
        cancelled = true;
        stream.cancel();
      }
    });
    stream.on("end", () => resolve(frames));
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve(frames) : reject(err)));
  });
}

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "questionbank");
  qb = new proto.QuestionBank(`localhost:${started.port}`, grpc.credentials.createInsecure());

  for (let i = 0; i < BIG_POOL_SIZE; i++) {
    await callUnary(qb, "UpsertQuestion", { exam_id: BIG_EXAM, question: question(`big-${i}`, i) });
  }
  for (let i = 0; i < SMALL_POOL_SIZE; i++) {
    await callUnary(qb, "UpsertQuestion", { exam_id: SMALL_EXAM, question: question(`small-${i}`, i) });
  }
}, 30000);

afterAll(() => {
  if (server) server.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

beforeEach(() => _internals.resetPoolStreamCounters());

describe("question-bank — StreamQuestionPool (server streaming)", () => {
  it("streams every pool question exactly once, in pool order", async () => {
    const { frames, completed } = await drain(qb.StreamQuestionPool({ exam_id: SMALL_EXAM, with_keys: true }));
    expect(completed).toBe(true);
    expect(frames.map((q) => q.id)).toEqual(Array.from({ length: SMALL_POOL_SIZE }, (_, i) => `small-${i}`));
    // Exactly once: no duplicates, no gaps.
    expect(new Set(frames.map((q) => q.id)).size).toBe(SMALL_POOL_SIZE);
  });

  it("is equivalent to unary ListQuestions over the same pool (cross-cardinality)", async () => {
    // The whole risk of adding a second code path is that it grows its own idea of
    // what a question is. This pins the two together.
    const unary = await callUnary(qb, "ListQuestions", { exam_id: SMALL_EXAM });
    const { frames } = await drain(qb.StreamQuestionPool({ exam_id: SMALL_EXAM, with_keys: true }));
    expect(frames).toEqual(unary.questions);
  });

  it("with_keys=false strips `correct` on EVERY message (per-message choke point)", async () => {
    const { frames } = await drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, with_keys: false }));
    expect(frames).toHaveLength(BIG_POOL_SIZE);
    expect(frames.every((q) => Array.isArray(q.correct) && q.correct.length === 0)).toBe(true);
    // …and the rest of the question is untouched, so a key-less stream is still usable.
    expect(frames[0].text).toBe("Question big-0");
    expect(frames[0].options.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("with_keys=true carries the key (authoring's own pool)", async () => {
    const { frames } = await drain(qb.StreamQuestionPool({ exam_id: SMALL_EXAM, with_keys: true }));
    expect(frames.every((q) => q.correct.length > 0)).toBe(true);
  });

  it("honors `limit`; 0 / negative means the whole pool", async () => {
    const capped = await drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, limit: 7 }));
    expect(capped.frames).toHaveLength(7);
    expect(capped.completed).toBe(true);
    expect((await drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, limit: 0 }))).frames).toHaveLength(BIG_POOL_SIZE);
    expect((await drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, limit: -3 }))).frames).toHaveLength(BIG_POOL_SIZE);
    // A limit past the pool size is capped at the pool, not padded.
    expect((await drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, limit: 9999 }))).frames).toHaveLength(BIG_POOL_SIZE);
  });

  it("an unknown exam is an EMPTY stream that still ENDS cleanly (not an error)", async () => {
    const { frames, completed } = await drain(qb.StreamQuestionPool({ exam_id: "no-such-exam" }));
    expect(frames).toEqual([]);
    expect(completed).toBe(true);
  });

  it("rejects a missing exam_id with INVALID_ARGUMENT", async () => {
    await expect(drain(qb.StreamQuestionPool({ exam_id: "" }))).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });

  it("cancelling mid-stream makes the handler OBSERVE the cancel and STOP writing", async () => {
    const frames = await takeThenCancel(qb.StreamQuestionPool({ exam_id: BIG_EXAM, with_keys: true }), 3);
    expect(frames.length).toBeGreaterThanOrEqual(3);

    // Asserted on behaviour, not on elapsed time: the handler must have seen the
    // cancel, and must have stopped short of the pool it was walking.
    await waitUntil(() => _internals.poolStreamCounters().cancels === 1, { label: "the handler to observe the cancel" });
    const counters = _internals.poolStreamCounters();
    expect(counters.opens).toBe(1);
    expect(counters.completes).toBe(0); // it never reached call.end()
    expect(counters.writes).toBeLessThan(BIG_POOL_SIZE);
  });

  it("a completed stream records a completion and no cancel", async () => {
    const { completed } = await drain(qb.StreamQuestionPool({ exam_id: SMALL_EXAM }));
    expect(completed).toBe(true);
    const counters = _internals.poolStreamCounters();
    expect(counters).toMatchObject({ opens: 1, writes: SMALL_POOL_SIZE, completes: 1, cancels: 0 });
  });

  it("snapshots the pool at open — a mutation mid-walk does not shift the rows", async () => {
    const stream = qb.StreamQuestionPool({ exam_id: SMALL_EXAM, with_keys: true });
    const frames = [];
    await new Promise((resolve, reject) => {
      let mutated = false;
      stream.on("data", async (f) => {
        frames.push(f);
        if (!mutated) {
          mutated = true;
          // Insert a brand-new question while the walk is in flight.
          await callUnary(qb, "UpsertQuestion", { exam_id: SMALL_EXAM, question: question("small-late", 1) });
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    expect(frames.map((q) => q.id)).toEqual(Array.from({ length: SMALL_POOL_SIZE }, (_, i) => `small-${i}`));
    // The insert did land — the stream simply worked from its own snapshot.
    const after = await callUnary(qb, "ListQuestions", { exam_id: SMALL_EXAM });
    expect(after.total).toBe(SMALL_POOL_SIZE + 1);
    // Undo it so pool-order assertions elsewhere in this file stay stable.
    await callUnary(qb, "DeleteQuestion", { exam_id: SMALL_EXAM, question_id: "small-late" });
  });

  it("two concurrent streams over the same pool do not interfere", async () => {
    const [a, b] = await Promise.all([
      drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, with_keys: true })),
      drain(qb.StreamQuestionPool({ exam_id: BIG_EXAM, with_keys: false })),
    ]);
    expect(a.frames).toHaveLength(BIG_POOL_SIZE);
    expect(b.frames).toHaveLength(BIG_POOL_SIZE);
    expect(a.frames.map((q) => q.id)).toEqual(b.frames.map((q) => q.id));
    // Each stream's own with_keys held — the flag is per-call, not per-service.
    expect(a.frames.every((q) => q.correct.length > 0)).toBe(true);
    expect(b.frames.every((q) => q.correct.length === 0)).toBe(true);
  });

  it("leaves unary ListQuestions untouched (additive RPC)", async () => {
    const list = await callUnary(qb, "ListQuestions", { exam_id: BIG_EXAM });
    expect(list.total).toBe(BIG_POOL_SIZE);
    expect(list.questions).toHaveLength(BIG_POOL_SIZE);
    expect(list.questions[0].correct.length).toBeGreaterThan(0); // still key-carrying
  });
});
