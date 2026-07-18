/**
 * FarmStay page logic.
 *
 * Talks to the FarmStay REST bridge (/api/v1/farm-stay/*), which proxies to the
 * standalone FarmStay gateway (thin orchestrator over 4 leaf services) and also
 * charges/refunds ROL against Rolnopol's financial service. The gateway returns
 * final-shaped JSON, so responses are used directly. Logged-in users only — the
 * session cookie rides along (credentials: "include").
 */
(function () {
  "use strict";

  const API = "/api/v1/farm-stay";
  const $ = (id) => document.getElementById(id);
  let lastSearch = null; // remember search params to re-run after a booking

  // Polish voivodeships → cities. The value stored on a property is the city
  // (property.district); the voivodeship is only the dropdown grouping.
  const PL_LOCATIONS = {
    Dolnośląskie: ["Wrocław", "Karpacz", "Wałbrzych"],
    "Kujawsko-Pomorskie": ["Bydgoszcz", "Toruń"],
    Lubelskie: ["Lublin", "Kazimierz Dolny"],
    Lubuskie: ["Zielona Góra"],
    Łódzkie: ["Łódź"],
    Małopolskie: ["Kraków", "Zakopane", "Tarnów"],
    Mazowieckie: ["Warszawa", "Płock", "Radom"],
    Opolskie: ["Opole"],
    Podkarpackie: ["Rzeszów", "Ustrzyki Dolne"],
    Podlaskie: ["Białystok", "Augustów"],
    Pomorskie: ["Gdańsk", "Sopot", "Gdynia"],
    Śląskie: ["Katowice", "Wisła"],
    Świętokrzyskie: ["Kielce"],
    "Warmińsko-Mazurskie": ["Olsztyn", "Giżycko"],
    Wielkopolskie: ["Poznań"],
    Zachodniopomorskie: ["Szczecin", "Kołobrzeg"],
  };

  // localStorage key for user-added custom locations
  const CUSTOM_LOC_KEY = "farmStay_customLocs";

  // Presentation catalog (stay types, policies, amenities, card-photo themes)
  // fetched from the backend — GET /catalog — so the option lists and their
  // icons/gradients live in ONE place. Populated by loadCatalog() at init;
  // lookups below are rebuilt from it. DEFAULT_LOOK covers the offline case.
  const DEFAULT_LOOK = { gradient: "linear-gradient(135deg, #cfe3d4, #a5c8e0)", icon: "fa-house" };
  let catalog = { types: [], policies: [], amenities: [], photoThemes: [] };
  let amenityByKey = {}; // key → { label, icon }
  let typeByKey = {}; // key → { label, icon, gradient }
  let themeByKey = {}; // key → { label, icon, gradient }

  function indexCatalog() {
    amenityByKey = Object.fromEntries((catalog.amenities || []).map((a) => [a.key, a]));
    typeByKey = Object.fromEntries((catalog.types || []).map((t) => [t.key, t]));
    themeByKey = Object.fromEntries((catalog.photoThemes || []).map((t) => [t.key, t]));
  }

  async function loadCatalog() {
    const { ok, body } = await api("GET", "/catalog");
    if (ok && body && Array.isArray(body.amenities)) catalog = body;
    indexCatalog();
    listingDraft.photo = catalog.photoThemes[0]?.key || "";
  }

  // Listing-form working state (not backed by native form fields).
  const listingDraft = { amenities: new Set(), photo: "" };

  // Resolve the card-photo look for a property: a chosen theme, then the type
  // default, then a neutral fallback. Returns an inline gradient + icon.
  function photoLook(p) {
    // Responses carry photo_ref (snake_case, from the proto); create payloads
    // send photoRef (camelCase). Read both so this works either way.
    const theme = themeByKey[p.photo_ref || p.photoRef];
    if (theme) return { gradient: theme.gradient, icon: theme.icon };
    const type = typeByKey[p.type];
    if (type) return { gradient: type.gradient, icon: type.icon };
    return DEFAULT_LOOK;
  }

  // ── Formatting ──────────────────────────────────────────────────────────────
  function formatROL(n) {
    // Round to 2 decimal places, remove trailing zeros for display.
    return String(Math.round((Number(n) + Number.EPSILON) * 100) / 100);
  }

  // ── Custom locations ─────────────────────────────────────────────────────────
  function loadCustomLocs() {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOM_LOC_KEY) || "[]");
      // Migrate legacy plain-string entries to {voi, city} objects
      return raw.map((item) => (typeof item === "string" ? { voi: "Custom", city: item } : item));
    } catch {
      return [];
    }
  }
  function saveCustomLocs(locs) {
    localStorage.setItem(CUSTOM_LOC_KEY, JSON.stringify(locs));
  }
  function refreshAllLocationSelects() {
    populateLocationSelect($("fsDistrict"), { includeAny: true });
    populateLocationSelect($("lDistrict"), { includeAny: false });
  }

  function populateLocationSelect(sel, { includeAny } = {}) {
    if (!sel) return;
    const custom = loadCustomLocs();
    const frag = [];
    if (includeAny) frag.push('<option value="">Anywhere in Poland</option>');
    for (const [voi, cities] of Object.entries(PL_LOCATIONS)) {
      const extra = custom.filter((c) => c.voi === voi).map((c) => c.city);
      frag.push(`<optgroup label="${voi}">`);
      for (const c of [...cities, ...extra]) frag.push(`<option value="${c}">${c}</option>`);
      frag.push("</optgroup>");
    }
    // Custom entries whose region isn't a standard one go to a fallback group
    const knownRegions = new Set(Object.keys(PL_LOCATIONS));
    const orphans = custom.filter((c) => !knownRegions.has(c.voi));
    if (orphans.length) {
      frag.push('<optgroup label="Custom">');
      for (const c of orphans) frag.push(`<option value="${c.city}">${c.city}</option>`);
      frag.push("</optgroup>");
    }
    sel.innerHTML = frag.join("");
  }

  function renderCustomLocs() {
    const el = $("fsCustomLocs");
    if (!el) return;
    const locs = loadCustomLocs();
    if (!locs.length) {
      el.innerHTML = '<span class="fs-note">None yet.</span>';
      return;
    }
    el.innerHTML = locs
      .map(
        (c) =>
          `<span class="fs-chip fs-chip-loc">${esc(c.city)} <span class="fs-chip-voi">(${esc(c.voi)})</span><button class="fs-chip-rm" data-city="${esc(c.city)}" data-voi="${esc(c.voi)}" title="Remove">&times;</button></span>`,
      )
      .join("");
    el.querySelectorAll("[data-city]").forEach((b) =>
      b.addEventListener("click", () => {
        const remaining = loadCustomLocs().filter((x) => !(x.city === b.dataset.city && x.voi === b.dataset.voi));
        saveCustomLocs(remaining);
        refreshAllLocationSelects();
        renderCustomLocs();
      }),
    );
  }

  function addCustomLoc() {
    const cityInput = $("lCustomLoc");
    const voiSel = $("lCustomVoi");
    const city = cityInput?.value.trim();
    const voi = voiSel?.value;
    if (!city || !voi) return;
    const locs = loadCustomLocs();
    if (!locs.some((l) => l.city === city && l.voi === voi)) {
      locs.push({ voi, city });
      saveCustomLocs(locs);
      refreshAllLocationSelects();
      renderCustomLocs();
    }
    cityInput.value = "";
    cityInput.focus();
  }

  // ── HTTP helper ──────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = { method, credentials: "include" };
    if (body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`${API}${path}`, opts);
    } catch {
      return { ok: false, status: 0, body: { error: "FARM_STAY_OFFLINE" } };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  }

  function banner(msg, persist) {
    const el = $("fsBanner");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(banner._t);
    if (!persist) banner._t = setTimeout(() => (el.hidden = true), 5000);
  }
  function clearBanner() {
    const el = $("fsBanner");
    if (el) el.hidden = true;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }
  function stars(score) {
    if (!score || !score.count) return '<span class="fs-stars count">no reviews</span>';
    const full = Math.round(score.avgRating);
    return `<span class="fs-stars">${"★".repeat(full)}${"☆".repeat(5 - full)} ${score.avgRating} <span class="count">(${score.count})</span></span>`;
  }

  // ── Balance ────────────────────────────────────────────────────────────────
  async function refreshBalance() {
    const el = $("fsBalance");
    if (!el) return;
    const { ok, body } = await api("GET", "/balance");
    if (ok && body.balance != null) {
      el.innerHTML = `<i class="fa-solid fa-wallet"></i> ${formatROL(body.balance)} ${body.currency || "ROL"}`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  // ── Health strip ──────────────────────────────────────────────────────────────
  async function refreshHealth() {
    const el = $("fsHealth");
    if (!el) return;
    const { body } = await api("GET", "/health");
    const services = body?.services || [];

    // Compute overall status
    let overallCls, overallLabel;
    if (!services.length) {
      overallCls = "down";
      overallLabel = "Offline";
    } else {
      const downCount = services.filter((s) => s.status !== "SERVING").length;
      if (downCount === 0) {
        overallCls = "up";
        overallLabel = "Healthy";
      } else if (downCount < services.length) {
        overallCls = "warn";
        overallLabel = "Unstable";
      } else {
        overallCls = "down";
        overallLabel = "Offline";
      }
    }

    // Keep the panel open if it already was across auto-refreshes
    const wasOpen = !($("fsHealthPanel")?.hidden ?? true);

    const dots = services.length
      ? services
          .map((s) => `<span class="fs-dot ${s.status === "SERVING" ? "up" : "down"}" title="${esc(s.target || "")}">${esc(s.name)}</span>`)
          .join("")
      : '<span class="fs-dot down">gateway</span>';

    el.innerHTML = `
      <button class="fs-health-btn fs-dot ${overallCls}" id="fsHealthToggle" aria-expanded="${wasOpen}" title="Ecosystem status">
        ${esc(overallLabel)} <i class="fa-solid fa-chevron-down fs-health-chevron"></i>
      </button>
      <div class="fs-health-panel" id="fsHealthPanel"${wasOpen ? "" : " hidden"}>
        ${dots}
      </div>`;

    $("fsHealthToggle").addEventListener("click", () => {
      const panel = $("fsHealthPanel");
      const btn = $("fsHealthToggle");
      const opening = panel.hidden;
      panel.hidden = !opening;
      btn.setAttribute("aria-expanded", String(opening));
    });
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll(".fs-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".fs-tab").forEach((t) => t.classList.remove("is-active"));
        document.querySelectorAll(".fs-tab-panel").forEach((p) => p.classList.remove("is-active"));
        tab.classList.add("is-active");
        $(`tab-${tab.dataset.tab}`).classList.add("is-active");
        if (tab.dataset.tab === "trips") loadTrips();
        if (tab.dataset.tab === "purchases") loadPurchases();
        if (tab.dataset.tab === "travel") loadTravel();
        if (tab.dataset.tab === "listings") loadListings();
        if (tab.dataset.tab === "hosting") loadHosting();
      });
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────────
  function defaultDates() {
    const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    if (!$("fsFrom").value) $("fsFrom").value = d(30);
    if (!$("fsTo").value) $("fsTo").value = d(33);
  }

  async function doSearch(e) {
    if (e) e.preventDefault();
    const q = new URLSearchParams({
      from: $("fsFrom").value,
      to: $("fsTo").value,
      guests: $("fsGuests").value || "1",
    });
    if ($("fsDistrict").value) q.set("district", $("fsDistrict").value);
    if ($("fsType").value) q.set("type", $("fsType").value);
    if ($("fsMaxPrice").value) q.set("maxPrice", $("fsMaxPrice").value);
    lastSearch = { from: $("fsFrom").value, to: $("fsTo").value, guests: Number($("fsGuests").value) || 1 };

    const { ok, status, body } = await api("GET", `/search?${q.toString()}`);
    const meta = $("fsSearchMeta");
    const grid = $("fsResults");
    if (!ok) {
      grid.innerHTML = "";
      meta.textContent = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      if (status === 503)
        return banner("Search is unavailable — the inventory service is down. Try `farmstay:control start inventory`.", true);
      return banner(body?.error || `Search failed (HTTP ${status}).`);
    }
    clearBanner();
    meta.textContent =
      `${body.total} stay(s) available · ${lastSearch.from} → ${lastSearch.to}` +
      (body.scoreStatus === "unavailable" ? " · ratings offline" : "");
    if (!body.results.length) {
      grid.innerHTML = '<div class="fs-empty">No stays match. Try different dates, a different region, or fewer filters.</div>';
      return;
    }
    grid.innerHTML = body.results.map(renderCard).join("");
    grid
      .querySelectorAll("[data-book]")
      .forEach((btn) => btn.addEventListener("click", () => openBooking(btn.dataset.book, btn.dataset.name)));
    grid.querySelectorAll("[data-details]").forEach((btn) => btn.addEventListener("click", () => openDetails(btn.dataset.details)));
    grid
      .querySelectorAll("[data-avail]")
      .forEach((btn) => btn.addEventListener("click", () => toggleCardAvailability(btn.dataset.avail, btn)));
  }

  function amenityChip(a) {
    const meta = amenityByKey[a];
    const iTag = meta?.icon ? `<i class="fa-solid ${meta.icon}"></i> ` : "";
    return `<span class="fs-chip">${iTag}${esc(meta?.label || a)}</span>`;
  }

  function renderCard(p) {
    const price =
      p.quoteStatus === "ok" && p.quote
        ? `<span class="fs-price">${formatROL(p.quote.total)} <small>${p.quote.currency}<br>total</small></span>`
        : `<span class="fs-price unavailable">price offline</span>`;
    const amenities = (p.amenities || []).map(amenityChip).join("");
    const photo = photoLook(p);
    // Hosts see their own listings in results (so they know how they look) but
    // cannot book them — swap the Book button for a non-actionable marker.
    const bookAction = p.isOwn
      ? `<span class="fs-own-tag" title="This is your listing"><i class="fa-solid fa-user-check"></i> Yours</span>`
      : `<button class="fs-btn fs-btn-primary fs-btn-sm" data-book="${esc(p.id)}" data-name="${esc(p.name)}"><i class="fa-solid fa-calendar-plus"></i> Book</button>`;
    return `<article class="fs-card${p.isOwn ? " is-own" : ""}">
      <div class="fs-card-photo" style="background:${photo.gradient}">
        <i class="fa-solid ${photo.icon}"></i>
        ${p.isOwn ? '<span class="fs-card-badge"><i class="fa-solid fa-warehouse"></i> Your listing</span>' : ""}
      </div>
      <div class="fs-card-body">
        <div class="fs-card-title">${esc(p.name)}</div>
        <div class="fs-card-meta"><i class="fa-solid fa-location-dot"></i> ${esc(p.district || "—")} · ${esc(p.type)} · up to ${p.capacity} guests</div>
        <div>${stars(p.score)}</div>
        <div class="fs-card-amenities">${amenities}</div>
        <div class="fs-card-foot">
          ${price}
          <div class="fs-card-actions">
            <button class="fs-btn fs-btn-sm" data-avail="${esc(p.id)}"><i class="fa-regular fa-calendar-days"></i> </button>
            <button class="fs-btn fs-btn-sm" data-details="${esc(p.id)}"><i class="fa-solid fa-circle-info"></i> </button>
            ${bookAction}
          </div>
        </div>
        <div class="fs-card-avail" id="avail-${esc(p.id)}" hidden></div>
      </div>
    </article>`;
  }

  // Lazy-load and toggle the inline availability calendar on a search result card.
  async function toggleCardAvailability(propertyId, btn) {
    const panel = document.getElementById(`avail-${propertyId}`);
    if (!panel) return;

    if (!panel.hidden) {
      panel.hidden = true;
      btn.innerHTML = '<i class="fa-regular fa-calendar-days"></i> Availability';
      return;
    }
    if (panel.dataset.loaded) {
      panel.hidden = false;
      btn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Hide';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    const params = lastSearch ? `?from=${lastSearch.from}&to=${lastSearch.to}&guests=${lastSearch.guests}` : "";
    const { ok, body } = await api("GET", `/properties/${propertyId}${params}`);
    btn.disabled = false;

    if (!ok || !body.calendar) {
      panel.innerHTML = '<div class="fs-note fs-avail-note">Availability unavailable.</div>';
    } else {
      panel.innerHTML = renderCalendar(body.calendar) || '<div class="fs-note fs-avail-note">No calendar data for these dates.</div>';
      panel.dataset.loaded = "1";
    }
    panel.hidden = false;
    btn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Hide';
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(html) {
    $("fsModalBody").innerHTML = html;
    $("fsModal").hidden = false;
  }
  function closeModal() {
    $("fsModal").hidden = true;
    $("fsModalBody").innerHTML = "";
  }
  function bindClose() {
    const b = $("fsCloseBtn");
    if (b) b.addEventListener("click", closeModal);
  }

  // ── Details view + calendar ─────────────────────────────────────────────────
  function renderCalendar(calendar) {
    if (!calendar || !Array.isArray(calendar.days) || !calendar.days.length) return "";
    // Group the requested nights by month and lay them out on a weekday grid.
    const byMonth = {};
    for (const d of calendar.days) {
      const key = d.date.slice(0, 7);
      (byMonth[key] = byMonth[key] || []).push(d);
    }
    const dow = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    let html = '<div class="fs-cal-wrap">';
    for (const [month, days] of Object.entries(byMonth)) {
      const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      html += `<div class="fs-cal"><div class="fs-cal-month">${esc(label)}</div><div class="fs-cal-grid">`;
      html += dow.map((d) => `<div class="fs-cal-dow">${d}</div>`).join("");
      // pad to the first night's weekday (Mon-based grid)
      const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
      const pad = (first + 6) % 7;
      if (pad) html += `<div class="fs-cal-cell fs-cal-pad" style="grid-column: span ${pad}"></div>`;
      for (const d of days) {
        const day = Number(d.date.slice(8, 10));
        html += `<div class="fs-cal-cell ${d.available ? "free" : "taken"}" title="${d.date}: ${d.available ? "available" : "unavailable"}">${day}</div>`;
      }
      html += "</div></div>";
    }
    html += '<div class="fs-cal-legend"><span class="free"></span> available <span class="taken"></span> unavailable</div>';
    html += "</div>";
    return html;
  }

  async function openDetails(propertyId) {
    openModal('<p class="fs-note">Loading details…</p>');
    const params = lastSearch ? `?from=${lastSearch.from}&to=${lastSearch.to}&guests=${lastSearch.guests}` : "";
    const { ok, body } = await api("GET", `/properties/${propertyId}${params}`);
    if (!ok || !body.property) {
      openModal(
        `<div class="fs-alert">Could not load details.</div><div class="fs-modal-actions"><button class="fs-btn" id="fsCloseBtn">Close</button></div>`,
      );
      return bindClose();
    }
    const p = body.property;
    const amenities = (p.amenities || []).map(amenityChip).join("");
    const reviews =
      body.reviews && Array.isArray(body.reviews.reviews) && body.reviews.reviews.length
        ? body.reviews.reviews
            .slice(0, 3)
            .map(
              (r) =>
                `<div class="fs-review"><span class="fs-stars">${"★".repeat(r.rating)}</span> ${esc(r.text || "")} <small>— ${esc(r.author)}</small></div>`,
            )
            .join("")
        : '<div class="fs-note">No reviews yet.</div>';
    const priceLine =
      body.quoteStatus === "ok" && body.quote
        ? `<div class="fs-modal-total">${formatROL(body.quote.total)} ${body.quote.currency} <small>total for your dates</small></div>`
        : "";
    const calHtml = renderCalendar(body.calendar) || '<div class="fs-note">Pick dates in search to see availability.</div>';
    const photo = photoLook(p);
    openModal(`
      <div class="fs-modal-photo" style="background:${photo.gradient}"><i class="fa-solid ${photo.icon}"></i></div>
      <h3>${esc(p.name)}</h3>
      <p class="fs-note"><i class="fa-solid fa-location-dot"></i> ${esc(p.district || "—")} · ${esc(p.type)} · up to ${p.capacity} guests · cancellation: ${esc(p.policy)}</p>
      <div class="fs-card-amenities">${amenities}</div>
      <details class="fs-avail-details fs-btn-med">
        <summary style="padding: 4px;"><i class="fa-regular fa-calendar-days "></i> <strong>Availability</strong> <i class="fa-solid fa-chevron-down fs-summary-chevron"></i></summary>
        ${calHtml}
      </details>
      ${priceLine}
      <div class="fs-detail-section"><strong>Reviews</strong>${reviews}</div>
      <div class="fs-modal-actions">
        ${body.quoteStatus === "ok" ? `<button class="fs-btn fs-btn-primary" id="fsDetailBook"><i class="fa-solid fa-calendar-plus"></i> Book this stay</button>` : ""}
        <button class="fs-btn" id="fsCloseBtn">Close</button>
      </div>`);
    bindClose();
    const bookBtn = $("fsDetailBook");
    if (bookBtn) bookBtn.addEventListener("click", () => openBooking(p.id, p.name));
  }

  // ── Booking (hold → confirm → charge) ──────────────────────────────────────────
  async function openBooking(propertyId, name) {
    if (!lastSearch) return banner("Search for dates first.");
    openModal(`<h3>${esc(name)}</h3><p class="fs-note">Placing a hold…</p>`);
    const { ok, status, body } = await api("POST", "/bookings", {
      propertyId,
      from: lastSearch.from,
      to: lastSearch.to,
      guests: lastSearch.guests,
    });
    if (!ok) {
      let msg = body.error || "Could not hold.";
      if (status === 409 && body.error === "RANGE_UNAVAILABLE") msg = "Just taken — those dates are no longer available.";
      else if (status === 503) msg = `A required service is offline (${esc(body.detail || body.error || "")}).`;
      openModal(
        `<h3>${esc(name)}</h3><div class="fs-alert">${esc(msg)}</div><div class="fs-modal-actions"><button class="fs-btn" id="fsCloseBtn">Close</button></div>`,
      );
      return bindClose();
    }
    renderConfirm(name, body);
  }

  function quoteLines(quote) {
    if (!quote) return "";
    const nights = (quote.nights || [])
      .map(
        (n) =>
          `<div><span>${n.date}${n.weekend ? " (weekend)" : ""} · ${n.season}</span><span>${formatROL(n.price)} ${quote.currency}</span></div>`,
      )
      .join("");
    const disc = (quote.discounts || [])
      .map((d) => `<div><span>${esc(d.label)}</span><span>−${formatROL(d.amount)} ${quote.currency}</span></div>`)
      .join("");
    return `<div class="fs-quote-lines">${nights}${disc}</div>`;
  }

  function renderConfirm(name, book, priceChange) {
    const q = book.quote;
    const changeNote = priceChange
      ? `<div class="fs-alert">Price changed from ${formatROL(priceChange.heldQuote)} to ${formatROL(priceChange.currentQuote)} ${q ? q.currency : ""}. Confirm to accept the new price.</div>`
      : "";
    openModal(`
      <h3>Confirm your stay</h3>
      <p class="fs-note">${esc(name)} · hold expires ${book.holdExpiresAt ? new Date(book.holdExpiresAt).toLocaleTimeString() : "soon"}</p>
      ${changeNote}
      ${quoteLines(q)}
      <div class="fs-modal-total">${q ? formatROL(q.total) + " " + q.currency : ""}</div>
      <p class="fs-note">This amount will be charged to your ROL balance on confirmation.</p>
      <div class="fs-modal-actions">
        <button class="fs-btn fs-btn-primary" id="fsConfirmBtn"><i class="fa-solid fa-circle-check"></i> Confirm &amp; pay</button>
        <button class="fs-btn fs-btn-danger" id="fsCancelHoldBtn"><i class="fa-solid fa-xmark"></i> Release hold</button>
      </div>`);
    const currentTotal = priceChange ? priceChange.currentQuote : q ? q.total : undefined;
    $("fsConfirmBtn").addEventListener("click", () => confirmBooking(book.bookingId, name, currentTotal));
    $("fsCancelHoldBtn").addEventListener("click", () => cancelHold(book.bookingId));
  }

  async function confirmBooking(bookingId, name, acceptTotal) {
    const { ok, status, body } = await api(
      "POST",
      `/bookings/${bookingId}/confirm`,
      acceptTotal != null ? { acceptQuote: acceptTotal } : {},
    );
    if (ok) {
      closeModal();
      banner(`Booking confirmed — ${formatROL(body.charged)} ROL charged. Balance: ${formatROL(body.balance)} ROL.`);
      refreshBalance();
      doSearch(); // refresh: the booked dates should disappear from results
      return;
    }
    if (status === 402) {
      openModal(
        `<h3>Not enough ROL</h3><div class="fs-alert">This stay costs ${formatROL(body.needed)} ROL but your balance is ${formatROL(body.balance)} ROL.</div><p class="fs-note">Your hold was released.</p><div class="fs-modal-actions"><button class="fs-btn" id="fsCloseBtn">Close</button></div>`,
      );
      refreshBalance();
      return bindClose();
    }
    if (status === 409 && body.error === "PRICE_CHANGED") {
      return renderConfirm(
        name,
        { bookingId, holdExpiresAt: "", quote: { total: body.currentQuote, currency: "ROL", nights: [], discounts: [] } },
        body,
      );
    }
    if (status === 410) {
      closeModal();
      return banner("Your hold expired — please search and book again.", true);
    }
    if (status === 503) return banner("Pricing/booking service offline — your hold is still valid, try again shortly.", true);
    banner(body.error || "Could not confirm.");
  }

  async function cancelHold(bookingId) {
    await api("POST", `/bookings/${bookingId}/cancel`);
    closeModal();
    banner("Hold released.");
    refreshBalance();
    doSearch();
  }

  // ── Trips ────────────────────────────────────────────────────────────────────
  async function loadTrips() {
    const list = $("fsTrips");
    const refreshBtn = $("fsRefreshTrips");
    list.innerHTML = '<div class="fs-empty">Loading…</div>';
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…';
    }
    const { ok, status, body } = await api("GET", "/bookings");
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
    if (!ok) {
      list.innerHTML = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      return banner(status === 503 ? "Booking service offline." : body.error || "Could not load trips.", true);
    }
    const bookings = body.bookings || [];
    $("fsTripsSummary").textContent = `${bookings.length} booking(s)`;
    if (!bookings.length) {
      list.innerHTML = '<div class="fs-empty">No trips yet — book a stay from the Search tab.</div>';
      return;
    }
    list.innerHTML = bookings.map(renderTrip).join("");
    list.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => cancelTrip(b.dataset.cancel)));
    list.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => reviewTrip(b.dataset.review)));
    list.querySelectorAll("[data-details]").forEach((b) => b.addEventListener("click", () => openDetails(b.dataset.details)));
  }

  function renderTrip(b) {
    const canCancel = b.state === "hold" || b.state === "confirmed";
    const canReview = b.state === "completed";
    const refund = b.state === "cancelled" && b.refund_pct != null ? ` · refund ${b.refund_pct}%` : "";
    return `<div class="fs-row">
      <div class="fs-row-main">
        <div class="fs-row-title">${esc(b.property_id)} <span class="fs-state ${b.state}">${b.state}</span></div>
        <div class="fs-row-sub">${b.from} → ${b.to} · ${b.guests} guest(s) · ${formatROL(b.quote_total)} ROL${refund}</div>
      </div>
      <div class="fs-row-actions">
        <button class="fs-btn fs-btn-sm" data-details="${esc(b.property_id)}"><i class="fa-solid fa-circle-info"></i> Details</button>
        ${canCancel ? `<button class="fs-btn fs-btn-danger fs-btn-sm" data-cancel="${esc(b.id)}"><i class="fa-solid fa-ban"></i> Cancel</button>` : ""}
        ${canReview ? `<button class="fs-btn fs-btn-sm" data-review="${esc(b.id)}"><i class="fa-solid fa-star"></i> Review</button>` : ""}
      </div>
    </div>`;
  }

  async function cancelTrip(id) {
    const { ok, body } = await api("POST", `/bookings/${id}/cancel`);
    if (ok) {
      const refundMsg = body.refunded ? ` · ${formatROL(body.refunded)} ROL refunded` : "";
      banner(`Cancelled · refund ${body.refundPct}%${refundMsg}. Balance: ${formatROL(body.balance)} ROL.`);
      refreshBalance();
      loadTrips();
      if (lastSearch) doSearch(); // sync availability in search results
    } else {
      banner(body.error || "Could not cancel.");
    }
  }

  async function reviewTrip(id) {
    const rating = prompt("Rate your stay 1–5:");
    if (rating == null) return;
    const text = prompt("A few words about your stay (optional):") || "";
    const { ok, status, body } = await api("POST", `/bookings/${id}/review`, { rating: Number(rating), text });
    if (ok) banner("Thanks for your review!");
    else if (status === 409 && body.error === "NOT_COMPLETED") banner("You can review only after the stay is completed.");
    else banner(body.error || "Could not submit review.");
  }

  // ── Purchases (history + PDF receipts) ────────────────────────────────────────
  async function loadPurchases() {
    const list = $("fsPurchases");
    const btn = $("fsRefreshPurchases");
    list.innerHTML = '<div class="fs-empty">Loading…</div>';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…';
    }
    const { ok, status, body } = await api("GET", "/purchases");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
    if (!ok) {
      list.innerHTML = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      return banner(status === 503 ? "Booking service offline." : body.error || "Could not load purchases.", true);
    }
    const purchases = body.purchases || [];
    const spent = purchases.reduce((s, p) => s + (p.net || 0), 0);
    $("fsPurchasesSummary").textContent = purchases.length ? `${purchases.length} purchase(s) · ${formatROL(spent)} ROL net` : "";
    if (!purchases.length) {
      list.innerHTML = '<div class="fs-empty">No purchases yet — confirmed bookings show up here with a downloadable receipt.</div>';
      return;
    }
    list.innerHTML = purchases.map(renderPurchase).join("");
    list.querySelectorAll("[data-receipt]").forEach((b) => b.addEventListener("click", () => downloadReceipt(b.dataset.receipt, b)));
    list.querySelectorAll("[data-details]").forEach((b) => b.addEventListener("click", () => openDetails(b.dataset.details)));
  }

  function renderPurchase(p) {
    const refund = p.refunded > 0 ? ` · <span class="fs-refund">${formatROL(p.refunded)} ROL refunded</span>` : "";
    return `<div class="fs-row">
      <div class="fs-row-main">
        <div class="fs-row-title">${esc(p.propertyId)} <span class="fs-state ${p.state}">${p.state}</span></div>
        <div class="fs-row-sub">${p.from} → ${p.to} · ${p.guests} guest(s)</div>
        <div class="fs-row-sub">Charged <strong>${formatROL(p.charged)} ROL</strong> · net <strong>${formatROL(p.net)} ROL</strong>${refund}</div>
      </div>
      <div class="fs-row-actions">
        <button class="fs-btn fs-btn-sm" data-details="${esc(p.propertyId)}"><i class="fa-solid fa-circle-info"></i> Details</button>
        <button class="fs-btn fs-btn-primary fs-btn-sm" data-receipt="${esc(p.id)}"><i class="fa-solid fa-file-pdf"></i> Receipt</button>
      </div>
    </div>`;
  }

  // Fetch the PDF with the session cookie, then trigger a client-side download.
  // (A plain link would work same-origin too, but fetching lets us surface a
  // 403/503 as a banner instead of opening a broken tab.)
  async function downloadReceipt(bookingId, btn) {
    const original = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }
    try {
      const res = await fetch(`${API}/bookings/${encodeURIComponent(bookingId)}/receipt.pdf`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return banner(err.error || `Could not generate receipt (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `farmstay-receipt-${bookingId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      banner("Could not download receipt — is the app online?");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    }
  }

  // ── My travel (guest "your travel" summary) ──────────────────────────────────
  async function loadTravel() {
    const stats = $("fsTravelStats");
    const regions = $("fsTravelRegions");
    const charts = $("fsTravelCharts");
    const btn = $("fsRefreshTravel");
    stats.innerHTML = '<div class="fs-empty">Loading…</div>';
    regions.innerHTML = "";
    if (charts) charts.hidden = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…';
    }
    const { ok, status, body } = await api("GET", "/travel-summary");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
    if (!ok || !body.totals) {
      stats.innerHTML = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      return banner(status === 503 ? "Booking service offline." : body.error || "Could not load your travel summary.", true);
    }
    renderTravel(body);
  }

  async function renderTravel(a) {
    const t = a.totals || {};
    const spent = a.money ? a.money.net : t.spend;
    $("fsTravelSummary").textContent = t.trips
      ? `${t.trips} trip(s) · ${t.nights} night(s) · ${formatROL(spent)} ROL spent`
      : "";

    const stats = $("fsTravelStats");
    if (!t.trips) {
      stats.innerHTML = '<div class="fs-empty">No trips yet — confirmed and completed stays show up here as your travel history.</div>';
      $("fsTravelRegions").innerHTML = "";
      renderHeatmap("fsTravelHeatmap", "fsTravelHeatPeak", [], null);
      return;
    }
    renderHeatmap("fsTravelHeatmap", "fsTravelHeatPeak", a.occupancyByDay, a.peakDay);
    stats.innerHTML = [
      ["fa-suitcase-rolling", "Trips", t.trips],
      ["fa-moon", "Nights stayed", t.nights],
      ["fa-people-group", "Guest-nights", t.guestNights],
      ["fa-wallet", "Total spent", `${formatROL(spent)} ROL`],
      ["fa-map-pin", "Favourite region", a.favouriteRegion || "—"],
      ["fa-hourglass-half", "Upcoming", t.upcoming],
    ]
      .map(
        ([icon, label, value]) =>
          `<div class="fs-stat"><div class="fs-stat-label"><i class="fa-solid ${icon}"></i> ${label}</div><div class="fs-stat-value">${value}</div></div>`,
      )
      .join("");

    // Region breakdown list
    const byRegion = a.byRegion || [];
    $("fsTravelRegions").innerHTML = byRegion.length
      ? byRegion
          .map(
            (r) =>
              `<div class="fs-row"><div class="fs-row-main"><div class="fs-row-title"><i class="fa-solid fa-location-dot"></i> ${esc(r.region)}</div><div class="fs-row-sub">${r.trips} trip(s) · ${r.nights} night(s) · ${formatROL(r.spend)} ROL</div></div></div>`,
          )
          .join("")
      : "";

    const chartsEl = $("fsTravelCharts");
    const ready = await ensureChartJs();
    if (!ready || !chartsEl) {
      if (chartsEl) chartsEl.hidden = true;
      return;
    }
    chartsEl.hidden = false;

    drawChart("fsChartTravelRegion", {
      type: "pie",
      data: {
        labels: byRegion.map((r) => r.region),
        datasets: [{ data: byRegion.map((r) => r.nights), backgroundColor: byRegion.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }],
      },
      options: withLegend,
    });

    const months = a.byMonth || [];
    drawChart("fsChartTravelSpend", {
      type: "bar",
      data: {
        labels: months.map((m) => m.month),
        datasets: [{ label: "Spend (ROL)", data: months.map((m) => m.spend), backgroundColor: CHART_COLORS[2] }],
      },
      options: noLegend,
    });

    const byType = a.byType || [];
    drawChart("fsChartTravelType", {
      type: "doughnut",
      data: {
        labels: byType.map((x) => x.type),
        datasets: [{ data: byType.map((x) => x.nights), backgroundColor: byType.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }],
      },
      options: withLegend,
    });
  }

  // ── Host bookings (shared by Listings occupancy + Hosting tab) ───────────────
  async function fetchHostBookings() {
    const { ok, body } = await api("GET", "/bookings?role=host");
    return ok && Array.isArray(body.bookings) ? body.bookings : [];
  }

  // A listing is "occupied" (undeletable) while it has an active hold or an
  // upcoming/ongoing confirmed stay. Completed/cancelled stays don't block.
  function occupiedPropertyIds(hostBookings) {
    const s = new Set();
    for (const b of hostBookings) if (b.state === "hold" || b.state === "confirmed") s.add(b.property_id);
    return s;
  }

  // ── Listings (host) ─────────────────────────────────────────────────────────
  async function loadListings() {
    const list = $("fsListings");
    list.innerHTML = '<div class="fs-empty">Loading…</div>';
    const [res, hostBookings] = await Promise.all([api("GET", "/properties/mine"), fetchHostBookings()]);
    const { ok, status, body } = res;
    if (!ok) {
      list.innerHTML = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      return banner(status === 503 ? "Inventory service offline." : body.error || "Could not load listings.", true);
    }
    const props = body.properties || [];
    const occupied = occupiedPropertyIds(hostBookings);
    $("fsListingsSummary").textContent = `${props.length} listing(s)`;
    list.innerHTML = props.length
      ? props.map((p) => renderListing(p, occupied.has(p.id))).join("")
      : '<div class="fs-empty">No listings yet — publish one above.</div>';
    list
      .querySelectorAll("[data-delete]")
      .forEach((b) => b.addEventListener("click", () => deleteListing(b.dataset.delete, b.dataset.name)));
  }

  function renderListing(p, isOccupied) {
    const photo = photoLook(p);
    const amenities = (p.amenities || []).map(amenityChip).join("");
    const del = isOccupied
      ? `<button class="fs-btn fs-btn-sm" disabled title="Has active or upcoming bookings — can't remove"><i class="fa-solid fa-lock"></i> Booked</button>`
      : `<button class="fs-btn fs-btn-danger fs-btn-sm" data-delete="${esc(p.id)}" data-name="${esc(p.name)}"><i class="fa-solid fa-trash"></i> Remove</button>`;
    return `<div class="fs-row">
      <div class="fs-row-thumb" style="background:${photo.gradient}"><i class="fa-solid ${photo.icon}"></i></div>
      <div class="fs-row-main">
        <div class="fs-row-title">${esc(p.name)} ${p.active ? "" : '<span class="fs-state expired">inactive</span>'}</div>
        <div class="fs-row-sub"><i class="fa-solid fa-location-dot"></i> ${esc(p.district || "—")} · ${esc(p.type)} · up to ${p.capacity} · ${formatROL(p.base_price)} ROL/night · ${esc(p.policy)}</div>
        ${amenities ? `<div class="fs-card-amenities">${amenities}</div>` : ""}
      </div>
      <div class="fs-row-actions">${del}</div>
    </div>`;
  }

  async function deleteListing(id, name) {
    if (!window.confirm(`Remove listing "${name}"? This cannot be undone.`)) return;
    const { ok, status, body } = await api("DELETE", `/properties/${encodeURIComponent(id)}`);
    if (ok) {
      banner("Listing removed.");
      loadListings();
    } else if (status === 409) {
      banner("Can't remove — this listing has active or upcoming bookings.", true);
    } else {
      banner(body.error || "Could not remove listing.");
    }
  }

  // ── Listing form: amenity + photo pickers ────────────────────────────────────
  function renderAmenityPicker() {
    const el = $("lAmenities");
    if (!el) return;
    el.innerHTML = (catalog.amenities || [])
      .map((a) => {
        const on = listingDraft.amenities.has(a.key);
        return `<button type="button" class="fs-amenity-opt${on ? " selected" : ""}" data-amenity="${esc(a.key)}" aria-pressed="${on}">
        <i class="fa-solid ${esc(a.icon)}"></i> ${esc(a.label)}
      </button>`;
      })
      .join("");
    el.querySelectorAll("[data-amenity]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const a = btn.dataset.amenity;
        if (listingDraft.amenities.has(a)) listingDraft.amenities.delete(a);
        else listingDraft.amenities.add(a);
        btn.classList.toggle("selected");
        btn.setAttribute("aria-pressed", String(listingDraft.amenities.has(a)));
      }),
    );
  }

  function renderPhotoPicker() {
    const el = $("lPhotoThemes");
    if (!el) return;
    el.innerHTML = (catalog.photoThemes || [])
      .map((t) => {
        const on = listingDraft.photo === t.key;
        return `<button type="button" class="fs-theme-opt${on ? " selected" : ""}" data-theme="${esc(t.key)}" aria-pressed="${on}" title="${esc(t.label)}" style="background:${t.gradient}">
        <i class="fa-solid ${esc(t.icon)}"></i>
        <span>${esc(t.label)}</span>
      </button>`;
      })
      .join("");
    el.querySelectorAll("[data-theme]").forEach((btn) =>
      btn.addEventListener("click", () => {
        listingDraft.photo = btn.dataset.theme;
        el.querySelectorAll("[data-theme]").forEach((b) => {
          const sel = b === btn;
          b.classList.toggle("selected", sel);
          b.setAttribute("aria-pressed", String(sel));
        });
      }),
    );
  }

  function resetListingDraft() {
    listingDraft.amenities.clear();
    listingDraft.photo = catalog.photoThemes[0]?.key || "";
    renderAmenityPicker();
    renderPhotoPicker();
  }

  // Fill the type + policy <select>s from the catalog. Leaves the HTML defaults
  // in place when the catalog is empty (e.g. gateway offline) so the form still
  // works.
  function populateTypeAndPolicySelects() {
    const typeOpts = (catalog.types || []).map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("");
    if (typeOpts) {
      const lType = $("lType");
      if (lType) lType.innerHTML = typeOpts;
      const fsType = $("fsType");
      if (fsType) fsType.innerHTML = `<option value="">Any</option>${typeOpts}`;
    }
    const policyOpts = (catalog.policies || [])
      .map((p) => `<option value="${esc(p.key)}"${p.key === "moderate" ? " selected" : ""}>${esc(p.label)}</option>`)
      .join("");
    if (policyOpts) {
      const lPolicy = $("lPolicy");
      if (lPolicy) lPolicy.innerHTML = policyOpts;
    }
  }

  async function createListing(e) {
    e.preventDefault();
    const payload = {
      name: $("lName").value,
      type: $("lType").value,
      district: $("lDistrict").value,
      capacity: Number($("lCapacity").value) || 1,
      basePrice: Number($("lBasePrice").value) || 0,
      policy: $("lPolicy").value,
      amenities: [...listingDraft.amenities],
      photoRef: listingDraft.photo,
    };
    const { ok, status, body } = await api("POST", "/properties", payload);
    if (ok) {
      banner("Listing published!");
      $("fsListingForm").reset();
      resetListingDraft();
      loadListings();
    } else {
      banner(status === 401 ? "Please log in first." : body.error || "Could not publish listing.");
    }
  }

  // ── Charts (Chart.js, loaded on demand from CDN — same as staff pages) ────────
  const CHART_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
  const chartInstances = {};
  let chartJsPromise = null;
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve(true);
    if (!chartJsPromise) {
      chartJsPromise = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = CHART_CDN;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
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

  // ── Occupancy heatmap (GitHub-style per-day timeline) — shared by Hosting + My travel ──
  const HEAT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const HEAT_DAY = 86400000;

  function heatLevel(count, max) {
    if (!count) return 0;
    if (max <= 1) return 4;
    const r = count / max;
    if (r > 0.75) return 4;
    if (r > 0.5) return 3;
    if (r > 0.25) return 2;
    return 1;
  }

  // One calendar year as a 7×N (day-of-week × week) grid, Monday-based.
  function heatYearGrid(year, lookup, max) {
    const startDow = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7; // Mon=0
    const gridStart = Date.UTC(year, 0, 1) - startDow * HEAT_DAY; // Monday on/before Jan 1
    const numWeeks = Math.ceil((Date.UTC(year, 11, 31) - gridStart) / HEAT_DAY / 7) + 1;
    const cells = [];
    const labels = new Array(numWeeks).fill("");
    for (let w = 0; w < numWeeks; w++) {
      for (let r = 0; r < 7; r++) {
        const dt = new Date(gridStart + (w * 7 + r) * HEAT_DAY);
        if (dt.getUTCFullYear() !== year) {
          cells.push('<span class="fs-heat-cell empty"></span>');
          continue;
        }
        const ds = dt.toISOString().slice(0, 10);
        if (dt.getUTCDate() === 1) labels[w] = HEAT_MONTHS[dt.getUTCMonth()];
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

  function renderHeatmap(mapId, peakId, occupancyByDay, peakDay) {
    const wrap = $(mapId);
    const card = wrap ? wrap.closest(".fs-heat-card") : null;
    const days = occupancyByDay || [];
    if (!days.length) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;

    const lookup = {};
    let max = 0;
    for (const d of days) {
      lookup[d.date] = d;
      if (d.bookings > max) max = d.bookings;
    }
    const peakEl = $(peakId);
    if (peakEl) peakEl.textContent = peakDay ? `· busiest ${peakDay.date}: ${peakDay.bookings} stay(s), ${peakDay.guests} guest(s)` : "";

    const firstYear = Number(days[0].date.slice(0, 4));
    const lastYear = Number(days[days.length - 1].date.slice(0, 4));
    let html = "";
    for (let y = firstYear; y <= lastYear; y++) html += heatYearGrid(y, lookup, max);
    wrap.innerHTML = html;
  }

  async function renderHostAnalytics(a) {
    const statEl = $("fsHostStats");
    const chartsEl = $("fsHostCharts");
    if (!a || !a.totals) {
      if (statEl) statEl.innerHTML = "";
      if (chartsEl) chartsEl.hidden = true;
      renderHeatmap("fsHostHeatmap", "fsHostHeatPeak", [], null);
      return;
    }
    renderHeatmap("fsHostHeatmap", "fsHostHeatPeak", a.occupancyByDay, a.peakDay);
    const t = a.totals;
    const occ = (a.occupancyByYear || []).reduce((s, y) => s + y.nights, 0);
    if (statEl) {
      statEl.innerHTML = [
        ["fa-users", "Distinct visitors", t.distinctVisitors],
        ["fa-moon", "Nights booked", t.nightsBooked],
        ["fa-people-roof", "Guest-nights", t.guestNights],
        ["fa-calendar-days", "Occupied nights", occ],
        ["fa-star", "Avg rating", t.avgRating ? `${t.avgRating} (${t.reviews})` : "—"],
      ]
        .map(
          ([icon, label, value]) =>
            `<div class="fs-stat"><div class="fs-stat-label"><i class="fa-solid ${icon}"></i> ${label}</div><div class="fs-stat-value">${value}</div></div>`,
        )
        .join("");
    }

    const ok = await ensureChartJs();
    if (!ok || !chartsEl) {
      if (chartsEl) chartsEl.hidden = true;
      return;
    }
    chartsEl.hidden = false;

    const months = a.incomeByMonth || [];
    drawChart("fsChartIncome", {
      type: "bar",
      data: {
        labels: months.map((m) => m.month),
        datasets: [{ label: "Income (ROL)", data: months.map((m) => m.income), backgroundColor: CHART_COLORS[0] }],
      },
      options: noLegend,
    });

    const years = a.occupancyByYear || [];
    drawChart("fsChartOccupancy", {
      type: "bar",
      data: {
        labels: years.map((y) => y.year),
        datasets: [{ label: "Occupied nights", data: years.map((y) => y.nights), backgroundColor: CHART_COLORS[1] }],
      },
      options: noLegend,
    });

    drawChart("fsChartVisitors", {
      type: "line",
      data: {
        labels: months.map((m) => m.month),
        datasets: [
          {
            label: "Visitors",
            data: months.map((m) => m.visitors),
            borderColor: CHART_COLORS[3],
            backgroundColor: CHART_COLORS[3],
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: noLegend,
    });

    const props = (a.perProperty || []).filter((p) => p.income > 0);
    drawChart("fsChartByProperty", {
      type: "pie",
      data: {
        labels: props.map((p) => p.name),
        datasets: [{ data: props.map((p) => p.income), backgroundColor: props.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }],
      },
      options: withLegend,
    });

    const states = a.stateDistribution || {};
    const stateKeys = Object.keys(states);
    const stateColor = { hold: "#e0a458", confirmed: "#5b9bd5", completed: "#4c9a63", cancelled: "#d45087", expired: "#999" };
    drawChart("fsChartStates", {
      type: "doughnut",
      data: {
        labels: stateKeys,
        datasets: [{ data: stateKeys.map((k) => states[k]), backgroundColor: stateKeys.map((k) => stateColor[k] || "#888") }],
      },
      options: withLegend,
    });
  }

  // ── Hosting (earnings + analytics + occupancy) ────────────────────────────────
  async function loadHosting() {
    const list = $("fsHosting");
    const earn = $("fsEarnings");
    const btn = $("fsRefreshHosting");
    list.innerHTML = '<div class="fs-empty">Loading…</div>';
    earn.innerHTML = "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…';
    }
    const [res, hostBookings, analytics] = await Promise.all([
      api("GET", "/properties/mine"),
      fetchHostBookings(),
      api("GET", "/hosting/analytics"),
    ]);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
    renderHostAnalytics(analytics.ok ? analytics.body : null);
    refreshBalance(); // completed stays may have paid out on this load

    const props = res.ok && Array.isArray(res.body.properties) ? res.body.properties : [];
    const propById = Object.fromEntries(props.map((p) => [p.id, p]));

    const paidOut = hostBookings.filter((b) => b.state === "completed").reduce((s, b) => s + (b.quote_total || 0), 0);
    const upcoming = hostBookings.filter((b) => b.state === "confirmed").reduce((s, b) => s + (b.quote_total || 0), 0);
    const activeCount = hostBookings.filter((b) => ["hold", "confirmed", "completed"].includes(b.state)).length;
    $("fsHostingSummary").textContent = `${props.length} listing(s) · ${hostBookings.length} booking(s)`;
    earn.innerHTML = `
      <div class="fs-earn-card paid"><div class="fs-earn-label"><i class="fa-solid fa-sack-dollar"></i> Earned (paid out)</div><div class="fs-earn-value">${formatROL(paidOut)} <small>ROL</small></div></div>
      <div class="fs-earn-card up"><div class="fs-earn-label"><i class="fa-solid fa-hourglass-half"></i> Upcoming</div><div class="fs-earn-value">${formatROL(upcoming)} <small>ROL</small></div></div>
      <div class="fs-earn-card"><div class="fs-earn-label"><i class="fa-solid fa-calendar-check"></i> Active bookings</div><div class="fs-earn-value">${activeCount}</div></div>`;

    const relevant = hostBookings.filter((b) => ["hold", "confirmed", "completed", "cancelled"].includes(b.state));
    if (!relevant.length) {
      list.innerHTML = '<div class="fs-empty">No bookings on your listings yet.</div>';
      return;
    }
    const byProp = {};
    for (const b of relevant) (byProp[b.property_id] = byProp[b.property_id] || []).push(b);
    list.innerHTML = Object.entries(byProp)
      .map(([pid, bookings]) => renderHostProperty(pid, propById[pid], bookings))
      .join("");
  }

  function renderHostProperty(pid, prop, bookings) {
    const photo = prop ? photoLook(prop) : DEFAULT_LOOK;
    const name = prop ? esc(prop.name) : `${esc(pid)} <small>(removed listing)</small>`;
    const cal = renderOccupancyCalendar(bookings);
    const rows = bookings
      .slice()
      .sort((a, b) => (a.from < b.from ? 1 : -1))
      .map((b) => {
        const payout =
          b.state === "completed"
            ? '<span class="fs-payout paid"><i class="fa-solid fa-check"></i> paid out</span>'
            : b.state === "confirmed"
              ? '<span class="fs-payout pending">pays on checkout</span>'
              : "";
        return `<div class="fs-host-bk">
          <span class="fs-state ${b.state}">${b.state}</span>
          <span class="fs-host-bk-dates"><i class="fa-regular fa-calendar"></i> ${b.from} → ${b.to}</span>
          <span class="fs-host-bk-guest"><i class="fa-solid fa-user"></i> ${esc(b.guest_id)}</span>
          <span class="fs-host-bk-money">${formatROL(b.quote_total)} ROL ${payout}</span>
        </div>`;
      })
      .join("");
    return `<div class="fs-host-prop">
      <div class="fs-host-prop-head">
        <div class="fs-row-thumb" style="background:${photo.gradient}"><i class="fa-solid ${photo.icon}"></i></div>
        <div class="fs-host-prop-title">${name}</div>
      </div>
      ${cal}
      <div class="fs-host-bookings">${rows}</div>
    </div>`;
  }

  // Client-side night enumeration for [from, to) (half-open), UTC.
  function eachNightC(from, to) {
    const out = [];
    let t = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    while (t < end) {
      out.push(new Date(t).toISOString().slice(0, 10));
      t += 86400000;
    }
    return out;
  }

  // Full-month occupancy calendar built from a listing's bookings: each booked
  // night is coloured and carries a guest/amount tooltip.
  function renderOccupancyCalendar(bookings) {
    const nights = {};
    for (const b of bookings) {
      if (!["confirmed", "completed", "hold"].includes(b.state)) continue;
      for (const d of eachNightC(b.from, b.to)) nights[d] = b;
    }
    const dates = Object.keys(nights).sort();
    if (!dates.length) return "";
    const dow = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    let [y, m] = dates[0].slice(0, 7).split("-").map(Number); // m is 1-based
    const [ey, em] = dates[dates.length - 1].slice(0, 7).split("-").map(Number);
    let html = '<div class="fs-cal-wrap">';
    while (y < ey || (y === ey && m <= em)) {
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon-based
      html += `<div class="fs-cal"><div class="fs-cal-month">${esc(label)}</div><div class="fs-cal-grid">`;
      html += dow.map((d) => `<div class="fs-cal-dow">${d}</div>`).join("");
      if (firstDow) html += `<div class="fs-cal-cell fs-cal-pad" style="grid-column: span ${firstDow}"></div>`;
      for (let day = 1; day <= daysInMonth; day++) {
        const ds = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const b = nights[ds];
        if (b) {
          const cls = b.state === "hold" ? "occ-hold" : "occ";
          html += `<div class="fs-cal-cell ${cls}" title="${ds}: ${esc(b.guest_id)} · ${formatROL(b.quote_total)} ROL (${esc(b.state)})">${day}</div>`;
        } else {
          html += `<div class="fs-cal-cell">${day}</div>`;
        }
      }
      html += "</div></div>";
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    html += '<div class="fs-cal-legend"><span class="occ"></span> booked <span class="occ-hold"></span> on hold</div></div>';
    return html;
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    populateLocationSelect($("fsDistrict"), { includeAny: true });
    populateLocationSelect($("lDistrict"), { includeAny: false });
    initTabs();
    defaultDates();
    $("fsSearchForm").addEventListener("submit", doSearch);
    $("fsRefreshTrips").addEventListener("click", loadTrips);
    $("fsRefreshPurchases").addEventListener("click", loadPurchases);
    $("fsRefreshTravel").addEventListener("click", loadTravel);
    $("fsRefreshHosting").addEventListener("click", loadHosting);
    $("fsListingForm").addEventListener("submit", createListing);
    $("fsModalClose").addEventListener("click", closeModal);
    $("fsModal").addEventListener("click", (e) => {
      if (e.target === $("fsModal")) closeModal();
    });

    // Populate region picker in the custom location form
    const voiSel = $("lCustomVoi");
    if (voiSel) {
      voiSel.innerHTML =
        '<option value="">Region…</option>' +
        Object.keys(PL_LOCATIONS)
          .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
          .join("");
    }

    // Custom location handlers
    const addLocBtn = $("lAddCustomLoc");
    if (addLocBtn) addLocBtn.addEventListener("click", addCustomLoc);
    const locInput = $("lCustomLoc");
    if (locInput)
      locInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addCustomLoc();
        }
      });
    renderCustomLocs();

    // Load the backend catalog before rendering anything that depends on it
    // (pickers, type/policy selects, and card photo gradients in search).
    await loadCatalog();
    populateTypeAndPolicySelects();
    renderAmenityPicker();
    renderPhotoPicker();

    refreshHealth();
    refreshBalance();
    setInterval(refreshHealth, 8000);
    doSearch();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
