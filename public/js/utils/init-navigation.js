// Centralized navigation and header/footer loader
// Usage: initNavigation('home' | 'login' | 'register' | 'profile' | ...)

function initNavigation(activeNavKey) {
  document.addEventListener("DOMContentLoaded", async function () {
    // Load the header component
    const headerElement = document.getElementById("header-component");
    if (headerElement) {
      try {
        const response = await fetch("/components/header.html");
        const html = await response.text();
        headerElement.innerHTML = html;

        // Initialize navigation after header is loaded
        if (typeof updateHeaderNav === "function") {
          // Check authentication status using standardized cookie names
          const token = getCookie("rolnopolToken");
          const isLogged = getCookie("rolnopolIsLogged");
          const username = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");
          if (token && (isLogged === "true" || isLogged === true)) {
            try {
              const userData = await getUserInfo();
              updateHeaderNav(userData.displayedName || userData.email || username || "User");
            } catch (error) {
              if (typeof errorLogger !== "undefined") {
                errorLogger.log("User Info Loading", error, {
                  showToUser: false,
                });
              }
              updateHeaderNav(username || "User");
            }
          } else {
            updateHeaderNav();
          }

          // Set active navigation link for the current page
          if (typeof setActiveNavLink === "function" && activeNavKey) {
            setActiveNavLink(activeNavKey);
          }

          // Setup mobile menu handlers
          if (typeof setupMenuHandlers === "function") {
            setupMenuHandlers();
          }
        }
      } catch (error) {
        if (typeof errorLogger !== "undefined") {
          errorLogger.log("Header Component Loading", error, {
            showToUser: false,
          });
        }
      }
    }

    // Load the footer component
    if (typeof initFooter === "function") {
      await initFooter();
    }
  });
}

// Helper function to get cookie (if not already globally available)
if (typeof getCookie === "undefined") {
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }
}
