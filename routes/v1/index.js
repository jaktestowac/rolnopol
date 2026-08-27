const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { localhostOnly } = require("../../middleware/localhost-only.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { shutdownApplication } = require("../../services/app-shutdown.service");
const { logInfo, logError } = require("../../helpers/logger-api");

// Import all route modules
const authRoute = require("./auth.route");
const usersRoute = require("./users.route");
const adminRoute = require("./admin.route");
const authorizationRoute = require("./authorization.route");
const buddyRoute = require("./buddy.route");
const healthcheckRoute = require("./healthcheck.route");
const aboutRoute = require("./about.route");
const fieldsRoute = require("./fields.route");
const mapRoute = require("./map.route");
const staffRoute = require("./staff.route");
const animalsRoute = require("./animals.route");
const financialRoute = require("./financial.route");
const commoditiesRoute = require("./commodities.route");
const marketplaceRoute = require("./marketplace.route");
const alertsRoute = require("./alerts.route");
const featureFlagsRoute = require("./feature-flags.route");
const chaosEngineRoute = require("./chaos-engine.route");
const metricsRoute = require("./metrics.route");
const pingRoute = require("./ping.route");
const messengerRoute = require("./messenger.route");
const chatbotRoute = require("./chatbot.route");
const twoFactorRoute = require("./two-factor.route");
const personalApiKeysRoute = require("./personal-api-keys.route");
const webhooksRoute = require("./webhooks.route");
const testingRoute = require("./testing.route");
const notificationsRoute = require("./notifications.route");
const notificationCountRoute = require("./notification-count.route");
const jarCountsRoute = require("./jar-counts.route");
const weatherRoute = require("./weather.route");
const weatherLiveRoute = require("./weather-live.route");
const blogRoute = require("./blogs.route");
const terminalRoute = require("./terminal.route");
const farmerTapeRecorderRoute = require("./farmer-tape-recorder.route");
const labyrinthRoute = require("./labyrinth.route");
const observatoryRoute = require("./observatory.route");
// Defensive loading — if fd.route fails, app still starts
let farmDefenceRoute;
try {
  farmDefenceRoute = require("./fd.route");
} catch (err) {
  logError("[routes/v1] Failed to load fd.route — FD endpoints unavailable:", err.message);
  farmDefenceRoute = express.Router(); // empty stub
}
const tasksRoute = require("./tasks.route");
// Defensive loading — services-monitor depends on the gRPC clients; if it fails
// to load, the rest of the app must still start.
let servicesMonitorRoute;
try {
  servicesMonitorRoute = require("./services-monitor.route");
} catch (err) {
  logError("[routes/v1] Failed to load services-monitor.route — service monitoring unavailable:", err.message);
  servicesMonitorRoute = express.Router();
}
const contactRoute = require("../contact.route");
const harvestArchiveRoute = require("./harvest-archive.route");
// Defensive loading — greenhouse route depends on the gRPC client; if it fails
// to load, the rest of the app must still start.
let greenhouseRoute;
try {
  greenhouseRoute = require("./greenhouse.route");
} catch (err) {
  logError("[routes/v1] Failed to load greenhouse.route — greenhouse endpoints unavailable:", err.message);
  greenhouseRoute = express.Router();
}
// Defensive loading — tasklab route depends on the gRPC client; if it fails to
// load, the rest of the app must still start.
let tasklabRoute;
try {
  tasklabRoute = require("./tasklab.route");
} catch (err) {
  logError("[routes/v1] Failed to load tasklab.route — tasklab endpoints unavailable:", err.message);
  tasklabRoute = express.Router();
}
// Defensive loading — farm-stay route dials the standalone FarmStay gateway; if
// it fails to load, the rest of the app must still start.
let farmStayRoute;
try {
  farmStayRoute = require("./farm-stay.route");
} catch (err) {
  logError("[routes/v1] Failed to load farm-stay.route — farm-stay endpoints unavailable:", err.message);
  farmStayRoute = express.Router();
}
// Defensive loading — agri-academy routes dial the standalone AgriAcademy
// gateways; if they fail to load, the rest of the app must still start. The
// admin (authoring) route is registered before the taker route so its literal
// paths (/units/me, /exams/mine) win over the taker plane's param routes.
let agriAcademyAdminRoute;
try {
  agriAcademyAdminRoute = require("./agri-academy-admin.route");
} catch (err) {
  logError("[routes/v1] Failed to load agri-academy-admin.route — agri-academy authoring unavailable:", err.message);
  agriAcademyAdminRoute = express.Router();
}
let agriAcademyRoute;
try {
  agriAcademyRoute = require("./agri-academy.route");
} catch (err) {
  logError("[routes/v1] Failed to load agri-academy.route — agri-academy endpoints unavailable:", err.message);
  agriAcademyRoute = express.Router();
}
// Defensive loading — Rolnopol Survival is a self-contained game module; if it
// fails to load, every other endpoint must still be served (PRD "the game must
// not impact other functionality").
let survivalRoute;
try {
  survivalRoute = require("./survival.route");
} catch (err) {
  logError("[routes/v1] Failed to load survival.route — Rolnopol Survival endpoints unavailable:", err.message);
  survivalRoute = express.Router();
}
// Defensive loading — Crew Office assembles its GraphQL schema from independently
// flagged pillars; if any of that fails to load, the rest of the app must still
// start and serve every existing endpoint (PRD §12 rule 6).
let crewRoute;
try {
  crewRoute = require("./crew.route");
} catch (err) {
  logError("[routes/v1] Failed to load crew.route — Crew Office endpoints unavailable:", err.message);
  crewRoute = express.Router();
}

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

    // Get animals count (use amount field from records)
    const animalsCount = animals.reduce((sum, animal) => sum + (Number(animal.amount) || 0), 0);

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

// Shutdown endpoint — stops the whole application.
// endpoint is: /api/v1/shutdown
//
// No auth, by design: this is an operator convenience for a locally running
// instance, and the gate is the network location of the caller, not a
// credential. `localhostOnly` answers 403 to anything that is not a loopback
// peer, which is what keeps a deployed instance from being killed by a stranger
// with a URL. Anything reachable from outside must never be shut down this way.
//
// To let another address through, set LOCALHOST_ONLY_EXTRA_ADDRESSES (no restart
// needed) or pass `allow: ["192.168.1.5", /^10\./]` below — see the extension
// notes at the top of middleware/localhost-only.middleware.js.
//
// Teardown goes through the shared graceful sequence (the same one the
// SIGINT/SIGTERM/SIGHUP handlers use) so launched external services are stopped
// and pending database writes are flushed rather than dropped on a hard exit.
const SHUTDOWN_RESPONSE_GRACE_MS = 500;

router.get("/shutdown", localhostOnly({ resourceName: "Shutdown" }), async (req, res) => {
  // Under NODE_ENV=test the request is loopback and would therefore pass the
  // gate — and take the test runner down with it. Report what would happen
  // instead of doing it; the teardown itself is covered by unit tests that drive
  // shutdownApplication() with an injected exit hook.
  const simulated = process.env.NODE_ENV === "test";

  res.status(200).json(formatResponseBody({ message: "Server is shutting down...", data: { simulated } }));

  if (simulated) {
    logInfo("Shutdown requested under NODE_ENV=test — teardown skipped");
    return;
  }

  // Let the response reach the client before the process starts going down.
  setTimeout(() => {
    void shutdownApplication({ reason: "GET /api/v1/shutdown" });
  }, SHUTDOWN_RESPONSE_GRACE_MS);
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
router.use("/", buddyRoute);
router.use("/", financialRoute);
router.use("/", commoditiesRoute);
router.use("/", marketplaceRoute);
router.use("/", alertsRoute);
router.use("/", featureFlagsRoute);
router.use("/", chaosEngineRoute);
router.use("/", metricsRoute);
router.use("/", pingRoute);
router.use("/", messengerRoute);
router.use("/", chatbotRoute);
router.use("/", twoFactorRoute);
router.use("/", personalApiKeysRoute);
router.use("/", webhooksRoute);
router.use("/", testingRoute);
router.use("/", notificationsRoute);
router.use("/", notificationCountRoute);
router.use("/", jarCountsRoute);
router.use("/", weatherRoute);
router.use("/", weatherLiveRoute);
router.use("/", terminalRoute);
router.use("/", farmerTapeRecorderRoute);
router.use("/", labyrinthRoute);
router.use("/", observatoryRoute);
router.use("/", farmDefenceRoute);
router.use("/", tasksRoute);
router.use("/", harvestArchiveRoute);
router.use("/", greenhouseRoute);
router.use("/", tasklabRoute);
router.use("/", farmStayRoute);
router.use("/", agriAcademyAdminRoute);
router.use("/", agriAcademyRoute);
router.use("/", crewRoute);
router.use("/", survivalRoute);
router.use("/", servicesMonitorRoute);
router.use("/contact", contactRoute);
router.use("/", blogRoute);

// Apply rate limiting to specific endpoints
router.use("/register", verifyLimiter);
router.use("/login", verifyLimiter);
router.use("/verify", verifyLimiter);

module.exports = router;
