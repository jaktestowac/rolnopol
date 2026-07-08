/**
 * Inventory gRPC service — standalone process (:50071).
 * Start with:  npm run farmstay:inventory
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, BIND_ADDRESS } = require("../config");
const db = require("./db");
const handlers = require("./handlers");
const { createLogger } = require("../../shared/logger");

const log = createLogger("inventory");

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)).inventory;
}

async function start() {
  log.info("starting inventory service", { version: handlers.SERVICE_VERSION, pid: process.pid });
  await db.init();
  log.info("inventory store ready", { path: db.DB_PATH });

  const proto = loadProto();
  const server = new grpc.Server();
  server.addService(proto.Health.service, handlers.health);
  server.addService(proto.Inventory.service, handlers.inventory);

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(BIND_ADDRESS, grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) {
        log.error("bind failed", { address: BIND_ADDRESS, error: err.message });
        return reject(err);
      }
      log.info("listening", { codename: "inventory", address: BIND_ADDRESS, port: p });
      resolve(p);
    });
  });

  setupGracefulShutdown(server);
  return { server, port };
}

function setupGracefulShutdown(server) {
  const shutdown = (signal) => {
    log.info("shutting down", { signal });
    server.tryShutdown((err) => {
      if (err) server.forceShutdown();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
  start().catch((error) => {
    log.error("failed to start", { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { start, loadProto };
