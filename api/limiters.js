const rateLimit = require("express-rate-limit");
const {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} = require("../data/settings");

/**
 * Rate limiting configuration
 */

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    error: "Too many requests from this IP, please try again later.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiter for sensitive endpoints
 */
const strictLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 20007, // Lower limit for sensitive operations
  message: {
    success: false,
    error: "Too many requests for this operation, please try again later.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Authentication rate limiter
 */
const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 1000, // Even stricter for auth endpoints
  message: {
    success: false,
    error: "Too many authentication attempts, please try again later.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Verification rate limiter (for registration, login, etc.)
 */
const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 500, // Very strict for verification
  message: {
    success: false,
    error: "Too many verification attempts, please try again in 5 minutes.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Admin dashboard rate limiter (more lenient for dashboard operations)
 */
const adminDashboardLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: 2000, // More generous for dashboard operations
  message: {
    success: false,
    error: "Too many dashboard requests, please try again later.",
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  strictLimiter,
  authLimiter,
  verifyLimiter,
  adminDashboardLimiter,
};
