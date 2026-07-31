class FeatureFlagsPage {
  constructor() {
    this.featureFlagsService = null;
    this.flags = {};
    this.allFlags = {};
    this.groups = {};
    this.experimentalFlags = new Set();
    this.updatedAt = null;
    // Flags pinned by the persistent feature-flags.ini file — read-only here.
    this.pinnedFlags = new Set();
    this.overrides = null;
    this.overrideProblems = [];
    this.overrideBannerEl = null;
    this.pinnedMetaEl = null;
    this.pinnedFlagsCountEl = null;
    this.listEl = null;
    this.statusEl = null;
    this.updatedAtEl = null;
    this.flagsCountEl = null;
    this.enabledFlagsCountEl = null;
    this.reloadBtn = null;
    this.resetBtn = null;
    this.searchInput = null;
    this.searchClearBtn = null;
    this.searchResultsEl = null;
    this.searchQuery = "";
  }

  init(app) {
    this.featureFlagsService = app.getModule("featureFlagsService");
    if (!this.featureFlagsService) {
      console.error("FeatureFlagsService not available");
      return;
    }

    this._cacheDom();
    this._bindEvents();
    this._loadFlags();
  }

  _cacheDom() {
    this.listEl = document.getElementById("flagsList");
    this.updatedAtEl = document.getElementById("flagsUpdatedAt");
    this.flagsCountEl = document.getElementById("flagsCount");
    this.enabledFlagsCountEl = document.getElementById("enabledFlagsCount");
    this.reloadBtn = document.getElementById("reloadFlagsBtn");
    this.resetBtn = document.getElementById("resetFlagsBtn");
    this.enableAllBtn = document.getElementById("enableAllFlagsBtn");
    this.disableAllBtn = document.getElementById("disableAllFlagsBtn");
    this.resetModal = document.getElementById("resetModal");
    this.resetModalConfirm = this.resetModal?.querySelector(".modal-confirm");
    this.resetModalCancel = this.resetModal?.querySelector(".modal-cancel");
    this.resetModalOverlay = this.resetModal?.querySelector(".modal-overlay");
    this.searchInput = document.getElementById("flagsSearchInput");
    this.searchClearBtn = document.getElementById("flagsSearchClearBtn");
    this.searchResultsEl = document.getElementById("flagsSearchResults");
    this.overrideBannerEl = document.getElementById("flagsOverrideBanner");
    this.pinnedMetaEl = document.getElementById("flagsPinnedMeta");
    this.pinnedFlagsCountEl = document.getElementById("pinnedFlagsCount");
  }

  _bindEvents() {
    if (this.reloadBtn) {
      this.reloadBtn.addEventListener("click", () => this._loadFlags());
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener("click", () => this._showResetModal());
    }

    if (this.enableAllBtn) {
      this.enableAllBtn.addEventListener("click", () => this._setAllFlags(true));
    }

    if (this.disableAllBtn) {
      this.disableAllBtn.addEventListener("click", () => this._setAllFlags(false));
    }

    if (this.resetModalConfirm) {
      this.resetModalConfirm.addEventListener("click", () => this._confirmReset());
    }

    if (this.resetModalCancel) {
      this.resetModalCancel.addEventListener("click", () => this._closeResetModal());
    }

    if (this.resetModalOverlay) {
      this.resetModalOverlay.addEventListener("click", () => this._closeResetModal());
    }

    if (this.searchInput) {
      this.searchInput.addEventListener("input", (event) => this._handleSearch(event.target.value));
    }

    if (this.searchClearBtn) {
      this.searchClearBtn.addEventListener("click", () => this._clearSearch());
    }

    if (this.listEl) {
      this.listEl.addEventListener("change", (event) => {
        const target = event.target;
        if (!target || !target.classList.contains("flag-toggle-input")) {
          return;
        }
        const flagKey = target.getAttribute("data-flag");
        if (!flagKey) {
          return;
        }
        this._toggleFlag(flagKey, target.checked);
      });
    }
  }

  _setStatus(message, isError = false) {
    if (!message) return;
    const type = isError ? "error" : /(?:loaded|updated|reset)/i.test(message) ? "success" : "info";
    const duration = isError ? 6000 : 3500;
    if (typeof window !== "undefined" && typeof window.showNotification === "function") {
      window.showNotification(message, type, duration);
      return;
    }
    // Fallback logging
    if (isError) {
      console.error(message);
    } else {
      console.info(message);
    }
  }

  _formatUpdatedAt(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  _isUnsafeKey(key) {
    return key === "__proto__" || key === "constructor" || key === "prototype";
  }

  _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  // Flags listed in the persistent feature-flags.ini file are pinned: the file
  // outranks this page, so their toggles are shown locked instead of pretending
  // a change would stick.
  _readOverrides(payload) {
    const overrides = payload?.overrides && typeof payload.overrides === "object" ? payload.overrides : null;
    this.overrides = overrides;

    const isEnforcing = !!overrides?.active && overrides?.enforcing !== false;
    const keys = isEnforcing && Array.isArray(overrides?.keys) ? overrides.keys.filter((key) => typeof key === "string") : [];
    this.pinnedFlags = new Set(keys);

    // Problems are reported whether or not anything ended up pinned, so a file
    // that is entirely broken is still visible here instead of only in the log.
    this.overrideProblems = Array.isArray(overrides?.problems)
      ? overrides.problems.filter((problem) => problem && typeof problem.message === "string")
      : [];
  }

  _isPinned(flagKey) {
    return this.pinnedFlags.has(flagKey);
  }

  _renderOverrideBanner() {
    const problems = this.overrideProblems || [];
    const pinnedCount = this.pinnedFlags.size;

    if (this.pinnedFlagsCountEl) {
      this.pinnedFlagsCountEl.textContent = String(pinnedCount);
    }
    if (this.pinnedMetaEl) {
      this.pinnedMetaEl.classList.toggle("is-hidden", pinnedCount === 0);
    }
    if (!this.overrideBannerEl) {
      return;
    }

    if (pinnedCount === 0 && problems.length === 0) {
      this.overrideBannerEl.classList.add("is-hidden");
      this.overrideBannerEl.classList.remove("flags-override-banner--problems");
      this.overrideBannerEl.innerHTML = "";
      return;
    }

    const source = this._escapeHtml(this.overrides?.source || "feature-flags.ini");
    let html = "";

    if (pinnedCount > 0) {
      const keys = [...this.pinnedFlags]
        .map((key) => `<code class="flags-override-banner__flag">${this._escapeHtml(key)}</code>`)
        .join(" ");

      html += `
      <div class="flags-override-banner__head">
        <i class="fas fa-lock" aria-hidden="true"></i>
        <strong>${pinnedCount} flag${pinnedCount === 1 ? "" : "s"} overridden by <code>${source}</code></strong>
      </div>
      <p class="flags-override-banner__text">
        These values come from the persistent configuration file <code>${source}</code> in the project root and cannot be changed here.
      </p>
      <div class="flags-override-banner__flags">${keys}</div>
    `;
    }

    if (problems.length > 0) {
      const items = problems.map((problem) => `<li>${this._escapeHtml(problem.message)}</li>`).join("");

      html += `
      <div class="flags-override-banner__problems">
        <div class="flags-override-banner__head">
          <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <strong>${problems.length} problem${problems.length === 1 ? "" : "s"} in <code>${source}</code></strong>
        </div>
        <p class="flags-override-banner__text">
          The app started normally and applied the valid entries. Fix the file and restart to apply the rest.
        </p>
        <ul class="flags-override-banner__problem-list">${items}</ul>
      </div>
    `;
    }

    this.overrideBannerEl.innerHTML = html;
    this.overrideBannerEl.classList.toggle("flags-override-banner--problems", pinnedCount === 0);
    this.overrideBannerEl.classList.remove("is-hidden");
  }

  _renderFlagCard(flagKey) {
    const flag = this.flags[flagKey];
    if (!flag) {
      return "";
    }

    const safeKey = this._escapeHtml(flagKey);
    const isEnabled = typeof flag === "object" ? flag.value : flag;
    const description = typeof flag === "object" ? flag.description : "";
    const isExperimental = this.experimentalFlags.has(String(flagKey));
    const isPinned = this._isPinned(String(flagKey));

    const experimentalBadge = isExperimental
      ? '<span class="flags-badge flags-badge--experimental" title="Experimental feature - may change or be removed in future releases">Experimental</span>'
      : "";

    const source = this._escapeHtml(this.overrides?.source || "feature-flags.ini");
    const storedValue = typeof flag === "object" && flag.storedValue !== undefined ? flag.storedValue : null;
    const storedHint =
      isPinned && storedValue !== null && storedValue !== isEnabled ? ` (stored value: ${storedValue ? "On" : "Off"})` : "";
    const pinnedBadge = isPinned
      ? `<span class="flags-badge flags-badge--pinned" title="Pinned by ${source}${storedHint} - edit the file and restart to change it"><i class="fas fa-lock" aria-hidden="true"></i> Pinned</span>`
      : "";

    return `
          <div class="flags-card${isPinned ? " flags-card--pinned" : ""}">
            <div class="flags-card__info">
              <div class="flags-card__name">${safeKey}</div>
              ${description ? `<p class="flags-card__description">${description}</p>` : ""}
            </div>
            <label class="flags-toggle${isPinned ? " flags-toggle--pinned" : ""}">
              <input class="flag-toggle-input" type="checkbox" data-flag="${safeKey}" ${isEnabled ? "checked" : ""} ${isPinned ? "disabled" : ""} />
              <span>${isEnabled ? "On" : "Off"}</span>
              ${pinnedBadge}
              ${experimentalBadge}
            </label>
          </div>
        `;
  }

  async _loadFlags() {
    try {
      const response = await this.featureFlagsService.getFlags({ descriptions: true });
      const payload = response?.data?.data;

      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to load feature flags";
        this._setStatus(message, true);
        return;
      }

      this.flags = payload.flags || {};
      this.allFlags = JSON.parse(JSON.stringify(this.flags));
      this.groups = payload.groups || {};
      this.experimentalFlags = new Set(
        Array.isArray(payload.experimentalFlags) ? payload.experimentalFlags.filter((key) => typeof key === "string") : [],
      );
      this.updatedAt = payload.updatedAt || null;
      this._readOverrides(payload);

      if (this.searchInput && this.searchInput.value !== this.searchQuery) {
        this.searchInput.value = this.searchQuery;
      }

      this._renderOverrideBanner();
      this._applySearchFilter();
    } catch (error) {
      this._setStatus("Failed to load feature flags", true);
    }
  }

  _handleSearch(query) {
    this.searchQuery = typeof query === "string" ? query : "";
    this._applySearchFilter();
  }

  _clearSearch() {
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
      this.searchInput.focus();
    }
    this._applySearchFilter();
  }

  _toggleSearchClearVisibility(hasValue) {
    if (!this.searchClearBtn) {
      return;
    }
    this.searchClearBtn.classList.toggle("is-hidden", !hasValue);
  }

  _applySearchFilter() {
    const searchTerm = this.searchQuery.toLowerCase().trim();
    const hasSearchTerm = searchTerm.length > 0;
    this._toggleSearchClearVisibility(hasSearchTerm);

    if (!searchTerm) {
      this.flags = JSON.parse(JSON.stringify(this.allFlags));
      this._renderFlags();
      if (this.searchResultsEl) {
        this.searchResultsEl.textContent = "";
      }
      return;
    }

    const filtered = {};
    const matchingGroupFlags = new Set();

    // Find groups that match the search term
    for (const [groupName, flagKeys] of Object.entries(this.groups)) {
      if (groupName.toLowerCase().includes(searchTerm)) {
        if (Array.isArray(flagKeys)) {
          flagKeys.forEach((key) => matchingGroupFlags.add(key));
        }
      }
    }

    // Filter flags by name, description, or group membership
    for (const [key, flagData] of Object.entries(this.allFlags)) {
      const flagKey = String(key).toLowerCase();
      const description = (typeof flagData === "object" ? flagData.description : "") || "";
      const descriptionLower = description.toLowerCase();

      if (flagKey.includes(searchTerm) || descriptionLower.includes(searchTerm) || matchingGroupFlags.has(key)) {
        filtered[key] = flagData;
      }
    }

    this.flags = filtered;
    const resultCount = Object.keys(filtered).length;
    if (this.searchResultsEl) {
      this.searchResultsEl.textContent = `Found ${resultCount} match${resultCount !== 1 ? "es" : ""}`;
    }
    this._renderFlags();
  }

  _renderFlags() {
    if (!this.listEl) {
      return;
    }

    const totalFlags = Object.keys(this.flags).length;
    this.flagsCountEl.textContent = String(totalFlags);
    if (this.enabledFlagsCountEl) {
      const enabledFlags = Object.values(this.flags).filter((flag) => (typeof flag === "object" ? !!flag.value : !!flag)).length;
      this.enabledFlagsCountEl.textContent = String(enabledFlags);
    }
    this.updatedAtEl.textContent = this._formatUpdatedAt(this.updatedAt);

    if (totalFlags === 0) {
      this.listEl.innerHTML = '<p class="flags-empty">No flags defined yet.</p>';
      return;
    }

    // Build a set of all grouped flag keys
    const groupedFlagKeys = new Set();
    for (const flagKeys of Object.values(this.groups)) {
      if (Array.isArray(flagKeys)) {
        flagKeys.forEach((key) => groupedFlagKeys.add(key));
      }
    }

    // Find ungrouped flags
    const ungroupedFlags = Object.keys(this.flags).filter((key) => !groupedFlagKeys.has(key));

    // Render grouped flags
    let html = "";

    // Render each group
    for (const [groupName, flagKeys] of Object.entries(this.groups)) {
      if (!Array.isArray(flagKeys) || flagKeys.length === 0) continue;

      // Check if group has any matching flags
      const groupHasFlagsInFilter = flagKeys.some((flagKey) => this.flags[flagKey]);
      if (!groupHasFlagsInFilter) continue;

      const groupTitle = groupName.charAt(0).toUpperCase() + groupName.slice(1);
      html += `<div class="flags-group"><h3 class="flags-group__title">${groupTitle}</h3><div class="flags-group__items">`;

      for (const flagKey of flagKeys) {
        html += this._renderFlagCard(flagKey);
      }

      html += "</div></div>";
    }

    // Render ungrouped flags
    const filteredUngroupedFlags = ungroupedFlags.filter((key) => this.flags[key]);
    if (filteredUngroupedFlags.length > 0) {
      html += '<div class="flags-group"><h3 class="flags-group__title">Other</h3><div class="flags-group__items">';

      for (const flagKey of filteredUngroupedFlags) {
        html += this._renderFlagCard(flagKey);
      }

      html += "</div></div>";
    }

    this.listEl.innerHTML = html;
  }

  async _toggleFlag(flagKey, nextValue) {
    if (this._isPinned(flagKey)) {
      const source = this.overrides?.source || "feature-flags.ini";
      this._setStatus(`${flagKey} is pinned by ${source} and cannot be changed here.`, true);
      await this._loadFlags();
      return;
    }

    try {
      const response = await this.featureFlagsService.updateFlags({
        [flagKey]: !!nextValue,
      });
      const payload = response?.data?.data;
      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to update feature flags";
        this._setStatus(message, true);
        await this._loadFlags();
        return;
      }
      // Reload flags with descriptions to maintain them after update
      await this._loadFlags();
      this._setStatus("Flag updated.");
    } catch (error) {
      this._setStatus("Failed to update feature flags", true);
      await this._loadFlags();
    }
  }

  async _setAllFlags(value) {
    const flagsToUpdate = {};
    let skippedPinned = 0;

    for (const [key, flagData] of Object.entries(this.allFlags || {})) {
      if (this._isUnsafeKey(key)) {
        continue;
      }
      // Pinned flags are left out entirely so a bulk action still succeeds
      // for everything the app is actually allowed to change.
      if (this._isPinned(key)) {
        const currentValue = typeof flagData === "object" ? !!flagData.value : !!flagData;
        if (currentValue !== value) {
          skippedPinned += 1;
        }
        continue;
      }
      const currentValue = typeof flagData === "object" ? !!flagData.value : !!flagData;
      if (currentValue !== value) {
        flagsToUpdate[key] = value;
      }
    }

    const pinnedSuffix = skippedPinned > 0 ? ` ${skippedPinned} pinned flag${skippedPinned === 1 ? "" : "s"} left unchanged.` : "";

    if (Object.keys(flagsToUpdate).length === 0) {
      this._setStatus(`All flags are already ${value ? "enabled" : "disabled"}.${pinnedSuffix}`);
      return;
    }

    try {
      const response = await this.featureFlagsService.updateFlags(flagsToUpdate);
      const payload = response?.data?.data;
      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to update feature flags";
        this._setStatus(message, true);
        await this._loadFlags();
        return;
      }

      await this._loadFlags();
      this._setStatus(`All flags ${value ? "enabled" : "disabled"}.${pinnedSuffix}`);
    } catch (error) {
      this._setStatus("Failed to update feature flags", true);
      await this._loadFlags();
    }
  }

  _showResetModal() {
    if (this.resetModal) {
      this.resetModal.style.display = "flex";
    }
  }

  _closeResetModal() {
    if (this.resetModal) {
      this.resetModal.style.display = "none";
    }
  }

  async _confirmReset() {
    this._closeResetModal();
    try {
      const response = await this.featureFlagsService.resetFlags();
      const payload = response?.data?.data;
      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to reset feature flags";
        this._setStatus(message, true);
        await this._loadFlags();
        return;
      }

      // Reload flags with descriptions to maintain them after reset
      await this._loadFlags();
      const pinnedCount = this.pinnedFlags.size;
      const pinnedSuffix =
        pinnedCount > 0
          ? ` ${pinnedCount} flag${pinnedCount === 1 ? "" : "s"} still pinned by ${this.overrides?.source || "feature-flags.ini"}.`
          : "";
      this._setStatus(`Feature flags reset to defaults.${pinnedSuffix}`);
    } catch (error) {
      this._setStatus("Failed to reset feature flags", true);
      await this._loadFlags();
    }
  }
}

window.FeatureFlagsPage = FeatureFlagsPage;
