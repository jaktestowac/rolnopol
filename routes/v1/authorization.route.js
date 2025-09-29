const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { authenticateUser } = require("../../middleware/auth.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { logDebug, logError } = require("../../helpers/logger-api");
const {
  isUserLogged,
  getUserId,
  clearAllTokens,
} = require("../../helpers/token.helpers");
const authService = require("../../services/auth.service");

const authorizationRoute = express.Router();

// Apply rate limiting
const apiLimiter = createRateLimiter("api");

/**
 * GET /api/authorization - Get current user information (token validation)
 * This endpoint validates the token and returns user data
 */
authorizationRoute.get(
  "/authorization",
  apiLimiter,
  authenticateUser,
  async (req, res) => {
    try {
      const user = await authService.validateUserToken(req.user.userId);

      logDebug("User authorization successful", { userId: user.id });

      res.status(200).json(
        formatResponseBody({
          data: user,
        }),
      );
    } catch (error) {
      logError("Error in authorization endpoint:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Internal server error",
        }),
      );
    }
  },
);

/**
 * POST /api/authorization - Validate and refresh token
 * This endpoint accepts a token in the body and validates it
 */
authorizationRoute.post("/authorization", apiLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(401).json(
        formatResponseBody({
          error: "Token required",
        }),
      );
    }

    if (!isUserLogged(token)) {
      return res.status(401).json(
        formatResponseBody({
          error: "Invalid or expired token",
        }),
      );
    }

    const userId = getUserId(token);
    if (!userId) {
      return res.status(401).json(
        formatResponseBody({
          error: "Invalid token format",
        }),
      );
    }

    const user = await authService.validateUserToken(userId);

    logDebug("Token validation successful", { userId: user.id });

    res.status(200).json(
      formatResponseBody({
        data: user,
      }),
    );
  } catch (error) {
    logError("Error in token validation:", error);
    res.status(500).json(
      formatResponseBody({
        error: "Internal server error",
      }),
    );
  }
});

/**
 * POST /api/migration/clear-tokens - Clear all tokens for system migration
 * This endpoint clears all tokens to force users to log in again with the new ID-based system
 */
authorizationRoute.post(
  "/migration/clear-tokens",
  apiLimiter,
  async (req, res) => {
    try {
      const clearedCount = clearAllTokens();

      logDebug("Migration: All tokens cleared", { clearedCount });

      res.status(200).json(
        formatResponseBody({
          message: "All tokens cleared successfully",
          clearedCount,
        }),
      );
    } catch (error) {
      logError("Error in migration endpoint:", error);
      res.status(500).json(
        formatResponseBody({
          error: "Internal server error",
        }),
      );
    }
  },
);

module.exports = authorizationRoute;
