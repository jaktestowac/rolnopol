const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const weatherController = require("../../controllers/weather.controller");

const weatherRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const weatherFeatureFlag = requireFeatureFlag("weatherPageEnabled", { resourceName: "Weather" });
const weatherInsightsFlag = requireFeatureFlag("weatherUserInsightsEnabled", { resourceName: "Weather insights" });
const weatherDataExportFlag = requireFeatureFlag("weatherWeatherDataExport", { resourceName: "Weather export" });

weatherRoute.get("/weather/regions", apiLimiter, weatherFeatureFlag, weatherController.getRegions.bind(weatherController));
weatherRoute.get("/weather", apiLimiter, weatherFeatureFlag, weatherController.getDaily.bind(weatherController));
weatherRoute.get("/weather/forecast", apiLimiter, weatherFeatureFlag, weatherController.getForecast.bind(weatherController));
weatherRoute.get(
  "/weather/export/csv",
  apiLimiter,
  weatherFeatureFlag,
  weatherDataExportFlag,
  weatherController.exportWeatherCsv.bind(weatherController),
);
weatherRoute.get(
  "/weather/export/pdf",
  apiLimiter,
  weatherFeatureFlag,
  weatherDataExportFlag,
  weatherController.exportWeatherPdf.bind(weatherController),
);
weatherRoute.get(
  "/weather/user-insights",
  apiLimiter,
  weatherFeatureFlag,
  weatherInsightsFlag,
  authenticateUser,
  weatherController.getUserInsights.bind(weatherController),
);

module.exports = weatherRoute;
