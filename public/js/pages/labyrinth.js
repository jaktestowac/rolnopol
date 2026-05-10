(function () {
  "use strict";

  const API_ROOT = "/api/v1/labyrinth";
  const POLL_INTERVAL_MS = 10000;
  const DEFAULT_SESSION_THEME = "fields";
  const LABYRINTH_SESSION_STORAGE_KEY = "rolnopol.labyrinth.session-id";
  const VICTORY_MESSAGE = "You reached the exit! A new maze is ready. If every maze is a question, what answer were you looking for?";
  const GAME_OVER_MESSAGE = "The monster caught you. Game over.";

  function createSessionSeed() {
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return `labyrinth-${randomPart}`;
  }

  function createBrowserSessionId() {
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return `labyrinth-session-${randomPart}`;
  }

  function loadBrowserSessionId() {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return createBrowserSessionId();
    }

    try {
      const existing = window.sessionStorage.getItem(LABYRINTH_SESSION_STORAGE_KEY);
      if (existing) {
        return existing;
      }

      const next = createBrowserSessionId();
      window.sessionStorage.setItem(LABYRINTH_SESSION_STORAGE_KEY, next);
      return next;
    } catch (error) {
      return createBrowserSessionId();
    }
  }

  function formatNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function formatTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  class LabyrinthPage {
    constructor() {
      this.state = null;
      this.pollTimer = null;
      this.isBusy = false;
      this.controls = {};
      this.selectedMazeSize = null;
      this.sessionId = loadBrowserSessionId();
      this.sessionSeed = createSessionSeed();
      this.sessionConfig = this._buildSessionConfig(this.sessionSeed);
      this._notificationContainer = null;
    }

    init() {
      this._cacheDom();
      if (!this.controls.mazeGrid) {
        return;
      }

      this._bindEvents();
      this._openSizeModal();
    }

    _cacheDom() {
      this.controls = {
        mazeGrid: document.getElementById("mazeGrid"),
        sizeModal: document.getElementById("mazeSizeModal"),
        exitModal: document.getElementById("mazeExitModal"),
        exitModalMessage: document.getElementById("mazeExitMessage"),
        exitModalConfirm: document.getElementById("mazeExitNewMazeBtn"),
        exitModalCancel: document.getElementById("mazeExitCancelBtn"),
        exitModalClose: document.getElementById("mazeExitCloseBtn"),
        gameOverModal: document.getElementById("mazeGameOverModal"),
        gameOverMessage: document.getElementById("mazeGameOverMessage"),
        gameOverRestart: document.getElementById("mazeGameOverRestartBtn"),
        gameOverMenu: document.getElementById("mazeGameOverMenuBtn"),
        themeSelect: document.getElementById("themeSelect"),
        newMazeBtn: document.getElementById("newMazeBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        resetBtn: document.getElementById("resetBtn"),
        revealBtn: document.getElementById("revealBtn"),
        sizeButtons: Array.from(document.querySelectorAll("[data-maze-size]")),
        statusPill: document.getElementById("statusPill"),
        statusHint: document.getElementById("statusHint"),
        revisionBadge: document.getElementById("revisionBadge"),
        movesStat: document.getElementById("movesStat"),
        revealsStat: document.getElementById("revealsStat"),
        coverageStat: document.getElementById("coverageStat"),
        solvedStat: document.getElementById("solvedStat"),
        playerStat: document.getElementById("playerStat"),
        exitStat: document.getElementById("exitStat"),
        updatedStat: document.getElementById("updatedStat"),
        eventList: document.getElementById("eventList"),
      };
    }

    _bindEvents() {
      this.controls.newMazeBtn?.addEventListener("click", () => this._openSizeModal());
      this.controls.refreshBtn?.addEventListener("click", () => {
        if (!this.selectedMazeSize) {
          this._openSizeModal();
          return;
        }
        this._bootstrapSession({ renewSeed: true });
      });
      this.controls.resetBtn?.addEventListener("click", () => {
        if (!this.selectedMazeSize) {
          this._openSizeModal();
          return;
        }
        this._bootstrapSession({ renewSeed: false });
      });
      this.controls.revealBtn?.addEventListener("click", () => this._applyAction("reveal", {}));
      this.controls.themeSelect?.addEventListener("change", () => {
        const theme = this.controls.themeSelect.value;
        this._applyAction("setTheme", { theme });
      });

      this.controls.sizeButtons?.forEach((button) => {
        button.addEventListener("click", () => {
          const size = button.getAttribute("data-maze-size");
          this._chooseMazeSize(size);
        });
      });

      this.controls.gameOverRestart?.addEventListener("click", () => this._restartAfterGameOver());
      this.controls.gameOverMenu?.addEventListener("click", () => this._returnToMenuAfterGameOver());

      const exitModalTargets = [this.controls.exitModal, this.controls.exitModalClose, this.controls.exitModalCancel];
      exitModalTargets.forEach((target) => {
        target?.addEventListener("click", (event) => {
          if (event?.target && event.target !== target && !event.target.hasAttribute("data-exit-modal-close")) {
            return;
          }
          this._closeExitModal();
        });
      });

      this.controls.exitModalConfirm?.addEventListener("click", () => this._startNewMazeAfterVictory());

      const moveButtons = Array.from(document.querySelectorAll("[data-move]"));
      moveButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const direction = button.getAttribute("data-move");
          this._applyAction("move", { direction });
        });
      });

      window.addEventListener("keydown", (event) => {
        if (
          this.controls.sizeModal?.classList.contains("is-open") ||
          this.controls.exitModal?.classList.contains("is-open") ||
          this.controls.gameOverModal?.classList.contains("is-open")
        ) {
          return;
        }
        if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
          return;
        }

        const key = event.key.toLowerCase();
        const directionMap = {
          arrowup: "up",
          w: "up",
          arrowdown: "down",
          s: "down",
          arrowleft: "left",
          a: "left",
          arrowright: "right",
          d: "right",
        };

        if (directionMap[key]) {
          event.preventDefault();
          this._applyAction("move", { direction: directionMap[key] });
          return;
        }

        if (key === "q") {
          event.preventDefault();
          this._applyAction("revealAll", {});
          return;
        }

        if (key === "r") {
          event.preventDefault();
          this._resetMaze();
        }
      });

      window.addEventListener("resize", () => {
        if (this.state) {
          this._centerMazeOnPlayer(this.state);
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this._stopPolling();
          return;
        }

        if (this.state) {
          this._startPolling();
        }
      });
    }

    async _request(path, options = {}) {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: {
          "Content-Type": "application/json",
          "x-labyrinth-session-id": this.sessionId,
          ...(options.headers || {}),
        },
        ...options,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error || payload?.message || `Request failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    }

    async _bootstrapSession(options = {}) {
      if (this.isBusy) return;

      const renewSeed = options.renewSeed === true;
      if (options.size) {
        this.selectedMazeSize = String(options.size).toLowerCase();
      }

      if (!this.selectedMazeSize) {
        this._openSizeModal();
        return;
      }

      if (renewSeed || !this.sessionSeed) {
        this.sessionSeed = createSessionSeed();
      }

      this.sessionConfig = this._buildSessionConfig(this.sessionSeed, this.selectedMazeSize);
      this._setStatus("Starting labyrinth session…", "loading");
      this._closeSizeModal();

      try {
        const snapshot = await this._resetMaze(this.sessionConfig);
        if (snapshot) {
          this._setStatus("Maze ready", snapshot?.stats?.solved ? "success" : "idle");
        }
        this._startPolling();
      } catch (error) {
        this._setStatus(error.message || "Failed to start labyrinth session", "error");
      }
    }

    _openSizeModal() {
      if (this.controls.sizeModal) {
        this.controls.sizeModal.classList.add("is-open");
        this.controls.sizeModal.setAttribute("aria-hidden", "false");
      }
      document.body?.classList.add("labyrinth-size-modal-open");
    }

    _closeSizeModal() {
      if (this.controls.sizeModal) {
        this.controls.sizeModal.classList.remove("is-open");
        this.controls.sizeModal.setAttribute("aria-hidden", "true");
      }
      document.body?.classList.remove("labyrinth-size-modal-open");
    }

    _openExitModal(message = VICTORY_MESSAGE) {
      if (this.controls.exitModalMessage) {
        this.controls.exitModalMessage.textContent = message;
      }

      if (this.controls.exitModal) {
        this.controls.exitModal.classList.add("is-open");
        this.controls.exitModal.setAttribute("aria-hidden", "false");
      }

      document.body?.classList.add("labyrinth-size-modal-open");

      if (this.controls.exitModalConfirm && typeof this.controls.exitModalConfirm.focus === "function") {
        this.controls.exitModalConfirm.focus();
      }
    }

    _openGameOverModal(message = GAME_OVER_MESSAGE) {
      if (this.controls.gameOverMessage) {
        this.controls.gameOverMessage.textContent = message;
      }

      if (this.controls.gameOverModal) {
        this.controls.gameOverModal.classList.add("is-open");
        this.controls.gameOverModal.setAttribute("aria-hidden", "false");
      }

      document.body?.classList.add("labyrinth-size-modal-open");

      if (this.controls.gameOverRestart && typeof this.controls.gameOverRestart.focus === "function") {
        this.controls.gameOverRestart.focus();
      }
    }

    _closeExitModal() {
      if (this.controls.exitModal) {
        this.controls.exitModal.classList.remove("is-open");
        this.controls.exitModal.setAttribute("aria-hidden", "true");
      }

      document.body?.classList.remove("labyrinth-size-modal-open");
    }

    _closeGameOverModal() {
      if (this.controls.gameOverModal) {
        this.controls.gameOverModal.classList.remove("is-open");
        this.controls.gameOverModal.setAttribute("aria-hidden", "true");
      }

      document.body?.classList.remove("labyrinth-size-modal-open");
    }

    _startNewMazeAfterVictory() {
      this._closeExitModal();
      this._bootstrapSession({ renewSeed: true });
    }

    _restartAfterGameOver() {
      const size = this.state?.maze?.size || this.selectedMazeSize || "medium";
      this._closeGameOverModal();
      this._bootstrapSession({ renewSeed: true, size });
    }

    _returnToMenuAfterGameOver() {
      this._stopPolling();
      this._closeGameOverModal();
      this._openSizeModal();
    }

    _chooseMazeSize(size) {
      const nextSize = typeof size === "string" ? size.toLowerCase() : "medium";
      this.selectedMazeSize = nextSize;
      this._bootstrapSession({ renewSeed: true, size: nextSize });
    }

    async _pollUpdates() {
      if (!this.state || this.isBusy) {
        return;
      }

      try {
        const response = await this._request(`/updates?since=${encodeURIComponent(this.state.revision || 0)}`);
        const data = response?.data || response?.result?.data || response?.result || response;
        if (data?.changed) {
          const events = Array.isArray(data?.events) ? data.events : data?.event ? [data.event] : [];
          this._handleLabyrinthEvents(events, response?.message || data?.message || "");
          this._applySnapshot(data.snapshot, { appendEvents: data.events || [] });
          const gameOver = data.snapshot?.stats?.gameOver === true;
          const solved = data.snapshot?.stats?.solved === true;
          this._setStatus(
            gameOver ? "Game over" : solved ? "Exit reached" : "Maze updated",
            gameOver ? "error" : solved ? "success" : "idle",
          );
        }
      } catch (error) {
        this._setStatus(error.message || "Live update poll failed", "error");
      }
    }

    async _applyAction(action, payload = {}) {
      if (this.isBusy) return;
      this.isBusy = true;
      try {
        const response = await this._request("/actions", {
          method: "POST",
          body: JSON.stringify({ action, payload }),
        });

        const data = response?.data || response?.result?.data || response?.result || response;
        const snapshot = data?.snapshot || data;
        const events = Array.isArray(data?.events) ? data.events : data?.event ? [data.event] : [];
        this._handleLabyrinthEvents(events, response?.message || data?.message || "");
        this._applySnapshot(snapshot, { appendEvents: events });
        const gameOver = snapshot?.stats?.gameOver === true;
        const solved = snapshot?.stats?.solved === true;
        this._setStatus(
          gameOver ? "Game over" : solved ? "Exit reached" : `Action ${action} applied`,
          gameOver ? "error" : solved ? "success" : "idle",
        );
        return snapshot;
      } catch (error) {
        this._setStatus(error.message || `Action ${action} failed`, "error");
        return null;
      } finally {
        this.isBusy = false;
      }
    }

    _applySnapshot(snapshot, options = {}) {
      if (!snapshot || !snapshot.grid) {
        return;
      }

      this.state = snapshot;
      this._renderTheme(snapshot.theme);
      this._renderThemeInfo(snapshot);
      this._renderHeader(snapshot);
      this._renderStats(snapshot);
      this._renderGrid(snapshot);
      requestAnimationFrame(() => this._centerMazeOnPlayer(snapshot));
      this._renderEvents(options.resetEvents ? [] : options.appendEvents || [], options.resetEvents === true);
    }

    _handleLabyrinthEvents(events = [], fallbackMessage = "") {
      events.forEach((event) => {
        if (!event) {
          return;
        }

        if (event.type === "exitReached") {
          const message = event.details?.message || fallbackMessage || VICTORY_MESSAGE;
          this._openExitModal(message);
          this._stopPolling();
          return;
        }

        if (event.type === "gameOver") {
          const message = event.details?.message || fallbackMessage || GAME_OVER_MESSAGE;
          this._openGameOverModal(message);
          this._stopPolling();
          return;
        }

        if (event.type !== "scrollPickedUp") {
          return;
        }

        const scrollText = event.details?.scroll?.text || event.details?.text || "a cryptic scroll";
        this._showNotification(`You found a scroll: ${scrollText}`, "info", 6000);
      });
    }

    _showNotification(message, type = "info", duration = 6000) {
      const hasAppNotification =
        typeof window !== "undefined" && typeof window.showNotification === "function" && !!window.App?.getModule?.("notification");

      if (hasAppNotification) {
        window.showNotification(message, type, duration);
        return;
      }

      this._showLocalNotification(message, type, duration);
    }

    _showLocalNotification(message, type = "info", duration = 10000) {
      if (typeof document === "undefined" || !document.body || typeof document.createElement !== "function") {
        return;
      }

      const container = this._getNotificationContainer();
      if (!container) {
        return;
      }

      const toast = document.createElement("div");
      toast.className = `labyrinth-toast labyrinth-toast--${type}`.trim();
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");

      const header = document.createElement("div");
      header.className = "labyrinth-toast__header";

      const icon = document.createElement("div");
      icon.className = "labyrinth-toast__icon";
      icon.innerHTML = '<i class="fas fa-scroll"></i>';

      const title = document.createElement("span");
      title.className = "labyrinth-toast__title";
      title.textContent = type === "info" ? "Scroll found" : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "labyrinth-toast__close";
      close.setAttribute("aria-label", "Dismiss notification");
      close.textContent = "×";
      close.addEventListener("click", () => this._removeLocalNotification(toast, container));

      const messageNode = document.createElement("div");
      messageNode.className = "labyrinth-toast__message";
      messageNode.textContent = message;

      header.appendChild(icon);
      header.appendChild(title);
      header.appendChild(close);
      toast.appendChild(header);
      toast.appendChild(messageNode);
      container.appendChild(toast);

      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => toast.classList.add("show"));
      } else {
        toast.classList.add("show");
      }

      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => this._removeLocalNotification(toast, container), duration);
      }
    }

    _getNotificationContainer() {
      if (this._notificationContainer && typeof this._notificationContainer.appendChild === "function") {
        return this._notificationContainer;
      }

      const container = document.createElement("div");
      container.className = "labyrinth-toast-stack";
      container.setAttribute("aria-live", "polite");
      container.setAttribute("aria-atomic", "true");
      document.body.appendChild(container);
      this._notificationContainer = container;
      return container;
    }

    _removeLocalNotification(toast, container) {
      if (!toast) {
        return;
      }

      if (toast.classList && typeof toast.classList.add === "function") {
        toast.classList.add("removing");
      }

      const removeToast = () => {
        if (typeof toast.remove === "function") {
          toast.remove();
          return;
        }

        if (container && typeof container.removeChild === "function") {
          try {
            container.removeChild(toast);
          } catch (error) {
            // Ignore stale DOM references in lightweight test environments.
          }
        }
      };

      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(removeToast, 220);
      } else {
        removeToast();
      }
    }

    _renderTheme(theme) {
      const body = document.body;
      if (!body) return;

      const themeName = theme?.name || "obsidian";
      body.dataset.labyrinthTheme = themeName;
      const palette = theme?.palette || {};
      const rootStyle = document.documentElement.style;
      const mappings = {
        "--labyrinth-accent": palette.accent,
        "--labyrinth-accent-soft": palette.accentSoft,
        "--labyrinth-bg": palette.background,
        "--labyrinth-panel": palette.panel,
        "--labyrinth-border": palette.border,
        "--labyrinth-path": palette.path,
        "--labyrinth-wall": palette.wall,
        "--labyrinth-fog": palette.fog,
        "--labyrinth-fog-line": palette.fogLine,
        "--labyrinth-player": palette.player,
        "--labyrinth-exit": palette.exit,
        "--labyrinth-discovered": palette.discovered,
      };

      Object.entries(mappings).forEach(([prop, value]) => {
        if (value) {
          rootStyle.setProperty(prop, value);
        }
      });
    }

    _renderThemeInfo(snapshot) {
      if (this.controls.themeSelect && Array.isArray(snapshot?.capabilities?.themes)) {
        this.controls.themeSelect.innerHTML = snapshot.capabilities.themes
          .map((theme) => `<option value="${theme.name}">${theme.label}</option>`)
          .join("");
        this.controls.themeSelect.value = snapshot?.theme?.name || this.controls.themeSelect.value || "obsidian";
      }
    }

    _renderHeader(snapshot) {
      const revision = snapshot?.revision || 0;
      if (this.controls.revisionBadge) {
        this.controls.revisionBadge.textContent = `rev ${revision}`;
      }
      if (this.controls.updatedStat) {
        this.controls.updatedStat.textContent = formatTime(snapshot?.updatedAt);
      }
      if (this.controls.playerStat) {
        this.controls.playerStat.textContent = `${snapshot?.player?.x ?? 0}, ${snapshot?.player?.y ?? 0}`;
      }
      if (this.controls.exitStat) {
        this.controls.exitStat.textContent = `${snapshot?.maze?.exit?.x ?? 0}, ${snapshot?.maze?.exit?.y ?? 0}`;
      }
    }

    _renderStats(snapshot) {
      if (this.controls.movesStat) this.controls.movesStat.textContent = String(snapshot?.stats?.moves ?? 0);
      if (this.controls.revealsStat) this.controls.revealsStat.textContent = String(snapshot?.stats?.reveals ?? 0);
      if (this.controls.coverageStat) this.controls.coverageStat.textContent = `${snapshot?.stats?.explored ?? 0}%`;
      if (this.controls.solvedStat) this.controls.solvedStat.textContent = snapshot?.stats?.solved === true ? "Solved" : "Searching";
    }

    _normalizeGridCell(cell) {
      if (!cell || typeof cell !== "object") {
        return {
          className: "is-fog is-hidden is-muted",
          icon: "fa-smog",
          label: "Fog",
        };
      }

      if (cell.className && cell.icon && cell.label) {
        return cell;
      }

      const type = cell.t || cell.type || "fog";
      const isVisible = cell.v !== 0;

      switch (type) {
        case "player":
          return {
            className: "is-path is-discovered is-visible is-player",
            icon: "fa-person",
            label: "Player",
          };
        case "monster":
          return {
            className: `is-monster is-discovered ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: "fa-ghost",
            label: isVisible ? "Monster" : "Remembered monster",
          };
        case "key":
          return {
            className: `is-key is-discovered ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: "fa-key",
            label: isVisible ? "Key" : "Remembered key",
          };
        case "door":
          return {
            className: `is-door is-discovered ${cell.locked ? "is-locked" : "is-open"} ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: cell.locked ? "fa-door-closed" : "fa-door-open",
            label: cell.locked ? (isVisible ? "Locked door" : "Remembered locked door") : isVisible ? "Door" : "Remembered door",
          };
        case "scroll":
          return {
            className: `is-scroll is-discovered ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: "fa-scroll",
            label: isVisible ? "Scroll" : "Remembered scroll",
          };
        case "exit":
          return {
            className: `is-path is-discovered ${isVisible ? "is-visible" : "is-muted"} is-exit`.trim(),
            icon: isVisible ? "fa-flag-checkered" : "fa-flag",
            label: isVisible ? "Exit" : "Remembered exit",
          };
        case "wall":
          return {
            className: `is-wall is-discovered ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: "fa-wheat-awn",
            label: isVisible ? "Wall" : "Remembered wall",
          };
        case "path":
          return {
            className: `is-path is-discovered ${isVisible ? "is-visible" : "is-muted"}`.trim(),
            icon: "fa-circle-dot",
            label: isVisible ? "Open path" : "Remembered path",
          };
        case "fog":
        default:
          return {
            className: "is-fog is-hidden is-muted",
            icon: "fa-smog",
            label: "Fog",
          };
      }
    }

    _renderGrid(snapshot) {
      if (!this.controls.mazeGrid) return;

      const rows = Array.isArray(snapshot?.grid) ? snapshot.grid : [];
      const viewport = snapshot?.viewport || {};
      const viewportWidth = Number(viewport.width) || (Array.isArray(rows[0]) ? rows[0].length : 0) || 17;
      const viewportHeight = Number(viewport.height) || rows.length || 17;

      this.controls.mazeGrid.style.setProperty("--maze-width", String(viewportWidth));
      this.controls.mazeGrid.style.setProperty("--maze-height", String(viewportHeight));
      this.controls.mazeGrid.style.transform = "translate3d(0, 0, 0)";
      this.controls.mazeGrid.innerHTML = "";

      const fragment = document.createDocumentFragment();
      rows.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          const viewCell = this._normalizeGridCell(cell);
          const button = document.createElement("button");
          button.type = "button";
          button.className = `labyrinth-cell ${viewCell.className || ""}`.trim();
          button.title = viewCell.label;
          button.setAttribute("aria-label", viewCell.label);
          button.setAttribute("role", "gridcell");
          button.dataset.x = String(Number(snapshot?.viewport?.startX || 0) + colIndex);
          button.dataset.y = String(Number(snapshot?.viewport?.startY || 0) + rowIndex);
          button.innerHTML = `<i class="fas ${viewCell.icon}"></i><span class="sr-only">${viewCell.label}</span>`;
          fragment.appendChild(button);
        });
      });

      this.controls.mazeGrid.appendChild(fragment);
    }

    _centerMazeOnPlayer(snapshot) {
      if (!this.controls.mazeGrid) {
        return;
      }

      this.controls.mazeGrid.style.transform = "translate3d(0, 0, 0)";
    }

    _renderEvents(events = [], reset = false) {
      if (!this.controls.eventList) return;

      const nextEvents = reset ? events : [...events, ...(this._currentEvents() || [])];
      this._eventCache = nextEvents.slice(0, 8);
      this.controls.eventList.innerHTML = "";

      const fragment = document.createDocumentFragment();
      this._eventCache.forEach((event) => {
        const item = document.createElement("li");
        item.className = "labyrinth-event";

        const top = document.createElement("div");
        top.className = "labyrinth-event__top";

        const kind = document.createElement("span");
        kind.className = "labyrinth-event__kind";
        kind.textContent = this._getEventLabel(event);

        const revision = document.createElement("span");
        revision.textContent = event.revision == null ? "" : String(event.revision);

        const details = document.createElement("p");
        details.className = "labyrinth-event__details";
        details.textContent = this._getEventSummary(event);

        top.appendChild(kind);
        top.appendChild(revision);
        item.appendChild(top);
        item.appendChild(details);
        fragment.appendChild(item);
      });

      this.controls.eventList.appendChild(fragment);
    }

    _getEventLabel(event = {}) {
      if (event.type === "exitReached") return "Victory";
      if (event.type === "gameOver") return "Game over";
      if (event.type === "scrollPickedUp") return "Scroll";
      if (event.type === "keyCollected") return "Key";
      if (event.type === "monsterMoved") return "Monster";
      if (event.type === "moveBlocked") return "Blocked";
      if (event.type === "revealAll") return "Reveal all";
      if (event.type === "reveal") return "Reveal";
      if (event.type === "reset") return "Reset";
      return event.type || "Event";
    }

    _getEventSummary(event = {}) {
      const details = event?.details || {};

      if (typeof details.message === "string" && details.message.trim()) {
        return details.message;
      }

      if (event.type === "scrollPickedUp") {
        return details.scroll?.text ? `Found: ${details.scroll.text}` : "Found a scroll";
      }

      if (event.type === "exitReached") {
        return "You reached the exit.";
      }

      if (event.type === "gameOver") {
        return details.reason ? `Game over (${details.reason})` : "Game over";
      }

      if (event.type === "moveBlocked") {
        return details.reason ? `Blocked (${details.reason})` : "Move blocked";
      }

      if (event.type === "move") {
        const parts = [];
        if (details.direction) parts.push(`Moved ${details.direction}`);
        if (typeof details.solved === "boolean") parts.push(details.solved ? "maze solved" : "exploring");
        if (details.key) parts.push("key found");
        if (details.monster) parts.push("monster moved");
        return parts.length > 0 ? parts.join(" • ") : "Move applied";
      }

      if (event.type === "keyCollected") {
        return details.key?.position ? `Key at ${details.key.position.x},${details.key.position.y}` : "Found a key";
      }

      if (event.type === "monsterMoved") {
        return details.monster?.to ? `Monster moved to ${details.monster.to.x},${details.monster.to.y}` : "Monster moved";
      }

      if (event.type === "revealAll") {
        return details.revealed ? `Revealed ${details.revealed} cells` : "Revealed the whole maze";
      }

      if (event.type === "reveal") {
        return typeof details.radius === "number" ? `Revealed radius ${details.radius}` : "Revealed nearby cells";
      }

      if (event.type === "reset") {
        return details.seed ? `Seed ${details.seed}` : "Maze reset";
      }

      const summaryParts = [];
      Object.entries(details).forEach(([key, value]) => {
        if (value == null || typeof value === "object") {
          return;
        }

        summaryParts.push(`${key}: ${String(value)}`);
      });

      return summaryParts.length > 0 ? summaryParts.join(" • ") : "Event recorded";
    }

    _currentEvents() {
      return Array.isArray(this._eventCache) ? this._eventCache : [];
    }

    _setStatus(message, tone = "idle") {
      if (this.controls.statusPill) {
        this.controls.statusPill.textContent = message;
        this.controls.statusPill.dataset.tone = tone;
      }
      if (this.controls.statusHint) {
        this.controls.statusHint.textContent =
          tone === "error" ? "Check the configuration or retry the action." : "Use the controls to continue exploring.";
      }
    }

    async _resetMaze(payload = {}) {
      return this._applyAction("reset", payload);
    }

    _buildSessionConfig(seed, size) {
      return {
        seed: seed || createSessionSeed(),
        size: size || this.selectedMazeSize || "medium",
        fogEnabled: true,
        theme: DEFAULT_SESSION_THEME,
      };
    }

    _startPolling() {
      this._stopPolling();
      if (document.hidden) {
        return;
      }

      this.pollTimer = window.setTimeout(() => this._pollUpdatesLoop(), POLL_INTERVAL_MS);
    }

    _stopPolling() {
      if (this.pollTimer) {
        window.clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    }

    async _pollUpdatesLoop() {
      if (!this.state || document.hidden) {
        this._stopPolling();
        return;
      }

      await this._pollUpdates();

      if (this.state && !document.hidden) {
        this.pollTimer = window.setTimeout(() => this._pollUpdatesLoop(), POLL_INTERVAL_MS);
      }
    }
  }

  const page = new LabyrinthPage();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => page.init());
  } else {
    page.init();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = LabyrinthPage;
  } else {
    window.LabyrinthPage = LabyrinthPage;
  }
})();
