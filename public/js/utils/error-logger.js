/**
 * Error Logger Utility
 * Provides controlled error logging without exposing sensitive information
 */

class ErrorLogger {
  constructor() {
    this.isDevelopment = this._isDevelopment();
    this.errorCount = 0;
    this.maxErrors = 10; // Limit error logging to prevent spam
  }

  /**
   * Check if we're in development mode
   * @private
   */
  _isDevelopment() {
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.includes("dev") ||
      window.location.hostname.includes("staging")
    );
  }

  /**
   * Log an error with controlled output
   * @param {string} context - Context where the error occurred
   * @param {Error|string|any} error - The error object or message
   * @param {Object} options - Additional options
   */
  log(context, error, options = {}) {
    const {
      showToUser = false,
      userMessage = null,
      critical = false,
      silent = false,
    } = options;

    // Increment error count
    this.errorCount++;

    // Stop logging if we've exceeded the limit (unless it's critical)
    if (this.errorCount > this.maxErrors && !critical) {
      if (this.errorCount === this.maxErrors + 1) {
        console.warn(
          `[ErrorLogger] Maximum error count (${this.maxErrors}) reached. Further errors will be suppressed.`,
        );
      }
      return;
    }

    // Prepare error message
    const timestamp = new Date().toISOString();
    const errorMessage = this._formatErrorMessage(context, error);

    // Log based on environment
    if (showToUser && !silent) {
      if (this.isDevelopment) {
        // Development: Full error details
        console.error(`[${timestamp}] ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          console.error(`[${timestamp}] Stack:`, error.stack);
        }
      } else {
        // Production: Limited error details
        console.error(`[${timestamp}] ${errorMessage}`);

        // Only log stack traces for critical errors in production
        if (critical && error instanceof Error && error.stack) {
          console.error(`[${timestamp}] Critical Error Stack:`, error.stack);
        }
      }
    }

    // Show user notification if requested
    if (showToUser && !silent) {
      this._showUserNotification(
        userMessage || this._getUserFriendlyMessage(error),
      );
    }

    // Emit error event for global handling
    try {
      if (window.App && window.App.getEventBus) {
        const eventBus = window.App.getEventBus();
        if (eventBus && typeof eventBus.emit === "function") {
          eventBus.emit("error:logged", {
            context,
            error: errorMessage,
            timestamp,
            critical,
            userMessage: userMessage || this._getUserFriendlyMessage(error),
          });
        }
      }
    } catch (error) {
      // If we can't emit the error event, just log it to console
      console.warn("Failed to emit error event:", error);
    }
  }

  /**
   * Format error message for logging
   * @private
   */
  _formatErrorMessage(context, error) {
    if (typeof error === "string") {
      return `${context}: ${error}`;
    }

    if (error instanceof Error) {
      return `${context}: ${error.message}`;
    }

    if (error && typeof error === "object") {
      // Handle API error objects
      if (error.error) {
        return `${context}: ${error.error}`;
      }
      if (error.message) {
        return `${context}: ${error.message}`;
      }
      if (error.status) {
        return `${context}: HTTP ${error.status} - ${error.error || "Request failed"}`;
      }
    }

    return `${context}: ${String(error)}`;
  }

  /**
   * Get user-friendly error message
   * @private
   */
  _getUserFriendlyMessage(error) {
    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (error && typeof error === "object") {
      // Handle API errors
      if (error.error) {
        return error.error;
      }
      if (error.message) {
        return error.message;
      }
      if (error.status) {
        switch (error.status) {
          case 401:
            return "Authentication required. Please log in again.";
          case 403:
            return "Access denied. You don't have permission for this action.";
          case 404:
            return "The requested resource was not found.";
          case 429:
            return "Too many requests. Please wait a moment and try again.";
          case 500:
            return "Server error. Please try again later.";
          default:
            return "An unexpected error occurred. Please try again.";
        }
      }
    }

    return "An unexpected error occurred. Please try again.";
  }

  /**
   * Show user notification
   * @private
   */
  _showUserNotification(message) {
    try {
      if (window.App && window.App.getEventBus) {
        const eventBus = window.App.getEventBus();
        if (eventBus && typeof eventBus.emit === "function") {
          eventBus.emit("notification:show", {
            message,
            type: "error",
            duration: 8000,
          });
        }
      } else if (window.showNotification) {
        window.showNotification(message, "error");
      }
    } catch (error) {
      // If we can't emit the notification event, just log it to console
      console.warn("Failed to emit notification event:", error);
    }
  }

  /**
   * Log API errors specifically
   */
  logApiError(endpoint, error, options = {}) {
    const context = `API Error (${endpoint})`;
    this.log(context, error, {
      showToUser: false, // Let NotificationComponent handle API error notifications
      userMessage: this._getUserFriendlyMessage(error),
      ...options,
    });
  }

  /**
   * Log authentication errors
   */
  logAuthError(action, error, options = {}) {
    const context = `Authentication Error (${action})`;
    this.log(context, error, {
      showToUser: false, // Auth errors are handled specially
      critical: true,
      ...options,
    });
  }

  /**
   * Log form validation errors
   */
  logValidationError(formName, error, options = {}) {
    const context = `Validation Error (${formName})`;
    this.log(context, error, {
      showToUser: false, // Validation errors are shown in forms
      ...options,
    });
  }

  /**
   * Log critical errors that need immediate attention
   */
  logCritical(context, error, options = {}) {
    this.log(context, error, {
      critical: true,
      showToUser: true,
      userMessage:
        "A critical error occurred. Please contact support if this persists.",
      ...options,
    });
  }

  /**
   * Reset error count (useful for testing or after error recovery)
   */
  resetErrorCount() {
    this.errorCount = 0;
  }

  /**
   * Get current error count
   */
  getErrorCount() {
    return this.errorCount;
  }
}

// Create global instance
const errorLogger = new ErrorLogger();

// Export for use in other modules
if (typeof window !== "undefined") {
  window.ErrorLogger = ErrorLogger;
  window.errorLogger = errorLogger;
}

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ErrorLogger, errorLogger };
}
