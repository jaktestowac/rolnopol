/**
 * Exam-events store — owned exclusively by the exam-events service.
 *
 * Shape: { version, seq, events: [ … ], sessions: { [sessionId]: SessionClockSnapshot } }.
 * `events` is the append-only log (capped — see config.MAX_EVENTS); `sessions`
 * holds the latest clock snapshot per session, which is what WatchSessionClock
 * reads on every tick so a snapshot fed mid-stream is picked up immediately.
 *
 * Path via EXAM_EVENTS_DB_PATH.
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");

const DEFAULTS = { version: 1, seq: 0, events: [], sessions: {} };

const db = new JSONDatabase(DB_PATH, DEFAULTS);

async function init() {
  await db.initialize();
}
async function getAll() {
  return db.getAll();
}

/**
 * Atomic read-modify-write. `fn(data)` returns `{ next, value }` — same contract
 * as every other AgriAcademy store.
 */
async function mutate(fn) {
  let captured;
  await db.update((data) => {
    const result = fn(data);
    captured = result?.value;
    return result?.next ?? data;
  });
  return captured;
}

module.exports = { db, init, getAll, mutate, DB_PATH };
