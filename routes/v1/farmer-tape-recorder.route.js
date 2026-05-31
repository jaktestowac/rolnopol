const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const farmerTapeRecorderController = require("../../controllers/farmer-tape-recorder.controller");

const farmerTapeRecorderRoute = express.Router();
const apiLimiter = createRateLimiter("high");

farmerTapeRecorderRoute.get("/tape-recorder", apiLimiter, farmerTapeRecorderController.getTapeRecorder.bind(farmerTapeRecorderController));

farmerTapeRecorderRoute.post(
  "/tape-recorder/actions",
  apiLimiter,
  farmerTapeRecorderController.applyAction.bind(farmerTapeRecorderController),
);

module.exports = farmerTapeRecorderRoute;
