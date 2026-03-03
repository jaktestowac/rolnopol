const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const chaosEngineService = require("../services/chaos-engine.service");

class ChaosEngineController {
  async getChaosEngine(req, res) {
    try {
      const data = await chaosEngineService.getChaosEngineConfig();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting Chaos Engine config:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get Chaos Engine config" }));
    }
  }

  async patchChaosEngine(req, res) {
    try {
      const data = await chaosEngineService.patchChaosEngineConfig(req.body || {});
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error patching Chaos Engine config:", error);
      const message = typeof error?.message === "string" ? error.message : "Failed to update Chaos Engine config";
      const status = message.includes("Validation failed") ? 400 : 500;
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async putChaosEngine(req, res) {
    try {
      const data = await chaosEngineService.replaceChaosEngineConfig(req.body || {});
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error replacing Chaos Engine config:", error);
      const message = typeof error?.message === "string" ? error.message : "Failed to replace Chaos Engine config";
      const status = message.includes("Validation failed") ? 400 : 500;
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async resetChaosEngine(req, res) {
    try {
      const data = await chaosEngineService.resetChaosEngineConfig();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error resetting Chaos Engine config:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to reset Chaos Engine config" }));
    }
  }
}

module.exports = new ChaosEngineController();
