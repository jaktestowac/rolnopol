/**
 * Router for single-page application navigation
 */
class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.eventBus = null;
  }

  /**
   * Initialize the router
   * @param {App} app - Application instance
   */
  init(app) {
    this.eventBus = app.getEventBus();
    this._setupEventListeners();
    this._handleInitialRoute();
  }

  /**
   * Register a route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler function
   */
  addRoute(path, handler) {
    this.routes.set(path, handler);
  }

  /**
   * Navigate to a route
   * @param {string} path - Path to navigate to
   * @param {Object} state - Optional state object
   */
  navigate(path, state = {}) {
    window.history.pushState(state, "", path);
    this._handleRoute(path, state);
  }

  /**
   * Replace current route
   * @param {string} path - Path to replace with
   * @param {Object} state - Optional state object
   */
  replace(path, state = {}) {
    window.history.replaceState(state, "", path);
    this._handleRoute(path, state);
  }

  /**
   * Go back in history
   */
  back() {
    window.history.back();
  }

  /**
   * Go forward in history
   */
  forward() {
    window.history.forward();
  }

  /**
   * Get current route
   * @returns {string} Current route path
   */
  getCurrentRoute() {
    return this.currentRoute;
  }
  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    window.addEventListener("popstate", (event) => {
      this._handleRoute(window.location.pathname, event.state);
    });

    // Note: Link click interception disabled for multi-page application
    // If you need SPA navigation, enable this and configure routes properly
    /*
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (link && this._shouldHandleLink(link)) {
        event.preventDefault();
        this.navigate(link.getAttribute("href"));
      }
    });
    */
  }

  /**
   * Handle initial route on page load
   * @private
   */
  _handleInitialRoute() {
    this._handleRoute(window.location.pathname, window.history.state);
  }

  /**
   * Handle route change
   * @private
   */
  _handleRoute(path, state = {}) {
    const route = this._matchRoute(path);

    if (route) {
      this.currentRoute = path;

      if (this.eventBus) {
        this.eventBus.emit("router:beforeNavigate", {
          from: this.currentRoute,
          to: path,
          state,
        });
      }

      try {
        route.handler(path, state);

        if (this.eventBus) {
          this.eventBus.emit("router:navigate", {
            path,
            state,
          });
        }
      } catch (error) {
        errorLogger.log("Route Handler", error, { showToUser: false });

        if (this.eventBus) {
          this.eventBus.emit("router:error", {
            path,
            error,
          });
        }
      }
    } else {
      this._handle404(path);
    }
  }

  /**
   * Match route pattern
   * @private
   */
  _matchRoute(path) {
    // Simple exact match for now
    const handler = this.routes.get(path);
    return handler ? { handler } : null;
  }

  /**
   * Handle 404 errors
   * @private
   */
  _handle404(path) {
    if (this.eventBus) {
      this.eventBus.emit("router:notFound", { path });
    }

    // Try to find a 404 handler
    const notFoundHandler = this.routes.get("*") || this.routes.get("/404");
    if (notFoundHandler) {
      notFoundHandler(path);
    }
  }
  /**
   * Check if link should be handled by router
   * @private
   */
  _shouldHandleLink(link) {
    const href = link.getAttribute("href");

    // Skip external links
    if (
      href.startsWith("http") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return false;
    }

    // Skip links with target="_blank"
    if (link.getAttribute("target") === "_blank") {
      return false;
    }

    // Skip links with data-no-router attribute
    if (link.hasAttribute("data-no-router")) {
      return false;
    }

    // Skip HTML page links - allow normal page navigation for multi-page apps
    if (href.endsWith(".html") || href.includes(".html#")) {
      return false;
    }

    // Skip links to different pages (let them load naturally)
    if (
      href.includes("/") &&
      (href.includes("profile") ||
        href.includes("login") ||
        href.includes("register") ||
        href.includes("dashboard"))
    ) {
      return false;
    }

    return true;
  }
}
