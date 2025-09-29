/**
 * Error Handling Utilities
 * Common patterns and helpers for graceful API error handling
 */

class ErrorHandler {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Handle API response with common patterns
   * @param {Object} result - API response result
   * @param {Object} options - Error handling options
   * @returns {boolean} - Whether the operation was successful
   */
  handleApiResponse(result, options = {}) {
    const {
      successMessage = null,
      errorMessages = {},
      onSuccess = null,
      onError = null,
      showSuccessNotification = true,
      showErrorNotification = true,
    } = options;

    if (result.success) {
      if (successMessage && showSuccessNotification) {
        this.showNotification(successMessage, "success");
      }

      if (onSuccess) {
        onSuccess(result.data);
      }

      return true;
    }

    // Handle error cases
    const errorMessage = this.getErrorMessage(result, errorMessages);

    if (showErrorNotification) {
      this.showNotification(errorMessage, this.getErrorType(result.status));
    }

    if (onError) {
      onError(result);
    }

    return false;
  }

  /**
   * Get appropriate error message based on status code
   * @param {Object} result - API response result
   * @param {Object} customMessages - Custom error messages for specific status codes
   * @returns {string} - Error message to display
   */
  getErrorMessage(result, customMessages = {}) {
    // Check for custom message first
    if (customMessages[result.status]) {
      return customMessages[result.status];
    }

    // Default messages by status code range
    switch (true) {
      case result.status === 0:
        return "Unable to connect. Please check your internet connection.";

      case result.status === 400:
        return result.error || "Invalid request. Please check your input.";

      case result.status === 401:
        return "Authentication required. Please log in again.";

      case result.status === 403:
        return "Access denied. You don't have permission for this action.";

      case result.status === 404:
        return "The requested resource was not found.";

      case result.status === 409:
        return result.error || "Conflict detected. Please try again.";

      case result.status === 429:
        return "Too many requests. Please wait a moment and try again.";

      case result.status >= 500:
        return "Server error. Please try again later.";

      default:
        return result.error || "An unexpected error occurred.";
    }
  }

  /**
   * Get notification type based on status code
   * @param {number} status - HTTP status code
   * @returns {string} - Notification type
   */
  getErrorType(status) {
    switch (true) {
      case status === 401 || status === 403:
        return "warning";
      case status === 429:
        return "info";
      case status >= 500 || status === 0:
        return "error";
      default:
        return "error";
    }
  }

  /**
   * Show notification via event bus
   * @param {string} message - Message to display
   * @param {string} type - Notification type
   * @param {number} duration - Duration in milliseconds
   */
  showNotification(message, type = "info", duration = 4000) {
    if (this.eventBus) {
      this.eventBus.emit("notification:show", {
        message,
        type,
        duration,
      });
    }
  }

  /**
   * Handle form submission with API call
   * @param {Function} apiCall - Function that returns API result
   * @param {Object} options - Error handling options
   * @returns {Promise<boolean>} - Whether submission was successful
   */
  async handleFormSubmission(apiCall, options = {}) {
    try {
      const result = await apiCall();
      return this.handleApiResponse(result, options);
    } catch (error) {
      // Handle exceptions (network errors, server errors)
      this.showNotification(
        error.message || "An unexpected error occurred.",
        "error",
      );

      if (options.onError) {
        options.onError({ success: false, error: error.message, status: 0 });
      }

      return false;
    }
  }

  /**
   * Handle data loading with optional fallback
   * @param {Function} apiCall - Function that returns API result
   * @param {*} fallbackValue - Value to return on error
   * @param {boolean} silent - Whether to suppress error notifications
   * @returns {Promise<*>} - Data or fallback value
   */
  async handleDataLoad(apiCall, fallbackValue = null, silent = false) {
    try {
      const result = await apiCall();

      if (result.success) {
        return result.data;
      }

      if (!silent) {
        console.warn("Data load failed:", result.error);
      }

      return fallbackValue;
    } catch (error) {
      if (!silent) {
        console.error("Data load error:", error);
      }
      return fallbackValue;
    }
  }
}

/**
 * Common error handling patterns as static methods
 */
class ErrorPatterns {
  /**
   * Standard registration error handling
   */
  static getRegistrationOptions() {
    return {
      successMessage:
        "Registration successful! Please check your email to verify your account.",
      errorMessages: {
        409: "An account with this email already exists. Please try logging in instead.",
        400: "Please check your input and try again.",
        429: "Too many registration attempts. Please wait a moment and try again.",
      },
      onSuccess: () => {
        setTimeout(() => (window.location.href = "/login.html"), 2000);
      },
    };
  }

  /**
   * Standard login error handling
   */
  static getLoginOptions() {
    return {
      successMessage: "Welcome back!",
      errorMessages: {
        401: "Invalid email or password. Please try again.",
        429: "Too many login attempts. Please wait a moment and try again.",
      },
      onSuccess: () => {
        window.location.href = "/profile.html";
      },
    };
  }

  /**
   * Standard data save error handling
   */
  static getSaveOptions(itemName = "item") {
    return {
      successMessage: `${itemName} saved successfully!`,
      errorMessages: {
        400: `Invalid ${itemName} data. Please check your input.`,
        403: `You don't have permission to save this ${itemName}.`,
        409: `This ${itemName} has been modified by someone else. Please refresh and try again.`,
      },
    };
  }

  /**
   * Standard delete error handling
   */
  static getDeleteOptions(itemName = "item") {
    return {
      successMessage: `${itemName} deleted successfully.`,
      errorMessages: {
        403: `You don't have permission to delete this ${itemName}.`,
        404: `${itemName} not found. It may have already been deleted.`,
        409: `Cannot delete ${itemName} because it is being used elsewhere.`,
      },
    };
  }
}

// Create global instance if in browser
if (typeof window !== "undefined" && window.App) {
  window.ErrorHandler = ErrorHandler;
  window.ErrorPatterns = ErrorPatterns;
}

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ErrorHandler, ErrorPatterns };
}
