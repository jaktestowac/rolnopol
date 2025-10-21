const { formatResponseBody } = require("../helpers/response-helper");
const { isUserLogged, getUserId } = require("../helpers/token.helpers");
const { logDebug } = require("../helpers/logger-api");

/**
 * User authentication middleware
 */
const authenticateUser = (req, res, next) => {
  // Check for token in multiple locations:
  // 1. Authorization header (Bearer token)
  // 2. headers.token
  // 3. cookies.rolnopolToken
  const authHeader = req.headers.authorization;
  let token = req.headers.token; // Support both formats

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // If no token in headers, check cookies
  if (!token && req.cookies && req.cookies.rolnopolToken) {
    token = req.cookies.rolnopolToken;
  }

  if (!token) {
    return res.status(401).json(
      formatResponseBody({
        error: "Access token required",
      }),
    );
  }

  if (!isUserLogged(token)) {
    return res.status(403).json(
      formatResponseBody({
        error: "Invalid or expired token",
      }),
    );
  }

  const userId = getUserId(token);
  if (!userId) {
    return res.status(403).json(
      formatResponseBody({
        error: "Invalid token format",
      }),
    );
  }

  req.user = { userId };
  req.token = token;
  next();
};

/**
 * Admin authentication middleware using token
 */
const authenticateAdmin = (req, res, next) => {
  const { isAdminToken } = require("../helpers/token.helpers");

  // Check for token in Authorization header, request body, or cookies
  const authHeader = req.headers.authorization;
  const tokenFromBody = req.body.token;
  const tokenFromCookie = req.cookies?.krakenToken;

  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (tokenFromBody) {
    token = tokenFromBody;
  } else if (tokenFromCookie) {
    token = tokenFromCookie;
  }

  if (!token) {
    logDebug("Unauthorized admin access - no token provided", { ip: req.ip });
    return res
      .status(401)
      .send(formatResponseBody({ error: "Authentication required" }));
  }

  // Verify admin token
  if (!isAdminToken(token)) {
    logDebug("Unauthorized admin access - invalid or expired token", {
      ip: req.ip,
    });
    return res
      .status(403)
      .send(formatResponseBody({ error: "Invalid or expired admin token" }));
  }

  // Add user info for downstream handlers
  req.user = { isAdmin: true };
  req.adminToken = token;
  next();
};

/**
 * Simple password validation (no crypto, plain text)
 */
const validatePassword = (inputPassword, storedPassword) => {
  return inputPassword === storedPassword;
};

module.exports = {
  authenticateUser,
  authenticateAdmin,
  validatePassword,
};
