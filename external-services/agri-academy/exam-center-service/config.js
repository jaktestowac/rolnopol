/**
 * Config for the exam-center REST service (:4350) — runtime gateway + orchestrator.
 *
 * Reads published exam defs + public units from the authoring service (HTTP) and
 * draws questions from the question bank (gRPC). Money/paid settlement and the
 * grading service arrive in later phases.
 */
const path = require("path");

const HOST = process.env.EXAM_CENTER_HOST || "0.0.0.0";
const PORT = process.env.EXAM_CENTER_PORT != null && process.env.EXAM_CENTER_PORT !== "" ? Number(process.env.EXAM_CENTER_PORT) : 4350;

const DB_PATH = process.env.EXAM_CENTER_DB_PATH
  ? path.resolve(process.env.EXAM_CENTER_DB_PATH)
  : path.join(__dirname, "data", "exam-center.json");

// What the exam center dials.
const AUTHORING_TARGET = process.env.AUTHORING_TARGET || `http://localhost:${process.env.AUTHORING_PORT || 4352}`;
const QUESTION_BANK_TARGET = process.env.QUESTION_BANK_GRPC_TARGET || `localhost:${process.env.QUESTION_BANK_GRPC_PORT || 50074}`;
const QUESTION_BANK_PROTO = path.join(__dirname, "..", "question-bank-service", "protos", "question-bank.proto");
const GRADING_TARGET = process.env.GRADING_GRPC_TARGET || `localhost:${process.env.GRADING_GRPC_PORT || 50075}`;
const GRADING_PROTO = path.join(__dirname, "..", "grading-service", "protos", "grading.proto");
const CERTIFICATE_TARGET = process.env.CERTIFICATE_ISSUER_TARGET || `http://localhost:${process.env.CERTIFICATE_ISSUER_PORT || 4351}`;

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const GRPC_DEADLINE_MS = Number(process.env.AGRI_ACADEMY_GRPC_DEADLINE_MS || 3000);
const HTTP_TIMEOUT_MS = Number(process.env.AGRI_ACADEMY_HTTP_TIMEOUT_MS || 3000);

// Payment-completion TTL for a paid `awaiting_payment` session before it lapses
// to `abandoned` (wired end-to-end in Phase 4). Default 15 minutes.
const ACTIVATION_TTL_MS =
  process.env.EXAM_CENTER_ACTIVATION_TTL_MS != null && process.env.EXAM_CENTER_ACTIVATION_TTL_MS !== ""
    ? Number(process.env.EXAM_CENTER_ACTIVATION_TTL_MS)
    : 15 * 60 * 1000;

// Attempt-policy cooldown: after a taker exhausts `attemptsAllowed` on an exam,
// the exam is locked for this long before attempts reset. Default 10 minutes.
const COOLDOWN_MS =
  process.env.EXAM_CENTER_COOLDOWN_MS != null && process.env.EXAM_CENTER_COOLDOWN_MS !== ""
    ? Number(process.env.EXAM_CENTER_COOLDOWN_MS)
    : 10 * 60 * 1000;

module.exports = {
  HOST,
  PORT,
  DB_PATH,
  AUTHORING_TARGET,
  QUESTION_BANK_TARGET,
  QUESTION_BANK_PROTO,
  GRADING_TARGET,
  GRADING_PROTO,
  CERTIFICATE_TARGET,
  PROTO_LOADER_OPTIONS,
  GRPC_DEADLINE_MS,
  HTTP_TIMEOUT_MS,
  ACTIVATION_TTL_MS,
  COOLDOWN_MS,
};
