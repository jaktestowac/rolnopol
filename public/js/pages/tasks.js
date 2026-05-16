class TasksPage {
  constructor() {
    this.apiService = null;
    this.authService = null;
    this.featureFlagsService = null;
    this.storage = null;
    this.state = {
      tasks: [],
      labels: [],
      statuses: [],
      staff: [],
      currentUser: null,
      view: "swimlane",
      filters: {
        search: "",
        statusId: "",
        labelId: "",
        assigneeStaffId: "",
        archived: false,
      },
      editingTask: null,
    };
  }

  async init(app) {
    this.apiService = app.getModule("apiService");
    this.authService = app.getModule("authService");
    this.featureFlagsService = app.getModule("featureFlagsService");
    this.storage = app.getModule("storage");
    this._cacheDom();
    this._bindEvents();

    const enabled = await this._isFeatureEnabled();
    if (!enabled) {
      this._showGate();
      return;
    }

    this._showApp();
    this.state.view = this._loadPreferredView();
    await this._loadAll();
  }

  _cacheDom() {
    this.gateEl = document.getElementById("tasksGate");
    this.appEl = document.getElementById("tasksApp");
    this.viewEl = document.getElementById("tasksView");
    this.countEl = document.getElementById("tasksCount");
    this.statusMessageEl = document.getElementById("tasksStatusMessage");
    this.searchInput = document.getElementById("taskSearchInput");
    this.statusFilter = document.getElementById("taskStatusFilter");
    this.labelFilter = document.getElementById("taskLabelFilter");
    this.assigneeFilter = document.getElementById("taskAssigneeFilter");
    this.archivedFilter = document.getElementById("taskArchivedFilter");
    this.resetFiltersBtn = document.getElementById("resetTaskFiltersBtn");
    this.refreshBtn = document.getElementById("refreshTasksBtn");
    this.newTaskBtn = document.getElementById("newTaskBtn");
    this.editorEl = document.getElementById("taskEditor");
    this.taskForm = document.getElementById("taskForm");
    this.taskFormTitle = document.getElementById("taskFormTitle");
    this.taskFormError = document.getElementById("taskFormError");
    this.taskIdInput = document.getElementById("taskIdInput");
    this.taskTitleInput = document.getElementById("taskTitleInput");
    this.taskDescriptionInput = document.getElementById("taskDescriptionInput");
    this.taskStatusInput = document.getElementById("taskStatusInput");
    this.taskDueDateInput = document.getElementById("taskDueDateInput");
    this.taskAssigneeInput = document.getElementById("taskAssigneeInput");
    this.taskColorInput = document.getElementById("taskColorInput");
    this.taskLabelsInput = document.getElementById("taskLabelsInput");
    this.taskRecurringEnabledInput = document.getElementById("taskRecurringEnabledInput");
    this.taskRecurringFrequencyInput = document.getElementById("taskRecurringFrequencyInput");
    this.taskRecurringIntervalInput = document.getElementById("taskRecurringIntervalInput");
    this.taskRecurringEndsAtInput = document.getElementById("taskRecurringEndsAtInput");
    this.taskChecklistInput = document.getElementById("taskChecklistInput");
    this.cancelTaskEditBtn = document.getElementById("cancelTaskEditBtn");
    this.archiveTaskBtn = document.getElementById("archiveTaskBtn");
    this.deleteTaskBtn = document.getElementById("deleteTaskBtn");
    this.labelForm = document.getElementById("labelForm");
    this.labelNameInput = document.getElementById("labelNameInput");
    this.labelColorInput = document.getElementById("labelColorInput");
    this.labelsList = document.getElementById("labelsList");
    this.statusForm = document.getElementById("statusForm");
    this.statusNameInput = document.getElementById("statusNameInput");
    this.statusesList = document.getElementById("statusesList");
  }

  _bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.view = button.getAttribute("data-view") || "list";
        this._savePreferredView(this.state.view);
        this._render();
      });
    });

    this.newTaskBtn?.addEventListener("click", () => this._openTaskEditor());
    this.cancelTaskEditBtn?.addEventListener("click", () => this._closeTaskEditor());
    this.refreshBtn?.addEventListener("click", () => this._loadAll());
    this.resetFiltersBtn?.addEventListener("click", () => this._resetFilters());
    this.taskForm?.addEventListener("submit", (event) => this._saveTask(event));
    this.archiveTaskBtn?.addEventListener("click", () => this._archiveCurrentTask());
    this.deleteTaskBtn?.addEventListener("click", () => this._deleteCurrentTask());
    this.labelForm?.addEventListener("submit", (event) => this._createLabel(event));
    this.statusForm?.addEventListener("submit", (event) => this._createStatus(event));

    const filterHandler = () => {
      this.state.filters = {
        search: this.searchInput?.value.trim() || "",
        statusId: this.statusFilter?.value || "",
        labelId: this.labelFilter?.value || "",
        assigneeStaffId: this.assigneeFilter?.value || "",
        archived: this.archivedFilter?.checked === true,
      };
      this._loadTasks();
    };

    this.searchInput?.addEventListener("input", () => this._debouncedFilter());
    this.statusFilter?.addEventListener("change", filterHandler);
    this.labelFilter?.addEventListener("change", filterHandler);
    this.assigneeFilter?.addEventListener("change", filterHandler);
    this.archivedFilter?.addEventListener("change", filterHandler);

    this.viewEl?.addEventListener("click", (event) => this._handleTaskAction(event));
    this.viewEl?.addEventListener("change", (event) => this._handleTaskSelect(event));
    this.labelsList?.addEventListener("click", (event) => this._handleLabelAction(event));
    this.statusesList?.addEventListener("click", (event) => this._handleStatusAction(event));
  }

  async _isFeatureEnabled() {
    try {
      if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") return false;
      return await this.featureFlagsService.isEnabled("taskManagerEnabled", false);
    } catch (error) {
      return false;
    }
  }

  _showGate() {
    if (this.gateEl) this.gateEl.hidden = false;
    if (this.appEl) this.appEl.hidden = true;
    if (this.newTaskBtn) this.newTaskBtn.disabled = true;
  }

  _showApp() {
    if (this.gateEl) this.gateEl.hidden = true;
    if (this.appEl) this.appEl.hidden = false;
    if (this.newTaskBtn) this.newTaskBtn.disabled = false;
  }

  async _loadAll() {
    this._setStatus("Loading...");
    await this._loadCurrentUser();
    await Promise.all([this._loadStaff(), this._loadTasks()]);
  }

  async _loadCurrentUser() {
    if (!this.authService || typeof this.authService.getCurrentUser !== "function") {
      this.state.currentUser = null;
      return;
    }

    try {
      this.state.currentUser = await this.authService.getCurrentUser();
    } catch (error) {
      this.state.currentUser = null;
    }
  }

  async _loadStaff() {
    const response = await this.apiService.get("staff", { requiresAuth: true, suppressErrorEvents: true });
    if (response?.success && Array.isArray(response.data?.data)) {
      this.state.staff = response.data.data;
      this._renderAssigneeOptions();
    }
  }

  async _loadTasks() {
    const assigneeFilterValue = this.state.filters.assigneeStaffId;
    const query = {
      search: this.state.filters.search,
      statusId: this.state.filters.statusId,
      labelId: this.state.filters.labelId,
      archived: this.state.filters.archived,
      view: this.state.view,
      sort: "updatedAt",
      order: "desc",
      limit: 100,
    };
    if (assigneeFilterValue === "self") query.selfAssigned = true;
    else if (assigneeFilterValue) query.assigneeStaffId = assigneeFilterValue;
    const response = await this.apiService.get("tasks", { requiresAuth: true, query, suppressErrorEvents: true });
    const payload = response?.data?.data;
    if (!response?.success || !payload) {
      this._setStatus(response?.error || response?.data?.error || "Failed to load tasks", true);
      return;
    }
    this.state.tasks = Array.isArray(payload.items) ? payload.items : [];
    this.state.labels = Array.isArray(payload.labels) ? payload.labels : [];
    this.state.statuses = Array.isArray(payload.statuses) ? payload.statuses : [];
    this._render();
    this._setStatus("");
  }

  _render() {
    this._renderFilters();
    this._renderTaskFormOptions();
    this._renderLabels();
    this._renderStatuses();
    this._renderViewToggle();
    if (this.countEl) this.countEl.textContent = `${this.state.tasks.length} ${this.state.tasks.length === 1 ? "task" : "tasks"}`;
    if (!this.viewEl) return;
    if (this.state.tasks.length === 0) {
      this.viewEl.innerHTML =
        '<div class="glass tasks-empty"><i class="fas fa-seedling" aria-hidden="true"></i><h2>No tasks</h2><p>Create a task or adjust filters.</p></div>';
      return;
    }
    if (this.state.view === "swimlane") this._renderSwimlane();
    else if (this.state.view === "table") this._renderTable();
    else if (this.state.view === "calendar") this._renderCalendar();
    else this._renderList(this.state.view === "compact");
  }

  _renderViewToggle() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-view") === this.state.view);
    });
  }

  _renderFilters() {
    this._fillSelect(
      this.statusFilter,
      [{ value: "", label: "All statuses" }].concat(this.state.statuses.map((status) => ({ value: status.id, label: status.name }))),
      this.state.filters.statusId,
    );
    this._fillSelect(
      this.labelFilter,
      [{ value: "", label: "All labels" }].concat(this.state.labels.map((label) => ({ value: label.id, label: label.name }))),
      this.state.filters.labelId,
    );
    this._fillSelect(
      this.assigneeFilter,
      [{ value: "", label: "All assignees" }].concat(this._getAssigneeOptions()),
      this.state.filters.assigneeStaffId,
    );
    if (this.searchInput && this.searchInput.value !== this.state.filters.search) this.searchInput.value = this.state.filters.search;
    if (this.archivedFilter) this.archivedFilter.checked = this.state.filters.archived;
  }

  _renderTaskFormOptions() {
    const activeStatuses = this.state.statuses.filter(
      (status) => !status.archivedAt && (this.state.filters.archived || status.name !== "Archive"),
    );
    this._fillSelect(
      this.taskStatusInput,
      activeStatuses.map((status) => ({ value: status.id, label: status.name })),
      this.taskStatusInput?.value || "",
    );
    this._fillSelect(
      this.taskAssigneeInput,
      [{ value: "", label: "Unassigned" }].concat(this._getAssigneeOptions()),
      this.taskAssigneeInput?.value || "",
    );
    this._fillSelect(
      this.taskLabelsInput,
      this.state.labels.map((label) => ({ value: label.id, label: label.name })),
      "",
    );
  }

  _renderAssigneeOptions() {
    this._renderFilters();
    this._renderTaskFormOptions();
  }

  _renderLabels() {
    if (!this.labelsList) return;
    this.labelsList.innerHTML = this.state.labels
      .map(
        (label) => `
        <span class="tasks-chip" style="--chip-color:${this._escapeAttr(label.color || "#718096")}">
          ${this._escape(label.name)}
          <button type="button" data-label-delete="${this._escapeAttr(label.id)}" title="Delete label" aria-label="Delete ${this._escapeAttr(label.name)}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        </span>`,
      )
      .join("");
  }

  _renderStatuses() {
    if (!this.statusesList) return;
    this.statusesList.innerHTML = this.state.statuses
      .map(
        (status, index) => `
        <div class="tasks-status-row">
          <span>${this._escape(status.name)}${status.type === "default" ? " <small>default</small>" : ""}</span>
          <div>
            <button type="button" data-status-up="${this._escapeAttr(status.id)}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move ${this._escapeAttr(status.name)} up"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
            <button type="button" data-status-down="${this._escapeAttr(status.id)}" ${index === this.state.statuses.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move ${this._escapeAttr(status.name)} down"><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
            <button type="button" data-status-rename="${this._escapeAttr(status.id)}" title="Rename status" aria-label="Rename ${this._escapeAttr(status.name)}"><i class="fas fa-pen" aria-hidden="true"></i></button>
            <button type="button" data-status-archive="${this._escapeAttr(status.id)}" ${status.type === "default" ? "disabled" : ""} title="Archive status" aria-label="Archive ${this._escapeAttr(status.name)}"><i class="fas fa-box-archive" aria-hidden="true"></i></button>
          </div>
        </div>`,
      )
      .join("");
  }

  _renderList(compact) {
    this.viewEl.className = compact ? "tasks-view tasks-list tasks-list--compact" : "tasks-view tasks-list";
    this.viewEl.innerHTML = this.state.tasks.map((task) => this._taskCard(task, compact)).join("");
  }

  _renderSwimlane() {
    this.viewEl.className = "tasks-view tasks-swimlane";
    const visibleStatuses = this.state.statuses.filter((status) => this.state.filters.archived || status.name !== "Archive");
    this.viewEl.innerHTML = visibleStatuses
      .map((status) => {
        const tasks = this.state.tasks.filter((task) => task.statusId === status.id);
        return `
          <section class="tasks-lane">
            <header><h2>${this._escape(status.name)}</h2><span>${tasks.length}</span></header>
            <div class="tasks-lane__body">
              ${tasks.length ? tasks.map((task) => this._taskCard(task, true)).join("") : '<p class="tasks-lane__empty">Empty</p>'}
            </div>
          </section>`;
      })
      .join("");
  }

  _renderTable() {
    this.viewEl.className = "tasks-view tasks-table-wrap";
    this.viewEl.innerHTML = `
      <table class="tasks-table">
        <thead><tr><th>Title</th><th>Status</th><th>Labels</th><th>Due</th><th>Assignee</th><th></th></tr></thead>
        <tbody>${this.state.tasks
          .map(
            (task) => `
            <tr>
              <td>${this._escape(task.title)}</td>
              <td>${this._escape(task.status?.name || "")}</td>
              <td>${this._renderLabelBadges(task)}</td>
              <td>${this._escape(task.dueDate || "-")}</td>
              <td>${this._escape(this._assigneeLabel(task))}</td>
              <td><button type="button" class="tasks-icon-btn" data-task-edit="${this._escapeAttr(task.id)}" title="Edit task" aria-label="Edit ${this._escapeAttr(task.title)}"><i class="fas fa-pen" aria-hidden="true"></i></button></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`;
  }

  _renderCalendar() {
    this.viewEl.className = "tasks-view tasks-calendar";
    const groups = this.state.tasks.reduce((acc, task) => {
      const key = task.dueDate || "No due date";
      acc[key] = acc[key] || [];
      acc[key].push(task);
      return acc;
    }, {});
    this.viewEl.innerHTML = Object.entries(groups)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([date, tasks]) => `
        <section class="tasks-date-group">
          <h2>${this._escape(date)}</h2>
          ${tasks.map((task) => this._taskCard(task, true)).join("")}
        </section>`,
      )
      .join("");
  }

  _taskCard(task, compact) {
    const archived = !!task.archivedAt;
    return `
      <article class="tasks-card ${compact ? "tasks-card--compact" : ""}" style="--task-color:${this._escapeAttr(task.color || "#2F855A")}">
        <div class="tasks-card__main">
          <header>
            <h3>${this._escape(task.title)}</h3>
            <span>${this._escape(task.status?.name || "")}</span>
          </header>
          ${compact ? "" : `<p>${this._escape(task.description)}</p>`}
          <div class="tasks-card__meta">
            ${task.dueDate ? `<span><i class="fas fa-calendar-day" aria-hidden="true"></i>${this._escape(task.dueDate)}</span>` : ""}
            ${this._assigneeLabel(task) ? `<span><i class="fas fa-user" aria-hidden="true"></i>${this._escape(this._assigneeLabel(task))}</span>` : ""}
            <span><i class="fas fa-square-check" aria-hidden="true"></i>${task.checklistProgress?.checked || 0}/${task.checklistProgress?.total || 0}</span>
            ${task.recurring?.enabled ? '<span><i class="fas fa-repeat" aria-hidden="true"></i>Recurring</span>' : ""}
          </div>
          <div class="tasks-card__labels">${this._renderLabelBadges(task)}</div>
        </div>
        <div class="tasks-card__actions">
          <select data-task-move="${this._escapeAttr(task.id)}" aria-label="Move ${this._escapeAttr(task.title)}">${this.state.statuses
            .filter((status) => !status.archivedAt)
            .map(
              (status) =>
                `<option value="${this._escapeAttr(status.id)}" ${status.id === task.statusId ? "selected" : ""}>${this._escape(status.name)}</option>`,
            )
            .join("")}</select>
          <button type="button" class="tasks-icon-btn" data-task-edit="${this._escapeAttr(task.id)}" title="Edit task" aria-label="Edit ${this._escapeAttr(task.title)}"><i class="fas fa-pen" aria-hidden="true"></i></button>
          ${
            archived
              ? `<button type="button" class="tasks-icon-btn" data-task-restore="${this._escapeAttr(task.id)}" title="Restore task" aria-label="Restore ${this._escapeAttr(task.title)}"><i class="fas fa-rotate-left" aria-hidden="true"></i></button>
              <button type="button" class="tasks-icon-btn" data-task-delete="${this._escapeAttr(task.id)}" title="Delete archived task" aria-label="Delete archived ${this._escapeAttr(task.title)}"><i class="fas fa-trash" aria-hidden="true"></i></button>`
              : `<button type="button" class="tasks-icon-btn" data-task-archive="${this._escapeAttr(task.id)}" title="Archive task" aria-label="Archive ${this._escapeAttr(task.title)}"><i class="fas fa-box-archive" aria-hidden="true"></i></button>`
          }
        </div>
      </article>`;
  }

  _renderLabelBadges(task) {
    return (task.labels || [])
      .map(
        (label) =>
          `<span class="tasks-label" style="--label-color:${this._escapeAttr(label.color || "#718096")}">${this._escape(label.name)}</span>`,
      )
      .join("");
  }

  _openTaskEditor(task = null) {
    this.state.editingTask = task;
    if (this.editorEl) this.editorEl.hidden = false;
    if (this.taskFormTitle) this.taskFormTitle.textContent = task ? "Edit task" : "New task";
    if (this.taskIdInput) this.taskIdInput.value = task?.id || "";
    if (this.taskTitleInput) this.taskTitleInput.value = task?.title || "";
    if (this.taskDescriptionInput) this.taskDescriptionInput.value = task?.description || "";
    if (this.taskDueDateInput) this.taskDueDateInput.value = task?.dueDate || "";
    if (this.taskAssigneeInput) this.taskAssigneeInput.value = task?.selfAssigned ? "self" : task?.assigneeStaffId || "";
    if (this.taskColorInput) this.taskColorInput.value = task?.color || "#2F855A";
    if (this.taskStatusInput) this.taskStatusInput.value = task?.statusId || this._defaultStatusId();
    if (this.taskRecurringEnabledInput) this.taskRecurringEnabledInput.checked = task?.recurring?.enabled === true;
    if (this.taskRecurringFrequencyInput) this.taskRecurringFrequencyInput.value = task?.recurring?.frequency || "weekly";
    if (this.taskRecurringIntervalInput) this.taskRecurringIntervalInput.value = task?.recurring?.interval || 1;
    if (this.taskRecurringEndsAtInput) this.taskRecurringEndsAtInput.value = task?.recurring?.endsAt || "";
    if (this.taskChecklistInput)
      this.taskChecklistInput.value = (task?.checklist || []).map((item) => `${item.checked ? "[x] " : ""}${item.text}`).join("\n");
    if (this.taskLabelsInput) {
      const labelIds = new Set(task?.labelIds || []);
      Array.from(this.taskLabelsInput.options).forEach((option) => {
        option.selected = labelIds.has(option.value);
      });
    }
    if (this.archiveTaskBtn) this.archiveTaskBtn.hidden = !task || !!task.archivedAt;
    if (this.deleteTaskBtn) this.deleteTaskBtn.hidden = !task;
    this._setFormError("");
    this.taskTitleInput?.focus();
  }

  _closeTaskEditor() {
    this.state.editingTask = null;
    if (this.editorEl) this.editorEl.hidden = true;
    this.taskForm?.reset();
    this._setFormError("");
  }

  async _saveTask(event) {
    event.preventDefault();
    const payload = this._buildTaskPayload();
    const validationError = this._validateTaskPayload(payload);
    if (validationError) {
      this._setFormError(validationError);
      return;
    }
    const taskId = this.taskIdInput?.value;
    const response = taskId
      ? await this.apiService.put(`tasks/${encodeURIComponent(taskId)}`, payload, { requiresAuth: true, suppressErrorEvents: true })
      : await this.apiService.post("tasks", payload, { requiresAuth: true, suppressErrorEvents: true });

    if (!response?.success) {
      this._setFormError(response?.data?.error || response?.error || "Failed to save task");
      return;
    }
    this._closeTaskEditor();
    await this._loadTasks();
    this._notify("Task saved", "success");
  }

  _buildTaskPayload() {
    const checklist = (this.taskChecklistInput?.value || "")
      .split("\n")
      .map((line, index) => {
        const trimmed = line.trim();
        const checked = /^\[x\]\s*/i.test(trimmed);
        const text = trimmed.replace(/^\[(x| )\]\s*/i, "").trim();
        return text ? { text, checked, position: index + 1 } : null;
      })
      .filter(Boolean);
    return {
      title: this.taskTitleInput?.value.trim() || "",
      description: this.taskDescriptionInput?.value.trim() || "",
      statusId: this.taskStatusInput?.value || this._defaultStatusId(),
      dueDate: this.taskDueDateInput?.value || null,
      selfAssigned: this.taskAssigneeInput?.value === "self",
      assigneeStaffId: this.taskAssigneeInput?.value === "self" ? null : this.taskAssigneeInput?.value || null,
      color: this.taskColorInput?.value || null,
      labelIds: this.taskLabelsInput ? Array.from(this.taskLabelsInput.selectedOptions).map((option) => option.value) : [],
      recurring: {
        enabled: this.taskRecurringEnabledInput?.checked === true,
        frequency: this.taskRecurringFrequencyInput?.value || "weekly",
        interval: Number(this.taskRecurringIntervalInput?.value || 1),
        endsAt: this.taskRecurringEndsAtInput?.value || null,
      },
      checklist,
    };
  }

  _validateTaskPayload(payload) {
    if (!payload.title) return "Title is required";
    if (payload.title.length > 120) return "Title must be at most 120 characters";
    if (!payload.description) return "Description is required";
    if (payload.description.length > 2000) return "Description must be at most 2000 characters";
    if (payload.labelIds.length > 10) return "Select at most 10 labels";
    if (payload.checklist.length > 30) return "Checklist can contain at most 30 items";
    if (payload.checklist.some((item) => item.text.length > 160)) return "Checklist items must be at most 160 characters";
    return "";
  }

  async _archiveCurrentTask() {
    const taskId = this.taskIdInput?.value;
    if (!taskId) return;
    const response = await this.apiService.post(
      `tasks/${encodeURIComponent(taskId)}/archive`,
      {},
      { requiresAuth: true, suppressErrorEvents: true },
    );
    if (!response?.success) {
      this._setFormError(response?.data?.error || response?.error || "Failed to archive task");
      return;
    }
    this._closeTaskEditor();
    await this._loadTasks();
  }

  async _deleteCurrentTask() {
    const taskId = this.taskIdInput?.value;
    if (!taskId) return;
    const deleted = await this._deleteTaskById(taskId, {
      title: "Delete task",
      message: "Delete this task?",
      confirmText: "Delete",
      errorMessage: "Failed to delete task",
    });
    if (deleted) {
      this._closeTaskEditor();
    }
  }

  async _createLabel(event) {
    event.preventDefault();
    const name = this.labelNameInput?.value.trim() || "";
    if (!name) return;
    const response = await this.apiService.post(
      "tasks/labels",
      { name, color: this.labelColorInput?.value || "#C53030" },
      { requiresAuth: true, suppressErrorEvents: true },
    );
    if (!response?.success) {
      this._setStatus(response?.data?.error || response?.error || "Failed to create label", true);
      return;
    }
    this.labelForm?.reset();
    await this._loadTasks();
  }

  async _createStatus(event) {
    event.preventDefault();
    const name = this.statusNameInput?.value.trim() || "";
    if (!name) return;
    const response = await this.apiService.post("tasks/statuses", { name }, { requiresAuth: true, suppressErrorEvents: true });
    if (!response?.success) {
      this._setStatus(response?.data?.error || response?.error || "Failed to create status", true);
      return;
    }
    this.statusForm?.reset();
    await this._loadTasks();
  }

  async _handleTaskAction(event) {
    const target = event.target.closest("button");
    if (!target) return;
    const editId = target.getAttribute("data-task-edit");
    const archiveId = target.getAttribute("data-task-archive");
    const restoreId = target.getAttribute("data-task-restore");
    const deleteId = target.getAttribute("data-task-delete");
    if (editId) {
      const task = this.state.tasks.find((item) => item.id === editId);
      if (task) this._openTaskEditor(task);
    } else if (archiveId) {
      await this.apiService.post(`tasks/${encodeURIComponent(archiveId)}/archive`, {}, { requiresAuth: true, suppressErrorEvents: true });
      await this._loadTasks();
    } else if (restoreId) {
      await this.apiService.post(`tasks/${encodeURIComponent(restoreId)}/restore`, {}, { requiresAuth: true, suppressErrorEvents: true });
      await this._loadTasks();
    } else if (deleteId) {
      await this._deleteTaskById(deleteId, {
        title: "Delete archived task",
        message: "Delete this archived task permanently?",
        confirmText: "Delete",
        errorMessage: "Failed to delete task",
      });
    }
  }

  async _handleTaskSelect(event) {
    const select = event.target.closest("select[data-task-move]");
    if (!select) return;
    const taskId = select.getAttribute("data-task-move");
    const response = await this.apiService.request("PATCH", `tasks/${encodeURIComponent(taskId)}/move`, {
      requiresAuth: true,
      suppressErrorEvents: true,
      body: { statusId: select.value },
    });
    if (!response?.success) {
      this._setStatus(response?.data?.error || response?.error || "Failed to move task", true);
    }
    await this._loadTasks();
  }

  async _handleLabelAction(event) {
    const button = event.target.closest("button[data-label-delete]");
    if (!button) return;
    await this.apiService.delete(`tasks/labels/${encodeURIComponent(button.getAttribute("data-label-delete"))}`, {
      requiresAuth: true,
      suppressErrorEvents: true,
    });
    await this._loadTasks();
  }

  async _handleStatusAction(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const statusId = button.getAttribute("data-status-up") || button.getAttribute("data-status-down");
    if (statusId) {
      const direction = button.hasAttribute("data-status-up") ? -1 : 1;
      await this._reorderStatus(statusId, direction);
      return;
    }
    const renameId = button.getAttribute("data-status-rename");
    if (renameId) {
      const status = this.state.statuses.find((item) => item.id === renameId);
      const name = window.prompt("Status name", status?.name || "");
      if (!name || name.trim() === status?.name) return;
      await this.apiService.put(
        `tasks/statuses/${encodeURIComponent(renameId)}`,
        { name: name.trim() },
        { requiresAuth: true, suppressErrorEvents: true },
      );
      await this._loadTasks();
      return;
    }
    const archiveId = button.getAttribute("data-status-archive");
    if (archiveId) {
      const response = await this.apiService.post(
        `tasks/statuses/${encodeURIComponent(archiveId)}/archive`,
        {},
        { requiresAuth: true, suppressErrorEvents: true },
      );
      if (!response?.success) this._setStatus(response?.data?.error || response?.error || "Failed to archive status", true);
      await this._loadTasks();
    }
  }

  async _reorderStatus(statusId, direction) {
    const statuses = [...this.state.statuses];
    const index = statuses.findIndex((status) => status.id === statusId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= statuses.length) return;
    const [status] = statuses.splice(index, 1);
    statuses.splice(nextIndex, 0, status);
    const response = await this.apiService.request("PATCH", "tasks/statuses/reorder", {
      requiresAuth: true,
      suppressErrorEvents: true,
      body: { order: statuses.map((item) => item.id) },
    });
    if (!response?.success) this._setStatus(response?.data?.error || response?.error || "Failed to reorder statuses", true);
    await this._loadTasks();
  }

  _resetFilters() {
    this.state.filters = { search: "", statusId: "", labelId: "", assigneeStaffId: "", archived: false };
    this._loadTasks();
  }

  _debouncedFilter() {
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.state.filters.search = this.searchInput?.value.trim() || "";
      this._loadTasks();
    }, 200);
  }

  _defaultStatusId() {
    return this.state.statuses.find((status) => status.name === "Backlog")?.id || this.state.statuses[0]?.id || "";
  }

  _staffName(id) {
    const staff = this.state.staff.find((item) => Number(item.id) === Number(id));
    return staff ? `${staff.name} ${staff.surname}` : "Unassigned";
  }

  _assigneeLabel(task) {
    if (!task) return "";
    if (task.selfAssigned === true || this._isCurrentUserAssignee(task.assigneeStaffId)) {
      return "Me";
    }
    return task.assigneeStaffId ? this._staffName(task.assigneeStaffId) : "";
  }

  _getCurrentUserId() {
    const currentUser = this.state.currentUser || this.authService?.currentUser || null;
    if (!currentUser) return null;
    const value = currentUser.userId || currentUser.id || currentUser.internalId || null;
    const numericValue = Number(value);
    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
  }

  _isCurrentUserAssignee(id) {
    const currentUserId = this._getCurrentUserId();
    if (currentUserId == null) return false;
    return Number(id) === currentUserId;
  }

  _getAssigneeOptions() {
    const options = [];
    const currentUserId = this._getCurrentUserId();
    options.push({ value: "self", label: "Me" });

    this.state.staff.forEach((staff) => {
      if (currentUserId != null && Number(staff.id) === currentUserId) return;
      options.push({ value: String(staff.id), label: `${staff.name} ${staff.surname}` });
    });

    return options;
  }

  async _deleteTaskById(taskId, options = {}) {
    if (!taskId) return false;
    const confirmOptions = {
      title: options.title || "Delete task",
      message: options.message || "Delete this task?",
      confirmText: options.confirmText || "Delete",
      cancelText: options.cancelText || "Cancel",
    };
    const ok =
      typeof window.showConfirmationModal === "function"
        ? await window.showConfirmationModal(confirmOptions)
        : window.confirm(confirmOptions.message);
    if (!ok) return false;

    const response = await this.apiService.delete(`tasks/${encodeURIComponent(taskId)}`, { requiresAuth: true, suppressErrorEvents: true });
    if (!response?.success) {
      const message = response?.data?.error || response?.error || options.errorMessage || "Failed to delete task";
      if (this.taskFormError) this.taskFormError.textContent = message;
      this._setStatus(message, true);
      return false;
    }

    await this._loadTasks();
    return true;
  }

  _fillSelect(select, options, selectedValue) {
    if (!select) return;
    const previousValues = Array.from(select.selectedOptions || []).map((option) => option.value);
    select.innerHTML = options
      .map((option) => `<option value="${this._escapeAttr(option.value)}">${this._escape(option.label)}</option>`)
      .join("");
    const selected = selectedValue || (select.multiple ? previousValues : "");
    Array.from(select.options).forEach((option) => {
      if (Array.isArray(selected)) option.selected = selected.includes(option.value);
      else option.selected = option.value === String(selected);
    });
  }

  _setStatus(message, isError = false) {
    if (this.statusMessageEl) {
      this.statusMessageEl.textContent = message || "";
      this.statusMessageEl.classList.toggle("is-error", isError);
    }
    if (message && isError) this._notify(message, "error");
  }

  _setFormError(message) {
    if (this.taskFormError) this.taskFormError.textContent = message || "";
  }

  _notify(message, type = "info") {
    if (typeof window.showNotification === "function") window.showNotification(message, type, type === "error" ? 6000 : 2500);
  }

  _loadPreferredView() {
    try {
      const value = localStorage.getItem("rolnopol.tasks.view");
      return ["list", "compact", "table", "calendar", "swimlane"].includes(value) ? value : "swimlane";
    } catch (error) {
      return "swimlane";
    }
  }

  _savePreferredView(view) {
    try {
      localStorage.setItem("rolnopol.tasks.view", view);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  _escape(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  _escapeAttr(value) {
    return this._escape(value).replace(/"/g, "&quot;");
  }
}

window.TasksPage = TasksPage;
