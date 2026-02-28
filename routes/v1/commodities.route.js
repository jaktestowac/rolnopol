const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const commoditiesController = require("../../controllers/commodities.controller");

const commoditiesRoute = express.Router();
const apiLimiter = createRateLimiter("api");

const commoditiesEnabled = requireFeatureFlag("financialCommoditiesEnabled", { resourceName: "Commodities" });
const commoditiesTradingEnabled = requireFeatureFlag("financialCommoditiesTradingEnabled", { resourceName: "Commodities trading" });

commoditiesRoute.get(
  "/commodities/prices",
  apiLimiter,
  commoditiesEnabled,
  authenticateUser,
  commoditiesController.getPrices.bind(commoditiesController),
);

commoditiesRoute.get(
  "/commodities/prices/:symbol/history",
  apiLimiter,
  commoditiesEnabled,
  authenticateUser,
  commoditiesController.getPriceHistory.bind(commoditiesController),
);

commoditiesRoute.get(
  "/commodities/portfolio",
  apiLimiter,
  commoditiesEnabled,
  authenticateUser,
  commoditiesController.getPortfolio.bind(commoditiesController),
);

commoditiesRoute.post(
  "/commodities/buy",
  apiLimiter,
  commoditiesEnabled,
  commoditiesTradingEnabled,
  authenticateUser,
  commoditiesController.buyCommodity.bind(commoditiesController),
);

commoditiesRoute.post(
  "/commodities/sell",
  apiLimiter,
  commoditiesEnabled,
  commoditiesTradingEnabled,
  authenticateUser,
  commoditiesController.sellCommodity.bind(commoditiesController),
);

module.exports = commoditiesRoute;
