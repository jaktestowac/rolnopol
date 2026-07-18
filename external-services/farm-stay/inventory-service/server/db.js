/**
 * Inventory store — owned exclusively by the inventory service process.
 *
 * Shape:
 *   { version, seq, properties: [Property], calendars: { [propertyId]: { locks: [Lock] } } }
 *   Lock: { lockId, from, to, kind: "hold"|"confirmed"|"blackout", expiresAt? (epoch ms) }
 *
 * Self-seeds the demo catalog on first boot. Path overridable via INVENTORY_DB_PATH.
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");
const seed = require("../config/catalog-seed");

const DEFAULTS = {
  version: 1,
  seq: 0,
  properties: [],
  calendars: {},
};

const db = new JSONDatabase(DB_PATH, DEFAULTS);

function seededData() {
  const properties = seed.map((p) => ({ ...p, amenities: [...p.amenities] }));
  const calendars = {};
  for (const p of properties) calendars[p.id] = { locks: [] };
  return { version: 1, seq: 0, properties, calendars };
}

async function init() {
  await db.initialize();
  const data = await db.getAll();
  if (!Array.isArray(data.properties) || data.properties.length === 0) {
    await db.replaceAll(seededData());
  }
}

async function getAll() {
  return db.getAll();
}

/** Atomic read-modify-write over the whole store. */
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
