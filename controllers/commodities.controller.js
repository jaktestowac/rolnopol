const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const commoditiesService = require("../services/commodities.service");

class CommoditiesController {
  async getPrices(req, res) {
    try {
      const data = await commoditiesService.getCurrentPrices(req.query.symbols);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting commodities prices:", error);
      const status = String(error?.message || "").includes("Validation failed") ? 400 : 500;
      return res.status(status).json(formatResponseBody({ error: error.message || "Failed to get commodities prices" }));
    }
  }

  async getPriceHistory(req, res) {
    try {
      const { symbol } = req.params;
      const { hours } = req.query;
      const data = await commoditiesService.getPriceHistory(symbol, hours);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting commodity price history:", error);
      const status = String(error?.message || "").includes("Validation failed") ? 400 : 500;
      return res.status(status).json(formatResponseBody({ error: error.message || "Failed to get commodity history" }));
    }
  }

  async buyCommodity(req, res) {
    try {
      const data = await commoditiesService.buyCommodity(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Commodity purchase completed",
          data,
        }),
      );
    } catch (error) {
      logError("Error buying commodity:", error);
      const message = error?.message || "Failed to buy commodity";

      let status = 500;
      if (message.includes("Validation failed")) {
        status = 400;
      } else if (message.includes("Insufficient funds")) {
        status = 400;
      }

      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async sellCommodity(req, res) {
    try {
      const data = await commoditiesService.sellCommodity(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Commodity sale completed",
          data,
        }),
      );
    } catch (error) {
      logError("Error selling commodity:", error);
      const message = error?.message || "Failed to sell commodity";

      let status = 500;
      if (message.includes("Validation failed")) {
        status = 400;
      } else if (message.includes("Insufficient quantity")) {
        status = 400;
      }

      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async getPortfolio(req, res) {
    try {
      const data = await commoditiesService.getPortfolio(req.user.userId);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting commodities portfolio:", error);
      const status = String(error?.message || "").includes("Validation failed") ? 400 : 500;
      return res.status(status).json(formatResponseBody({ error: error.message || "Failed to get portfolio" }));
    }
  }
}

module.exports = new CommoditiesController();
