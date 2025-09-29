const express = require("express");
const { formatResponseBody } = require("../../helpers/response-helper");
const versionMiddleware = require("../../middleware/version.middleware");

const router = express.Router();

// Version information endpoint
router.get("/", (req, res) => {
  const versionInfo = versionMiddleware.getVersionInfo("v2");

  res.json(
    formatResponseBody({
      message: "API v2 is available",
      version: versionInfo,
      endpoints: [
        "GET /api/v2/ - Version information (this endpoint)",
        "GET /api/v2/healthcheck - Health check",
        // Add more v2 endpoints here as they are implemented
      ],
      note: "This is a development version. Use v1 for production applications.",
    }),
  );
});

// Health check endpoint (same as v1 for now)
router.get("/healthcheck", (req, res) => {
  res.json(
    formatResponseBody({
      message: "API v2 is healthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      status: "operational",
    }),
  );
});

module.exports = router;
