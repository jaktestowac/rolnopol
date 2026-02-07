class FeatureFlagsPage {
  constructor() {
    this.featureFlagsService = null;
    this.flags = {};
    this.updatedAt = null;
    this.listEl = null;
    this.statusEl = null;
    this.updatedAtEl = null;
    this.flagsCountEl = null;
    this.addForm = null;
    this.keyInput = null;
    this.valueInput = null;
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
    this.statusEl = document.getElementById("flagsStatus");
    this.updatedAtEl = document.getElementById("flagsUpdatedAt");
    this.flagsCountEl = document.getElementById("flagsCount");
    this.addForm = document.getElementById("addFlagForm");
    this.keyInput = document.getElementById("newFlagKey");
    this.valueInput = document.getElementById("newFlagValue");
    this.reloadBtn = document.getElementById("reloadFlagsBtn");
    this.resetBtn = document.getElementById("resetFlagsBtn");
    this.resetModal = document.getElementById("resetModal");
    this.resetModalConfirm = this.resetModal?.querySelector(".modal-confirm");
    this.resetModalCancel = this.resetModal?.querySelector(".modal-cancel");
    this.resetModalClose = this.resetModal?.querySelector(".modal-close");
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

    if (this.resetModalClose) {
      this.resetModalClose.addEventListener("click", () => this._closeResetModal());
    }

    if (this.resetModalOverlay) {
      this.resetModalOverlay.addEventListener("click", () => this._closeResetModal());
    }

    if (this.addForm) {
      this.addForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this._handleAddFlag();
      });
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
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = message || "";
    this.statusEl.classList.toggle("is-error", isError);
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
    this._setStatus("Loading flags...");
    try {
      const response = await this.featureFlagsService.getFlags();
      const payload = response?.data?.data;

      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to load feature flags";
        this._setStatus(message, true);
        return;
      }

      this.flags = payload.flags || {};
      this.updatedAt = payload.updatedAt || null;
      this._renderFlags();
      this._setStatus("Flags loaded.");
    } catch (error) {
      this._setStatus("Failed to load feature flags", true);
    }
  }

  _renderFlags() {
    if (!this.listEl) {
      return;
    }

    const entries = Object.entries(this.flags).sort((a, b) => a[0].localeCompare(b[0]));
    this.flagsCountEl.textContent = String(entries.length);
    this.updatedAtEl.textContent = this._formatUpdatedAt(this.updatedAt);

    if (entries.length === 0) {
      this.listEl.innerHTML = '<p class="flags-empty">No flags defined yet.</p>';
      return;
    }

    this.listEl.innerHTML = entries
      .map(([key, value]) => {
        const safeKey = String(key);
        return `
          <div class="flags-card">
            <div class="flags-card__info">
              <div class="flags-card__name">${safeKey}</div>
              <span>${value ? "Enabled" : "Disabled"}</span>
            </div>
            <label class="flags-toggle">
              <input class="flag-toggle-input" type="checkbox" data-flag="${safeKey}" ${value ? "checked" : ""} />
              <span>${value ? "On" : "Off"}</span>
            </label>
          </div>
        `;
      })
      .join("");
  }

  async _toggleFlag(flagKey, nextValue) {
    this._setStatus(`Updating ${flagKey}...`);
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
      this.flags = payload.flags || {};
      this.updatedAt = payload.updatedAt || null;
      this._renderFlags();
      this._setStatus("Flag updated.");
    } catch (error) {
      this._setStatus("Failed to update feature flags", true);
      await this._loadFlags();
    }
  }

  async _handleAddFlag() {
    const key = this.keyInput?.value?.trim();
    const value = this.valueInput?.value === "true";

    if (!key) {
      this._setStatus("Flag key is required.", true);
      return;
    }

    if (this._isUnsafeKey(key)) {
      this._setStatus("That flag key is not allowed.", true);
      return;
    }

    this._setStatus("Adding flag...");
    try {
      const response = await this.featureFlagsService.updateFlags({
        [key]: value,
      });
      const payload = response?.data?.data;
      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to add flag";
        this._setStatus(message, true);
        return;
      }

      this.flags = payload.flags || {};
      this.updatedAt = payload.updatedAt || null;
      this._renderFlags();
      if (this.addForm) {
        this.addForm.reset();
      }
      this._setStatus("Flag added.");
    } catch (error) {
      this._setStatus("Failed to add flag", true);
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
    this._setStatus("Resetting feature flags...");
    try {
      const response = await this.featureFlagsService.resetFlags();
      const payload = response?.data?.data;
      if (!response?.success || !payload || typeof payload.flags !== "object") {
        const message = response?.data?.error || "Failed to reset feature flags";
        this._setStatus(message, true);
        return;
      }

      this.flags = payload.flags || {};
      this.updatedAt = payload.updatedAt || null;
      this._renderFlags();
      this._setStatus("Feature flags reset to defaults.");
    } catch (error) {
      this._setStatus("Failed to reset feature flags", true);
    }
  }
}

window.FeatureFlagsPage = FeatureFlagsPage;
