import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Aggregate health across the six services, proxied through the Rolnopol bridge:
// all up → SERVING (200); kill one → DEGRADED (503) with that service UNREACHABLE
// and all six still listed.
const EC_PORT = 4481;
const AU_PORT = 4482;
const CI_PORT = 4483;
const EC_DB = path.join(os.tmpdir(), `aa-ec-health-${process.pid}.json`);
const AU_DB = path.join(os.tmpdir(), `aa-au-health-${process.pid}.json`);
const QB_DB = path.join(os.tmpdir(), `aa-qb-health-${process.pid}.json`);
const CI_DB = path.join(os.tmpdir(), `aa-ci-health-${process.pid}.json`);
const EE_DB = path.join(os.tmpdir(), `aa-ee-health-${process.pid}.json`);

process.env.AGRI_ACADEMY_TARGET = `http://localhost:${EC_PORT}`;
process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS = "2000";
process.env.AUTHORING_TARGET = `http://localhost:${AU_PORT}`;
process.env.CERTIFICATE_ISSUER_TARGET = `http://localhost:${CI_PORT}`;
process.env.EXAM_CENTER_DB_PATH = EC_DB;
process.env.AUTHORING_DB_PATH = AU_DB;
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.CERTIFICATES_DB_PATH = CI_DB;
process.env.EXAM_EVENTS_DB_PATH = EE_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.GRADING_GRPC_PORT = "0";
process.env.EXAM_EVENTS_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";
// Probe cadence for the streamed aggregate, turned down so a few cycles pass quickly.
process.env.EXAM_CENTER_HEALTH_STREAM_MS = "25";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const { openStream } = require("./helpers/stream-http");
const ROOT = path.join(__dirname, "..", "external-services", "agri-academy");

const FLAG = "agriAcademyEnabled";
const token = tokenHelpers.generateToken("aa-health-user");
let originalFlags;

async function setFlag(enabled) {
  await request(app)
    .patch("/api/v1/feature-flags")
    .send({ flags: { [FLAG]: enabled } })
    .expect(200);
}
async function getFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}
function listen(a, port) {
  return new Promise((resolve) => {
    const server = a.listen(port, "127.0.0.1", () => resolve(server));
  });
}

let bank;
let grader;
let examEvents;
let certServer;
let authServer;
let ecServer;

beforeAll(async () => {
  originalFlags = await getFlags();

  const started = await require(path.join(ROOT, "question-bank-service", "server", "index.js")).start();
  bank = started.server;
  process.env.QUESTION_BANK_GRPC_TARGET = `localhost:${started.port}`;

  const gr = await require(path.join(ROOT, "grading-service", "server", "index.js")).start();
  grader = gr.server;
  process.env.GRADING_GRPC_TARGET = `localhost:${gr.port}`;

  const ee = await require(path.join(ROOT, "exam-events-service", "server", "index.js")).start();
  examEvents = ee.server;
  process.env.EXAM_EVENTS_TARGET = `localhost:${ee.port}`;

  const cdb = require(path.join(ROOT, "certificate-issuer-service", "server", "db.js"));
  await cdb.init();
  certServer = await listen(require(path.join(ROOT, "certificate-issuer-service", "server", "index.js")).buildApp(), CI_PORT);

  const adb = require(path.join(ROOT, "authoring-service", "server", "db.js"));
  await adb.init();
  authServer = await listen(require(path.join(ROOT, "authoring-service", "server", "index.js")).buildApp(), AU_PORT);

  const edb = require(path.join(ROOT, "exam-center-service", "server", "db.js"));
  await edb.init();
  ecServer = await listen(require(path.join(ROOT, "exam-center-service", "server", "index.js")).buildApp(), EC_PORT);

  await setFlag(true);
});

afterAll(async () => {
  if (ecServer) await new Promise((r) => ecServer.close(r));
  if (authServer) await new Promise((r) => authServer.close(r));
  if (certServer) await new Promise((r) => certServer.close(r));
  if (bank) bank.forceShutdown();
  if (grader) grader.forceShutdown();
  if (examEvents) examEvents.forceShutdown();
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  for (const f of [EC_DB, AU_DB, QB_DB, CI_DB, EE_DB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("agri-academy aggregate health (through the bridge)", () => {
  it("reports SERVING (200) with all six services up", async () => {
    const res = await request(app).get("/api/v1/agri-academy/health").set("token", token).expect(200);
    expect(res.body.overall).toBe("SERVING");
    const names = res.body.services.map((s) => s.name).sort();
    expect(names).toEqual(["authoring", "certificate-issuer", "exam-center", "exam-events", "grading", "question-bank"]);
  });

  it("exposes the same aggregate at the PUBLIC /status surface WITHOUT a token", async () => {
    // The status page is viewable without logging in, so /status must not require auth.
    const res = await request(app).get("/api/v1/agri-academy/status").expect(200);
    expect(res.body.overall).toBe("SERVING");
    expect(res.body.services).toHaveLength(6);
    // The authenticated /health, by contrast, still rejects an anonymous caller.
    await request(app).get("/api/v1/agri-academy/health").expect(401);
  });

  it("streams the aggregate over SSE, and an OPEN stream reports a service dying", async () => {
    // What the Service status button is built on: nothing polls, and the moment a
    // service stops answering the already-open stream says so.
    const server = await listen(app, 0);
    try {
      const s = await openStream({ port: server.address().port, path: "/api/v1/agri-academy/status/stream" });
      expect(s.status).toBe(200);
      expect(s.headers["content-type"]).toBe("text/event-stream");
      expect(s.headers["content-length"]).toBeUndefined(); // chunked, not a buffered body
      expect((await s.nextBlock()).retry).toBeGreaterThanOrEqual(1000);

      const first = await s.nextEvent();
      expect(first.event).toBe("status");
      expect(first.json.overall).toBe("SERVING");
      expect(first.json.services).toHaveLength(6);
      expect(first.json.changed).toBe(true); // the first reading is new to this reader

      // Kill the grader while the stream is open. No new request is made.
      grader.forceShutdown();
      grader = null;

      let frame = await s.nextEvent();
      while (frame.json.overall === "SERVING") frame = await s.nextEvent();
      expect(frame.json.overall).toBe("DEGRADED");
      expect(frame.json.changed).toBe(true); // …so a consumer can restyle exactly once
      expect(frame.json.services.find((x) => x.name === "grading").status).toBe("UNREACHABLE");
      expect(frame.json.services).toHaveLength(6); // every service is always listed
      expect(s.ended).toBe(false); // and the stream keeps reporting
      s.close();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("404s the status stream when the feature flag is off", async () => {
    await setFlag(false);
    try {
      await request(app).get("/api/v1/agri-academy/status/stream").expect(404);
    } finally {
      await setFlag(true);
    }
  });

  it("reports DEGRADED (503) with the killed service UNREACHABLE (all six still listed)", async () => {
    await new Promise((r) => certServer.close(r));
    certServer = null;

    const res = await request(app).get("/api/v1/agri-academy/health").set("token", token).expect(503);
    expect(res.body.overall).toBe("DEGRADED");
    expect(res.body.services).toHaveLength(6);
    expect(res.body.services.find((s) => s.name === "certificate-issuer").status).toBe("UNREACHABLE");

    // …and the public /status reflects the degradation too (still 503, still all six).
    const pub = await request(app).get("/api/v1/agri-academy/status").expect(503);
    expect(pub.body.overall).toBe("DEGRADED");
    expect(pub.body.services).toHaveLength(6);
  });

  it("an unreachable exam-events leaf is UNREACHABLE, never a throw — the clock is advisory", async () => {
    // The newest leaf gets the same treatment as every other: killing it degrades
    // the aggregate and costs the taker a live countdown, nothing more.
    examEvents.forceShutdown();
    examEvents = null;

    const res = await request(app).get("/api/v1/agri-academy/health").set("token", token).expect(503);
    expect(res.body.services).toHaveLength(6);
    expect(res.body.services.find((s) => s.name === "exam-events").status).toBe("UNREACHABLE");
  });
});
