/**
 * Farm Defence Page Controller — mirrors LabyrinthPage architecture.
 * Singleton class managing frontend state, API requests, rendering, and polling.
 */

const API_ROOT = "/api/v1/fd";
const POLL_INTERVAL_MS = 10000;
const TICK_INTERVAL_MS = 500;
const MIN_TICK_INTERVAL_MS = 80; // floor so high speeds don't overwhelm the server
const SPEED_OPTIONS = [1, 2, 4];
const AUTO_WAVE_DELAY_MS = 1200; // breather between auto-started waves
const FD_SESSION_STORAGE_KEY = "rolnopol.fd.session-id";
const FD_SPEED_STORAGE_KEY = "rolnopol.fd.tick-speed";
const FD_AUTOWAVE_STORAGE_KEY = "rolnopol.fd.auto-wave";
const DEFAULT_SESSION_THEME = "obsidian";

function loadPreference(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

// ── Session helpers ──────────────────────────────────────────────────

function loadBrowserSessionId() {
  // localStorage (not sessionStorage) so a player's identity — and therefore
  // their achievements/leaderboard standing — survives closing the tab.
  try {
    let id = localStorage.getItem(FD_SESSION_STORAGE_KEY);
    if (!id) {
      // One-time migration: adopt any id left over in sessionStorage so existing
      // players keep the progress they earned before this change.
      id = sessionStorage.getItem(FD_SESSION_STORAGE_KEY) || `fd-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(FD_SESSION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `fd-session-${Date.now()}`;
  }
}

// Escape user-controlled text (player names) before inserting into innerHTML.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function createSessionSeed() {
  return `fd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Page Controller ──────────────────────────────────────────────────

class FarmDefencePage {
  constructor() {
    this.state = null;
    this.pollTimer = null;
    this.tickTimer = null;
    this.isBusy = false;
    this.controls = {};
    this.selectedMapSize = null;
    this.selectedDifficulty = "normal";
    this.selectedGameMode = "classic";
    this.selectedTowerType = "archer";
    this.hoveredCell = null; // {x: number, y: number} or null
    this.sessionId = loadBrowserSessionId();
    this.sessionSeed = createSessionSeed();

    // Playback preferences (persisted across sessions).
    const savedSpeed = Number(loadPreference(FD_SPEED_STORAGE_KEY, "1"));
    this.tickSpeed = SPEED_OPTIONS.includes(savedSpeed) ? savedSpeed : 1;
    this.autoWave = loadPreference(FD_AUTOWAVE_STORAGE_KEY, "false") === "true";
    this.autoWaveTimer = null;
  }

  init() {
    this._cacheDom();
    if (!this.controls.fdGrid) return;
    this._bindEvents();
    this._renderSpeedControls();
    this._renderAutoWaveControl();
    this._openSizeModal();
  }

  // ── DOM caching ──────────────────────────────────────────────────

  _cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.controls = {
      fdGrid: $("fdGrid"),
      sizeModal: $("fdSizeModal"),
      victoryModal: $("fdVictoryModal"),
      defeatModal: $("fdDefeatModal"),
      victoryMessage: $("fdVictoryMessage"),
      defeatMessage: $("fdDefeatMessage"),
      victoryNewGame: $("fdVictoryNewGame"),
      victoryStay: $("fdVictoryStay"),
      defeatRestart: $("fdDefeatRestart"),
      defeatMenu: $("fdDefeatMenu"),
      themeSelect: $("fdThemeSelect"),
      newGameBtn: $("fdNewGameBtn"),
      refreshBtn: $("fdRefreshBtn"),
      resetBtn: $("fdResetBtn"),
      startWaveBtn: $("fdStartWaveBtn"),
      autoWaveBtn: $("fdAutoWaveBtn"),
      speedButtons: document.querySelectorAll("[data-fd-speed]"),
      towerPicker: $("fdTowerPicker"),
      wavePill: $("fdWavePill"),
      revisionBadge: $("fdRevisionBadge"),
      goldStat: $("fdGoldStat"),
      livesStat: $("fdLivesStat"),
      towersStat: $("fdTowersStat"),
      killsStat: $("fdKillsStat"),
      leakedStat: $("fdLeakedStat"),
      scoreStat: $("fdScoreStat"),
      waveStat: $("fdWaveStat"),
      sizeStat: $("fdSizeStat"),
      updatedStat: $("fdUpdatedStat"),
      eventList: $("fdEventList"),
      fdNextWavePreview: $("fdNextWavePreview"),
      fdNextWaveNum: $("fdNextWaveNum"),
      fdNextWaveEnemies: $("fdNextWaveEnemies"),
      sizeButtons: document.querySelectorAll("[data-fd-size]"),
      // Achievements & leaderboard
      achievementsBtn: $("fdAchievementsBtn"),
      sizeScoresBtn: $("fdSizeScoresBtn"),
      achievementsModal: $("fdAchievementsModal"),
      playerNameInput: $("fdPlayerName"),
      playerNameSave: $("fdPlayerNameSave"),
      achvSummary: $("fdAchvSummary"),
      achvList: $("fdAchvList"),
      leaderboard: $("fdLeaderboard"),
    };
  }

  // ── Event binding ────────────────────────────────────────────────

  _bindEvents() {
    // Size buttons
    this.controls.sizeButtons?.forEach((btn) => {
      btn.addEventListener("click", () => this._chooseMapSize(btn.getAttribute("data-fd-size")));
    });

    // Header actions
    this.controls.newGameBtn?.addEventListener("click", () => this._openSizeModal());
    this.controls.refreshBtn?.addEventListener("click", () => this._fetchSnapshot());
    this.controls.resetBtn?.addEventListener("click", () => this._resetGame());
    this.controls.startWaveBtn?.addEventListener("click", () => this._startWave());

    // Playback: speed + auto-wave
    this.controls.speedButtons?.forEach((btn) => {
      btn.addEventListener("click", () => this._setSpeed(Number(btn.getAttribute("data-fd-speed"))));
    });
    this.controls.autoWaveBtn?.addEventListener("click", () => this._toggleAutoWave());

    // Achievements & leaderboard
    this.controls.achievementsBtn?.addEventListener("click", () => this._openAchievementsModal());
    this.controls.sizeScoresBtn?.addEventListener("click", () => this._openAchievementsModal());
    this.controls.playerNameSave?.addEventListener("click", () => this._savePlayerName());
    this.controls.playerNameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._savePlayerName();
      }
    });

    // Theme
    this.controls.themeSelect?.addEventListener("change", (e) => {
      this._applyAction("setTheme", { theme: e.target.value });
    });

    // Grid clicks (tower placement)
    this.controls.fdGrid?.addEventListener("click", (e) => {
      const cell = e.target.closest(".fd-cell");
      if (!cell) return;
      const x = parseInt(cell.dataset.x, 10);
      const y = parseInt(cell.dataset.y, 10);
      this._handleCellClick(x, y, cell);
    });

    // Grid mouseover/mouseout for tower range visualization
    this.controls.fdGrid?.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".fd-cell");
      if (!cell) return;
      if (cell.classList.contains("is-tower")) {
        const x = parseInt(cell.dataset.x, 10);
        const y = parseInt(cell.dataset.y, 10);
        const tower = this.state?.towers?.find((t) => t.x === x && t.y === y);
        if (tower) {
          const towerType = tower.type;
          if (!towerType) return;
          const towerDef = this.state?.capabilities?.towerDefs?.[towerType];
          if (towerDef) {
            this._showRange(x, y, towerDef.range);
          }
        }
      }
    });

    this.controls.fdGrid?.addEventListener("mouseout", (e) => {
      this._clearRangeHighlight();
    });

    // Victory modal
    this.controls.victoryNewGame?.addEventListener("click", () => this._startNewGameAfterVictory());
    this.controls.victoryStay?.addEventListener("click", () => this._closeVictoryModal());

    // Defeat modal
    this.controls.defeatRestart?.addEventListener("click", () => this._restartAfterDefeat());
    this.controls.defeatMenu?.addEventListener("click", () => this._returnToMenuAfterDefeat());

    // Modal close buttons
    document.querySelectorAll(".fd-modal__close").forEach((btn) => {
      btn.addEventListener("click", () => this._closeAllModals());
    });
    document.querySelectorAll(".fd-modal__overlay").forEach((overlay) => {
      overlay.addEventListener("click", () => this._closeAllModals());
    });

    // Keyboard
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._closeAllModals();
    });

    // Visibility
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._stopPolling();
      else if (this.state) this._startPolling();
    });
  }

  // ── API requests ─────────────────────────────────────────────────

  async _request(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "x-fd-session-id": this.sessionId,
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || "Request failed");
    return payload;
  }

  async _applyAction(action, payload = {}) {
    if (this.isBusy) return;
    this.isBusy = true;
    try {
      const response = await this._request("/actions", {
        method: "POST",
        body: JSON.stringify({ action, payload }),
      });
      const snapshot = response?.data?.snapshot || response?.data || response;
      this._applySnapshot(snapshot);
      this._handleDefenceEvents(response?.data?.event ? [response.data.event] : []);
    } catch (err) {
      // console.error("[FarmDefence] Action error:", err);
    } finally {
      this.isBusy = false;
    }
  }

  async _fetchSnapshot() {
    try {
      const response = await this._request("");
      const snapshot = response?.data;
      if (snapshot) this._applySnapshot(snapshot);
    } catch (err) {
      // console.error("[FarmDefence] Fetch error:", err);
    }
  }

  // ── Polling ──────────────────────────────────────────────────────

  _startPolling() {
    this._stopPolling();
    this._pollUpdatesLoop();
  }

  _stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _pollUpdatesLoop() {
    if (!this.state || this.isBusy || document.hidden) {
      this.pollTimer = setTimeout(() => this._pollUpdatesLoop(), POLL_INTERVAL_MS);
      return;
    }
    try {
      const response = await this._request(`/updates?since=${this.state.revision || 0}`);
      const data = response?.data;
      if (data?.changed && data.snapshot) {
        this._applySnapshot(data.snapshot);
        this._handleDefenceEvents(data.events || []);
        this._renderEvents(data.events || []);
      }
    } catch {
      /* ignore poll errors */
    }
    this.pollTimer = setTimeout(() => this._pollUpdatesLoop(), POLL_INTERVAL_MS);
  }

  // ── Auto-tick ────────────────────────────────────────────────────

  _tickIntervalMs() {
    return Math.max(MIN_TICK_INTERVAL_MS, Math.round(TICK_INTERVAL_MS / this.tickSpeed));
  }

  _startAutoTick() {
    this._stopAutoTick();
    this.tickTimer = setInterval(() => {
      if (!this.isBusy && this.state?.wave?.status === "active") {
        this._applyAction("tick");
      }
    }, this._tickIntervalMs());
  }

  _stopAutoTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ── Speed control ────────────────────────────────────────────────

  _setSpeed(multiplier) {
    if (!SPEED_OPTIONS.includes(multiplier)) return;
    this.tickSpeed = multiplier;
    savePreference(FD_SPEED_STORAGE_KEY, multiplier);
    this._renderSpeedControls();
    // Re-arm the tick loop with the new interval if a wave is running.
    if (this.state?.wave?.status === "active") this._startAutoTick();
  }

  _renderSpeedControls() {
    this.controls.speedButtons?.forEach((btn) => {
      const active = Number(btn.getAttribute("data-fd-speed")) === this.tickSpeed;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  // ── Auto-wave ────────────────────────────────────────────────────

  _toggleAutoWave() {
    this.autoWave = !this.autoWave;
    savePreference(FD_AUTOWAVE_STORAGE_KEY, this.autoWave);
    this._renderAutoWaveControl();
    if (!this.autoWave) this._clearAutoWave();
    else if (this.state) this._maybeScheduleAutoWave(this.state);
  }

  _renderAutoWaveControl() {
    const btn = this.controls.autoWaveBtn;
    if (!btn) return;
    btn.classList.toggle("is-active", this.autoWave);
    btn.setAttribute("aria-pressed", this.autoWave ? "true" : "false");
  }

  _clearAutoWave() {
    if (this.autoWaveTimer) {
      clearTimeout(this.autoWaveTimer);
      this.autoWaveTimer = null;
    }
  }

  /**
   * When auto-wave is on and a wave has just completed, start the next one after
   * a short breather. The first wave is always manual so players can build up.
   */
  _maybeScheduleAutoWave(snapshot) {
    const w = snapshot.wave || {};
    const ended = snapshot.stats?.gameOver || snapshot.stats?.victory;
    if (!this.autoWave || ended || w.status !== "complete") return;
    if (this.autoWaveTimer) return; // already scheduled
    this.autoWaveTimer = setTimeout(() => {
      this.autoWaveTimer = null;
      if (this.autoWave && !this.isBusy && this.state?.wave?.status === "complete") {
        this._startWave();
      }
    }, AUTO_WAVE_DELAY_MS);
  }

  // ── Snapshot rendering ───────────────────────────────────────────

  _applySnapshot(snapshot) {
    if (!snapshot) return;
    this.state = snapshot;
    this._renderTheme(snapshot.theme);
    this._renderHeader(snapshot);
    this._renderStats(snapshot);
    this._renderGrid(snapshot);
    this._renderTowerPicker(snapshot);
    this._renderWaveControls(snapshot);
    this._renderNextWavePreview(snapshot);
  }

  _injectRangeStyle() {
    if (document.getElementById("fd-range-style")) return;
    const style = document.createElement("style");
    style.id = "fd-range-style";
    style.textContent = `
                .fd-cell-in-range {
                    outline: 2px solid rgba(0, 255, 0, 0.7);
                    outline-offset: -2px;
                }
            `;
    document.head.appendChild(style);
  }

  _showRange(x, y, range) {
    this._injectRangeStyle();
    this._clearRangeHighlight();
    const rows = this.state?.grid || [];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const worldX = Number(this.state?.viewport?.startX || 0) + colIndex;
        const worldY = Number(this.state?.viewport?.startY || 0) + rowIndex;
        const dx = Math.abs(worldX - x);
        const dy = Math.abs(worldY - y);
        if (dx + dy <= range) {
          const button = this.controls.fdGrid.querySelector(`[data-x="${worldX}"][data-y="${worldY}"]`);
          if (button) {
            button.classList.add("fd-cell-in-range");
          }
        }
      });
    });
  }

  _clearRangeHighlight() {
    this.controls.fdGrid.querySelectorAll(".fd-cell-in-range").forEach((el) => {
      el.classList.remove("fd-cell-in-range");
    });
  }

  _renderTheme(theme) {
    if (!theme) return;
    document.body.dataset.fdTheme = theme;
  }

  _renderHeader(snapshot) {
    if (this.controls.revisionBadge) this.controls.revisionBadge.textContent = `rev ${snapshot.revision || 0}`;
    if (this.controls.themeSelect && this.controls.themeSelect.value !== snapshot.theme) {
      this.controls.themeSelect.value = snapshot.theme;
    }

    // Populate theme select if empty
    if (this.controls.themeSelect && this.controls.themeSelect.options.length === 0) {
      const themes = snapshot.capabilities?.themes || [];
      themes.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        this.controls.themeSelect.appendChild(opt);
      });
      this.controls.themeSelect.value = snapshot.theme;
    }
  }

  _renderStats(snapshot) {
    const r = snapshot.resources || {};
    const s = snapshot.stats || {};
    const w = snapshot.wave || {};

    if (this.controls.goldStat) this.controls.goldStat.textContent = r.gold ?? 0;
    if (this.controls.livesStat) this.controls.livesStat.textContent = r.lives ?? 0;
    if (this.controls.towersStat) this.controls.towersStat.textContent = s.towersPlaced ?? 0;
    if (this.controls.killsStat) this.controls.killsStat.textContent = s.enemiesKilled ?? 0;
    if (this.controls.leakedStat) this.controls.leakedStat.textContent = s.enemiesLeaked ?? 0;
    if (this.controls.scoreStat) this.controls.scoreStat.textContent = r.score ?? 0;
    if (this.controls.waveStat) this.controls.waveStat.textContent = `${w.current || 1}/${w.total || "?"}`;
    if (this.controls.sizeStat) this.controls.sizeStat.textContent = `${snapshot.map?.width || "?"}×${snapshot.map?.height || "?"}`;
    if (this.controls.updatedStat)
      this.controls.updatedStat.textContent = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : "-";
  }

  _renderWaveControls(snapshot) {
    const w = snapshot.wave || {};
    const pill = this.controls.wavePill;
    const btn = this.controls.startWaveBtn;

    if (w.status === "active") {
      if (pill) pill.textContent = `Wave ${w.current} — Active`;
      if (btn) btn.disabled = true;
      this._clearAutoWave(); // wave running — nothing to auto-start
      this._startAutoTick();
    } else if (w.status === "complete") {
      if (pill) pill.textContent = `Wave ${w.current} — Complete`;
      if (btn) btn.disabled = false;
      this._stopAutoTick();
      this._maybeScheduleAutoWave(snapshot);
    } else {
      if (pill) pill.textContent = "Preparing…";
      if (btn) btn.disabled = false;
      this._stopAutoTick();
    }

    if (snapshot.stats?.gameOver) {
      if (pill) pill.textContent = "Game Over";
      this._stopAutoTick();
      this._clearAutoWave();
    }
    if (snapshot.stats?.victory) {
      if (pill) pill.textContent = "Victory!";
      this._stopAutoTick();
      this._clearAutoWave();
    }
  }

  // ── Next wave preview ────────────────────────────────────────────

  _renderNextWavePreview(snapshot) {
    const preview = snapshot.nextWave;
    const container = this.controls.fdNextWavePreview;
    const enemiesEl = this.controls.fdNextWaveEnemies;
    const numEl = this.controls.fdNextWaveNum;

    if (!preview || !container) {
      if (container) container.style.display = "none";
      return;
    }

    // Show preview when preparing or complete (not during active wave)
    const status = snapshot.wave?.status;
    if (status !== "preparing" && status !== "complete") {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    if (numEl) numEl.textContent = `${preview.wave}/${preview.total}`;

    if (enemiesEl) {
      enemiesEl.innerHTML = "";
      const fragment = document.createDocumentFragment();
      for (const enemy of preview.enemies) {
        const span = document.createElement("span");
        span.className = "fd-next-wave__enemy";
        span.innerHTML = `<i class="fas ${enemy.icon}"></i> ${enemy.label} <span class="count">×${enemy.count}</span>`;
        span.title = `HP: ${enemy.hp}, Speed: ${enemy.speed}, Reward: ${enemy.reward}`;
        fragment.appendChild(span);
      }
      enemiesEl.appendChild(fragment);
    }
  }

  // ── Grid rendering ───────────────────────────────────────────────

  _normalizeGridCell(cell) {
    if (!cell || typeof cell !== "object") {
      return { className: "is-blocked is-muted", icon: "fa-mountain", label: "Blocked" };
    }

    const type = cell.t || cell.type || "blocked";

    switch (type) {
      case "path":
        return { className: "is-path is-discovered is-visible", icon: "fa-road", label: "Path" };
      case "buildable":
        return { className: "is-buildable is-discovered is-visible", icon: "fa-plus", label: "Build here" };
      case "spawn":
        return { className: "is-path is-discovered is-visible is-spawn", icon: "fa-dungeon", label: "Spawn" };
      case "exit":
        return { className: "is-path is-discovered is-visible is-exit", icon: "fa-home", label: "Exit" };
      case "tower":
        return {
          className: `is-tower is-discovered is-visible is-${cell.s || "archer"}`,
          icon: cell.icon || "fa-chess-rook",
          label: cell.label || "Tower",
        };
      case "enemy":
        return {
          className: `is-enemy is-discovered is-visible is-${cell.s || "grunt"}`,
          icon: cell.icon || "fa-bug",
          label: cell.label || "Enemy",
          hp: cell.hp,
        };
      case "blocked":
      default:
        return { className: "is-blocked is-muted", icon: "fa-mountain", label: "Blocked" };
    }
  }

  _renderGrid(snapshot) {
    if (!this.controls.fdGrid) return;

    // Preserve popups during re-render
    const towerPopup = document.getElementById("fdTowerInfo");
    const enemyPopup = document.getElementById("fdEnemyInfo");

    const rows = Array.isArray(snapshot?.grid) ? snapshot.grid : [];
    const viewport = snapshot?.viewport || {};
    const viewportWidth = Number(viewport.width) || (Array.isArray(rows[0]) ? rows[0].length : 0) || 21;

    this.controls.fdGrid.style.setProperty("--fd-width", String(viewportWidth));
    this.controls.fdGrid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const viewCell = this._normalizeGridCell(cell);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `fd-cell ${viewCell.className || ""}`.trim();
        button.title = viewCell.label;
        button.setAttribute("aria-label", viewCell.label);
        button.setAttribute("role", "gridcell");
        button.dataset.x = String(Number(snapshot?.viewport?.startX || 0) + colIndex);
        button.dataset.y = String(Number(snapshot?.viewport?.startY || 0) + rowIndex);
        button.innerHTML = `<i class="fas ${viewCell.icon}"></i><span class="sr-only">${viewCell.label}</span>`;

        // HP bar for enemies
        if (viewCell.hp !== undefined && viewCell.hp < 1) {
          const hpBar = document.createElement("span");
          hpBar.className = "hp-bar";
          hpBar.style.width = `${Math.max(0, viewCell.hp * 100)}%`;
          button.appendChild(hpBar);
        }

        fragment.appendChild(button);
      });
    });
    this.controls.fdGrid.appendChild(fragment);

    // Restore popups after grid re-render
    if (towerPopup) this.controls.fdGrid.appendChild(towerPopup);
    if (enemyPopup) this.controls.fdGrid.appendChild(enemyPopup);
  }

  _injectRangeStyle() {
    if (document.getElementById("fd-range-style")) return;
    const style = document.createElement("style");
    style.id = "fd-range-style";
    style.textContent = `
        .fd-cell-in-range {
          outline: 2px solid rgba(0, 255, 0, 0.7);
          outline-offset: -2px;
        }
    `;
    document.head.appendChild(style);
  }

  // ── Tower picker ─────────────────────────────────────────────────

  _renderTowerPicker(snapshot) {
    if (!this.controls.towerPicker) return;
    const types = snapshot.capabilities?.towerTypes || [];
    const defs = snapshot.capabilities?.towerDefs || {};

    // Only rebuild if types changed
    const currentTypes = Array.from(this.controls.towerPicker.querySelectorAll(".fd-tower-btn")).map((b) => b.dataset.towerType);
    if (JSON.stringify(currentTypes) === JSON.stringify(types)) return;

    this.controls.towerPicker.innerHTML = "";
    for (const type of types) {
      const def = defs[type] || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `fd-tower-btn is-${type}${type === this.selectedTowerType ? " is-selected" : ""}`;
      btn.dataset.towerType = type;
      btn.innerHTML = `<i class="fas ${def.icon || "fa-chess-rook"}"></i> ${def.label || type} <small>${def.cost || "?"}g</small>`;
      btn.title = def.description || "";
      btn.setAttribute("aria-label", `${def.label || type} tower, costs ${def.cost} gold`);
      btn.addEventListener("click", () => this._selectTowerType(type));
      this.controls.towerPicker.appendChild(btn);
    }
  }

  _selectTowerType(type) {
    this.selectedTowerType = type;
    this.controls.towerPicker?.querySelectorAll(".fd-tower-btn").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.towerType === type);
    });
  }

  // ── Cell click handler ───────────────────────────────────────────

  _handleCellClick(x, y, cellElement) {
    if (cellElement.classList.contains("is-buildable")) {
      this._applyAction("placeTower", { x, y, type: this.selectedTowerType });
    } else if (cellElement.classList.contains("is-tower")) {
      const tower = this.state?.towers?.find((t) => t.x === x && t.y === y);
      if (tower) this._showTowerInfo(tower);
    } else if (cellElement.classList.contains("is-enemy")) {
      // Find the enemy at this grid position by matching path index
      const enemies = this.state?.enemies || [];
      const mapPath = this.state?.map?.path || [];
      let closestEnemy = null;
      let closestDist = Infinity;
      for (const e of enemies) {
        const idx = Math.min(Math.floor(e.pathIndex), mapPath.length - 1);
        const pos = mapPath[idx];
        if (!pos) continue;
        const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y);
        if (dist < closestDist) {
          closestDist = dist;
          closestEnemy = e;
        }
      }
      if (closestEnemy && closestDist <= 1) this._showEnemyInfo(closestEnemy);
    }
  }

  // ── Enemy info popup ─────────────────────────────────────────────

  _showEnemyInfo(enemy) {
    this._closeEnemyInfo();
    const defs = this.state?.capabilities?.enemyDefs || {};
    const def = defs[enemy.type] || {};
    const level = enemy.level || 1;
    const hpPercent = enemy.maxHp > 0 ? Math.round((enemy.hp / enemy.maxHp) * 100) : 0;
    const mapPath = this.state?.map?.path || [];
    const pathIdx = Math.min(Math.floor(enemy.pathIndex || 0), mapPath.length - 1);
    const enemyPos = mapPath[pathIdx];

    const popup = document.createElement("div");
    popup.className = "fd-enemy-info glass";
    popup.id = "fdEnemyInfo";
    popup.innerHTML = `
      <div class="fd-enemy-info__header">
        <i class="fas ${def.icon || "fa-bug"}"></i>
        <div>
          <strong>${def.label || enemy.type} <small>Lvl ${level}</small></strong>
          <small>${def.description || ""}</small>
        </div>
        <button class="fd-enemy-info__close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="fd-enemy-info__stats">
        <div class="fd-enemy-info__stat"><span>HP</span><strong>${Math.round(enemy.hp)} / ${enemy.maxHp}</strong></div>
        <div class="fd-enemy-info__stat"><span>Speed</span><strong>${enemy.speed?.toFixed(1) || "?"}</strong></div>
        <div class="fd-enemy-info__stat"><span>Reward</span><strong>${enemy.reward || "?"}g</strong></div>
        <div class="fd-enemy-info__stat"><span>Progress</span><strong>${pathIdx} / ${mapPath.length}</strong></div>
      </div>
      <div class="fd-enemy-info__hp-bar">
        <div class="fd-enemy-info__hp-fill" style="width: ${hpPercent}%"></div>
      </div>
    `;

    // Position near the enemy's cell on the grid
    const grid = this.controls.fdGrid;
    if (enemyPos && grid) {
      const cell = grid.querySelector(`[data-x="${enemyPos.x}"][data-y="${enemyPos.y}"]`);
      if (cell) {
        const gridRect = grid.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        popup.style.position = "absolute";
        popup.style.left = `${cellRect.left - gridRect.left + cellRect.width + 4}px`;
        popup.style.top = `${cellRect.top - gridRect.top}px`;
        grid.style.position = "relative";
        grid.appendChild(popup);
      } else {
        document.body.appendChild(popup);
      }
    } else {
      document.body.appendChild(popup);
    }

    popup.querySelector(".fd-enemy-info__close")?.addEventListener("click", () => this._closeEnemyInfo());

    setTimeout(() => {
      document.addEventListener(
        "click",
        (this._closeEnemyInfoOutside = (e) => {
          if (!popup.contains(e.target)) this._closeEnemyInfo();
        }),
      );
    }, 10);
  }

  _closeEnemyInfo() {
    document.getElementById("fdEnemyInfo")?.remove();
    if (this._closeEnemyInfoOutside) {
      document.removeEventListener("click", this._closeEnemyInfoOutside);
      this._closeEnemyInfoOutside = null;
    }
  }

  // ── Tower info popup ─────────────────────────────────────────────

  _showTowerInfo(tower) {
    this._closeTowerInfo();
    const defs = this.state?.capabilities?.towerDefs || {};
    const def = defs[tower.type] || {};
    const level = tower.level || 1;
    const upgradeCost = Math.floor((def.cost || 50) * 0.6 * level);
    const sellRefund = Math.floor((def.cost || 50) * 0.6 * (level > 1 ? 0.8 : 1));
    const canUpgrade = this.state?.resources?.gold >= upgradeCost;

    const popup = document.createElement("div");
    popup.className = "fd-tower-info glass";
    popup.id = "fdTowerInfo";
    popup.innerHTML = `
      <div class="fd-tower-info__header">
        <i class="fas ${def.icon || "fa-chess-rook"}"></i>
        <div>
          <strong>${def.label || tower.type}</strong>
          <small>Level ${level} · Range ${def.range || "?"} · DMG ${Math.floor((def.damage || 10) * (1 + (level - 1) * 0.5))}</small>
        </div>
        <button class="fd-tower-info__close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="fd-tower-info__actions">
        <button class="fd-btn fd-btn--accent" data-action="upgrade" ${canUpgrade ? "" : "disabled"}>
          <i class="fas fa-arrow-up"></i> Upgrade (${upgradeCost}g)
        </button>
        <button class="fd-btn" data-action="sell">
          <i class="fas fa-coins"></i> Sell (${sellRefund}g)
        </button>
      </div>
    `;

    // Position near the cell
    const grid = this.controls.fdGrid;
    const cell = grid?.querySelector(`[data-x="${tower.x}"][data-y="${tower.y}"]`);
    if (cell && grid) {
      const gridRect = grid.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      popup.style.position = "absolute";
      popup.style.left = `${cellRect.left - gridRect.left + cellRect.width + 4}px`;
      popup.style.top = `${cellRect.top - gridRect.top}px`;
      grid.style.position = "relative";
      grid.appendChild(popup);
    } else {
      document.body.appendChild(popup);
    }

    // Event handlers
    popup.querySelector(".fd-tower-info__close")?.addEventListener("click", () => this._closeTowerInfo());
    popup.querySelector('[data-action="upgrade"]')?.addEventListener("click", () => {
      this._applyAction("upgradeTower", { towerId: tower.id });
      this._closeTowerInfo();
    });
    popup.querySelector('[data-action="sell"]')?.addEventListener("click", () => {
      this._applyAction("sellTower", { towerId: tower.id });
      this._closeTowerInfo();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener(
        "click",
        (this._closeTowerInfoOutside = (e) => {
          if (!popup.contains(e.target)) this._closeTowerInfo();
        }),
      );
    }, 10);
  }

  _closeTowerInfo() {
    document.getElementById("fdTowerInfo")?.remove();
    if (this._closeTowerInfoOutside) {
      document.removeEventListener("click", this._closeTowerInfoOutside);
      this._closeTowerInfoOutside = null;
    }
  }

  // ── Game actions ─────────────────────────────────────────────────

  _startWave() {
    this._applyAction("startWave");
  }

  _resetGame() {
    this._stopAutoTick();
    this._clearAutoWave();
    this._applyAction("reset", { seed: this.sessionSeed, size: this.selectedMapSize || "medium" });
  }

  // ── Event handling ───────────────────────────────────────────────

  _handleDefenceEvents(events = []) {
    for (const event of events || []) {
      if (event.type === "victory") {
        this._openVictoryModal(event.details?.message || event.message);
        this._stopPolling();
        this._stopAutoTick();
      }
      if (event.type === "gameOver") {
        this._openDefeatModal(event.details?.message || event.message);
        this._stopPolling();
        this._stopAutoTick();
      }
      // On game end the server has finished recording the run; refresh the
      // achievements/leaderboard view so it's current next time it's opened.
      if (event.type === "victory" || event.type === "gameOver") {
        // Small delay: server persists progress asynchronously after the event.
        setTimeout(() => {
          this._fetchAchievements();
          this._fetchLeaderboard();
        }, 600);
      }
    }
  }

  _renderEvents(events = []) {
    if (!this.controls.eventList || !events.length) return;
    const list = this.controls.eventList;
    for (const event of events.slice(-8)) {
      const li = document.createElement("li");
      li.className = "fd-event";
      li.textContent = event.message || `${event.type} (rev ${event.revision})`;
      list.prepend(li);
    }
    // Keep max 20
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  // ── Modals ───────────────────────────────────────────────────────

  _openSizeModal() {
    this.controls.sizeModal?.classList.add("is-open");
    this.controls.sizeModal?.setAttribute("aria-hidden", "false");
    // Populate difficulty/mode selects if empty
    this._renderSizeModalOptions();
  }

  _renderSizeModalOptions() {
    // Render difficulty buttons
    const diffContainer = document.getElementById("fdDifficultyPicker");
    if (diffContainer && diffContainer.children.length === 0) {
      const difficulties = this.state?.capabilities?.difficulties || [
        { name: "easy", label: "Easy" },
        { name: "normal", label: "Normal" },
        { name: "hard", label: "Hard" },
      ];
      difficulties.forEach((d) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `fd-modal__option-btn${d.name === this.selectedDifficulty ? " is-selected" : ""}`;
        btn.dataset.value = d.name;
        btn.innerHTML = `<strong>${d.label}</strong><small>${d.description || ""}</small>`;
        btn.addEventListener("click", () => {
          this.selectedDifficulty = d.name;
          diffContainer.querySelectorAll(".fd-modal__option-btn").forEach((b) => b.classList.remove("is-selected"));
          btn.classList.add("is-selected");
        });
        diffContainer.appendChild(btn);
      });
    }

    // Render game mode buttons
    const modeContainer = document.getElementById("fdModePicker");
    if (modeContainer && modeContainer.children.length === 0) {
      const modes = this.state?.capabilities?.gameModes || [
        { name: "classic", label: "Classic" },
        { name: "endless", label: "Endless" },
        { name: "rush", label: "Rush" },
      ];
      modes.forEach((m) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `fd-modal__option-btn${m.name === this.selectedGameMode ? " is-selected" : ""}`;
        btn.dataset.value = m.name;
        btn.innerHTML = `<strong>${m.label}</strong><small>${m.description || ""}</small>`;
        btn.addEventListener("click", () => {
          this.selectedGameMode = m.name;
          modeContainer.querySelectorAll(".fd-modal__option-btn").forEach((b) => b.classList.remove("is-selected"));
          btn.classList.add("is-selected");
        });
        modeContainer.appendChild(btn);
      });
    }
  }

  _closeSizeModal() {
    this.controls.sizeModal?.classList.remove("is-open");
    this.controls.sizeModal?.setAttribute("aria-hidden", "true");
  }

  _openVictoryModal(message) {
    if (this.controls.victoryMessage) this.controls.victoryMessage.textContent = message || "All waves cleared!";
    this.controls.victoryModal?.classList.add("is-open");
  }

  _closeVictoryModal() {
    this.controls.victoryModal?.classList.remove("is-open");
  }

  _openDefeatModal(message) {
    if (this.controls.defeatMessage) this.controls.defeatMessage.textContent = message || "All lives lost!";
    this.controls.defeatModal?.classList.add("is-open");
  }

  _closeDefeatModal() {
    this.controls.defeatModal?.classList.remove("is-open");
  }

  _closeAllModals() {
    this._closeVictoryModal();
    this._closeDefeatModal();
    this._closeAchievementsModal();
  }

  // ── Achievements & leaderboard ───────────────────────────────────

  async _openAchievementsModal() {
    this.controls.achievementsModal?.classList.add("is-open");
    await Promise.all([this._fetchAchievements(), this._fetchLeaderboard()]);
  }

  _closeAchievementsModal() {
    this.controls.achievementsModal?.classList.remove("is-open");
  }

  async _fetchAchievements() {
    try {
      const res = await this._request("/achievements");
      if (res?.data) this._renderAchievements(res.data);
    } catch {
      /* ignore */
    }
  }

  async _fetchLeaderboard() {
    try {
      const res = await this._request("/leaderboard?limit=20");
      this._renderLeaderboard(res?.data || []);
    } catch {
      /* ignore */
    }
  }

  _isDefaultName(name) {
    return !name || /^fd-session-/.test(name);
  }

  _renderAchievements(view) {
    // Don't clobber the name field while the user is editing it.
    if (this.controls.playerNameInput && document.activeElement !== this.controls.playerNameInput) {
      this.controls.playerNameInput.value = this._isDefaultName(view.playerName) ? "" : view.playerName;
    }

    if (this.controls.achvSummary) {
      this.controls.achvSummary.innerHTML = `
        <div class="fd-stat"><span>Best score</span><strong>${view.bestScore || 0}</strong></div>
        <div class="fd-stat"><span>Best wave</span><strong>${view.bestWave || 0}</strong></div>
        <div class="fd-stat"><span>Games</span><strong>${view.gamesPlayed || 0}</strong></div>
        <div class="fd-stat"><span>Wins</span><strong>${view.victories || 0}</strong></div>
        <div class="fd-stat"><span>Unlocked</span><strong>${view.unlockedCount || 0}/${view.totalCount || 0}</strong></div>`;
    }

    if (this.controls.achvList) {
      const items = view.achievements || [];
      this.controls.achvList.innerHTML = items
        .map((a) => {
          const pct = a.threshold ? Math.min(100, Math.round((a.progress / a.threshold) * 100)) : 0;
          return `<div class="fd-achv-item ${a.unlocked ? "is-unlocked" : ""}">
            <i class="fas ${escapeHtml(a.icon || "fa-medal")} fd-achv-item__icon"></i>
            <div class="fd-achv-item__body">
              <div class="fd-achv-item__head">
                <strong>${escapeHtml(a.label)}</strong>
                <span>${a.progress}/${a.threshold}</span>
              </div>
              <div class="fd-achv-item__desc">${escapeHtml(a.description || "")}</div>
              <div class="fd-achv-item__bar"><span style="width:${pct}%"></span></div>
            </div>
            ${a.unlocked ? '<i class="fas fa-circle-check fd-achv-item__tick"></i>' : ""}
          </div>`;
        })
        .join("");
    }
  }

  _renderLeaderboard(rows) {
    if (!this.controls.leaderboard) return;
    if (!rows.length) {
      this.controls.leaderboard.innerHTML = '<li class="fd-leaderboard__empty">No scores yet — finish a game to appear here.</li>';
      return;
    }
    this.controls.leaderboard.innerHTML = rows
      .map((r) => {
        const me = r.playerId === this.sessionId ? " is-me" : "";
        const name = this._isDefaultName(r.playerName) ? "Anonymous farmer" : r.playerName;
        return `<li class="fd-leaderboard__row${me}">
          <span class="fd-leaderboard__rank">#${r.rank}</span>
          <span class="fd-leaderboard__name">${escapeHtml(name)}</span>
          <span class="fd-leaderboard__wave">W${r.bestWave || 0}</span>
          <span class="fd-leaderboard__score">${r.bestScore || 0}</span>
        </li>`;
      })
      .join("");
  }

  async _savePlayerName() {
    const name = (this.controls.playerNameInput?.value || "").trim();
    if (!name) return;
    await this._applyAction("setPlayerName", { name });
    await Promise.all([this._fetchAchievements(), this._fetchLeaderboard()]);
  }

  // ── Modal action handlers ────────────────────────────────────────

  _chooseMapSize(size) {
    this.selectedMapSize = size;
    this._closeSizeModal();
    this._applyAction("reset", {
      seed: this.sessionSeed,
      size,
      difficulty: this.selectedDifficulty,
      gameMode: this.selectedGameMode,
    });
  }

  _startNewGameAfterVictory() {
    this._closeVictoryModal();
    this.sessionSeed = createSessionSeed();
    this._applyAction("reset", { seed: this.sessionSeed, size: this.selectedMapSize || "medium" });
  }

  _restartAfterDefeat() {
    this._closeDefeatModal();
    this._applyAction("reset", { seed: this.sessionSeed, size: this.selectedMapSize || "medium" });
  }

  _returnToMenuAfterDefeat() {
    this._closeDefeatModal();
    this._openSizeModal();
  }
}

// ── Bootstrap (guarded for test environments) ────────────────────────

let farmDefencePage;

if (typeof document !== "undefined") {
  farmDefencePage = new FarmDefencePage();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => farmDefencePage.init());
  } else {
    farmDefencePage.init();
  }
}

// Export for Node.js testing (guarded)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { FarmDefencePage };
}
