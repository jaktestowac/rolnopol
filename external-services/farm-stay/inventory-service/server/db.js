/**
 * Inventory store — owned exclusively by the inventory service process.
 *
 * Shape:
 *   { version, seq, properties: [Property], calendars: { [propertyId]: { locks: [Lock] } },
 *     customLocations: [{ voivodeship, city, addedBy, addedAt }] }
 *   Lock: { lockId, from, to, kind: "hold"|"confirmed"|"blackout", expiresAt? (epoch ms) }
 *
 * Custom locations are shared by ALL users (see config/locations-seed.js), which
 * is why they live here — in the service that owns districts — and not in a
 * per-browser store.
 *
 * Self-seeds the demo catalog on first boot. Path overridable via INVENTORY_DB_PATH.
 */
const JSONDatabase = require("../../shared/json-database");
const { DB_PATH } = require("../config");
const seed = require("../config/catalog-seed");
const { SAMPLE_CUSTOM } = require("../config/locations-seed");

const DEFAULTS = {
  version: 1,
  seq: 0,
  properties: [],
  calendars: {},
  customLocations: [],
};

const db = new JSONDatabase(DB_PATH, DEFAULTS);

function seededCustomLocations() {
  return SAMPLE_CUSTOM.map((loc) => ({ ...loc }));
}

function seededData() {
  const properties = seed.map((p) => ({ ...p, amenities: [...p.amenities] }));
  const calendars = {};
  for (const p of properties) calendars[p.id] = { locks: [] };
  return { version: 1, seq: 0, properties, calendars, customLocations: seededCustomLocations() };
}

async function init() {
  await db.initialize();
  const data = await db.getAll();
  if (!Array.isArray(data.properties) || data.properties.length === 0) {
    await db.replaceAll(seededData());
    return;
  }
  // Stores written before custom locations existed keep their listings and just
  // gain the shared location list.
  if (!Array.isArray(data.customLocations)) {
    await db.update((current) => ({ ...current, customLocations: seededCustomLocations() }));
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
