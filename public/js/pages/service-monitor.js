/**
 * Service Monitor page logic.
 *
 * Polls /api/v1/services/status — which probes each external gRPC service's
 * Health.Check — and renders a live status dashboard. No auth required, in line
 * with the rest of the backend tooling pages.
 */
(function () {
  "use strict";

  const ENDPOINT = "/api/v1/services/status";
  const REFRESH_MS = 15000;

  const grid = document.getElementById("svc-grid");
  const updatedEl = document.getElementById("svc-updated");
  const refreshBtn = document.getElementById("refresh-btn");

  let timer = null;

  const STATUS_META = {
    online: { label: "Online", icon: "fa-circle-check", cls: "svc-card--online" },
    offline: { label: "Offline", icon: "fa-circle-xmark", cls: "svc-card--offline" },
    error: { label: "Error", icon: "fa-triangle-exclamation", cls: "svc-card--error" },
    unknown: { label: "Unknown", icon: "fa-circle-question", cls: "svc-card--error" },
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function formatUptime(ms) {
    const totalSeconds = Math.floor(Number(ms) / 1000);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (!d && !h) parts.push(`${s}s`);
    return parts.join(" ");
  }

  function detailRow(label, value) {
    return `<div class="svc-detail"><span>${esc(label)}</span><strong>${value}</strong></div>`;
  }

  function renderCard(svc) {
    const meta = STATUS_META[svc.status] || STATUS_META.unknown;
    const h = svc.health || {};

    const flagBadge =
      svc.flagEnabled == null
        ? ""
        : svc.flagEnabled
          ? `<span class="svc-flag svc-flag--on" title="${esc(svc.flag)}"><i class="fas fa-toggle-on"></i> Feature on</span>`
          : `<span class="svc-flag svc-flag--off" title="${esc(svc.flag)}"><i class="fas fa-toggle-off"></i> Feature off</span>`;

    const transportBadge = svc.transport
      ? `<span class="svc-transport">${esc(svc.transport)}</span>`
      : "";

    let details;
    if (svc.status === "online") {
      const countLabel = "crop_count" in h ? "Crops" : "status_count" in h ? "Statuses" : "Items";
      const countValue = h.crop_count ?? h.status_count;
      details = [
        detailRow("Health", `${esc(h.status || "SERVING")}`),
        detailRow("Version", `v${esc(h.version || "?")}`),
        detailRow("DB initialized", h.db_initialized ? "Yes" : "No"),
        countValue != null ? detailRow(countLabel, esc(countValue)) : "",
        detailRow("Uptime", esc(formatUptime(h.uptime_ms))),
      ].join("");
    } else {
      const hint = svc.hint ? `<div class="svc-error-hint">${esc(svc.hint)}</div>` : "";
      details = `<div class="svc-error-box"><i class="fas fa-plug-circle-xmark"></i> ${esc(svc.error || "No response")}</div>${hint}`;
    }

    return `
      <article class="svc-card ${meta.cls}">
        <div class="svc-card__top">
          <div class="svc-card__name">
            <span class="svc-card__title">${esc(svc.name)} ${transportBadge}</span>
            <span class="svc-card__desc">${esc(svc.description || "")}</span>
          </div>
          <span class="svc-status">
            <i class="fas ${meta.icon}"></i> ${meta.label}
          </span>
        </div>
        <div class="svc-card__target"><i class="fas fa-network-wired"></i> ${esc(svc.target)}</div>
        <div class="svc-card__details">${details}</div>
        <div class="svc-card__foot">${flagBadge}</div>
      </article>`;
  }

  function renderError(message) {
    grid.innerHTML = `<p class="svc-empty svc-empty--error">
      <i class="fas fa-triangle-exclamation"></i> ${esc(message)}
    </p>`;
  }

  async function load() {
    try {
      const res = await fetch(ENDPOINT, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.data?.services) {
        renderError(json?.error || `Failed to load service status (HTTP ${res.status}).`);
        return;
      }
      const services = json.data.services;
      grid.innerHTML = services.map(renderCard).join("");
      if (updatedEl) {
        updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      }
    } catch (e) {
      renderError("Could not reach the monitoring endpoint.");
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(load, REFRESH_MS);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      load();
      schedule(); // reset the countdown after a manual refresh
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (timer) clearInterval(timer);
      timer = null;
    } else {
      load();
      schedule();
    }
  });

  load();
  schedule();
})();
