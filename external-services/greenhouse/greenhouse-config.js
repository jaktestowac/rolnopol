/**
 * Shared gRPC config for the greenhouse service.
 * Used by both the standalone server and any gRPC clients (CLI, app, tests).
 */
const path = require("path");

const HOST = process.env.GREENHOUSE_GRPC_HOST || "0.0.0.0";
// Allow 0 (ephemeral port, used by tests); only fall back when unset/blank.
const PORT =
  process.env.GREENHOUSE_GRPC_PORT != null && process.env.GREENHOUSE_GRPC_PORT !== ""
    ? Number(process.env.GREENHOUSE_GRPC_PORT)
    : 50051;

// Address the server binds to.
const BIND_ADDRESS = `${HOST}:${PORT}`;

// Address clients dial (loopback by default).
const CLIENT_TARGET = process.env.GREENHOUSE_GRPC_TARGET || `localhost:${PORT}`;

// Absolute path to the service-owned .proto contract.
const PROTO_PATH = path.join(__dirname, "greenhouse.proto");

// proto-loader options shared by server and clients so message shapes match.
const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

module.exports = {
  HOST,
  PORT,
  BIND_ADDRESS,
  CLIENT_TARGET,
  PROTO_PATH,
  PROTO_LOADER_OPTIONS,
};
