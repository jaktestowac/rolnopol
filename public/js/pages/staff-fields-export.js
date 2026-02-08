class StaffFieldsExportPage {
  constructor() {
    this.apiService = window.ApiService ? new window.ApiService() : null;
    this.featureFlagsService = window.FeatureFlagsService ? new window.FeatureFlagsService() : null;
    this.statusEl = null;
    this.buttons = {
      fields: null,
      staff: null,
      animals: null,
    };
  }

  async init() {
    this._cacheDom();
    this._bindEvents();
    await this._ensureFeatureEnabled();
  }

  _cacheDom() {
    this.statusEl = document.getElementById("exportStatus");
    this.buttons.fields = document.getElementById("exportFieldsBtn");
    this.buttons.staff = document.getElementById("exportStaffBtn");
    this.buttons.animals = document.getElementById("exportAnimalsBtn");
  }

  _bindEvents() {
    if (this.buttons.fields) {
      this.buttons.fields.addEventListener("click", () => this._handleExport("fields"));
    }
    if (this.buttons.staff) {
      this.buttons.staff.addEventListener("click", () => this._handleExport("staff"));
    }
    if (this.buttons.animals) {
      this.buttons.animals.addEventListener("click", () => this._handleExport("animals"));
    }
  }

  async _ensureFeatureEnabled() {
    if (!this.featureFlagsService || !this.apiService) {
      return true;
    }

    this.featureFlagsService.apiService = this.apiService;

    try {
      const enabled = await this.featureFlagsService.isEnabled("staffFieldsExportEnabled", false);
      if (!enabled) {
        if (typeof window.queueFeatureGateModal === "function") {
          window.queueFeatureGateModal({
            title: "Export Unavailable",
            message: "Exports are currently disabled. You can continue on the staff fields page.",
          });
        }
        window.location.href = "/staff-fields-main.html";
        return false;
      }
    } catch (error) {
      return true;
    }

    return true;
  }

  _setStatus(message, type = "info") {
    if (!this.statusEl) {
      return;
    }

    this.statusEl.textContent = message;
    this.statusEl.className = "message-modern";
    if (type && type !== "info") {
      this.statusEl.classList.add(type);
    }
  }

  _getExportFilename(type) {
    const dateStamp = new Date().toISOString().slice(0, 10);
    return `rolnopol-${type}-export-${dateStamp}.json`;
  }

  _downloadJson(filename, payload) {
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async _handleExport(type) {
    if (!this.apiService) {
      this._setStatus("Export service is unavailable.", "error");
      return;
    }

    const labelMap = {
      fields: "Fields",
      staff: "Staff",
      animals: "Animals",
    };
    const label = labelMap[type] || "Data";

    this._setStatus(`Preparing ${label} export...`);

    try {
      const endpointMap = {
        fields: "fields",
        staff: "staff",
        animals: "animals",
      };
      const endpoint = endpointMap[type];
      if (!endpoint) {
        this._setStatus("Unknown export type.", "error");
        return;
      }

      const response = await this.apiService.get(endpoint, {
        requiresAuth: true,
      });

      const payload = response?.success && Array.isArray(response?.data?.data) ? response.data.data : [];

      if (!response?.success) {
        const errorMessage = response?.error || "Export failed.";
        this._setStatus(errorMessage, "error");
        return;
      }

      this._downloadJson(this._getExportFilename(type), payload);
      this._setStatus(`${label} export downloaded.`, "success");
    } catch (error) {
      this._setStatus(`Failed to export ${label.toLowerCase()}.`, "error");
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const page = new StaffFieldsExportPage();
  window.staffFieldsExportPage = page;
  page.init();
});
