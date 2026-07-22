/**
 * Question-bank gRPC service — standalone process (:50074).
 * Start with:  npm run academy:questions
 */
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { PROTO_PATH, PROTO_LOADER_OPTIONS, BIND_ADDRESS } = require("../config");
const db = require("./db");
const handlers = require("./handlers");
const { createLogger } = require("../../shared/logger");

const log = createLogger("question-bank");

function loadProto() {
  return grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)).questionbank;
}

async function start() {
  log.info("starting question-bank service", { version: handlers.SERVICE_VERSION, pid: process.pid });
  await db.init();
  log.info("question store ready", { path: db.DB_PATH });

  const proto = loadProto();
  const server = new grpc.Server();
  server.addService(proto.Health.service, handlers.health);
  server.addService(proto.QuestionBank.service, handlers.questionBank);

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(BIND_ADDRESS, grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) {
        log.error("bind failed", { address: BIND_ADDRESS, error: err.message });
        return reject(err);
      }
      log.info("listening", { codename: "question-bank", address: BIND_ADDRESS, port: p });
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
