const featureFlagsService = require("../services/feature-flags.service");
const { sendNotFound, sendInternalError } = require("../helpers/response-helper");

/**
 * Feature flag gating middleware factory
 * @param {string} flagName - Flag to check
 * @param {Object} options - Optional configuration
 * @param {string} options.resourceName - Resource label for 404 response
 * @returns {Function} Express middleware
 */
function requireFeatureFlag(flagName, options = {}) {
  const resourceName = options.resourceName || "Resource";

  const middleware = async (req, res, next) => {
    try {
      const data = await featureFlagsService.getFeatureFlags();
      const enabled = data?.flags?.[flagName] === true;

      if (!enabled) {
        return sendNotFound(req, res, resourceName);
      }

      return next();
    } catch (error) {
      const { logError } = require("../helpers/logger-api");
      logError("Feature flag middleware failed", { error: error instanceof Error ? error.stack || error.message : error });
      return sendInternalError(req, res);
    }
  };

  // Self-description for the OpenAPI generator (build/generate-openapi.js). The
  // flag name lives inside this closure, so without these tags the generator
  // could not tell which endpoints are gated or by what. Runtime ignores them.
  middleware.featureFlag = flagName;
  middleware.resourceName = resourceName;

  return middleware;
}

module.exports = {
  requireFeatureFlag,
};
