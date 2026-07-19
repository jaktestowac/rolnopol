const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const twoFactorController = require("../../controllers/two-factor.controller");

const twoFactorRoute = express.Router();
const apiLimiter = createRateLimiter("api");

const requireTwoFactorFlag = requireFeatureFlag("twoFactorAuthEnabled", {
  resourceName: "Two-factor authentication",
});

twoFactorRoute.get(
  "/users/profile/two-factor",
  apiLimiter,
  requireTwoFactorFlag,
  authenticateSessionUser,
  twoFactorController.getConfiguration.bind(twoFactorController),
);

twoFactorRoute.post(
  "/users/profile/two-factor/setup",
  apiLimiter,
  requireTwoFactorFlag,
  authenticateSessionUser,
  twoFactorController.startSetup.bind(twoFactorController),
);

twoFactorRoute.post(
  "/users/profile/two-factor/enable",
  apiLimiter,
  requireTwoFactorFlag,
  authenticateSessionUser,
  twoFactorController.enable.bind(twoFactorController),
);

twoFactorRoute.post(
  "/users/profile/two-factor/disable",
  apiLimiter,
  requireTwoFactorFlag,
  authenticateSessionUser,
  twoFactorController.disable.bind(twoFactorController),
);

module.exports = twoFactorRoute;
