/**
 * Rolnopol Survival — talking to the expedition record API (PRD 10, WP-45).
 *
 * Two rules shape this file:
 *   - A session is required to play (WP-38). No session, or a session that dies
 *     mid-run, sends the browser to the login page with a returnUrl.
 *   - The backend going down must not end the run (WP-45). Every call answers
 *     with a plain object, never a throw, and the caller keeps playing with the
 *     recording switched off.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.apiClient = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const ENDPOINT = "/api/v1/survival/sessions";

  function hasSessionHint() {
    return document.cookie.indexOf("rolnopolLoginTime=") !== -1 || document.cookie.indexOf("rolnopolIsLogged=true") !== -1;
  }

  function redirectToLogin() {
    const returnUrl = window.location.pathname + window.location.search;
    window.location.href = "/login.html?returnUrl=" + encodeURIComponent(returnUrl);
  }

  /** The guard the page calls before anything else (WP-38). */
  function requireSession() {
    if (hasSessionHint()) return true;
    redirectToLogin();
    return false;
  }

  async function call(url, options) {
    let response;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    } catch (error) {
      return { ok: false, offline: true, status: 0 };
    }

    // A session that expires mid-run behaves like one that was never there.
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return { ok: false, status: response.status, unauthorized: true };
    }

    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: (body && body.error) || "Request failed" };
    }
    return { ok: true, status: response.status, data: (body && body.data) || null };
  }

  /** Open an expedition. The seed in the answer is the one to play (PRD 10.3). */
  async function startSession(input) {
    return call(ENDPOINT, { method: "POST", body: JSON.stringify(input || {}) });
  }

  /** The caller's own history, newest first (WP-27). */
  async function listSessions() {
    return call(ENDPOINT, { method: "GET" });
  }

  /** The league table, across players (PRD 8.11). */
  async function getScoreboard() {
    return call("/api/v1/survival/scoreboard", { method: "GET" });
  }

  /** Records, streak, marks earned and scenarios unlocked (PRD 8.18). */
  async function getProgress() {
    return call("/api/v1/survival/progress", { method: "GET" });
  }

  /** One expedition in full, snapshot included (WP-69). */
  async function getSession(sessionId) {
    return call(ENDPOINT + "/" + encodeURIComponent(sessionId), { method: "GET" });
  }

  /** Park a run so it can be picked up later (WP-69). */
  async function saveSnapshot(sessionId, snapshot) {
    return call(ENDPOINT + "/" + encodeURIComponent(sessionId) + "/snapshot", {
      method: "PUT",
      body: JSON.stringify({ snapshot }),
    });
  }

  /**
   * Close it: won, lost or abandoned (WP-42).
   * `chronicle` carries the route, the moments and the marks earned (PRD 8.17,
   * 8.18); an abandoned run sends none of it, because nobody finished anything.
   */
  async function closeSession(sessionId, status, result, chronicle) {
    const story = chronicle || {};

    return call(ENDPOINT + "/" + encodeURIComponent(sessionId), {
      method: "PATCH",
      body: JSON.stringify({
        status,
        result,
        cheatsUsed: !!(result && result.cheatsUsed),
        moments: story.moments || [],
        route: story.route || [],
        achievements: story.achievements || [],
      }),
    });
  }

  return {
    requireSession,
    hasSessionHint,
    redirectToLogin,
    startSession,
    listSessions,
    getScoreboard,
    getProgress,
    getSession,
    saveSnapshot,
    closeSession,
    ENDPOINT,
  };
});
