const { logDebug, logError } = require("../helpers/logger-api");

/**
 * Initialize all databases and singletons
 */
async function initializeDatabases() {
  try {
    logDebug("Initializing databases...");

    // Initialize user data singleton (which will create the database if needed)
    const UserDataSingleton = require("./user-data-singleton");
    const userDataInstance = UserDataSingleton.getInstance();

    // Test database connectivity
    await userDataInstance.getUserCount();

    // Initialize financial database using singleton
    const dbManager = require("./database-manager");
    const financialDb = dbManager.getFinancialDatabase();
    await financialDb.getAll(); // This will create the file if it doesn't exist
    logDebug("Financial database initialized");

    const commoditiesDb = dbManager.getCommoditiesDatabase();
    await commoditiesDb.getAll();
    logDebug("Commodities database initialized");

    const chaosEngineDb = dbManager.getChaosEngineDatabase();
    await chaosEngineDb.getAll();
    logDebug("Chaos Engine database initialized");

    const blogsDb = dbManager.getBlogsDatabase();
    await blogsDb.getAll();
    logDebug("Blogs database initialized");

    const postsDb = dbManager.getPostsDatabase();
    await postsDb.getAll();
    logDebug("Posts database initialized");

    logDebug("Databases initialized successfully");
  } catch (error) {
    logError("Failed to initialize databases:", error);
    throw error;
  }
}

/**
 * Cleanup databases on shutdown
 */
async function cleanupDatabases() {
  try {
    logDebug("Cleaning up databases...");

    // Clear any cached data
    const UserDataSingleton = require("./user-data-singleton");
    if (UserDataSingleton.instance) {
      UserDataSingleton.instance.invalidateCache();
    }

    // Clear semaphores
    const JSONDatabase = require("./json-database");
    JSONDatabase.clearSemaphores();

    logDebug("Database cleanup completed");
  } catch (error) {
    logError("Error during database cleanup:", error);
  }
}

/**
 * Force reload all databases from disk
 */
async function reloadDatabasesFromDisk() {
  const dbManager = require("./database-manager");
  await dbManager.reloadAllFromDisk();
}

module.exports = {
  initializeDatabases,
  cleanupDatabases,
  reloadDatabasesFromDisk,
};
