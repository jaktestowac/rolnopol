/**
 * Authoring store — owned exclusively by the authoring service.
 *
 * Shape: { version, seq, units: { [unitId]: Unit }, exams: { [examId]: Exam } }.
 * Path via AUTHORING_DB_PATH. Questions themselves live in the question bank
 * (written via gRPC); authoring stores only unit accounts and exam definitions.
 * Self-seeds a demo unit + 2 published exams on first boot (see seed.js).
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");
const { buildSeed } = require("./seed");

const db = new JSONDatabase(DB_PATH, buildSeed());

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
