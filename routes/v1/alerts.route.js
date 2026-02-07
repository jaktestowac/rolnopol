const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const alertsController = require("../../controllers/alerts.controller");

const alertsRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const alertsFeatureFlag = requireFeatureFlag("alertsEnabled", { resourceName: "Alerts" });

// GET /api/alerts?date=YYYY-MM-DD (combined)
alertsRoute.get("/alerts", apiLimiter, alertsFeatureFlag, alertsController.getCombined.bind(alertsController));

// GET /api/alerts/history?date=YYYY-MM-DD
alertsRoute.get("/alerts/history", apiLimiter, alertsFeatureFlag, alertsController.getHistory.bind(alertsController));

// GET /api/alerts/upcoming?date=YYYY-MM-DD
alertsRoute.get("/alerts/upcoming", apiLimiter, alertsFeatureFlag, alertsController.getUpcoming.bind(alertsController));

module.exports = alertsRoute;
