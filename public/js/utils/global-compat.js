/**
 * Global Functions for Backward Compatibility
 * Provides global functions that work with the modular architecture
 */

/**
 * Global logout function
 * Works with the modular authentication system
 */
window.logout = async function () {
  try {
    const authService = window.App?.getModule("authService");
    if (authService) {
      await authService.logout();
    } else {
      // Fallback for when modular system isn't available
      console.warn("Auth service not available, performing basic logout");
      // Clear cookies manually using standardized naming
      document.cookie =
        "rolnopolToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
      document.cookie =
        "rolnopolIsLogged=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
      document.cookie =
        "rolnopolLoginTime=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
      document.cookie =
        "rolnopolUserLabel=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
      document.cookie =
        "rolnopolUsername=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
      document.cookie =
        "rolnopolUserId=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
    }
    window.location.href = "/";
  } catch (error) {
    errorLogger.log("Logout", error, { showToUser: false });
    // Force logout by clearing storage and redirecting
    clearAuthCookies();
    updateHeaderNav();
    window.location.href = "/";
  }
};

/**
 * Get cookie utility function
 * @param {string} name - Cookie name
 * @returns {string|null} Cookie value or null
 */
window.getCookie = function (name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
};

/**
 * Set cookie utility function
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {number} days - Expiration in days
 */
window.setCookie = function (name, value, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/`;
};

/**
 * Clear all authentication cookies
 */
window.clearAuthCookies = function () {
  const cookiesToClear = [
    "rolnopolToken",
    "rolnopolIsLogged",
    "rolnopolLoginTime",
    "rolnopolUserLabel",
    "rolnopolUsername",
    "rolnopolUserId",
  ];
  cookiesToClear.forEach((cookieName) => {
    document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT`;
  });
};

/**
 * Check if user is authenticated
 * @returns {boolean} Authentication status
 */
window.isAuthenticated = function () {
  const authService = window.App?.getModule("authService");
  if (authService) {
    return authService.isAuthenticated();
  }
  // Fallback check
  const token = getCookie("rolnopolToken");
  const isLogged = getCookie("rolnopolIsLogged");
  return !!(token && isLogged === "true");
};

/**
 * Get current user data
 * @returns {Promise<Object|null>} Current user data
 */
window.getCurrentUser = async function () {
  const authService = window.App?.getModule("authService");
  if (authService) {
    try {
      return await authService.getCurrentUser();
    } catch (error) {
      errorLogger.log("Current User Loading", error, { showToUser: false });
      return null;
    }
  }
  return null;
};

/**
 * Show notification
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning, info)
 */
window.showNotification = function (message, type = "info") {
  const notification = window.App?.getModule("notification");
  if (notification) {
    notification.show(message, type, 6000); // Use 6 second duration
  } else {
    // Fallback - log to console
    console.log(`${type.toUpperCase()}: ${message}`);
  }
};
