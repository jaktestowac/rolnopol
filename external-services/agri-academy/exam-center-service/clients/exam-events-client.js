/**
 * gRPC client → exam-events-service (exam-center side).
 *
 * Two halves of #94: `recordSessionClock` FEEDS the leaf (the leaf dials no one,
 * so the exam center is the only thing that knows a session moved), and
 * `watchSessionClock` SUBSCRIBES to the tick stream the SSE bridge re-streams.
 *
 * Feeding is best-effort by design — see `record`. The clock is advisory: a leaf
 * that is down costs the taker a live countdown, nothing else, so no exam-center
 * write path may fail because of it.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { EXAM_EVENTS_TARGET, EXAM_EVENTS_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS } = require("../config");

const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

// Resolve the target from the env at connect time (env wins), so a target set
// after this module is first required — e.g. an ephemeral test port — is honored.
function resolveTarget() {
  return process.env.EXAM_EVENTS_TARGET || EXAM_EVENTS_TARGET;
}

let client = null;
let healthClient = null;
let dialed = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(EXAM_EVENTS_PROTO, PROTO_LOADER_OPTIONS)).examevents;
}
function getClient() {
  const t = resolveTarget();
  if (client && dialed !== t) reset();
  if (!client) {
    dialed = t;
    client = new (loadProto().ExamEvents)(t, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  }
  return client;
}
function getHealthClient() {
  const t = resolveTarget();
  if (healthClient && dialed !== t) reset();
  if (!healthClient) {
    dialed = t;
    healthClient = new (loadProto().Health)(t, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
  }
  return healthClient;
}
function reset() {
  for (const ref of [client, healthClient]) {
    if (ref)
      try {
        ref.close();
      } catch {
        /* ignore */
      }
  }
  client = null;
  healthClient = null;
}
function resetIfConnectionError(err) {
  if (err && (err.code === grpc.status.UNAVAILABLE || err.code === grpc.status.DEADLINE_EXCEEDED)) reset();
}
function unary(method, request) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    getClient()[method](request, { deadline }, (err, reply) => {
      if (err) {
        resetIfConnectionError(err);
        return reject(err);
      }
      resolve(reply);
    });
  });
}

/** The clock-relevant projection of a session, as the leaf's proto expects it. */
function clockSnapshot(session) {
  return {
    session_id: session.id,
    exam_id: session.examId || "",
    // From the def snapshotted at enroll, so the log stays readable per-unit even
    // after the exam is unpublished or moved. The leaf dials no one to resolve it.
    unit_id: session.snapshot?.ownerUnitId || "",
    state: session.state || "",
    activation_expires_at: session.activationExpiresAt || 0,
    access_expires_at: session.accessExpiresAt || 0,
    expires_at: session.expiresAt || 0,
  };
}

module.exports = {
  get target() {
    return resolveTarget();
  },
  health: () =>
    new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
      getHealthClient().Check({}, { deadline }, (err, reply) => {
        if (err) {
          resetIfConnectionError(err);
          return reject(err);
        }
        resolve(reply);
      });
    }),
  /** Feed one session's clock facts. Rejects on failure — callers decide. */
  record: (session) => unary("RecordSessionClock", clockSnapshot(session)),
  /**
   * Server-streaming subscription. Returns the raw gRPC call so the SSE bridge can
   * re-stream it and `cancel()` when the browser disconnects. No deadline: the
   * stream is meant to live as long as the window it is counting down.
   */
  watchSessionClock: (sessionId, tickMs) => getClient().WatchSessionClock({ session_id: sessionId, tick_ms: Number(tickMs) || 0 }),
  /**
   * Live tail of the append-only log. Returns the raw gRPC call so the SSE bridge
   * can re-stream it and `cancel()` when the browser hangs up. No deadline: a tail
   * lives as long as the page watching it, and it never terminates on its own.
   */
  watchEvents: ({ unitId = "", examId = "", sinceSequence = 0, pollMs = 0 } = {}) =>
    getClient().WatchEvents({
      unit_id: unitId || "",
      exam_id: examId || "",
      since_sequence: Number(sinceSequence) || 0,
      poll_ms: Number(pollMs) || 0,
    }),
  /**
   * A bounded, newest-first page of the log. Omit `unitId` for every unit.
   *
   * `sinceSequence` narrows the query to what is newer (a poll cursor);
   * `beforeSequence` walks backwards through history from a page already read (a
   * scroll-back bound, which `total` deliberately ignores).
   */
  listEvents: ({ unitId = "", examId = "", limit = 0, sinceSequence = 0, beforeSequence = 0 } = {}) =>
    unary("ListEvents", {
      unit_id: unitId || "",
      exam_id: examId || "",
      limit: Number(limit) || 0,
      since_sequence: Number(sinceSequence) || 0,
      before_sequence: Number(beforeSequence) || 0,
    }),
  /** Status codes a bridge must distinguish from a genuine upstream failure. */
  CANCELLED: grpc.status.CANCELLED,
  NOT_FOUND: grpc.status.NOT_FOUND,
  clockSnapshot,
  _reset: reset,
};
