const {
  verifyLimiter,
  adminDashboardLimiter,
  authLimiter,
  apiLimiter,
  apiHighLimiter,
} = require("../api/limiters");

/**
 * Rate limiting middleware factory
 * Returns appropriate rate limiter based on endpoint type
 */
const createRateLimiter = (type = "api") => {
  switch (type) {
    case "auth":
      return authLimiter;
    case "verify":
      return verifyLimiter;
    case "admin":
      return adminDashboardLimiter;
    case "high":
      return apiHighLimiter;
    case "api":
    default:
      return apiLimiter;
  }
};

/**
 * Admin login attempt tracking
 */
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const cleanupExpiredAttempts = () => {
  const now = Date.now();
  for (const [clientId, attemptData] of loginAttempts.entries()) {
    // Remove entries that are no longer blocked and haven't attempted in the last hour
    if (
      (!attemptData.blockedUntil || now > attemptData.blockedUntil) &&
      now - attemptData.lastAttempt > 60 * 60 * 1000
    ) {
      loginAttempts.delete(clientId);
    }
  }
};

const getClientId = (req) => {
  return (
    req.ip ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    "unknown"
  );
};

const isClientBlocked = (clientId) => {
  const attemptData = loginAttempts.get(clientId);
  if (!attemptData) return false;

  const now = Date.now();

  // If block period has expired, reset attempts
  if (attemptData.blockedUntil && now > attemptData.blockedUntil) {
    loginAttempts.delete(clientId);
    return false;
  }

  return attemptData.blockedUntil && now < attemptData.blockedUntil;
};

const recordFailedAttempt = (clientId) => {
  const now = Date.now();
  const attemptData = loginAttempts.get(clientId) || {
    count: 0,
    firstAttempt: now,
  };

  attemptData.count++;
  attemptData.lastAttempt = now;

  if (attemptData.count >= MAX_LOGIN_ATTEMPTS) {
    attemptData.blockedUntil = now + BLOCK_DURATION_MS;
  }

  loginAttempts.set(clientId, attemptData);
  return attemptData;
};

const clearAttempts = (clientId) => {
  loginAttempts.delete(clientId);
};

/**
 * Admin login rate limiting middleware
 */
const adminLoginLimiter = (req, res, next) => {
  const clientId = getClientId(req);
  cleanupExpiredAttempts();

  // Check if client is currently blocked
  if (isClientBlocked(clientId)) {
    const attemptData = loginAttempts.get(clientId);
    const timeLeft = Math.ceil(
      (attemptData.blockedUntil - Date.now()) / 1000 / 60,
    ); // in minutes
    return res.status(429).send({
      error: `Too many failed login attempts. Please try again in ${timeLeft} minute${timeLeft === 1 ? "" : "s"}.`,
    });
  }

  req.adminLoginAttempts = {
    recordFailed: () => recordFailedAttempt(clientId),
    clear: () => clearAttempts(clientId),
    isBlocked: () => isClientBlocked(clientId),
    getAttempts: () => loginAttempts.get(clientId),
  };

  next();
};

module.exports = {
  createRateLimiter,
  adminLoginLimiter,
  getClientId,
  MAX_LOGIN_ATTEMPTS,
};
