/**
 * Config for the inventory gRPC service (:50071).
 * Used by the standalone server and the gateway's gRPC client.
 */
const path = require("path");

const HOST = process.env.INVENTORY_GRPC_HOST || "0.0.0.0";
const PORT =
  process.env.INVENTORY_GRPC_PORT != null && process.env.INVENTORY_GRPC_PORT !== "" ? Number(process.env.INVENTORY_GRPC_PORT) : 50071;

const BIND_ADDRESS = `${HOST}:${PORT}`;
const CLIENT_TARGET = process.env.INVENTORY_GRPC_TARGET || `localhost:${PORT}`;

const PROTO_PATH = path.join(__dirname, "protos", "inventory.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const DB_PATH = process.env.INVENTORY_DB_PATH
  ? path.resolve(process.env.INVENTORY_DB_PATH)
  : path.join(__dirname, "data", "inventory.json");

// Default hold TTL when the caller passes 0 (seconds).
const DEFAULT_HOLD_TTL_SEC =
  process.env.FARM_STAY_HOLD_TTL_SEC != null && process.env.FARM_STAY_HOLD_TTL_SEC !== ""
    ? Number(process.env.FARM_STAY_HOLD_TTL_SEC)
    : 600;

module.exports = {
  HOST,
  PORT,
  BIND_ADDRESS,
  CLIENT_TARGET,
  PROTO_PATH,
  PROTO_LOADER_OPTIONS,
  DB_PATH,
  DEFAULT_HOLD_TTL_SEC,
};
