/**
 * Greenhouse database handle — owned exclusively by the greenhouse service process.
 *
 * Reuses the repo's existing JSONDatabase (no new DB tech). The store is
 * data/greenhouse.json and self-seeds on first run. It persists each logged-in
 * user's greenhouses + lifetime harvest count; demo visitors are kept in memory
 * only (see greenhouse.service).
 *
 * Shape: { version, users: { [userId]: { greenhouses, harvested, updatedAt } } }
 */
const path = require("path");
const JSONDatabase = require("../../data/json-database");

// Path is overridable via env so tests can point at a throwaway file.
const GREENHOUSE_DB_PATH = process.env.GREENHOUSE_DB_PATH
  ? path.resolve(process.env.GREENHOUSE_DB_PATH)
  : path.join(__dirname, "..", "..", "data", "greenhouse.json");

const DEFAULTS = {
  version: 2,
  users: {}, // { [userId]: { greenhouses: [...], harvested: number, updatedAt } }
  updatedAt: null,
};

const db = new JSONDatabase(GREENHOUSE_DB_PATH, DEFAULTS);

async function init() {
  await db.initialize();
}

/**
 * Load a persisted user state, or null if none yet.
 * @returns {Promise<{greenhouses:Array, harvested:number}|null>}
 */
async function getUserState(userId) {
  const data = await db.getAll();
  const entry = data?.users?.[userId];
  if (!entry || !Array.isArray(entry.greenhouses)) return null;
  return { greenhouses: entry.greenhouses, harvested: Number(entry.harvested) || 0 };
}

/**
 * Persist a user state.
 */
async function saveUserState(userId, state) {
  await db.update((current) => {
    const data = current && typeof current === "object" ? current : {};
    const users = { ...(data.users || {}) };
    users[userId] = {
      greenhouses: state.greenhouses,
      harvested: state.harvested || 0,
      updatedAt: new Date().toISOString(),
    };
    return { ...data, users, updatedAt: new Date().toISOString() };
  });
}

module.exports = {
  db,
  init,
  getUserState,
  saveUserState,
  GREENHOUSE_DB_PATH,
  DEFAULTS,
};
