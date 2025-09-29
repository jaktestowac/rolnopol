const API_BASE_URL =
  window.location.protocol === "file:" ? "http://localhost:3000" : "";
const API_VERSION = "v1"; // Explicitly use v1

/**
 * Get the full API endpoint URL with version
 * @param {string} endpoint - API endpoint (without /api prefix)
 * @returns {string} Full URL with version
 */
function getApiUrl(endpoint) {
  // Remove leading slash if present
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  return `${API_BASE_URL}/api/${API_VERSION}/${cleanEndpoint}`;
}

/**
 * Enhanced API request helper that returns error objects instead of throwing for client errors
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {boolean} throwOnError - Whether to throw on client errors (4xx)
 * @returns {Promise<Object>} Response object with success flag
 */
async function apiRequest(url, options = {}, throwOnError = false) {
  try {
    const response = await fetch(url, options);

    // Parse response data
    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      responseData = { error: "Invalid JSON response" };
    }

    if (!response.ok) {
      const apiError = {
        success: false,
        error: responseData.error || `HTTP error! status: ${response.status}`,
        status: response.status,
        data: responseData,
      };

      // Only throw for server errors (5xx) or when explicitly requested
      if (throwOnError || response.status >= 500) {
        throw new Error(apiError.error);
      }

      return apiError;
    }

    return {
      success: true,
      data: responseData,
      status: response.status,
    };
  } catch (error) {
    // Network errors and other exceptions
    if (throwOnError) {
      throw error;
    }

    return {
      success: false,
      error: error.message || "Network error occurred",
      status: 0,
    };
  }
}

/**
 * Get authentication token from cookies
 * Note: This cannot read httpOnly cookies, so it checks for rolnopolLoginTime instead
 * @returns {string|null} Token value or null if not found (will return null for httpOnly tokens)
 */
function getToken() {
  // Since rolnopolToken is httpOnly, we can't read it from JavaScript
  // We check for rolnopolLoginTime as an indicator that user is logged in
  return getCookie("rolnopolLoginTime");
}

/**
 * Check if user is logged in by checking for login time cookie
 * @returns {boolean} True if user appears to be logged in
 */
function isLoggedIn() {
  return getCookie("rolnopolLoginTime") !== null;
}

/**
 * Get cookie value by name
 * @param {string} name - Cookie name
 * @returns {string|null} Cookie value or null if not found
 */
function getCookie(name) {
  const cookies = document.cookie.split(";");
  for (let cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

async function loginUser(credentials) {
  const result = await apiRequest(getApiUrl("login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  if (!result.data.data?.token) {
    throw new Error("No token in response");
  }

  return result.data.data;
}

async function logoutUserAPI() {
  const result = await apiRequest(getApiUrl("logout"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // Include cookies in the request
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  // Clear authentication cookies on successful logout
  clearAuthCookies();

  return result.data;
}

/**
 * Clear authentication cookies
 */
function clearAuthCookies() {
  const cookiesToClear = ["rolnopolToken", "rolnopolLoginTime"];
  cookiesToClear.forEach((cookieName) => {
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
  });
}

async function verifyAuthorization(token) {
  // If no token is provided, rely on cookies
  const requestBody = token ? { token: encodeToken(token) } : {};
  const headers = {
    "Content-Type": "application/json",
  };

  // Add token to header if provided, otherwise rely on cookies
  if (token) {
    headers.token = encodeToken(token);
  }

  const result = await apiRequest(getApiUrl("authorization"), {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
    credentials: "include", // Include cookies in the request
  });

  if (!result.success) {
    // Check if it's a token-related error and handle automatic logout
    if (handleTokenError(result.error)) {
      throw new Error("Session expired. Please log in again.");
    }

    throw new Error(result.error);
  }
  return result.data.data;
}

/**
 * Encode token for transmission (simple base64 encoding)
 * @param {string} token - Token to encode
 * @returns {string} Encoded token
 */
function encodeToken(token) {
  if (!token) return "";
  return btoa(token);
}

/**
 * Enhanced logout function that can be called from anywhere
 * Clears tokens and redirects to login page
 */
function forceLogout(message = "Session expired") {
  console.log("Force logout triggered:", message);

  // Clear authentication cookies
  clearAuthCookies();

  // Show a brief message through ErrorLogger
  if (window.errorLogger) {
    errorLogger.log("Force Logout", message, { showToUser: true });
  }

  // Redirect to login page
  setTimeout(() => {
    window.location.href = "/login.html";
  }, 100);
}

/**
 * Handle automatic logout when token is invalid or expired
 * @param {string} errorMessage - The error message to check
 */
function handleTokenError(errorMessage) {
  const tokenErrorKeywords = [
    "Invalid or expired token",
    "Token expired",
    "Token invalid",
    "Authentication required",
    "Invalid token",
    "Unauthorized",
  ];

  if (tokenErrorKeywords.some((keyword) => errorMessage.includes(keyword))) {
    console.log("Token error detected, logging out user:", errorMessage);

    // Use the enhanced logout function
    forceLogout("Your session has expired. Please log in again.");

    return true;
  }

  return false;
}

async function getUserInfo() {
  const result = await apiRequest(getApiUrl("authorization"), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // Include cookies in the request
  });

  if (!result.success) {
    // Check if it's a token-related error and handle automatic logout
    if (handleTokenError(result.error)) {
      throw new Error("Session expired. Please log in again.");
    }

    throw new Error(result.error);
  }

  return result.data.data;
}

async function registerUser(userData) {
  const result = await apiRequest(getApiUrl("register"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
    signal: AbortSignal.timeout(15000), // 15 seconds timeout
  });

  if (!result.success) {
    console.error("Error in registerUser:", result.error);
    throw new Error(result.error);
  }

  return result.data;
}

// Graceful version that doesn't throw for expected errors
async function registerUserGraceful(userData) {
  const result = await apiRequest(getApiUrl("register"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
    signal: AbortSignal.timeout(15000),
  });

  // Don't throw for client errors (4xx) - let caller handle them
  if (!result.success && result.status >= 400 && result.status < 500) {
    return result; // Return error object instead of throwing
  }

  // Still throw for network errors and server errors
  if (!result.success) {
    throw new Error(result.error);
  }

  return result;
}

async function fetchSampleSecretCode() {
  const result = await apiRequest(getApiUrl("verify/sample"), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  // This function gracefully returns errors without throwing
  return result.success ? result.data : result;
}

/**
 * Global API error handler for any API call
 * Use this function to wrap API calls that might return token errors
 * @param {Function} apiFunction - The API function to call
 * @param {...any} args - Arguments to pass to the API function
 * @returns {Promise<any>} Result of the API function or handles logout on token error
 */
async function safeApiCall(apiFunction, ...args) {
  try {
    return await apiFunction(...args);
  } catch (error) {
    // Check if it's a token-related error and handle automatic logout
    if (handleTokenError(error.message)) {
      throw new Error("Session expired. Please log in again.");
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Fetch documentation data from backend API
 */
async function fetchDocumentation() {
  const result = await apiRequest(getApiUrl("documentation"), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!result.success) {
    throw new Error(result.error || "Failed to fetch documentation");
  }
  return result.data.docs;
}
