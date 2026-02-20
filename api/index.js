require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
const path = require("path");
const { formatResponseBody } = require("../helpers/response-helper");
const { PORT } = require("../data/settings");
const { logDebug, logInfo, logError } = require("../helpers/logger-api");
const { initializeDatabases, cleanupDatabases } = require("../data/database-init");
const versionMiddleware = require("../middleware/version.middleware");
const { clearAllTokens } = require("../helpers/token.helpers");
const packageJson = require("../package.json");
const notFoundStatsModule = require("../helpers/notfound-stats");
const prometheusMetrics = require("../helpers/prometheus-metrics");

app.set("etag", false);

// Initialize databases on startup
initializeDatabases().catch((error) => {
  logError("Failed to initialize databases:", { error });
  process.exit(1);
});

// Initialize all databases into memory
const dbManager = require("../data/database-manager");
const initializeAllDatabases = async () => {
  try {
    const databases = [
      dbManager.getUsersDatabase(),
      dbManager.getFinancialDatabase(),
      dbManager.getMarketplaceDatabase(),
      dbManager.getFeatureFlagsDatabase(),
      dbManager.getFieldsDatabase(),
      dbManager.getStaffDatabase(),
      dbManager.getAnimalsDatabase(),
      dbManager.getAssignmentsDatabase(),
    ];

    for (const db of databases) {
      await db.initialize();
    }

    logInfo("All databases loaded into memory");
  } catch (error) {
    logError("Error during database initialization:", error);
  }
};

initializeAllDatabases();

// Clear all tokens on startup for system migration
const clearedTokens = clearAllTokens();
logInfo(`System migration: Cleared ${clearedTokens} existing tokens`);

// Graceful shutdown handling
process.on("SIGINT", async () => {
  logDebug("Received SIGINT. Graceful shutdown...");
  await cleanupDatabases();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logDebug("Received SIGTERM. Graceful shutdown...");
  await cleanupDatabases();
  process.exit(0);
});

process.on("SIGHUP", async () => {
  logDebug("Received SIGHUP. Graceful shutdown...");
  await cleanupDatabases();
  process.exit(0);
});

// Middleware for parsing request bodies
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Cookie parser middleware
app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
  const { logRequest } = require("../helpers/logger-api");
  logRequest(req);
  next();
});

// Native Prometheus metrics collection middleware (hot-toggle enabled)
try {
  // eslint-disable-next-line global-require
  const startupFlags = require("../data/feature-flags.json");
  const isMetricsEnabled = startupFlags?.flags?.prometheusMetricsEnabled === true;

  prometheusMetrics.setEnabled(isMetricsEnabled);
  logInfo(`Prometheus request observer hot-toggle initialized: ${isMetricsEnabled ? "enabled" : "disabled"}`);
} catch (error) {
  prometheusMetrics.setEnabled(false);
  logError("Failed to load startup feature flags for Prometheus observer. Using disabled default.", { error });
}

app.use(prometheusMetrics.observeRequest);

// Default route for root path - must come before static file serving
app.get("/api", (req, res) => {
  res.json(
    formatResponseBody({
      message: "Rolnopol is running",
      version: packageJson.version,
      apiVersions: Object.keys(versionMiddleware.getAllVersions()),
      endpoints: [
        "GET /api - API version information",
        "GET /api/v1 - v1 API endpoints",
        "GET /api/v2 - v2 API endpoints",
        "GET /api/v1/healthcheck - Health check",
        "POST /api/v1/register - User registration",
        "POST /api/v1/login - User login",
        "GET /api/v1/users/profile - Get user profile (requires auth)",
        "PUT /api/v1/users/profile - Update user profile (requires auth)",
        "PUT /api/v1/users/:userId - Update user by ID (requires auth, own profile only)",
        "POST /api/v1/admin/auth/login - Admin login",
        "GET /api/v1/admin/users - Get all users (requires admin auth)",
        "GET /api/v1/financial/account - Get financial account (requires auth)",
        "POST /api/v1/financial/transactions - Add transaction (requires auth)",
        "GET /api/v1/financial/transactions - Get transaction history (requires auth)",
        "GET /api/v1/financial/stats - Get financial statistics (requires auth)",
        "POST /api/v1/financial/transfer - Transfer funds (requires auth)",
      ],
    }),
  );
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

// Import and use modular routes
const v1Routes = require("../routes/v1");
const v2Routes = require("../routes/v2");
const logsRoute = require("../routes/logs.route");
const debugRoute = require("../routes/debug.route");

// Apply version middleware to API routes
app.use("/api", versionMiddleware.versionRouter);
app.use("/api", versionMiddleware.versionHeaders);

// Register logs endpoint
app.use("/api/logs", logsRoute);
app.use("/api", debugRoute);

// Register versioned API routes
app.use("/api/v1", v1Routes);
app.use("/api/v2", v2Routes);

// API version information endpoint
app.get("/api", (req, res) => {
  const allVersions = versionMiddleware.getAllVersions();

  res.json(
    formatResponseBody({
      message: "Rolnopol - Version Information",
      currentVersion: "v1",
      versions: allVersions,
      endpoints: {
        v1: [
          "GET /api/v1/healthcheck - Health check",
          "POST /api/v1/register - User registration",
          "POST /api/v1/login - User login",
          "GET /api/v1/users/profile - Get user profile (requires auth)",
          "PUT /api/v1/users/profile - Update user profile (requires auth)",
          "PUT /api/v1/users/:userId - Update user by ID (requires auth, own profile only)",
          "POST /api/v1/admin/auth/login - Admin login",
          "GET /api/v1/admin/users - Get all users (requires admin auth)",
          "GET /api/v1/financial/account - Get financial account (requires auth)",
          "POST /api/v1/financial/transactions - Add transaction (requires auth)",
          "GET /api/v1/financial/transactions - Get transaction history (requires auth)",
          "GET /api/v1/financial/stats - Get financial statistics (requires auth)",
          "POST /api/v1/financial/transfer - Transfer funds (requires auth)",
        ],
        v2: ["GET /api/v2/ - Version information", "GET /api/v2/healthcheck - Health check"],
      },
      note: "Use specific version endpoints (e.g., /api/v1/, /api/v2/) for API calls",
    }),
  );
});

// Provide a convenient root for v1 that returns healthcheck data (used by tests)
app.get("/api/v1", async (req, res) => {
  const { sendSuccess, sendError } = require("../helpers/response-helper");
  const dbManager = require("../data/database-manager");
  try {
    const { buildHealthData } = require("../helpers/healthcheck");
    const healthData = await buildHealthData();
    return sendSuccess(req, res, healthData);
  } catch (err) {
    return sendError(req, res, 500, "Healthcheck failed");
  }
});

// API endpoint to serve version for frontend
app.get("/api/version", (req, res) => {
  res.json({ version: packageJson.version });
});

// endpoint to get 404 stats
app.get("/api/notfound-stats", (req, res) => {
  const notFoundStats = notFoundStatsModule.getStats();
  res.json({
    html: {
      total: notFoundStats.html.total,
      paths: notFoundStats.html.paths,
    },
    api: {
      total: notFoundStats.api.total,
      paths: notFoundStats.api.paths,
    },
  });
});

// 404 handler for API routes
app.use("/api", (req, res) => {
  // Track API 404
  notFoundStatsModule.incrementApi(req.originalUrl);
  res.status(404).json(
    formatResponseBody({
      error: "API endpoint not found",
      suggestion: "Try /api/v1/ or /api/v2/ for versioned endpoints",
    }),
  );
});

// 404 handler for admin routes
app.use("/admin", (req, res) => {
  res.status(404).json(
    formatResponseBody({
      error: "Admin endpoint not found",
    }),
  );
});

// Global error handler
app.use((error, req, res, next) => {
  logError("Unhandled error:", { error });
  res.status(500).json(
    formatResponseBody({
      error: "Internal server error",
    }),
  );
});

// Global 404 handler for non-API
app.use((req, res, next) => {
  if (req.accepts("html")) {
    // Track HTML 404
    notFoundStatsModule.incrementHtml(req.originalUrl);
    const notFoundStats = notFoundStatsModule.getStats();
    // if notFoundStats.paths[rolnikorzepole] hits >= 10 - serve custom 404 page && in 10 seconds
    if (notFoundStatsModule.shouldServeCustom404ForTimeFrame(req.originalUrl, "rolnikorzepole")) {
      logInfo(`Serving custom 404 page for path: ${req.originalUrl} (hits: ${notFoundStats.html.paths[req.originalUrl]})`);

      res.status(404).sendFile(path.join(__dirname, "../public/4041.html"));
      return;
    }

    res.status(404).sendFile(path.join(__dirname, "../public/404.html"));
  } else {
    next();
  }
});

// Start server only if this file is run directly (not when imported for tests)
if (require.main === module) {
  (async () => {
    try {
      const { performStartupHealthCheck } = require("../helpers/healthcheck");
      await performStartupHealthCheck();
      const port = PORT;
      app.listen(port, () => {
        logInfo(`🚀 Server running on port ${port}`);
        logInfo(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
        logInfo(`📚 API Versions: ${Object.keys(versionMiddleware.getAllVersions()).join(", ")}`);
        logInfo(`Links:`);
        logInfo(`🐛 Debug and settings: http://localhost:${port}/api/debug`);
        logInfo(`📜 Logs: http://localhost:${port}/api/logs`);
        logInfo(`📄 About: http://localhost:${port}/api/v1/about`);
        logInfo(`💗 Healthcheck: http://localhost:${port}/api/v1/healthcheck`);
        logInfo(`📄 Swagger: http://localhost:${port}/swagger.html`);
        logInfo(`📄 OpenAPI Schema: http://localhost:${port}/schema/openapi.json`);
        logInfo(`👤 Admin: http://localhost:${port}/null/kraken.html`);
        logInfo(`Start here:`);
        logInfo(`🌐 Access: http://localhost:${port}`);

        // TODO: check if rolno.d exists - if Yes then print SECRET MESSAGE
        const { checkRolnoFileExists } = require("../helpers/healthcheck");
        const rolno = checkRolnoFileExists();
        if (rolno.exists) {
          logInfo(`SECRET MESSAGE: ${rolno.content}`);
        }
      });
    } catch (err) {
      logError("Startup health check failed. Server will not start.", err);
      process.exit(1);
    }
  })();
}

module.exports = app;
