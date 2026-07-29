/**
 * gRPC handlers for the grading service — stateless.
 *
 * GradeAttempt dispatches each item to its per-type scoring strategy (see
 * question-types/) and aggregates a percentage + pass verdict. No data file, no
 * clients: score in, verdict out. Answer keys arrive on each item (the exam
 * center holds them from the draw and never lets them reach a taker).
 */
const grpc = require("@grpc/grpc-js");
const registry = require("../question-types");
const { createLogger } = require("../../shared/logger");

const log = createLogger("grading");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

// ── Health ───────────────────────────────────────────────────────────────────

function check(call, callback) {
  callback(null, { status: "SERVING", version: SERVICE_VERSION, uptime_ms: Date.now() - startedAt });
}

// ── Grading ──────────────────────────────────────────────────────────────────

function gradeAttempt(call, callback) {
  try {
    const { items, pass_pct } = call.request;
    const reply = registry.grade(items || [], Number(pass_pct) || 0);
    log.info("attempt graded", { count: (items || []).length, score_pct: reply.score_pct, passed: reply.passed });
    callback(null, reply);
  } catch (err) {
    log.error("GradeAttempt failed", { error: err.message });
    callback({ code: grpc.status.INTERNAL, details: err.message });
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  grading: { GradeAttempt: gradeAttempt },
};
