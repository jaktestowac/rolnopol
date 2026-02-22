// Cookie Consent Banner Component
// Displays a cookie consent banner when feature flag is enabled and user hasn't accepted

(function () {
  "use strict";

  const COOKIE_NAME = "rolnopolCookieConsent";
  const COOKIE_VALUE = "accepted";
  const COOKIE_DAYS = 7;
  const FEATURE_FLAG_KEY = "cookieConsentBannerEnabled";

  /**
   * Check if user has already accepted cookies
   */
  function hasConsentCookie() {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${COOKIE_NAME}=`);
    if (parts.length === 2) {
      const cookieValue = parts.pop().split(";").shift();
      return cookieValue === COOKIE_VALUE;
    }
    return false;
  }

  /**
   * Set cookie consent cookie for 7 days
   */
  function setConsentCookie() {
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() + COOKIE_DAYS * 24 * 60 * 60 * 1000);

    let cookieString = `${COOKIE_NAME}=${COOKIE_VALUE}; path=/; expires=${expirationDate.toUTCString()}`;

    // Add SameSite attribute
    cookieString += "; SameSite=Lax";

    // Add Secure flag for HTTPS
    if (location.protocol === "https:") {
      cookieString += "; Secure";
    }

    document.cookie = cookieString;
  }

  /**
   * Hide the cookie consent banner
   */
  function hideBanner() {
    const banner = document.getElementById("cookie-consent-banner");
    if (banner) {
      banner.style.display = "none";
      banner.setAttribute("aria-hidden", "true");
    }
  }

  /**
   * Create and render the cookie consent banner HTML
   */
  function createBanner() {
    if (document.getElementById("cookie-consent-banner")) {
      return; // Banner already exists
    }

    const banner = document.createElement("div");
    banner.id = "cookie-consent-banner";
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "complementary");
    banner.setAttribute("aria-label", "Cookie consent notice");
    banner.innerHTML = `
      <div class="cookie-consent-banner__content">
        <div class="cookie-consent-banner__message">
          <p>We use cookies to enhance your experience on our website. By continuing to use Rolnopol, you agree to our use of cookies.</p>
        </div>
        <div class="cookie-consent-banner__actions">
          <a href="/privacy.html" class="cookie-consent-banner__link" target="_blank" rel="noopener noreferrer">More info</a>
          <button id="cookie-consent-accept" class="cookie-consent-banner__accept" type="button">
            Accept
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Setup event listener for Accept button
    const acceptButton = document.getElementById("cookie-consent-accept");
    if (acceptButton) {
      acceptButton.addEventListener("click", function () {
        setConsentCookie();
        hideBanner();
      });
    }
  }

  /**
   * Initialize cookie consent banner
   * Should be called after feature flags service is ready
   */
  async function initCookieConsent() {
    try {
      // Check if cookie already exists (user has already consented)
      if (hasConsentCookie()) {
        return;
      }

      // Check if feature flag service is available
      if (!window.App || typeof window.App.getModule !== "function") {
        return;
      }

      const featureFlagsService = window.App.getModule("featureFlagsService");
      if (!featureFlagsService || typeof featureFlagsService.isEnabled !== "function") {
        return;
      }

      // Check if feature flag is enabled (default: false to be safe)
      const isEnabled = await featureFlagsService.isEnabled(FEATURE_FLAG_KEY, false);
      if (!isEnabled) {
        return;
      }

      // Create and render the banner
      createBanner();
    } catch (error) {
      // Silently fail - cookie consent is not critical to app functionality
      if (typeof console !== "undefined" && console.warn) {
        console.warn("Cookie consent initialization error:", error);
      }
    }
  }

  // Export for use in navigation initialization
  window.initCookieConsent = initCookieConsent;
})();
