/**
 * gRPC client → question-bank-service (authoring/write side).
 *
 * Authoring is the write plane: it persists questions into the bank via
 * UpsertQuestion / DeleteQuestion and reads pools back via ListQuestions (to
 * validate a publish). Caps reconnect backoff and drops the channel on a
 * connection error so a restarted bank is picked up without restarting authoring.
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { QUESTION_BANK_TARGET, QUESTION_BANK_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS } = require("../config");

const CHANNEL_OPTIONS = {
  "grpc.initial_reconnect_backoff_ms": 200,
  "grpc.max_reconnect_backoff_ms": 2000,
};

// Resolve the target from the env at connect time (env wins), so a target set
// after this module is first required — e.g. an ephemeral test port — is honored.
function resolveTarget() {
  return process.env.QUESTION_BANK_GRPC_TARGET || QUESTION_BANK_TARGET;
}

let client = null;
let healthClient = null;
let dialed = null;

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(QUESTION_BANK_PROTO, PROTO_LOADER_OPTIONS)).questionbank;
}
function getClient() {
  const t = resolveTarget();
  if (client && dialed !== t) reset();
  if (!client) {
    dialed = t;
    client = new (loadProto().QuestionBank)(t, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
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
  // question: { id?, type, text, options:[{id,text}], correct:[ids], weight }
  upsert: (examId, question) =>
    unary("UpsertQuestion", {
      exam_id: examId,
      question: {
        id: question.id || "",
        type: question.type,
        text: question.text,
        options: (question.options || []).map((o) => ({ id: o.id, text: o.text })),
        correct: question.correct || [],
        weight: question.weight || 1,
      },
    }),
  remove: (examId, questionId) => unary("DeleteQuestion", { exam_id: examId, question_id: questionId }),
  list: (examId) => unary("ListQuestions", { exam_id: examId }),
  _reset: reset,
};
