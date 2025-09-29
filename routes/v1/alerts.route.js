const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const alertsController = require("../../controllers/alerts.controller");

const alertsRoute = express.Router();
const apiLimiter = createRateLimiter("api");

// GET /api/alerts?date=YYYY-MM-DD (combined)
alertsRoute.get("/alerts", apiLimiter, alertsController.getCombined.bind(alertsController));

// GET /api/alerts/history?date=YYYY-MM-DD
alertsRoute.get("/alerts/history", apiLimiter, alertsController.getHistory.bind(alertsController));

// GET /api/alerts/upcoming?date=YYYY-MM-DD
alertsRoute.get("/alerts/upcoming", apiLimiter, alertsController.getUpcoming.bind(alertsController));

module.exports = alertsRoute;
