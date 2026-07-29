/**
 * Certificate store — owned exclusively by the certificate-issuer service.
 *
 * Shape: { version, seq, certificates: { [certNo]: Certificate } }. Path via
 * CERTIFICATES_DB_PATH. `seq` drives sequential certificate numbers. Empty on
 * first boot (certificates are minted at runtime, never seeded).
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");

const DEFAULTS = { version: 1, seq: 0, certificates: {} };

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
