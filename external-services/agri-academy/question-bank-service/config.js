/**
 * Config for the question-bank gRPC service (:50074).
 * Used by the standalone server and by both gateways' gRPC clients.
 */
const path = require("path");

const HOST = process.env.QUESTION_BANK_GRPC_HOST || "0.0.0.0";
const PORT =
  process.env.QUESTION_BANK_GRPC_PORT != null && process.env.QUESTION_BANK_GRPC_PORT !== ""
    ? Number(process.env.QUESTION_BANK_GRPC_PORT)
    : 50074;

const BIND_ADDRESS = `${HOST}:${PORT}`;
const CLIENT_TARGET = process.env.QUESTION_BANK_GRPC_TARGET || `localhost:${PORT}`;

const PROTO_PATH = path.join(__dirname, "protos", "question-bank.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const DB_PATH = process.env.QUESTION_BANK_DB_PATH
  ? path.resolve(process.env.QUESTION_BANK_DB_PATH)
  : path.join(__dirname, "data", "question-bank.json");

module.exports = { HOST, PORT, BIND_ADDRESS, CLIENT_TARGET, PROTO_PATH, PROTO_LOADER_OPTIONS, DB_PATH };
