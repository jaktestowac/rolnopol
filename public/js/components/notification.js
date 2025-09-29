/**
 * Notification Component
 * Manages application notifications and alerts
 */
class NotificationComponent {
  constructor() {
    this.container = null;
    this.maxNotifications = 3;
    this.defaultDuration = 6000;
  }

  /**
   * Initialize the component
   * @param {App} app - Application instance
   */
  init(app) {
    this.eventBus = app.getEventBus();
    this._setupContainer();
    this._setupEventListeners();
  }
  /**
   * Show a notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, warning, info)
   * @param {number} duration - Display duration in milliseconds
   */
  show(message, type = "info", duration = this.defaultDuration) {
    const notification = this._createNotification(message, type);

    // Remove oldest notification if exceeding max
    if (this.container.children.length >= this.maxNotifications) {
      this._removeNotification(this.container.firstChild);
    }

    this.container.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
      notification.classList.add("show");
    });

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this._removeNotification(notification);
      }, duration);
    }

    return notification;
  }

  /**
   * Show success notification
   */
  success(message, duration) {
    return this.show(message, "success", duration);
  }

  /**
   * Show error notification
   */
  error(message, duration) {
    return this.show(message, "error", duration);
  }

  /**
   * Show warning notification
   */
  warning(message, duration) {
    return this.show(message, "warning", duration);
  }

  /**
   * Show info notification
   */
  info(message, duration) {
    return this.show(message, "info", duration);
  }

  /**
   * Clear all notifications
   */
  clear() {
    if (this.container) {
      this.container.innerHTML = "";
    }
  }

  /**
   * Setup notification container
   * @private
   */
  _setupContainer() {
    this.container = document.querySelector(".notifications-container");

    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "notifications-container";
      document.body.appendChild(this.container);
    }
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Listen for global notification events
    this.eventBus.on("notification:show", (data) => {
      this.show(data.message, data.type, data.duration);
    });

    this.eventBus.on("notification:clear", () => {
      this.clear();
    });

    // Listen for API errors
    this.eventBus.on("api:error", (data) => {
      this.error(`${data.error.message}`);
    });

    // Listen for auth success events only (errors are handled by ErrorLogger)
    this.eventBus.on("auth:login", () => {
      this.success("Login successful!");
    });

    this.eventBus.on("auth:logout", () => {
      this.info("You have been logged out");
    });

    this.eventBus.on("auth:register", () => {
      this.success("Registration successful!");
    });

    // Note: form:submitError and auth error events are now handled by ErrorLogger
    // No need to listen for them here to avoid duplicate notifications
  }

  /**
   * Create notification element
   * @private
   */
  _createNotification(message, type) {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;

    const iconMap = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      info: "ℹ",
    };

    const titleMap = {
      success: "Success",
      error: "Error",
      warning: "Warning",
      info: "Info",
    };

    notification.innerHTML = `
      <div class="notification-header">
        <div class="notification-icon">${iconMap[type] || iconMap.info}</div>
        <div class="notification-title">${titleMap[type] || titleMap.info}</div>
        <button class="notification-close" aria-label="Close notification">&times;</button>
      </div>
      <div class="notification-message">${message}</div>
    `;

    notification.setAttribute("role", "alert");
    notification.setAttribute("aria-live", "polite");

    // Add close button functionality
    const closeButton = notification.querySelector(".notification-close");
    closeButton.addEventListener("click", () => {
      this._removeNotification(notification);
    });

    return notification;
  }

  /**
   * Remove notification with animation
   * @private
   */
  _removeNotification(notification) {
    if (!notification || !notification.parentNode) return;

    notification.classList.add("removing");

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 200);
  }
}

// Global notification function for backward compatibility
window.showNotification = function (message, type = "info", duration) {
  const notificationComponent = window.App.getModule("notification");
  if (notificationComponent) {
    notificationComponent.show(message, type, duration);
  } else {
    console.warn("Notification component not available");
  }
};
