class ChaosEnginePage {
  constructor() {
    this.apiService = null;
    this.currentPayload = null;
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
    this.modeDescriptionEl = document.getElementById("chaosModeDescription");
    this.updatedAtEl = document.getElementById("chaosUpdatedAt");

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
  }

  _bindEvents() {
    this.reloadBtn?.addEventListener("click", () => this._load());
    this.resetBtn?.addEventListener("click", () => this._reset());
    this.applyModeBtn?.addEventListener("click", () => this._applyMode());
    this.saveCustomBtn?.addEventListener("click", () => this._saveCustom());
    this.modeEl?.addEventListener("change", () => {
      this._renderModeDescription();
      this._onFieldChange("mode");
    });

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
    if (!this.dirty) {
      this.dirty = true;
    }
    if (fieldName) {
      this.dirtyFields.add(fieldName);
    }
    this._renderSummary();
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

  _renderCustomConfig(payload) {
    // we set a bunch of form elements; suppress events while doing so
    this.suppressChange = true;
    const cfg = payload?.customConfig || {};
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
      // reset tracking
      this.dirty = false;
      this.dirtyFields.clear();

      this._renderModeOptions(payload);
      this._renderCustomConfig(payload);
      this.updatedAtEl.textContent = this._formatDate(payload.updatedAt);
      this._renderSummary();
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

    const mode = this.modeEl?.value || "off";
    const latency = this.latencyProbabilityEl?.value || "";
    const loss = this.lossProbabilityEl?.value || "";
    const errors = this.errorProbabilityEl?.value || "";
    const traffic = this.scopePercentOfTrafficEl?.value || "";

    let text = `Mode: ${mode}`;
    if (mode === "custom") {
      text += ` | latency p=${latency}`;
      text += ` | loss p=${loss}`;
      text += ` | errors p=${errors}`;
      if (traffic !== "") {
        text += ` | traffic ${traffic}%`;
      }
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
