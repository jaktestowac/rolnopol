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
      let storage, apiService, authService, featureFlagsService, notification, navigation, router;

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
        if (typeof FeatureFlagsService !== "undefined") {
          featureFlagsService = new FeatureFlagsService();
        } else {
          featureFlagsService = null;
        }
      } catch (error) {
        console.error("Failed to initialize FeatureFlagsService:", error);
        featureFlagsService = null;
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
        const usesDynamicHeader = ["marketplace", "financial", "financial-commodities", "staff-fields", "rolnopolmap"].includes(
          currentPage,
        );

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
      if (featureFlagsService) window.App.registerModule("featureFlagsService", featureFlagsService);
      if (notification) window.App.registerModule("notification", notification);
      if (navigation) window.App.registerModule("navigation", navigation);
      if (router) window.App.registerModule("router", router);

      // Initialize the application
      await window.App.init();

      // Setup global error handling (only if event bus is available)
      setupGlobalErrorHandling();

      // Setup page-specific initialization
      setupPageHandlers();

      // Setup global assistant chat widget (auth + feature-flag gated)
      initializeAssistantChatWidget();
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
      case "financial-commodities":
        setupFinancialCommoditiesPage();
        break;
      case "fieldmap":
        setupFieldMapPage();
        break;
      case "rolnopolmap":
        setupRolnopolMapPage();
        break;
      case "feature-flags":
        setupFeatureFlagsPage();
        break;
      case "chaos-engine":
        setupChaosEnginePage();
        break;
      case "messenger":
        setupMessengerPage();
        break;
      case "weather":
        setupWeatherPage();
        break;
      case "farmlog":
        setupFarmlogPage();
        break;
      case "farmlog-blog":
        setupFarmlogBlogPage();
        break;
      case "farmlog-post":
        setupFarmlogPostPage();
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
    const featureFlagsService = window.App.getModule("featureFlagsService");

    // Redirect if already authenticated
    if (authService && authService.isAuthenticated()) {
      window.location.href = "/profile.html";
      return;
    }

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
      const form = new FormComponent(registerForm);
      let strongPasswordEnabled = false;

      const eventBus = window.App.getEventBus();
      if (eventBus) {
        form.setEventBus(eventBus);
      }

      const configurePasswordValidation = async () => {
        const passwordField = document.getElementById("password");
        const passwordGuideline = document.getElementById("password-guideline");

        if (featureFlagsService) {
          strongPasswordEnabled = await featureFlagsService.isEnabled("registrationStrongPasswordEnabled", false);
        }

        if (passwordField) {
          passwordField.minLength = strongPasswordEnabled ? 8 : 3;
        }

        if (passwordGuideline) {
          passwordGuideline.textContent = strongPasswordEnabled
            ? "Password: Must be at least 8 characters and include uppercase, lowercase, number, and special character."
            : "Password: Must be at least 3 characters long.";
        }
      };

      // Add validation
      // Display name is optional; keep format validator if provided
      // form.addValidator(
      //   "displayedName",
      //   FormValidators.required("Display name is required"),
      // );
      form.addValidator("displayedName", FormValidators.displayName());
      form.addValidator("email", FormValidators.required("Email is required"));
      form.addValidator("email", FormValidators.email());
      form.addValidator("password", (value) => {
        if (!value) {
          return "Password is required";
        }

        if (strongPasswordEnabled) {
          if (value.length < 8) {
            return "Password must be at least 8 characters long";
          }

          const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
          if (!strongRegex.test(value)) {
            return "Password must include uppercase, lowercase, number, and special character";
          }

          return null;
        }

        if (value.length < 3) {
          return "Password must be at least 3 characters";
        }

        return null;
      });

      configurePasswordValidation().catch(() => {
        strongPasswordEnabled = false;
      });

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

  function setupFinancialCommoditiesPage() {
    const authService = window.App.getModule("authService");

    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    if (window.FinancialCommoditiesPage) {
      const financialCommoditiesPage = new FinancialCommoditiesPage();
      window.App.registerModule("financialCommoditiesPage", financialCommoditiesPage);
    } else {
      console.error("FinancialCommoditiesPage class not found");
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

  function setupFeatureFlagsPage() {
    if (window.FeatureFlagsPage) {
      const featureFlagsPage = new FeatureFlagsPage();
      window.App.registerModule("featureFlagsPage", featureFlagsPage);
    } else {
      console.error("FeatureFlagsPage class not found");
    }
  }

  function setupChaosEnginePage() {
    if (window.ChaosEnginePage) {
      const chaosEnginePage = new ChaosEnginePage();
      window.App.registerModule("chaosEnginePage", chaosEnginePage);
    } else {
      console.error("ChaosEnginePage class not found");
    }
  }

  function setupMessengerPage() {
    const authService = window.App.getModule("authService");

    if (!authService || !authService.requireAuth("/login.html")) {
      return;
    }

    if (window.MessengerPage) {
      const messengerPage = new MessengerPage();
      window.App.registerModule("messengerPage", messengerPage);
    } else {
      console.error("MessengerPage class not found");
    }
  }

  function setupWeatherPage() {
    if (window.WeatherPage) {
      const weatherPage = new WeatherPage();
      window.App.registerModule("weatherPage", weatherPage);
    } else {
      console.error("WeatherPage class not found");
    }
  }

  function setupFarmlogPage() {
    if (window.FarmlogHubPage) {
      const farmlogPage = new FarmlogHubPage();
      window.App.registerModule("farmlogPage", farmlogPage);
    } else {
      console.error("FarmlogHubPage class not found");
    }
  }

  function setupFarmlogBlogPage() {
    if (window.FarmlogBlogDetailPage) {
      const farmlogBlogPage = new FarmlogBlogDetailPage();
      window.App.registerModule("farmlogBlogPage", farmlogBlogPage);
    } else {
      console.error("FarmlogBlogDetailPage class not found");
    }
  }

  function setupFarmlogPostPage() {
    if (window.FarmlogPostDetailPage) {
      const farmlogPostPage = new FarmlogPostDetailPage();
      window.App.registerModule("farmlogPostPage", farmlogPostPage);
    } else {
      console.error("FarmlogPostDetailPage class not found");
    }
  }

  function setupDefaultPage() {
    const authService = window.App.getModule("authService");

    // Setup welcome message for authenticated users
    if (authService && authService.isAuthenticated()) {
      setupAuthenticatedWelcome();
    }
  }

  async function initializeAssistantChatWidget() {
    const authService = window.App.getModule("authService");
    const apiService = window.App.getModule("apiService");
    const storage = window.App.getModule("storage");

    if (!authService || !apiService) {
      return;
    }

    const currentPage = getCurrentPageName();
    if (currentPage === "login" || currentPage === "register" || Utils.isSwaggerPage()) {
      return;
    }

    if (!authService.isAuthenticated()) {
      return;
    }

    try {
      const flagsResponse = await apiService.get("feature-flags", { requiresAuth: true });
      const enabled = flagsResponse?.success && flagsResponse?.data?.data?.flags?.assistantChatEnabled === true;

      if (!enabled) {
        return;
      }

      if (document.getElementById("assistant-chat-widget")) {
        return;
      }

      const widget = document.createElement("div");
      widget.id = "assistant-chat-widget";
      widget.className = "assistant-chat-widget";
      widget.innerHTML = `
        <button type="button" id="assistant-chat-toggle" class="assistant-chat-widget__toggle" aria-expanded="false" aria-controls="assistant-chat-panel">
          🐷
          <span> Ask Porky, an AI Assistant!</span>
        </button>
        <section id="assistant-chat-panel" class="assistant-chat-widget__panel" aria-hidden="true">
          <header class="assistant-chat-widget__header">
            <div>
              <strong>🐷 Porky - AI Assistant</strong>
              <p>Ask about your fields, staff, and animals.</p>
            </div>
            <div class="assistant-chat-widget__header-buttons">
              <button type="button" id="assistant-chat-clear" class="assistant-chat-widget__clear" aria-label="Clear chat history" title="Clear all messages">
                <i class="fas fa-trash" aria-hidden="true"></i>
              </button>
              <button type="button" id="assistant-chat-close" class="assistant-chat-widget__close" aria-label="Close assistant chat">
                <i class="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
          </header>
          <div id="assistant-chat-messages" class="assistant-chat-widget__messages"></div>
          <form id="assistant-chat-form" class="assistant-chat-widget__form">
            <div id="assistant-chat-suggestions" class="assistant-chat-widget__suggestions" aria-hidden="true" role="listbox"></div>
            <input id="assistant-chat-input" class="assistant-chat-widget__input" type="text" maxlength="1024" aria-label="Assistant chat message" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required />
            <button type="submit" class="assistant-chat-widget__send">Send</button>
          </form>
          <div id="assistant-chat-clear-confirm" class="assistant-chat-widget__confirm" aria-hidden="true">
            <p class="assistant-chat-widget__confirm-text">Clear all chat messages? This action cannot be undone.</p>
            <div class="assistant-chat-widget__confirm-actions">
              <button type="button" id="assistant-chat-clear-cancel" class="assistant-chat-widget__confirm-btn assistant-chat-widget__confirm-btn--cancel">Cancel</button>
              <button type="button" id="assistant-chat-clear-accept" class="assistant-chat-widget__confirm-btn assistant-chat-widget__confirm-btn--danger">Clear</button>
            </div>
          </div>
        </section>
      `;

      document.body.appendChild(widget);

      const toggleButton = document.getElementById("assistant-chat-toggle");
      const panel = document.getElementById("assistant-chat-panel");
      const closeButton = document.getElementById("assistant-chat-close");
      const clearButton = document.getElementById("assistant-chat-clear");
      const messagesContainer = document.getElementById("assistant-chat-messages");
      const suggestionsContainer = document.getElementById("assistant-chat-suggestions");
      const form = document.getElementById("assistant-chat-form");
      const input = document.getElementById("assistant-chat-input");
      const clearConfirm = document.getElementById("assistant-chat-clear-confirm");
      const clearConfirmCancel = document.getElementById("assistant-chat-clear-cancel");
      const clearConfirmAccept = document.getElementById("assistant-chat-clear-accept");

      const userId = storage?.cookie?.get("rolnopolUserId");
      const canPersistState = typeof userId === "string" && userId.trim().length > 0;
      const chatStateStorageKey = canPersistState ? `rolnopol.assistantChat.state.v1.${userId}` : null;
      const chatSyncChannelName = canPersistState ? `rolnopol.assistantChat.sync.v1.${userId}` : null;
      const currentTabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let chatSyncChannel = null;

      if (chatSyncChannelName && "BroadcastChannel" in window) {
        try {
          chatSyncChannel = new BroadcastChannel(chatSyncChannelName);
        } catch (error) {
          chatSyncChannel = null;
        }
      }

      const normalizeStoredState = (payload) => {
        if (!payload || typeof payload !== "object") {
          return null;
        }

        const messages = Array.isArray(payload.messages)
          ? payload.messages
              .filter((item) => item && (item.role === "assistant" || item.role === "user") && typeof item.text === "string")
              .slice(-50)
          : [];

        return {
          isOpen: payload.isOpen === true,
          messages,
        };
      };

      const formatTime = (timestamp) => {
        if (!timestamp) return "";
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      };

      const readStoredState = () => {
        if (!canPersistState || !chatStateStorageKey) {
          return null;
        }

        try {
          const raw = window.localStorage.getItem(chatStateStorageKey);
          if (!raw) {
            return null;
          }

          const parsed = JSON.parse(raw);
          return normalizeStoredState(parsed);
        } catch (error) {
          return null;
        }
      };

      const writeStoredState = ({ isOpen, messages }, options = {}) => {
        if (!canPersistState || !chatStateStorageKey) {
          return;
        }

        const shouldBroadcast = options.broadcast !== false;
        const normalized = {
          isOpen: isOpen === true,
          messages: Array.isArray(messages) ? messages.slice(-50) : [],
        };

        try {
          window.localStorage.setItem(chatStateStorageKey, JSON.stringify(normalized));

          if (shouldBroadcast && chatSyncChannel) {
            chatSyncChannel.postMessage({
              type: "assistant-chat:state-sync",
              sourceTabId: currentTabId,
              payload: normalized,
            });
          }
        } catch (error) {
          // Ignore storage quota/private mode issues.
        }
      };

      const state = {
        isOpen: false,
        messages: [],
      };

      let clearConfirmResolve = null;

      const clearMessages = () => {
        state.messages = [];
        if (messagesContainer) {
          messagesContainer.innerHTML = "";
        }
        appendMessage("assistant", "Chat cleared. Hi! I'm Porky, your AI Assistant! Ask about your fields, staff, and animals.");
      };

      const commands = [
        { name: "/clear", description: "Clear all messages" },
        { name: "/status", description: "Get Porky's info and status" },
        { name: "/help", description: "Show available commands" },
        { name: "/alerts", description: "Get active farm alerts" },
        { name: "/docs <query>", description: "Ask Porky about app documentation" },
      ];

      const getHelpText = () => {
        const commandLines = commands.map((cmd) => `${cmd.name} - ${cmd.description}`).join("\n");
        return `📚 Available Commands:\n\n${commandLines}\n\nOr just ask me anything about your fields, animals, staff, finances, weather forecasts, commodities, marketplace, or farm alerts!`;
      };

      let currentVisibleCommands = [];
      let selectedSuggestionIndex = -1;

      const highlightSuggestion = () => {
        if (!suggestionsContainer) return;
        const items = Array.from(suggestionsContainer.querySelectorAll(".assistant-chat-widget__suggestion-item"));
        items.forEach((item, index) => {
          item.classList.toggle("assistant-chat-widget__suggestion-item--active", index === selectedSuggestionIndex);
        });
      };

      const showSuggestions = (filter = "") => {
        if (!suggestionsContainer) return;
        suggestionsContainer.innerHTML = "";
        const normalizedFilter = (filter || "").toLowerCase();
        currentVisibleCommands = commands.filter((cmd) => cmd.name.toLowerCase().startsWith(`/${normalizedFilter}`));

        if (!currentVisibleCommands.length) {
          suggestionsContainer.setAttribute("aria-hidden", "true");
          return;
        }

        selectedSuggestionIndex = -1;
        suggestionsContainer.setAttribute("aria-hidden", "false");

        currentVisibleCommands.forEach((cmd, index) => {
          const option = document.createElement("div");
          option.className = "assistant-chat-widget__suggestion-item";
          option.setAttribute("role", "option");
          option.innerHTML = `<strong>${cmd.name}</strong> <span class="assistant-chat-widget__suggestion-desc">${cmd.description}</span>`;
          option.addEventListener("click", () => {
            input.value = cmd.name;
            hideSuggestions();
            input.focus();
          });
          option.addEventListener("mouseenter", () => {
            selectedSuggestionIndex = index;
            highlightSuggestion();
          });
          suggestionsContainer.appendChild(option);
        });

        highlightSuggestion();
      };

      const hideSuggestions = () => {
        if (suggestionsContainer) {
          suggestionsContainer.setAttribute("aria-hidden", "true");
          suggestionsContainer.innerHTML = "";
        }
        currentVisibleCommands = [];
        selectedSuggestionIndex = -1;
      };

      const hideClearConfirmation = () => {
        if (!clearConfirm) {
          return;
        }
        clearConfirm.setAttribute("aria-hidden", "true");
      };

      const showClearConfirmation = () => {
        if (!clearConfirm || !clearConfirmAccept || !clearConfirmCancel) {
          return Promise.resolve(false);
        }

        clearConfirm.setAttribute("aria-hidden", "false");

        return new Promise((resolve) => {
          clearConfirmResolve = resolve;
          clearConfirmAccept.focus();
        });
      };

      const resolveClearConfirmation = (accepted) => {
        if (!clearConfirmResolve) {
          hideClearConfirmation();
          return;
        }

        const resolve = clearConfirmResolve;
        clearConfirmResolve = null;
        hideClearConfirmation();
        resolve(accepted === true);
      };

      const appendMessage = (role, text) => {
        if (!messagesContainer) return;
        const timestamp = new Date().toISOString();
        const item = document.createElement("div");
        item.className = `assistant-chat-widget__message assistant-chat-widget__message--${role}`;

        const textSpan = document.createElement("span");
        textSpan.textContent = text;

        const timeSpan = document.createElement("span");
        timeSpan.className = "assistant-chat-widget__message-time";
        timeSpan.textContent = formatTime(timestamp);

        item.appendChild(textSpan);
        item.appendChild(timeSpan);
        messagesContainer.appendChild(item);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        state.messages.push({ role, text, timestamp });
        writeStoredState(state);
        hideSuggestions();
      };

      const renderHistory = (messages) => {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = "";
        for (const message of messages) {
          const item = document.createElement("div");
          item.className = `assistant-chat-widget__message assistant-chat-widget__message--${message.role}`;

          const textSpan = document.createElement("span");
          textSpan.textContent = message.text;

          const timeSpan = document.createElement("span");
          timeSpan.className = "assistant-chat-widget__message-time";
          timeSpan.textContent = formatTime(message.timestamp);

          item.appendChild(textSpan);
          item.appendChild(timeSpan);
          messagesContainer.appendChild(item);
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      };

      const applySyncedState = (incomingState) => {
        const normalizedIncoming = normalizeStoredState(incomingState);
        if (!normalizedIncoming) {
          return;
        }

        state.isOpen = normalizedIncoming.isOpen;
        state.messages = [...normalizedIncoming.messages];
        renderHistory(state.messages);

        panel.classList.toggle("is-open", state.isOpen);
        panel.setAttribute("aria-hidden", state.isOpen ? "false" : "true");
        toggleButton.setAttribute("aria-expanded", state.isOpen ? "true" : "false");
      };

      const setOpen = (open) => {
        state.isOpen = open === true;
        panel.classList.toggle("is-open", open);
        panel.setAttribute("aria-hidden", open ? "false" : "true");
        toggleButton.setAttribute("aria-expanded", open ? "true" : "false");
        writeStoredState(state);
        if (open) {
          setTimeout(() => input?.focus(), 50);
        }
      };

      const storedState = readStoredState();
      if (storedState && storedState.messages.length > 0) {
        state.isOpen = storedState.isOpen;
        state.messages = [...storedState.messages];
        renderHistory(state.messages);
      } else {
        appendMessage(
          "assistant",
          "Hi! I'm Porky, your AI Assistant! I can summarize your private farm data. Try asking 'How are my fields doing?' or 'Tell me about animals.'",
        );
      }

      if (storedState?.isOpen === true) {
        setOpen(true);
      }

      if (canPersistState && chatStateStorageKey) {
        window.addEventListener("storage", (event) => {
          if (event.key !== chatStateStorageKey || !event.newValue) {
            return;
          }

          try {
            const nextState = JSON.parse(event.newValue);
            applySyncedState(nextState);
          } catch (error) {
            // Ignore malformed sync payload.
          }
        });
      }

      if (chatSyncChannel) {
        chatSyncChannel.onmessage = (event) => {
          const message = event?.data;
          if (!message || message.type !== "assistant-chat:state-sync") {
            return;
          }

          if (message.sourceTabId === currentTabId) {
            return;
          }

          applySyncedState(message.payload);
        };
      }

      toggleButton?.addEventListener("click", () => {
        const isOpen = panel.classList.contains("is-open");
        setOpen(!isOpen);
      });

      input?.addEventListener("input", () => {
        const value = (input.value || "").trim();
        if (value.startsWith("/")) {
          showSuggestions(value.slice(1));
        } else {
          hideSuggestions();
        }
      });

      input?.addEventListener("keydown", (event) => {
        if (!suggestionsContainer || suggestionsContainer.getAttribute("aria-hidden") === "true") {
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentVisibleCommands.length - 1);
          highlightSuggestion();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
          highlightSuggestion();
        } else if (event.key === "Enter") {
          if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < currentVisibleCommands.length) {
            event.preventDefault();
            const selected = currentVisibleCommands[selectedSuggestionIndex];
            if (selected) {
              input.value = selected.name;
              hideSuggestions();
            }
          }
        } else if (event.key === "Escape") {
          hideSuggestions();
        }
      });

      input?.addEventListener("focus", () => {
        const value = (input.value || "").trim();
        if (value.startsWith("/")) {
          showSuggestions(value.slice(1));
        }
      });

      input?.addEventListener("blur", () => {
        setTimeout(() => hideSuggestions(), 200);
      });

      closeButton?.addEventListener("click", () => setOpen(false));

      clearConfirmCancel?.addEventListener("click", () => {
        resolveClearConfirmation(false);
      });

      clearConfirmAccept?.addEventListener("click", () => {
        resolveClearConfirmation(true);
      });

      panel?.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && clearConfirm?.getAttribute("aria-hidden") === "false") {
          event.preventDefault();
          resolveClearConfirmation(false);
        }
      });

      clearButton?.addEventListener("click", async () => {
        const accepted = await showClearConfirmation();
        if (accepted) {
          clearMessages();
        }
      });

      form?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const message = (input?.value || "").trim();
        if (!message) {
          return;
        }

        // Handle /clear command
        if (message.toLowerCase() === "/clear") {
          input.value = "";
          const accepted = await showClearConfirmation();
          if (accepted) {
            clearMessages();
          }
          input.focus();
          return;
        }

        // Handle /status command
        if (message.toLowerCase() === "/status") {
          appendMessage("user", message);
          input.value = "";
          appendMessage(
            "assistant",
            "🐷 Porky - Rolnopol Farm Assistant\n\nCode Name: Porky\nSystem: Rolnopol AI Assistant v1.0\nPurpose: Farm management and decision support\n\nCapabilities: Fields, animals, staff, finances, weather, commodities, marketplace, alerts, and messaging.",
          );
          input.focus();
          return;
        }

        // Handle /help command
        if (message.toLowerCase() === "/help") {
          appendMessage("user", message);
          input.value = "";
          appendMessage("assistant", getHelpText());
          input.focus();
          return;
        }

        // Handle /alerts command
        if (message.toLowerCase() === "/alerts") {
          appendMessage("user", message);
          input.value = "";
          input.disabled = true;
          try {
            const alertsResponse = await apiService.get("alerts", { requiresAuth: true });
            if (alertsResponse?.success && alertsResponse?.data?.data) {
              const data = alertsResponse.data.data;
              const todayAlerts = (data.today?.alerts || []).map((a) => ({ ...a, dateLabel: "Today" }));
              const upcomingAlerts = (data.upcoming?.alerts || []).map((a) => ({ ...a, dateLabel: "Upcoming" }));
              const historyAlerts = (data.history || [])
                .flatMap((h) => (h.alerts || []).map((a) => ({ ...a, dateLabel: h.date })))
                .filter((a) => a);

              const allAlerts = [...todayAlerts, ...upcomingAlerts, ...historyAlerts];

              if (allAlerts.length === 0) {
                appendMessage("assistant", "✅ No active alerts. Your farm is looking good!");
              } else {
                const alertsList = allAlerts
                  .slice(0, 5)
                  .map((alert) => {
                    const dateLabel = alert.dateLabel ? ` (${alert.dateLabel})` : "";
                    const message = alert.message ? `\n   ${alert.message}` : "";
                    return `• [${alert.category.toUpperCase()}] ${alert.title}${dateLabel}${message}`;
                  })
                  .join("\n\n");
                const message = `⚠️ Farm Alerts (showing latest ${Math.min(allAlerts.length, 5)}):\n\n${alertsList}`;
                appendMessage("assistant", message);
              }
            } else {
              appendMessage("assistant", "Could not fetch alerts. Please try again.");
            }
          } catch (error) {
            console.error("Error fetching alerts:", error);
            appendMessage("assistant", "Error fetching alerts. Please try again.");
          } finally {
            input.disabled = false;
            input.focus();
          }
          return;
        }

        appendMessage("user", message);
        input.value = "";
        input.disabled = true;

        try {
          const response = await apiService.post("assistant-chat/messages", { message }, { requiresAuth: true, timeout: 20000 });

          if (!response?.success) {
            appendMessage("assistant", response?.error || "Sorry, I couldn't answer right now.");
            return;
          }

          const reply = response?.data?.data?.reply;
          appendMessage("assistant", reply || "I have no answer yet. Please try another question.");
        } catch (error) {
          appendMessage("assistant", "Something went wrong while contacting the assistant.");
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
    } catch (error) {
      // Keep page silent when feature-flag lookup fails.
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
