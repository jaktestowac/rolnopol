/**
 * TaskLab page logic.
 *
 * Talks to the TaskLab REST companion (/api/v1/tasklab/*), which proxies to the
 * standalone TaskLab gRPC service. Logged-in users only — the session cookie is
 * sent with every request (credentials: "include"); a 401 means "please log in".
 */
(function () {
  "use strict";

  const API = "/api/v1/tasklab";

  const els = {};
  let statuses = []; // [{ id, label, emoji }]
  let limits = { max_title_length: 120, max_content_length: 2000 };
  let activeStatus = ""; // "" = all
  let searchTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function showBanner(message, { persist } = {}) {
    if (!els.banner) return;
    els.banner.textContent = message;
    els.banner.hidden = false;
    if (!persist) {
      clearTimeout(showBanner._t);
      showBanner._t = setTimeout(clearBanner, 5000);
    }
  }
  function clearBanner() {
    if (els.banner) els.banner.hidden = true;
  }

  async function api(method, pathname, body) {
    const opts = {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "include",
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${API}${pathname}`, opts);
    } catch (e) {
      showBanner("TaskLab service offline — please try again shortly.", { persist: true });
      return null;
    }
    if (res.status === 401) {
      showBanner("Please log in to use TaskLab.", { persist: true });
      return null;
    }
    if (res.status === 503) {
      showBanner("TaskLab service offline — please try again shortly.", { persist: true });
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showBanner(json?.error || `Request failed (HTTP ${res.status}).`);
      return null;
    }
    clearBanner();
    return json;
  }

  function statusMeta(id) {
    return statuses.find((s) => s.id === id) || { id, label: id, emoji: "" };
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  function renderStatusFilters() {
    const chips = [{ id: "", label: "All", emoji: "🗂️" }, ...statuses];
    els.filters.innerHTML = chips
      .map(
        (s) =>
          `<button type="button" class="tl-filter${s.id === activeStatus ? " active" : ""}" data-status="${s.id}" role="tab">${
            s.emoji
          } ${escapeHtml(s.label)}</button>`,
      )
      .join("");
    els.filters.querySelectorAll(".tl-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeStatus = btn.getAttribute("data-status") || "";
        renderStatusFilters();
        refresh();
      });
    });
  }

  function statusOptions(selected) {
    return statuses
      .map((s) => `<option value="${s.id}"${s.id === selected ? " selected" : ""}>${s.emoji} ${escapeHtml(s.label)}</option>`)
      .join("");
  }

  function taskCard(task) {
    const meta = statusMeta(task.status);
    const card = document.createElement("div");
    card.className = `tl-task${task.archived ? " archived" : ""}`;
    card.dataset.id = task.id;
    card.dataset.statusColor = task.status;
    card.innerHTML = `
      <div class="tl-task-head">
        <h3 class="tl-task-title">${escapeHtml(task.title)}</h3>
        <span class="tl-badge" data-status="${task.status}">${meta.emoji} ${escapeHtml(meta.label)}</span>
      </div>
      ${task.content ? `<p class="tl-task-content">${escapeHtml(task.content)}</p>` : ""}
      <div class="tl-task-actions">
        <select class="tl-status-select" aria-label="Change status">${statusOptions(task.status)}</select>
        ${
          task.archived
            ? `<button type="button" class="tl-btn tl-restore"><i class="fa-solid fa-rotate-left"></i> Restore</button>`
            : `<button type="button" class="tl-btn tl-archive"><i class="fa-solid fa-box-archive"></i> Archive</button>`
        }
        <span class="tl-task-time">Updated ${escapeHtml(fmtTime(task.updated_at))}</span>
      </div>
    `;

    card.querySelector(".tl-status-select").addEventListener("change", (e) => doSetStatus(task.id, e.target.value));
    const archiveBtn = card.querySelector(".tl-archive");
    if (archiveBtn) archiveBtn.addEventListener("click", () => doArchive(task.id));
    const restoreBtn = card.querySelector(".tl-restore");
    if (restoreBtn) restoreBtn.addEventListener("click", () => doRestore(task.id));
    return card;
  }

  function renderTasks(data) {
    els.list.innerHTML = "";
    const tasks = data?.tasks || [];
    tasks.forEach((t) => els.list.appendChild(taskCard(t)));
    els.empty.hidden = tasks.length > 0;
    els.summary.textContent = `${data?.active_count || 0} active · ${data?.archived_count || 0} archived · showing ${tasks.length}`;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function refresh() {
    const params = new URLSearchParams();
    if (activeStatus) params.set("status", activeStatus);
    const q = els.search.value.trim();
    if (q) params.set("q", q);
    if (els.includeArchived.checked) params.set("includeArchived", "true");
    const json = await api("GET", `/tasks?${params.toString()}`);
    if (json?.data) renderTasks(json.data);
  }

  async function doCreate(e) {
    e.preventDefault();
    const title = els.title.value.trim();
    const content = els.content.value;
    if (!title) return;
    els.createBtn.disabled = true;
    const json = await api("POST", "/tasks", { title, content });
    els.createBtn.disabled = false;
    if (json?.data) {
      els.form.reset();
      updateCounters();
      // Reset filters so the new (open, non-archived) task is visible.
      activeStatus = "";
      els.includeArchived.checked = false;
      renderStatusFilters();
      refresh();
    }
  }

  async function doSetStatus(id, status) {
    const json = await api("PATCH", `/tasks/${encodeURIComponent(id)}/status`, { status });
    if (json) refresh();
  }
  async function doArchive(id) {
    const json = await api("POST", `/tasks/${encodeURIComponent(id)}/archive`);
    if (json) refresh();
  }
  async function doRestore(id) {
    const json = await api("POST", `/tasks/${encodeURIComponent(id)}/restore`);
    if (json) refresh();
  }

  function updateCounters() {
    const t = els.title.value.length;
    const c = els.content.value.length;
    els.titleCount.textContent = String(t);
    els.contentCount.textContent = String(c);
    els.titleCount.parentElement.classList.toggle("over", t > limits.max_title_length);
    els.contentCount.parentElement.classList.toggle("over", c > limits.max_content_length);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function loadStatuses() {
    const json = await api("GET", "/statuses");
    if (json?.data) {
      statuses = json.data.statuses || [];
      limits = {
        max_title_length: json.data.max_title_length || 120,
        max_content_length: json.data.max_content_length || 2000,
      };
      els.title.maxLength = limits.max_title_length;
      els.content.maxLength = limits.max_content_length;
      els.titleMax.textContent = String(limits.max_title_length);
      els.contentMax.textContent = String(limits.max_content_length);
    }
    renderStatusFilters();
  }

  async function init() {
    els.banner = document.getElementById("tlBanner");
    els.form = document.getElementById("tlCreateForm");
    els.title = document.getElementById("tlTitle");
    els.content = document.getElementById("tlContent");
    els.titleCount = document.getElementById("tlTitleCount");
    els.contentCount = document.getElementById("tlContentCount");
    els.titleMax = document.getElementById("tlTitleMax");
    els.contentMax = document.getElementById("tlContentMax");
    els.createBtn = document.getElementById("tlCreateBtn");
    els.filters = document.getElementById("tlStatusFilters");
    els.search = document.getElementById("tlSearch");
    els.includeArchived = document.getElementById("tlIncludeArchived");
    els.summary = document.getElementById("tlSummary");
    els.list = document.getElementById("tlList");
    els.empty = document.getElementById("tlEmpty");

    els.form.addEventListener("submit", doCreate);
    els.title.addEventListener("input", updateCounters);
    els.content.addEventListener("input", updateCounters);
    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refresh, 250);
    });
    els.includeArchived.addEventListener("change", refresh);

    await loadStatuses();
    await refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
