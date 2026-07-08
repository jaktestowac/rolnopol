/**
 * Config for the thin gateway REST service (:4310).
 * Owns no data — only the addresses of the four leaves and orchestration knobs.
 */
const path = require("path");

const HOST = process.env.STAY_GATEWAY_HOST || "0.0.0.0";
const PORT = process.env.STAY_GATEWAY_PORT != null && process.env.STAY_GATEWAY_PORT !== "" ? Number(process.env.STAY_GATEWAY_PORT) : 4310;

// Leaf targets (what the gateway dials).
const INVENTORY_TARGET = process.env.INVENTORY_GRPC_TARGET || `localhost:${process.env.INVENTORY_GRPC_PORT || 50071}`;
const RESERVATION_TARGET = process.env.RESERVATION_GRPC_TARGET || `localhost:${process.env.RESERVATION_GRPC_PORT || 50072}`;
const PRICING_URL = process.env.PRICING_URL || `http://localhost:${process.env.PRICING_PORT || 4311}`;
const REVIEW_DESK_URL = process.env.REVIEW_DESK_URL || `http://localhost:${process.env.REVIEW_DESK_PORT || 4312}`;

// Proto paths for the gRPC clients (reuse each leaf's own proto).
const INVENTORY_PROTO = path.join(__dirname, "..", "inventory-service", "protos", "inventory.proto");
const RESERVATION_PROTO = path.join(__dirname, "..", "reservation-service", "protos", "reservation.proto");

const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

// Hold TTL requested when creating a booking (seconds). 0 → inventory default.
const HOLD_TTL_SEC =
  process.env.FARM_STAY_HOLD_TTL_SEC != null && process.env.FARM_STAY_HOLD_TTL_SEC !== "" ? Number(process.env.FARM_STAY_HOLD_TTL_SEC) : 0;

// Deadlines/timeouts for downstream calls (ms).
const GRPC_DEADLINE_MS = Number(process.env.FARM_STAY_GRPC_DEADLINE_MS || 3000);
const HTTP_TIMEOUT_MS = Number(process.env.FARM_STAY_HTTP_TIMEOUT_MS || 3000);
const HEALTH_TIMEOUT_MS = Number(process.env.FARM_STAY_HEALTH_TIMEOUT_MS || 1500);

module.exports = {
  HOST,
  PORT,
  INVENTORY_TARGET,
  RESERVATION_TARGET,
  PRICING_URL,
  REVIEW_DESK_URL,
  INVENTORY_PROTO,
  RESERVATION_PROTO,
  PROTO_LOADER_OPTIONS,
  HOLD_TTL_SEC,
  GRPC_DEADLINE_MS,
  HTTP_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
};
