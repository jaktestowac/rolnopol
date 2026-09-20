const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const observatoryController = require("../../controllers/observatory.controller");

const observatoryRoute = express.Router();
const apiLimiter = createRateLimiter("high");
const observatoryFeatureFlag = requireFeatureFlag("observatoryEnabled", { resourceName: "Observatory" });

observatoryRoute.get("/observatory", apiLimiter, observatoryFeatureFlag, observatoryController.getSnapshot.bind(observatoryController));

// The canvas, answered as data: which objects the dome holds, where each one
// lands in canvas pixels under the requested zoom/pan, and which of them the
// aperture actually shows (see services/observatory.service.js -> getViewport).
observatoryRoute.get(
  "/observatory/viewport",
  apiLimiter,
  observatoryFeatureFlag,
  observatoryController.getViewport.bind(observatoryController),
);

// Server-Sent Events stream of live sky snapshots — replaces the client's old
// REST-polling loop with a push-based feed (see controllers/observatory.controller.js).
observatoryRoute.get(
  "/observatory/stream",
  apiLimiter,
  observatoryFeatureFlag,
  observatoryController.streamSnapshot.bind(observatoryController),
);

module.exports = observatoryRoute;
