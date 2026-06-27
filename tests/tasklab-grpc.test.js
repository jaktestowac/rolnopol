import { describe, it, expect, beforeAll, afterAll } from "vitest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + ephemeral port BEFORE requiring the service.
const TMP_DB = path.join(os.tmpdir(), `tasklab-grpc-test-${process.pid}.json`);
process.env.TASKLAB_DB_PATH = TMP_DB;
process.env.TASKLAB_GRPC_PORT = "0";
process.env.TASKLAB_LOG = "silent";

const { grpc, loadPackage, callUnary } = require("./helpers/grpc-harness");
const { PROTO_PATH, PROTO_LOADER_OPTIONS } = require("../grpc/tasklab-config.js");
const { start } = require("../grpc/tasklab-server/index.js");

let server;
let healthClient;
let taskClient;

// Thin wrapper: attach the caller identity as tl-user-id metadata.
function call(method, request = {}, userId = "user-grpc") {
  return callUnary(taskClient, method, request, { metadata: { "tl-user-id": userId } });
}

beforeAll(async () => {
  const started = await start();
  server = started.server;
  const target = `localhost:${started.port}`;
  const proto = loadPackage(PROTO_PATH, PROTO_LOADER_OPTIONS, "tasklab");
  healthClient = new proto.Health(target, grpc.credentials.createInsecure());
  taskClient = new proto.TaskControl(target, grpc.credentials.createInsecure());
});

afterAll(() => {
  if (server) server.forceShutdown();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("tasklab gRPC — Health", () => {
  it("Check reports SERVING", async () => {
    const reply = await callUnary(healthClient, "Check", {});
    expect(reply.status).toBe("SERVING");
    expect(reply.status_count).toBe(4);
  });
});

describe("tasklab gRPC — TaskControl", () => {
  it("ListStatuses returns the catalog and limits", async () => {
    const res = await call("ListStatuses", {});
    expect(res.statuses.map((s) => s.id)).toEqual(["open", "in_progress", "blocked", "done"]);
    expect(res.max_title_length).toBe(120);
  });

  it("CreateTask → SetStatus → ListTasks → Archive", async () => {
    const created = await call("CreateTask", { title: "gRPC task", content: "from the test" });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("open");

    const moved = await call("SetStatus", { id: created.id, status: "in_progress" });
    expect(moved.status).toBe("in_progress");

    const list = await call("ListTasks", { status: "", query: "", include_archived: false });
    expect(list.tasks.find((t) => t.id === created.id)).toBeTruthy();

    const archived = await call("Archive", { id: created.id });
    expect(archived.archived).toBe(true);

    const activeOnly = await call("ListTasks", { status: "", query: "", include_archived: false });
    expect(activeOnly.tasks.find((t) => t.id === created.id)).toBeFalsy();
  });

  it("Archive → Restore brings a task back into the active list", async () => {
    const created = await call("CreateTask", { title: "round-trip task" });
    await call("Archive", { id: created.id });

    const restored = await call("Restore", { id: created.id });
    expect(restored.archived).toBe(false);

    const active = await call("ListTasks", { status: "", query: "", include_archived: false });
    expect(active.tasks.find((t) => t.id === created.id)).toBeTruthy();
  });

  it("maps an empty title to INVALID_ARGUMENT", async () => {
    await expect(call("CreateTask", { title: "", content: "" })).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });

  it("maps a missing task to NOT_FOUND", async () => {
    await expect(call("SetStatus", { id: "task-9999", status: "done" })).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });

  it("maps a missing user identity to INVALID_ARGUMENT", async () => {
    await expect(call("ListTasks", {}, "")).rejects.toMatchObject({
      code: grpc.status.INVALID_ARGUMENT,
    });
  });

  it("isolates tasks per caller identity", async () => {
    await call("CreateTask", { title: "alice task" }, "alice");
    const bob = await call("ListTasks", { include_archived: true }, "bob");
    expect(bob.tasks).toHaveLength(0);
  });
});
