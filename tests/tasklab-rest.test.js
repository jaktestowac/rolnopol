import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + fixed test port BEFORE requiring the app, client, or service.
const TMP_DB = path.join(os.tmpdir(), `tasklab-rest-test-${process.pid}.json`);
process.env.TASKLAB_DB_PATH = TMP_DB;
process.env.TASKLAB_GRPC_PORT = "50073";
process.env.TASKLAB_GRPC_TARGET = "localhost:50073";
process.env.TASKLAB_LOG = "silent";

const app = require("../api/index.js");
const { start } = require("../grpc/tasklab-server/index.js");
const tasklabClient = require("../modules/tasklab/tasklab-client.js");
const tokenHelpers = require("../helpers/token.helpers.js");

const FLAG = "taskLabEnabled";

async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}
async function setFlag(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}

let originalFlags;
let userToken;

beforeAll(async () => {
  originalFlags = await getFlags();
  userToken = tokenHelpers.generateToken("user-tl-rest");
});

afterAll(async () => {
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  tasklabClient._reset();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("tasklab REST — feature flag gating", () => {
  it("returns 404 when the flag is off", async () => {
    await setFlag(false);
    await request(app).get("/api/v1/tasklab/tasks").set("token", userToken).expect(404);
  });
});

describe("tasklab REST — flag on, auth required", () => {
  beforeAll(async () => {
    await setFlag(true);
  });

  it("returns 401 with no session", async () => {
    await request(app).get("/api/v1/tasklab/tasks").expect(401);
  });

  it("returns 503 when the tasklab service is down", async () => {
    const res = await request(app).get("/api/v1/tasklab/tasks").set("token", userToken).expect(503);
    expect(res.body.error).toMatch(/offline/i);
  });
});

describe("tasklab REST — flag on, service up", () => {
  let server;

  beforeAll(async () => {
    await setFlag(true);
    ({ server } = await start());
    tasklabClient._reset(); // force reconnect to the freshly started service
  });

  afterAll(() => {
    if (server) server.forceShutdown();
  });

  it("lists the status catalog", async () => {
    const res = await request(app).get("/api/v1/tasklab/statuses").set("token", userToken).expect(200);
    expect(res.body.data.statuses.map((s) => s.id)).toEqual(["open", "in_progress", "blocked", "done"]);
  });

  it("creates a task (201), lists it, sets status, archives it", async () => {
    const created = await request(app)
      .post("/api/v1/tasklab/tasks")
      .set("token", userToken)
      .send({ title: "REST task", content: "via supertest" })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data.status).toBe("open");

    const listed = await request(app).get("/api/v1/tasklab/tasks").set("token", userToken).expect(200);
    expect(listed.body.data.tasks.find((t) => t.id === id)).toBeTruthy();

    await request(app)
      .patch(`/api/v1/tasklab/tasks/${id}/status`)
      .set("token", userToken)
      .send({ status: "done" })
      .expect(200);

    const done = await request(app).get("/api/v1/tasklab/tasks?status=done").set("token", userToken).expect(200);
    expect(done.body.data.tasks.find((t) => t.id === id)).toBeTruthy();

    await request(app).post(`/api/v1/tasklab/tasks/${id}/archive`).set("token", userToken).expect(200);

    const active = await request(app).get("/api/v1/tasklab/tasks").set("token", userToken).expect(200);
    expect(active.body.data.tasks.find((t) => t.id === id)).toBeFalsy();

    const withArchived = await request(app)
      .get("/api/v1/tasklab/tasks?includeArchived=true")
      .set("token", userToken)
      .expect(200);
    expect(withArchived.body.data.tasks.find((t) => t.id === id)).toBeTruthy();
  });

  it("rejects an empty title with 400 (INVALID_ARGUMENT)", async () => {
    await request(app).post("/api/v1/tasklab/tasks").set("token", userToken).send({ title: "  " }).expect(400);
  });

  it("returns 404 for setting status on a missing task", async () => {
    await request(app)
      .patch("/api/v1/tasklab/tasks/task-9999/status")
      .set("token", userToken)
      .send({ status: "done" })
      .expect(404);
  });

  it("isolates tasks per user", async () => {
    const otherToken = tokenHelpers.generateToken("user-tl-other");
    await request(app)
      .post("/api/v1/tasklab/tasks")
      .set("token", userToken)
      .send({ title: "only mine" })
      .expect(201);
    const other = await request(app).get("/api/v1/tasklab/tasks").set("token", otherToken).expect(200);
    expect(other.body.data.tasks.find((t) => t.title === "only mine")).toBeFalsy();
  });
});
