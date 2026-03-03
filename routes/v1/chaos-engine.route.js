const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const chaosEngineController = require("../../controllers/chaos-engine.controller");

const chaosEngineRoute = express.Router();
const apiLimiter = createRateLimiter("api");

chaosEngineRoute.get("/chaos-engine", apiLimiter, chaosEngineController.getChaosEngine.bind(chaosEngineController));
chaosEngineRoute.patch("/chaos-engine", apiLimiter, chaosEngineController.patchChaosEngine.bind(chaosEngineController));
chaosEngineRoute.put("/chaos-engine", apiLimiter, chaosEngineController.putChaosEngine.bind(chaosEngineController));
chaosEngineRoute.post("/chaos-engine/reset", apiLimiter, chaosEngineController.resetChaosEngine.bind(chaosEngineController));

module.exports = chaosEngineRoute;
