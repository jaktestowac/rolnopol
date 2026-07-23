/**
 * Exam-center store — owned exclusively by the exam-center service.
 *
 * Shape: { version, seq, users: { [userId]: { sessions: { [id]: Session }, attempts: { [examId]: n } } } }.
 * Path via EXAM_CENTER_DB_PATH. Sessions are keyed by id under their owning user
 * for O(1) lookup. The exam center owns no exam definitions in later phases (it
 * reads them from authoring) — in Phase 1 the catalog is a hardcoded stub.
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");

const DEFAULTS = { version: 1, seq: 0, users: {} };

const db = new JSONDatabase(DB_PATH, DEFAULTS);

async function init() {
  await db.initialize();
}
async function getAll() {
  return db.getAll();
}

/**
 * Atomic read-modify-write. `fn(data)` returns `{ next, value }`:
 *   - `next` is the new data to persist (defaults to `data` when omitted),
 *   - `value` is returned to the caller.
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
