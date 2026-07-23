import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Bridge → exam-center (taker) + authoring (admin). Gateway ports must be known
// before the app-side clients are required.
const EC_PORT = 4461;
const AU_PORT = 4462;
const CI_PORT = 4463;
const EC_DB = path.join(os.tmpdir(), `aa-ec-rest-${process.pid}.json`);
const AU_DB = path.join(os.tmpdir(), `aa-au-rest-${process.pid}.json`);
const QB_DB = path.join(os.tmpdir(), `aa-qb-rest-${process.pid}.json`);
const CI_DB = path.join(os.tmpdir(), `aa-ci-rest-${process.pid}.json`);

process.env.AGRI_ACADEMY_TARGET = `http://localhost:${EC_PORT}`;
process.env.AGRI_ACADEMY_AUTHORING_TARGET = `http://localhost:${AU_PORT}`;
process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS = "2000";
process.env.AUTHORING_TARGET = `http://localhost:${AU_PORT}`; // exam-center → authoring
process.env.CERTIFICATE_ISSUER_TARGET = `http://localhost:${CI_PORT}`; // exam-center → issuer
process.env.EXAM_CENTER_DB_PATH = EC_DB;
process.env.AUTHORING_DB_PATH = AU_DB;
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.CERTIFICATES_DB_PATH = CI_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.GRADING_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const ROOT = path.join(__dirname, "..", "external-services", "agri-academy");

const FLAG = "agriAcademyEnabled";
const USER = "user-aa-rest";
let token;
let originalFlags;

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
function listen(appToServe, port) {
  return new Promise((resolve) => {
    const server = appToServe.listen(port, "127.0.0.1", () => resolve(server));
  });
}

beforeAll(async () => {
  originalFlags = await getFlags();
  token = tokenHelpers.generateToken(USER);
});

afterAll(async () => {
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  for (const f of [EC_DB, AU_DB, QB_DB, CI_DB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("agri-academy REST bridge — gating", () => {
  it("404 when the flag is off", async () => {
    await setFlag(false);
    await request(app).get("/api/v1/agri-academy/exams").set("token", token).expect(404);
  });
  it("401 with no session (flag on)", async () => {
    await setFlag(true);
    await request(app).get("/api/v1/agri-academy/exams").expect(401);
  });
});

describe("agri-academy REST bridge — gateways offline", () => {
  it("503 when the exam center is not running", async () => {
    await setFlag(true);
    const res = await request(app).get("/api/v1/agri-academy/exams").set("token", token).expect(503);
    expect(res.body.error).toBe("AGRI_ACADEMY_OFFLINE");
  });
});

describe("agri-academy REST bridge — full ecosystem up", () => {
  let bank;
  let grader;
  let authServer;
  let ecServer;
  let certServer;

  beforeAll(async () => {
    // Leaves + authoring first, then the exam center (so it can dial them).
    const { start } = require(path.join(ROOT, "question-bank-service", "server", "index.js"));
    const started = await start();
    bank = started.server;
    process.env.QUESTION_BANK_GRPC_TARGET = `localhost:${started.port}`;

    const gr = await require(path.join(ROOT, "grading-service", "server", "index.js")).start();
    grader = gr.server;
    process.env.GRADING_GRPC_TARGET = `localhost:${gr.port}`;

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
  });

  it("serves the public unit directory + profile UNAUTHENTICATED", async () => {
    const dir = await request(app).get("/api/v1/agri-academy/units").expect(200);
    expect(dir.body.units.find((u) => u.unitId === "unit-demo")).toBeTruthy();
    const profile = await request(app).get("/api/v1/agri-academy/units/unit-demo").expect(200);
    expect(profile.body.exams.length).toBe(3);
  });

  it("serves anonymized leaderboards UNAUTHENTICATED", async () => {
    const res = await request(app).get("/api/v1/agri-academy/leaderboard").expect(200);
    expect(Array.isArray(res.body.units)).toBe(true);
    expect(Array.isArray(res.body.learners)).toBe(true);
    expect(Array.isArray(res.body.exams)).toBe(true);
    expect(res.body.totals).toBeTruthy();
    // Learner rows are anonymized to "<FirstName> *" and never leak a raw userId.
    for (const l of res.body.learners) {
      expect(l.alias).toMatch(/ \*$/);
      expect(l.userId).toBeUndefined();
    }
  });

  it("proxies the published catalog (200) and never leaks keys", async () => {
    const res = await request(app).get("/api/v1/agri-academy/exams").set("token", token).expect(200);
    expect(res.body.exams.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toContain("correct");
  });

  it("author → publish → take → submit → pass, end to end over both bridges", async () => {
    // Authoring plane (admin bridge)
    const unit = await request(app)
      .post("/api/v1/agri-academy/units")
      .set("token", token)
      .send({ name: "REST Unit", description: "e2e" })
      .expect(201);
    const unitId = unit.body.unitId;
    const exam = await request(app)
      .post("/api/v1/agri-academy/exams")
      .set("token", token)
      .send({
        title: "REST Exam",
        description: "d",
        durationSec: 900,
        accessWindowDays: 3,
        passPct: 60,
        attemptsAllowed: 2,
        certValidMonths: 12,
        questionCount: 2,
        pricing: { mode: "free" },
      })
      .expect(201);
    const examId = exam.body.id;
    await request(app)
      .post(`/api/v1/agri-academy/exams/${examId}/questions`)
      .set("token", token)
      .send({
        id: "q1",
        type: "single",
        text: "Q1",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/agri-academy/exams/${examId}/questions`)
      .set("token", token)
      .send({
        id: "q2",
        type: "multi",
        text: "Q2",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
        ],
        correct: ["a", "c"],
      })
      .expect(201);
    const pub = await request(app).post(`/api/v1/agri-academy/exams/${examId}/publish`).set("token", token).expect(200);
    expect(pub.body.status).toBe("published");

    const mine = await request(app).get("/api/v1/agri-academy/exams/mine").set("token", token).expect(200);
    expect(mine.body.exams.map((e) => e.id)).toContain(examId);

    // Taker plane (taker bridge)
    const created = await request(app).post("/api/v1/agri-academy/sessions").set("token", token).send({ examId }).expect(201);
    expect(created.body.state).toBe("entitled");
    const sid = created.body.sessionId;

    const started = await request(app).post(`/api/v1/agri-academy/sessions/${sid}/start`).set("token", token).expect(200);
    expect(started.body.state).toBe("active");
    expect(started.body.questions).toHaveLength(2);
    expect(JSON.stringify(started.body)).not.toContain("correct");

    const answers = { q1: ["a"], q2: ["a", "c"] };
    for (const q of started.body.questions) {
      await request(app)
        .put(`/api/v1/agri-academy/sessions/${sid}/answers/${q.id}`)
        .set("token", token)
        .send({ answer: answers[q.id] })
        .expect(200);
    }
    const submitted = await request(app).post(`/api/v1/agri-academy/sessions/${sid}/submit`).set("token", token).expect(200);
    expect(submitted.body.state).toBe("scored");
    expect(submitted.body.result.passed).toBe(true);
    expect(submitted.body.result.scorePct).toBe(100);

    // "My exams" tab source: the caller's own sessions, with the exam title.
    const mySessions = await request(app).get("/api/v1/agri-academy/sessions").set("token", token).expect(200);
    const row = mySessions.body.sessions.find((s) => s.sessionId === sid);
    expect(row).toBeTruthy();
    expect(row.examTitle).toBe("REST Exam");
    expect(row.state).toBe("scored");
    expect(row.rating).toBe(null); // not yet rated

    // Rate the passed exam 1–5 stars (idempotent). Out-of-range is rejected; the
    // value round-trips onto the "My exams" session view.
    await request(app).post(`/api/v1/agri-academy/sessions/${sid}/rating`).set("token", token).send({ stars: 9 }).expect(400);
    const rated = await request(app).post(`/api/v1/agri-academy/sessions/${sid}/rating`).set("token", token).send({ stars: 4 }).expect(200);
    expect(rated.body.rating).toBe(4);
    const afterRate = await request(app).get("/api/v1/agri-academy/sessions").set("token", token).expect(200);
    expect(afterRate.body.sessions.find((s) => s.sessionId === sid).rating).toBe(4);

    // The rating overlays onto the public unit profile: the exam card carries its
    // own rating, and the unit's rating is the average across its exams.
    const ratedProfile = await request(app).get(`/api/v1/agri-academy/units/${unitId}`).expect(200);
    expect(ratedProfile.body.rating).toBe(4);
    expect(ratedProfile.body.ratings).toBe(1);
    const ratedExam = ratedProfile.body.exams.find((e) => e.id === examId);
    expect(ratedExam.rating).toBe(4);
    expect(ratedExam.ratings).toBe(1);

    // Owner-only unit analytics (with ROL income overlaid by the bridge).
    const stats = await request(app).get(`/api/v1/agri-academy/units/${unitId}/analytics`).set("token", token).expect(200);
    expect(stats.body.unit.unitId).toBe(unitId);
    expect(stats.body.enrollments).toBeGreaterThanOrEqual(1);
    expect(stats.body.certificates).toBeGreaterThanOrEqual(1);
    expect(stats.body.income).toBeTruthy();
    expect(stats.body.income.currency).toBe("ROL");
    // A different user is not the owner of this unit → 403.
    const otherToken = tokenHelpers.generateToken("user-aa-rest-other");
    await request(app).get(`/api/v1/agri-academy/units/${unitId}/analytics`).set("token", otherToken).expect(403);
  });

  it("aggregate health proxies through the bridge (all five up)", async () => {
    const res = await request(app).get("/api/v1/agri-academy/health").set("token", token).expect(200);
    expect(res.body.overall).toBe("SERVING");
    expect(res.body.services).toHaveLength(5);
  });

  it("mints a certificate on the e2e pass and lists it", async () => {
    const certs = await request(app).get("/api/v1/agri-academy/certificates").set("token", token).expect(200);
    expect(certs.body.certificates.length).toBeGreaterThanOrEqual(1);
    const certNo = certs.body.certificates[0].certNo;
    // Public verify is UNAUTHENTICATED.
    const verify = await request(app).get(`/api/v1/agri-academy/verify/${certNo}`).expect(200);
    expect(verify.body.status).toBe("valid");
  });

  it("a disabled exam — and every exam of a disabled unit — cannot be enrolled or seen in the catalog", async () => {
    const ownerToken = tokenHelpers.generateToken("aa-toggle-owner");
    const takerToken = tokenHelpers.generateToken("aa-toggle-taker");
    const admin = (method, p) => request(app)[method](`/api/v1/agri-academy${p}`).set("token", ownerToken);

    const unit = await admin("post", "/units").send({ name: "Toggle Unit", description: "e2e gating" }).expect(201);
    const unitId = unit.body.unitId;
    const exam = await admin("post", "/exams")
      .send({ title: "Toggle Exam", durationSec: 300, accessWindowDays: 3, passPct: 50, attemptsAllowed: 2, certValidMonths: 12, questionCount: 1, pricing: { mode: "free" } })
      .expect(201);
    const examId = exam.body.id;
    await admin("post", `/exams/${examId}/questions`)
      .send({ id: "q1", type: "single", text: "Q1", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"] })
      .expect(201);
    await admin("post", `/exams/${examId}/publish`).expect(200);

    const enroll = (p = "") => request(app).post(`/api/v1/agri-academy/sessions${p}`).set("token", takerToken).send({ examId });
    const inCatalog = async () => {
      const r = await request(app).get("/api/v1/agri-academy/exams").set("token", takerToken).expect(200);
      return r.body.exams.some((e) => e.id === examId);
    };

    // Published + enabled → takeable.
    expect(await inCatalog()).toBe(true);

    // Disable the exam → gone from the catalog, enrollment blocked.
    await admin("post", `/exams/${examId}/disable`).expect(200);
    expect(await inCatalog()).toBe(false);
    const blocked = await enroll().expect(404);
    expect(blocked.body.error).toBe("EXAM_NOT_FOUND");

    // Re-enable the exam → takeable again.
    await admin("post", `/exams/${examId}/enable`).expect(200);
    expect(await inCatalog()).toBe(true);
    await enroll().expect(201);

    // Disable the whole UNIT → its (still-enabled, still-published) exam is untakeable.
    await admin("post", "/units/me/disable").expect(200);
    expect(await inCatalog()).toBe(false);
    // A brand-new taker who never enrolled cannot enroll while the unit is disabled.
    const freshTaker = tokenHelpers.generateToken("aa-toggle-taker-2");
    const blocked2 = await request(app).post("/api/v1/agri-academy/sessions").set("token", freshTaker).send({ examId }).expect(404);
    expect(blocked2.body.error).toBe("EXAM_NOT_FOUND");
    // Hidden from the public unit directory too.
    await request(app).get(`/api/v1/agri-academy/units/${unitId}`).expect(404);

    // Re-enable the unit → catalog restored.
    await admin("post", "/units/me/enable").expect(200);
    expect(await inCatalog()).toBe(true);
  });
});
