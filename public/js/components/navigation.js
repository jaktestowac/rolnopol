/**
 * Navigation Component
 * Manages application navigation and header updates
 */
class NavigationComponent {
  constructor() {
    this.navElement = null;
    this.authService = null;
    this.currentUser = null;
  }

  /**
   * Initialize the component
   * @param {App} app - Application instance
   */
  init(app) {
    this.eventBus = app.getEventBus();
    this.authService = app.getModule("authService");

    // Find the navigation container
    this.navElement = document.getElementById("app");
    if (!this.navElement) {
      return;
    }

    this._setupNavigation();
    this._setupEventListeners();
  }

  /**
   * Update navigation based on authentication status
   */
  async update() {
    if (!this.navElement) return;

    try {
      if (this.authService.isAuthenticated()) {
        const userData = await this.authService.getCurrentUser();
        this._renderAuthenticatedNav(userData);
      } else {
        this._renderUnauthenticatedNav();
      }
    } catch (error) {
      errorLogger.log("Navigation Update", error, { showToUser: false });
      this._renderUnauthenticatedNav();
    }
  }
  /**
   * Setup navigation element
   * @private
   */
  _setupNavigation() {
    // Setup user menu toggle functionality
    this._setupUserMenu();

    // Setup mobile menu toggle
    this._setupMobileMenu();

    // Initial navigation update
    this.update();
  }

  /**
   * Setup user menu functionality
   * @private
   */
  _setupUserMenu() {
    const userMenu = document.querySelector(".user-menu");
    const userMenuToggle = document.querySelector(".user-menu-toggle");

    if (userMenuToggle) {
      userMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        userMenu.classList.toggle("active");
      });

      // Close menu when clicking outside
      document.addEventListener("click", (e) => {
        if (!userMenu.contains(e.target)) {
          userMenu.classList.remove("active");
        }
      });
    }
  }

  /**
   * Setup mobile menu functionality
   * @private
   */
  _setupMobileMenu() {
    const mobileToggle = document.querySelector(".mobile-menu-toggle");
    const navbarNav = document.querySelector(".navbar-nav");

    if (mobileToggle && navbarNav) {
      mobileToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Toggle menu visibility
        navbarNav.classList.toggle("active");

        // Toggle hamburger animation
        mobileToggle.classList.toggle("active");

        // Update ARIA attributes for accessibility
        const isExpanded = navbarNav.classList.contains("active");
        mobileToggle.setAttribute("aria-expanded", isExpanded);
      });

      // Close menu when clicking outside
      document.addEventListener("click", (e) => {
        if (!mobileToggle.contains(e.target) && !navbarNav.contains(e.target)) {
          navbarNav.classList.remove("active");
          mobileToggle.classList.remove("active");
          mobileToggle.setAttribute("aria-expanded", "false");
        }
      });

      // Close menu when pressing Escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && navbarNav.classList.contains("active")) {
          navbarNav.classList.remove("active");
          mobileToggle.classList.remove("active");
          mobileToggle.setAttribute("aria-expanded", "false");
          mobileToggle.focus(); // Return focus to button
        }
      });

      // Close menu when clicking on a navigation link
      const navLinks = navbarNav.querySelectorAll(".nav-link");
      navLinks.forEach((link) => {
        link.addEventListener("click", () => {
          navbarNav.classList.remove("active");
          mobileToggle.classList.remove("active");
          mobileToggle.setAttribute("aria-expanded", "false");
        });
      });
    }
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Listen for auth state changes
    this.eventBus.on("auth:login", () => {
      this.update();
    });

    this.eventBus.on("auth:logout", () => {
      this.update();
    });
    this.eventBus.on("auth:sessionFound", () => {
      this.update();
    });

    // Listen for user updates to refresh navigation
    this.eventBus.on("user:updated", () => {
      this.update();
    });

    // Listen for page navigation events
    this.eventBus.on("page:navigate", (data) => {
      this._handlePageNavigation(data.page);
    });
  }

  /**
   * Render navigation for authenticated users
   * @private
   */
  _renderAuthenticatedNav(userData) {
    const username = userData.displayedName || userData.email || "User";

    this.navElement.innerHTML = `
      <span class="nav__welcome">
        Welcome, <span class="nav__username">${username}</span>
      </span>
      <button id="logout-btn" class="nav__button nav__button--logout">
        Logout
      </button>
      <button id="nav-toggle" class="nav__toggle" aria-label="Toggle navigation" aria-expanded="false">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
      <nav class="nav__menu" id="nav-menu">
        <a href="/index.html" class="nav__item">
          <i class="fa-solid fa-house"></i> Home
        </a>
        <a href="/profile.html" class="nav__item">
          <i class="fa-solid fa-user"></i> Profile
        </a>
        <a href="/financial.html" class="nav__item">
          <i class="fa-solid fa-coins"></i> Financial
        </a>
        <a href="/staff-fields.html" class="nav__item">
          <i class="fa-solid fa-tractor"></i> Staff & Fields
        </a>
        <a href="/marketplace.html" class="nav__item">
          <i class="fa-solid fa-store"></i> Marketplace
        </a>
        <a href="/alerts.html" class="nav__item">
          <i class="fa-solid fa-bell"></i> Alerts
        </a>
        <a href="/docs.html" class="nav__item">
          <i class="fa-solid fa-book"></i> Documentation
        </a>
      </nav>
    `;

    this._setupMenuHandlers();
    this._setupLogoutHandler();
  }

  /**
   * Render navigation for unauthenticated users
   * @private
   */
  _renderUnauthenticatedNav() {
    this.navElement.innerHTML = `
      <div class="nav__auth-buttons">
        <a href="/login.html" class="nav__button">Login</a>
        <a href="/register.html" class="nav__button nav__button--primary">Register</a>
      </div>
      <button id="nav-toggle" class="nav__toggle" aria-label="Toggle navigation" aria-expanded="false">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
      <nav class="nav__menu" id="nav-menu">
        <a href="/events.html" class="nav__item">
          <i class="fa-solid fa-calendar"></i> Events
        </a>
        <a href="/tools.html" class="nav__item">
          <i class="fa-solid fa-tools"></i> Tools
        </a>
        <a href="/docs.html" class="nav__item">
          <i class="fa-solid fa-book"></i> Documentation
        </a>
      </nav>
    `;

    this._setupMenuHandlers();
  }

  /**
   * Setup mobile menu toggle
   * @private
   */
  _setupMenuHandlers() {
    const toggle = document.getElementById("nav-toggle");
    const menu = document.getElementById("nav-menu");

    if (toggle && menu) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        menu.classList.toggle("nav__menu--open");
        toggle.classList.toggle("nav__toggle--active");

        // Update ARIA attributes for accessibility
        const isExpanded = menu.classList.contains("nav__menu--open");
        toggle.setAttribute("aria-expanded", isExpanded);
      });

      // Close menu when clicking outside
      document.addEventListener("click", (e) => {
        if (!toggle.contains(e.target) && !menu.contains(e.target)) {
          menu.classList.remove("nav__menu--open");
          toggle.classList.remove("nav__toggle--active");
          toggle.setAttribute("aria-expanded", "false");
        }
      });

      // Close menu when pressing Escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && menu.classList.contains("nav__menu--open")) {
          menu.classList.remove("nav__menu--open");
          toggle.classList.remove("nav__toggle--active");
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      });

      // Close menu when clicking on a navigation link
      const navLinks = menu.querySelectorAll(".nav__item");
      navLinks.forEach((link) => {
        link.addEventListener("click", () => {
          menu.classList.remove("nav__menu--open");
          toggle.classList.remove("nav__toggle--active");
          toggle.setAttribute("aria-expanded", "false");
        });
      });
    }
  }

  /**
   * Setup logout button handler
   * @private
   */
  _setupLogoutHandler() {
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();

        try {
          await this.authService.logout();
          window.location.href = "/";
        } catch (error) {
          errorLogger.log("Navigation Logout", error, { showToUser: false });
          // Force logout even if API call fails
          window.location.href = "/";
        }
      });
    }
  }

  /**
   * Handle page navigation events
   * @private
   */
  _handlePageNavigation(page) {
    // Update active navigation item
    const navItems = this.navElement.querySelectorAll(".nav__item");
    navItems.forEach((item) => {
      item.classList.remove("nav__item--active");
      if (item.getAttribute("href") === `/${page}.html`) {
        item.classList.add("nav__item--active");
      }
    });
  }
}

// Export for global use
window.NavigationComponent = NavigationComponent;
