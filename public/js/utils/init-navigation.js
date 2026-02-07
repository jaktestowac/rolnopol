// Centralized navigation and header/footer loader
// Usage: initNavigation('home' | 'login' | 'register' | 'profile' | ...)

function initNavigation(activeNavKey) {
  document.addEventListener("DOMContentLoaded", async function () {
    const loadScriptOnce = (src) => {
      if (!src) {
        return Promise.reject(new Error("Script source is required"));
      }

      const registryKey = "__rolnopolScriptPromises";
      window[registryKey] = window[registryKey] || {};

      if (window[registryKey][src]) {
        return window[registryKey][src];
      }

      window[registryKey][src] = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing && existing.dataset.loaded === "true") {
          resolve();
          return;
        }

        const script = existing || document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.loaded = "false";
        script.addEventListener("load", () => {
          script.dataset.loaded = "true";
          resolve();
        });
        script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));

        if (!existing) {
          document.head.appendChild(script);
        }
      });

      return window[registryKey][src];
    };

    const ensureFeatureFlagsService = async () => {
      if (!window.App || typeof window.App.getModule !== "function") {
        return;
      }

      if (window.App.getModule("featureFlagsService")) {
        return;
      }

      if (typeof FeatureFlagsService === "undefined") {
        try {
          await loadScriptOnce("/js/services/feature-flags-service.js");
        } catch (error) {
          console.warn("Feature flags script failed to load", error);
          return;
        }
      }

      if (typeof FeatureFlagsService === "undefined") {
        return;
      }

      const service = new FeatureFlagsService();
      window.App.registerModule("featureFlagsService", service);
      if (window.App.isInitialized && typeof service.init === "function") {
        await service.init(window.App);
      }
    };

    async function syncHeaderNav() {
      await ensureFeatureFlagsService();
      if (typeof updateHeaderNav !== "function") {
        return;
      }

      const token = getCookie("rolnopolToken");
      const isLogged = getCookie("rolnopolIsLogged");
      const username = getCookie("rolnopolUserLabel") || getCookie("rolnopolUsername");

      if (token && (isLogged === "true" || isLogged === true)) {
        try {
          const userData = await getUserInfo();
          await updateHeaderNav(userData.displayedName || userData.email || username || "User");
        } catch (error) {
          if (typeof errorLogger !== "undefined") {
            errorLogger.log("User Info Loading", error, {
              showToUser: false,
            });
          }
          await updateHeaderNav(username || "User");
        }
      } else {
        await updateHeaderNav();
      }

      if (typeof setActiveNavLink === "function" && activeNavKey) {
        setActiveNavLink(activeNavKey);
      }

      if (typeof setupMenuHandlers === "function") {
        setupMenuHandlers();
      }
    }

    // Load the header component
    const headerElement = document.getElementById("header-component");
    if (headerElement) {
      try {
        const response = await fetch("/components/header.html");
        const html = await response.text();
        headerElement.innerHTML = html;

        // Initialize navigation after header is loaded
        await syncHeaderNav();

        if (typeof showQueuedFeatureGateModal === "function") {
          showQueuedFeatureGateModal();
        }

        const wireAppInitSync = () => {
          const eventBus = window.App?.getEventBus?.();
          if (eventBus && window.App && window.App.isInitialized === false) {
            eventBus.on("app:initialized", async () => {
              await syncHeaderNav();
            });
          } else if (window.App && window.App.isInitialized === false) {
            let attempts = 0;
            const maxAttempts = 1200;
            const pollForInit = async () => {
              attempts += 1;
              if (window.App.isInitialized) {
                await syncHeaderNav();
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

        if (window.App) {
          wireAppInitSync();
        } else {
          let attempts = 0;
          const maxAttempts = 400;
          const waitForApp = () => {
            attempts += 1;
            if (window.App) {
              wireAppInitSync();
              return;
            }
            if (attempts < maxAttempts) {
              const delay = attempts < 40 ? 50 : 200;
              setTimeout(waitForApp, delay);
            } else {
              console.warn("Navigation sync skipped: app instance not found.");
            }
          };
          waitForApp();
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
