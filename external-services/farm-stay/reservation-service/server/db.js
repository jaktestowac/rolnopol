/**
 * Reservation store — owned exclusively by the reservation service process.
 * Shape: { version, seq, bookings: [Booking] }. Path via RESERVATIONS_DB_PATH.
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");

const DEFAULTS = { version: 1, seq: 0, bookings: [] };

const db = new JSONDatabase(DB_PATH, DEFAULTS);

async function init() {
  await db.initialize();
}

async function getAll() {
  return db.getAll();
}

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
