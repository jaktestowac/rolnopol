(function () {
  "use strict";

  const API_ROOT = "/api/v1/tape-recorder";
  const SESSION_STORAGE_KEY = "rolnopol.tape-recorder.session-id";

  function createBrowserSessionId() {
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return `tape-recorder-session-${randomPart}`;
  }

  function loadSessionId() {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return createBrowserSessionId();
    }

    try {
      const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (existing) {
        return existing;
      }

      const next = createBrowserSessionId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
      return next;
    } catch (error) {
      return createBrowserSessionId();
    }
  }

  function formatDateTime(value) {
    if (!value) {
      return "Unknown date";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleString();
  }

  function formatTapeStatus(tape) {
    if (!tape) {
      return "Awaiting selection";
    }

    if (tape.locked) {
      return "Locked";
    }

    if (tape.progress?.completed === true || tape.status === "completed") {
      return "Completed";
    }

    if ((tape.progress?.discoveredFragments || tape.discoveredFragments || 0) > 0) {
      return "In progress";
    }

    return "Ready";
  }

  function formatCabinetPath(pathSegments = []) {
    return Array.isArray(pathSegments) && pathSegments.length > 0 ? pathSegments.join(" / ") : "Root cabinet";
  }

  function canUseSpeechSynthesis() {
    return (
      typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  class FarmerTapeRecorderPage {
    constructor() {
      this.state = null;
      this.isBusy = false;
      this.sessionId = loadSessionId();
      this.expandedFolders = new Set();
      this.ttsSupported = canUseSpeechSynthesis();
      this.activeSpeechFragmentId = null;
      this.currentUtterance = null;
      this.controls = {};
    }

    init() {
      this._cacheDom();
      if (!this.controls.shell) {
        return;
      }

      this._bindEvents();
      this.loadSnapshot();
    }

    _cacheDom() {
      this.controls = {
        shell: document.getElementById("tapeRecorderShell"),
        status: document.getElementById("tapeRecorderStatus"),
        sortSelect: document.getElementById("tapeSortSelect"),
        resetBtn: document.getElementById("tapeResetBtn"),
        cabinetCount: document.getElementById("tapeCabinetCount"),
        cabinetList: document.getElementById("tapeCabinetList"),
        detailTitle: document.getElementById("tapeDetailTitle"),
        detailMeta: document.getElementById("tapeDetailMeta"),
        detailSummary: document.getElementById("tapeDetailSummary"),
        statusBadge: document.getElementById("tapeStatusBadge"),
        advanceBtn: document.getElementById("tapeAdvanceBtn"),
        speakBtn: document.getElementById("tapeSpeakBtn"),
        speechStatus: document.getElementById("tapeSpeechStatus"),
        transcriptView: document.getElementById("tapeTranscriptView"),
        fragmentCounter: document.getElementById("fragmentCounter"),
        fragmentList: document.getElementById("tapeFragmentList"),
        activityList: document.getElementById("tapeActivityList"),
      };
    }

    _bindEvents() {
      this.controls.sortSelect?.addEventListener("change", () => {
        const sort = this.controls.sortSelect.value;
        this.performAction("setSort", { sort });
      });

      this.controls.resetBtn?.addEventListener("click", () => {
        this.performAction("resetSession", { preserveSort: true });
      });

      this.controls.advanceBtn?.addEventListener("click", () => {
        const currentTape = this.state?.currentTape;
        if (!currentTape?.controls?.canAdvance) {
          return;
        }

        this.performAction("playNext", {
          tapeId: currentTape.id,
          token: currentTape.controls.advanceToken,
        });
      });

      this.controls.speakBtn?.addEventListener("click", () => {
        this.toggleSpeechPlayback();
      });

      this.controls.cabinetList?.addEventListener("click", (event) => {
        const folderToggle = event.target.closest("button[data-action='toggle-folder']");
        if (folderToggle && folderToggle.disabled !== true) {
          const folderId = folderToggle.getAttribute("data-folder-id");
          this.toggleFolder(folderId);
          return;
        }

        const button = event.target.closest("button[data-action='select-tape']");
        if (!button || button.disabled) {
          return;
        }

        const tapeId = button.getAttribute("data-tape-id");
        this.performAction("selectTape", { tapeId });
      });

      this.controls.fragmentList?.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action='revisit-fragment']");
        if (!button || button.disabled) {
          return;
        }

        const fragmentId = button.getAttribute("data-fragment-id");
        const tapeId = this.state?.currentTape?.id;
        if (!fragmentId || !tapeId) {
          return;
        }

        this.performAction("revisitFragment", { tapeId, fragmentId });
      });
    }

    async request(path = "", options = {}) {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: {
          "Content-Type": "application/json",
          "x-farmer-tape-session-id": this.sessionId,
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

    _extractData(payload) {
      return payload?.data || payload?.result?.data || payload?.result || payload;
    }

    async loadSnapshot() {
      this._setStatus("Synchronizing cabinet…", "idle");

      try {
        const payload = await this.request("");
        const data = this._extractData(payload);
        this.applySnapshot(data);
        this._setStatus(data?.page?.subtitle || "Cabinet ready.", "success");
      } catch (error) {
        this._setStatus(error.message || "Failed to load tape recorder cabinet", "error");
      }
    }

    async performAction(action, payload = {}) {
      if (this.isBusy) {
        return;
      }

      this.isBusy = true;
      this._setBusy(true);

      try {
        const response = await this.request("/actions", {
          method: "POST",
          body: JSON.stringify({ action, payload }),
        });
        const data = this._extractData(response);
        this.applySnapshot(data?.snapshot || data);
        this._setStatus(response?.message || data?.message || `Action ${action} applied.`, "success");
      } catch (error) {
        this._setStatus(error.message || `Failed to apply ${action}`, "error");
      } finally {
        this.isBusy = false;
        this._setBusy(false);
      }
    }

    cancelSpeechPlayback(options = {}) {
      if (this.ttsSupported && typeof window.speechSynthesis.cancel === "function") {
        window.speechSynthesis.cancel();
      }

      this.activeSpeechFragmentId = null;
      this.currentUtterance = null;

      if (options.skipRender !== true) {
        this.renderSpeechControls(this.state?.currentTape?.currentFragment || null);
      }
    }

    buildSpeechText(fragment, currentTape) {
      if (!fragment) {
        return "";
      }

      const segments = [
        currentTape?.title ? `Recording ${currentTape.title}.` : "",
        fragment.title ? `${fragment.title}.` : "",
        fragment.excerpt || "",
        ...(Array.isArray(fragment.transcript) ? fragment.transcript : []),
        fragment.note ? `Archivist note. ${fragment.note}` : "",
      ];

      return segments
        .filter((segment) => typeof segment === "string" && segment.trim().length > 0)
        .join(" ")
        .trim();
    }

    toggleSpeechPlayback() {
      const currentTape = this.state?.currentTape || null;
      const fragment = currentTape?.currentFragment || null;

      if (!fragment) {
        this.renderSpeechControls(null);
        return;
      }

      if (!this.ttsSupported) {
        this.renderSpeechControls(fragment, { message: "Browser speech is unavailable here.", tone: "error" });
        return;
      }

      if (this.activeSpeechFragmentId === fragment.id) {
        this.cancelSpeechPlayback();
        this.renderSpeechControls(fragment, { message: "Playback stopped.", tone: "idle" });
        return;
      }

      const text = this.buildSpeechText(fragment, currentTape);
      if (!text) {
        this.renderSpeechControls(fragment, { message: "Nothing readable in this fragment yet.", tone: "error" });
        return;
      }

      this.cancelSpeechPlayback({ skipRender: true });

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96;
      utterance.pitch = 0.92;
      utterance.onend = () => {
        this.activeSpeechFragmentId = null;
        this.currentUtterance = null;
        this.renderSpeechControls(this.state?.currentTape?.currentFragment || null, { message: "Playback finished.", tone: "idle" });
      };
      utterance.onerror = () => {
        this.activeSpeechFragmentId = null;
        this.currentUtterance = null;
        this.renderSpeechControls(this.state?.currentTape?.currentFragment || null, { message: "Playback failed.", tone: "error" });
      };

      this.currentUtterance = utterance;
      this.activeSpeechFragmentId = fragment.id;
      window.speechSynthesis.speak(utterance);
      this.renderSpeechControls(fragment, { message: "Reading current fragment aloud…", tone: "active" });
    }

    renderSpeechControls(fragment, options = {}) {
      if (this.controls.speakBtn) {
        const isActive = fragment?.id && this.activeSpeechFragmentId === fragment.id;
        this.controls.speakBtn.disabled = !fragment || this.isBusy;
        this.controls.speakBtn.dataset.state = isActive ? "active" : "idle";

        const icon = this.controls.speakBtn.querySelector("i");
        if (icon) {
          icon.className = isActive ? "fas fa-stop" : "fas fa-volume-high";
        }

        const label = this.controls.speakBtn.querySelector("span");
        if (label) {
          label.textContent = isActive ? "Stop reading" : "Read fragment";
        }
      }

      if (this.controls.speechStatus) {
        const fallbackMessage = !fragment
          ? "Text-to-speech waits for a recovered fragment."
          : !this.ttsSupported
            ? "Browser speech is unavailable here."
            : this.activeSpeechFragmentId === fragment.id
              ? "Reading current fragment aloud…"
              : "Use text-to-speech to read the active fragment aloud.";

        this.controls.speechStatus.textContent = options.message || fallbackMessage;
        this.controls.speechStatus.dataset.tone = options.tone || (this.activeSpeechFragmentId === fragment?.id ? "active" : "idle");
      }
    }

    _setBusy(busy) {
      if (this.controls.shell) {
        this.controls.shell.dataset.busy = busy ? "true" : "false";
      }

      if (this.controls.advanceBtn) {
        const canAdvance = this.state?.currentTape?.controls?.canAdvance === true;
        this.controls.advanceBtn.disabled = busy ? true : !canAdvance;
      }

      if (this.controls.speakBtn) {
        const hasFragment = Boolean(this.state?.currentTape?.currentFragment);
        this.controls.speakBtn.disabled = busy ? true : !hasFragment;
      }
    }

    _setStatus(message, tone = "idle") {
      if (!this.controls.status) {
        return;
      }

      this.controls.status.textContent = message;
      this.controls.status.dataset.tone = tone;
    }

    applySnapshot(snapshot) {
      if (!snapshot) {
        return;
      }

      this.state = snapshot;
      this._syncExpandedFolders();
      this.renderSortOptions();
      this.renderCabinet();
      this.renderCurrentTape();
      this.renderActivity();
    }

    toggleFolder(folderId) {
      if (!folderId) {
        return;
      }

      if (this.expandedFolders.has(folderId)) {
        this.expandedFolders.delete(folderId);
      } else {
        this.expandedFolders.add(folderId);
      }

      this.renderCabinet();
    }

    _syncExpandedFolders() {
      const entries = Array.isArray(this.state?.cabinet?.entries) ? this.state.cabinet.entries : [];
      const activeTapeId = this.state?.currentTape?.id || null;
      const validFolderIds = new Set();

      const visitEntry = (entry) => {
        if (!entry) {
          return false;
        }

        if (entry.type === "tape") {
          return entry.id === activeTapeId;
        }

        validFolderIds.add(entry.id);
        const hasActiveDescendant = Array.isArray(entry.children) ? entry.children.some((child) => visitEntry(child)) : false;

        return hasActiveDescendant;
      };

      entries.forEach((entry) => visitEntry(entry));

      const nextExpandedFolders = new Set(Array.from(this.expandedFolders).filter((folderId) => validFolderIds.has(folderId)));

      if (activeTapeId) {
        const markActivePath = (entry) => {
          if (!entry) {
            return false;
          }

          if (entry.type === "tape") {
            return entry.id === activeTapeId;
          }

          const hasActiveDescendant = Array.isArray(entry.children) ? entry.children.some((child) => markActivePath(child)) : false;
          if (hasActiveDescendant) {
            nextExpandedFolders.add(entry.id);
          }

          return hasActiveDescendant;
        };

        entries.forEach((entry) => markActivePath(entry));
      }

      this.expandedFolders = nextExpandedFolders;
    }

    renderSortOptions() {
      const sortOptions = Array.isArray(this.state?.cabinet?.sortOptions) ? this.state.cabinet.sortOptions : [];
      if (!this.controls.sortSelect || sortOptions.length === 0) {
        return;
      }

      this.controls.sortSelect.innerHTML = "";
      sortOptions.forEach((option) => {
        const element = document.createElement("option");
        element.value = option.name;
        element.textContent = option.label;
        this.controls.sortSelect.appendChild(element);
      });
      this.controls.sortSelect.value = this.state?.cabinet?.sort || sortOptions[0]?.name || "story";
    }

    renderCabinet() {
      const cabinet = this.state?.cabinet;
      const tapes = Array.isArray(cabinet?.tapes) ? cabinet.tapes : [];
      const entries = Array.isArray(cabinet?.entries) ? cabinet.entries : [];
      const activeTapeId = this.state?.currentTape?.id || null;

      if (this.controls.cabinetCount) {
        this.controls.cabinetCount.textContent = `${cabinet?.unlockedTapes || 0} / ${cabinet?.totalTapes || tapes.length} tapes • ${cabinet?.totalDirectories || 0} dirs`;
      }

      if (!this.controls.cabinetList) {
        return;
      }

      this.controls.cabinetList.innerHTML = "";

      const sourceEntries = entries.length > 0 ? entries : tapes.map((tape) => ({ type: "tape", ...tape }));
      sourceEntries.forEach((entry) => {
        this.controls.cabinetList.appendChild(this._renderCabinetEntry(entry, activeTapeId));
      });
    }

    _renderCabinetEntry(entry, activeTapeId) {
      if (entry?.type === "folder") {
        const section = document.createElement("section");
        const isExpanded = this.expandedFolders.has(entry.id);
        section.className = `tape-folder ${isExpanded ? "is-expanded" : "is-collapsed"}`.trim();

        const header = document.createElement("div");
        header.className = "tape-folder__header";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "tape-folder__toggle";
        toggle.setAttribute("data-action", "toggle-folder");
        toggle.setAttribute("data-folder-id", entry.id);
        toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");

        const copy = document.createElement("div");

        const title = document.createElement("h3");
        title.className = "tape-folder__title";

        const caret = document.createElement("span");
        caret.className = "tape-folder__caret";
        caret.textContent = "▾";

        const icon = document.createElement("span");
        icon.className = "tape-folder__icon";
        icon.textContent = "📁";

        const label = document.createElement("span");
        label.textContent = entry.label;

        title.appendChild(caret);
        title.appendChild(icon);
        title.appendChild(label);

        const meta = document.createElement("p");
        meta.className = "tape-folder__meta";
        meta.textContent = `${entry.unlockedTapes || 0}/${entry.tapeCount || 0} tapes unlocked • ${entry.folderCount || 0} nested folder${entry.folderCount === 1 ? "" : "s"}`;

        const summary = document.createElement("p");
        summary.className = "tape-folder__summary";
        summary.textContent = `${entry.discoveredFragments || 0}/${entry.totalFragments || 0} fragments recovered`;

        copy.appendChild(title);
        copy.appendChild(meta);
        copy.appendChild(summary);
        toggle.appendChild(copy);

        const badge = document.createElement("span");
        badge.className = "tape-panel__badge";
        badge.textContent = `${entry.path?.length || 1} level${entry.path?.length === 1 ? "" : "s"}`;

        header.appendChild(toggle);
        header.appendChild(badge);
        section.appendChild(header);

        const children = document.createElement("div");
        children.className = "tape-folder__children";
        children.hidden = !isExpanded;
        (entry.children || []).forEach((child) => {
          children.appendChild(this._renderCabinetEntry(child, activeTapeId));
        });
        section.appendChild(children);

        return section;
      }

      return this._renderCabinetTapeCard(entry, activeTapeId);
    }

    _renderCabinetTapeCard(tape, activeTapeId) {
      const wrapper = document.createElement("div");
      wrapper.className = "tape-entry";

      const button = document.createElement("button");
      button.type = "button";
      button.className = `tape-card ${tape.id === activeTapeId ? "is-active" : ""} ${tape.locked ? "is-locked" : ""}`.trim();
      button.setAttribute("data-action", "select-tape");
      button.setAttribute("data-tape-id", tape.id);
      button.disabled = tape.locked === true;

      const top = document.createElement("div");
      top.className = "tape-card__top";

      const titleWrap = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "tape-card__title";
      title.textContent = tape.title;

      const meta = document.createElement("p");
      meta.className = "tape-card__meta";
      meta.textContent = `${formatDateTime(tape.recordedAt)} • ${tape.location}`;

      titleWrap.appendChild(title);
      titleWrap.appendChild(meta);

      const status = document.createElement("span");
      status.className = "tape-card__status";
      status.dataset.status = tape.status || "unopened";
      status.textContent = formatTapeStatus(tape);

      top.appendChild(titleWrap);
      top.appendChild(status);

      const summary = document.createElement("p");
      summary.className = "tape-card__summary";
      summary.textContent = tape.summary;

      const progress = document.createElement("div");
      progress.className = "tape-card__progress";

      const progressText = document.createElement("span");
      progressText.textContent = `${tape.discoveredFragments}/${tape.totalFragments} fragments recovered`;

      const hook = document.createElement("span");
      hook.textContent = tape.locked ? `Needs: ${(tape.unlock?.requiresCompleted || []).map((item) => item.title).join(", ")}` : tape.hook;

      progress.appendChild(progressText);
      progress.appendChild(hook);

      button.appendChild(top);
      button.appendChild(summary);
      button.appendChild(progress);
      wrapper.appendChild(button);
      return wrapper;
    }

    renderCurrentTape() {
      const currentTape = this.state?.currentTape;
      const currentFragment = currentTape?.currentFragment;

      if (this.activeSpeechFragmentId && this.activeSpeechFragmentId !== currentFragment?.id) {
        this.cancelSpeechPlayback({ skipRender: true });
      }

      if (!currentTape) {
        this._renderTapePlaceholder();
        return;
      }

      if (this.controls.detailTitle) {
        this.controls.detailTitle.textContent = currentTape.title;
      }

      if (this.controls.detailMeta) {
        this.controls.detailMeta.textContent = `${formatDateTime(currentTape.recordedAt)} • ${currentTape.location} • ${currentTape.season}`;
      }

      if (this.controls.detailSummary) {
        const pathLabel = formatCabinetPath(currentTape.cabinetPath || []);
        this.controls.detailSummary.textContent = `${currentTape.summary} Stored under ${pathLabel}.`;
      }

      if (this.controls.statusBadge) {
        this.controls.statusBadge.textContent = formatTapeStatus(currentTape);
      }

      if (this.controls.fragmentCounter) {
        this.controls.fragmentCounter.textContent = `${currentTape.progress?.discoveredFragments || 0} / ${currentTape.progress?.totalFragments || 0}`;
      }

      if (this.controls.advanceBtn) {
        const canAdvance = currentTape.controls?.canAdvance === true;
        this.controls.advanceBtn.disabled = !canAdvance || this.isBusy;
        const label = currentTape.progress?.discoveredFragments > 0 ? "Investigate next fragment" : "Investigate first fragment";
        this.controls.advanceBtn.querySelector("span").textContent = canAdvance ? label : "Tape complete";
      }

      this._renderFragmentList(currentTape);
      this._renderTranscript(currentFragment, currentTape);
      this.renderSpeechControls(currentFragment);
    }

    _renderTapePlaceholder() {
      if (this.controls.detailTitle) {
        this.controls.detailTitle.textContent = "Choose a recording";
      }
      if (this.controls.detailMeta) {
        this.controls.detailMeta.textContent = "The cabinet only releases one fragment at a time.";
      }
      if (this.controls.detailSummary) {
        this.controls.detailSummary.textContent = "Select an unlocked tape, then investigate it step by step.";
      }
      if (this.controls.statusBadge) {
        this.controls.statusBadge.textContent = "Awaiting selection";
      }
      if (this.controls.fragmentCounter) {
        this.controls.fragmentCounter.textContent = "0 / 0";
      }
      if (this.controls.advanceBtn) {
        this.controls.advanceBtn.disabled = true;
      }
      this.cancelSpeechPlayback({ skipRender: true });
      this.renderSpeechControls(null);
      if (this.controls.fragmentList) {
        this.controls.fragmentList.innerHTML = "";
      }
      if (this.controls.transcriptView) {
        this.controls.transcriptView.innerHTML = "";
        const placeholder = document.createElement("p");
        placeholder.className = "tape-transcript-placeholder";
        placeholder.textContent = "No fragment loaded yet.";
        this.controls.transcriptView.appendChild(placeholder);
      }
    }

    _renderFragmentList(currentTape) {
      if (!this.controls.fragmentList) {
        return;
      }

      this.controls.fragmentList.innerHTML = "";
      const discoveredFragments = Array.isArray(currentTape?.discoveredFragments) ? currentTape.discoveredFragments : [];

      if (discoveredFragments.length === 0) {
        const placeholder = document.createElement("p");
        placeholder.className = "tape-transcript-placeholder";
        placeholder.textContent = "No fragments recovered yet. Use the investigation button to unseal the first one.";
        this.controls.fragmentList.appendChild(placeholder);
        return;
      }

      discoveredFragments.forEach((fragment) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `tape-fragment-item ${fragment.current ? "is-current" : ""}`.trim();
        button.setAttribute("data-action", "revisit-fragment");
        button.setAttribute("data-fragment-id", fragment.id);

        const top = document.createElement("div");
        top.className = "tape-fragment-item__top";

        const title = document.createElement("h4");
        title.className = "tape-fragment-item__title";
        title.textContent = fragment.title;

        const metaWrap = document.createElement("span");
        metaWrap.className = "tape-fragment-item__meta";

        const part = document.createElement("span");
        part.className = "tape-fragment-item__part";
        part.textContent = `Part ${fragment.partNumber || "?"} of ${fragment.totalParts || "?"}`;

        const marker = document.createElement("span");
        marker.className = "tape-fragment-item__marker";
        marker.textContent = fragment.marker;

        const summary = document.createElement("p");
        summary.className = "tape-fragment-item__summary";
        summary.textContent = fragment.excerpt;

        metaWrap.appendChild(part);
        metaWrap.appendChild(marker);
        top.appendChild(title);
        top.appendChild(metaWrap);
        button.appendChild(top);
        button.appendChild(summary);
        this.controls.fragmentList.appendChild(button);
      });
    }

    _renderTranscript(fragment, currentTape) {
      if (!this.controls.transcriptView) {
        return;
      }

      this.controls.transcriptView.innerHTML = "";

      if (!fragment) {
        const placeholder = document.createElement("p");
        placeholder.className = "tape-transcript-placeholder";
        placeholder.textContent = `Ready to investigate ${currentTape?.title || "this tape"}. The backend will only reveal the next fragment when you ask for it.`;
        this.controls.transcriptView.appendChild(placeholder);
        return;
      }

      const card = document.createElement("article");
      card.className = "tape-transcript-card";

      const meta = document.createElement("div");
      meta.className = "tape-transcript-card__meta";

      const part = document.createElement("span");
      part.textContent = `Part ${fragment.partNumber || "?"} of ${fragment.totalParts || "?"}`;

      const marker = document.createElement("span");
      marker.textContent = fragment.marker;

      const mood = document.createElement("span");
      mood.textContent = fragment.mood;

      meta.appendChild(part);
      meta.appendChild(marker);
      meta.appendChild(mood);

      const title = document.createElement("h4");
      title.textContent = fragment.title;

      const excerpt = document.createElement("p");
      excerpt.textContent = fragment.excerpt;

      const lines = document.createElement("div");
      lines.className = "tape-transcript-card__lines";
      (fragment.transcript || []).forEach((line) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        lines.appendChild(paragraph);
      });

      const evidenceList = document.createElement("div");
      evidenceList.className = "tape-evidence-list";
      (fragment.evidence || []).forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "tape-evidence-chip";
        chip.textContent = item;
        evidenceList.appendChild(chip);
      });

      const note = document.createElement("p");
      note.className = "tape-transcript-card__note";
      note.textContent = fragment.note || "No archivist note attached to this fragment.";

      card.appendChild(meta);
      card.appendChild(title);
      card.appendChild(excerpt);
      card.appendChild(lines);
      if ((fragment.evidence || []).length > 0) {
        card.appendChild(evidenceList);
      }
      card.appendChild(note);
      this.controls.transcriptView.appendChild(card);
    }

    renderActivity() {
      if (!this.controls.activityList) {
        return;
      }

      this.controls.activityList.innerHTML = "";
      const activity = Array.isArray(this.state?.activity) ? this.state.activity : [];

      if (activity.length === 0) {
        const placeholder = document.createElement("li");
        placeholder.className = "tape-activity-item";
        placeholder.textContent = "No session activity yet.";
        this.controls.activityList.appendChild(placeholder);
        return;
      }

      activity.forEach((entry) => {
        const item = document.createElement("li");
        item.className = "tape-activity-item";

        const top = document.createElement("div");
        top.className = "tape-activity-item__top";

        const kind = document.createElement("span");
        kind.className = "tape-activity-item__kind";
        kind.textContent = this._getActivityLabel(entry.type);

        const revision = document.createElement("span");
        revision.className = "tape-activity-item__revision";
        revision.textContent = `rev ${entry.revision}`;

        const summary = document.createElement("p");
        summary.className = "tape-activity-item__summary";
        summary.textContent = entry?.details?.message || this._getActivitySummary(entry);

        top.appendChild(kind);
        top.appendChild(revision);
        item.appendChild(top);
        item.appendChild(summary);
        this.controls.activityList.appendChild(item);
      });
    }

    _getActivityLabel(type) {
      if (type === "tapeSelected") return "Tape selected";
      if (type === "fragmentRevealed") return "Fragment recovered";
      if (type === "fragmentFocused") return "Fragment focused";
      if (type === "sortChanged") return "Sort changed";
      if (type === "sessionReset") return "Session reset";
      return type || "Activity";
    }

    _getActivitySummary(entry) {
      const details = entry?.details || {};
      if (details.title && details.marker) {
        return `${details.title} • ${details.marker}`;
      }
      if (details.title) {
        return details.title;
      }
      if (details.sort) {
        return `Sorted by ${details.sort}`;
      }
      return "Session event recorded.";
    }
  }

  const page = new FarmerTapeRecorderPage();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => page.init());
  } else {
    page.init();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FarmerTapeRecorderPage;
  } else {
    window.FarmerTapeRecorderPage = FarmerTapeRecorderPage;
  }
})();
