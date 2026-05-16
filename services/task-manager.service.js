const dbManager = require("../data/database-manager");

const DEFAULT_STORE = Object.freeze({
  version: 1,
  tasks: [],
  labels: [],
  statuses: [],
  counters: {
    lastTaskId: 0,
    lastLabelId: 0,
    lastStatusId: 0,
    lastChecklistItemId: 0,
  },
  updatedAt: null,
});

const DEFAULT_STATUSES = Object.freeze([
  Object.freeze({ key: "backlog", name: "Backlog", position: 1 }),
  Object.freeze({ key: "inprogress", name: "Inprogress", position: 2 }),
  Object.freeze({ key: "done", name: "Done", position: 3 }),
  Object.freeze({ key: "archive", name: "Archive", position: 4 }),
]);

const LIMITS = Object.freeze({
  titleMin: 1,
  titleMax: 120,
  descriptionMin: 1,
  descriptionMax: 2000,
  labelNameMax: 40,
  statusNameMax: 40,
  checklistTextMax: 160,
  checklistItemsMax: 30,
  labelsPerTaskMax: 10,
  labelsPerUserMax: 50,
  statusesPerUserMax: 12,
  activeTasksPerUserMax: 500,
  archivedTasksPerUserMax: 1000,
  searchMax: 100,
  limitDefault: 50,
  limitMax: 100,
});

const ALLOWED_RECURRENCE_FREQUENCIES = Object.freeze(["daily", "weekly", "monthly", "yearly"]);
const ALLOWED_SORTS = Object.freeze(["createdAt", "updatedAt", "dueDate", "title", "status", "assignee"]);
const ALLOWED_ORDERS = Object.freeze(["asc", "desc"]);
const ALLOWED_VIEWS = Object.freeze(["list", "compact", "table", "calendar", "swimlane"]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class TaskManagerService {
  constructor() {
    this.db = dbManager.getTasksDatabase();
    this.staffDb = dbManager.getStaffDatabase();
  }

  listLimits() {
    return { ...LIMITS };
  }

  listViews() {
    return [...ALLOWED_VIEWS];
  }

  async listTasks(userId, query = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const store = await this._getStore();
    const validation = this._normalizeQuery(query);

    if (validation.errors.length > 0) {
      this._throwValidation(validation.errors);
    }

    const labels = this._getUserLabels(store, ownerId);
    const statuses = this._getUserStatuses(store, ownerId);
    const statusById = new Map(statuses.map((status) => [status.id, status]));
    const labelById = new Map(labels.map((label) => [label.id, label]));
    const archivedStatus = statuses.find((status) => status.name === "Archive");

    let items = this._getUserTasks(store, ownerId).filter((task) => {
      const isArchived = !!task.archivedAt || task.statusId === archivedStatus?.id;
      if (validation.filters.archived === true && !isArchived) return false;
      if (validation.filters.archived === false && isArchived) return false;
      if (validation.filters.selfAssigned != null && !!task.selfAssigned !== validation.filters.selfAssigned) return false;
      if (validation.filters.statusId && task.statusId !== validation.filters.statusId) return false;
      if (validation.filters.labelIds.length > 0 && !validation.filters.labelIds.every((labelId) => task.labelIds.includes(labelId))) {
        return false;
      }
      if (validation.filters.assigneeStaffId != null && Number(task.assigneeStaffId) !== validation.filters.assigneeStaffId) return false;
      if (validation.filters.recurring != null && !!task.recurring?.enabled !== validation.filters.recurring) return false;
      if (validation.filters.color && String(task.color || "").toLowerCase() !== validation.filters.color.toLowerCase()) return false;
      if (validation.filters.dueFrom && (!task.dueDate || task.dueDate < validation.filters.dueFrom)) return false;
      if (validation.filters.dueTo && (!task.dueDate || task.dueDate > validation.filters.dueTo)) return false;
      if (validation.filters.search) {
        const haystack = `${task.title || ""} ${task.description || ""}`.toLowerCase();
        if (!haystack.includes(validation.filters.search.toLowerCase())) return false;
      }
      return true;
    });

    items = this._sortTasks(items, validation.sort, validation.order, statusById);
    const total = items.length;
    const paged = items
      .slice(validation.offset, validation.offset + validation.limit)
      .map((task) => this._toPublicTask(task, statusById, labelById));

    return {
      items: paged,
      labels,
      statuses,
      view: validation.view,
      availableViews: this.listViews(),
      limits: this.listLimits(),
      pagination: {
        total,
        limit: validation.limit,
        offset: validation.offset,
      },
    };
  }

  async getTask(userId, taskId) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const store = await this._getStore();
    const task = this._findOwnedTask(store, ownerId, taskId);
    const statuses = this._getUserStatuses(store, ownerId);
    const labels = this._getUserLabels(store, ownerId);
    return this._toPublicTask(
      task,
      new Map(statuses.map((status) => [status.id, status])),
      new Map(labels.map((label) => [label.id, label])),
    );
  }

  async createTask(userId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    await this._ensureAssignee(ownerId, input?.assigneeStaffId);
    const now = new Date().toISOString();
    let createdTask = null;

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      this._ensureUserDefaultsInStore(store, ownerId, now);
      const normalized = this._normalizeTaskInput(store, ownerId, input, { mode: "create" });
      const activeCount = store.tasks.filter((task) => Number(task.userId) === ownerId && !task.archivedAt).length;

      if (activeCount >= LIMITS.activeTasksPerUserMax) {
        throw new Error(`Validation failed: maximum of ${LIMITS.activeTasksPerUserMax} active tasks reached`);
      }

      const nextTaskId = Number(store.counters.lastTaskId || 0) + 1;
      const position = this._nextTaskPosition(store, ownerId, normalized.statusId);
      createdTask = {
        id: `task-${nextTaskId}`,
        userId: ownerId,
        ...normalized,
        checklist: this._assignChecklistIds(store, normalized.checklist),
        position,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };

      store.counters.lastTaskId = nextTaskId;
      store.tasks.push(createdTask);
      store.updatedAt = now;
      return store;
    });

    return this.getTask(ownerId, createdTask.id);
  }

  async replaceTask(userId, taskId, input = {}) {
    return this._updateTask(userId, taskId, input, { mode: "replace" });
  }

  async patchTask(userId, taskId, input = {}) {
    return this._updateTask(userId, taskId, input, { mode: "patch" });
  }

  async moveTask(userId, taskId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const statusId = this._sanitizeId(input.statusId);
    const position = this._normalizeOptionalInteger(input.position, "position", { min: 1, max: 100000 });
    const errors = [];
    if (!statusId) errors.push("statusId is required");
    if (position.error) errors.push(position.error);
    if (errors.length > 0) this._throwValidation(errors);

    let movedTask = null;
    const now = new Date().toISOString();
    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const status = this._findOwnedStatus(store, ownerId, statusId);
      const task = this._findOwnedTask(store, ownerId, taskId);
      const nextPosition = position.value || this._nextTaskPosition(store, ownerId, status.id);

      store.tasks = store.tasks.map((item) => {
        if (item.id !== task.id) return item;
        movedTask = {
          ...item,
          statusId: status.id,
          position: nextPosition,
          archivedAt: status.name === "Archive" ? item.archivedAt || now : item.archivedAt,
          updatedAt: now,
        };
        return movedTask;
      });
      store.updatedAt = now;
      return store;
    });

    return this.getTask(ownerId, movedTask.id);
  }

  async archiveTask(userId, taskId) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const now = new Date().toISOString();
    let archivedTask = null;

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const task = this._findOwnedTask(store, ownerId, taskId);
      const archiveStatus = this._getUserStatuses(store, ownerId).find((status) => status.name === "Archive");
      const archivedCount = store.tasks.filter((item) => Number(item.userId) === ownerId && item.archivedAt).length;

      if (!task.archivedAt && archivedCount >= LIMITS.archivedTasksPerUserMax) {
        throw new Error(`Validation failed: maximum of ${LIMITS.archivedTasksPerUserMax} archived tasks reached`);
      }

      store.tasks = store.tasks.map((item) => {
        if (item.id !== task.id) return item;
        archivedTask = {
          ...item,
          statusId: archiveStatus.id,
          archivedAt: item.archivedAt || now,
          updatedAt: now,
        };
        return archivedTask;
      });
      store.updatedAt = now;
      return store;
    });

    return this.getTask(ownerId, archivedTask.id);
  }

  async restoreTask(userId, taskId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const now = new Date().toISOString();
    let restoredTask = null;

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const task = this._findOwnedTask(store, ownerId, taskId);
      const backlogStatus = this._getUserStatuses(store, ownerId).find((status) => status.name === "Backlog");
      const status = input.statusId ? this._findOwnedStatus(store, ownerId, input.statusId) : backlogStatus;

      if (status.name === "Archive") {
        throw new Error("Validation failed: restored task status cannot be Archive");
      }

      store.tasks = store.tasks.map((item) => {
        if (item.id !== task.id) return item;
        restoredTask = {
          ...item,
          statusId: status.id,
          archivedAt: null,
          updatedAt: now,
        };
        return restoredTask;
      });
      store.updatedAt = now;
      return store;
    });

    return this.getTask(ownerId, restoredTask.id);
  }

  async deleteTask(userId, taskId) {
    const ownerId = this._normalizeUserId(userId);
    let deleted = false;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      this._findOwnedTask(store, ownerId, taskId);
      store.tasks = store.tasks.filter((task) => {
        const keep = !(Number(task.userId) === ownerId && task.id === String(taskId));
        if (!keep) deleted = true;
        return keep;
      });
      store.updatedAt = now;
      return store;
    });

    return { deleted };
  }

  async listLabels(userId) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const store = await this._getStore();
    return {
      items: this._getUserLabels(store, ownerId),
      limits: this.listLimits(),
    };
  }

  async createLabel(userId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    let createdLabel = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const normalized = this._normalizeLabelInput(store, ownerId, input);
      const userLabels = this._getUserLabels(store, ownerId);
      if (userLabels.length >= LIMITS.labelsPerUserMax) {
        throw new Error(`Validation failed: maximum of ${LIMITS.labelsPerUserMax} labels reached`);
      }
      const nextLabelId = Number(store.counters.lastLabelId || 0) + 1;
      createdLabel = {
        id: `label-${nextLabelId}`,
        userId: ownerId,
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      store.counters.lastLabelId = nextLabelId;
      store.labels.push(createdLabel);
      store.updatedAt = now;
      return store;
    });

    return createdLabel;
  }

  async updateLabel(userId, labelId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    let updatedLabel = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const label = this._findOwnedLabel(store, ownerId, labelId);
      const normalized = this._normalizeLabelInput(store, ownerId, input, { existingId: label.id });
      store.labels = store.labels.map((item) => {
        if (item.id !== label.id) return item;
        updatedLabel = { ...item, ...normalized, updatedAt: now };
        return updatedLabel;
      });
      store.updatedAt = now;
      return store;
    });

    return updatedLabel;
  }

  async deleteLabel(userId, labelId) {
    const ownerId = this._normalizeUserId(userId);
    const targetId = this._sanitizeId(labelId);
    let deleted = false;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      this._findOwnedLabel(store, ownerId, targetId);
      store.labels = store.labels.filter((label) => {
        const keep = !(Number(label.userId) === ownerId && label.id === targetId);
        if (!keep) deleted = true;
        return keep;
      });
      store.tasks = store.tasks.map((task) => {
        if (Number(task.userId) !== ownerId || !Array.isArray(task.labelIds) || !task.labelIds.includes(targetId)) return task;
        return {
          ...task,
          labelIds: task.labelIds.filter((id) => id !== targetId),
          updatedAt: now,
        };
      });
      store.updatedAt = now;
      return store;
    });

    return { deleted };
  }

  async listStatuses(userId) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const store = await this._getStore();
    return {
      items: this._getUserStatuses(store, ownerId),
      limits: this.listLimits(),
    };
  }

  async createStatus(userId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    let createdStatus = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const normalized = this._normalizeStatusInput(store, ownerId, input);
      const activeStatuses = this._getUserStatuses(store, ownerId).filter((status) => !status.archivedAt);
      if (activeStatuses.length >= LIMITS.statusesPerUserMax) {
        throw new Error(`Validation failed: maximum of ${LIMITS.statusesPerUserMax} active statuses reached`);
      }
      const nextStatusId = Number(store.counters.lastStatusId || 0) + 1;
      createdStatus = {
        id: `status-${nextStatusId}`,
        userId: ownerId,
        name: normalized.name,
        type: "custom",
        position: normalized.position || this._nextStatusPosition(store, ownerId),
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.counters.lastStatusId = nextStatusId;
      store.statuses.push(createdStatus);
      store.updatedAt = now;
      return store;
    });

    return createdStatus;
  }

  async updateStatus(userId, statusId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    let updatedStatus = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const status = this._findOwnedStatus(store, ownerId, statusId);
      const normalized = this._normalizeStatusInput(store, ownerId, input, { existingId: status.id });
      store.statuses = store.statuses.map((item) => {
        if (item.id !== status.id) return item;
        updatedStatus = {
          ...item,
          name: normalized.name,
          position: normalized.position || item.position,
          updatedAt: now,
        };
        return updatedStatus;
      });
      store.updatedAt = now;
      return store;
    });

    return updatedStatus;
  }

  async reorderStatuses(userId, input = {}) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    const order = Array.isArray(input.order) ? input.order.map((id) => this._sanitizeId(id)).filter(Boolean) : [];
    if (order.length === 0) {
      this._throwValidation(["order must contain at least one status id"]);
    }

    let statuses = [];
    const now = new Date().toISOString();
    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const userStatuses = this._getUserStatuses(store, ownerId);
      const userStatusIds = new Set(userStatuses.map((status) => status.id));
      const invalid = order.filter((id) => !userStatusIds.has(id));
      if (invalid.length > 0) {
        throw new Error(`Validation failed: status ${invalid[0]} not found`);
      }
      const positionById = new Map(order.map((id, index) => [id, index + 1]));
      store.statuses = store.statuses.map((status) => {
        if (Number(status.userId) !== ownerId || !positionById.has(status.id)) return status;
        return {
          ...status,
          position: positionById.get(status.id),
          updatedAt: now,
        };
      });
      store.updatedAt = now;
      statuses = this._getUserStatuses(store, ownerId);
      return store;
    });

    return statuses;
  }

  async archiveStatus(userId, statusId) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    let archivedStatus = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const status = this._findOwnedStatus(store, ownerId, statusId);
      if (status.type === "default") {
        throw new Error("Validation failed: default statuses cannot be archived");
      }
      const activeTask = store.tasks.find((task) => Number(task.userId) === ownerId && task.statusId === status.id && !task.archivedAt);
      if (activeTask) {
        throw new Error("Validation failed: status has active tasks");
      }
      store.statuses = store.statuses.map((item) => {
        if (item.id !== status.id) return item;
        archivedStatus = {
          ...item,
          archivedAt: item.archivedAt || now,
          updatedAt: now,
        };
        return archivedStatus;
      });
      store.updatedAt = now;
      return store;
    });

    return archivedStatus;
  }

  async _updateTask(userId, taskId, input, options) {
    const ownerId = this._normalizeUserId(userId);
    await this._ensureDefaultStatuses(ownerId);
    if (Object.prototype.hasOwnProperty.call(input || {}, "assigneeStaffId") || options.mode === "replace") {
      await this._ensureAssignee(ownerId, input?.assigneeStaffId);
    }
    let updatedTask = null;
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const existing = this._findOwnedTask(store, ownerId, taskId);
      const normalized = this._normalizeTaskInput(store, ownerId, input, { mode: options.mode, existing });
      store.tasks = store.tasks.map((task) => {
        if (task.id !== existing.id) return task;
        updatedTask = {
          ...task,
          ...normalized,
          checklist: Object.prototype.hasOwnProperty.call(normalized, "checklist")
            ? this._assignChecklistIds(store, normalized.checklist)
            : task.checklist,
          updatedAt: now,
        };
        return updatedTask;
      });
      store.updatedAt = now;
      return store;
    });

    return this.getTask(ownerId, updatedTask.id);
  }

  async _getStore() {
    const current = await this.db.getAll();
    return this._normalizeStore(current);
  }

  async _ensureDefaultStatuses(userId) {
    const ownerId = this._normalizeUserId(userId);
    const now = new Date().toISOString();
    await this.db.update((current) => {
      const store = this._normalizeStore(current);
      const changed = this._ensureUserDefaultsInStore(store, ownerId, now);
      if (changed) {
        store.updatedAt = now;
      }
      return store;
    });
  }

  _ensureUserDefaultsInStore(store, userId, now) {
    const existing = this._getUserStatuses(store, userId);
    const existingDefaultNames = new Set(existing.filter((status) => status.type === "default").map((status) => status.name.toLowerCase()));
    let changed = false;

    for (const status of DEFAULT_STATUSES) {
      if (existingDefaultNames.has(status.name.toLowerCase())) continue;
      store.statuses.push({
        id: `status-${userId}-${status.key}`,
        userId,
        name: status.name,
        type: "default",
        position: status.position,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }

    return changed;
  }

  _normalizeStore(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : DEFAULT_STORE;
    return {
      version: 1,
      tasks: Array.isArray(source.tasks) ? source.tasks.map((task) => this._normalizeTaskRecord(task)) : [],
      labels: Array.isArray(source.labels) ? source.labels.map((label) => this._normalizeLabelRecord(label)) : [],
      statuses: Array.isArray(source.statuses) ? source.statuses.map((status) => this._normalizeStatusRecord(status)) : [],
      counters: {
        lastTaskId: Number(source.counters?.lastTaskId) || 0,
        lastLabelId: Number(source.counters?.lastLabelId) || 0,
        lastStatusId: Number(source.counters?.lastStatusId) || 0,
        lastChecklistItemId: Number(source.counters?.lastChecklistItemId) || 0,
      },
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    };
  }

  _normalizeTaskRecord(task) {
    const record = task && typeof task === "object" ? task : {};
    return {
      id: this._sanitizeId(record.id),
      userId: Number(record.userId),
      title: typeof record.title === "string" ? record.title : "",
      description: typeof record.description === "string" ? record.description : "",
      statusId: this._sanitizeId(record.statusId),
      labelIds: Array.isArray(record.labelIds) ? record.labelIds.map((id) => this._sanitizeId(id)).filter(Boolean) : [],
      assigneeStaffId: record.assigneeStaffId == null ? null : Number(record.assigneeStaffId),
      selfAssigned:
        record.selfAssigned === true ||
        (record.selfAssigned == null && record.assigneeStaffId != null && Number(record.assigneeStaffId) === Number(record.userId)),
      dueDate: typeof record.dueDate === "string" ? record.dueDate : null,
      recurring: this._normalizeRecurringRecord(record.recurring),
      color: typeof record.color === "string" ? record.color : null,
      checklist: Array.isArray(record.checklist)
        ? record.checklist.map((item) => this._normalizeChecklistRecord(item)).filter((item) => item.id)
        : [],
      position: Number(record.position) || 1,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
      archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    };
  }

  _normalizeLabelRecord(label) {
    const record = label && typeof label === "object" ? label : {};
    return {
      id: this._sanitizeId(record.id),
      userId: Number(record.userId),
      name: typeof record.name === "string" ? record.name : "",
      color: typeof record.color === "string" ? record.color : null,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    };
  }

  _normalizeStatusRecord(status) {
    const record = status && typeof status === "object" ? status : {};
    return {
      id: this._sanitizeId(record.id),
      userId: Number(record.userId),
      name: typeof record.name === "string" ? record.name : "",
      type: record.type === "default" ? "default" : "custom",
      position: Number(record.position) || 1,
      archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    };
  }

  _normalizeRecurringRecord(recurring) {
    if (!recurring || typeof recurring !== "object" || Array.isArray(recurring)) {
      return { enabled: false, frequency: null, interval: 1, endsAt: null };
    }
    return {
      enabled: recurring.enabled === true,
      frequency: typeof recurring.frequency === "string" ? recurring.frequency : null,
      interval: Number(recurring.interval) || 1,
      endsAt: typeof recurring.endsAt === "string" ? recurring.endsAt : null,
    };
  }

  _normalizeChecklistRecord(item) {
    const record = item && typeof item === "object" ? item : {};
    return {
      id: this._sanitizeId(record.id),
      text: typeof record.text === "string" ? record.text : "",
      checked: record.checked === true,
      position: Number(record.position) || 1,
    };
  }

  _normalizeTaskInput(store, userId, input, options = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const mode = options.mode || "create";
    const existing = options.existing || {};
    const errors = [];
    const normalized = {};
    const requireAll = mode === "create" || mode === "replace";
    const hasSelfAssigned = Object.prototype.hasOwnProperty.call(source, "selfAssigned");
    const requestedSelfAssigned = hasSelfAssigned ? source.selfAssigned === true : null;

    const applyString = (field, label, min, max) => {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        const value = this._sanitizeText(source[field]);
        if (value.length < min) errors.push(`${label} is required`);
        if (value.length > max) errors.push(`${label} must be at most ${max} characters`);
        normalized[field] = value;
      } else if (requireAll) {
        errors.push(`${label} is required`);
      }
    };

    applyString("title", "title", LIMITS.titleMin, LIMITS.titleMax);
    applyString("description", "description", LIMITS.descriptionMin, LIMITS.descriptionMax);

    if (Object.prototype.hasOwnProperty.call(source, "statusId") || mode === "create") {
      const statusId = this._sanitizeId(source.statusId) || this._getDefaultStatus(store, userId, "Backlog").id;
      const status = this._findOwnedStatus(store, userId, statusId);
      if (status.archivedAt) errors.push("statusId cannot reference an archived status");
      normalized.statusId = status.id;
    } else if (mode === "replace") {
      normalized.statusId = existing.statusId;
    }

    if (Object.prototype.hasOwnProperty.call(source, "dueDate") || requireAll) {
      const dueDate = source.dueDate == null || source.dueDate === "" ? null : String(source.dueDate);
      if (dueDate && !this._isValidIsoDate(dueDate)) errors.push("dueDate must be a valid YYYY-MM-DD date");
      normalized.dueDate = dueDate;
    }

    if (Object.prototype.hasOwnProperty.call(source, "recurring") || requireAll) {
      normalized.recurring = this._normalizeRecurringInput(source.recurring, errors, normalized.dueDate ?? existing.dueDate ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(source, "labelIds") || requireAll) {
      normalized.labelIds = this._normalizeLabelIds(store, userId, source.labelIds, errors);
    }

    if (Object.prototype.hasOwnProperty.call(source, "assigneeStaffId") || requireAll || hasSelfAssigned) {
      const assigneeStaffId = this._normalizeAssignee(source.assigneeStaffId, errors);
      if (requestedSelfAssigned === true && assigneeStaffId != null && Number(assigneeStaffId) !== Number(userId)) {
        errors.push("assigneeStaffId must match the authenticated user when selfAssigned is true");
      }
      normalized.assigneeStaffId = requestedSelfAssigned === true && assigneeStaffId == null ? Number(userId) : assigneeStaffId;
      if (normalized.assigneeStaffId != null) {
        this._validateAssigneeSyncPlaceholder(normalized.assigneeStaffId);
      }
      if (hasSelfAssigned) {
        normalized.selfAssigned = requestedSelfAssigned;
      } else if (normalized.assigneeStaffId != null && Number(normalized.assigneeStaffId) === Number(userId)) {
        normalized.selfAssigned = true;
      } else if (requireAll || mode === "replace") {
        normalized.selfAssigned = existing.selfAssigned === true;
      }
    } else if (hasSelfAssigned) {
      normalized.selfAssigned = requestedSelfAssigned;
      if (requestedSelfAssigned === true) {
        normalized.assigneeStaffId = Number(userId);
      }
    }

    if (Object.prototype.hasOwnProperty.call(source, "color") || requireAll) {
      normalized.color = this._normalizeColor(source.color, errors, "color");
    }

    if (Object.prototype.hasOwnProperty.call(source, "checklist") || requireAll) {
      normalized.checklist = this._normalizeChecklist(source.checklist, errors);
    }

    if (errors.length > 0) {
      this._throwValidation(errors);
    }

    return normalized;
  }

  _normalizeLabelInput(store, userId, input, options = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    const name = this._sanitizeText(source.name);
    const color = this._normalizeColor(source.color, errors, "color");

    if (!name) errors.push("name is required");
    if (name.length > LIMITS.labelNameMax) errors.push(`name must be at most ${LIMITS.labelNameMax} characters`);

    const duplicate = this._getUserLabels(store, userId).find(
      (label) => label.id !== options.existingId && label.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) errors.push("label name must be unique");
    if (errors.length > 0) this._throwValidation(errors);
    return { name, color };
  }

  _normalizeStatusInput(store, userId, input, options = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = [];
    const name = this._sanitizeText(source.name);
    const position = this._normalizeOptionalInteger(source.position, "position", { min: 1, max: 100000 });

    if (!name) errors.push("name is required");
    if (name.length > LIMITS.statusNameMax) errors.push(`name must be at most ${LIMITS.statusNameMax} characters`);
    if (position.error) errors.push(position.error);

    const duplicate = this._getUserStatuses(store, userId).find(
      (status) => status.id !== options.existingId && !status.archivedAt && status.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) errors.push("status name must be unique");
    if (errors.length > 0) this._throwValidation(errors);
    return { name, position: position.value };
  }

  _normalizeRecurringInput(value, errors, dueDate) {
    if (value == null || value === false) {
      return { enabled: false, frequency: null, interval: 1, endsAt: null };
    }
    if (value === true) {
      errors.push("recurring frequency is required");
      return { enabled: true, frequency: null, interval: 1, endsAt: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push("recurring must be an object");
      return { enabled: false, frequency: null, interval: 1, endsAt: null };
    }

    const enabled = value.enabled === true;
    const frequency = typeof value.frequency === "string" ? value.frequency : null;
    const interval = Number(value.interval == null ? 1 : value.interval);
    const endsAt = value.endsAt == null || value.endsAt === "" ? null : String(value.endsAt);

    if (enabled && !ALLOWED_RECURRENCE_FREQUENCIES.includes(frequency)) {
      errors.push(`recurring.frequency must be one of ${ALLOWED_RECURRENCE_FREQUENCIES.join(", ")}`);
    }
    if (!Number.isInteger(interval) || interval < 1 || interval > 24) {
      errors.push("recurring.interval must be an integer from 1 to 24");
    }
    if (endsAt && !this._isValidIsoDate(endsAt)) {
      errors.push("recurring.endsAt must be a valid YYYY-MM-DD date");
    }
    if (dueDate && endsAt && endsAt < dueDate) {
      errors.push("recurring.endsAt must be on or after dueDate");
    }

    return {
      enabled,
      frequency: enabled ? frequency : null,
      interval,
      endsAt,
    };
  }

  _normalizeLabelIds(store, userId, value, errors) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      errors.push("labelIds must be an array");
      return [];
    }
    const ids = [...new Set(value.map((id) => this._sanitizeId(id)).filter(Boolean))];
    if (ids.length > LIMITS.labelsPerTaskMax) {
      errors.push(`labelIds must contain at most ${LIMITS.labelsPerTaskMax} labels`);
    }
    const userLabelIds = new Set(this._getUserLabels(store, userId).map((label) => label.id));
    for (const id of ids) {
      if (!userLabelIds.has(id)) {
        errors.push(`label ${id} not found`);
      }
    }
    return ids;
  }

  _normalizeAssignee(value, errors) {
    if (value == null || value === "") return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      errors.push("assigneeStaffId must be a positive integer");
      return null;
    }
    return id;
  }

  _validateAssigneeSyncPlaceholder() {
    // Assignee ownership is checked asynchronously after payload normalization.
  }

  async _ensureAssignee(userId, assigneeStaffId) {
    if (assigneeStaffId == null) return;
    if (Number(assigneeStaffId) === Number(userId)) return;
    const staff = await this.staffDb.getAll();
    const exists =
      Array.isArray(staff) && staff.some((item) => Number(item.id) === Number(assigneeStaffId) && Number(item.userId) === Number(userId));
    if (!exists) {
      throw new Error("Validation failed: assigneeStaffId must reference staff owned by the user");
    }
  }

  _normalizeColor(value, errors, field) {
    if (value == null || value === "") return null;
    const color = String(value).trim();
    if (!HEX_COLOR_RE.test(color)) {
      errors.push(`${field} must be a valid #RRGGBB color`);
      return null;
    }
    return color.toUpperCase();
  }

  _normalizeChecklist(value, errors) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      errors.push("checklist must be an array");
      return [];
    }
    if (value.length > LIMITS.checklistItemsMax) {
      errors.push(`checklist must contain at most ${LIMITS.checklistItemsMax} items`);
    }
    return value.slice(0, LIMITS.checklistItemsMax).map((item, index) => {
      const source = item && typeof item === "object" ? item : {};
      const text = this._sanitizeText(source.text);
      if (!text) errors.push("checklist item text is required");
      if (text.length > LIMITS.checklistTextMax) errors.push(`checklist item text must be at most ${LIMITS.checklistTextMax} characters`);
      return {
        id: this._sanitizeId(source.id),
        text,
        checked: source.checked === true,
        position: Number.isInteger(Number(source.position)) && Number(source.position) > 0 ? Number(source.position) : index + 1,
      };
    });
  }

  _assignChecklistIds(store, checklist) {
    return (checklist || []).map((item) => {
      if (item.id) return item;
      const nextId = Number(store.counters.lastChecklistItemId || 0) + 1;
      store.counters.lastChecklistItemId = nextId;
      return {
        ...item,
        id: `check-${nextId}`,
      };
    });
  }

  _normalizeQuery(query) {
    const source = query && typeof query === "object" ? query : {};
    const errors = [];
    const limit = this._coerceInteger(source.limit, LIMITS.limitDefault);
    const offset = this._coerceInteger(source.offset, 0);
    const sort = typeof source.sort === "string" && source.sort ? source.sort : "updatedAt";
    const order = typeof source.order === "string" && source.order ? source.order : "desc";
    const view = typeof source.view === "string" && source.view ? source.view : "list";
    const search = this._sanitizeText(source.search || "");
    const filters = {
      search,
      statusId: this._sanitizeId(source.statusId),
      labelIds: this._parseIdList(source.labelId || source.labelIds),
      assigneeStaffId: source.assigneeStaffId == null || source.assigneeStaffId === "" ? null : Number(source.assigneeStaffId),
      selfAssigned: this._parseOptionalBoolean(source.selfAssigned, "selfAssigned", errors),
      dueFrom: source.dueFrom ? String(source.dueFrom) : null,
      dueTo: source.dueTo ? String(source.dueTo) : null,
      recurring: this._parseOptionalBoolean(source.recurring, "recurring", errors),
      archived: this._parseOptionalBoolean(source.archived, "archived", errors) ?? false,
      color: source.color ? String(source.color).trim() : null,
    };

    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.limitMax)
      errors.push(`limit must be an integer from 1 to ${LIMITS.limitMax}`);
    if (!Number.isInteger(offset) || offset < 0) errors.push("offset must be a non-negative integer");
    if (!ALLOWED_SORTS.includes(sort)) errors.push(`sort must be one of ${ALLOWED_SORTS.join(", ")}`);
    if (!ALLOWED_ORDERS.includes(order)) errors.push("order must be asc or desc");
    if (!ALLOWED_VIEWS.includes(view)) errors.push(`view must be one of ${ALLOWED_VIEWS.join(", ")}`);
    if (search.length > LIMITS.searchMax) errors.push(`search must be at most ${LIMITS.searchMax} characters`);
    if (filters.selfAssigned != null && typeof filters.selfAssigned !== "boolean") {
      errors.push("selfAssigned must be true or false");
    }
    if (filters.assigneeStaffId != null && (!Number.isInteger(filters.assigneeStaffId) || filters.assigneeStaffId <= 0)) {
      errors.push("assigneeStaffId must be a positive integer");
    }
    if (filters.dueFrom && !this._isValidIsoDate(filters.dueFrom)) errors.push("dueFrom must be a valid YYYY-MM-DD date");
    if (filters.dueTo && !this._isValidIsoDate(filters.dueTo)) errors.push("dueTo must be a valid YYYY-MM-DD date");
    if (filters.dueFrom && filters.dueTo && filters.dueTo < filters.dueFrom) errors.push("dueTo must be on or after dueFrom");
    if (filters.color && !HEX_COLOR_RE.test(filters.color)) errors.push("color must be a valid #RRGGBB color");

    return {
      errors,
      filters,
      sort,
      order,
      view,
      limit,
      offset,
    };
  }

  _sortTasks(tasks, sort, order, statusById) {
    const direction = order === "asc" ? 1 : -1;
    const sorted = [...tasks];
    sorted.sort((left, right) => {
      const leftValue = this._getSortValue(left, sort, statusById);
      const rightValue = this._getSortValue(right, sort, statusById);
      if (leftValue < rightValue) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      return Number(left.position || 0) - Number(right.position || 0);
    });
    return sorted;
  }

  _getSortValue(task, sort, statusById) {
    if (sort === "status") return statusById.get(task.statusId)?.position || 0;
    if (sort === "assignee") return Number(task.assigneeStaffId || 0);
    if (sort === "title") return String(task.title || "").toLowerCase();
    return String(task[sort] || "");
  }

  _toPublicTask(task, statusById, labelById) {
    return {
      ...task,
      status: statusById.get(task.statusId) || null,
      labels: task.labelIds.map((id) => labelById.get(id)).filter(Boolean),
      checklistProgress: {
        total: task.checklist.length,
        checked: task.checklist.filter((item) => item.checked).length,
      },
    };
  }

  _getUserTasks(store, userId) {
    return store.tasks.filter((task) => Number(task.userId) === Number(userId));
  }

  _getUserLabels(store, userId) {
    return store.labels
      .filter((label) => Number(label.userId) === Number(userId))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  _getUserStatuses(store, userId) {
    return store.statuses
      .filter((status) => Number(status.userId) === Number(userId))
      .sort((left, right) => {
        const position = Number(left.position || 0) - Number(right.position || 0);
        if (position !== 0) return position;
        return left.name.localeCompare(right.name);
      });
  }

  _findOwnedTask(store, userId, taskId) {
    const id = this._sanitizeId(taskId);
    const task = store.tasks.find((item) => Number(item.userId) === Number(userId) && item.id === id);
    if (!task) throw new Error("Task not found");
    return task;
  }

  _findOwnedLabel(store, userId, labelId) {
    const id = this._sanitizeId(labelId);
    const label = store.labels.find((item) => Number(item.userId) === Number(userId) && item.id === id);
    if (!label) throw new Error("Label not found");
    return label;
  }

  _findOwnedStatus(store, userId, statusId) {
    const id = this._sanitizeId(statusId);
    const status = store.statuses.find((item) => Number(item.userId) === Number(userId) && item.id === id);
    if (!status) throw new Error("Status not found");
    return status;
  }

  _getDefaultStatus(store, userId, name) {
    const status = this._getUserStatuses(store, userId).find((item) => item.type === "default" && item.name === name);
    if (!status) throw new Error(`Status ${name} not found`);
    return status;
  }

  _nextTaskPosition(store, userId, statusId) {
    const positions = store.tasks
      .filter((task) => Number(task.userId) === Number(userId) && task.statusId === statusId)
      .map((task) => Number(task.position) || 0);
    return positions.length === 0 ? 1 : Math.max(...positions) + 1;
  }

  _nextStatusPosition(store, userId) {
    const positions = this._getUserStatuses(store, userId).map((status) => Number(status.position) || 0);
    return positions.length === 0 ? 1 : Math.max(...positions) + 1;
  }

  _sanitizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  _sanitizeId(value) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  }

  _normalizeUserId(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Invalid user id");
    }
    return id;
  }

  _coerceInteger(value, fallback) {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  _normalizeOptionalInteger(value, field, options = {}) {
    if (value == null || value === "") return { value: null, error: null };
    const parsed = Number(value);
    const min = options.min ?? 0;
    const max = options.max ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return { value: null, error: `${field} must be an integer from ${min} to ${max}` };
    }
    return { value: parsed, error: null };
  }

  _parseIdList(value) {
    if (Array.isArray(value)) return value.map((id) => this._sanitizeId(id)).filter(Boolean);
    if (typeof value === "string") {
      return value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    }
    return [];
  }

  _parseOptionalBoolean(value, field, errors) {
    if (value == null || value === "") return null;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    errors.push(`${field} must be true or false`);
    return null;
  }

  _isValidIsoDate(value) {
    if (!ISO_DATE_RE.test(String(value))) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  _throwValidation(errors) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }
}

module.exports = new TaskManagerService();
