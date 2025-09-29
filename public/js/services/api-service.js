/**
 * API Service for making HTTP requests
 * Provides a centralized interface for all API communication
 */
class ApiService {
  constructor() {
    this.baseUrl = window.location.protocol === "file:" ? "http://localhost:3000" : "";
    this.apiVersion = "v1"; // Explicitly use v1
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
    this.storage = null;
  }

  /**
   * Initialize the service
   * @param {App} app - Application instance
   */
  init(app) {
    this.storage = app.getModule("storage");
    this.eventBus = app.getEventBus();
  }

  /**
   * Get the full API endpoint URL with version
   * @param {string} endpoint - API endpoint (without /api prefix)
   * @returns {string} Full URL with version
   */
  getApiUrl(endpoint) {
    // Remove leading slash if present
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return `${this.baseUrl}/api/${this.apiVersion}/${cleanEndpoint}`;
  }

  /**
   * Make an HTTP request
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint (without /api prefix)
   * @param {Object} options - Request options
   * @returns {Promise} API response with success/error handling
   */
  async request(method, endpoint, options = {}) {
    const { body, headers = {}, requiresAuth = false, timeout = 15000, throwOnError = false } = options;

    const url = this.getApiUrl(endpoint);
    const requestHeaders = { ...this.defaultHeaders, ...headers };

    // Add authentication if required
    if (requiresAuth && this.storage) {
      const token = this.storage.cookie.get("rolnopolToken");
      if (token) {
        requestHeaders.token = token;
      }
    }

    const requestOptions = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeout),
      credentials: "include",
    };

    if (body && method !== "GET") {
      requestOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    try {
      const response = await fetch(url, requestOptions);

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

        // Emit error event for global error handling (for all error responses)
        if (this.eventBus) {
          const error = new ApiError(apiError.error, response.status, responseData);
          this.eventBus.emit("api:error", { error, endpoint, method });
        }

        // Redirect to login page for authentication errors
        if (response.status === 401 || response.status === 403) {
          // Clear any existing authentication data
          if (this.storage) {
            this.storage.cookie.remove("rolnopolToken");
            this.storage.cookie.remove("rolnopolUserLabel");
            this.storage.cookie.remove("rolnopolUsername");
            this.storage.cookie.remove("rolnopolIsLogged");
            this.storage.cookie.remove("rolnopolLoginTime");
            this.storage.cookie.remove("rolnopolUserId");
          }
          // Only emit logout event and redirect if not on login, register, or swagger endpoints
          const endpointLower = (endpoint || "").toLowerCase();
          if (
            this.eventBus &&
            endpointLower !== "login" &&
            endpointLower !== "/login" &&
            endpointLower !== "register" &&
            endpointLower !== "/register" &&
            !Utils.isSwaggerPage()
          ) {
            this.eventBus.emit("auth:logout", { reason: "token_expired" });
            // Redirect to login page
            window.location.href = "/login.html";
          }
          return apiError;
        }

        // Only throw for server errors (5xx) or when explicitly requested
        if (throwOnError || response.status >= 500) {
          const error = new ApiError(apiError.error, response.status, responseData);
          throw error;
        }

        return apiError;
      }

      return {
        success: true,
        data: responseData,
        status: response.status,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = {
          success: false,
          error: "Request timed out. Please try again.",
          status: 408,
        };

        if (throwOnError) {
          throw new ApiError(timeoutError.error, 408);
        }

        return timeoutError;
      }

      // Network errors and other exceptions - always throw these
      // Emit error event for global error handling
      if (this.eventBus) {
        this.eventBus.emit("api:error", { error, endpoint, method });
      }

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
   * GET request
   */
  get(endpoint, options = {}) {
    return this.request("GET", endpoint, options);
  }

  /**
   * POST request
   */
  post(endpoint, body, options = {}) {
    return this.request("POST", endpoint, { ...options, body });
  }

  /**
   * PUT request
   */
  put(endpoint, body, options = {}) {
    return this.request("PUT", endpoint, { ...options, body });
  }

  /**
   * DELETE request
   */
  delete(endpoint, options = {}) {
    return this.request("DELETE", endpoint, options);
  }

  /**
   * Legacy methods that throw errors (for backward compatibility)
   */
  async getThrows(endpoint, options = {}) {
    return this.request("GET", endpoint, { ...options, throwOnError: true });
  }

  async postThrows(endpoint, body, options = {}) {
    return this.request("POST", endpoint, {
      ...options,
      body,
      throwOnError: true,
    });
  }

  async putThrows(endpoint, body, options = {}) {
    return this.request("PUT", endpoint, {
      ...options,
      body,
      throwOnError: true,
    });
  }

  async deleteThrows(endpoint, options = {}) {
    return this.request("DELETE", endpoint, { ...options, throwOnError: true });
  }

  /**
   * Get authentication token
   * @returns {string|null} Auth token
   */
  getToken() {
    return this.storage.cookie.get("rolnopolToken");
  }

  /**
   * Clear authentication data
   * @private
   */
  _clearAuth() {
    if (this.storage) {
      this.storage.cookie.remove("rolnopolToken");
      this.storage.cookie.remove("rolnopolUserLabel");
      this.storage.cookie.remove("rolnopolUsername");
      this.storage.cookie.remove("rolnopolIsLogged");
      this.storage.cookie.remove("rolnopolLoginTime");
      this.storage.cookie.remove("rolnopolUserId");
    }
  }

  /**
   * Animals API
   */
  getAnimals(options = {}) {
    return this.get("animals", options);
  }
  addAnimal(body, options = {}) {
    return this.post("animals", body, options);
  }
  deleteAnimal(id, options = {}) {
    return this.delete(`animals/${id}`, options);
  }

  /**
   * Marketplace API
   */
  getMarketplaceOffers(options = {}) {
    return this.get("marketplace/offers", options);
  }

  getMyOffers(options = {}) {
    return this.get("marketplace/my-offers", options);
  }

  createOffer(body, options = {}) {
    return this.post("marketplace/offers", body, options);
  }

  buyItem(body, options = {}) {
    return this.post("marketplace/buy", body, options);
  }

  cancelOffer(id, options = {}) {
    return this.delete(`marketplace/offers/${id}`, options);
  }

  getMarketplaceTransactions(options = {}) {
    return this.get("marketplace/transactions", options);
  }

  /**
   * Districts API
   */
  getDistricts(options = {}) {
    // Deprecated: use getMapDistricts instead to fetch from /map/districts
    return this.post("fields/districts", null, options);
  }

  getDistrictBySlug(slug, options = {}) {
    // slug is district name with dashes instead of spaces
    return this.post(`fields/districts/${slug}`, null, options);
  }

  /**
   * Map API
   */
  getMapDistricts(options = {}) {
    return this.get("map/districts", options);
  }
}

/**
 * API Error class for better error handling
 */
class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// Export for global use
window.ApiError = ApiError;
window.ApiService = ApiService;
