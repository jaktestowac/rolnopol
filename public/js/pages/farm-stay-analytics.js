/**
 * FarmStay platform-analytics dashboard (hidden page).
 *
 * Fetches cumulative stats across ALL hosts/listings/bookings from the bridge
 * (GET /api/v1/farm-stay/platform/analytics), which proxies the admin-gated
 * gateway endpoint. Logged-in admins only — a non-admin gets 403 and sees a
 * notice. Numbers are shaped server-side; this file only renders.
 */
(function () {
  "use strict";

  const API = "/api/v1/farm-stay";
  const $ = (id) => document.getElementById(id);

  function formatROL(n) {
    return String(Math.round((Number(n) + Number.EPSILON) * 100) / 100);
  }
  // Compact large ROL figures for stat tiles (e.g. 12 345 → 12.3k).
  function compact(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return formatROL(v);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  function banner(msg, persist) {
    const el = $("fsBanner");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(banner._t);
    if (!persist) banner._t = setTimeout(() => (el.hidden = true), 6000);
  }

  async function api(method, path) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { method, credentials: "include" });
    } catch {
      return { ok: false, status: 0, body: { error: "FARM_STAY_OFFLINE" } };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }

  // ── Charts (Chart.js from CDN, same pattern as the main page) ─────────────────
  const CHART_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
  const chartInstances = {};
  let chartJsPromise = null;
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve(true);
    if (!chartJsPromise) {
      chartJsPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = CHART_CDN;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }
    return chartJsPromise;
  }
  const CHART_COLORS = ["#4c9a63", "#5b9bd5", "#e0a458", "#a05195", "#d45087", "#2f9e8f", "#c47f3d", "#8a6bbf"];
  function drawChart(canvasId, config) {
    const canvas = $(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    chartInstances[canvasId] = new window.Chart(canvas.getContext("2d"), config);
  }
  const noLegend = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
  const withLegend = { responsive: true, maintainAspectRatio: false };

  function statTile(icon, label, value, sub) {
    return `<div class="fs-stat"><div class="fs-stat-label"><i class="fa-solid ${icon}"></i> ${label}</div><div class="fs-stat-value">${value}</div>${sub ? `<div class="fs-stat-sub">${sub}</div>` : ""}</div>`;
  }

  function renderStats(a) {
    const t = a.totals || {};
    $("fsMeta").textContent =
      `${t.totalBookings} booking(s) · ${t.listings} listing(s) · ${t.hosts} host(s) — cumulative across the whole platform`;
    $("fsStats").innerHTML = [
      statTile("fa-sack-dollar", "GMV (cumulative)", `${compact(t.gmv)} <small>ROL</small>`, `${formatROL(t.gmv)} ROL total`),
      statTile("fa-people-group", "Guests across all stays", t.guestHeadcount, `${t.distinctGuests} distinct guest(s)`),
      statTile("fa-hand-holding-dollar", "Paid out to hosts", `${compact(t.completedRevenue)} <small>ROL</small>`, "completed stays"),
      statTile("fa-hourglass-half", "Upcoming revenue", `${compact(t.upcomingRevenue)} <small>ROL</small>`, "confirmed stays"),
      statTile("fa-percent", `Est. platform take (${t.estimatedTakeRatePct}%)`, `${compact(t.estimatedPlatformRevenue)} <small>ROL</small>`, "estimated, no fee charged yet"),
      statTile("fa-moon", "Nights booked", t.nightsBooked, `${t.guestNights} guest-nights`),
      statTile("fa-warehouse", "Listings", t.listings, `${t.activeListings} active`),
      statTile("fa-receipt", "Avg booking value", `${formatROL(t.avgBookingValue)} <small>ROL</small>`, `${t.incomeBookings} revenue booking(s)`),
      statTile("fa-star", "Avg rating", t.avgRating ? `${t.avgRating}` : "—", `${t.reviews} review(s)`),
    ].join("");
  }

  function renderTables(a) {
    const props = a.topProperties || [];
    $("fsTopProperties").innerHTML = props.length
      ? props
          .slice(0, 10)
          .map(
            (p) =>
              `<div class="fs-row"><div class="fs-row-main"><div class="fs-row-title">${esc(p.name)}${p.removed ? ' <span class="fs-state expired">removed</span>' : ""}</div><div class="fs-row-sub"><i class="fa-solid fa-location-dot"></i> ${esc(p.district || "—")} · ${esc(p.type || "—")} · host ${esc(p.host || "—")}</div><div class="fs-row-sub">${formatROL(p.gmv)} ROL · ${p.bookings} booking(s) · ${p.nights} night(s) · ${p.guests} guest(s)${p.reviews ? ` · ★ ${p.avgRating} (${p.reviews})` : ""}</div></div></div>`,
          )
          .join("")
      : '<div class="fs-empty">No stays yet.</div>';

    const hosts = a.topHosts || [];
    $("fsTopHosts").innerHTML = hosts.length
      ? hosts
          .slice(0, 10)
          .map(
            (h) =>
              `<div class="fs-row"><div class="fs-row-main"><div class="fs-row-title"><i class="fa-solid fa-user"></i> ${esc(h.hostId)}</div><div class="fs-row-sub">${formatROL(h.gmv)} ROL · ${h.listings} listing(s) · ${h.bookings} booking(s) · ${h.nights} night(s)</div></div></div>`,
          )
          .join("")
      : '<div class="fs-empty">No hosts yet.</div>';
  }

  // ── Occupancy heatmap (GitHub-style per-day timeline) ────────────────────────
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY = 86400000;

  // Bucket a day's booking count into one of 4 intensity levels relative to the
  // busiest day (0 = no stays).
  function heatLevel(count, max) {
    if (!count) return 0;
    if (max <= 1) return 4;
    const r = count / max;
    if (r > 0.75) return 4;
    if (r > 0.5) return 3;
    if (r > 0.25) return 2;
    return 1;
  }

  // One calendar year rendered as a 7×N (day-of-week × week) grid, Monday-based.
  function renderYearGrid(year, lookup, max) {
    const startDow = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7; // Mon=0
    const gridStart = Date.UTC(year, 0, 1) - startDow * DAY; // Monday on/before Jan 1
    const lastT = Date.UTC(year, 11, 31);
    const numWeeks = Math.ceil((lastT - gridStart) / DAY / 7) + 1;

    const cells = [];
    const labels = new Array(numWeeks).fill("");
    for (let w = 0; w < numWeeks; w++) {
      for (let r = 0; r < 7; r++) {
        const t = gridStart + (w * 7 + r) * DAY;
        const dt = new Date(t);
        if (dt.getUTCFullYear() !== year) {
          cells.push('<span class="fs-heat-cell empty"></span>');
          continue;
        }
        const ds = dt.toISOString().slice(0, 10);
        if (dt.getUTCDate() === 1) labels[w] = MONTHS[dt.getUTCMonth()];
        const day = lookup[ds];
        const count = day ? day.bookings : 0;
        const title = day ? `${ds}: ${day.bookings} stay(s) · ${day.guests} guest(s)` : `${ds}: no stays`;
        cells.push(`<span class="fs-heat-cell l${heatLevel(count, max)}" title="${title}"></span>`);
      }
    }
    const cols = `repeat(${numWeeks}, 11px)`;
    const monthRow = labels.map((l) => `<span>${l}</span>`).join("");
    return `<div class="fs-heat-year">
      <div class="fs-heat-year-label">${year}</div>
      <div class="fs-heat-body">
        <div class="fs-heat-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
        <div class="fs-heat-cols">
          <div class="fs-heat-months" style="grid-template-columns:${cols}">${monthRow}</div>
          <div class="fs-heat-grid" style="grid-template-columns:${cols}">${cells.join("")}</div>
        </div>
      </div>
    </div>`;
  }

  function renderHeatmap(a) {
    const card = $("fsHeatCard");
    const wrap = $("fsHeatmap");
    if (!card || !wrap) return;
    const days = a.occupancyByDay || [];
    if (!days.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const lookup = {};
    let max = 0;
    for (const d of days) {
      lookup[d.date] = d;
      if (d.bookings > max) max = d.bookings;
    }

    const peak = a.peakDay;
    const peakEl = $("fsHeatPeak");
    if (peakEl) {
      peakEl.textContent = peak ? `· busiest ${peak.date}: ${peak.bookings} stay(s), ${peak.guests} guest(s)` : "";
    }

    const firstYear = Number(days[0].date.slice(0, 4));
    const lastYear = Number(days[days.length - 1].date.slice(0, 4));
    let html = "";
    for (let y = firstYear; y <= lastYear; y++) html += renderYearGrid(y, lookup, max);
    wrap.innerHTML = html;
  }

  async function renderCharts(a) {
    const el = $("fsCharts");
    const ready = await ensureChartJs();
    if (!ready || !el) {
      if (el) el.hidden = true;
      return;
    }
    el.hidden = false;

    const months = a.gmvByMonth || [];
    drawChart("fsChartGmv", {
      type: "bar",
      data: { labels: months.map((m) => m.month), datasets: [{ label: "GMV (ROL)", data: months.map((m) => m.gmv), backgroundColor: CHART_COLORS[0] }] },
      options: noLegend,
    });

    const years = a.occupancyByYear || [];
    drawChart("fsChartOccupancy", {
      type: "bar",
      data: { labels: years.map((y) => y.year), datasets: [{ label: "Nights", data: years.map((y) => y.nights), backgroundColor: CHART_COLORS[1] }] },
      options: noLegend,
    });

    const districts = (a.byDistrict || []).filter((d) => d.gmv > 0).slice(0, 8);
    drawChart("fsChartDistrict", {
      type: "pie",
      data: { labels: districts.map((d) => d.district), datasets: [{ data: districts.map((d) => d.gmv), backgroundColor: districts.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }] },
      options: withLegend,
    });

    const types = (a.byType || []).filter((x) => x.gmv > 0);
    drawChart("fsChartType", {
      type: "doughnut",
      data: { labels: types.map((x) => x.type), datasets: [{ data: types.map((x) => x.gmv), backgroundColor: types.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }] },
      options: withLegend,
    });

    const states = a.stateDistribution || {};
    const stateKeys = Object.keys(states);
    const stateColor = { hold: "#e0a458", confirmed: "#5b9bd5", completed: "#4c9a63", cancelled: "#d45087", expired: "#999" };
    drawChart("fsChartStates", {
      type: "doughnut",
      data: { labels: stateKeys, datasets: [{ data: stateKeys.map((k) => states[k]), backgroundColor: stateKeys.map((k) => stateColor[k] || "#888") }] },
      options: withLegend,
    });

    const hosts = (a.topHosts || []).filter((h) => h.gmv > 0).slice(0, 8);
    drawChart("fsChartHosts", {
      type: "bar",
      data: { labels: hosts.map((h) => h.hostId), datasets: [{ label: "GMV (ROL)", data: hosts.map((h) => h.gmv), backgroundColor: CHART_COLORS[3] }] },
      options: noLegend,
    });
  }

  async function load() {
    const btn = $("fsRefresh");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading…';
    }
    $("fsStats").innerHTML = '<div class="fs-empty">Loading platform analytics…</div>';
    const { ok, status, body } = await api("GET", "/platform/analytics");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
    if (!ok || !body.totals) {
      $("fsStats").innerHTML = "";
      $("fsCharts").hidden = true;
      $("fsHeatCard").hidden = true;
      if (status === 401) return banner("Please log in as an admin to view platform analytics.", true);
      if (status === 403) return banner("Platform analytics is admin-only — your account does not have access.", true);
      if (status === 503) return banner("A FarmStay service is offline — try again shortly.", true);
      return banner(body.error || `Could not load platform analytics (HTTP ${status}).`, true);
    }
    banner("", false);
    $("fsBanner").hidden = true;
    renderStats(body);
    renderHeatmap(body);
    renderTables(body);
    renderCharts(body);
  }

  function init() {
    const btn = $("fsRefresh");
    if (btn) btn.addEventListener("click", load);
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
