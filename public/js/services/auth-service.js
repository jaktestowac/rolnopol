/**
 * Authentication Service
 * Manages user authentication, sessions, and authorization
 */
class AuthService {
  constructor() {
    this.storage = null;
    this.apiService = null;
    this.eventBus = null;
    this.currentUser = null;
  }

  /**
   * Initialize the service
   * @param {App} app - Application instance
   */
  init(app) {
    this.storage = app.getModule("storage");
    this.apiService = app.getModule("apiService");
    this.eventBus = app.getEventBus();

    // Check for existing session
    this._checkExistingSession();
  }

  /**
   * Login user
   * @param {Object} credentials - Login credentials
   * @returns {Promise<Object>} User data
   */
  async login(credentials) {
    try {
      const response = await this.apiService.post("login", credentials);

      if (!response.success) {
        const error = new Error(response.error || "Login failed");
        throw error;
      }

      // Check for token in the nested data structure
      if (response.data?.data?.token) {
        this._setSession(response.data.data);
        this.eventBus.emit("auth:login", response.data.data);
        return response.data.data;
      }

      throw new Error("Invalid response format");
    } catch (error) {
      throw error;
    }
  }

  /**
   * Register new user
   * @param {Object} userData - Registration data
   * @returns {Promise<Object>} Response data
   */
  async register(userData) {
    try {
      const response = await this.apiService.post("register", userData);

      if (!response.success) {
        const error = new Error(response.error || "Registration failed");
        // Error logging is now handled by ErrorLogger, no need to emit auth:registerError
        throw error;
      }

      this.eventBus.emit("auth:register", response);
      return response;
    } catch (error) {
      // Error logging is now handled by ErrorLogger, no need to emit auth:registerError
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout() {
    try {
      // Clear all authentication data
      this._clearSession();

      // Emit logout event
      if (this.eventBus) {
        this.eventBus.emit("auth:logout", { reason: "user_logout" });
      }

      // Redirect to login page
      window.location.href = "/login.html";
    } catch (error) {
      errorLogger.logAuthError("Logout", error, { showToUser: false });
      throw error;
    }
  }

  /**
   * Get current user info
   * @returns {Promise<Object} User data
   */
  async getCurrentUser() {
    if (!this.isAuthenticated()) {
      throw new Error("User not authenticated");
    }

    try {
      const response = await this.apiService.get("authorization", {
        requiresAuth: true,
      });

      if (!response.success) {
        // If auth fails, clear session (but not on swagger page)
        if (!Utils.isSwaggerPage()) {
          this._clearSession();
        }
        const error = new Error(response.error || "Authentication failed");
        // Error logging is now handled by ErrorLogger, no need to emit auth:authError
        throw error;
      }

      // Handle the nested data structure like the login method
      if (response.data?.data) {
        this.currentUser = response.data.data;
        return response.data.data;
      } else {
        this.currentUser = response.data;
        return response.data;
      }
    } catch (error) {
      // If auth fails, clear session (but not on swagger page)
      if (!Utils.isSwaggerPage()) {
        this._clearSession();
      }
      // Error logging is now handled by ErrorLogger, no need to emit auth:authError
      throw error;
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} Authentication status
   */
  isAuthenticated() {
    const token = this.storage.cookie.get("rolnopolToken");
    const isLogged = this.storage.cookie.get("rolnopolIsLogged");
    return !!(token && isLogged === "true");
  }

  /**
   * Verify current session
   * @returns {Promise<boolean>} Session validity
   */
  async verifySession() {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get authentication token
   * @returns {string|null} Auth token
   */
  getToken() {
    return this.storage.cookie.get("rolnopolToken");
  }

  /**
   * Wait for authentication to be properly set
   * @param {number} maxWait - Maximum time to wait in milliseconds
   * @returns {Promise<boolean>} True if authenticated, false if timeout
   */
  async waitForAuth(maxWait = 2000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (this.isAuthenticated()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * Require authentication (redirect if not authenticated)
   * @param {string} redirectUrl - URL to redirect to if not authenticated
   */
  requireAuth(redirectUrl = "/") {
    if (!this.isAuthenticated()) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  }

  /**
   * Set session data
   * @private
   */
  _setSession(userData) {
    // Backend already sets rolnopolToken and rolnopolLoginTime cookies
    // We also set them as fallback in case backend cookies aren't immediately available
    if (userData.token) {
      this.storage.cookie.set("rolnopolToken", userData.token);
    }

    this.storage.cookie.set("rolnopolIsLogged", "true");

    if (userData.user) {
      const label = userData.user.displayedName || userData.user.email;
      this.storage.cookie.set("rolnopolUserLabel", label);
      this.storage.cookie.set(
        "rolnopolUserId",
        userData.user.userId || userData.user.id,
      );
    }

    this.currentUser = userData.user;
  }

  /**
   * Clear session data
   * @private
   */
  _clearSession() {
    if (this.storage) {
      this.storage.cookie.remove("rolnopolToken");
      this.storage.cookie.remove("rolnopolUserLabel");
      this.storage.cookie.remove("rolnopolIsLogged");
      this.storage.cookie.remove("rolnopolLoginTime");
      this.storage.cookie.remove("rolnopolUserId");
    }
  }

  /**
   * Check for existing session on initialization
   * @private
   */
  _checkExistingSession() {
    if (this.isAuthenticated()) {
      this.eventBus.emit("auth:sessionFound");
    }
  }
}

// Export for global use
window.AuthService = AuthService;
