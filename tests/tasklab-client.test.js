import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

const { grpc, reservePort } = require("./helpers/grpc-harness");

/**
 * Resilience tests for the app-side TaskLab client wrapper
 * (modules/tasklab/tasklab-client.js).
 *
 * The wrapper's whole reason for existing is "resilience over restart": if the
 * app is up before the service, calls must fail fast with UNAVAILABLE *and* the
 * cached channel must be dropped so a later call connects to a service that has
 * since started — no app restart. That path had no coverage; this file pins it.
 *
 * A known port must be reserved BEFORE the client config is loaded, because the
 * wrapper resolves its dial target from env at require time.
 */
const TMP_DB = path.join(os.tmpdir(), `tasklab-client-test-${process.pid}.json`);

let client;
let startService;
let server;

beforeAll(async () => {
  const port = await reservePort();
  process.env.TASKLAB_DB_PATH = TMP_DB;
  process.env.TASKLAB_GRPC_PORT = String(port);
  process.env.TASKLAB_GRPC_TARGET = `localhost:${port}`;
  process.env.TASKLAB_LOG = "silent";

  // Require AFTER env is set so config picks up the reserved port/target.
  client = require("../modules/tasklab/tasklab-client.js");
  startService = require("../external-services/tasklab/tasklab-server/index.js").start;
});

afterAll(() => {
  if (client) client._reset();
  if (server) server.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("tasklab client wrapper — resilience over restart", () => {
  it("fails fast with UNAVAILABLE when the service is down", async () => {
    await expect(client.listStatuses("user-x")).rejects.toMatchObject({
      code: grpc.status.UNAVAILABLE,
    });
  });

  it("recovers on the next call once the service comes up — no restart", async () => {
    // The prior failure dropped the cached channel; starting the service and
    // calling again must rebuild the channel and connect immediately.
    const started = await startService();
    server = started.server;

    const res = await client.listStatuses("user-x");
    expect(res.statuses.map((s) => s.id)).toContain("open");
  });

  it("attaches caller identity as metadata (round-trips a created task)", async () => {
    const created = await client.createTask("user-x", { title: "via wrapper" });
    expect(created.id).toBeTruthy();

    const mine = await client.listTasks("user-x", {});
    expect(mine.tasks.find((t) => t.id === created.id)).toBeTruthy();

    // A different identity must not see it (metadata is actually being sent).
    const other = await client.listTasks("user-y", {});
    expect(other.tasks.find((t) => t.id === created.id)).toBeFalsy();
  });

  it("rejects a call with no identity as INVALID_ARGUMENT", async () => {
    await expect(client.listTasks("", {})).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });
});
