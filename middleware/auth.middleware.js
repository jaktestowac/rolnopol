const { formatResponseBody } = require("../helpers/response-helper");
const { isUserLogged, getUserId } = require("../helpers/token.helpers");
const { logDebug } = require("../helpers/logger-api");
const personalApiKeyService = require("../services/personal-api-key.service");

function extractSessionToken(req) {
  const authHeader = req.headers.authorization;
  let token = req.headers.token;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  if (!token && req.cookies && req.cookies.rolnopolToken) {
    token = req.cookies.rolnopolToken;
  }

  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
}

function extractApiKey(req) {
  const headerValue = req.headers["x-api-key"];

  if (Array.isArray(headerValue)) {
    return typeof headerValue[0] === "string" && headerValue[0].trim().length > 0 ? headerValue[0].trim() : null;
  }

  return typeof headerValue === "string" && headerValue.trim().length > 0 ? headerValue.trim() : null;
}

function createAuthenticateUser(options = {}) {
  const allowApiKey = options.allowApiKey !== false;

  return async (req, res, next) => {
    const token = extractSessionToken(req);

    if (token) {
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
      req.auth = { type: "token" };
      return next();
    }

    if (allowApiKey) {
      const apiKey = extractApiKey(req);

      if (apiKey) {
        const result = await personalApiKeyService.authenticateApiKey(apiKey, req);

        if (!result?.valid) {
          const errorMessage =
            result?.reason === "insufficient_scope" ? "API key does not grant access to this resource" : "Invalid or revoked API key";

          return res.status(403).json(
            formatResponseBody({
              error: errorMessage,
            }),
          );
        }

        req.user = { userId: result.userId };
        req.apiKey = result.apiKey;
        req.auth = {
          type: "api-key",
          apiKeyId: result.apiKey.id,
          scopes: result.apiKey.scopes,
          requiredScope: result.requiredScope,
        };
        return next();
      }
    }

    return res.status(401).json(
      formatResponseBody({
        error: "Access token required",
      }),
    );
  };
}

/**
 * User authentication middleware
 */
const authenticateUser = createAuthenticateUser();
const authenticateSessionUser = createAuthenticateUser({ allowApiKey: false });

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
    return res.status(401).send(formatResponseBody({ error: "Authentication required" }));
  }

  // Verify admin token
  if (!isAdminToken(token)) {
    logDebug("Unauthorized admin access - invalid or expired token", {
      ip: req.ip,
    });
    return res.status(403).send(formatResponseBody({ error: "Invalid or expired admin token" }));
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
  authenticateSessionUser,
  createAuthenticateUser,
  authenticateAdmin,
  validatePassword,
};
