(function () {
  function setStatus(message, isError) {
    const node = document.getElementById("healthStatusText");
    if (!node) {
      return;
    }

    node.textContent = message;
    node.classList.toggle("health-status--error", isError === true);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Number(seconds || 0));
    const d = Math.floor(safe / (3600 * 24));
    const h = Math.floor((safe % (3600 * 24)) / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = Math.floor(safe % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "-";
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function toDisplayMemoryValue(memory, formattedKey, rawKey) {
    const formatted = memory?.[formattedKey];
    if (formatted && formatted !== "-") {
      return formatted;
    }

    return formatBytes(memory?.[rawKey]);
  }

  function toStatusClass(status) {
    const normalized = String(status || "unknown").toLowerCase();
    if (normalized === "healthy" || normalized === "ok") {
      return "healthy";
    }
    if (normalized === "degraded" || normalized === "warn" || normalized === "warning") {
      return "degraded";
    }
    if (normalized === "error" || normalized === "failed" || normalized === "down") {
      return "error";
    }
    return "unknown";
  }

  function renderOverview(healthData) {
    const rawStatus = String(healthData?.status || "unknown").toLowerCase();
    const statusClass = toStatusClass(rawStatus);
    const statusLabel = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);

    const badge = document.getElementById("healthBadge");
    if (badge) {
      badge.className = `health-badge health-badge--${statusClass}`;
      badge.textContent = statusLabel;
    }

    const headline = document.getElementById("healthHeadline");
    if (headline) {
      headline.textContent = statusClass === "healthy" ? "All systems operational" : "Some systems are experiencing issues";
    }

    const timestamp = document.getElementById("healthTimestamp");
    if (timestamp) {
      timestamp.textContent = `Last update: ${formatDate(healthData?.timestamp)}`;
    }

    const version = document.getElementById("healthVersion");
    if (version) {
      version.textContent = healthData?.version ? `v${healthData.version}` : "-";
    }

    const uptime = document.getElementById("healthUptime");
    if (uptime) {
      uptime.textContent = formatDuration(healthData?.uptime);
    }
  }

  function renderComponents(healthData) {
    const grid = document.getElementById("healthComponentsGrid");
    if (!grid) {
      return;
    }

    const dbValidation = healthData?.databaseValidation || {};
    const dbHasErrors = Object.values(dbValidation).some((entry) => String(entry?.status || "").toLowerCase() !== "ok");
    const modulesMissing = Array.isArray(healthData?.modules?.missing) ? healthData.modules.missing : [];

    const cards = [
      {
        name: "API Core",
        status: healthData?.status || "unknown",
        description: `Version ${healthData?.version || "-"}`,
      },
      {
        name: "Database Layer",
        status: dbHasErrors ? "degraded" : "healthy",
        description: dbHasErrors ? "At least one database validation failed." : "All database validations look healthy.",
      },
      {
        name: "Node Modules",
        status: modulesMissing.length > 0 ? "degraded" : "healthy",
        description:
          modulesMissing.length > 0
            ? `Missing: ${modulesMissing.slice(0, 3).join(", ")}${modulesMissing.length > 3 ? "..." : ""}`
            : "Required dependencies resolved.",
      },
    ];

    grid.innerHTML = cards
      .map((card) => {
        const statusClass = toStatusClass(card.status);
        const statusLabel = String(card.status || "unknown");
        return `
          <article class="health-component-card">
            <h4 class="health-component-card__title">
              <span>${escapeHtml(card.name)}</span>
              <span class="health-badge health-badge--${statusClass}">${escapeHtml(statusLabel)}</span>
            </h4>
            <p class="health-component-card__description">${escapeHtml(card.description)}</p>
          </article>
        `;
      })
      .join("");
  }

  function renderDatabaseTable(healthData) {
    const wrap = document.getElementById("healthDbTableWrap");
    if (!wrap) {
      return;
    }

    const entries = Object.entries(healthData?.databaseValidation || {});
    if (entries.length === 0) {
      wrap.innerHTML = '<p class="health-status">No database validation details available.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="health-table" role="table" aria-label="Database validation status">
        <thead>
          <tr>
            <th scope="col">Database</th>
            <th scope="col">Status</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map(([name, info]) => {
              const statusRaw = String(info?.status || "unknown");
              const statusClass = toStatusClass(statusRaw);
              const detail = info?.error || (statusRaw.toLowerCase() === "ok" ? "Validated successfully." : "No details.");

              return `
                <tr>
                  <td>${escapeHtml(name)}</td>
                  <td><span class="health-badge health-badge--${statusClass}">${escapeHtml(statusRaw)}</span></td>
                  <td>${escapeHtml(detail)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderMemory(healthData) {
    const grid = document.getElementById("healthMemoryGrid");
    if (!grid) {
      return;
    }

    const memory = healthData?.memory?.memoryUsage || {};
    const records = [
      { label: "Heap Used", value: toDisplayMemoryValue(memory, "heapUsedFormatted", "heapUsed") },
      { label: "Heap Total", value: toDisplayMemoryValue(memory, "heapTotalFormatted", "heapTotal") },
      { label: "RSS", value: toDisplayMemoryValue(memory, "rssFormatted", "rss") },
      { label: "External", value: toDisplayMemoryValue(memory, "externalFormatted", "external") },
      { label: "Array Buffers", value: toDisplayMemoryValue(memory, "arrayBuffersFormatted", "arrayBuffers") },
    ];

    grid.innerHTML = records
      .map(
        (item) => `
          <article class="health-memory-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </article>
        `,
      )
      .join("");
  }

  function renderRawPayload(healthData) {
    const pre = document.getElementById("healthRawPayload");
    if (!pre) {
      return;
    }

    pre.textContent = JSON.stringify(healthData, null, 2);
  }

  async function fetchHealth() {
    setStatus("Loading current health status...");

    try {
      const response = await fetch("/api/v1/health", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const healthData = json?.data;

      if (!healthData) {
        throw new Error("No health payload in API response");
      }

      renderOverview(healthData);
      renderComponents(healthData);
      renderDatabaseTable(healthData);
      renderMemory(healthData);
      renderRawPayload(healthData);

      const statusClass = toStatusClass(healthData?.status);
      if (statusClass === "healthy") {
        setStatus("All systems operational.");
      } else {
        setStatus("Service is running with partial degradation.");
      }
    } catch (error) {
      setStatus(`Failed to load health status: ${error.message || "unknown error"}`, true);

      const badge = document.getElementById("healthBadge");
      if (badge) {
        badge.className = "health-badge health-badge--error";
        badge.textContent = "Error";
      }

      const headline = document.getElementById("healthHeadline");
      if (headline) {
        headline.textContent = "Unable to retrieve service health";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const refreshButton = document.getElementById("healthRefreshBtn");
    if (refreshButton) {
      refreshButton.addEventListener("click", fetchHealth);
    }

    fetchHealth();
  });
})();
