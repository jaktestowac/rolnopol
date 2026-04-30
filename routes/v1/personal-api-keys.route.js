const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const personalApiKeyController = require("../../controllers/personal-api-key.controller");

const personalApiKeysRoute = express.Router();
const apiLimiter = createRateLimiter("api");

personalApiKeysRoute.get(
  "/users/profile/api-keys",
  apiLimiter,
  requireFeatureFlag("personalApiKeysEnabled", { resourceName: "Personal API keys" }),
  authenticateSessionUser,
  personalApiKeyController.list.bind(personalApiKeyController),
);

personalApiKeysRoute.post(
  "/users/profile/api-keys",
  apiLimiter,
  requireFeatureFlag("personalApiKeysEnabled", { resourceName: "Personal API keys" }),
  authenticateSessionUser,
  personalApiKeyController.create.bind(personalApiKeyController),
);

personalApiKeysRoute.post(
  "/users/profile/api-keys/:keyId/regenerate",
  apiLimiter,
  requireFeatureFlag("personalApiKeysEnabled", { resourceName: "Personal API keys" }),
  authenticateSessionUser,
  personalApiKeyController.regenerate.bind(personalApiKeyController),
);

personalApiKeysRoute.delete(
  "/users/profile/api-keys/:keyId",
  apiLimiter,
  requireFeatureFlag("personalApiKeysEnabled", { resourceName: "Personal API keys" }),
  authenticateSessionUser,
  personalApiKeyController.revoke.bind(personalApiKeyController),
);

module.exports = personalApiKeysRoute;
