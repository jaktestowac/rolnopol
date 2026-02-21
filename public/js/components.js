// Authentication utility functions for backward compatibility
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

// Global logout function that works with both old and new auth systems
function logout() {
  try {
    // Try to use the modular auth service if available
    if (window.App && window.App.getModule) {
      const authService = window.App.getModule("authService");
      if (authService) {
        authService
          .logout()
          .then(() => {
            updateHeaderNav();
            window.location.href = "/";
          })
          .catch((error) => {
            errorLogger.log("Auth Service Logout", error, {
              showToUser: false,
            });
            // Fallback to manual cleanup
            clearAuthCookies();
            updateHeaderNav();
            window.location.href = "/";
          });
        return;
      }
    }

    // Fallback logout
    clearAuthCookies();
    updateHeaderNav();
    window.location.href = "/";
  } catch (error) {
    errorLogger.log("Logout", error, { showToUser: false });
    // Force logout by clearing storage and redirecting
    clearAuthCookies();
    updateHeaderNav();
    window.location.href = "/";
  }
}

// Make logout function globally available
window.logout = logout;

async function loadComponent(elementId, componentPath) {
  try {
    const response = await fetch(componentPath);
    const html = await response.text();
    document.getElementById(elementId).innerHTML = html;
    return document.querySelector(".main-nav"); // Return nav element for chaining
  } catch (error) {
    errorLogger.log("Component Loading", error.message, { showToUser: false });
    return null;
  }
}

// Set active navigation link based on current page
function setActiveNavLink(explicitPage = null) {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll(".navbar-nav .nav-link");

  navLinks.forEach((link) => {
    link.classList.remove("active");
    const linkPath = link.getAttribute("href");
    const linkText = link.textContent.toLowerCase();

    // Handle explicit page identification
    if (explicitPage) {
      if (
        (explicitPage === "swagger" && (linkPath === "/swagger.html" || linkText.includes("api explorer"))) ||
        (explicitPage === "home" && linkPath === "/") ||
        (explicitPage === "profile" && linkPath === "/profile.html") ||
        (explicitPage === "login" && linkPath === "/login.html") ||
        (explicitPage === "register" && linkPath === "/register.html") ||
        (explicitPage === "docs" && linkPath === "/docs.html") ||
        (explicitPage === "admin" && linkPath === "/admin.html") ||
        (explicitPage === "backend" && linkPath === "/backend.html") ||
        (explicitPage === "financial" && linkPath === "/financial.html") ||
        (explicitPage === "fieldmap" && linkPath === "/fieldmap.html") ||
        (explicitPage === "rolnopolmap" && linkPath === "/rolnopolmap.html") ||
        (explicitPage === "feature-flags" && linkPath === "/feature-flags.html") ||
        (explicitPage === "messenger" && linkPath === "/messenger.html")
      ) {
        link.classList.add("active");
        return;
      }
    }

    // Handle different path scenarios
    if (
      currentPath === linkPath ||
      (currentPath === "/" && linkPath === "/") ||
      (currentPath === "/index.html" && linkPath === "/") ||
      (currentPath.endsWith(".html") && linkPath === currentPath)
    ) {
      link.classList.add("active");
    }
  });
}

async function getNavFeatureFlagState() {
  const featureFlagsService = window.App?.getModule?.("featureFlagsService");
  if (!featureFlagsService || typeof featureFlagsService.isEnabled !== "function") {
    return { alertsEnabled: true, rolnopolMapEnabled: true, messengerEnabled: false };
  }

  if (window.App && window.App.isInitialized === false) {
    return { alertsEnabled: false, rolnopolMapEnabled: false, messengerEnabled: false };
  }

  if (!featureFlagsService.apiService) {
    return { alertsEnabled: false, rolnopolMapEnabled: false, messengerEnabled: false };
  }

  try {
    const [alertsEnabled, rolnopolMapEnabled, messengerEnabled] = await Promise.all([
      featureFlagsService.isEnabled("alertsEnabled", true),
      featureFlagsService.isEnabled("rolnopolMapEnabled", true),
      featureFlagsService.isEnabled("messengerEnabled", false),
    ]);
    return { alertsEnabled, rolnopolMapEnabled, messengerEnabled };
  } catch (error) {
    return { alertsEnabled: true, rolnopolMapEnabled: true, messengerEnabled: false };
  }
}

const FEATURE_GATE_STORAGE_KEY = "rolnopolFeatureGateModal";

function createAppModal() {
  if (document.getElementById("app-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "app-modal";
  modal.id = "app-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-hidden", "true");
  modal.style.display = "none";

  modal.innerHTML = `
    <div class="app-modal__overlay" data-modal-close></div>
    <div class="app-modal__content" role="document">
      <div class="app-modal__header">
        <h2 class="app-modal__title"></h2>
        <button type="button" class="app-modal__close" aria-label="Close" data-modal-close>&times;</button>
      </div>
      <div class="app-modal__body"></div>
      <div class="app-modal__footer">
        <button type="button" class="btn app-modal__confirm" data-modal-close>OK</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.hasAttribute("data-modal-close")) {
      hideAppModal();
    }
  });

  document.body.appendChild(modal);
}

function showAppModal(options = {}) {
  createAppModal();
  const modal = document.getElementById("app-modal");
  if (!modal) {
    return;
  }

  const titleEl = modal.querySelector(".app-modal__title");
  const bodyEl = modal.querySelector(".app-modal__body");
  const confirmBtn = modal.querySelector(".app-modal__confirm");
  const title = options.title || "Notice";
  const message = options.message || "";
  const confirmText = options.confirmText || "OK";

  if (titleEl) {
    titleEl.textContent = title;
  }
  if (bodyEl) {
    bodyEl.textContent = message;
  }
  if (confirmBtn) {
    confirmBtn.textContent = confirmText;
  }

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  if (confirmBtn && typeof confirmBtn.focus === "function") {
    confirmBtn.focus();
  }
}

function hideAppModal() {
  const modal = document.getElementById("app-modal");
  if (!modal) {
    return;
  }
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

function queueFeatureGateModal(payload) {
  if (!payload || typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(FEATURE_GATE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Unable to store feature gate modal payload", error);
  }
}

function showQueuedFeatureGateModal() {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  const stored = sessionStorage.getItem(FEATURE_GATE_STORAGE_KEY);
  if (!stored) {
    return;
  }

  sessionStorage.removeItem(FEATURE_GATE_STORAGE_KEY);

  try {
    const payload = JSON.parse(stored);
    showAppModal({
      title: payload?.title || "Feature Unavailable",
      message: payload?.message || "This feature is currently disabled.",
      confirmText: payload?.confirmText || "OK",
    });
  } catch (error) {
    showAppModal({
      title: "Feature Unavailable",
      message: "This feature is currently disabled.",
      confirmText: "OK",
    });
  }
}

window.showAppModal = showAppModal;
window.queueFeatureGateModal = queueFeatureGateModal;
window.showQueuedFeatureGateModal = showQueuedFeatureGateModal;

async function updateHeaderNav(username = "") {
  const nav = document.querySelector(".navbar-nav");

  if (!nav) {
    console.log("Navigation element not found");
    return;
  }

  const { alertsEnabled, rolnopolMapEnabled, messengerEnabled } = await getNavFeatureFlagState();
  const mapLink = rolnopolMapEnabled
    ? '<li><a href="/rolnopolmap.html" class="nav-link" title="Rolnopol Map" aria-label="Rolnopol Map" data-testid="nav-map"><i class="fas fa-map"></i><span class="nav-text">Map</span></a></li>'
    : "";
  const alertsLink = alertsEnabled
    ? '<li><a href="/alerts.html" class="nav-link" title="Alerts" aria-label="Alerts" data-testid="nav-alerts"><i class="fas fa-bell"></i><span class="nav-text">Alerts</span></a></li>'
    : "";
  const messengerLink = messengerEnabled
    ? '<li><a href="/messenger.html" class="nav-link" title="Messenger" aria-label="Messenger" data-testid="nav-messenger"><i class="fas fa-comments"></i><span class="nav-text">Messenger</span></a></li>'
    : "";

  // Check authentication using standardized cookie names
  const token = getCookie("rolnopolToken");
  const isLogged = getCookie("rolnopolIsLogged");

  if (token && (isLogged === "true" || isLogged === true)) {
    // Logged in navigation
    nav.innerHTML = `
      <li><a href="/" class="nav-link" title="Home" aria-label="Home" data-testid="nav-home"><i class="fas fa-home"></i><span class="nav-text">Home</span></a></li>
      <li><a href="/staff-fields-main.html" class="nav-link" title="Staff & Fields Management" aria-label="Staff & Fields Management" data-testid="nav-staff-fields"><i class="fas fa-seedling"></i><span class="nav-text">Staff & Fields</span></a></li>
      <li><a href="/financial.html" class="nav-link" title="Financial Tracking" aria-label="Financial Tracking" data-testid="nav-financial"><i class="fas fa-coins"></i><span class="nav-text">Financial</span></a></li>
      <li><a href="/marketplace.html" class="nav-link" title="Marketplace" aria-label="Marketplace" data-testid="nav-marketplace"><i class="fas fa-store"></i><span class="nav-text">Marketplace</span></a></li>
      ${mapLink}
      ${alertsLink}
      ${messengerLink}
      <li><a href="/docs.html" class="nav-link" title="Documentation" aria-label="Documentation" data-testid="nav-docs"><i class="fas fa-book"></i><span class="nav-text">Docs</span></a></li>
      <li><a href="/swagger.html" class="nav-link" title="API Explorer (Swagger)" aria-label="API Explorer" data-testid="nav-api-explorer"><i class="fas fa-code"></i><span class="nav-text">API Explorer</span></a></li>
      <li class="nav-user" >
        <a href="/profile.html" class="nav-link" title="Profile" aria-label="Profile" data-testid="nav-profile"><i class="fas fa-user"></i><span class="nav-text-user-name">Welcome, ${
          username || "User"
        }</span></a>
        <button id="logout-btn" class="btn btn-secondary btn-sm" title="Logout" aria-label="Logout" data-testid="logout-btn"><i class="fas fa-sign-out-alt"></i><span class="nav-text">Logout</span></button>
      </li>
    `;

    // Setup logout functionality
    const logoutBtn = document.querySelector("#logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", logout);
    }
  } else {
    // Not logged in navigation
    nav.innerHTML = `
      <li><a href="/" class="nav-link" title="Home" aria-label="Home" data-testid="nav-home"><i class="fas fa-home"></i><span class="nav-text">Home</span></a></li>
      ${alertsLink}
      <li><a href="/docs.html" class="nav-link" title="Documentation" aria-label="Documentation" data-testid="nav-docs"><i class="fas fa-book"></i><span class="nav-text">Documentation</span></a></li>
      <li><a href="/swagger.html" class="nav-link" title="API Explorer (Swagger)" aria-label="API Explorer" data-testid="nav-api-explorer"><i class="fas fa-code"></i><span class="nav-text">API Explorer</span></a></li>
      <li><a href="/register.html" class="nav-link" title="Register" aria-label="Register" data-testid="nav-register"><i class="fas fa-user-plus"></i><span class="nav-text">Register</span></a></li>
      <li><a href="/login.html" class="nav-link" title="Login" aria-label="Login" data-testid="nav-login"><i class="fas fa-sign-in-alt"></i><span class="nav-text">Login</span></a></li>
    `;
  }

  // Set active link based on current page
  setActiveNavLink();
}

function setupMenuHandlers() {
  // Try new hamburger menu first
  const mobileToggle = document.querySelector("#mobile-menu-toggle");
  const navbarNav = document.querySelector("#navbar-nav");

  if (mobileToggle && navbarNav) {
    // Remove any existing event listeners
    const newMobileToggle = mobileToggle.cloneNode(true);
    mobileToggle.parentNode.replaceChild(newMobileToggle, mobileToggle);

    newMobileToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Toggle menu visibility
      navbarNav.classList.toggle("active");

      // Toggle hamburger animation
      newMobileToggle.classList.toggle("active");

      // Update ARIA attributes for accessibility
      const isExpanded = navbarNav.classList.contains("active");
      newMobileToggle.setAttribute("aria-expanded", isExpanded);
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!newMobileToggle.contains(e.target) && !navbarNav.contains(e.target)) {
        navbarNav.classList.remove("active");
        newMobileToggle.classList.remove("active");
        newMobileToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Close menu when pressing Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navbarNav.classList.contains("active")) {
        navbarNav.classList.remove("active");
        newMobileToggle.classList.remove("active");
        newMobileToggle.setAttribute("aria-expanded", "false");
        newMobileToggle.focus();
      }
    });

    // Close menu when clicking on navigation links
    const handleNavLinkClick = () => {
      navbarNav.classList.remove("active");
      newMobileToggle.classList.remove("active");
      newMobileToggle.setAttribute("aria-expanded", "false");
    };

    // Add event listeners to current nav links
    const addNavLinkListeners = () => {
      const navLinks = navbarNav.querySelectorAll(".nav-link");
      navLinks.forEach((link) => {
        link.addEventListener("click", handleNavLinkClick);
      });
    };

    // Add listeners to current nav links
    addNavLinkListeners();

    // Re-add listeners when navigation is updated
    const observer = new MutationObserver(() => {
      addNavLinkListeners();
    });
    observer.observe(navbarNav, { childList: true, subtree: true });

    return;
  }

  // Fallback to old menu system
  const menuButton = document.querySelector("#bars-icon-btn");
  const menu = document.querySelector(".nav-menu");

  if (!menuButton || !menu) {
    console.log("Menu elements not found");
    return;
  }

  // Remove any existing event listeners
  const newMenuButton = menuButton.cloneNode(true);
  menuButton.parentNode.replaceChild(newMenuButton, menuButton);

  newMenuButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.classList.toggle("active");
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !newMenuButton.contains(e.target)) {
      menu.classList.remove("active");
    }
  });
}

// Update initFooter function to load footer component
async function initFooter() {
  const footerContainer = document.getElementById("footer-component");
  if (footerContainer) {
    try {
      const response = await fetch("/components/footer.html");
      let footerHtml = await response.text();
      footerContainer.innerHTML = footerHtml;
      // Fetch version from API and inject into span
      let version = "";
      try {
        const versionRes = await fetch("/api/version");
        const versionData = await versionRes.json();
        version = versionData.version ? `v${versionData.version}` : "";
      } catch (e) {
        version = "";
      }
      const versionSpan = footerContainer.querySelector("#footer-version");
      if (versionSpan) {
        versionSpan.textContent = version;
      }

      // set current year
      const yearSpan = footerContainer.querySelector("#footer-year");
      if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
      }
    } catch (error) {
      errorLogger.log("Footer Component Loading", error, { showToUser: false });
      // Fallback footer if component fails to load
      footerContainer.innerHTML = `
        <footer class="footer">
          <p>&copy; ${new Date().getFullYear()} Rolnopol. build by <a href="https://jaktestowac.pl" target="_blank" rel="noopener">jaktestowac.pl</a> | <a href="https://aitesters.pl" target="_blank" rel="noopener" style="margin-left: 4px; margin-right: 4px; ">AI_Testers</a></p> 
        <span aria-hidden="true">|</span>
        <a href="https://github.com/jaktestowac" target="_blank" rel="noopener" aria-label="GitHub" data-testid="footer-github" class="footer-github-link" style="margin-left: 4px; margin-right: 4px; ">
          <i class="fab fa-github" aria-hidden="true"></i><span class="sr-only">GitHub</span>
        </a>
        <span aria-hidden="true">|</span>
        <a href="https://www.youtube.com/c/jaktestowac?sub_confirmation=1" target="_blank" rel="noopener" aria-label="YouTube" data-testid="footer-youtube" class="footer-youtube-link" style="margin-left: 4px; margin-right: 4px; ">
          <i class="fab fa-youtube" aria-hidden="true"></i><span class="sr-only">YouTube</span>
        </a>        <span aria-hidden="true">|</span>
        <a href="https://www.linkedin.com/company/jaktestowac" target="_blank" rel="noopener" aria-label="LinkedIn" data-testid="footer-linkedin" class="footer-linkedin-link" style="margin-left: 4px; margin-right: 4px; ">
          <i class="fab fa-linkedin" aria-hidden="true"></i><span class="sr-only">LinkedIn</span>
        </a>        </footer>
      `;
    }
  }
}

window.initComponents = async function () {
  await initFooter();
};
