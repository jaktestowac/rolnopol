/**
 * TaskLab domain service.
 *
 * Each logged-in user owns a private list of tasks. The service is transport
 * agnostic: it takes a userId (a non-empty string) and the operation inputs,
 * and returns plain objects shaped like the proto messages. State is loaded
 * from and saved to the store on each mutating call — tasks are simple records,
 * so there is no in-memory session/tick machinery (unlike greenhouse).
 *
 *   listStatuses / listTasks / createTask / setStatus / archive / restore
 *
 * Errors carry a `.type` ("NOT_FOUND" | "INVALID_ARGUMENT" | "FAILED_PRECONDITION")
 * that handlers map to gRPC status codes — the service stays transport-agnostic.
 */
const tasklabDb = require("./db");
const { STATUSES, DEFAULT_STATUS, isValidStatus, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } = require("./config/statuses");

function serviceError(type, message) {
  return Object.assign(new Error(message), { type });
}

function requireUserId(userId) {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) {
    throw serviceError("INVALID_ARGUMENT", "A user identity is required");
  }
  return id;
}

async function loadState(userId) {
  const persisted = await tasklabDb.getUserState(userId);
  if (persisted) {
    return { tasks: persisted.tasks.map((t) => ({ ...t })), lastId: persisted.lastId };
  }
  return { tasks: [], lastId: 0 };
}

// ── Mapping to proto shapes ─────────────────────────────────────────────────

function toTask(task) {
  return {
    id: task.id,
    title: task.title,
    content: task.content || "",
    status: task.status,
    archived: !!task.archived,
    created_at: task.createdAt || "",
    updated_at: task.updatedAt || "",
  };
}

function findTask(state, id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) {
    throw serviceError("NOT_FOUND", `Task "${id}" not found`);
  }
  return task;
}

// ── Validation ──────────────────────────────────────────────────────────────

function normalizeTitle(raw) {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title) {
    throw serviceError("INVALID_ARGUMENT", "Title is required");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw serviceError("INVALID_ARGUMENT", `Title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return title;
}

function normalizeContent(raw) {
  const content = typeof raw === "string" ? raw : "";
  if (content.length > MAX_CONTENT_LENGTH) {
    throw serviceError("INVALID_ARGUMENT", `Content must be at most ${MAX_CONTENT_LENGTH} characters`);
  }
  return content;
}

// ── Read operations ───────────────────────────────────────────────────────

function listStatuses() {
  return {
    statuses: STATUSES.map((s) => ({ id: s.id, label: s.label, emoji: s.emoji })),
    max_title_length: MAX_TITLE_LENGTH,
    max_content_length: MAX_CONTENT_LENGTH,
  };
}

async function listTasks(userId, { status, query, includeArchived } = {}) {
  const id = requireUserId(userId);
  const state = await loadState(id);

  const statusFilter = typeof status === "string" && status.trim() ? status.trim() : null;
  if (statusFilter && !isValidStatus(statusFilter)) {
    throw serviceError("INVALID_ARGUMENT", `Unknown status "${statusFilter}"`);
  }
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";

  const activeCount = state.tasks.filter((t) => !t.archived).length;
  const archivedCount = state.tasks.length - activeCount;

  let tasks = state.tasks;
  if (!includeArchived) tasks = tasks.filter((t) => !t.archived);
  if (statusFilter) tasks = tasks.filter((t) => t.status === statusFilter);
  if (needle) {
    tasks = tasks.filter(
      (t) =>
        (t.title || "").toLowerCase().includes(needle) || (t.content || "").toLowerCase().includes(needle),
    );
  }

  // Newest first.
  tasks = [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    tasks: tasks.map(toTask),
    total: tasks.length,
    active_count: activeCount,
    archived_count: archivedCount,
  };
}

// ── Write operations ──────────────────────────────────────────────────────

async function createTask(userId, { title, content } = {}) {
  const id = requireUserId(userId);
  const cleanTitle = normalizeTitle(title);
  const cleanContent = normalizeContent(content);

  const state = await loadState(id);
  const nextId = state.lastId + 1;
  const now = new Date().toISOString();
  const task = {
    id: `task-${nextId}`,
    title: cleanTitle,
    content: cleanContent,
    status: DEFAULT_STATUS,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.push(task);
  state.lastId = nextId;
  await tasklabDb.saveUserState(id, state);
  return toTask(task);
}

async function setStatus(userId, taskId, status) {
  const id = requireUserId(userId);
  if (!isValidStatus(status)) {
    throw serviceError("INVALID_ARGUMENT", `Unknown status "${status}"`);
  }
  const state = await loadState(id);
  const task = findTask(state, taskId);
  task.status = status;
  task.updatedAt = new Date().toISOString();
  await tasklabDb.saveUserState(id, state);
  return toTask(task);
}

async function archive(userId, taskId) {
  const id = requireUserId(userId);
  const state = await loadState(id);
  const task = findTask(state, taskId);
  if (task.archived) {
    throw serviceError("FAILED_PRECONDITION", `Task "${taskId}" is already archived`);
  }
  task.archived = true;
  task.updatedAt = new Date().toISOString();
  await tasklabDb.saveUserState(id, state);
  return toTask(task);
}

async function restore(userId, taskId) {
  const id = requireUserId(userId);
  const state = await loadState(id);
  const task = findTask(state, taskId);
  if (!task.archived) {
    throw serviceError("FAILED_PRECONDITION", `Task "${taskId}" is not archived`);
  }
  task.archived = false;
  task.updatedAt = new Date().toISOString();
  await tasklabDb.saveUserState(id, state);
  return toTask(task);
}

module.exports = {
  listStatuses,
  listTasks,
  createTask,
  setStatus,
  archive,
  restore,
  // helpers exported for tests
  toTask,
  MAX_TITLE_LENGTH,
  MAX_CONTENT_LENGTH,
};
