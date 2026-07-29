/**
 * Question store — owned exclusively by the question-bank service.
 *
 * Shape: { version, pools: { [examId]: [Question] } }. Path via
 * QUESTION_BANK_DB_PATH. Self-seeds two demo pools on first boot (see seed.js).
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
