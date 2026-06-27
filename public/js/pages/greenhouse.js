/**
 * Greenhouse page — two tabs:
 *   1) gRPC Examples — clickable demos of the unary + server-streaming call types.
 *   2) My Greenhouses — the "Grow a Plant" feature (plant / water / harvest, live).
 *
 * Both talk to the standalone greenhouse gRPC service through the app (REST for
 * unary, a WebSocket bridge for the WatchGreenhouses server-stream).
 *
 * Identity: logged-in user → session cookie; anonymous → per-tab demo id in
 * sessionStorage, sent as x-greenhouse-demo-id (REST) / demoId (WebSocket).
 */
(function () {
  "use strict";

  const API = "/api/v1/greenhouse";
  const STAGE_EMOJI = { seed: "🌰", sprout: "🌱", growing: "🌿", budding: "🪴" };

  const els = {};
  let crops = [];
  let ws = null;
  const selectedCrop = {};

  // ── identity / fetch helpers ────────────────────────────────────────────────

  function hasSession() {
    return /(?:^|;\s*)rolnopolLoginTime=/.test(document.cookie) || /(?:^|;\s*)rolnopolIsLogged=true/.test(document.cookie);
  }
  function getDemoId() {
    if (hasSession()) return null;
    let id = sessionStorage.getItem("greenhouseDemoId");
    if (!id) {
      id = "demo-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem("greenhouseDemoId", id);
    }
    return id;
  }
  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    const demo = getDemoId();
    if (demo) headers["x-greenhouse-demo-id"] = demo;
    return headers;
  }

  let bannerTimer = null;
  let bannerOffline = false;
  function showBanner(message, opts) {
    const persist = !!(opts && opts.persist);
    els.banner.textContent = message;
    els.banner.hidden = false;
    bannerOffline = persist;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = persist ? null : setTimeout(() => (els.banner.hidden = true), 6000);
  }
  function clearBanner() {
    els.banner.hidden = true;
    bannerOffline = false;
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
  }

  const OFFLINE_MSG = "Greenhouse service offline — run `npm run greenhouse`, then refresh.";

  async function api(method, pathname, body) {
    const opts = {
      method,
      headers: authHeaders(body ? { "Content-Type": "application/json" } : undefined),
      credentials: "include",
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${API}${pathname}`, opts);
    } catch (e) {
      // Network-level failure (app unreachable / connection reset) — treat as offline.
      showBanner(OFFLINE_MSG, { persist: true });
      return null;
    }
    if (res.status === 503) {
      showBanner(OFFLINE_MSG, { persist: true });
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showBanner(json?.error || `Request failed (HTTP ${res.status}).`);
      return null;
    }
    clearBanner();
    return json;
  }

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams();
    const demo = getDemoId();
    if (demo) qs.set("demoId", demo);
    return `${proto}://${location.host}${API}/ws?${qs.toString()}`;
  }

  // ── Tab 1: gRPC examples ────────────────────────────────────────────────────

  const UNARY_EXAMPLES = {
    listCrops: { path: "/crops", label: "GreenhouseControl.ListCrops", pick: (j) => j.data },
    listGreenhouses: { path: "", label: "GreenhouseControl.ListGreenhouses", pick: (j) => ({ data: j.data, meta: j.meta }) },
  };

  async function runUnaryExample(which) {
    const ex = UNARY_EXAMPLES[which];
    els.exUnaryOut.textContent = `// calling ${ex.label} ...`;
    const json = await api("GET", ex.path);
    if (!json) {
      els.exUnaryOut.textContent = `// ${ex.label} failed — see the banner above`;
      return;
    }
    els.exUnaryOut.textContent = `// Unary RPC → ${ex.label}\n` + JSON.stringify(ex.pick(json), null, 2);
  }

  let exWs = null;
  let exFrames = 0;
  let exLines = [];

  function summarizeFrame(frame) {
    const slots = (frame.greenhouses || [])
      .map((g) => (g.occupied && g.plant ? `s${g.slot}:${g.plant.emoji}${g.plant.growth}%` : `s${g.slot}:—`))
      .join("  ");
    return `[tick ${frame.tick}] ${slots}`;
  }
  function pushExLine(line) {
    exLines.unshift(line);
    exLines = exLines.slice(0, 14);
    els.exStreamOut.textContent = exLines.join("\n");
  }

  function exStreamStop() {
    if (exWs) {
      try {
        exWs.onclose = null;
        exWs.close();
      } catch (e) {
        /* ignore */
      }
      exWs = null;
    }
    els.exStreamStart.disabled = false;
    els.exStreamStop.disabled = true;
  }

  function exStreamStart() {
    exStreamStop();
    exFrames = 0;
    exLines = [];
    els.exFrames.textContent = "0";
    els.exStreamOut.textContent = "// opened stream → GreenhouseControl.WatchGreenhouses\n// waiting for frames…";
    els.exStreamStart.disabled = true;
    els.exStreamStop.disabled = false;

    exWs = new WebSocket(wsUrl());
    exWs.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.type === "frame") {
        exFrames += 1;
        els.exFrames.textContent = String(exFrames);
        pushExLine(summarizeFrame(msg.frame));
      } else if (msg.type === "error") {
        pushExLine("// error: " + (msg.message || "stream error"));
      }
    };
    exWs.onclose = () => {
      els.exStreamStart.disabled = false;
      els.exStreamStop.disabled = true;
    };
  }

  function setupExamples() {
    els.exUnaryOut = document.getElementById("ghExUnaryOut");
    els.exStreamOut = document.getElementById("ghExStreamOut");
    els.exFrames = document.getElementById("ghExFrames");
    els.exStreamStart = document.getElementById("ghExStreamStart");
    els.exStreamStop = document.getElementById("ghExStreamStop");

    document.querySelectorAll("[data-ex]").forEach((btn) => {
      btn.addEventListener("click", () => runUnaryExample(btn.getAttribute("data-ex")));
    });
    els.exStreamStart.addEventListener("click", exStreamStart);
    els.exStreamStop.addEventListener("click", exStreamStop);
  }

  // ── Tab 2: Grow-a-Plant ─────────────────────────────────────────────────────

  function plantEmoji(plant) {
    return plant.ripe ? plant.emoji : STAGE_EMOJI[plant.stage] || "🌱";
  }

  function buildSlots() {
    els.slots.innerHTML = "";
    const cropOptions = crops.map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");

    for (let slot = 1; slot <= 3; slot++) {
      const card = document.createElement("div");
      card.className = "gh-slot";
      card.dataset.slot = String(slot);
      card.innerHTML = `
        <div class="gh-slot-title">Greenhouse ${slot}</div>
        <div class="gh-slot-empty">
          <div class="gh-empty-hint">Empty — pick a seed</div>
          <select class="gh-crop-select">${cropOptions}</select>
          <button class="gh-btn gh-plant-btn">🌱 Plant</button>
        </div>
        <div class="gh-slot-plant" hidden>
          <div class="gh-plant-emoji">🌱</div>
          <div class="gh-plant-name">—</div>
          <div class="gh-plant-stage">seed</div>
          <div class="gh-bar growth"><span class="fill"></span><label>Growth <b>0%</b></label></div>
          <div class="gh-bar water"><span class="fill"></span><label>Water <b>0%</b></label></div>
          <div class="gh-thirsty" hidden>💧 thirsty — needs water</div>
          <div class="gh-actions">
            <button class="gh-btn water gh-water-btn">💧 Water</button>
            <button class="gh-btn gh-harvest-btn" disabled>🧺 Harvest</button>
          </div>
        </div>`;

      const select = card.querySelector(".gh-crop-select");
      if (selectedCrop[slot]) select.value = selectedCrop[slot];
      select.addEventListener("change", () => (selectedCrop[slot] = select.value));
      card.querySelector(".gh-plant-btn").addEventListener("click", () => doPlant(slot, select.value));
      card.querySelector(".gh-water-btn").addEventListener("click", () => doAction(slot, "water"));
      card.querySelector(".gh-harvest-btn").addEventListener("click", () => doAction(slot, "harvest"));

      els.slots.appendChild(card);
    }
  }

  function updateSlots(snapshot) {
    if (typeof snapshot.harvested === "number") els.harvested.textContent = snapshot.harvested;
    for (const gh of snapshot.greenhouses) {
      const card = els.slots.querySelector(`.gh-slot[data-slot="${gh.slot}"]`);
      if (!card) continue;
      const emptyView = card.querySelector(".gh-slot-empty");
      const plantView = card.querySelector(".gh-slot-plant");

      if (!gh.occupied || !gh.plant) {
        emptyView.hidden = false;
        plantView.hidden = true;
        card.classList.remove("ripe");
        continue;
      }

      const p = gh.plant;
      emptyView.hidden = true;
      plantView.hidden = false;
      card.classList.toggle("ripe", !!p.ripe);

      card.querySelector(".gh-plant-emoji").textContent = plantEmoji(p);
      card.querySelector(".gh-plant-name").textContent = p.crop_name;
      card.querySelector(".gh-plant-stage").textContent = p.ripe ? "ripe — ready to harvest!" : p.stage;

      const growthBar = card.querySelector(".gh-bar.growth");
      growthBar.querySelector(".fill").style.width = `${p.growth}%`;
      growthBar.querySelector("b").textContent = `${p.growth}%`;

      const waterBar = card.querySelector(".gh-bar.water");
      waterBar.querySelector(".fill").style.width = `${p.water}%`;
      waterBar.querySelector("b").textContent = `${p.water}%`;

      card.querySelector(".gh-thirsty").hidden = !p.thirsty;
      card.querySelector(".gh-harvest-btn").disabled = !p.ripe;
    }
  }

  async function doPlant(slot, crop) {
    selectedCrop[slot] = crop;
    const json = await api("POST", `/${slot}/plant`, { crop });
    if (json?.data) updateSlots({ greenhouses: [json.data] });
  }
  async function doAction(slot, action) {
    const json = await api("POST", `/${slot}/${action}`);
    if (!json?.data) return;
    if (action === "harvest") {
      els.harvested.textContent = json.data.harvested ?? els.harvested.textContent;
      updateSlots({ greenhouses: [json.data.greenhouse] });
    } else {
      updateSlots({ greenhouses: [json.data] });
    }
  }

  function openFeed() {
    closeFeed();
    ws = new WebSocket(wsUrl());
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.type === "frame") {
        if (bannerOffline) clearBanner();
        updateSlots(msg.frame);
      } else if (msg.type === "error") {
        showBanner(msg.message || "Live feed error.", { persist: !!msg.offline });
      }
    };
  }
  function closeFeed() {
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch (e) {
        /* ignore */
      }
      ws = null;
    }
  }

  async function initGarden() {
    const cropsJson = await api("GET", "/crops");
    if (!cropsJson) return;
    crops = cropsJson.data.crops || [];

    const initial = await api("GET", "");
    if (!initial) return;

    els.demoBadge.classList.toggle("gh-hide-demo", initial.meta?.identityKind !== "demo");
    buildSlots();
    updateSlots(initial.data);
    gdSeed(initial.data); // seed the guided tab's slot-1 view
    openFeed();
  }

  // ── Tab 2: Guided demo (one plant, each step is a real gRPC call) ────────────

  let gdWs = null;
  let gdState = null; // last known greenhouse-1 object
  let gdLines = [];

  function gdLog(line) {
    gdLines.push(line);
    gdLines = gdLines.slice(-16);
    els.gdLog.textContent = gdLines.join("\n");
    els.gdLog.scrollTop = els.gdLog.scrollHeight;
  }

  function gdSetButtons() {
    const occ = !!(gdState && gdState.occupied);
    const ripe = occ && gdState.plant && gdState.plant.ripe;
    els.gdPlant.disabled = occ;
    els.gdWater.disabled = !occ;
    els.gdHarvest.disabled = !ripe;
    // The streaming demo is always available (it overrides the initial HTML
    // `disabled`); the toggle itself manages its own text/state.
    els.gdWatch.disabled = false;
  }

  function gdRender(gh) {
    if (!gh) return;
    gdState = gh;
    const empty = els.gdCard.querySelector(".gd-empty");
    const plantView = els.gdCard.querySelector(".gd-plant");
    if (!gh.occupied || !gh.plant) {
      empty.hidden = false;
      plantView.hidden = true;
      els.gdCard.classList.remove("ripe");
    } else {
      const p = gh.plant;
      empty.hidden = true;
      plantView.hidden = false;
      els.gdCard.classList.toggle("ripe", !!p.ripe);
      plantView.querySelector(".gh-plant-emoji").textContent = plantEmoji(p);
      plantView.querySelector(".gh-plant-name").textContent = p.crop_name;
      plantView.querySelector(".gh-plant-stage").textContent = p.ripe ? "ripe — ready to harvest!" : p.stage;
      const g = plantView.querySelector(".gh-bar.growth");
      g.querySelector(".fill").style.width = `${p.growth}%`;
      g.querySelector("b").textContent = `${p.growth}%`;
      const w = plantView.querySelector(".gh-bar.water");
      w.querySelector(".fill").style.width = `${p.water}%`;
      w.querySelector("b").textContent = `${p.water}%`;
      plantView.querySelector(".gh-thirsty").hidden = !p.thirsty;
    }
    gdSetButtons();
  }

  async function gdStep(method, reqStr, run, pick) {
    gdLog(`→ ${method}(${reqStr})`);
    const json = await run();
    if (!json) {
      gdLog("✗ failed — see the banner above");
      return;
    }
    const data = pick(json);
    gdLog(`← ${JSON.stringify(data)}`);
    gdRender(data.greenhouse || data);
  }

  function gdWatchStop() {
    if (gdWs) {
      try {
        gdWs.onclose = null;
        gdWs.close();
      } catch (e) {
        /* ignore */
      }
      gdWs = null;
    }
    els.gdWatch.innerHTML = "▶ Watch grow — <code>WatchGreenhouses()</code>";
  }

  function gdWatchToggle() {
    if (gdWs) {
      gdWatchStop();
      gdLog("■ stream closed");
      return;
    }
    gdLog("→ WatchGreenhouses()  [server stream opened]");
    els.gdWatch.textContent = "■ Stop watching — WatchGreenhouses()";
    gdWs = new WebSocket(wsUrl());
    gdWs.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.type === "frame") {
        const s1 = (msg.frame.greenhouses || []).find((g) => g.slot === 1);
        if (s1) gdRender(s1);
        if (s1 && s1.occupied) {
          gdLog(`← frame tick ${msg.frame.tick}: ${s1.plant.stage} ${s1.plant.growth}% (water ${s1.plant.water}%)`);
        }
      } else if (msg.type === "error") {
        gdLog("✗ stream error: " + (msg.message || ""));
      }
    };
    gdWs.onclose = () => {
      els.gdWatch.innerHTML = "▶ Watch grow — <code>WatchGreenhouses()</code>";
    };
  }

  function setupGuided() {
    els.gdCard = document.querySelector(".gd-card");
    els.gdLog = document.getElementById("ghGdLog");
    els.gdPlant = document.getElementById("ghGdPlant");
    els.gdWater = document.getElementById("ghGdWater");
    els.gdWatch = document.getElementById("ghGdWatch");
    els.gdHarvest = document.getElementById("ghGdHarvest");

    els.gdPlant.addEventListener("click", () =>
      gdStep("Plant", '{ slot: 1, crop: "tomato" }', () => api("POST", "/1/plant", { crop: "tomato" }), (j) => j.data),
    );
    els.gdWater.addEventListener("click", () =>
      gdStep("Water", "{ slot: 1 }", () => api("POST", "/1/water"), (j) => j.data),
    );
    els.gdHarvest.addEventListener("click", () =>
      gdStep("Harvest", "{ slot: 1 }", () => api("POST", "/1/harvest"), (j) => j.data),
    );
    els.gdWatch.addEventListener("click", gdWatchToggle);
    gdSetButtons();
  }

  function gdSeed(snapshot) {
    const s1 = (snapshot.greenhouses || []).find((g) => g.slot === 1);
    if (s1) gdRender(s1);
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────────

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll(".gh-tab"));
    const panels = {
      examples: document.getElementById("ghTabExamples"),
      guided: document.getElementById("ghTabGuided"),
      garden: document.getElementById("ghTabGarden"),
    };

    function activate(which) {
      tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === which));
      Object.entries(panels).forEach(([key, el]) => {
        if (el) el.hidden = key !== which;
      });
    }

    tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.getAttribute("data-tab"))));

    // Sync panel visibility to whichever tab is marked active in the HTML
    // (the `active` class alone doesn't control which panel shows).
    const initial = tabs.find((t) => t.classList.contains("active")) || tabs[0];
    if (initial) activate(initial.getAttribute("data-tab"));
  }

  function init() {
    els.banner = document.getElementById("ghBanner");
    els.slots = document.getElementById("ghSlots");
    els.harvested = document.getElementById("ghHarvested");
    els.demoBadge = document.getElementById("ghDemoBadge");

    window.addEventListener("beforeunload", () => {
      closeFeed();
      exStreamStop();
      gdWatchStop();
    });

    setupTabs();
    setupExamples();
    setupGuided();
    initGarden(); // populate the garden + guided tabs so they're ready when selected
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
