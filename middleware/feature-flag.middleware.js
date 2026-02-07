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

  return async (req, res, next) => {
    try {
      const data = await featureFlagsService.getFeatureFlags();
      const enabled = data?.flags?.[flagName] === true;

      if (!enabled) {
        return sendNotFound(req, res, resourceName);
      }

      return next();
    } catch (error) {
      return sendInternalError(req, res);
    }
  };
}

module.exports = {
  requireFeatureFlag,
};
