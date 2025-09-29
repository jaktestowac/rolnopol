/**
 * Utility functions for common operations
 */
const Utils = {
  /**
   * Debounce function execution
   * @param {Function} func - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },

  /**
   * Throttle function execution
   * @param {Function} func - Function to throttle
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Throttled function
   */
  throttle(func, delay) {
    let lastCall = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return func.apply(this, args);
      }
    };
  },

  /**
   * Format date to locale string
   * @param {Date|string|number} date - Date to format
   * @param {Object} options - Intl.DateTimeFormat options
   * @returns {string} Formatted date string
   */
  formatDate(date, options = {}) {
    const dateObj = date instanceof Date ? date : new Date(date);
    const defaultOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };

    return dateObj.toLocaleDateString(undefined, {
      ...defaultOptions,
      ...options,
    });
  },

  /**
   * Sanitize HTML string
   * @param {string} str - String to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Generate unique ID
   * @param {string} prefix - Optional prefix
   * @returns {string} Unique ID
   */
  generateId(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Deep merge objects
   * @param {Object} target - Target object
   * @param {...Object} sources - Source objects
   * @returns {Object} Merged object
   */
  deepMerge(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.deepMerge(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }

    return this.deepMerge(target, ...sources);
  },

  /**
   * Check if value is an object
   * @param {*} item - Item to check
   * @returns {boolean} Is object
   */
  isObject(item) {
    return item && typeof item === "object" && !Array.isArray(item);
  },

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<boolean>} Success status
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for older browsers
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        return true;
      } catch (fallbackErr) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("Text Copy", fallbackErr, { showToUser: false });
        } else {
          console.error("Text Copy Error:", fallbackErr);
        }
        return false;
      }
    }
  },

  /**
   * Load script dynamically
   * @param {string} src - Script source URL
   * @returns {Promise} Load promise
   */
  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  /**
   * Load CSS dynamically
   * @param {string} href - CSS file URL
   * @returns {Promise} Load promise
   */
  loadCSS(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  },

  /**
   * Get URL parameters
   * @param {string} url - URL to parse (defaults to current URL)
   * @returns {Object} URL parameters
   */
  getUrlParams(url = window.location.href) {
    const urlObj = new URL(url);
    const params = {};

    for (const [key, value] of urlObj.searchParams) {
      params[key] = value;
    }

    return params;
  },

  /**
   * Set URL parameters without page reload
   * @param {Object} params - Parameters to set
   * @param {boolean} replace - Use replaceState instead of pushState
   */
  setUrlParams(params, replace = false) {
    const url = new URL(window.location);

    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    });

    const method = replace ? "replaceState" : "pushState";
    window.history[method]({}, "", url);
  },

  /**
   * Check if current page is the Swagger documentation page
   * @returns {boolean} True if on swagger page
   */
  isSwaggerPage() {
    const currentPath = window.location.pathname.toLowerCase();
    return currentPath.includes("swagger");
  },

  /**
   * Check if current page is an authentication page (login/register)
   * @returns {boolean} True if on auth page
   */
  isAuthPage() {
    const currentPath = window.location.pathname.toLowerCase();
    return currentPath.includes("login") || currentPath.includes("register");
  },
};

// Export for global use
window.Utils = Utils;
