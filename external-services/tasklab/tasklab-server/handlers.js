/**
 * gRPC handlers for the TaskLab service.
 *
 * Handlers are thin: translate wire messages into tasklab.service calls, extract
 * the caller's user id from gRPC metadata, and map domain errors to gRPC status
 * codes. TaskLab is for logged-in users only, so every TaskControl call must
 * carry a "tl-user-id" metadata value.
 */
const grpc = require("@grpc/grpc-js");
const tasklabService = require("./tasklab.service");
const { STATUSES } = require("./config/statuses");
const log = require("./logger");

const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

const STATUS_BY_TYPE = {
  NOT_FOUND: grpc.status.NOT_FOUND,
  INVALID_ARGUMENT: grpc.status.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpc.status.FAILED_PRECONDITION,
};

function fail(callback, error, method, fields) {
  const code = STATUS_BY_TYPE[error?.type] || grpc.status.INTERNAL;
  const isInternal = code === grpc.status.INTERNAL;
  log[isInternal ? "error" : "warn"](`${method} failed`, {
    ...fields,
    type: error?.type || "INTERNAL",
    error: error?.message,
    stack: isInternal ? error?.stack : undefined,
  });
  callback({ code, details: error?.message || "Internal error" });
}

/**
 * Caller user id from gRPC metadata (tl-user-id).
 * Returns undefined when absent → the service rejects with INVALID_ARGUMENT.
 */
function userIdFromCall(call) {
  const md = call?.metadata;
  if (!md || typeof md.get !== "function") return undefined;
  const id = md.get("tl-user-id")[0];
  return id ? String(id) : undefined;
}

// ── Health ──────────────────────────────────────────────────────────────────

async function check(call, callback) {
  const dbInitialized = require("./db").db.isInitialized === true;
  log.debug("Health.Check", { db_initialized: dbInitialized, uptime_ms: Date.now() - startedAt });
  callback(null, {
    status: "SERVING",
    db_initialized: dbInitialized,
    status_count: STATUSES.length,
    version: SERVICE_VERSION,
    uptime_ms: Date.now() - startedAt,
  });
}

// ── TaskControl — unary ───────────────────────────────────────────────────────

function listStatuses(call, callback) {
  log.debug("ListStatuses", { count: STATUSES.length });
  callback(null, tasklabService.listStatuses());
}

async function listTasks(call, callback) {
  const userId = userIdFromCall(call);
  const { status, query, include_archived } = call.request || {};
  try {
    const result = await tasklabService.listTasks(userId, { status, query, includeArchived: include_archived });
    log.info("ListTasks", { user: userId, total: result.total, status: status || undefined, q: query || undefined });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "ListTasks", { user: userId });
  }
}

async function createTask(call, callback) {
  const userId = userIdFromCall(call);
  const { title, content } = call.request || {};
  try {
    const result = await tasklabService.createTask(userId, { title, content });
    log.info("CreateTask", { user: userId, id: result.id });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "CreateTask", { user: userId });
  }
}

async function setStatus(call, callback) {
  const userId = userIdFromCall(call);
  const { id, status } = call.request || {};
  try {
    const result = await tasklabService.setStatus(userId, id, status);
    log.info("SetStatus", { user: userId, id, status });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "SetStatus", { user: userId, id, status });
  }
}

async function archive(call, callback) {
  const userId = userIdFromCall(call);
  const { id } = call.request || {};
  try {
    const result = await tasklabService.archive(userId, id);
    log.info("Archive", { user: userId, id });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "Archive", { user: userId, id });
  }
}

async function restore(call, callback) {
  const userId = userIdFromCall(call);
  const { id } = call.request || {};
  try {
    const result = await tasklabService.restore(userId, id);
    log.info("Restore", { user: userId, id });
    callback(null, result);
  } catch (error) {
    fail(callback, error, "Restore", { user: userId, id });
  }
}

module.exports = {
  SERVICE_VERSION,
  health: { Check: check },
  taskControl: {
    ListStatuses: listStatuses,
    ListTasks: listTasks,
    CreateTask: createTask,
    SetStatus: setStatus,
    Archive: archive,
    Restore: restore,
  },
};
