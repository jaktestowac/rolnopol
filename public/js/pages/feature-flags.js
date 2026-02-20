class FeatureFlagsPage {
  constructor() {
    this.featureFlagsService = null;
    this.flags = {};
    this.groups = {};
    this.updatedAt = null;
    this.listEl = null;
    this.statusEl = null;
    this.updatedAtEl = null;
    this.flagsCountEl = null;
    this.reloadBtn = null;
    this.resetBtn = null;
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
    this.reloadBtn = document.getElementById("reloadFlagsBtn");
    this.resetBtn = document.getElementById("resetFlagsBtn");
    this.resetModal = document.getElementById("resetModal");
    this.resetModalConfirm = this.resetModal?.querySelector(".modal-confirm");
    this.resetModalCancel = this.resetModal?.querySelector(".modal-cancel");
    this.resetModalOverlay = this.resetModal?.querySelector(".modal-overlay");
  }

  _bindEvents() {
    if (this.reloadBtn) {
      this.reloadBtn.addEventListener("click", () => this._loadFlags());
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener("click", () => this._showResetModal());
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
      this.groups = payload.groups || {};
      this.updatedAt = payload.updatedAt || null;
      this._renderFlags();
    } catch (error) {
      this._setStatus("Failed to load feature flags", true);
    }
  }

  _renderFlags() {
    if (!this.listEl) {
      return;
    }

    const totalFlags = Object.keys(this.flags).length;
    this.flagsCountEl.textContent = String(totalFlags);
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

      const groupTitle = groupName.charAt(0).toUpperCase() + groupName.slice(1);
      html += `<div class="flags-group"><h3 class="flags-group__title">${groupTitle}</h3><div class="flags-group__items">`;

      for (const flagKey of flagKeys) {
        const flag = this.flags[flagKey];
        if (!flag) continue;

        const safeKey = String(flagKey);
        const isEnabled = typeof flag === "object" ? flag.value : flag;
        const description = typeof flag === "object" ? flag.description : "";

        html += `
          <div class="flags-card">
            <div class="flags-card__info">
              <div class="flags-card__name">${safeKey}</div>
              ${description ? `<p class="flags-card__description">${description}</p>` : ""}
            </div>
            <label class="flags-toggle">
              <input class="flag-toggle-input" type="checkbox" data-flag="${safeKey}" ${isEnabled ? "checked" : ""} />
              <span>${isEnabled ? "On" : "Off"}</span>
            </label>
          </div>
        `;
      }

      html += "</div></div>";
    }

    // Render ungrouped flags
    if (ungroupedFlags.length > 0) {
      html += '<div class="flags-group"><h3 class="flags-group__title">Other</h3><div class="flags-group__items">';

      for (const flagKey of ungroupedFlags) {
        const flag = this.flags[flagKey];
        if (!flag) continue;

        const safeKey = String(flagKey);
        const isEnabled = typeof flag === "object" ? flag.value : flag;
        const description = typeof flag === "object" ? flag.description : "";

        html += `
          <div class="flags-card">
            <div class="flags-card__info">
              <div class="flags-card__name">${safeKey}</div>
              ${description ? `<p class="flags-card__description">${description}</p>` : ""}
            </div>
            <label class="flags-toggle">
              <input class="flag-toggle-input" type="checkbox" data-flag="${safeKey}" ${isEnabled ? "checked" : ""} />
              <span>${isEnabled ? "On" : "Off"}</span>
            </label>
          </div>
        `;
      }

      html += "</div></div>";
    }

    this.listEl.innerHTML = html;
  }

  async _toggleFlag(flagKey, nextValue) {
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
      this._setStatus("Feature flags reset to defaults.");
    } catch (error) {
      this._setStatus("Failed to reset feature flags", true);
      await this._loadFlags();
    }
  }
}

window.FeatureFlagsPage = FeatureFlagsPage;
