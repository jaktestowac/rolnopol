const express = require("express");
const router = express.Router();
const settings = require("../data/settings");
const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const { restoreAllDatabasesFromBaseState } = require("../services/debug-database-restore.service");

router.get("/debug", (req, res) => {
  console.log("Received request to /debug with query:", req.query);

  // if no query then display help how to use
  if (Object.keys(req.query).length === 0) {
    return res.json({
      message: "Debug settings - use following queries to update:",
      usage: "/api/debug?all=true|false&debug=true|false&log=true|false&request=true|false",
      examples: [
        { url: "/api/debug?all=true", description: "Enable all debug settings" },
        { url: "/api/debug?debug=true", description: "Enable debug mode" },
        { url: "/api/debug?log=true", description: "Enable log stack trace" },
        { url: "/api/debug?request=true", description: "Enable log request" },
      ],
    });
  }

  // Update ALL /debug?all=true
  if (req.query?.all !== undefined) {
    const enabled = req.query?.all === "true";
    settings.DEBUG_MODE = enabled;
    settings.LOG_STACK_TRACE = enabled;
    settings.LOG_REQUEST = enabled;
  }

  // Update DEBUG_MODE /debug?debug=true
  if (req.query?.debug !== undefined) {
    const enabled = req.query?.debug === "true";
    settings.DEBUG_MODE = enabled;
  }
  // Update LOG_STACK_TRACE /debug?log=true
  if (req.query?.log !== undefined) {
    const enabled = req.query?.log === "true";
    settings.LOG_STACK_TRACE = enabled;
  }
  // Update LOG_REQUEST /debug?request=true
  if (req.query?.request !== undefined) {
    const enabled = req.query?.request === "true";
    settings.LOG_REQUEST = enabled;
  }

  return res.json({ DEBUG_MODE: settings.DEBUG_MODE, LOG_STACK_TRACE: settings.LOG_STACK_TRACE, LOG_REQUEST: settings.LOG_REQUEST });
});

router.post("/debug/database/restore-base", async (req, res) => {
  try {
    const result = await restoreAllDatabasesFromBaseState();
    return res.status(200).json(
      formatResponseBody({
        message: "All databases restored to immutable base state",
        data: result,
      }),
    );
  } catch (error) {
    logError("Failed to restore databases from base state snapshot", { error });
    return res.status(500).json(
      formatResponseBody({
        error: "Failed to restore databases from base state",
        details: {
          message: error?.message || "unknown error",
        },
      }),
    );
  }
});

module.exports = router;
