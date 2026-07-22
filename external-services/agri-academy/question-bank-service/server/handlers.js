/**
 * gRPC handlers for the question-bank service.
 *
 * Read side (exam center): DrawQuestions (seeded selection + per-question option
 * shuffle — same seed ⇒ identical draw) and GetAnswerKey. Write side (authoring):
 * UpsertQuestion / DeleteQuestion / ListQuestions. The bank validates question
 * shape and rejects unknown `type` as defense-in-depth (authoring is the primary
 * validator). Answer keys travel to the caller; the exam center strips them
 * before responding to takers.
 */
const grpc = require("@grpc/grpc-js");
const db = require("./db");
const { createLogger } = require("../../shared/logger");

const log = createLogger("question-bank");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

const VALID_TYPES = ["single", "multi"];

function fail(callback, code, message, method, fields) {
  log[code === grpc.status.INTERNAL ? "error" : "warn"](`${method} failed`, { ...fields, error: message });
  callback({ code, details: message });
}

// Deterministic PRNG (mulberry32) so a seed reproduces a draw exactly.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    options: (q.options || []).map((o) => ({ id: o.id, text: o.text })),
    correct: q.correct || [],
    weight: q.weight || 1,
  };
}

function validateQuestion(q) {
  if (!q || typeof q !== "object") return "question required";
  if (!VALID_TYPES.includes(q.type)) return `unknown question type: ${q.type}`;
  if (!q.text) return "text required";
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length < 2) return "at least 2 options required";
  const ids = new Set(opts.map((o) => o.id));
  if (ids.size !== opts.length) return "option ids must be unique";
  const correct = Array.isArray(q.correct) ? q.correct : [];
  if (correct.length < 1) return "at least one correct option required";
  if (q.type === "single" && correct.length !== 1) return "single questions need exactly one correct option";
  if (!correct.every((c) => ids.has(c))) return "correct must reference option ids";
  return null;
}

function countQuestions(data) {
  return Object.values(data.pools || {}).reduce((sum, pool) => sum + (pool?.length || 0), 0);
}

// ── Health ───────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const data = await db.getAll().catch(() => null);
  callback(null, {
    status: "SERVING",
    db_initialized: db.db.isInitialized === true,
    exam_count: data ? Object.keys(data.pools || {}).length : 0,
    question_count: data ? countQuestions(data) : 0,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
  });
}

// ── Read ─────────────────────────────────────────────────────────────────────

async function drawQuestions(call, callback) {
  try {
    const { exam_id, count, seed } = call.request;
    const data = await db.getAll();
    const pool = data.pools?.[exam_id] || [];
    const rnd = mulberry32(Number(seed) || 0);
    const shuffled = shuffle(pool, rnd);
    const take = count && count > 0 ? Math.min(count, shuffled.length) : shuffled.length;
    const selected = shuffled.slice(0, take).map((q) => ({ ...toQuestion(q), options: shuffle(q.options || [], rnd) }));
    callback(null, { questions: selected, total: pool.length });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "DrawQuestions");
  }
}

async function getAnswerKey(call, callback) {
  try {
    const { exam_id, question_ids } = call.request;
    const data = await db.getAll();
    const pool = data.pools?.[exam_id] || [];
    const wanted = new Set(question_ids || []);
    const keys = pool
      .filter((q) => wanted.size === 0 || wanted.has(q.id))
      .map((q) => ({ question_id: q.id, correct: q.correct || [], weight: q.weight || 1, type: q.type }));
    callback(null, { keys });
  } catch (err) {
    fail(callback, grpc.status.INTERNAL, err.message, "GetAnswerKey");
  }
}

// ── Write (authoring) ─────────────────────────────────────────────────────────

async function upsertQuestion(call, callback) {
  const { exam_id, question } = call.request;
  if (!exam_id) return fail(callback, grpc.status.INVALID_ARGUMENT, "exam_id required", "UpsertQuestion");
  const err = validateQuestion(question);
  if (err) return fail(callback, grpc.status.INVALID_ARGUMENT, err, "UpsertQuestion", { exam_id });
  try {
    const saved = await db.mutate((data) => {
      const pools = { ...(data.pools || {}) };
      const pool = [...(pools[exam_id] || [])];
      let seq = data.seq || 0;
      let id = question.id;
      if (!id) {
        seq += 1;
        id = `${exam_id}-gen${seq}`;
      }
      const record = {
        id,
        type: question.type,
        text: question.text,
        options: (question.options || []).map((o) => ({ id: o.id, text: o.text })),
        correct: question.correct || [],
        weight: question.weight || 1,
      };
      const idx = pool.findIndex((q) => q.id === id);
      if (idx >= 0) pool[idx] = record;
      else pool.push(record);
      pools[exam_id] = pool;
      return { next: { ...data, seq, pools }, value: record };
    });
    log.info("question upserted", { exam_id, id: saved.id, type: saved.type });
    callback(null, toQuestion(saved));
  } catch (e) {
    fail(callback, grpc.status.INTERNAL, e.message, "UpsertQuestion", { exam_id });
  }
}

async function deleteQuestion(call, callback) {
  const { exam_id, question_id } = call.request;
  try {
    const deleted = await db.mutate((data) => {
      const pools = { ...(data.pools || {}) };
      const pool = pools[exam_id] || [];
      const next = pool.filter((q) => q.id !== question_id);
      const didDelete = next.length !== pool.length;
      if (!didDelete) return { value: false };
      pools[exam_id] = next;
      return { next: { ...data, pools }, value: true };
    });
    callback(null, { deleted });
  } catch (e) {
    fail(callback, grpc.status.INTERNAL, e.message, "DeleteQuestion", { exam_id });
  }
}

async function listQuestions(call, callback) {
  try {
    const { exam_id } = call.request;
    const data = await db.getAll();
    const pool = data.pools?.[exam_id] || [];
    callback(null, { questions: pool.map(toQuestion), total: pool.length });
  } catch (e) {
    fail(callback, grpc.status.INTERNAL, e.message, "ListQuestions");
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  questionBank: {
    DrawQuestions: drawQuestions,
    GetAnswerKey: getAnswerKey,
    UpsertQuestion: upsertQuestion,
    DeleteQuestion: deleteQuestion,
    ListQuestions: listQuestions,
  },
  _internals: { mulberry32, shuffle, validateQuestion, VALID_TYPES },
};
