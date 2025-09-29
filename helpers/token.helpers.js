const { logDebug, logError } = require("./logger-api");
const {
  ADMIN_USERNAME,
  loginExpiration,
  loginExpirationAdmin,
} = require("../data/settings");

/**
 * Token generation and validation utilities using base64 encoding ()
 * Enhanced with backend token storage for security verification
 */

// In-memory token storage for security verification
const tokenStorage = new Map();

// Base64 encoding function
function base64Encode(text) {
  return Buffer.from(text).toString("base64");
}

// Base64 decoding function
function base64Decode(encodedText) {
  try {
    return Buffer.from(encodedText, "base64").toString("utf8");
  } catch (e) {
    logDebug("base64Decode: error:", { encodedText });
  }
  return null;
}

function addToCurrentDateTime(expiration) {
  let currentDate = new Date();

  if (expiration.minutes) {
    currentDate.setMinutes(currentDate.getMinutes() + expiration.minutes);
  }
  if (expiration.hours) {
    currentDate.setHours(currentDate.getHours() + expiration.hours);
  }

  return currentDate;
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
    if (!isDateInFuture(tokenData.expirationDate)) {
      tokenStorage.delete(userId);
      removedCount++;
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
 * Generate user token
 */
function generateToken(userId, expiration = { hours: 24 }) {
  let date = addToCurrentDateTime(expiration);

  // Create a string with userId, expiration date, and current timestamp
  // Format: "userId ISODateString currentTimestamp additionalInfo"
  const string = `${userId} ${date.toISOString()} ${Math.floor(Date.now() / 1000)} Nice_try_to_decode!`;
  const token = base64Encode(string);

  // Store token in backend storage for security verification
  storeToken(token, userId, date.toISOString(), false);

  logDebug("generateToken:", { string, userId, expiration });

  return token;
}

/**
 * Generate admin-specific token with 1-hour expiration
 */
function generateAdminToken() {
  let date = addToCurrentDateTime(loginExpirationAdmin);

  const string = `${ADMIN_USERNAME} ${date.toISOString()} ${Math.floor(Date.now() / 1000)} admin`;
  const token = base64Encode(string);

  // Store admin token in backend storage for security verification
  storeToken(token, ADMIN_USERNAME, date.toISOString(), true);

  logDebug("generateAdminToken:", { string, date });

  return token;
}

/**
 * Get user ID from token
 */
function getUserId(token) {
  if (!token) {
    logDebug("getUserId: error: token is empty", { token });
    return undefined;
  }

  const string = base64Decode(token);
  if (!string) {
    logDebug("getUserId: error: token invalid", { token });
    return undefined;
  }

  const parts = string.split(" ");
  const userId = parts[0]?.trim();

  return userId;
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

  const string = base64Decode(token);
  if (!string) {
    logDebug("isUserLogged: error: token invalid", { token });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }

  const parts = string.split(" ");
  const userId = parts[0];
  const dateStr = parts[1];

  if (!userId || userId.length < 1) {
    logDebug("isUserLogged: invalid userId", { userId });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }

  if (!isDateInFuture(dateStr)) {
    logDebug("isUserLogged:isDateInFuture: not.", { dateStr });
    // Remove expired token from storage
    removeTokenFromStorage(token);
    return false;
  }

  return true;
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

  const string = base64Decode(token);
  if (!string) {
    logDebug("isAdminToken: error: token invalid", { token });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }

  const parts = string.split(" ");

  // Check if it has at least 4 parts and the last part is "admin"
  if (parts.length < 4 || parts[3] !== "admin") {
    logDebug("isAdminToken: not an admin token", { parts });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }

  const userId = parts[0];
  const dateStr = parts[1];

  // Verify it's the admin username (admin tokens still use username format)
  if (userId !== ADMIN_USERNAME) {
    logDebug("isAdminToken: incorrect admin username", { userId });
    // Remove invalid token from storage
    removeTokenFromStorage(token);
    return false;
  }

  // Verify token is not expired
  if (!isDateInFuture(dateStr)) {
    logDebug("isAdminToken: token expired", { dateStr });
    // Remove expired token from storage
    removeTokenFromStorage(token);
    return false;
  }

  return true;
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
  const string = base64Decode(token);
  if (!string) {
    return null;
  }

  const parts = string.split(" ");
  if (parts.length < 2) {
    return null;
  }

  return parts[1]; // The ISO date string
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
  base64Encode,
  base64Decode,
};
