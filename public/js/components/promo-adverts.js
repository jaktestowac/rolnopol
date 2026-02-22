// Promo Adverts Component
// Displays page-specific promotional popups when feature flags are enabled

(function () {
  "use strict";

  // configuration for each supported page; delaySeconds is the default value used when
  // no min/max range is specified.  New properties `minDelaySeconds` and
  // `maxDelaySeconds` may be provided to randomise the popup delay within a range.
  const PROMO_CONFIG = {
    home: {
      flag: "promoAdvertsHomeEnabled",
      title: "Welcome to Rolnopol",
      // show the popup after at least 2s and at most 5s (randomised)
      minDelaySeconds: 2,
      maxDelaySeconds: 5,
      // legacy field, still supported for backwards compatibility
      delaySeconds: 3,
      cookieKey: "rolnopolPromoAdvertSeen_home",
      videoUrls: ["/images/rolnopol_ad2.mp4", "/images/rolnopol_ad3.mp4"],
      videoAlt: "Rolnopol Home Feature Demo",
    },
    alerts: {
      flag: "promoAdvertsAlertsEnabled",
      title: "Discover Rolnopol",
      // same min/max as above – you can adjust per page as needed
      minDelaySeconds: 2,
      maxDelaySeconds: 5,
      delaySeconds: 3,
      cookieKey: "rolnopolPromoAdvertSeen_alerts",
      videoUrl: "/images/rolnopol_ad2.mp4",
      videoAlt: "Rolnopol Alerts Feature Demo",
    },
  };

  /**
   * Get random item from array
   */
  function getRandomItem(array) {
    if (!Array.isArray(array) || array.length === 0) {
      return null;
    }
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Get video URL for promo config (randomly selected if multiple available)
   */
  function getVideoUrl(config) {
    if (!config) {
      return null;
    }
    // Prefer videoUrls array if available
    if (Array.isArray(config.videoUrls) && config.videoUrls.length > 0) {
      return getRandomItem(config.videoUrls);
    }
    // Fall back to single videoUrl
    return config.videoUrl || null;
  }

  /**
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop().split(";").shift();
    }
    return null;
  }

  /**
   * Set cookie with 15 minutes expiration
   */
  function setCookie(name, value) {
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() + 15 * 60 * 1000); // 15 minutes

    let cookieString = `${name}=${value}; path=/; expires=${expirationDate.toUTCString()}`;

    // Add SameSite attribute
    cookieString += "; SameSite=Lax";

    // Add Secure flag for HTTPS
    if (location.protocol === "https:") {
      cookieString += "; Secure";
    }

    document.cookie = cookieString;
  }

  /**
   * Get the current page key based on window location
   */
  function getCurrentPageKey() {
    const path = window.location.pathname;
    const page = window.location.pathname.split("/").pop();

    // Match common page patterns
    if (path === "/" || page === "index.html" || page === "") {
      return "home";
    }
    if (page.includes("alert")) {
      return "alerts";
    }
    if (page.includes("marketplace")) {
      return "marketplace";
    }
    if (page.includes("financial")) {
      return "financial";
    }
    if (page.includes("docs")) {
      return "docs";
    }

    return null;
  }

  /**
   * Check if promo has been shown in the last hour (via cookie)
   */
  function hasShownPromo(pageKey) {
    try {
      const cookieKey = PROMO_CONFIG[pageKey]?.cookieKey;
      if (!cookieKey) return false;
      return getCookie(cookieKey) === "true";
    } catch (e) {
      // Cookie read might fail
      return false;
    }
  }

  /**
   * Mark promo as shown for 1 hour (via cookie)
   */
  function markPromoShown(pageKey) {
    try {
      const cookieKey = PROMO_CONFIG[pageKey]?.cookieKey;
      if (cookieKey) {
        setCookie(cookieKey, "true");
      }
    } catch (e) {
      // Cookie write might fail
    }
  }

  /**
   * Create a custom modal for video promo
   */
  function createPromoModal(pageKey) {
    const existingModal = document.getElementById("promo-modal");
    if (existingModal) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = "promo-modal";
    modal.className = "promo-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Promotional Video");
    modal.innerHTML = `
      <div class="promo-modal__overlay"></div>
      <div class="promo-modal__content">
        <button class="promo-modal__close" type="button" aria-label="Close promotional popup">
          <i class="fas fa-times"></i>
        </button>
        <div class="promo-modal__header">
          <h2 class="promo-modal__title"></h2>
        </div>
        <div class="promo-modal__body">
          <video id="promo-video" class="promo-modal__video" controls width="100%" height="auto" preload="auto">
            Your browser does not support the video tag.
          </video>
        </div>
        <div class="promo-modal__footer">
          <button class="promo-modal__close-btn" type="button">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Wire up event listeners
    const closeBtn = modal.querySelector(".promo-modal__close");
    const closeBtnFooter = modal.querySelector(".promo-modal__close-btn");

    const hideModal = () => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      // Stop video playback when modal closes
      const videoEl = modal.querySelector("#promo-video");
      if (videoEl) {
        videoEl.pause();
      }
      // Mark promo as shown when user closes it
      if (pageKey) {
        markPromoShown(pageKey);
      }
    };

    if (closeBtn) {
      closeBtn.addEventListener("click", hideModal);
    }
    if (closeBtnFooter) {
      closeBtnFooter.addEventListener("click", hideModal);
    }

    // Allow escape key to close
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        hideModal();
      }
    };
    modal.addEventListener("keydown", handleEscape);
  }

  /**
   * Show promo modal with video
   */
  function showPromoModal(pageKey) {
    const config = PROMO_CONFIG[pageKey];
    if (!config) {
      console.warn(`No promo config found for page: ${pageKey}`);
      return;
    }

    createPromoModal(pageKey);
    const modal = document.getElementById("promo-modal");
    if (!modal) {
      return;
    }

    const titleEl = modal.querySelector(".promo-modal__title");
    const videoEl = modal.querySelector("#promo-video");

    if (titleEl) {
      titleEl.textContent = config.title;
    }

    if (videoEl) {
      // Clear existing sources
      videoEl.innerHTML = "";

      // Get video URL (randomly selected if multiple available)
      const videoUrl = getVideoUrl(config);
      if (!videoUrl) {
        console.warn(`No video URL configured for page: ${pageKey}`);
        return;
      }

      // Create and add source element
      const sourceEl = document.createElement("source");
      sourceEl.src = videoUrl;
      sourceEl.type = "video/mp4";
      videoEl.appendChild(sourceEl);

      // Reset video element so browser re-reads the source
      videoEl.load();
    }

    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");

    // Auto-focus close button for accessibility
    const closeBtn = modal.querySelector(".promo-modal__close-btn");
    if (closeBtn && typeof closeBtn.focus === "function") {
      closeBtn.focus();
    }
  }

  /**
   * Initialize promo adverts
   * Should be called after feature flags service is ready
   */
  async function initPromoAdverts() {
    try {
      // Get current page key
      const pageKey = getCurrentPageKey();
      if (!pageKey) {
        // Current page doesn't have a promo configured
        return;
      }

      const config = PROMO_CONFIG[pageKey];
      if (!config) {
        return;
      }

      // Check if already shown
      if (hasShownPromo(pageKey)) {
        return;
      }

      // Get feature flags service
      const featureFlagsService =
        window.App && typeof window.App.getModule === "function" ? window.App.getModule("featureFlagsService") : null;

      if (!featureFlagsService) {
        // Service not available, try waiting for it
        if (window.FeatureFlagsService && typeof window.FeatureFlagsService === "function") {
          try {
            const service = new window.FeatureFlagsService();
            if (typeof service.init === "function") {
              await service.init();
            }
            const isEnabled = service.isEnabled ? service.isEnabled(config.flag, false) : false;
            if (!isEnabled) {
              return;
            }
          } catch (e) {
            console.warn("Failed to check feature flag for promo", e);
            return;
          }
        } else {
          return;
        }
      } else {
        // Check if feature flag is enabled
        if (!featureFlagsService.isEnabled || !featureFlagsService.isEnabled(config.flag, false)) {
          return;
        }
      }

      // Mark as shown first to prevent multiple popups
      // Note: Cookie is actually set when user closes the modal, not when it appears

      // Delay showing the popup (could be fixed or randomised within a range)
      const delayMs = getDelayMs(config);
      setTimeout(() => {
        showPromoModal(pageKey);
      }, delayMs);
    } catch (error) {
      console.warn("Failed to initialize promo adverts", error);
    }
  }

  /**
   * Compute the delay in milliseconds based on configuration.
   * Supports:
   *  - `delaySeconds` (legacy fixed value)
   *  - `minDelaySeconds` + `maxDelaySeconds` (randomised range)
   * If invalid values are provided the default of 3000ms is used.
   */
  function getDelayMs(config) {
    if (!config) {
      return 3000;
    }

    // range form takes precedence
    if (typeof config.minDelaySeconds === "number" && typeof config.maxDelaySeconds === "number") {
      // ensure properly ordered and non-negative
      const min = Math.max(0, Math.min(config.minDelaySeconds, config.maxDelaySeconds));
      const max = Math.max(min, config.maxDelaySeconds);
      const rand = Math.random();
      // inclusive of both bounds
      const seconds = min + rand * (max - min);
      return Math.floor(seconds * 1000);
    }

    if (typeof config.delaySeconds === "number") {
      return config.delaySeconds * 1000;
    }

    return 3000;
  }

  // Export for external use in browser context
  if (typeof window !== "undefined") {
    window.initPromoAdverts = initPromoAdverts;
    window.showPromoModal = showPromoModal;
  }

  // expose helpers for unit tests (Node environment)
  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
      getRandomItem,
      getVideoUrl,
      getDelayMs,
    };
  }
})();
