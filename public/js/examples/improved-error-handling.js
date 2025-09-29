/**
 * Example: Improved Registration Handler with Graceful Error Handling
 * This shows how to use the new API error handling approach for better UX
 */

async function improvedRegisterHandler(formData) {
  const eventBus = window.App.getEventBus();

  // Use the graceful registration function
  const result = await registerUserGraceful(formData);

  if (!result.success) {
    // Handle different error cases gracefully
    switch (result.status) {
      case 409:
        // User already exists - show specific message
        eventBus.emit("notification:show", {
          message:
            "An account with this email already exists. Please try logging in instead.",
          type: "warning",
          duration: 5000,
        });
        break;

      case 400:
        // Validation errors - show specific field errors
        if (result.error.includes("email")) {
          eventBus.emit("notification:show", {
            message: "Please enter a valid email address.",
            type: "error",
          });
        } else if (result.error.includes("password")) {
          eventBus.emit("notification:show", {
            message: "Password must be at least 3 characters long.",
            type: "error",
          });
        } else {
          eventBus.emit("notification:show", {
            message: `Registration failed: ${result.error}`,
            type: "error",
          });
        }
        break;

      case 429:
        // Rate limiting
        eventBus.emit("notification:show", {
          message:
            "Too many registration attempts. Please wait a moment and try again.",
          type: "warning",
          duration: 8000,
        });
        break;

      default:
        // Network errors or server errors
        if (result.status === 0) {
          eventBus.emit("notification:show", {
            message:
              "Unable to connect. Please check your internet connection and try again.",
            type: "error",
          });
        } else {
          eventBus.emit("notification:show", {
            message: "Registration failed. Please try again later.",
            type: "error",
          });
        }
    }

    return false; // Registration failed
  }

  // Success case
  eventBus.emit("notification:show", {
    message: "Registration successful! Redirecting to login...",
    type: "success",
    duration: 3000,
  });

  setTimeout(() => {
    window.location.href = "/login.html";
  }, 2000);

  return true; // Registration successful
}

/**
 * Example: Login Handler with Mixed Approach
 * Login still uses exceptions since auth failures are expected to be handled uniformly
 */
async function improvedLoginHandler(credentials) {
  const eventBus = window.App.getEventBus();

  try {
    const userData = await loginUser(credentials);

    // Success
    eventBus.emit("notification:show", {
      message: `Welcome back, ${userData.user?.username || "User"}!`,
      type: "success",
    });

    window.location.href = "/profile.html";
    return userData;
  } catch (error) {
    // All auth errors are handled the same way
    eventBus.emit("notification:show", {
      message: error.message || "Login failed. Please check your credentials.",
      type: "error",
    });

    throw error; // Re-throw for form component error handling
  }
}

/**
 * Example: Data Fetching with Graceful Handling
 * For optional data that might fail to load
 */
async function loadOptionalUserStats(userId) {
  const result = await apiRequest(`${API_BASE_URL}/api/users/${userId}/stats`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      token: getToken(),
    },
  });

  if (!result.success) {
    // Don't show error to user for optional data
    console.warn("Failed to load user stats:", result.error);
    return null; // Return null instead of crashing the page
  }

  return result.data;
}

/**
 * Example: Critical Data with Exception Handling
 * For essential data that the page can't function without
 */
async function loadCriticalUserData(userId) {
  const result = await apiRequest(
    `${API_BASE_URL}/api/users/${userId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        token: getToken(),
      },
    },
    true,
  ); // throwOnError = true for critical data

  // If we reach here, the request was successful
  return result.data;
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    improvedRegisterHandler,
    improvedLoginHandler,
    loadOptionalUserStats,
    loadCriticalUserData,
  };
}
