const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const observatoryController = require("../../controllers/observatory.controller");

const observatoryRoute = express.Router();
const apiLimiter = createRateLimiter("high");
const observatoryFeatureFlag = requireFeatureFlag("observatoryEnabled", { resourceName: "Observatory" });

observatoryRoute.get("/observatory", apiLimiter, observatoryFeatureFlag, observatoryController.getSnapshot.bind(observatoryController));

// Server-Sent Events stream of live sky snapshots — replaces the client's old
// REST-polling loop with a push-based feed (see controllers/observatory.controller.js).
observatoryRoute.get(
  "/observatory/stream",
  apiLimiter,
  observatoryFeatureFlag,
  observatoryController.streamSnapshot.bind(observatoryController),
);

module.exports = observatoryRoute;
