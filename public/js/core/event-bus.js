/**
 * Event Bus for application-wide communication
 * Provides pub/sub pattern for decoupled module communication
 */
class EventBus {
  constructor() {
    this.events = {};
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }

    this.events[event].push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.events[event].indexOf(callback);
      if (index > -1) {
        this.events[event].splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to an event (one-time only)
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  once(event, callback) {
    const unsubscribe = this.on(event, (...args) => {
      callback(...args);
      unsubscribe();
    });
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data = null) {
    if (this.events[event]) {
      this.events[event].forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          if (typeof errorLogger !== "undefined") {
            errorLogger.log(`Event Handler (${event})`, error, {
              showToUser: false,
            });
          } else {
            console.error(`Event Handler (${event}) Error:`, error);
          }
        }
      });
    }
  }

  /**
   * Remove all event listeners for a specific event
   * @param {string} event - Event name
   */
  off(event) {
    delete this.events[event];
  }

  /**
   * Remove all event listeners
   */
  clear() {
    this.events = {};
  }
}

// Export for global use
window.EventBus = EventBus;
