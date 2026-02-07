// Authentication utility functions
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop().split(";").shift();
  }
  return null;
}

function clearAuthCookies() {
  const cookiesToClear = [
    "rolnopolToken",
    "rolnopolIsLogged",
    "rolnopolLoginTime",
    "rolnopolUserLabel",
    "rolnopolUsername",
    "rolnopolUserId",
  ];
  cookiesToClear.forEach((cookieName) => {
    document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT`;
  });
}

function getToken() {
  const token = getCookie("rolnopolToken");
  if (!token) {
    return null;
  }
  // Handle token encoding if needed
  try {
    return decodeURIComponent(token);
  } catch (e) {
    return token;
  }
}

async function getUserInfo() {
  try {
    // Try to use the modular API service if available
    if (window.App && window.App.getModule) {
      const authService = window.App.getModule("authService");
      if (authService) {
        return await authService.getCurrentUser();
      }
    }

    // Fallback to direct API call
    const token = getToken();
    if (!token) {
      throw new Error("No authentication token available");
    }

    const response = await fetch("/api/v1/authorization", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        token: token,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to get user info");
    }

    return result.data?.data || result.data;
  } catch (error) {
    console.error("getUserInfo failed:", error);
    throw error;
  }
}

/**
 * System migration has been completed on the backend.
 * The backend now handles token clearing on startup, so we don't need to clear cookies on the frontend.
 * This prevents the issue where authentication cookies were being cleared on every page load.
 */

document.addEventListener("DOMContentLoaded", async function () {
  // Initialize components using global function
  window.initComponents();

  const nav = await loadComponent("header-component", "/components/header.html");

  if (nav) {
    // Check authentication status using standardized cookie names
    const token = getCookie("rolnopolToken");
    const isLogged = getCookie("rolnopolIsLogged");
    const username = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");

    if (token && (isLogged === "true" || isLogged === true)) {
      try {
        // Try to get user info from the API
        const userData = await getUserInfo();
        await updateHeaderNav(userData.displayedName || userData.email || username || "User");

        // Add dashboard navigation for logged-in users on index page
        if (window.location.pathname === "/" || window.location.pathname === "/index.html") {
          const mainContent = document.querySelector(".landing-content");
          // You can add logged-in user specific content here
        }
      } catch (error) {
        console.error("Failed to get user info:", error);
        // If API call fails but we have cookies, still show logged-in nav
        await updateHeaderNav(username || "User");
      }
    } else {
      // Clear any stale cookies if token is missing but isLogged exists
      if (!token && isLogged) {
        clearAuthCookies();
      }

      await updateHeaderNav();
    }

    if (typeof setupMenuHandlers === "function") {
      setupMenuHandlers();
    }

    if (typeof showQueuedFeatureGateModal === "function") {
      showQueuedFeatureGateModal();
    }

    const wireAppInitSync = () => {
      const eventBus = window.App?.getEventBus?.();
      if (eventBus && window.App && window.App.isInitialized === false) {
        eventBus.on("app:initialized", async () => {
          const tokenAfterInit = getCookie("rolnopolToken");
          const isLoggedAfterInit = getCookie("rolnopolIsLogged");
          const usernameAfterInit = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");
          if (tokenAfterInit && (isLoggedAfterInit === "true" || isLoggedAfterInit === true)) {
            try {
              const userData = await getUserInfo();
              await updateHeaderNav(userData.displayedName || userData.email || usernameAfterInit || "User");
            } catch (error) {
              console.error("Failed to get user info after init:", error);
              await updateHeaderNav(usernameAfterInit || "User");
            }
          } else {
            await updateHeaderNav();
          }
          if (typeof setupMenuHandlers === "function") {
            setupMenuHandlers();
          }
        });
      } else if (window.App && window.App.isInitialized === false) {
        let attempts = 0;
        const maxAttempts = 1200;
        const pollForInit = async () => {
          attempts += 1;
          if (window.App.isInitialized) {
            const tokenAfterInit = getCookie("rolnopolToken");
            const isLoggedAfterInit = getCookie("rolnopolIsLogged");
            const usernameAfterInit = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");
            if (tokenAfterInit && (isLoggedAfterInit === "true" || isLoggedAfterInit === true)) {
              try {
                const userData = await getUserInfo();
                await updateHeaderNav(userData.displayedName || userData.email || usernameAfterInit || "User");
              } catch (error) {
                console.error("Failed to get user info after init:", error);
                await updateHeaderNav(usernameAfterInit || "User");
              }
            } else {
              await updateHeaderNav();
            }
            if (typeof setupMenuHandlers === "function") {
              setupMenuHandlers();
            }
            return;
          }
          if (attempts < maxAttempts) {
            const delay = attempts < 40 ? 50 : 200;
            setTimeout(pollForInit, delay);
          } else {
            console.warn("Navigation sync skipped: app initialization timed out.");
          }
        };
        pollForInit();
      }
    };

    let authListenersBound = false;
    let authListenerAttempts = 0;
    let authListenerRetryScheduled = false;
    let authListenerWarned = false;
    const bindAuthListeners = () => {
      if (authListenersBound) {
        return;
      }
      const eventBus = window.App?.getEventBus?.();
      if (!eventBus) {
        if (!authListenerRetryScheduled && authListenerAttempts < 400) {
          authListenerRetryScheduled = true;
          const delay = authListenerAttempts < 40 ? 50 : 200;
          setTimeout(() => {
            authListenerRetryScheduled = false;
            authListenerAttempts += 1;
            bindAuthListeners();
          }, delay);
        } else if (!authListenerWarned && authListenerAttempts >= 400) {
          authListenerWarned = true;
          console.warn("Auth listeners skipped: event bus unavailable.");
        }
        return;
      }

      authListenersBound = true;
      eventBus.on("auth:login", (data) => {
        console.log("User logged in, updating navigation");
        updateHeaderNav(data.user?.displayedName || data.user?.email || "User");
      });

      eventBus.on("auth:logout", () => {
        console.log("User logged out, updating navigation");
        updateHeaderNav();
      });

      eventBus.on("auth:sessionFound", async () => {
        try {
          const authService = window.App.getModule("authService");
          if (authService) {
            const userData = await authService.getCurrentUser();
            await updateHeaderNav(userData.displayedName || userData.email || "User");
          }
        } catch (error) {
          console.error("Failed to get user data on session found:", error);
        }
      });
    };

    if (window.App) {
      wireAppInitSync();
      bindAuthListeners();
    } else {
      let attempts = 0;
      const maxAttempts = 1200;
      const waitForApp = () => {
        attempts += 1;
        if (window.App) {
          wireAppInitSync();
          bindAuthListeners();
          return;
        }
        if (attempts < maxAttempts) {
          const delay = attempts < 40 ? 50 : 200;
          setTimeout(waitForApp, delay);
        } else {
          console.warn("Auth listeners skipped: app did not initialize in time.");
        }
      };
      waitForApp();
    }
  }
});
