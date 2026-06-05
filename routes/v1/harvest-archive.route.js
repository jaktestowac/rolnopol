const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const harvestArchiveController = require("../../controllers/harvest-archive.controller");

const harvestArchiveRoute = express.Router();
const apiLimiter = createRateLimiter("high");

harvestArchiveRoute.get("/harvest-archive", apiLimiter, harvestArchiveController.getMetadata.bind(harvestArchiveController));

harvestArchiveRoute.get("/harvest-archive/entries", apiLimiter, harvestArchiveController.getEntries.bind(harvestArchiveController));

module.exports = harvestArchiveRoute;
