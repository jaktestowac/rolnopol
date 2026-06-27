/**
 * TaskLab gRPC service — standalone process.
 *
 * Start with:  npm run tasklab   (node ./grpc/tasklab-server/index.js)
 * Listens on :50052 (configurable via TASKLAB_GRPC_PORT).
 *
 * Boots, self-seeds the TaskLab DB, serves the Health.Check probe, and registers
 * the TaskControl service (see handlers.js).
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, BIND_ADDRESS } = require("../tasklab-config");
const tasklabDb = require("./db");
const handlers = require("./handlers");
const log = require("./logger");

function loadProto() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(packageDefinition).tasklab;
}

async function start() {
  log.info("starting tasklab service", { version: handlers.SERVICE_VERSION, pid: process.pid });

  // Self-seed / load the TaskLab store before accepting traffic.
  await tasklabDb.init();
  log.info("tasklab store ready", { path: tasklabDb.TASKLAB_DB_PATH });

  const proto = loadProto();
  const server = new grpc.Server();

  // Health probe + TaskControl (unary).
  server.addService(proto.Health.service, handlers.health);
  server.addService(proto.TaskControl.service, handlers.taskControl);
  log.debug("services registered", { services: ["Health", "TaskControl"] });

  const boundPort = await new Promise((resolve, reject) => {
    server.bindAsync(BIND_ADDRESS, grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) {
        log.error("bind failed", { address: BIND_ADDRESS, error: err.message });
        return reject(err);
      }
      log.info("listening", { version: handlers.SERVICE_VERSION, codename: "tasklab", address: BIND_ADDRESS, port });
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

// Start when run directly (node ./grpc/tasklab-server/index.js).
if (require.main === module) {
  start().catch((error) => {
    log.error("failed to start", { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { start, loadProto };
