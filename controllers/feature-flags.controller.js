const { formatResponseBody } = require("../helpers/response-helper");
const { logError, logWarning } = require("../helpers/logger-api");
const featureFlagsService = require("../services/feature-flags.service");

class FeatureFlagsController {
  async getFeatureFlags(req, res) {
    try {
      const includeDescriptions = req.query.descriptions === "true";
      const data = includeDescriptions
        ? await featureFlagsService.getFeaturesWithDescriptions()
        : await featureFlagsService.getFeatureFlags();
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      logError("Error getting feature flags:", error);
      return res.status(500).json(formatResponseBody({ error: "Failed to get feature flags" }));
    }
  }

  // A rejected write against a pinned flag is expected behaviour, not a fault,
  // so it stays at WARN instead of polluting the error log.
  _logWriteError(prefix, error) {
    if (error?.code === featureFlagsService.PINNED_FLAG_ERROR_CODE) {
      logWarning(`${prefix} ${error.message}`);
      return;
    }
    logError(prefix, error);
  }

  // A write that tries to change a flag pinned by feature-flags.ini is a
  // conflict, not a bad request: the payload is well formed, the file just
  // outranks it. See services/feature-flag-ini.service.js.
  _resolveWriteError(error, fallbackMessage) {
    const errorMessage = typeof error?.message === "string" ? error.message : "";

    if (error?.code === featureFlagsService.PINNED_FLAG_ERROR_CODE) {
      return { status: 409, message: errorMessage, conflicts: error.conflicts || [] };
    }

    if (errorMessage.includes("Validation failed")) {
      return { status: 400, message: errorMessage };
    }

    return { status: 500, message: fallbackMessage };
  }

  async patchFeatureFlags(req, res) {
    try {
      const flags = req.body?.flags;
      const data = await featureFlagsService.updateFlags(flags);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      this._logWriteError("Error updating feature flags:", error);
      const { status, message, conflicts } = this._resolveWriteError(error, "Failed to update feature flags");
      return res.status(status).json(formatResponseBody(conflicts ? { error: message, details: conflicts } : { error: message }));
    }
  }

  async putFeatureFlags(req, res) {
    try {
      const flags = req.body?.flags;
      const data = await featureFlagsService.replaceAllFlags(flags);
      return res.status(200).json(formatResponseBody({ data }));
    } catch (error) {
      this._logWriteError("Error replacing feature flags:", error);
      const { status, message, conflicts } = this._resolveWriteError(error, "Failed to replace feature flags");
      return res.status(status).json(formatResponseBody(conflicts ? { error: message, details: conflicts } : { error: message }));
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
