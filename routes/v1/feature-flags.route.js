const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const featureFlagsController = require("../../controllers/feature-flags.controller");

const featureFlagsRoute = express.Router();
const apiLimiter = createRateLimiter("api");

// GET /api/feature-flags
featureFlagsRoute.get("/feature-flags", apiLimiter, featureFlagsController.getFeatureFlags.bind(featureFlagsController));

// PATCH /api/feature-flags
featureFlagsRoute.patch("/feature-flags", apiLimiter, featureFlagsController.patchFeatureFlags.bind(featureFlagsController));

// PUT /api/feature-flags
featureFlagsRoute.put("/feature-flags", apiLimiter, featureFlagsController.putFeatureFlags.bind(featureFlagsController));

// POST /api/feature-flags/reset
featureFlagsRoute.post("/feature-flags/reset", apiLimiter, featureFlagsController.resetFeatureFlags.bind(featureFlagsController));

module.exports = featureFlagsRoute;
