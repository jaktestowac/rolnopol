const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const weatherLiveController = require("../../controllers/weather-live.controller");

const weatherLiveRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const weatherLiveFlag = requireFeatureFlag("weatherLiveStreamEnabled", { resourceName: "Weather live" });

// Single JSON snapshot of the current live conditions (+ any active alerts).
weatherLiveRoute.get("/weather/live", apiLimiter, weatherLiveFlag, weatherLiveController.getLive.bind(weatherLiveController));

// Server-Sent Events stream of `conditions` and `alert` events. Public (no auth)
// so anonymous visitors can watch the live dashboard; gated by the feature flag.
weatherLiveRoute.get("/weather/live/stream", apiLimiter, weatherLiveFlag, weatherLiveController.streamLive.bind(weatherLiveController));

module.exports = weatherLiveRoute;
