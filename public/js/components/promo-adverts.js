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
      minDelaySeconds: 2,
      maxDelaySeconds: 5,
      delaySeconds: 3,
      cookieKey: "rolnopolPromoAdvertSeen_home",
      videoUrls: [
        { url: "/images/rolnopol_ad2.mp4", title: "Welcome to Rolnopol" },
        { url: "/images/rolnopol_ad3.mp4", title: "Welcome to Rolnopol" },
      ],
      videoAlt: "Rolnopol Home Feature Demo",
    },
    alerts: {
      flag: "promoAdvertsAlertsEnabled",
      title: "Discover Rolnopol",
      minDelaySeconds: 2,
      maxDelaySeconds: 5,
      delaySeconds: 3,
      cookieKey: "rolnopolPromoAdvertSeen_alerts",
      videoUrl: "/images/rolnopol_ad2.mp4",
      videoAlt: "Rolnopol Alerts Feature Demo",
    },
    general: {
      flag: "promoAdvertsGeneralAdEnabled",
      title: "Discover Rolnopol Features",
      minDelaySeconds: 3,
      maxDelaySeconds: 6,
      delaySeconds: 4,
      cookieKey: "rolnopolPromoAdvertSeen_general",
      videoUrls: [
        { url: "/images/rolnopol_ad2.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad3.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad4.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad5.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad6.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad7.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad8.mp4", title: "Discover Rolnopol Features" },
        { url: "/images/rolnopol_ad9.mp4", title: "Discover AI_Testers" },
      ],
      videoAlt: "Rolnopol General Feature Demo",
    },
    newProducts: {
      flag: "promoAdvertsNewProductsEnabled",
      title: "Discover New Products",
      minDelaySeconds: 3,
      maxDelaySeconds: 6,
      delaySeconds: 4,
      cookieKey: "newProductAdvertSeen_general",
      videoUrls: [{ url: "/images/rolnopol_ad9.mp4", title: "Discover AI_Testers" }],
      videoAlt: "Discover New Products",
    },
  };

  const BOTTOM_BANNER_CONFIG = {
    id: "promo-bottom-banner",
    flag: "promoAdvertsBottomBannerEnabled",
    title: "Rolnopol Promo",
    message: "🚜 Discover smarter farm workflows with Rolnopol. Explore new features and boost your daily operations!",
    ctaLabel: "Learn more",
    ctaHref: "/docs.html",
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
   * Handles both old format (string arrays) and new format (object arrays with url property)
   */
  function getVideoUrl(config) {
    if (!config) {
      return null;
    }
    // Prefer videoUrls array if available
    if (Array.isArray(config.videoUrls) && config.videoUrls.length > 0) {
      const selected = getRandomItem(config.videoUrls);
      // Handle both object format { url, title } and plain string format
      return typeof selected === "object" ? selected.url : selected;
    }
    // Fall back to single videoUrl
    return config.videoUrl || null;
  }

  /**
   * Get video title for promo config (from selected video if available)
   * Falls back to config title if video-specific title is not available
   */
  function getVideoTitle(config, selectedVideo) {
    if (!config) {
      return null;
    }
    // If selectedVideo is provided and has a title property, use it
    if (selectedVideo && typeof selectedVideo === "object" && selectedVideo.title) {
      return selectedVideo.title;
    }
    // Fall back to config title
    return config.title || null;
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
   * List of pages excluded from general advert display
   * These pages should not show the general promotional popup
   */
  const EXCLUDED_PAGES = [
    "swagger",
    "privacy",
    "admin",
    "backend",
    "feature-flags",
    "404",
    "4041",
    "maintenance",
    "login",
    "register",
    "debug",
    "logs",
  ];

  /**
   * Check if a page is excluded from general advert display
   */
  function isPageExcluded(page) {
    return EXCLUDED_PAGES.some((excluded) => page.includes(excluded));
  }

  /**
   * Get the current page key based on window location
   */
  function getCurrentPageKey() {
    const path = window.location.pathname;
    const page = window.location.pathname.split("/").pop();

    // Check if page is in excluded list; if so, no promo should show
    if (isPageExcluded(page)) {
      return null;
    }

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

    // For any other page not specifically handled above and not excluded,
    // return "general" to allow general promotional ads
    return "general";
  }

  /**
   * Check if any other promo has been shown (to prevent multiple popups)
   * This ensures only one promotional popup shows at a time
   */
  function hasAnyOtherPromoShown(currentPageKey) {
    // Check all configured promos except the current page
    for (const pageKey in PROMO_CONFIG) {
      if (pageKey !== currentPageKey) {
        if (hasShownPromo(pageKey)) {
          return true;
        }
      }
    }
    return false;
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

    if (videoEl) {
      // Clear existing sources
      videoEl.innerHTML = "";

      // Get selected video item (might be string or object)
      let selectedVideo = null;
      if (Array.isArray(config.videoUrls) && config.videoUrls.length > 0) {
        selectedVideo = getRandomItem(config.videoUrls);
      }

      // Get video URL (randomly selected if multiple available)
      const videoUrl = getVideoUrl(config);
      if (!videoUrl) {
        console.warn(`No video URL configured for page: ${pageKey}`);
        return;
      }

      // Set title: use video-specific title if available, otherwise use config title
      if (titleEl) {
        const videoTitle = getVideoTitle(config, selectedVideo);
        titleEl.textContent = videoTitle || "Discover Rolnopol";
      }

      // Create and add source element
      const sourceEl = document.createElement("source");
      sourceEl.src = videoUrl;
      sourceEl.type = "video/mp4";
      videoEl.appendChild(sourceEl);

      // Reset video element so browser re-reads the source
      videoEl.load();
    } else if (titleEl) {
      // If no video element but title element exists, just set the config title
      titleEl.textContent = config.title || "Discover Rolnopol";
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
   * Resolve whether a promo flag is enabled.
   * Supports both sync and async implementations of `isEnabled`.
   */
  async function isPromoFlagEnabled(featureFlagsService, flagKey, defaultValue = false) {
    if (!featureFlagsService || typeof featureFlagsService.isEnabled !== "function") {
      return defaultValue;
    }

    try {
      const result = featureFlagsService.isEnabled(flagKey, defaultValue);
      return (await Promise.resolve(result)) === true;
    } catch (e) {
      return defaultValue;
    }
  }

  /**
   * Initialize promo adverts
   * Should be called after feature flags service is ready
   */
  async function initPromoAdverts() {
    try {
      // Get feature flags service early so we can initialize bottom banner independently
      const featureFlagsService =
        window.App && typeof window.App.getModule === "function" ? window.App.getModule("featureFlagsService") : null;

      await initBottomBanner(featureFlagsService);

      // Get current page key
      let pageKey = getCurrentPageKey();
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

      // For general adverts, also check if any other promo has been shown recently
      // This prevents multiple popups from showing at the same time
      if (pageKey === "general" && hasAnyOtherPromoShown(pageKey)) {
        return;
      }

      // Get feature flags service
      if (!featureFlagsService) {
        // Service not available, try waiting for it
        if (window.FeatureFlagsService && typeof window.FeatureFlagsService === "function") {
          try {
            const service = new window.FeatureFlagsService();
            if (typeof service.init === "function") {
              await service.init();
            }
            let isEnabled = await isPromoFlagEnabled(service, config.flag, false);

            // If page-specific flag is disabled, fall back to general flag
            if (!isEnabled && pageKey !== "general") {
              const generalConfig = PROMO_CONFIG["general"];
              if (generalConfig) {
                const generalEnabled = await isPromoFlagEnabled(service, generalConfig.flag, false);
                if (generalEnabled) {
                  // Switch to general config and page key
                  pageKey = "general";
                  isEnabled = true;
                }
              }
            }

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
        let isEnabled = await isPromoFlagEnabled(featureFlagsService, config.flag, false);

        // If page-specific flag is disabled, fall back to general flag
        if (!isEnabled && pageKey !== "general") {
          const generalConfig = PROMO_CONFIG["general"];
          if (generalConfig) {
            const generalEnabled = await isPromoFlagEnabled(featureFlagsService, generalConfig.flag, false);
            if (generalEnabled) {
              // Switch to general config and page key
              pageKey = "general";
              isEnabled = true;
            }
          }
        }

        if (!isEnabled) {
          return;
        }
      }

      // Re-fetch config in case pageKey was switched to 'general'
      const finalConfig = PROMO_CONFIG[pageKey];
      if (!finalConfig) {
        return;
      }

      // Mark as shown first to prevent multiple popups
      // Note: Cookie is actually set when user closes the modal, not when it appears

      // Delay showing the popup (could be fixed or randomised within a range)
      const delayMs = getDelayMs(finalConfig);
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

  function removeBottomBanner() {
    const existing = document.getElementById(BOTTOM_BANNER_CONFIG.id);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function createBottomBanner() {
    if (document.getElementById(BOTTOM_BANNER_CONFIG.id)) {
      return;
    }

    const banner = document.createElement("aside");
    banner.id = BOTTOM_BANNER_CONFIG.id;
    banner.className = "promo-bottom-banner";
    banner.setAttribute("role", "complementary");
    banner.setAttribute("aria-label", "Promotional banner");

    banner.innerHTML = `
      <div class="promo-bottom-banner__content">
        <div class="promo-bottom-banner__text">
          <strong class="promo-bottom-banner__title">${BOTTOM_BANNER_CONFIG.title}</strong>
          <span class="promo-bottom-banner__message">${BOTTOM_BANNER_CONFIG.message}</span>
        </div>
        <div class="promo-bottom-banner__actions">
          <a class="promo-bottom-banner__cta" href="${BOTTOM_BANNER_CONFIG.ctaHref}">${BOTTOM_BANNER_CONFIG.ctaLabel}</a>
          <button type="button" class="promo-bottom-banner__close" aria-label="Close promotional banner">×</button>
        </div>
      </div>
    `;

    const closeBtn = banner.querySelector(".promo-bottom-banner__close");
    if (closeBtn) {
      closeBtn.addEventListener("click", removeBottomBanner);
    }

    document.body.appendChild(banner);
  }

  async function initBottomBanner(featureFlagsService) {
    const enabled = await isPromoFlagEnabled(featureFlagsService, BOTTOM_BANNER_CONFIG.flag, false);
    if (!enabled) {
      removeBottomBanner();
      return;
    }

    createBottomBanner();
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
      getVideoTitle,
      getDelayMs,
      isPromoFlagEnabled,
    };
  }
})();
