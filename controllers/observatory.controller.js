const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const observatoryService = require("../services/observatory.service");

class ObservatoryController {
  async getSnapshot(req, res) {
    try {
      const data = observatoryService.getSnapshot({
        timestamp: req.query?.timestamp,
        presetId: req.query?.presetId,
        latitudeDeg: req.query?.latitude,
        longitudeDeg: req.query?.longitude,
        magnitudeLimit: req.query?.magnitudeLimit,
      });

      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting observatory snapshot", { error });
      const statusCode = Number.isFinite(error?.statusCode) ? error.statusCode : 500;
      const message = typeof error?.message === "string" ? error.message : "Failed to get observatory snapshot";
      return res.status(statusCode).json(formatResponseBody({ error: message }));
    }
  }
}

module.exports = new ObservatoryController();
