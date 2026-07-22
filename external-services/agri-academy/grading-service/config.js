/**
 * Config for the grading gRPC service (:50075) — the STATELESS scorer.
 * Used by the standalone server and by the exam center's grading client.
 */
const path = require("path");

const HOST = process.env.GRADING_GRPC_HOST || "0.0.0.0";
const PORT = process.env.GRADING_GRPC_PORT != null && process.env.GRADING_GRPC_PORT !== "" ? Number(process.env.GRADING_GRPC_PORT) : 50075;

const BIND_ADDRESS = `${HOST}:${PORT}`;
const CLIENT_TARGET = process.env.GRADING_GRPC_TARGET || `localhost:${PORT}`;

const PROTO_PATH = path.join(__dirname, "protos", "grading.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

module.exports = { HOST, PORT, BIND_ADDRESS, CLIENT_TARGET, PROTO_PATH, PROTO_LOADER_OPTIONS };
