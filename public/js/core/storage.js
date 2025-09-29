/**
 * Storage utility for managing cookies and local storage
 * Provides a unified interface for client-side storage
 */
class Storage {
  constructor() {
    this.cookieDefaults = {
      path: "/",
      sameSite: "Lax",
      secure: window.location.protocol === "https:",
    };
  }

  /**
   * Cookie Management
   */
  cookie = {
    get: (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) {
        const encodedValue = parts.pop().split(";").shift();
        return name === "rolnopolToken"
          ? this._decodeToken(encodedValue)
          : encodedValue;
      }
      return null;
    },

    set: (name, value, options = {}) => {
      const config = { ...this.cookieDefaults, ...options };
      const cookieValue =
        name === "rolnopolToken" ? this._encodeToken(value) : value;

      let cookieString = `${name}=${cookieValue}`;

      Object.entries(config).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          cookieString += `; ${key}`;
          if (val !== true) {
            cookieString += `=${val}`;
          }
        }
      });

      document.cookie = cookieString;
    },

    remove: (name) => {
      this.cookie.set(name, "", { expires: "Thu, 01 Jan 1970 00:00:01 GMT" });
    },

    clear: () => {
      const cookies = [
        "rolnopolToken",
        "rolnopolIsLogged",
        "rolnopolLoginTime",
        "rolnopolUserLabel",
        "rolnopolUsername",
        "rolnopolUserId",
      ];
      cookies.forEach((name) => this.cookie.remove(name));
    },
  };

  /**
   * Local Storage Management
   */
  local = {
    get: (key) => {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("LocalStorage Read", error, { showToUser: false });
        } else {
          console.error("LocalStorage Read Error:", error);
        }
        return null;
      }
    },

    set: (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("LocalStorage Write", error, { showToUser: false });
        } else {
          console.error("LocalStorage Write Error:", error);
        }
        return false;
      }
    },

    remove: (key) => {
      localStorage.removeItem(key);
    },

    clear: () => {
      localStorage.clear();
    },
  };

  /**
   * Session Storage Management
   */
  session = {
    get: (key) => {
      try {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("SessionStorage Read", error, { showToUser: false });
        } else {
          console.error("SessionStorage Read Error:", error);
        }
        return null;
      }
    },

    set: (key, value) => {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("SessionStorage Write", error, { showToUser: false });
        } else {
          console.error("SessionStorage Write Error:", error);
        }
        return false;
      }
    },

    remove: (key) => {
      sessionStorage.removeItem(key);
    },

    clear: () => {
      sessionStorage.clear();
    },
  };

  /**
   * Token encoding/decoding (maintains compatibility with existing system)
   * @private
   */
  _encodeToken(token) {
    return encodeURIComponent(token);
  }

  _decodeToken(token) {
    return decodeURIComponent(token);
  }
}

// Export for global use
window.Storage = Storage;
