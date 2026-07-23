/**
 * Config for the authoring REST service (:4352) — authoring gateway + public unit pages.
 *
 * Owns certification units + exam definitions; authors questions by dialing the
 * question-bank's write RPCs. Reuses the question-bank's own proto (no drift).
 */
const path = require("path");

const HOST = process.env.AUTHORING_HOST || "0.0.0.0";
const PORT = process.env.AUTHORING_PORT != null && process.env.AUTHORING_PORT !== "" ? Number(process.env.AUTHORING_PORT) : 4352;

const DB_PATH = process.env.AUTHORING_DB_PATH
  ? path.resolve(process.env.AUTHORING_DB_PATH)
  : path.join(__dirname, "data", "authoring.json");

// What authoring dials (question-bank, gRPC write RPCs).
const QUESTION_BANK_TARGET = process.env.QUESTION_BANK_GRPC_TARGET || `localhost:${process.env.QUESTION_BANK_GRPC_PORT || 50074}`;
const QUESTION_BANK_PROTO = path.join(__dirname, "..", "question-bank-service", "protos", "question-bank.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const GRPC_DEADLINE_MS = Number(process.env.AGRI_ACADEMY_GRPC_DEADLINE_MS || 3000);

module.exports = { HOST, PORT, DB_PATH, QUESTION_BANK_TARGET, QUESTION_BANK_PROTO, PROTO_LOADER_OPTIONS, GRPC_DEADLINE_MS };
