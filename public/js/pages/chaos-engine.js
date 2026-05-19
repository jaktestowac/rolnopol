class ChaosEnginePage {
  constructor() {
    this.apiService = null;
    this.currentPayload = null;
    this.customDraftConfig = null;
    this.dirty = false; // track unsaved changes
    this.dirtyFields = new Set(); // names of fields that have been modified
    this.suppressChange = false; // when true, change events won't mark dirty
  }

  init(app) {
    this.apiService = app.getModule("apiService");
    if (!this.apiService) {
      console.error("ApiService not available");
      return;
    }

    this._cacheDom();
    this._bindEvents();
    this._load();
  }

  _cacheDom() {
    this.modeEl = document.getElementById("chaosMode");
    this.modePanelEl = document.getElementById("chaosModePanel");
    this.modeDescriptionEl = document.getElementById("chaosModeDescription");
    this.updatedAtEl = document.getElementById("chaosUpdatedAt");
    this.previewSummaryEl = document.getElementById("chaosPreviewSummary");
    this.previewHighlightsEl = document.getElementById("chaosPreviewHighlights");
    this.previewConfigDisplayEl = document.getElementById("chaosPreviewConfigDisplay");
    this.previewBadgeEl = document.getElementById("chaosPreviewBadge");

    this.reloadBtn = document.getElementById("reloadChaosBtn");
    this.resetBtn = document.getElementById("resetChaosBtn");
    this.applyModeBtn = document.getElementById("applyModeBtn");
    this.saveCustomBtn = document.getElementById("saveCustomBtn");

    this.latencyEnabledEl = document.getElementById("latencyEnabled");
    this.latencyProbabilityEl = document.getElementById("latencyProbability");
    this.latencyMinMsEl = document.getElementById("latencyMinMs");
    this.latencyMaxMsEl = document.getElementById("latencyMaxMs");

    this.lossEnabledEl = document.getElementById("lossEnabled");
    this.lossProbabilityEl = document.getElementById("lossProbability");
    this.lossModeEl = document.getElementById("lossMode");
    this.lossTimeoutMsEl = document.getElementById("lossTimeoutMs");

    this.errorEnabledEl = document.getElementById("errorEnabled");
    this.errorProbabilityEl = document.getElementById("errorProbability");
    this.errorStatusCodesEl = document.getElementById("errorStatusCodes");
    this.errorMessageEl = document.getElementById("errorMessage");
    this.errorRandomStatusEl = document.getElementById("errorRandomStatus");

    this.statefulEnabledEl = document.getElementById("statefulEnabled");
    this.statefulRequestCountEl = document.getElementById("statefulRequestCount");

    this.mirroringEnabledEl = document.getElementById("mirroringEnabled");
    this.mirroringProbabilityEl = document.getElementById("mirroringProbability");
    this.mirroringTargetUrlEl = document.getElementById("mirroringTargetUrl");

    this.scopeMethodsEl = document.getElementById("scopeMethods");
    this.scopeExcludePathsEl = document.getElementById("scopeExcludePaths");
    this.scopePercentOfTrafficEl = document.getElementById("scopePercentOfTraffic");
    // additional scope inputs
    this.scopeIncludePathsEl = document.getElementById("scopeIncludePaths");
    this.scopeQueryParamsEl = document.getElementById("scopeQueryParams");
    this.scopeHeadersEl = document.getElementById("scopeHeaders");
    this.scopeHostnamesEl = document.getElementById("scopeHostnames");
    this.scopeRolesEl = document.getElementById("scopeRoles");
    this.scopeIpRangesEl = document.getElementById("scopeIpRanges");
    this.scopeGeolocationEl = document.getElementById("scopeGeolocation");

    this.previewGroupEls = {
      latency: document.getElementById("chaosGroupLatency"),
      responseLoss: document.getElementById("chaosGroupResponseLoss"),
      errorInjection: document.getElementById("chaosGroupErrorInjection"),
      scope: document.getElementById("chaosGroupScope"),
      stateful: document.getElementById("chaosGroupStateful"),
      mirroring: document.getElementById("chaosGroupMirroring"),
    };
  }

  _bindEvents() {
    this.reloadBtn?.addEventListener("click", () => this._load());
    this.resetBtn?.addEventListener("click", () => this._reset());
    this.applyModeBtn?.addEventListener("click", () => this._applyMode());
    this.saveCustomBtn?.addEventListener("click", () => this._saveCustom());
    this.modeEl?.addEventListener("change", () => this._handleModeSelectionChange());

    // track changes in any form field to mark unsaved
    const formFields = [
      [this.latencyEnabledEl, "latencyEnabled"],
      [this.latencyProbabilityEl, "latencyProbability"],
      [this.latencyMinMsEl, "latencyMinMs"],
      [this.latencyMaxMsEl, "latencyMaxMs"],
      [this.lossEnabledEl, "lossEnabled"],
      [this.lossProbabilityEl, "lossProbability"],
      [this.lossModeEl, "lossMode"],
      [this.lossTimeoutMsEl, "lossTimeoutMs"],
      [this.errorEnabledEl, "errorEnabled"],
      [this.errorRandomStatusEl, "errorRandomStatus"],
      [this.errorProbabilityEl, "errorProbability"],
      [this.errorStatusCodesEl, "errorStatusCodes"],
      [this.errorMessageEl, "errorMessage"],
      [this.statefulEnabledEl, "statefulEnabled"],
      [this.statefulRequestCountEl, "statefulRequestCount"],
      [this.mirroringEnabledEl, "mirroringEnabled"],
      [this.mirroringProbabilityEl, "mirroringProbability"],
      [this.mirroringTargetUrlEl, "mirroringTargetUrl"],
      [this.scopeMethodsEl, "scopeMethods"],
      [this.scopePercentOfTrafficEl, "scopePercentOfTraffic"],
      [this.scopeExcludePathsEl, "scopeExcludePaths"],
      [this.scopeIncludePathsEl, "scopeIncludePaths"],
      [this.scopeQueryParamsEl, "scopeQueryParams"],
      [this.scopeHeadersEl, "scopeHeaders"],
      [this.scopeHostnamesEl, "scopeHostnames"],
      [this.scopeRolesEl, "scopeRoles"],
      [this.scopeIpRangesEl, "scopeIpRanges"],
      [this.scopeGeolocationEl, "scopeGeolocation"],
    ];
    formFields.forEach(([fld, name]) => {
      if (!fld) return;
      fld.addEventListener("input", () => this._onFieldChange(name));
      fld.addEventListener("change", () => this._onFieldChange(name));
    });
  }

  _onFieldChange(fieldName) {
    if (this.suppressChange) return;

    if (fieldName && fieldName !== "mode") {
      this.customDraftConfig = this._cloneConfig(this._buildCustomConfigFromForm());
      if (this.modeEl?.value && this.modeEl.value !== "custom" && this.currentPayload?.presets?.custom) {
        this.modeEl.value = "custom";
        this.dirtyFields.add("mode");
        this._renderModeDescription();
      }
    }

    if (!this.dirty) {
      this.dirty = true;
    }
    if (fieldName) {
      this.dirtyFields.add(fieldName);
    }
    this._renderSummary();
    this._renderPreviewState();
  }

  _cloneConfig(config) {
    try {
      return JSON.parse(JSON.stringify(config || {}));
    } catch (_) {
      return config || {};
    }
  }

  _handleModeSelectionChange() {
    this._renderModeDescription();
    const previewConfig = this._resolvePreviewConfig(this.modeEl?.value || "off");
    if (previewConfig) {
      this._renderCustomConfig(previewConfig);
    }
    this._onFieldChange("mode");
  }

  _notify(message, isError = false) {
    const type = isError ? "error" : "success";
    if (typeof window !== "undefined" && typeof window.showNotification === "function") {
      window.showNotification(message, type, isError ? 5000 : 3000);
      return;
    }
    if (isError) {
      console.error(message);
      return;
    }
    console.info(message);
  }

  _formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  _renderModeOptions(payload) {
    if (!this.modeEl) {
      return;
    }

    const presets = payload?.presets || {};
    const options = Object.entries(presets).map(([mode, info]) => {
      const label = info?.label || mode;
      return `<option value="${mode}">${label}</option>`;
    });
    this.suppressChange = true;
    this.modeEl.innerHTML = options.join("");
    this.modeEl.value = payload.mode || "off";
    this._renderModeDescription();
    this.suppressChange = false;
  }

  _renderModeDescription() {
    if (!this.modeDescriptionEl || !this.modeEl || !this.currentPayload) {
      return;
    }

    const mode = this.modeEl.value;
    const preset = this.currentPayload.presets?.[mode];
    this.modeDescriptionEl.textContent = preset?.description || "-";
  }

  _readCsv(input) {
    return String(input || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _formatModeLabel(mode) {
    return this.currentPayload?.presets?.[mode]?.label || mode;
  }

  _serializeComparable(value) {
    return JSON.stringify(value ?? null);
  }

  _resolvePreviewConfig(mode) {
    if (!this.currentPayload) {
      return null;
    }

    if (mode === "custom") {
      if (this.dirty) {
        return this._cloneConfig(this._buildCustomConfigFromForm());
      }
      if (this.customDraftConfig) {
        return this._cloneConfig(this.customDraftConfig);
      }
    }

    const previewConfigs = this.currentPayload.previewConfigs || {};
    if (previewConfigs[mode]) {
      return this._cloneConfig(previewConfigs[mode]);
    }

    if (mode === this.currentPayload.mode) {
      return this._cloneConfig(this.currentPayload.config || {});
    }

    if (mode === "custom") {
      return this._cloneConfig(this.currentPayload.customConfig || this.currentPayload.config || {});
    }

    return null;
  }

  _describeSectionValue(key, config) {
    const source = config || {};

    switch (key) {
      case "mode":
        return this._formatModeLabel(source.mode || "off");
      case "latency": {
        const latency = source.latency || {};
        return latency.enabled ? `On · p=${latency.probability ?? 0} · ${latency.minMs ?? 0}-${latency.maxMs ?? 0} ms` : "Off";
      }
      case "responseLoss": {
        const loss = source.responseLoss || {};
        return loss.enabled ? `On · ${loss.mode || "timeout"} · p=${loss.probability ?? 0} · ${loss.timeoutMs ?? 0} ms` : "Off";
      }
      case "errorInjection": {
        const errors = source.errorInjection || {};
        const codes = Array.isArray(errors.statusCodes) && errors.statusCodes.length > 0 ? errors.statusCodes.join(",") : "500";
        const randomLabel = errors.randomStatus ? " · random range" : "";
        return errors.enabled ? `On · p=${errors.probability ?? 0} · ${codes}${randomLabel}` : "Off";
      }
      case "stateful": {
        const stateful = source.stateful || {};
        return stateful.enabled ? `On · after ${stateful.requestCount ?? 0} requests` : "Off";
      }
      case "mirroring": {
        const mirroring = source.mirroring || {};
        const targetUrl = mirroring.targetUrl ? ` → ${mirroring.targetUrl}` : "";
        return mirroring.enabled ? `On · p=${mirroring.probability ?? 0}${targetUrl}` : "Off";
      }
      case "scope": {
        const scope = source.scope || {};
        const methods = Array.isArray(scope.methods) && scope.methods.length > 0 ? scope.methods.join(",") : "all methods";
        const includeCount = Array.isArray(scope.includePaths) ? scope.includePaths.length : 0;
        const excludeCount = Array.isArray(scope.excludePaths) ? scope.excludePaths.length : 0;
        return `${scope.percentOfTraffic ?? 100}% traffic · ${methods} · ${includeCount} include / ${excludeCount} exclude`;
      }
      default:
        return "-";
    }
  }

  _buildPreviewChanges(appliedConfig, previewConfig, selectedMode) {
    const changes = [];
    const appliedMode = this.currentPayload?.mode || "off";

    if (selectedMode !== appliedMode) {
      changes.push({
        key: "mode",
        label: "Mode",
        previewValue: this._formatModeLabel(selectedMode),
        appliedValue: this._formatModeLabel(appliedMode),
      });
    }

    ["latency", "responseLoss", "errorInjection", "scope", "stateful", "mirroring"].forEach((key) => {
      if (this._serializeComparable(previewConfig?.[key]) !== this._serializeComparable(appliedConfig?.[key])) {
        changes.push({
          key,
          label:
            key === "responseLoss"
              ? "Response loss"
              : key === "errorInjection"
                ? "Error responses"
                : key === "stateful"
                  ? "Stateful failures"
                  : key.charAt(0).toUpperCase() + key.slice(1),
          previewValue: this._describeSectionValue(key, previewConfig),
          appliedValue: this._describeSectionValue(key, appliedConfig),
        });
      }
    });

    return changes;
  }

  _setPreviewClass(el, className, enabled) {
    if (!el?.classList) {
      return;
    }
    if (enabled) {
      el.classList.add(className);
      return;
    }
    el.classList.remove(className);
  }

  _renderPreviewState() {
    if (!this.currentPayload) {
      return;
    }

    const selectedMode = this.modeEl?.value || this.currentPayload.mode || "off";
    const appliedConfig = this.currentPayload.config || {};
    const previewConfig = this._resolvePreviewConfig(selectedMode) || appliedConfig;
    const changes = this._buildPreviewChanges(appliedConfig, previewConfig, selectedMode);
    const hasChanges = changes.length > 0;
    const isCustomDraft = selectedMode === "custom" && hasChanges;

    if (this.previewBadgeEl) {
      this.previewBadgeEl.textContent = hasChanges ? (isCustomDraft ? "Custom draft" : "Preview") : "Applied";
      this._setPreviewClass(this.previewBadgeEl, "chaos-preview-badge--changed", hasChanges);
      this._setPreviewClass(this.previewBadgeEl, "chaos-preview-badge--custom", isCustomDraft);
    }

    this._setPreviewClass(this.modePanelEl, "chaos-panel--changed", selectedMode !== this.currentPayload.mode);

    Object.entries(this.previewGroupEls || {}).forEach(([key, el]) => {
      const isChanged = changes.some((item) => item.key === key);
      this._setPreviewClass(el, "chaos-group--changed", isChanged);
    });

    if (this.previewSummaryEl) {
      if (!hasChanges) {
        this.previewSummaryEl.textContent = `Preview matches the applied ${this._formatModeLabel(this.currentPayload.mode || "off")} configuration.`;
      } else if (selectedMode === "custom") {
        this.previewSummaryEl.textContent = `Custom draft ready. ${changes.length} ${changes.length === 1 ? "area" : "areas"} would change if you save this configuration.`;
      } else {
        this.previewSummaryEl.textContent = `Previewing ${this._formatModeLabel(selectedMode)}. ${changes.length} ${changes.length === 1 ? "area would" : "areas would"} change if you apply this mode.`;
      }
    }

    if (this.previewHighlightsEl) {
      if (!hasChanges) {
        this.previewHighlightsEl.innerHTML =
          '<div class="chaos-preview-empty">No pending differences. You are already looking at the applied setup.</div>';
      } else {
        this.previewHighlightsEl.innerHTML = changes
          .map(
            (change) => `
              <article class="chaos-preview-card chaos-preview-card--changed">
                <div class="chaos-preview-card__label">${this._escapeHtml(change.label)}</div>
                <div class="chaos-preview-card__value">${this._escapeHtml(change.previewValue)}</div>
                <div class="chaos-preview-card__delta">Applied: ${this._escapeHtml(change.appliedValue)}</div>
              </article>`,
          )
          .join("");
      }
    }

    if (this.previewConfigDisplayEl) {
      try {
        this.previewConfigDisplayEl.textContent = JSON.stringify(previewConfig, null, 2);
      } catch (_) {
        this.previewConfigDisplayEl.textContent = "(unable to show preview config)";
      }
    }
  }

  _renderCustomConfig(payload) {
    // we set a bunch of form elements; suppress events while doing so
    this.suppressChange = true;
    // Accept either a full API payload or a resolved config object.
    const cfg = payload?.customConfig || payload || {};
    const latency = cfg.latency || {};
    const loss = cfg.responseLoss || {};
    const errors = cfg.errorInjection || {};
    const stateful = cfg.stateful || {};
    const mirroring = cfg.mirroring || {};
    const scope = cfg.scope || {};

    this.latencyEnabledEl.checked = latency.enabled === true;
    this.latencyProbabilityEl.value = latency.probability ?? 0;
    this.latencyMinMsEl.value = latency.minMs ?? 0;
    this.latencyMaxMsEl.value = latency.maxMs ?? 0;

    this.lossEnabledEl.checked = loss.enabled === true;
    this.lossProbabilityEl.value = loss.probability ?? 0;
    this.lossModeEl.value = loss.mode || "timeout";
    this.lossTimeoutMsEl.value = loss.timeoutMs ?? 1500;

    this.errorEnabledEl.checked = errors.enabled === true;
    this.errorRandomStatusEl.checked = errors.randomStatus === true;
    this.errorProbabilityEl.value = errors.probability ?? 0;
    this.errorStatusCodesEl.value = Array.isArray(errors.statusCodes) ? errors.statusCodes.join(",") : "500";
    this.errorMessageEl.value = errors.message || "";

    this.statefulEnabledEl.checked = stateful.enabled === true;
    this.statefulRequestCountEl.value = stateful.requestCount ?? 0;

    this.mirroringEnabledEl.checked = mirroring.enabled === true;
    this.mirroringProbabilityEl.value = mirroring.probability ?? 0;
    this.mirroringTargetUrlEl.value = mirroring.targetUrl || "";

    this.scopeMethodsEl.value = Array.isArray(scope.methods) ? scope.methods.join(",") : "GET,POST,PUT,PATCH,DELETE";
    this.scopePercentOfTrafficEl.value = scope.percentOfTraffic ?? 100;
    this.scopeExcludePathsEl.value = Array.isArray(scope.excludePaths) ? scope.excludePaths.join("\n") : "";
    // new fields
    if (this.scopeIncludePathsEl) {
      this.scopeIncludePathsEl.value = Array.isArray(scope.includePaths) ? scope.includePaths.join("\n") : "";
    }
    if (this.scopeQueryParamsEl) {
      // simple key=value per line
      this.scopeQueryParamsEl.value = scope.queryParams
        ? Object.entries(scope.queryParams)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "";
    }
    if (this.scopeHeadersEl) {
      this.scopeHeadersEl.value = scope.headers
        ? Object.entries(scope.headers)
            .map(([k, v]) => `${k}:${v}`)
            .join("\n")
        : "";
    }
    if (this.scopeHostnamesEl) {
      this.scopeHostnamesEl.value = Array.isArray(scope.hostnames) ? scope.hostnames.join(",") : "";
    }
    if (this.scopeRolesEl) {
      this.scopeRolesEl.value = Array.isArray(scope.roles) ? scope.roles.join(",") : "";
    }
    if (this.scopeIpRangesEl) {
      this.scopeIpRangesEl.value = Array.isArray(scope.ipRanges) ? scope.ipRanges.join("\n") : "";
    }
    if (this.scopeGeolocationEl) {
      this.scopeGeolocationEl.value = Array.isArray(scope.geolocation) ? scope.geolocation.join(",") : "";
    }
    this.suppressChange = false;
  }

  _buildCustomConfigFromForm() {
    const statusCodes = this._readCsv(this.errorStatusCodesEl.value)
      .map((code) => Number(code))
      .filter((code) => Number.isFinite(code));
    const methods = this._readCsv(this.scopeMethodsEl.value).map((method) => method.toUpperCase());
    const excludePaths = String(this.scopeExcludePathsEl.value || "")
      .split("\n")
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    const includePaths = this.scopeIncludePathsEl
      ? String(this.scopeIncludePathsEl.value || "")
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];
    const queryParams = {};
    if (this.scopeQueryParamsEl) {
      String(this.scopeQueryParamsEl.value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((l) => l.includes("="))
        .forEach((l) => {
          const [k, v] = l.split("=");
          queryParams[k.trim()] = v.trim();
        });
    }
    const headers = {};
    if (this.scopeHeadersEl) {
      String(this.scopeHeadersEl.value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((l) => l.includes(":"))
        .forEach((l) => {
          const [k, v] = l.split(":");
          headers[k.trim()] = v.trim();
        });
    }
    const hostnames = this.scopeHostnamesEl ? this._readCsv(this.scopeHostnamesEl.value) : [];
    const roles = this.scopeRolesEl ? this._readCsv(this.scopeRolesEl.value) : [];
    const ipRanges = this.scopeIpRangesEl
      ? String(this.scopeIpRangesEl.value || "")
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];
    const geolocation = this.scopeGeolocationEl ? this._readCsv(this.scopeGeolocationEl.value) : [];

    return {
      enabled: true,
      latency: {
        enabled: !!this.latencyEnabledEl.checked,
        probability: Number(this.latencyProbabilityEl.value),
        minMs: Number(this.latencyMinMsEl.value),
        maxMs: Number(this.latencyMaxMsEl.value),
      },
      responseLoss: {
        enabled: !!this.lossEnabledEl.checked,
        probability: Number(this.lossProbabilityEl.value),
        mode: this.lossModeEl.value,
        timeoutMs: Number(this.lossTimeoutMsEl.value),
      },
      errorInjection: {
        enabled: !!this.errorEnabledEl.checked,
        probability: Number(this.errorProbabilityEl.value),
        statusCodes,
        randomStatus: !!this.errorRandomStatusEl.checked,
        message: this.errorMessageEl.value,
      },
      stateful: {
        enabled: !!this.statefulEnabledEl.checked,
        requestCount: Number(this.statefulRequestCountEl.value),
      },
      mirroring: {
        enabled: !!this.mirroringEnabledEl.checked,
        probability: Number(this.mirroringProbabilityEl.value),
        targetUrl: this.mirroringTargetUrlEl.value,
      },
      scope: {
        methods,
        excludePaths,
        includePaths,
        queryParams,
        headers,
        hostnames,
        roles,
        ipRanges,
        geolocation,
        percentOfTraffic: Number(this.scopePercentOfTrafficEl.value),
      },
    };
  }

  async _load() {
    try {
      const response = await this.apiService.get("chaos-engine");
      const payload = response?.data?.data;
      if (!response?.success || !payload) {
        this._notify(response?.data?.error || "Failed to load Chaos Engine config", true);
        return;
      }

      this.currentPayload = payload;
      this.customDraftConfig = this._cloneConfig(payload.previewConfigs?.custom || payload.customConfig || payload.config || {});
      // reset tracking
      this.dirty = false;
      this.dirtyFields.clear();

      this._renderModeOptions(payload);
      this._renderCustomConfig(this._resolvePreviewConfig(payload.mode || "off") || payload.config || {});
      this.updatedAtEl.textContent = this._formatDate(payload.updatedAt);
      this._renderSummary();
      this._renderPreviewState();
      this._renderConfigDisplay(payload.config || {});
    } catch (error) {
      this._notify("Failed to load Chaos Engine config", true);
    }
  }

  async _applyMode() {
    try {
      const mode = this.modeEl?.value || "off";
      const response = await this.apiService.request("PATCH", "chaos-engine", { body: { mode } });
      if (!response?.success) {
        this._notify(response?.data?.error || "Failed to apply mode", true);
        return;
      }

      this._notify(`Chaos Engine mode set to ${mode}.`);
      await this._load();
    } catch (error) {
      this._notify("Failed to apply mode", true);
    }
  }

  async _saveCustom() {
    try {
      const customConfig = this._buildCustomConfigFromForm();
      const response = await this.apiService.request("PATCH", "chaos-engine", {
        body: {
          mode: "custom",
          customConfig,
        },
      });

      if (!response?.success) {
        this._notify(response?.data?.error || "Failed to save custom config", true);
        return;
      }

      this._notify("Custom Chaos Engine configuration saved.");
      await this._load();
    } catch (error) {
      this._notify("Failed to save custom config", true);
    }
  }

  async _reset() {
    try {
      const response = await this.apiService.post("chaos-engine/reset", {});
      if (!response?.success) {
        this._notify(response?.data?.error || "Failed to reset Chaos Engine", true);
        return;
      }

      this._notify("Chaos Engine reset to off.");
      await this._load();
    } catch (error) {
      this._notify("Failed to reset Chaos Engine", true);
    }
  }

  _renderSummary() {
    const el = document.getElementById("chaosSummary");
    if (!el) return;

    const selectedMode = this.modeEl?.value || this.currentPayload?.mode || "off";
    const appliedMode = this.currentPayload?.mode || "off";
    const previewConfig = this._resolvePreviewConfig(selectedMode) || this.currentPayload?.config || {};
    const appliedConfig = this.currentPayload?.config || {};
    const pendingChanges = this._buildPreviewChanges(appliedConfig, previewConfig, selectedMode);

    let text = `Applied: ${this._formatModeLabel(appliedMode)} | Preview: ${this._formatModeLabel(selectedMode)}`;
    if (pendingChanges.length > 0) {
      text += ` | ${pendingChanges.length} pending ${pendingChanges.length === 1 ? "change" : "changes"}`;
      text += selectedMode === "custom" ? " | Save as custom to activate" : " | Apply mode to activate";
    }

    if (this.dirty) {
      if (this.dirtyFields.size > 0) {
        text += "  [Unsaved: ";
        text += Array.from(this.dirtyFields).join(", ");
        text += "; will be lost on reload]";
      } else {
        text += "  [Unsaved changes]";
      }
      el.classList.add("chaos-summary--dirty");
    } else {
      el.classList.remove("chaos-summary--dirty");
    }

    el.textContent = text;
  }

  _renderConfigDisplay(config) {
    const el = document.getElementById("chaosConfigDisplay");
    if (!el) return;
    try {
      el.textContent = JSON.stringify(config, null, 2);
    } catch (_) {
      el.textContent = "(unable to show config)";
    }
  }
}

window.ChaosEnginePage = ChaosEnginePage;
