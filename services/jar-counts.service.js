const { getRecentNotifications } = require("../helpers/notification-store");
const databaseManager = require("../data/database-manager");
const { logError } = require("../helpers/logger-api");

/**
 * Aggregates counts from multiple application resources for the Firefly Jar visualization.
 * Each resource returns { count, color, label } so the frontend can sync firefly groups.
 */

async function getNotificationCount(windowSec = 60) {
  try {
    const since = Date.now() - windowSec * 1000;
    const recent = await getRecentNotifications({ since });
    return Array.isArray(recent) ? recent.length : 0;
  } catch (error) {
    logError("JarCounts: error fetching notification count", { error });
    return 0;
  }
}

async function getActiveTaskCount() {
  try {
    const tasksDb = databaseManager.getTasksDatabase();
    const data = await tasksDb.read();
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    return tasks.filter((t) => t.status !== "archived").length;
  } catch (error) {
    logError("JarCounts: error fetching task count", { error });
    return 0;
  }
}

async function getActiveMarketplaceOffersCount() {
  try {
    const marketplaceDb = databaseManager.getMarketplaceDatabase();
    const data = await marketplaceDb.read();
    const offers = Array.isArray(data?.offers) ? data.offers : [];
    return offers.filter((o) => o.status === "active" || o.status === "available").length;
  } catch (error) {
    logError("JarCounts: error fetching marketplace offers count", { error });
    return 0;
  }
}

async function getCelebrationEventsCount() {
  try {
    const alertsService = require("./alerts.service")("PL-MA");
    const date = new Date().toISOString().slice(0, 10);
    const events = alertsService.getCelebrationEventsForDate(date);
    return Array.isArray(events) ? events.length : 0;
  } catch (error) {
    logError("JarCounts: error fetching celebration events count", { error });
    return 0;
  }
}

async function getObservatoryStarCount() {
  try {
    const observatoryService = require("./observatory.service");
    const snapshot = observatoryService.getSnapshot({});
    // snapshot contains visibleStars or stars array depending on the service implementation
    if (snapshot?.visibleStars && Array.isArray(snapshot.visibleStars)) {
      return snapshot.visibleStars.length;
    }
    if (snapshot?.stars && Array.isArray(snapshot.stars)) {
      return snapshot.stars.length;
    }
    // Fallback: return total stars in catalog as ambient count
    return 15;
  } catch (error) {
    logError("JarCounts: error fetching observatory star count", { error });
    return 0;
  }
}

async function getActiveChaosLevel() {
  try {
    const chaosDb = databaseManager.getChaosEngineDatabase();
    const data = await chaosDb.read();
    // chaos engine level is 0-5; return 0 if not configured
    const level = Number(data?.level);
    return Number.isFinite(level) ? level : 0;
  } catch (error) {
    logError("JarCounts: error fetching chaos level", { error });
    return 0;
  }
}

async function getBlogPostCount() {
  try {
    const blogsDb = databaseManager.getBlogsDatabase();
    const data = await blogsDb.read();
    // blogs database stores an array of blog objects, each with a posts array
    const blogs = Array.isArray(data) ? data : [];
    return blogs.reduce((sum, blog) => sum + (Array.isArray(blog.posts) ? blog.posts.length : 0), 0);
  } catch (error) {
    logError("JarCounts: error fetching blog post count", { error });
    return 0;
  }
}

async function getFieldCount() {
  try {
    const fieldsDb = databaseManager.getFieldsDatabase();
    const fields = await fieldsDb.getAll();
    return Array.isArray(fields) ? fields.length : 0;
  } catch (error) {
    logError("JarCounts: error fetching field count", { error });
    return 0;
  }
}

async function getAnimalCount() {
  try {
    const animalsDb = databaseManager.getAnimalsDatabase();
    const animals = await animalsDb.getAll();
    if (!Array.isArray(animals)) return 0;
    return animals.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  } catch (error) {
    logError("JarCounts: error fetching animal count", { error });
    return 0;
  }
}

async function getStaffCount() {
  try {
    const staffDb = databaseManager.getStaffDatabase();
    const staff = await staffDb.getAll();
    return Array.isArray(staff) ? staff.length : 0;
  } catch (error) {
    logError("JarCounts: error fetching staff count", { error });
    return 0;
  }
}

async function getUserCount() {
  try {
    const userDb = databaseManager.getUserDatabase();
    const users = await userDb.getAll();
    return Array.isArray(users) ? users.length : 0;
  } catch (error) {
    logError("JarCounts: error fetching user count", { error });
    return 0;
  }
}

/**
 * Returns an array of resource count objects for the Firefly Jar.
 * Each object: { id, count, color, label }
 *
 * Colors map to firefly-jar.js createFirefly() switch cases:
 *   yellow, red, blue, green, orange, purple, white, cyan, pink, gold
 */
async function getJarCounts({ windowSec = 60 } = {}) {
  const [notifications, tasks, offers, celebrations, stars, chaos, posts, fields, animals, staff, users] = await Promise.all([
    getNotificationCount(windowSec),
    getActiveTaskCount(),
    getActiveMarketplaceOffersCount(),
    getCelebrationEventsCount(),
    getObservatoryStarCount(),
    getActiveChaosLevel(),
    getBlogPostCount(),
    getFieldCount(),
    getAnimalCount(),
    getStaffCount(),
    getUserCount(),
  ]);

  return [
    { id: "notifications", count: notifications, color: "yellow", label: "Notifications", icon: "fa-bell" },
    { id: "fields", count: fields, color: "green", label: "Fields", icon: "fa-seedling" },
    { id: "animals", count: animals, color: "orange", label: "Animals", icon: "fa-cow" },
    { id: "staff", count: staff, color: "pink", label: "Staff", icon: "fa-user-tie" },
    { id: "users", count: users, color: "white", label: "Users", icon: "fa-users" },
  ];
}

module.exports = { getJarCounts };
