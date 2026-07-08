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

  // Icons for known amenity tags shown inside chips
  const AMENITY_ICON = {
    kitchen: "fa-kitchen-set",
    wifi: "fa-wifi",
    fireplace: "fa-fire",
    parking: "fa-square-parking",
    breakfast: "fa-mug-hot",
    animals: "fa-paw",
    firepit: "fa-fire-flame-curved",
    water: "fa-droplet",
    garden: "fa-seedling",
    spa: "fa-spa",
    gym: "fa-dumbbell",
    "beach-access": "fa-umbrella-beach",
    shower: "fa-shower",
    "wine-cellar": "fa-wine-glass",
    fishing: "fa-fish",
    "mountain-views": "fa-mountain",
    kayaks: "fa-anchor",
    terrace: "fa-sun",
  };

  // Card photo icon per stay type
  const TYPE_ICON = { room: "fa-bed", cottage: "fa-house-chimney", camping: "fa-tent" };

  // ── Formatting ──────────────────────────────────────────────────────────────
  function formatROL(n) {
    // Round to 2 decimal places, remove trailing zeros for display.
    return String(Math.round((Number(n) + Number.EPSILON) * 100) / 100);
  }

  // ── Custom locations ─────────────────────────────────────────────────────────
  function loadCustomLocs() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_LOC_KEY) || "[]");
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
      frag.push(`<optgroup label="${voi}">`);
      for (const c of cities) frag.push(`<option value="${c}">${c}</option>`);
      frag.push("</optgroup>");
    }
    if (custom.length) {
      frag.push('<optgroup label="Custom">');
      for (const c of custom) frag.push(`<option value="${c}">${c}</option>`);
      frag.push("</optgroup>");
    }
    sel.innerHTML = frag.join("");
  }

  function renderCustomLocs() {
    const el = $("fsCustomLocs");
    if (!el) return;
    const locs = loadCustomLocs();
    if (!locs.length) {
      el.innerHTML = '<span class="fs-note">No custom locations added yet.</span>';
      return;
    }
    el.innerHTML = locs
      .map(
        (c) =>
          `<span class="fs-chip fs-chip-loc">${esc(c)} <button class="fs-chip-rm" data-rm="${esc(c)}" title="Remove">&times;</button></span>`,
      )
      .join(" ");
    el.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        const remaining = loadCustomLocs().filter((x) => x !== b.dataset.rm);
        saveCustomLocs(remaining);
        refreshAllLocationSelects();
        renderCustomLocs();
      }),
    );
  }

  function addCustomLoc() {
    const input = $("lCustomLoc");
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const locs = loadCustomLocs();
    if (!locs.includes(val)) {
      locs.push(val);
      saveCustomLocs(locs);
      refreshAllLocationSelects();
      renderCustomLocs();
    }
    input.value = "";
    input.focus();
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
        if (tab.dataset.tab === "listings") loadListings();
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
    const icon = AMENITY_ICON[a];
    const iTag = icon ? `<i class="fa-solid ${icon}"></i> ` : "";
    return `<span class="fs-chip">${iTag}${esc(a)}</span>`;
  }

  function renderCard(p) {
    const price =
      p.quoteStatus === "ok" && p.quote
        ? `<span class="fs-price">${formatROL(p.quote.total)} <small>${p.quote.currency}<br>total</small></span>`
        : `<span class="fs-price unavailable">price offline</span>`;
    const amenities = (p.amenities || []).map(amenityChip).join("");
    return `<article class="fs-card">
      <div class="fs-card-photo type-${esc(p.type)}"><i class="fa-solid ${TYPE_ICON[p.type] || "fa-house"}"></i></div>
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
            <button class="fs-btn fs-btn-primary fs-btn-sm" data-book="${esc(p.id)}" data-name="${esc(p.name)}"><i class="fa-solid fa-calendar-plus"></i> Book</button>
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
    openModal(`
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
          `<div><span>${n.date}${n.weekend ? " (wknd)" : ""} · ${n.season}</span><span>${formatROL(n.price)} ${quote.currency}</span></div>`,
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

  // ── Listings (host) ─────────────────────────────────────────────────────────
  async function loadListings() {
    const list = $("fsListings");
    list.innerHTML = '<div class="fs-empty">Loading…</div>';
    const { ok, status, body } = await api("GET", "/properties/mine");
    if (!ok) {
      list.innerHTML = "";
      if (status === 401) return banner("Please log in to use FarmStay.", true);
      return banner(status === 503 ? "Inventory service offline." : body.error || "Could not load listings.", true);
    }
    const props = body.properties || [];
    $("fsListingsSummary").textContent = `${props.length} listing(s)`;
    list.innerHTML = props.length ? props.map(renderListing).join("") : '<div class="fs-empty">No listings yet — publish one above.</div>';
  }

  function renderListing(p) {
    return `<div class="fs-row">
      <div class="fs-row-main">
        <div class="fs-row-title">${esc(p.name)} ${p.active ? "" : '<span class="fs-state expired">inactive</span>'}</div>
        <div class="fs-row-sub"><i class="fa-solid fa-location-dot"></i> ${esc(p.district || "—")} · ${esc(p.type)} · up to ${p.capacity} · ${formatROL(p.base_price)} ROL/night · ${esc(p.policy)}</div>
      </div>
    </div>`;
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
    };
    const { ok, status, body } = await api("POST", "/properties", payload);
    if (ok) {
      banner("Listing published!");
      $("fsListingForm").reset();
      loadListings();
    } else {
      banner(status === 401 ? "Please log in first." : body.error || "Could not publish listing.");
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    populateLocationSelect($("fsDistrict"), { includeAny: true });
    populateLocationSelect($("lDistrict"), { includeAny: false });
    initTabs();
    defaultDates();
    $("fsSearchForm").addEventListener("submit", doSearch);
    $("fsRefreshTrips").addEventListener("click", loadTrips);
    $("fsListingForm").addEventListener("submit", createListing);
    $("fsModalClose").addEventListener("click", closeModal);
    $("fsModal").addEventListener("click", (e) => {
      if (e.target === $("fsModal")) closeModal();
    });

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

    refreshHealth();
    refreshBalance();
    setInterval(refreshHealth, 8000);
    doSearch();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
