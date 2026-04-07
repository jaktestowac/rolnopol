const fs = require("fs");
const path = require("path");
const dbManager = require("../data/database-manager");
const UserDataSingleton = require("../data/user-data-singleton");

const BASE_STATE_FILE = path.join(__dirname, "../data/database-base-state.json");

const DATABASE_ACCESSORS = {
  users: () => dbManager.getUsersDatabase(),
  fields: () => dbManager.getFieldsDatabase(),
  staff: () => dbManager.getStaffDatabase(),
  animals: () => dbManager.getAnimalsDatabase(),
  assignments: () => dbManager.getAssignmentsDatabase(),
  financial: () => dbManager.getFinancialDatabase(),
  marketplace: () => dbManager.getMarketplaceDatabase(),
  featureFlags: () => dbManager.getFeatureFlagsDatabase(),
  chaosEngine: () => dbManager.getChaosEngineDatabase(),
  commodities: () => dbManager.getCommoditiesDatabase(),
  messages: () => dbManager.getMessagesDatabase(),
  blogs: () => dbManager.getBlogsDatabase(),
  posts: () => dbManager.getPostsDatabase(),
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getResourceCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (!value || typeof value !== "object") {
    return 0;
  }

  if (Array.isArray(value.accounts)) return value.accounts.length;
  if (Array.isArray(value.offers)) return value.offers.length;
  if (Array.isArray(value.holdings)) return value.holdings.length;
  if (Array.isArray(value.messages)) return value.messages.length;
  if (value.flags && typeof value.flags === "object") return Object.keys(value.flags).length;

  return Object.keys(value).length;
}

function readBaseState() {
  const raw = fs.readFileSync(BASE_STATE_FILE, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || !parsed.databases || typeof parsed.databases !== "object") {
    throw new Error("Invalid base state snapshot format");
  }

  for (const key of Object.keys(DATABASE_ACCESSORS)) {
    if (!(key in parsed.databases)) {
      throw new Error(`Missing '${key}' in base state snapshot`);
    }
  }

  return parsed;
}

async function restoreAllDatabasesFromBaseState() {
  const snapshot = readBaseState();
  const restored = {};

  for (const [resourceName, getDb] of Object.entries(DATABASE_ACCESSORS)) {
    const db = getDb();
    const targetData = deepClone(snapshot.databases[resourceName]);
    await db.replaceAll(targetData);
    restored[resourceName] = getResourceCount(targetData);
  }

  const userData = UserDataSingleton.getInstance();
  userData.invalidateCache();

  return {
    baseStateVersion: snapshot.version || 1,
    restored,
  };
}

module.exports = {
  BASE_STATE_FILE,
  restoreAllDatabasesFromBaseState,
};
