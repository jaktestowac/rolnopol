/**
 * Core Application Module
 * Manages application initialization, routing, and state
 */
class App {
  constructor() {
    this.modules = new Map();
    this.eventBus = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the event bus
   */
  _initEventBus() {
    if (typeof EventBus !== "undefined") {
      this.eventBus = new EventBus();
    } else {
      throw new Error("EventBus is not available");
    }
  }

  /**
   * Register a module with the application
   * @param {string} name - Module name
   * @param {Object} module - Module instance
   */
  registerModule(name, module) {
    this.modules.set(name, module);

    // Initialize module if app is already initialized
    if (this.isInitialized && typeof module.init === "function") {
      module.init(this);
    }
  }

  /**
   * Get a registered module
   * @param {string} name - Module name
   * @returns {Object|null} Module instance or null
   */
  getModule(name) {
    return this.modules.get(name) || null;
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Initialize event bus first
      this._initEventBus();

      // Initialize all registered modules
      for (const [name, module] of this.modules) {
        if (typeof module.init === "function") {
          await module.init(this);
        }
      }

      this.isInitialized = true;
      this.eventBus.emit("app:initialized");
    } catch (error) {
      if (typeof errorLogger !== "undefined") {
        errorLogger.logCritical("App Initialization", error, {
          showToUser: true,
        });
      } else {
        console.error("App Initialization Error:", error);
      }
      throw error;
    }
  }

  /**
   * Get the event bus for cross-module communication
   * @returns {EventBus} Event bus instance
   */
  getEventBus() {
    return this.eventBus;
  }
}

// Create global app instance
window.App = new App();
