const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");

// Import all route modules
const authRoute = require("./auth.route");
const usersRoute = require("./users.route");
const adminRoute = require("./admin.route");
const authorizationRoute = require("./authorization.route");
const healthcheckRoute = require("./healthcheck.route");
const aboutRoute = require("./about.route");
const fieldsRoute = require("./fields.route");
const mapRoute = require("./map.route");
const staffRoute = require("./staff.route");
const animalsRoute = require("./animals.route");
const financialRoute = require("./financial.route");
const marketplaceRoute = require("./marketplace.route");
const alertsRoute = require("./alerts.route");
const featureFlagsRoute = require("./feature-flags.route");
const metricsRoute = require("./metrics.route");
const contactRoute = require("../contact.route");
const { logInfo, logError } = require("../../helpers/logger-api");

const router = express.Router();

// Apply rate limiting to specific non-admin routes
const verifyLimiter = createRateLimiter("verify");

// General statistics endpoint (no auth required)
router.get("/statistics", async (req, res) => {
  try {
    // Import required modules
    const userDataInstance = require("../../data/user-data-singleton").getInstance();
    const databaseManager = require("../../data/database-manager");

    // Get database instances
    const fieldsDatabase = databaseManager.getFieldsDatabase();
    const staffDatabase = databaseManager.getStaffDatabase();
    const animalsDatabase = databaseManager.getAnimalsDatabase();
    const marketplaceDatabase = databaseManager.getMarketplaceDatabase();

    // Get basic statistics using database
    const users = await userDataInstance.getUsers();
    const activeUsers = users.filter((user) => user.isActive).length;
    const farmsCount = users.length;

    // Get data from databases
    const fields = await fieldsDatabase.getAll();
    const staff = await staffDatabase.getAll();
    const animals = await animalsDatabase.getAll();
    const marketplace = await marketplaceDatabase.getAll();

    // Calculate total area from fields
    const totalArea = fields.reduce((sum, field) => sum + (field.area || 0), 0);

    // Get staff count
    const staffCount = staff.length;

    // Get animals count
    const animalsCount = animals.reduce((sum, animal) => sum + (animal.quantity || 1), 0);

    // Calculate average staff age
    const staffWithAge = staff.filter((staffMember) => staffMember.age);
    const avgStaffAge =
      staffWithAge.length > 0 ? Math.round(staffWithAge.reduce((sum, staffMember) => sum + staffMember.age, 0) / staffWithAge.length) : 0;

    // Get active marketplace offers
    const activeOffers = marketplace.offers
      ? marketplace.offers.filter((offer) => offer.status === "active" || offer.status === "available").length
      : 0;

    // Calculate total value: sum of all completed offers (transactions) and all active offers
    let totalCompletedValue = 0;
    if (Array.isArray(marketplace.transactions)) {
      totalCompletedValue = marketplace.transactions
        .filter((tx) => tx.status === "completed")
        .reduce((sum, tx) => sum + (Number(tx.price) || 0), 0);
    }
    let totalActiveValue = 0;
    if (Array.isArray(marketplace.offers)) {
      totalActiveValue = marketplace.offers
        .filter((offer) => offer.status === "active" || offer.status === "available")
        .reduce((sum, offer) => sum + (Number(offer.price) || 0), 0);
    }
    const totalValue = totalCompletedValue + totalActiveValue;

    const avgAreaPerFarm = farmsCount > 0 ? Number((totalArea / farmsCount).toFixed(2)) : 0;
    const avgAnimalsPerFarm = farmsCount > 0 ? Number((animalsCount / farmsCount).toFixed(2)) : 0;
    const avgStaffPerFarm = farmsCount > 0 ? Number((staffCount / farmsCount).toFixed(2)) : 0;
    const avgAnimalsPerStaff = staffCount > 0 ? Number((animalsCount / staffCount).toFixed(2)) : 0;
    const avgOfferValue = activeOffers > 0 ? Number((totalActiveValue / activeOffers).toFixed(2)) : 0;

    const completedTransactions = Array.isArray(marketplace.transactions)
      ? marketplace.transactions.filter((tx) => tx.status === "completed").length
      : 0;

    // return advanced statistics only if the feature flag is enabled

    res.status(200).json({
      users: activeUsers,
      farms: farmsCount, // Each user represents a farm
      area: totalArea,
      staff: staffCount,
      animals: animalsCount,
      avgStaffAge: avgStaffAge,
      offers: activeOffers,
      totalValue: totalValue,
      advanced: {
        avgAreaPerFarm,
        avgAnimalsPerFarm,
        avgStaffPerFarm,
        avgAnimalsPerStaff,
        avgOfferValue,
        completedTransactions,
        totalCompletedValue,
        totalActiveValue,
      },
    });
  } catch (error) {
    logError("Error getting statistics:", { error });
    res.status(500).json({
      error: "Failed to get statistics",
    });
  }
});

// Shutdown endpoint (no auth)
// endpoint is: /api/v1/shutdown
router.get("/shutdown", async (req, res) => {
  try {
    res.status(200).json({ message: "Server is shutting down..." });
    // Give the response time to be sent before shutting down
    setTimeout(() => {
      logInfo("Server is shutting down...");
      process.exit(0);
    }, 500);
  } catch (error) {
    res.status(500).json({ error: "Failed to shut down server" });
  }
});

// Register all routes
router.use("/", healthcheckRoute);
router.use("/", authRoute);
router.use("/", authorizationRoute);
router.use("/", usersRoute);
router.use("/", aboutRoute);
router.use("/", adminRoute);
router.use("/", fieldsRoute);
router.use("/", mapRoute);
router.use("/", staffRoute);
router.use("/", animalsRoute);
router.use("/", financialRoute);
router.use("/", marketplaceRoute);
router.use("/", alertsRoute);
router.use("/", featureFlagsRoute);
router.use("/", metricsRoute);
router.use("/contact", contactRoute);

// Apply rate limiting to specific endpoints
router.use("/register", verifyLimiter);
router.use("/login", verifyLimiter);
router.use("/verify", verifyLimiter);

module.exports = router;
