/**
 * Instrumentality Shadow page.
 *
 * Opens the sink's Server-Sent Events stream and renders its in-memory tally
 * plus the last few absorbed paths. Read-only: the page never posts anything,
 * and a fallback poll keeps the last known numbers moving if SSE is unavailable.
 */
(function () {
  "use strict";

  const POLL_MS = 10000;
  const STREAM_URL = "/instrumentality/shadow/stream";
  const SECRET_SEQUENCE = "instrumentality";
  const SECRET_TARGET = "/instrumentality/core";
  const $ = (id) => document.getElementById(id);
  let lastCount = null;
  let secretBuffer = "";
  let pollTimer = null;
  let stream = null;

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
    const count = Number.isFinite(absorbed) && absorbed > 0 ? Math.floor(absorbed) : 0;
    const digits = String(count).length;
    el.textContent = formatCount(count);
    el.setAttribute("aria-label", `${formatCount(count)} requests absorbed`);
    el.classList.toggle("ish-count-value--large", digits >= 7 && digits < 10);
    el.classList.toggle("ish-count-value--huge", digits >= 10 && digits < 14);
    el.classList.toggle("ish-count-value--extreme", digits >= 14);
    if (lastCount !== null && absorbed !== lastCount) {
      el.classList.remove("is-shifted");
      void el.offsetWidth; // restart the animation on a repeat increment
      el.classList.add("is-shifted");
    }
    lastCount = count;
  }

  function formatCount(value) {
    try {
      return new Intl.NumberFormat("en-US").format(value);
    } catch {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
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
    renderState(state);
  }

  function renderState(state) {
    renderCount(Number(state.absorbed) || 0);
    renderRecent(Array.isArray(state.recent) ? state.recent : []);
    const since = $("ishSince");
    if (since) since.textContent = state.since ? `first echo ${ago(state.since)} · counted since this process started` : "";
  }

  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function connectStream() {
    if (!window.EventSource) {
      startPolling();
      return;
    }

    stream = new EventSource(STREAM_URL);
    stream.addEventListener("open", stopPolling);
    stream.addEventListener("snapshot", (event) => {
      try {
        renderState(JSON.parse(event.data || "{}"));
      } catch {
        /* ignore malformed stream frames */
      }
    });
    stream.addEventListener("error", () => {
      // EventSource reconnects by itself; polling covers the gap when a proxy or
      // dropped connection prevents stream frames from arriving.
      startPolling();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    secretBuffer = `${secretBuffer}${event.key.toLowerCase()}`.slice(-SECRET_SEQUENCE.length);
    if (secretBuffer === SECRET_SEQUENCE) {
      window.location.assign(SECRET_TARGET);
    }
  });

  connectStream();
  window.addEventListener("beforeunload", () => {
    if (stream) stream.close();
    stopPolling();
  });
})();
