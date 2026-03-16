class WeatherPage {
  constructor() {
    this.apiService = null;
    this.authService = null;
    this.featureFlagsService = null;
    this.region = "PL-14";
    this.forecastDays = 7;
    this.userInsightsEnabled = false;
    this.weatherTrendChartEnabled = false;
    this.weatherDataExportEnabled = false;
    this.trendSeriesVisibility = {
      temp: true,
      humidity: true,
      wind: true,
    };
  }

  async init(app) {
    this.apiService = app?.getModule?.("apiService");
    this.authService = app?.getModule?.("authService");
    this.featureFlagsService = app?.getModule?.("featureFlagsService");

    if (!this.apiService) {
      this._setStatus("Unable to initialize weather page.", true);
      return;
    }

    const enabled = await this._isFeatureEnabled();
    if (!enabled) {
      window.location.replace("/404.html");
      return;
    }

    await this._loadRegionsFromApi();
    await this._initUserInsightsGate();
    await this._initTrendChartGate();
    await this._initExportGate();
    this._bindEvents();
    await this.refresh();
  }

  async _initExportGate() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      this.weatherDataExportEnabled = false;
      this._toggleExportActions(false);
      return;
    }

    try {
      this.weatherDataExportEnabled = await this.featureFlagsService.isEnabled("weatherWeatherDataExport", false);
    } catch (error) {
      this.weatherDataExportEnabled = false;
    }

    this._toggleExportActions(this.weatherDataExportEnabled);
  }

  _toggleExportActions(isVisible) {
    const container = document.getElementById("weatherExportActions");
    if (!container) {
      return;
    }

    container.hidden = !isVisible;
  }

  async _initUserInsightsGate() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      this.userInsightsEnabled = false;
      this._hideUserInsightsPanel();
      return;
    }

    try {
      this.userInsightsEnabled = await this.featureFlagsService.isEnabled("weatherUserInsightsEnabled", false);
    } catch (error) {
      this.userInsightsEnabled = false;
    }

    if (!this.userInsightsEnabled) {
      this._hideUserInsightsPanel();
    }
  }

  _hideUserInsightsPanel() {
    const panel = document.getElementById("weatherUserPanel");
    if (panel) {
      panel.hidden = true;
    }
  }

  _hideTrendChartModule() {
    const panel = document.getElementById("weatherTrendModule");
    if (panel) {
      panel.hidden = true;
    }
  }

  async _initTrendChartGate() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      this.weatherTrendChartEnabled = false;
      this._hideTrendChartModule();
      return;
    }

    try {
      this.weatherTrendChartEnabled = await this.featureFlagsService.isEnabled("weatherTrendChartEnabled", false);
    } catch (error) {
      this.weatherTrendChartEnabled = false;
    }

    if (!this.weatherTrendChartEnabled) {
      this._hideTrendChartModule();
    }
  }

  _setUserPanelStatus(message, isError = false) {
    const status = document.getElementById("weatherUserPanelStatus");
    if (!status) return;

    status.textContent = message;
    status.classList.toggle("weather-user-panel__status--error", isError);
  }

  _renderUserInsightsPanel(insights) {
    const panel = document.getElementById("weatherUserPanel");
    const summary = document.getElementById("weatherUserPanelSummary");
    const risks = document.getElementById("weatherUserPanelRisks");
    const actions = document.getElementById("weatherUserPanelActions");

    if (!panel || !summary || !risks || !actions) {
      return;
    }

    panel.hidden = false;

    const farmProfile = insights?.farmProfile || {};
    const infoPills = [
      `<span class="weather-insight-pill"><strong>Fields:</strong> ${Number(farmProfile.fieldsCount || 0)}</span>`,
      `<span class="weather-insight-pill"><strong>Area:</strong> ${Number(farmProfile.totalAreaHa || 0).toFixed(2)} ha</span>`,
      `<span class="weather-insight-pill"><strong>Staff:</strong> ${Number(farmProfile.staffCount || 0)}</span>`,
      `<span class="weather-insight-pill"><strong>Animals:</strong> ${Number(farmProfile.animalsCount || 0)}</span>`,
    ];
    summary.innerHTML = infoPills.join("");

    const riskRows = Array.isArray(insights?.risks) ? insights.risks : [];
    if (riskRows.length === 0) {
      risks.innerHTML = '<span class="weather-risk weather-risk--low">Low weather risk in next 72h</span>';
    } else {
      risks.innerHTML = riskRows
        .map((risk) => {
          const level = this._escapeHtml(String(risk?.level || "medium").toLowerCase());
          const label = this._escapeHtml(risk?.label || "Weather risk");
          const details = risk?.details ? ` title="${this._escapeHtml(risk.details)}"` : "";
          return `<span class="weather-risk weather-risk--${level}"${details}>${label}</span>`;
        })
        .join("");
    }

    const recs = Array.isArray(insights?.recommendations) ? insights.recommendations : [];
    actions.innerHTML = recs
      .map((rec) => {
        const action = this._escapeHtml(rec?.action || "Action");
        const details = rec?.details ? this._escapeHtml(rec.details) : "";
        const urgency = rec?.urgency || "moderate";
        const detailsHtml = details ? `<small class="weather-action-details weather-action-urgency--${urgency}">${details}</small>` : "";
        return `<li class="weather-action-item weather-action-urgency--${urgency}"><i class="fas fa-check-circle" aria-hidden="true"></i><span><strong>${action}</strong>${detailsHtml ? "<br/>" + detailsHtml : ""}</span></li>`;
      })
      .join("");

    this._setUserPanelStatus("Recommendations updated.", false);
  }

  async _refreshUserInsights(selectedDate) {
    if (!this.userInsightsEnabled) {
      this._hideUserInsightsPanel();
      return;
    }

    if (!this.authService || typeof this.authService.isAuthenticated !== "function" || !this.authService.isAuthenticated()) {
      this._hideUserInsightsPanel();
      return;
    }

    const panel = document.getElementById("weatherUserPanel");
    if (panel) {
      panel.hidden = false;
    }
    this._setUserPanelStatus("Loading your recommendations...", false);

    try {
      const response = await this.apiService.get(
        `weather/user-insights?date=${encodeURIComponent(selectedDate)}&region=${encodeURIComponent(this.region)}`,
        { requiresAuth: true },
      );

      if (!response?.success) {
        throw new Error(response?.error || "Failed to load user weather insights");
      }

      const insights = response?.data?.data?.insights;
      this._renderUserInsightsPanel(insights || {});
    } catch (error) {
      this._setUserPanelStatus(`Could not load personalized insights: ${error.message || "unknown error"}`, true);
    }
  }

  _escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async _loadRegionsFromApi() {
    const regionSelect = document.getElementById("weatherRegionSelect");
    if (!regionSelect) {
      return;
    }

    try {
      const res = await this.apiService.get("weather/regions");
      if (!res?.success) {
        throw new Error(res?.error || "Failed to load regions");
      }

      const regions = Array.isArray(res?.data?.data?.regions) ? res.data.data.regions : [];
      const defaultRegion = String(res?.data?.data?.defaultRegion || "PL-14");

      if (regions.length === 0) {
        throw new Error("No regions available");
      }

      const savedRegion = window.localStorage?.getItem("rolnopol.weather.region");
      const hasSavedRegion = regions.some((item) => item?.code === savedRegion);
      const selectedRegion = hasSavedRegion ? savedRegion : defaultRegion;

      regionSelect.innerHTML = regions
        .map((item) => {
          const code = this._escapeHtml(item?.code || "");
          const name = this._escapeHtml(item?.name || item?.code || "");
          const selected = item?.code === selectedRegion ? " selected" : "";
          return `<option value="${code}"${selected}>${name}</option>`;
        })
        .join("");

      this.region = selectedRegion;
      regionSelect.value = selectedRegion;
    } catch (error) {
      // Keep any fallback options present in HTML and continue.
      if (regionSelect.options.length > 0) {
        this.region = regionSelect.value || this.region;
      }
    }
  }

  async _isFeatureEnabled() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      return false;
    }

    try {
      return await this.featureFlagsService.isEnabled("weatherPageEnabled", false);
    } catch (error) {
      return false;
    }
  }

  _bindEvents() {
    const refreshBtn = document.getElementById("weatherRefreshBtn");
    const regionSelect = document.getElementById("weatherRegionSelect");
    const dateInput = document.getElementById("weatherDateInput");
    const exportCsvBtn = document.getElementById("weatherExportCsvBtn");
    const exportPdfBtn = document.getElementById("weatherExportPdfBtn");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.refresh());
    }

    if (regionSelect) {
      const savedRegion = window.localStorage?.getItem("rolnopol.weather.region");
      if (savedRegion) {
        regionSelect.value = savedRegion;
        this.region = savedRegion;
      } else {
        this.region = regionSelect.value || this.region;
      }

      regionSelect.addEventListener("change", async () => {
        this.region = regionSelect.value;
        try {
          window.localStorage?.setItem("rolnopol.weather.region", this.region);
        } catch (error) {
          // ignore storage failures
        }
        await this.refresh();
      });
    }

    if (dateInput) {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      dateInput.value = tomorrow;
      dateInput.min = tomorrow;
      const max = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
      dateInput.max = max;

      dateInput.addEventListener("change", async () => {
        await this.refresh();
      });
    }

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => this._downloadWeatherExport("csv"));
    }

    if (exportPdfBtn) {
      exportPdfBtn.addEventListener("click", () => this._downloadWeatherExport("pdf"));
    }
  }

  _downloadWeatherExport(format) {
    if (!this.weatherDataExportEnabled) {
      this._setStatus("Weather export is currently disabled.", true);
      return;
    }

    const dateInput = document.getElementById("weatherDateInput");
    const selectedDate = dateInput?.value || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const query = new URLSearchParams({
      date: selectedDate,
      region: this.region,
      days: String(this.forecastDays),
    }).toString();

    window.location.assign(`/api/v1/weather/export/${format}?${query}`);
  }

  _setStatus(message, isError = false) {
    const status = document.getElementById("weatherStatus");
    if (!status) return;

    status.textContent = message;
    status.classList.toggle("weather-status--error", isError);
  }

  _iconForCondition(condition) {
    const c = String(condition || "").toLowerCase();
    if (c.includes("storm")) return "fa-bolt";
    if (c.includes("rain") || c.includes("sleet")) return "fa-cloud-rain";
    if (c.includes("snow")) return "fa-snowflake";
    if (c.includes("cloud") || c.includes("overcast")) return "fa-cloud";
    if (c.includes("wind")) return "fa-wind";
    return "fa-sun";
  }

  _dayLabel(dateStr, index = 0) {
    if (index === 0) return "Tomorrow";
    const date = new Date(`${dateStr}T00:00:00Z`);
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }

  _buildForecastCard(item, index) {
    const icon = this._iconForCondition(item?.condition);
    const label = this._dayLabel(item?.date, index);
    const tempLabel = `${Number(item?.temperatureMinC || 0).toFixed(1)}° / ${Number(item?.temperatureMaxC || 0).toFixed(1)}°C`;
    const rainWidth = Math.max(4, Math.min(100, Math.round(Number(item?.precipitationMm || 0) * 6)));

    return `
      <article class="weather-card glass">
        <div class="weather-card__head">
          <span class="weather-card__day">${label}</span>
          <span class="weather-card__date">${item?.date || "-"}</span>
        </div>
        <div class="weather-card__core">
          <i class="fas ${icon} weather-card__icon" aria-hidden="true"></i>
          <div>
            <div class="weather-card__condition">${item?.condition || "-"}</div>
            <div class="weather-card__temp">${tempLabel}</div>
          </div>
        </div>
        <div class="weather-card__rainline" aria-hidden="true">
          <span style="width:${rainWidth}%"></span>
        </div>
        <div class="weather-card__meta">
          <span class="weather-pill"><i class="fas fa-tint"></i> ${Number(item?.precipitationMm || 0).toFixed(1)} mm</span>
          <span class="weather-pill"><i class="fas fa-droplet"></i> ${Number(item?.humidityPct || 0)}%</span>
          <span class="weather-pill"><i class="fas fa-wind"></i> ${Number(item?.windKmh || 0)} km/h</span>
        </div>
      </article>
    `;
  }

  _buildLinePath(values, min, max, width, height, xStep) {
    if (!Array.isArray(values) || values.length === 0) {
      return "";
    }

    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
    const range = safeMax - safeMin;

    return values
      .map((raw, index) => {
        const value = Number(raw || 0);
        const x = Math.min(width, Math.max(0, Math.round(index * xStep * 100) / 100));
        const normalized = (value - safeMin) / range;
        const y = Math.min(height, Math.max(0, Math.round((height - normalized * height) * 100) / 100));
        return `${index === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  _lineY(value, min, max, height) {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
    const normalized = (Number(value || 0) - safeMin) / (safeMax - safeMin);
    return Math.min(height, Math.max(0, Math.round((height - normalized * height) * 100) / 100));
  }

  _trendSeriesDefinitions({ temps, humidities, winds, tempMin, tempMax, windTop }) {
    return [
      {
        key: "temp",
        label: "Temp avg",
        className: "temp",
        values: temps,
        min: tempMin,
        max: tempMax,
        unit: "°C",
        precision: 1,
      },
      {
        key: "humidity",
        label: "Humidity",
        className: "humidity",
        values: humidities,
        min: 0,
        max: 100,
        unit: "%",
        precision: 0,
      },
      {
        key: "wind",
        label: "Wind",
        className: "wind",
        values: winds,
        min: 0,
        max: windTop,
        unit: " km/h",
        precision: 0,
      },
    ];
  }

  _formatTrendValue(value, precision, unit) {
    return `${Number(value || 0).toFixed(precision)}${unit}`;
  }

  _bindTrendLegendToggles(daily, forecast) {
    const root = document.getElementById("weatherTrendChart");
    if (!root) {
      return;
    }

    root.querySelectorAll("[data-trend-series]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = String(button.getAttribute("data-trend-series") || "");
        if (!key) {
          return;
        }

        this.trendSeriesVisibility[key] = this.trendSeriesVisibility[key] === false;
        this._renderTrendChart(daily, forecast);
      });
    });
  }

  _renderTrendChart(daily, forecast) {
    if (!this.weatherTrendChartEnabled) {
      this._hideTrendChartModule();
      return;
    }

    const module = document.getElementById("weatherTrendModule");
    const root = document.getElementById("weatherTrendChart");
    if (!module || !root) {
      return;
    }

    const points = (Array.isArray(forecast) && forecast.length > 0 ? forecast : [daily]).filter(Boolean).slice(0, 7);
    if (points.length === 0) {
      module.hidden = false;
      root.innerHTML = '<div class="weather-empty">Trend chart unavailable for selected date range.</div>';
      return;
    }

    const labels = points.map((item, index) => this._dayLabel(item?.date, index));
    const temps = points.map((item) => {
      const minC = Number(item?.temperatureMinC || 0);
      const maxC = Number(item?.temperatureMaxC || 0);
      return (minC + maxC) / 2;
    });
    const humidities = points.map((item) => Number(item?.humidityPct || 0));
    const winds = points.map((item) => Number(item?.windKmh || 0));

    const width = 760;
    const height = 150;
    const xStep = points.length > 1 ? width / (points.length - 1) : width;

    const tempMin = Math.min(...temps) - 2;
    const tempMax = Math.max(...temps) + 2;

    const windMaxRaw = Math.max(...winds);
    const windTop = Math.max(10, Math.ceil(windMaxRaw / 5) * 5);

    const seriesDefs = this._trendSeriesDefinitions({ temps, humidities, winds, tempMin, tempMax, windTop });
    const visibleSeries = seriesDefs.filter((series) => this.trendSeriesVisibility[series.key] !== false);

    const sideLabels = visibleSeries.map((series) => {
      const first = series.values[0];
      const last = series.values[series.values.length - 1];
      return {
        cls: series.className,
        leftY: this._lineY(first, series.min, series.max, height),
        rightY: this._lineY(last, series.min, series.max, height),
        leftText: this._formatTrendValue(first, series.precision, series.unit),
        rightText: this._formatTrendValue(last, series.precision, series.unit),
      };
    });

    const gridLines = [0.2, 0.4, 0.6, 0.8]
      .map((ratio) => {
        const y = Math.round(height * ratio * 100) / 100;
        return `<line class="weather-trend__grid" x1="0" y1="${y}" x2="${width}" y2="${y}"/>`;
      })
      .join("");

    const pointLabelOffsets = {
      temp: -8,
      humidity: -16,
      wind: 12,
    };

    const linePathsHtml = visibleSeries
      .map((series) => {
        const d = this._buildLinePath(series.values, series.min, series.max, width, height, xStep);
        return `<path class="weather-trend__line weather-trend__line--${series.className}" d="${d}" />`;
      })
      .join("");

    const pointMarkersHtml = visibleSeries
      .map((series) =>
        series.values
          .map((value, index) => {
            const x = points.length > 1 ? Math.min(width, Math.max(0, Math.round(index * xStep * 100) / 100)) : width / 2;
            const y = this._lineY(value, series.min, series.max, height);
            const labelY = Math.min(height - 2, Math.max(10, y + (pointLabelOffsets[series.key] || -8)));
            const text = this._formatTrendValue(value, series.precision, series.unit);
            return `
              <circle class="weather-trend__point weather-trend__point--${series.className}" cx="${x}" cy="${y}" r="2.8" />
              <text class="weather-trend__point-label weather-trend__point-label--${series.className}" x="${x}" y="${labelY}" dominant-baseline="middle" text-anchor="middle">${this._escapeHtml(text)}</text>
            `;
          })
          .join(""),
      )
      .join("");

    const legendHtml = seriesDefs
      .map((series) => {
        const active = this.trendSeriesVisibility[series.key] !== false;
        const current = series.values[series.values.length - 1];
        return `
          <button type="button" class="weather-trend-pill weather-trend-pill--toggle weather-trend-pill--${series.className}${active ? " is-active" : ""}" data-trend-series="${series.key}" role="switch" aria-checked="${active}">
            <span class="weather-trend-dot weather-trend-dot--${series.className}"></span>
            ${series.label} (${this._escapeHtml(this._formatTrendValue(current, series.precision, series.unit))})
          </button>
        `;
      })
      .join("");

    module.hidden = false;
    root.innerHTML = `
      <div class="weather-trend__legend" role="list" aria-label="Chart legend">
        ${legendHtml}
      </div>
      <svg class="weather-trend__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Weather trend chart" role="img">
        ${gridLines}
        ${linePathsHtml}
        ${pointMarkersHtml}
        ${sideLabels
          .map(
            (label) => `
          <text class="weather-trend__value weather-trend__value--${label.cls}" x="6" y="${label.leftY}" dominant-baseline="middle" text-anchor="start">${this._escapeHtml(label.leftText)}</text>
          <text class="weather-trend__value weather-trend__value--${label.cls}" x="${width - 6}" y="${label.rightY}" dominant-baseline="middle" text-anchor="end">${this._escapeHtml(label.rightText)}</text>
        `,
          )
          .join("")}
      </svg>
      <div class="weather-trend__labels" style="--weather-points:${labels.length};">
        ${labels.map((label) => `<span title="${this._escapeHtml(label)}">${this._escapeHtml(label)}</span>`).join("")}
      </div>
    `;

    this._bindTrendLegendToggles(daily, forecast);
  }

  _renderDaily(weather) {
    const root = document.getElementById("weatherToday");
    if (!root) return;

    const icon = this._iconForCondition(weather?.condition);
    root.innerHTML = `
      <div class="weather-today__left">
        <div class="weather-today__icon-wrap">
          <i class="fas ${icon} weather-today__icon" aria-hidden="true"></i>
        </div>
        <div class="weather-today__summary">
          <div class="weather-today__condition">${weather?.condition || "-"}</div>
          <div class="weather-today__temp">
            ${Number(weather?.temperatureMinC || 0).toFixed(1)}° / ${Number(weather?.temperatureMaxC || 0).toFixed(1)}°C
          </div>
          <div class="weather-today__region">Region: ${this._escapeHtml(weather?.region || this.region)}</div>
        </div>
      </div>
      <div class="weather-today__right">
        <div class="weather-metric"><span>Precipitation</span><strong>${Number(weather?.precipitationMm || 0).toFixed(1)} mm</strong></div>
        <div class="weather-metric"><span>Humidity</span><strong>${Number(weather?.humidityPct || 0)}%</strong></div>
        <div class="weather-metric"><span>Wind</span><strong>${Number(weather?.windKmh || 0)} km/h</strong></div>
        <div class="weather-metric"><span>Pressure</span><strong>${Number(weather?.pressureHpa || 0)} hPa</strong></div>
        <div class="weather-metric"><span>Soil moisture</span><strong>${Number(weather?.soilMoisturePct || 0)}%</strong></div>
        <div class="weather-metric"><span>Spell</span><strong>${this._escapeHtml(weather?.spellType || "stable")}</strong></div>
      </div>
    `;

    const advisory = document.getElementById("weatherAdvisory");
    if (advisory) {
      advisory.textContent = weather?.advisory || "";
    }
  }

  _renderForecast(forecast) {
    const list = document.getElementById("weatherForecast");
    if (!list) return;

    if (!Array.isArray(forecast) || forecast.length === 0) {
      list.innerHTML = '<div class="weather-empty">Forecast unavailable (outside 7-day horizon).</div>';
      return;
    }

    list.innerHTML = forecast.map((item, index) => this._buildForecastCard(item, index)).join("");
  }

  async refresh() {
    const dateInput = document.getElementById("weatherDateInput");
    const selectedDate = dateInput?.value || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    this._setStatus("Loading weather data...");

    try {
      const [dailyRes, forecastRes] = await Promise.all([
        this.apiService.get(`weather?date=${encodeURIComponent(selectedDate)}&region=${encodeURIComponent(this.region)}`),
        this.apiService.get(
          `weather/forecast?date=${encodeURIComponent(selectedDate)}&days=${encodeURIComponent(this.forecastDays)}&region=${encodeURIComponent(this.region)}`,
        ),
      ]);

      if (!dailyRes?.success || !forecastRes?.success) {
        throw new Error(dailyRes?.error || forecastRes?.error || "Unable to load weather data");
      }

      const daily = dailyRes?.data?.data?.weather;
      const forecast = forecastRes?.data?.data?.forecast || [];
      const constraints = forecastRes?.data?.data?.constraints;

      this._renderDaily(daily);
      this._renderTrendChart(daily, forecast);
      this._renderForecast(forecast);
      await this._refreshUserInsights(selectedDate);

      const horizon = constraints?.maxDate ? ` (forecast horizon ends ${constraints.maxDate})` : "";
      this._setStatus(`Updated for ${this.region}${horizon}`);
    } catch (error) {
      this._setStatus(`Failed to load weather data: ${error.message || "unknown error"}`, true);
    }
  }
}

window.WeatherPage = WeatherPage;
