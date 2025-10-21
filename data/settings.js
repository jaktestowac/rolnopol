require("dotenv").config();

// Singleton settings object
const settings = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 3000,
  ADMIN_USERNAME: "superadmin",
  ADMIN_PASSWORD: "SuperPass1234",
  DEBUG_MODE: process.env.DEBUG_MODE === "true",
  LOG_REQUEST: process.env.LOG_REQUEST === "true" || false, // Default to false
  LOG_STACK_TRACE: process.env.LOG_STACK_TRACE === "true" || false, // Default to false
  FINANCE_INTEGRITY_CALCULATION: process.env.FINANCE_INTEGRITY_CALCULATION !== "false", // Default to true
  loginExpiration: { hours: 24 }, // 24 hours for user tokens
  loginExpirationAdmin: { hours: 1 }, // 1 hour for admin tokens
  RATE_LIMIT_WINDOW_MS: 30 * 1000, // 30 seconds
  RATE_LIMIT_MAX_REQUESTS: 100, // requests per window
  ADMIN_LOGIN_MAX_ATTEMPTS: 3,
  ADMIN_LOGIN_BLOCK_DURATION_MS: 60 * 1000, // 1 minute
  JWT_SECRET: process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this-in-production",
  FORBIDDEN_USERNAMES: [
    "admin",
    "superadmin",
    "administrator",
    "user",
    "test",
    "guest",
    "anonymous",
    "root",
    "system",
    "support",
    "info",
    "api",
    "null",
    "undefined",
    "demo",
    "sample",
  ],
};

module.exports = settings;
