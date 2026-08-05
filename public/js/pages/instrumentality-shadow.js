/**
 * Instrumentality Shadow page.
 *
 * Polls the sink's own route for its in-memory tally — GET
 * /instrumentality/shadow?format=json — and renders the count plus the last few
 * absorbed paths. Read-only: the page never posts anything, and a failed poll
 * leaves the last known numbers on screen rather than blanking them.
 */
(function () {
  "use strict";

  const POLL_MS = 3000;
  const SECRET_SEQUENCE = "instrumentality";
  const SECRET_TARGET = "/instrumentality/core";
  const $ = (id) => document.getElementById(id);
  let lastCount = null;
  let secretBuffer = "";

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  // Paths arrive from whatever was mirrored, so they are escaped, never trusted.
  function renderRecent(recent) {
    const list = $("ishRecent");
    const empty = $("ishEmpty");
    if (!list || !empty) return;
    if (!recent.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = recent
      .map(
        (e) =>
          `<li class="ish-echo"><span class="ish-echo-method">${esc(e.method)}</span>` +
          `<span class="ish-echo-path">${esc(e.path)}</span>` +
          `<span class="ish-echo-at">${esc(ago(e.at))}</span></li>`,
      )
      .join("");
  }

  function ago(iso) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  }

  function renderCount(absorbed) {
    const el = $("ishCount");
    if (!el) return;
    el.textContent = String(absorbed);
    if (lastCount !== null && absorbed !== lastCount) {
      el.classList.remove("is-shifted");
      void el.offsetWidth; // restart the animation on a repeat increment
      el.classList.add("is-shifted");
    }
    lastCount = absorbed;
  }

  async function poll() {
    let state;
    try {
      const res = await fetch("/instrumentality/shadow?format=json", { headers: { accept: "application/json" } });
      if (!res.ok) return;
      state = await res.json();
    } catch {
      return; // the shadow keeps whatever it last showed
    }
    renderCount(Number(state.absorbed) || 0);
    renderRecent(Array.isArray(state.recent) ? state.recent : []);
    const since = $("ishSince");
    if (since) since.textContent = state.since ? `first echo ${ago(state.since)} · counted since this process started` : "";
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    secretBuffer = `${secretBuffer}${event.key.toLowerCase()}`.slice(-SECRET_SEQUENCE.length);
    if (secretBuffer === SECRET_SEQUENCE) {
      window.location.assign(SECRET_TARGET);
    }
  });

  poll();
  setInterval(poll, POLL_MS);
})();
