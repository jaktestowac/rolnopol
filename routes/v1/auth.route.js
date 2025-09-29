const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const authController = require("../../controllers/auth.controller");

const authRoute = express.Router();

// Apply rate limiting
const authLimiter = createRateLimiter("auth");

/**
 * User registration endpoint
 * POST /api/register
 */
authRoute.post(
  "/register",
  authLimiter,
  authController.register.bind(authController),
);

/**
 * User login endpoint
 * POST /api/login
 */
authRoute.post(
  "/login",
  authLimiter,
  authController.login.bind(authController),
);

/**
 * User logout endpoint
 * POST /api/logout
 */
authRoute.post("/logout", authController.logout.bind(authController));

module.exports = authRoute;
