const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const featureFlagsService = require("../services/feature-flags.service");

class FeatureFlagsController {
  async getFeatureFlags(req, res) {
    try {
      const data = await featureFlagsService.getFeatureFlags();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting feature flags:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get feature flags" }));
    }
  }

  async patchFeatureFlags(req, res) {
    try {
      const flags = req.body?.flags;
      const data = await featureFlagsService.updateFlags(flags);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error updating feature flags:", error);
      const errorMessage = typeof error?.message === "string" ? error.message : "";
      const isValidation = errorMessage.includes("Validation failed");
      const status = isValidation ? 400 : 500;
      const message = isValidation ? errorMessage : "Failed to update feature flags";
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async putFeatureFlags(req, res) {
    try {
      const flags = req.body?.flags;
      const data = await featureFlagsService.replaceAllFlags(flags);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error replacing feature flags:", error);
      const errorMessage = typeof error?.message === "string" ? error.message : "";
      const isValidation = errorMessage.includes("Validation failed");
      const status = isValidation ? 400 : 500;
      const message = isValidation ? errorMessage : "Failed to replace feature flags";
      return res.status(status).json(formatResponseBody({ error: message }));
    }
  }

  async resetFeatureFlags(req, res) {
    try {
      const data = await featureFlagsService.resetFeatureFlags();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error resetting feature flags:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to reset feature flags" }));
    }
  }
}

module.exports = new FeatureFlagsController();
