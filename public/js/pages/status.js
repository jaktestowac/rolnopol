(function () {
  const HISTORY_KEY = "rolnopol.status.history.v1";
  const HISTORY_MAX = 60;
  const HISTORY_RETENTION_MINUTES = 60 * 24;
  const AUTO_REFRESH_SECONDS = 20;

  let refreshIntervalId = null;
  let countdownIntervalId = null;
  let refreshCountdown = AUTO_REFRESH_SECONDS;

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function normalizeStatus(status) {
    const value = String(status || "unknown").toLowerCase();
    if (value === "healthy" || value === "ok") return "healthy";
    if (value === "degraded" || value === "warning" || value === "warn") return "degraded";
    if (value === "error" || value === "down" || value === "failed") return "error";
    return "unknown";
  }

  function formatTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Number(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = Math.floor(safe % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }

  function toMinuteBucket(value) {
    const ms = new Date(value || Date.now()).getTime();
    if (!Number.isFinite(ms)) return Math.floor(Date.now() / 60000);
    return Math.floor(ms / 60000);
  }

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeHistory(history) {
    try {
      const nowBucket = toMinuteBucket(Date.now());
      const minBucket = nowBucket - HISTORY_RETENTION_MINUTES;
      const filtered = history.filter((entry) => toMinuteBucket(entry?.timestamp) >= minBucket);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
    } catch (_) {
      // ignore
    }
  }

  function renderHeadline(status) {
    const node = document.getElementById("statusHeadline");
    if (!node) return;

    const normalized = normalizeStatus(status);
    const labels = {
      healthy: "All Systems Operational",
      degraded: "Partial Service Disruption",
      error: "Major Service Outage",
      unknown: "Status Unknown",
    };

    node.innerHTML = `<span class="status-dot status-dot--${normalized}"></span>${labels[normalized]}`;
  }

  function renderUpdatedAt(timestamp) {
    const node = document.getElementById("statusUpdatedAt");
    if (!node) return;
    node.textContent = `Last updated: ${formatTime(timestamp)}`;
  }

  function renderAutoRefreshLabel() {
    const node = document.getElementById("statusAutoRefresh");
    if (!node) return;
    node.textContent = `Auto refresh: every ${AUTO_REFRESH_SECONDS}s (next in ${refreshCountdown}s)`;
  }

  function renderComponents(healthData) {
    const node = document.getElementById("statusComponents");
    if (!node) return;

    const dbValidation = healthData?.databaseValidation || {};
    const anyDbErrors = Object.values(dbValidation).some((item) => normalizeStatus(item?.status) !== "healthy");
    const dbEntries = Object.entries(dbValidation);
    const dbHealthyCount = dbEntries.filter(([, item]) => normalizeStatus(item?.status) === "healthy").length;
    const dbFailedNames = dbEntries
      .filter(([, item]) => normalizeStatus(item?.status) !== "healthy")
      .map(([name]) => name)
      .slice(0, 3);
    const missingModules = Array.isArray(healthData?.modules?.missing) ? healthData.modules.missing : [];
    const memory = healthData?.memory?.memoryUsage || {};
    const heapUsed = Number(memory.heapUsed || 0);
    const heapTotal = Number(memory.heapTotal || 0);
    const heapRatio = heapTotal > 0 ? heapUsed / heapTotal : 0;
    const memoryStatus = heapRatio >= 0.92 ? "error" : heapRatio >= 0.8 ? "degraded" : "healthy";
    const moduleInstallHint = healthData?.modules?.installCommand ? `Suggested fix: ${healthData.modules.installCommand}` : "";
    const dataAgeSeconds = Math.max(0, Math.round((Date.now() - new Date(healthData?.timestamp || Date.now()).getTime()) / 1000));
    const freshnessStatus = dataAgeSeconds > 90 ? "degraded" : "healthy";

    const rows = [
      {
        tooltip: "Platform-wide aggregate status from the /api/v1/health endpoint.",
        name: "API Core",
        status: normalizeStatus(healthData?.status),
        detail: `Version: v${healthData?.version || "-"} • Uptime: ${formatDuration(healthData?.uptime)}`,
      },
      {
        tooltip: "Combined validation result from all managed database stores.",
        name: "Databases",
        status: anyDbErrors ? "degraded" : "healthy",
        detail: anyDbErrors
          ? `${dbHealthyCount}/${dbEntries.length} healthy • Failing: ${dbFailedNames.join(", ") || "n/a"}`
          : `${dbHealthyCount}/${dbEntries.length} healthy`,
      },
      {
        tooltip:
          missingModules.length > 0
            ? `Some runtime dependencies are missing. ${moduleInstallHint}`.trim()
            : "All declared dependencies are available.",
        name: "Dependencies",
        status: missingModules.length > 0 ? "degraded" : "healthy",
        detail:
          missingModules.length > 0
            ? `${missingModules.length} missing modules: ${missingModules.slice(0, 2).join(", ")}${missingModules.length > 2 ? "..." : ""}`
            : "All required dependencies resolved",
      },
      {
        tooltip: "Heap utilization ratio can indicate memory pressure and risk of garbage-collection stalls.",
        name: "Memory",
        status: memoryStatus,
        detail: `Heap: ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)} (${Math.round(heapRatio * 100) || 0}%) • RSS: ${formatBytes(memory.rss)}`,
      },
    ];

    node.innerHTML = rows
      .map(
        (row) => `
          <li class="status-component-item" data-tooltip="${escapeHtml(row.tooltip || "")}">
            <span class="status-component-main">
              <strong>${escapeHtml(row.name)}</strong>
              <span class="status-component-detail">${escapeHtml(row.detail || "")}</span>
            </span>
            <span class="status-component-state">
              <span class="status-dot status-dot--${row.status}" title="${escapeHtml(`${row.name}: ${row.status}`)}"></span>${escapeHtml(row.status)}
            </span>
          </li>
        `,
      )
      .join("");
  }

  function renderBars(history) {
    const node = document.getElementById("statusBars");
    const summary = document.getElementById("statusSummary");
    if (!node || !summary) return;

    const nowBucket = toMinuteBucket(Date.now());
    const perMinute = new Map();

    history.forEach((entry) => {
      const bucket = toMinuteBucket(entry?.timestamp);
      const prev = perMinute.get(bucket);
      if (!prev || new Date(entry?.timestamp).getTime() >= new Date(prev?.timestamp).getTime()) {
        perMinute.set(bucket, entry);
      }
    });

    const normalizedHistory = [];
    for (let offset = HISTORY_MAX - 1; offset >= 0; offset -= 1) {
      const bucket = nowBucket - offset;
      const entry = perMinute.get(bucket);
      normalizedHistory.push(entry ? normalizeStatus(entry.status) : "unknown");
    }

    node.innerHTML = normalizedHistory
      .map((status, index) => {
        const minuteOffset = HISTORY_MAX - 1 - index;
        const label = minuteOffset === 0 ? "current minute" : `${minuteOffset}m ago`;
        return `<span class="status-bar status-bar--${status}" title="${label}: ${status}" data-tooltip="${label}: ${status}"></span>`;
      })
      .join("");

    const observedCount = normalizedHistory.filter((s) => s !== "unknown").length;
    const healthyCount = normalizedHistory.filter((s) => s === "healthy").length;
    const uptimePercent = observedCount > 0 ? Math.round((healthyCount / observedCount) * 10000) / 100 : 0;
    summary.textContent = `Healthy minutes: ${healthyCount}/${HISTORY_MAX} • Observed: ${observedCount}/${HISTORY_MAX} • ${uptimePercent}% observed uptime`;
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/v1/health", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const healthData = json?.data;
      if (!healthData) {
        throw new Error("Missing health payload");
      }

      const latestStatus = normalizeStatus(healthData?.status);
      const timestamp = new Date().toISOString();
      const currentBucket = toMinuteBucket(timestamp);
      const history = readHistory().filter((entry) => toMinuteBucket(entry?.timestamp) !== currentBucket);
      history.push({ status: latestStatus, timestamp });
      writeHistory(history);
      refreshCountdown = AUTO_REFRESH_SECONDS;

      renderHeadline(latestStatus);
      renderUpdatedAt(healthData?.timestamp || timestamp);
      renderAutoRefreshLabel();
      renderComponents(healthData);
      renderBars(history);
    } catch (error) {
      renderHeadline("error");
      const timestamp = new Date().toISOString();
      renderUpdatedAt(timestamp);
      const currentBucket = toMinuteBucket(timestamp);
      const history = readHistory().filter((entry) => toMinuteBucket(entry?.timestamp) !== currentBucket);
      history.push({ status: "error", timestamp });
      writeHistory(history);
      refreshCountdown = AUTO_REFRESH_SECONDS;
      renderAutoRefreshLabel();
      renderBars(history);

      const node = document.getElementById("statusComponents");
      if (node) {
        node.innerHTML = `
          <li class="status-component-item" data-tooltip="The status endpoint request failed or timed out.">
            <span class="status-component-main">
              <strong>Status API</strong>
              <span class="status-component-detail">Endpoint unavailable or returned invalid payload.</span>
            </span>
            <span class="status-component-state"><span class="status-dot status-dot--error"></span>Error</span>
          </li>
        `;
      }
    }
  }

  function setupAutoRefresh() {
    renderAutoRefreshLabel();

    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }
    if (countdownIntervalId) {
      clearInterval(countdownIntervalId);
    }

    refreshIntervalId = setInterval(() => {
      loadStatus();
    }, AUTO_REFRESH_SECONDS * 1000);

    countdownIntervalId = setInterval(() => {
      refreshCountdown = refreshCountdown > 1 ? refreshCountdown - 1 : AUTO_REFRESH_SECONDS;
      renderAutoRefreshLabel();
    }, 1000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const refreshBtn = document.getElementById("statusRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", loadStatus);
    }

    setupAutoRefresh();
    loadStatus();
  });
})();
