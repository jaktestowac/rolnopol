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

  const nav = await loadComponent(
    "header-component",
    "/components/header.html",
  );

  if (nav) {
    // Check authentication status using standardized cookie names
    const token = getCookie("rolnopolToken");
    const isLogged = getCookie("rolnopolIsLogged");
    const username = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");

    if (token && (isLogged === "true" || isLogged === true)) {
      try {
        // Try to get user info from the API
        const userData = await getUserInfo();
        updateHeaderNav(
          userData.displayedName || userData.email || username || "User",
        );

        // Add dashboard navigation for logged-in users on index page
        if (
          window.location.pathname === "/" ||
          window.location.pathname === "/index.html"
        ) {
          const mainContent = document.querySelector(".landing-content");
          // You can add logged-in user specific content here
        }
      } catch (error) {
        console.error("Failed to get user info:", error);
        // If API call fails but we have cookies, still show logged-in nav
        updateHeaderNav(username || "User");
      }
    } else {
      // Clear any stale cookies if token is missing but isLogged exists
      if (!token && isLogged) {
        clearAuthCookies();
      }

      updateHeaderNav();
    }
  }

  // Listen for authentication events from the modular system
  if (window.App && window.App.getEventBus) {
    const eventBus = window.App.getEventBus();

    eventBus.on("auth:login", (data) => {
      console.log("User logged in, updating navigation");
      updateHeaderNav(
        data.user?.displayedName || data.user?.email || "User",
      );
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
          updateHeaderNav(
            userData.displayedName || userData.email || "User",
          );
        }
      } catch (error) {
        console.error("Failed to get user data on session found:", error);
      }
    });
  }
});
