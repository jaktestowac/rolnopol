/**
 * Greenhouse gRPC service — standalone process (PROCESS 2).
 *
 * Start with:  npm run greenhouse   (node ./grpc/greenhouse-server/index.js)
 * Listens on :50051 (configurable via GREENHOUSE_GRPC_PORT).
 *
 * P0: boots, self-seeds the greenhouse DB, serves the Health.Check probe.
 * Later phases register the GreenhouseControl service (see handlers.js).
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, BIND_ADDRESS } = require("../greenhouse-config");
const greenhouseDb = require("./db");
const handlers = require("./handlers");
const log = require("./logger");

function loadProto() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(packageDefinition).greenhouse;
}

async function start() {
  log.info("starting greenhouse service", { version: handlers.SERVICE_VERSION, pid: process.pid });

  // Self-seed / load the greenhouse store before accepting traffic.
  await greenhouseDb.init();
  log.info("greenhouse store ready", { path: greenhouseDb.GREENHOUSE_DB_PATH });

  const proto = loadProto();
  const server = new grpc.Server();

  // Health probe + GreenhouseControl (unary + server-streaming).
  server.addService(proto.Health.service, handlers.health);
  server.addService(proto.GreenhouseControl.service, handlers.greenhouseControl);
  log.debug("services registered", { services: ["Health", "GreenhouseControl"] });

  const boundPort = await new Promise((resolve, reject) => {
    server.bindAsync(BIND_ADDRESS, grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) {
        log.error("bind failed", { address: BIND_ADDRESS, error: err.message });
        return reject(err);
      }
      log.info("listening", { version: handlers.SERVICE_VERSION, codename: "grow-a-plant", address: BIND_ADDRESS, port });
      resolve(port);
    });
  });

  setupGracefulShutdown(server);
  return { server, port: boundPort };
}

function setupGracefulShutdown(server) {
  const shutdown = (signal) => {
    log.info("shutting down", { signal });
    server.tryShutdown((err) => {
      if (err) {
        log.warn("graceful shutdown failed, forcing", { error: err.message });
        server.forceShutdown();
      }
      log.info("shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Start when run directly (node ./grpc/greenhouse-server/index.js).
if (require.main === module) {
  start().catch((error) => {
    log.error("failed to start", { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { start, loadProto };
