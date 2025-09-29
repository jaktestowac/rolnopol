// Kraken Dashboard Shared Utilities
// This file contains common functions used across all Kraken dashboard tabs

// Cookie utility functions
function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function setCookie(name, value, hours = 2) {
  const expires = new Date();
  expires.setTime(expires.getTime() + hours * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict${window.location.protocol === "https:" ? ";Secure" : ""}`;
}

function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Strict`;
}

// Secure fetch wrapper that handles 401/403 responses
function secureFetch(url, options = {}) {
  // Check if we're in an iframe context
  const isInIframe = window.parent && window.parent !== window;

  // If we're in an iframe, always use local implementation to ensure proper error handling
  if (isInIframe) {
    return fetch(url, options).then((response) => {
      if (response.status === 401 || response.status === 403) {
        console.warn(
          `Authentication error (${response.status}) detected in iframe`,
        );
        // Notify parent window about authentication error
        const message = {
          type: "AUTH_ERROR",
          status: response.status,
          source: "iframe",
        };
        window.parent.postMessage(message, "*");

        // Fallback: if parent doesn't respond within 1 second, redirect directly
        setTimeout(() => {
          deleteCookie("krakenToken");
          window.location.href = "../kraken.html";
        }, 1000);

        return Promise.reject(
          new Error(`Authentication failed: ${response.status}`),
        );
      }
      return response;
    });
  }

  // If we're in the main window, handle redirect directly
  return fetch(url, options).then((response) => {
    if (response.status === 401 || response.status === 403) {
      deleteCookie("krakenToken");
      window.location.href = "./kraken.html";
      return Promise.reject(
        new Error(`Authentication failed: ${response.status}`),
      );
    }
    return response;
  });
}

// Make functions available globally
window.getCookie = getCookie;
window.setCookie = setCookie;
window.deleteCookie = deleteCookie;
window.secureFetch = secureFetch;
