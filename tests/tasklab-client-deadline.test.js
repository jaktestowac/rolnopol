import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

const { grpc, loadPackage, reservePort } = require("./helpers/grpc-harness");

/**
 * Deadline behavior of the app-side TaskLab client wrapper.
 *
 * The wrapper applies a 3s per-call deadline and treats DEADLINE_EXCEEDED as a
 * connection-level failure (drops the cached channel, same branch as
 * UNAVAILABLE). We prove both halves: a handler that never responds trips the
 * deadline, and a subsequent call against a healthy service still succeeds —
 * showing the channel was rebuilt rather than left wedged.
 *
 * IMPORTANT: tasklab-config resolves the client dial target from env *at require
 * time*, so it must not be required until the env below is set. We therefore
 * reserve the port and require config/client inside beforeAll.
 */
const TMP_DB = path.join(os.tmpdir(), `tasklab-client-deadline-test-${process.pid}.json`);
let PORT;
let client;
let startService;
let slowServer;
let realServer;

// A TaskControl server whose RPCs never call back, so the client deadline fires.
function startSlowServer(protoPath, loaderOptions, port) {
  const proto = loadPackage(protoPath, loaderOptions, "tasklab");
  const server = new grpc.Server();
  const neverRespond = () => {};
  server.addService(proto.TaskControl.service, {
    ListStatuses: neverRespond,
    ListTasks: neverRespond,
    CreateTask: neverRespond,
    SetStatus: neverRespond,
    Archive: neverRespond,
    Restore: neverRespond,
  });
  return new Promise((resolve, reject) => {
    // Bind on 0.0.0.0 to match the real server so a localhost dial always reaches it.
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) =>
      err ? reject(err) : resolve(server),
    );
  });
}

beforeAll(async () => {
  PORT = await reservePort();
  process.env.TASKLAB_DB_PATH = TMP_DB;
  process.env.TASKLAB_GRPC_PORT = String(PORT);
  process.env.TASKLAB_GRPC_TARGET = `localhost:${PORT}`;
  process.env.TASKLAB_LOG = "silent";

  // Require config + client only now, so the dial target reflects the env above.
  const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require("../grpc/tasklab-config.js");
  client = require("../modules/tasklab/tasklab-client.js");
  startService = require("../grpc/tasklab-server/index.js").start;

  slowServer = await startSlowServer(PROTO_PATH, PROTO_LOADER_OPTIONS, PORT);
});

afterAll(() => {
  if (client) client._reset();
  // Slow server has a wedged in-flight call → force it down (tryShutdown would hang).
  if (slowServer) slowServer.forceShutdown();
  if (realServer) realServer.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("tasklab client wrapper — deadlines", () => {
  it("trips DEADLINE_EXCEEDED when the service stops responding", async () => {
    await expect(client.listStatuses("user-x")).rejects.toMatchObject({
      code: grpc.status.DEADLINE_EXCEEDED,
    });
  }, 10000);

  it("recovers on the next call after the deadline dropped the channel", async () => {
    // Replace the wedged server with a healthy one on the same port.
    slowServer.forceShutdown();
    slowServer = null;
    const started = await startService();
    realServer = started.server;

    const res = await client.listStatuses("user-x");
    expect(res.statuses.map((s) => s.id)).toContain("open");
  }, 10000);
});
