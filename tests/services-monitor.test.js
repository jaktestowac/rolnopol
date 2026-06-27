import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DBs + fixed test ports BEFORE requiring the app, clients, or services.
const GH_DB = path.join(os.tmpdir(), `svc-monitor-gh-${process.pid}.json`);
const TL_DB = path.join(os.tmpdir(), `svc-monitor-tl-${process.pid}.json`);
process.env.GREENHOUSE_DB_PATH = GH_DB;
process.env.GREENHOUSE_GRPC_PORT = "50081";
process.env.GREENHOUSE_GRPC_TARGET = "localhost:50081";
process.env.TASKLAB_DB_PATH = TL_DB;
process.env.TASKLAB_GRPC_PORT = "50082";
process.env.TASKLAB_GRPC_TARGET = "localhost:50082";

const app = require("../api/index.js");
const greenhouseServer = require("../grpc/greenhouse-server/index.js");
const tasklabServer = require("../grpc/tasklab-server/index.js");
const greenhouseClient = require("../modules/greenhouse/greenhouse-client.js");
const tasklabClient = require("../modules/tasklab/tasklab-client.js");

function getServices(body) {
  return body?.data?.services || [];
}

afterAll(() => {
  greenhouseClient._reset();
  tasklabClient._reset();
  for (const db of [GH_DB, TL_DB]) {
    try {
      fs.unlinkSync(db);
    } catch {
      /* ignore */
    }
  }
});

describe("service monitor — services down", () => {
  it("reports both services offline when nothing is running", async () => {
    const res = await request(app).get("/api/v1/services/status").expect(200);
    const services = getServices(res.body);
    expect(services.map((s) => s.key).sort()).toEqual(["greenhouse", "tasklab"]);
    for (const svc of services) {
      expect(svc.status).toBe("offline");
      expect(svc.health).toBeNull();
      expect(typeof svc.error).toBe("string");
      expect(svc.target).toMatch(/:\d+$/);
      expect(svc.transport).toBe("gRPC");
    }
  });
});

describe("service monitor — services up", () => {
  let ghHandle;
  let tlHandle;

  beforeAll(async () => {
    ghHandle = await greenhouseServer.start();
    tlHandle = await tasklabServer.start();
    greenhouseClient._reset();
    tasklabClient._reset();
  });

  afterAll(() => {
    if (ghHandle?.server) ghHandle.server.forceShutdown();
    if (tlHandle?.server) tlHandle.server.forceShutdown();
  });

  it("reports both services online with health details", async () => {
    const res = await request(app).get("/api/v1/services/status").expect(200);
    const byKey = Object.fromEntries(getServices(res.body).map((s) => [s.key, s]));

    expect(byKey.greenhouse.status).toBe("online");
    expect(byKey.greenhouse.health.status).toBe("SERVING");
    expect(byKey.greenhouse.health.crop_count).toBeGreaterThan(0);

    expect(byKey.tasklab.status).toBe("online");
    expect(byKey.tasklab.health.status).toBe("SERVING");
    expect(byKey.tasklab.health.status_count).toBeGreaterThan(0);
  });
});
