const fs = require("fs");
const path = require("path");
const dbManager = require("../data/database-manager");
const UserDataSingleton = require("../data/user-data-singleton");
const { logDebug, logError } = require("../helpers/logger-api");

const BASE_STATE_FILE = path.join(__dirname, "../data/database-base-state.json");
let restoreQueue = Promise.resolve();

const NOTIFICATION_EVENTS_DEFAULT_DATA = {
  events: [],
  metadata: {
    lastEventId: null,
    total: 0,
    lastUpdated: null,
  },
};

const NOTIFICATION_STORE_DEFAULT_DATA = {
  notifications: [],
  metadata: {
    lastNotificationId: null,
    total: 0,
    lastUpdated: null,
  },
};

const FD_ACHIEVEMENTS_DEFAULT_DATA = {
  version: 1,
  players: {},
  updatedAt: null,
};

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
  farmlogPostLikes: () => dbManager.getPostLikesDatabase(),
  farmlogFavorites: () => dbManager.getFarmlogFavoritesDatabase(),
  webhooks: () => dbManager.getWebhooksDatabase(),
  webhookDeliveries: () => dbManager.getWebhookDeliveriesDatabase(),
  blogs: () => dbManager.getBlogsDatabase(),
  posts: () => dbManager.getPostsDatabase(),
  personalApiKeys: () => dbManager.getPersonalApiKeysDatabase(),
  userAvatars: () => dbManager.getUserAvatarsDatabase(),
  twoFactorAuth: () => dbManager.getTwoFactorAuthDatabase(),
  pets: () => dbManager.getPetsDatabase(),
  tasks: () => dbManager.getTasksDatabase(),
  notificationEvents: () => dbManager.getCustomDatabase("notification-events", "events-store.json", NOTIFICATION_EVENTS_DEFAULT_DATA),
  notificationStore: () => dbManager.getCustomDatabase("notification-notifications", "notifications-store.json", NOTIFICATION_STORE_DEFAULT_DATA),
  fdAchievements: () => dbManager.getCustomDatabase("fd-achievements", "fd-achievements.json", FD_ACHIEVEMENTS_DEFAULT_DATA),
  greenhouse: () => require("../external-services/greenhouse/greenhouse-server/db").db,
  tasklab: () => require("../external-services/tasklab/tasklab-server/db").db,
  farmStayInventory: () => require("../external-services/farm-stay/inventory-service/server/db").db,
  farmStayReservations: () => require("../external-services/farm-stay/reservation-service/server/db").db,
  farmStayReviews: () => require("../external-services/farm-stay/review-desk-service/server/db").db,
  agriAcademyAuthoring: () => require("../external-services/agri-academy/authoring-service/server/db").db,
  agriAcademyExamCenter: () => require("../external-services/agri-academy/exam-center-service/server/db").db,
  agriAcademyQuestionBank: () => require("../external-services/agri-academy/question-bank-service/server/db").db,
  agriAcademyCertificates: () => require("../external-services/agri-academy/certificate-issuer-service/server/db").db,
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
  if (Array.isArray(value.avatars)) return value.avatars.length;
  if (Array.isArray(value.webhooks)) return value.webhooks.length;
  if (Array.isArray(value.deliveries)) return value.deliveries.length;
  if (Array.isArray(value.tasks)) return value.tasks.length;
  if (Array.isArray(value.keys)) return value.keys.length;
  if (Array.isArray(value.notifications)) return value.notifications.length;
  if (Array.isArray(value.events)) return value.events.length;
  if (Array.isArray(value.properties)) return value.properties.length;
  if (Array.isArray(value.bookings)) return value.bookings.length;
  if (Array.isArray(value.reviews)) return value.reviews.length;
  if (value.users && typeof value.users === "object") return Object.keys(value.users).length;
  if (value.players && typeof value.players === "object") return Object.keys(value.players).length;
  if (value.units && typeof value.units === "object") return Object.keys(value.units).length;
  if (value.pools && typeof value.pools === "object") return Object.keys(value.pools).length;
  if (value.certificates && typeof value.certificates === "object") return Object.keys(value.certificates).length;
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

async function performRestoreAllDatabasesFromBaseState() {
  const snapshot = readBaseState();
  const restored = {};

  for (const [resourceName, getDb] of Object.entries(DATABASE_ACCESSORS)) {
    const db = getDb();
    const targetData = deepClone(snapshot.databases[resourceName]);
    await db.replaceAll(targetData, { immediate: true });
    restored[resourceName] = getResourceCount(targetData);
  }

  const userData = UserDataSingleton.getInstance();
  userData.invalidateCache();

  return {
    baseStateVersion: snapshot.version || 1,
    restored,
  };
}

async function restoreAllDatabasesFromBaseState() {
  const restore = restoreQueue.then(performRestoreAllDatabasesFromBaseState, performRestoreAllDatabasesFromBaseState);
  restoreQueue = restore.catch(() => {});
  return restore;
}

/**
 * A database file counts as "missing" if it is absent or blank. An existing file
 * with real content (even an empty collection like `[]`) is left untouched — we
 * never overwrite data a running system already owns.
 */
function isDatabaseFileMissing(filePath) {
  try {
    if (!fs.existsSync(filePath)) return true;
    const content = fs.readFileSync(filePath, "utf8");
    return !content || content.trim() === "";
  } catch {
    return true;
  }
}

/**
 * Seed any MISSING databases from the immutable base-state snapshot so a fresh
 * environment (clean checkout / new deploy) boots with realistic sample data
 * instead of empty stores. Only files that are absent or blank are written;
 * databases that already exist are never modified. Runs before the databases are
 * initialized into memory, so the normal init then loads the seeded content.
 *
 * @returns {{ seeded: string[], skipped: string[], errors: Array<{ resource: string, error: string }> }}
 */
function seedMissingDatabasesFromBaseState() {
  const snapshot = readBaseState();
  const seeded = [];
  const skipped = [];
  const errors = [];

  for (const [resourceName, getDb] of Object.entries(DATABASE_ACCESSORS)) {
    let filePath;
    try {
      filePath = getDb().filePath;
    } catch (error) {
      errors.push({ resource: resourceName, error: error.message });
      continue;
    }
    if (!filePath) {
      errors.push({ resource: resourceName, error: "database has no filePath" });
      continue;
    }
    if (!isDatabaseFileMissing(filePath)) {
      skipped.push(resourceName);
      continue;
    }
    try {
      const targetData = deepClone(snapshot.databases[resourceName]);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(targetData, null, 2), "utf8");
      seeded.push(resourceName);
      logDebug(`Seeded missing database from base state: ${resourceName}`, { filePath });
    } catch (error) {
      errors.push({ resource: resourceName, error: error.message });
      logError(`Failed to seed database from base state: ${resourceName}`, error);
    }
  }

  return { seeded, skipped, errors };
}

module.exports = {
  BASE_STATE_FILE,
  restoreAllDatabasesFromBaseState,
  seedMissingDatabasesFromBaseState,
};
