/**
 * Main Application Entry Point
 * Initializes and configures all application modules
 */
(function () {
  "use strict";

  function getCurrentPageName() {
    const path = window.location.pathname;
    const page = path.split("/").pop().replace(".html", "") || "index";
    return page;
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
  } else {
    initializeApp();
  }

  async function initializeApp() {
    try {
      // Initialize core modules with error checking
      let storage, apiService, authService, notification, navigation, router;

      try {
        if (typeof Storage !== "undefined") {
          storage = new Storage();
        } else {
          console.error("Storage class not available");
          storage = null;
        }
      } catch (error) {
        console.error("Failed to initialize Storage:", error);
        storage = null;
      }

      try {
        if (typeof ApiService !== "undefined") {
          apiService = new ApiService();
        } else {
          console.error("ApiService class not available");
          apiService = null;
        }
      } catch (error) {
        console.error("Failed to initialize ApiService:", error);
        apiService = null;
      }

      try {
        if (typeof AuthService !== "undefined") {
          authService = new AuthService();
        } else {
          console.error("AuthService class not available");
          authService = null;
        }
      } catch (error) {
        console.error("Failed to initialize AuthService:", error);
        authService = null;
      }

      try {
        if (typeof NotificationComponent !== "undefined") {
          notification = new NotificationComponent();
        } else {
          console.log("NotificationComponent not available");
          notification = null;
        }
      } catch (error) {
        console.error("Failed to initialize NotificationComponent:", error);
        notification = null;
      }

      // Only try to create NavigationComponent if it's available and page doesn't use dynamic header/footer
      try {
        const currentPage = getCurrentPageName();
        const usesDynamicHeader = ["marketplace", "financial", "staff-fields", "rolnopolmap"].includes(currentPage);

        if (typeof NavigationComponent !== "undefined" && !usesDynamicHeader) {
          navigation = new NavigationComponent();
        } else if (usesDynamicHeader) {
          // console.log(`NavigationComponent skipped for ${currentPage} - using component-based navigation`);
          navigation = null;
        } else {
          // console.log('NavigationComponent not available - using component-based navigation');
          navigation = null;
        }
      } catch (error) {
        console.error("Failed to initialize NavigationComponent:", error);
        navigation = null;
      }

      try {
        if (typeof Router !== "undefined") {
          router = new Router();
        } else {
          console.log("Router not available");
          router = null;
        }
      } catch (error) {
        console.error("Failed to initialize Router:", error);
        router = null;
      }

      // Register all modules with the app (only if they were created successfully)
      if (storage) window.App.registerModule("storage", storage);
      if (apiService) window.App.registerModule("apiService", apiService);
      if (authService) window.App.registerModule("authService", authService);
      if (notification) window.App.registerModule("notification", notification);
      if (navigation) window.App.registerModule("navigation", navigation);
      if (router) window.App.registerModule("router", router);

      // Initialize the application
      await window.App.init();

      // Setup global error handling (only if event bus is available)
      setupGlobalErrorHandling();

      // Setup page-specific initialization
      setupPageHandlers();
    } catch (error) {
      errorLogger.logCritical("Application Initialization", error, {
        showToUser: false,
      });

      // Fallback error notification
      const fallbackNotification = document.createElement("div");
      fallbackNotification.className = "notification notification--error";
      fallbackNotification.textContent = "Application failed to initialize. Please refresh the page.";
      fallbackNotification.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        background: #dc3545;
        color: white;
        padding: 1rem;
        border-radius: 0.25rem;
        z-index: 9999;
      `;
      document.body.appendChild(fallbackNotification);
    }
  }
  function setupGlobalErrorHandling() {
    const eventBus = window.App.getEventBus();

    if (!eventBus) {
      console.warn("Event bus not available for global error handling");
      return;
    }

    // Handle API errors
    eventBus.on("api:error", (data) => {
      // Always log API errors
      errorLogger.logApiError("Global API", data.error, { showToUser: false });

      // Only redirect if NOT already on login page (robust check)
      const path = window.location.pathname.replace(/\/+ /g, "/");
      const isLoginPage = path === "/login.html" || path === "/login" || path.endsWith("/login.html") || path.endsWith("/login");

      if (data.error && (data.error.status === 401 || data.error.status === 403) && !isLoginPage) {
        // Clear authentication data
        const storage = window.App.getModule("storage");
        if (storage) {
          storage.cookie.remove("rolnopolToken");
          storage.cookie.remove("rolnopolUserLabel");
          storage.cookie.remove("rolnopolUsername");
          storage.cookie.remove("rolnopolIsLogged");
          storage.cookie.remove("rolnopolLoginTime");
          storage.cookie.remove("rolnopolUserId");
        }
        // Determine if on front page (index.html or /)
        const isFrontPage = ["/", "/index.html", "/index"].includes(window.location.pathname);
        if (isFrontPage) {
          window.location.reload();
        } else {
          // Redirect to login page
          window.location.href = "/login.html";
        }
      }

      // Notification is handled by NotificationComponent via api:error event
    });

    // Handle authentication logout events
    eventBus.on("auth:logout", (data) => {
      console.log("User logged out:", data?.reason || "unknown reason");
      // Redirect to login page if not already there
      if (window.location.pathname !== "/login.html") {
        window.location.href = "/login.html";
      }
    });

    // Handle unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      errorLogger.log("Unhandled Promise Rejection", event.reason, {
        showToUser: false,
      });

      // Check if it's an authentication error
      if (event.reason && event.reason.status && (event.reason.status === 401 || event.reason.status === 403)) {
        // Clear authentication data
        const storage = window.App.getModule("storage");
        if (storage) {
          storage.cookie.remove("rolnopolToken");
          storage.cookie.remove("rolnopolUserLabel");
          storage.cookie.remove("rolnopolUsername");
          storage.cookie.remove("rolnopolIsLogged");
          storage.cookie.remove("rolnopolLoginTime");
          storage.cookie.remove("rolnopolUserId");
        }
        // Determine if on front page (index.html or /)
        const isFrontPage = ["/", "/index.html", "/index"].includes(window.location.pathname);
        if (isFrontPage) {
          window.location.reload();
        } else {
          // Redirect to login page
          window.location.href = "/login.html";
        }
      }
    });
  }

  function setupPageHandlers() {
    const currentPage = getCurrentPageName();
    const eventBus = window.App.getEventBus();

    // Emit page load event if event bus is available
    if (eventBus) {
      eventBus.emit("page:load", { page: currentPage });
    }

    // Setup page-specific handlers
    switch (currentPage) {
      case "login":
        setupLoginPage();
        break;
      case "register":
        setupRegisterPage();
        break;
      case "profile":
        setupProfilePage();
        break;
      case "dashboard":
        setupDashboardPage();
        break;
      case "marketplace":
        setupMarketplacePage();
        break;
      case "financial":
        setupFinancialPage();
        break;
      case "fieldmap":
        setupFieldMapPage();
        break;
      case "rolnopolmap":
        setupRolnopolMapPage();
        break;
      default:
        setupDefaultPage();
    }
  }

  function setupLoginPage() {
    const authService = window.App.getModule("authService");

    // Redirect if already authenticated
    if (authService && authService.isAuthenticated()) {
      window.location.href = "/profile.html";
      return;
    }

    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      const form = new FormComponent(loginForm);
      const eventBus = window.App.getEventBus();
      if (eventBus) {
        form.setEventBus(eventBus);
      }

      // Add validation
      form.addValidator("email", FormValidators.required("Email is required"));
      form.addValidator("email", FormValidators.email());
      form.addValidator("password", FormValidators.required("Password is required"));

      // Handle submission
      form.onSubmit(async (data) => {
        try {
          // Map username->email if a legacy field sneaks in
          if (!data.email && data.username) data.email = data.username;
          await authService.login({ email: data.email, password: data.password });
          // Wait for authentication to be properly set before redirecting
          const isAuthenticated = await authService.waitForAuth(3000);
          if (isAuthenticated) {
            window.location.href = "/profile.html";
          } else {
            errorLogger.log("Authentication", "Authentication failed to set properly", { showToUser: true });
          }
        } catch (error) {
          // Error is handled by FormComponent and ErrorLogger automatically
        }
      });
    }
  }

  function setupRegisterPage() {
    const authService = window.App.getModule("authService");

    // Redirect if already authenticated
    if (authService && authService.isAuthenticated()) {
      window.location.href = "/profile.html";
      return;
    }

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
      const form = new FormComponent(registerForm);
      const eventBus = window.App.getEventBus();
      if (eventBus) {
        form.setEventBus(eventBus);
      }
      // Add validation
      // Display name is optional; keep format validator if provided
      // form.addValidator(
      //   "displayedName",
      //   FormValidators.required("Display name is required"),
      // );
      form.addValidator("displayedName", FormValidators.displayName());
      form.addValidator("email", FormValidators.required("Email is required"));
      form.addValidator("email", FormValidators.email());
      form.addValidator("password", FormValidators.required("Password is required"));
      form.addValidator("password", FormValidators.minLength(3));
      // Handle submission
      form.onSubmit(async (data) => {
        try {
          const payload = {
            email: data.email,
            displayedName: (data.displayedName || "").trim() || undefined,
            password: data.password,
          };
          await authService.register(payload);
          setTimeout(() => {
            window.location.href = "/login.html";
          }, 2000);
        } catch (error) {
          // Error is handled by FormComponent and ErrorLogger automatically
        }
      });
    }
  }
  function setupProfilePage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    // Initialize ProfilePage module if it exists
    if (window.ProfilePage) {
      const profilePage = new ProfilePage();
      // Registering after App.init will auto-call module.init(app)
      window.App.registerModule("profilePage", profilePage);
    } else {
      // Fallback to original profile loading
      loadProfileData();
    }
  }

  function setupDashboardPage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    // Load dashboard data
    loadDashboardData();
  }

  function setupMarketplacePage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    // Initialize MarketplacePage module if it exists
    if (window.MarketplacePage) {
      const marketplacePage = new MarketplacePage();
      // Registering after App.init will auto-call module.init(app)
      window.App.registerModule("marketplacePage", marketplacePage);
    } else {
      console.error("MarketplacePage class not found");
    }
  }

  function setupFinancialPage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    // Initialize FinancialPage module if it exists
    if (window.FinancialPage) {
      const financialPage = new FinancialPage();
      // Registering after App.init will auto-call module.init(app)
      window.App.registerModule("financialPage", financialPage);
    }
  }

  function setupFieldMapPage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    if (window.FieldMapPage) {
      const fieldMapPage = new FieldMapPage();
      // Registering after App.init will auto-call module.init(app)
      window.App.registerModule("fieldMapPage", fieldMapPage);
    } else {
      console.error("FieldMapPage class not found");
    }
  }

  function setupRolnopolMapPage() {
    const authService = window.App.getModule("authService");

    // Require authentication
    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    if (window.RolnopolMap) {
      const rolnopolMapPage = new RolnopolMap();
      // Registering after App.init will auto-call module.init(app)
      window.App.registerModule("rolnopolMapPage", rolnopolMapPage);
    } else {
      console.error("RolnopolMap class not found");
    }
  }

  function setupDefaultPage() {
    const authService = window.App.getModule("authService");

    // Setup welcome message for authenticated users
    if (authService && authService.isAuthenticated()) {
      setupAuthenticatedWelcome();
    }
  }

  async function loadProfileData() {
    try {
      const authService = window.App.getModule("authService");
      const userData = await authService.getCurrentUser();

      // Update profile display
      updateProfileDisplay(userData);
    } catch (error) {
      errorLogger.log("Profile Data Loading", error, { showToUser: false });
    }
  }

  async function loadDashboardData() {
    try {
      const authService = window.App.getModule("authService");
      const userData = await authService.getCurrentUser();

      // Update dashboard display
      updateDashboardDisplay(userData);
    } catch (error) {
      errorLogger.log("Dashboard Data Loading", error, { showToUser: false });
    }
  }

  function updateProfileDisplay(userData) {
    const elements = {
      username: document.getElementById("profile-username"),
      userId: document.getElementById("profile-user-id"),
      email: document.getElementById("profile-email"),
    };

    if (elements.username) elements.username.textContent = userData.displayedName || userData.email;
    if (elements.userId) elements.userId.textContent = userData.userId || userData.id;
    if (elements.email) elements.email.textContent = userData.email;
  }

  function updateDashboardDisplay(userData) {
    const welcomeElement = document.getElementById("dashboard-welcome");
    if (welcomeElement) {
      welcomeElement.textContent = `Welcome back, ${userData.displayedName || userData.email}!`;
    }
  }

  function setupAuthenticatedWelcome() {
    // Add authenticated user features to index page
    const authService = window.App.getModule("authService");

    authService
      .getCurrentUser()
      .then((userData) => {
        const mainContent = document.querySelector(".welcome-section");
        if (mainContent) {
          const welcomeMessage2 = document.querySelector(".welcome-message");
          if (welcomeMessage2) {
            welcomeMessage2.remove();
          }
          const welcomeMessage = document.createElement("p");
          welcomeMessage.className = "welcome-message";
          welcomeMessage.innerHTML = `Welcome back, <strong>${userData.displayedName || userData.email}</strong>!`;
          mainContent.appendChild(welcomeMessage);
        }
      })
      .catch((error) => {
        errorLogger.log("User Data Loading", error, { showToUser: false });
      });
  }
})();
