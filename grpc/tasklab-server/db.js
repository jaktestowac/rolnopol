/**
 * TaskLab database handle — owned exclusively by the TaskLab service process.
 *
 * Reuses the repo's existing JSONDatabase (no new DB tech). The store is
 * data/tasklab.json and self-seeds on first run. It persists each user's task
 * list plus a per-user id counter.
 *
 * Shape: { version, users: { [userId]: { tasks: [...], lastId: number, updatedAt } } }
 */
const path = require("path");
const JSONDatabase = require("../../data/json-database");

// Path is overridable via env so tests can point at a throwaway file.
const TASKLAB_DB_PATH = process.env.TASKLAB_DB_PATH
  ? path.resolve(process.env.TASKLAB_DB_PATH)
  : path.join(__dirname, "..", "..", "data", "tasklab.json");

const DEFAULTS = {
  version: 1,
  users: {}, // { [userId]: { tasks: [...], lastId: number, updatedAt } }
  updatedAt: null,
};

const db = new JSONDatabase(TASKLAB_DB_PATH, DEFAULTS);

async function init() {
  await db.initialize();
}

/**
 * Load a user's persisted state, or null if none yet.
 * @returns {Promise<{tasks:Array, lastId:number}|null>}
 */
async function getUserState(userId) {
  const data = await db.getAll();
  const entry = data?.users?.[userId];
  if (!entry || !Array.isArray(entry.tasks)) return null;
  return { tasks: entry.tasks, lastId: Number(entry.lastId) || 0 };
}

/**
 * Persist a user's task list + id counter.
 */
async function saveUserState(userId, state) {
  await db.update((current) => {
    const data = current && typeof current === "object" ? current : {};
    const users = { ...(data.users || {}) };
    users[userId] = {
      tasks: state.tasks,
      lastId: Number(state.lastId) || 0,
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
  TASKLAB_DB_PATH,
  DEFAULTS,
};
