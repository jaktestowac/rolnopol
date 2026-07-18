/**
 * Config for the reservation gRPC service (:50072).
 */
const path = require("path");

const HOST = process.env.RESERVATION_GRPC_HOST || "0.0.0.0";
const PORT =
  process.env.RESERVATION_GRPC_PORT != null && process.env.RESERVATION_GRPC_PORT !== "" ? Number(process.env.RESERVATION_GRPC_PORT) : 50072;

const BIND_ADDRESS = `${HOST}:${PORT}`;
const CLIENT_TARGET = process.env.RESERVATION_GRPC_TARGET || `localhost:${PORT}`;

const PROTO_PATH = path.join(__dirname, "protos", "reservation.proto");
const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const DB_PATH = process.env.RESERVATIONS_DB_PATH
  ? path.resolve(process.env.RESERVATIONS_DB_PATH)
  : path.join(__dirname, "data", "reservations.json");

module.exports = {
  HOST,
  PORT,
  BIND_ADDRESS,
  CLIENT_TARGET,
  PROTO_PATH,
  PROTO_LOADER_OPTIONS,
  DB_PATH,
};
