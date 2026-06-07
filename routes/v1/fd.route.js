const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { logError } = require("../../helpers/logger-api");

// Defensive loading — if fd.controller fails, mount stub routes returning 503
let farmDefenceController;
try {
  farmDefenceController = require("../../controllers/fd.controller");
} catch (err) {
  logError("[fd.route] Failed to load fd.controller — mounting stub routes:", err.message);
  farmDefenceController = null;
}

const farmDefenceRoute = express.Router();
const apiLimiter = createRateLimiter("high");

if (farmDefenceController) {
  farmDefenceRoute.get("/fd", apiLimiter, farmDefenceController.getFarmDefence.bind(farmDefenceController));
  farmDefenceRoute.get("/fd/updates", apiLimiter, farmDefenceController.getFarmDefenceUpdates.bind(farmDefenceController));
  farmDefenceRoute.post("/fd/actions", apiLimiter, farmDefenceController.applyFarmDefenceAction.bind(farmDefenceController));
} else {
  const { formatResponseBody } = require("../../helpers/response-helper");
  const stub = (req, res) => res.status(503).json(formatResponseBody({ error: "Farm Defence service is currently unavailable" }));
  farmDefenceRoute.get("/fd", apiLimiter, stub);
  farmDefenceRoute.get("/fd/updates", apiLimiter, stub);
  farmDefenceRoute.post("/fd/actions", apiLimiter, stub);
}

module.exports = farmDefenceRoute;
