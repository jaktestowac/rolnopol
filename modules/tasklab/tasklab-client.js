/**
 * TaskLab gRPC client (app side).
 *
 * The Rolnopol app is a gRPC *client* of the standalone TaskLab service. This
 * wrapper lazily dials the service (CLIENT_TARGET from external-services/tasklab/tasklab-config),
 * attaches the caller's user id as gRPC metadata, and exposes promise-returning
 * unary calls.
 *
 * Resilience: if the app starts before the service, the channel would otherwise
 * sit in grpc-js's long reconnect backoff, so calls keep failing until the app
 * restarts. To avoid needing a restart we (a) cap the reconnect backoff low and
 * (b) drop the cached channel on a connection error so the next call rebuilds a
 * fresh one that connects immediately.
 *
 * Errors propagate as gRPC errors (with `.code`); the route layer maps them to
 * HTTP status codes (UNAVAILABLE/DEADLINE_EXCEEDED → 503, NOT_FOUND → 404, …).
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, CLIENT_TARGET } = require("../../external-services/tasklab/tasklab-config");

const CALL_DEADLINE_MS = 3000;

// Keep reconnect attempts brisk so a freshly-started service is picked up fast.
const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

let client = null;
let healthClient = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)).tasklab;
}

function getClient() {
  if (!client) {
    client = new (loadProto().TaskControl)(CLIENT_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  }
  return client;
}

function getHealthClient() {
  if (!healthClient) {
    healthClient = new (loadProto().Health)(CLIENT_TARGET, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  }
  return healthClient;
}

function reset() {
  for (const ref of [client, healthClient]) {
    if (ref) {
      try {
        ref.close();
      } catch {
        /* ignore */
      }
    }
  }
  client = null;
  healthClient = null;
}

// Drop the channel on a connection-level failure so the next call rebuilds it
// (and connects immediately to a service that has since come up).
function resetIfConnectionError(err) {
  if (err && (err.code === grpc.status.UNAVAILABLE || err.code === grpc.status.DEADLINE_EXCEEDED)) {
    reset();
  }
}

function buildMetadata(userId) {
  const md = new grpc.Metadata();
  if (userId) md.set("tl-user-id", String(userId));
  return md;
}

function unary(method, request, userId) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + CALL_DEADLINE_MS);
    getClient()[method](request, buildMetadata(userId), { deadline }, (err, reply) => {
      if (err) {
        resetIfConnectionError(err);
        return reject(err);
      }
      resolve(reply);
    });
  });
}

/**
 * Health.Check on the standalone TaskLab service — for monitoring.
 * Resolves with the HealthReply, or rejects with a gRPC error (with `.code`)
 * the route layer maps to a status (UNAVAILABLE/DEADLINE_EXCEEDED → offline).
 */
function health() {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + CALL_DEADLINE_MS);
    getHealthClient().Check({}, { deadline }, (err, reply) => {
      if (err) {
        resetIfConnectionError(err);
        return reject(err);
      }
      resolve(reply);
    });
  });
}

module.exports = {
  health,
  listStatuses: (userId) => unary("ListStatuses", {}, userId),
  listTasks: (userId, { status, query, includeArchived } = {}) =>
    unary("ListTasks", { status: status || "", query: query || "", include_archived: !!includeArchived }, userId),
  createTask: (userId, { title, content } = {}) =>
    unary("CreateTask", { title: title || "", content: content || "" }, userId),
  setStatus: (userId, id, status) => unary("SetStatus", { id, status }, userId),
  archive: (userId, id) => unary("Archive", { id }, userId),
  restore: (userId, id) => unary("Restore", { id }, userId),

  // Close + reset the cached channel (used by tests and on connection failure).
  _reset: reset,
};
