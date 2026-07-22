/**
 * gRPC client → grading-service (exam-center/runtime side).
 *
 * GradeAttempt sends per-question items (with the answer key the exam center
 * already holds from the draw) + passPct, and gets back a score/verdict. Caps
 * reconnect backoff and drops the channel on a connection error so a restarted
 * grader is picked up transparently — a grader that is down surfaces as a thrown
 * error the exam center maps to the `grading_pending` degradation path.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { GRADING_TARGET, GRADING_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS } = require("../config");

const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

// Resolve the target from the env at connect time (env wins), so a target set
// after this module is first required — e.g. an ephemeral test port — is honored.
function resolveTarget() {
  return process.env.GRADING_GRPC_TARGET || GRADING_TARGET;
}

let client = null;
let healthClient = null;
let dialed = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(GRADING_PROTO, PROTO_LOADER_OPTIONS)).grading;
}
function getClient() {
  const t = resolveTarget();
  if (client && dialed !== t) reset();
  if (!client) {
    dialed = t;
    client = new (loadProto().Grading)(t, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
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
  gradeAttempt: (items, passPct) => unary("GradeAttempt", { items: items || [], pass_pct: passPct || 0 }),
  _reset: reset,
};
