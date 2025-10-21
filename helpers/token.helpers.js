const jwt = require("jsonwebtoken");
const { logDebug, logError } = require("./logger-api");
const {
  ADMIN_USERNAME,
  loginExpiration,
  loginExpirationAdmin,
  JWT_SECRET,
} = require("../data/settings");

/**
 * Token generation and validation utilities using JWT
 * Enhanced with backend token storage for security verification and revocation
 */

// In-memory token storage for security verification and revocation
const tokenStorage = new Map();

// Ensure JWT_SECRET is available
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be defined in settings.js");
}

function isDateInFuture(isoStringDate) {
  const givenDate = new Date(isoStringDate);
  const currentDate = new Date();
  return givenDate > currentDate;
}

/**
 * Clean up expired tokens from storage
 */
function cleanupExpiredStoredTokens() {
  let removedCount = 0;
  for (const [userId, tokenData] of tokenStorage.entries()) {
    // Check if stored expiration date has passed
    if (!isDateInFuture(tokenData.expirationDate)) {
      tokenStorage.delete(userId);
      removedCount++;
    } else {
      // Also check if JWT token itself is expired
      if (!JWT_SECRET) {
        logDebug("JWT_SECRET is not available, skipping JWT verification");
        continue;
      }
      try {
        jwt.verify(tokenData.token, JWT_SECRET);
      } catch (error) {
        // JWT is expired, remove from storage
        tokenStorage.delete(userId);
        removedCount++;
      }
    }
  }
  if (removedCount > 0) {
    logDebug(`Cleaned up ${removedCount} expired tokens from storage`);
  }
}

/**
 * Store token in backend storage (userId -> tokenData)
 */
function storeToken(token, userId, expirationDate, isAdmin = false) {
  // Remove any existing token for this user (enforce one token per user)
  if (tokenStorage.has(userId)) {
    logDebug("Replacing existing token for user", { userId });
  }

  tokenStorage.set(userId, {
    token,
    expirationDate,
    isAdmin,
    createdAt: new Date().toISOString(),
  });
  logDebug("Token stored in backend storage", {
    userId,
    isAdmin,
    tokenStorageSize: tokenStorage.size,
  });
}

/**
 * Check if token exists in backend storage and is valid
 */
function isTokenInStorage(token) {
  // Find the user with this token
  for (const [userId, tokenData] of tokenStorage.entries()) {
    if (tokenData.token === token) {
      // Check if token is expired
      if (!isDateInFuture(tokenData.expirationDate)) {
        logDebug("Token expired in storage", {
          token,
          userId,
          expirationDate: tokenData.expirationDate,
        });
        tokenStorage.delete(userId); // Remove expired token
        return false;
      }
      return true;
    }
  }

  logDebug("Token not found in storage", { token });
  return false;
}

/**
 * Remove token from storage by token value
 */
function removeTokenFromStorage(token) {
  // Find and remove the user with this token
  for (const [userId, tokenData] of tokenStorage.entries()) {
    if (tokenData.token === token) {
      const removed = tokenStorage.delete(userId);
      if (removed) {
        logDebug("Token removed from storage", { token, userId });
      }
      return removed;
    }
  }

  logDebug("Token not found for removal", { token });
  return false;
}

/**
 * Remove token from storage by userId
 */
function removeUserTokenFromStorage(userId) {
  const removed = tokenStorage.delete(userId);
  if (removed) {
    logDebug("User token removed from storage", { userId });
  }
  return removed;
}

/**
 * Get token data from storage by token value
 */
function getTokenFromStorage(token) {
  // Find the user with this token
  for (const [userId, tokenData] of tokenStorage.entries()) {
    if (tokenData.token === token) {
      return tokenData;
    }
  }
  return null;
}

/**
 * Get token data from storage by userId
 */
function getUserTokenFromStorage(userId) {
  return tokenStorage.get(userId);
}

/**
 * Generate user JWT token
 */
function generateToken(userId, expiration = { hours: 24 }) {
  const expiresIn = expiration.hours
    ? `${expiration.hours}h`
    : expiration.minutes
    ? `${expiration.minutes}m`
    : "24h";

  const tokenPayload = {
    userId,
    type: "user",
    iat: Math.floor(Date.now() / 1000),
  };

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn });

  // Store token in backend storage for security verification and revocation
  const expirationDate = new Date();
  if (expiration.hours) {
    expirationDate.setHours(expirationDate.getHours() + expiration.hours);
  } else if (expiration.minutes) {
    expirationDate.setMinutes(expirationDate.getMinutes() + expiration.minutes);
  } else {
    expirationDate.setHours(expirationDate.getHours() + 24); // Default to 24 hours
  }

  storeToken(token, userId, expirationDate.toISOString(), false);

  logDebug("generateToken:", { userId, expiration: expiresIn });

  return token;
}

/**
 * Generate admin-specific JWT token with 1-hour expiration
 */
function generateAdminToken() {
  const expiresIn = loginExpirationAdmin.hours
    ? `${loginExpirationAdmin.hours}h`
    : loginExpirationAdmin.minutes
    ? `${loginExpirationAdmin.minutes}m`
    : "1h";

  const tokenPayload = {
    userId: ADMIN_USERNAME,
    type: "admin",
    iat: Math.floor(Date.now() / 1000),
  };

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn });

  // Store admin token in backend storage for security verification and revocation
  const expirationDate = new Date();
  if (loginExpirationAdmin.hours) {
    expirationDate.setHours(expirationDate.getHours() + loginExpirationAdmin.hours);
  } else if (loginExpirationAdmin.minutes) {
    expirationDate.setMinutes(expirationDate.getMinutes() + loginExpirationAdmin.minutes);
  } else {
    expirationDate.setHours(expirationDate.getHours() + 1); // Default to 1 hour
  }

  storeToken(token, ADMIN_USERNAME, expirationDate.toISOString(), true);

  logDebug("generateAdminToken:", { adminUsername: ADMIN_USERNAME, expiration: expiresIn });

  return token;
}

/**
 * Get user ID from JWT token
 */
function getUserId(token) {
  if (!token) {
    logDebug("getUserId: error: token is empty", { token });
    return undefined;
  }

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.userId;
  } catch (error) {
    logDebug("getUserId: error: token invalid", { token, error: error.message });
    return undefined;
  }
}

/**
 * Check if user is logged in (token is valid)
 */
function isUserLogged(token) {
  if (!token) {
    logDebug("isUserLogged: error: token is empty", { token });
    return false;
  }

  // First check if token exists in backend storage
  if (!isTokenInStorage(token)) {
    logDebug("isUserLogged: token not found in storage or expired", { token });
    return false;
  }

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if it's a user token (not admin)
    if (decoded.type !== "user") {
      logDebug("isUserLogged: not a user token", { token });
      removeTokenFromStorage(token);
      return false;
    }

    return true;
  } catch (error) {
    logDebug("isUserLogged: error: token invalid", { token, error: error.message });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }
}

/**
 * Verify if the token is a valid admin token
 */
function isAdminToken(token) {
  if (!token) {
    logDebug("isAdminToken: error: token is empty", { token });
    return false;
  }

  // First check if token exists in backend storage and is admin token
  const tokenData = getTokenFromStorage(token);
  if (!tokenData || !tokenData.isAdmin) {
    logDebug("isAdminToken: token not found in storage or not admin token", {
      token,
    });
    return false;
  }

  // Additional check for storage token validity
  if (!isTokenInStorage(token)) {
    logDebug("isAdminToken: token not in storage or expired", { token });
    return false;
  }

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if it's an admin token
    if (decoded.type !== "admin" || decoded.userId !== ADMIN_USERNAME) {
      logDebug("isAdminToken: not a valid admin token", { token });
      removeTokenFromStorage(token);
      return false;
    }

    return true;
  } catch (error) {
    logDebug("isAdminToken: error: token invalid", { token, error: error.message });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }
}

/**
 * Verify and decode a token (returns payload if valid)
 */
function verifyToken(token) {
  if (!isUserLogged(token)) {
    return null;
  }

  const userId = getUserId(token);
  if (!userId) {
    return null;
  }

  return {
    userId: userId,
    valid: true,
  };
}

/**
 * Get token expiration date as ISO string
 */
function getTokenExpiration(token) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not available");
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return new Date(decoded.exp * 1000).toISOString();
  } catch (error) {
    logDebug("getTokenExpiration: error: token invalid", { token, error: error.message });
    return null;
  }
}

/**
 * Revoke a token (remove from storage)
 */
function revokeToken(token) {
  const removed = removeTokenFromStorage(token);
  if (removed) {
    logDebug("Token revoked successfully", { token });
  } else {
    logDebug("Token not found for revocation", { token });
  }
  return removed;
}

/**
 * Revoke an admin token (remove from storage)
 */
function revokeAdminToken(token) {
  const tokenData = getTokenFromStorage(token);
  if (tokenData && tokenData.isAdmin) {
    const removed = removeTokenFromStorage(token);
    if (removed) {
      logDebug("Admin token revoked successfully", { token });
    }
    return removed;
  } else {
    logDebug("Admin token not found for revocation", { token });
    return false;
  }
}

/**
 * Clean up expired tokens
 */
function cleanupExpiredTokens() {
  cleanupExpiredStoredTokens();
}

/**
 * Get token statistics
 */
function getTokenStats() {
  const allTokens = Array.from(tokenStorage.values());
  const userTokens = allTokens.filter((token) => !token.isAdmin);
  const adminTokens = allTokens.filter((token) => token.isAdmin);

  return {
    totalTokens: tokenStorage.size,
    activeUserTokens: userTokens.length,
    activeAdminTokens: adminTokens.length,
  };
}

/**
 * Invalidate all tokens for a specific user
 */
function invalidateUserTokens(userId) {
  const tokenData = tokenStorage.get(userId);
  if (tokenData && !tokenData.isAdmin) {
    const removed = tokenStorage.delete(userId);
    if (removed) {
      logDebug(`Invalidated token for user ${userId}`);
      return 1;
    }
  }
  logDebug(`No token found to invalidate for user ${userId}`);
  return 0;
}

/**
 * Check if user has an active token
 */
function hasActiveToken(userId) {
  const tokenData = tokenStorage.get(userId);
  if (!tokenData) {
    return false;
  }

  // Check if token is expired
  if (!isDateInFuture(tokenData.expirationDate)) {
    tokenStorage.delete(userId); // Remove expired token
    return false;
  }

  return true;
}

/**
 * Get user's current token
 */
function getUserCurrentToken(userId) {
  const tokenData = tokenStorage.get(userId);
  if (!tokenData) {
    return null;
  }

  // Check if token is expired
  if (!isDateInFuture(tokenData.expirationDate)) {
    tokenStorage.delete(userId); // Remove expired token
    return null;
  }

  return tokenData.token;
}

/**
 * Clear all tokens from storage (for system migration)
 */
function clearAllTokens() {
  const tokenCount = tokenStorage.size;
  tokenStorage.clear();
  logDebug(
    `Cleared all ${tokenCount} tokens from storage for system migration`,
  );
  return tokenCount;
}

module.exports = {
  generateToken,
  verifyToken,
  generateAdminToken,
  isAdminToken,
  getUserId,
  isUserLogged,
  getTokenExpiration,
  revokeToken,
  revokeAdminToken,
  cleanupExpiredTokens,
  getTokenStats,
  removeTokenFromStorage,
  removeUserTokenFromStorage,
  invalidateUserTokens,
  isTokenInStorage,
  getTokenFromStorage,
  getUserTokenFromStorage,
  hasActiveToken,
  getUserCurrentToken,
  clearAllTokens,
};
