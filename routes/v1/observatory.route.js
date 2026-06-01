const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const observatoryController = require("../../controllers/observatory.controller");

const observatoryRoute = express.Router();
const apiLimiter = createRateLimiter("high");

observatoryRoute.get("/observatory", apiLimiter, observatoryController.getSnapshot.bind(observatoryController));

module.exports = observatoryRoute;
