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
const EE_DB = path.join(os.tmpdir(), `aa-ee-rest-${process.pid}.json`);

process.env.AGRI_ACADEMY_TARGET = `http://localhost:${EC_PORT}`;
process.env.AGRI_ACADEMY_AUTHORING_TARGET = `http://localhost:${AU_PORT}`;
process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS = "2000";
process.env.AUTHORING_TARGET = `http://localhost:${AU_PORT}`; // exam-center → authoring
process.env.CERTIFICATE_ISSUER_TARGET = `http://localhost:${CI_PORT}`; // exam-center → issuer
process.env.EXAM_CENTER_DB_PATH = EC_DB;
process.env.AUTHORING_DB_PATH = AU_DB;
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.CERTIFICATES_DB_PATH = CI_DB;
process.env.EXAM_EVENTS_DB_PATH = EE_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.GRADING_GRPC_PORT = "0";
process.env.EXAM_EVENTS_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const { openStream, waitUntil } = require("./helpers/stream-http");
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
  for (const f of [EC_DB, AU_DB, QB_DB, CI_DB, EE_DB]) {
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

  it("the SSE routes 503 with the SAME error shape — never a half-open stream", async () => {
    // What a page keys its degradation off: a dead gateway answers a JSON error
    // promptly, so a subscriber can fall back instead of holding an empty connection.
    // The body carries NO `services`, which is why a status surface must render that
    // shape as an outage rather than as "unknown" — the exam center is one of the six.
    await setFlag(true);
    for (const path of ["/api/v1/agri-academy/status/stream", "/api/v1/agri-academy/events/stream"]) {
      const res = await request(app).get(path).expect(503);
      expect(res.body.error).toBe("AGRI_ACADEMY_OFFLINE");
      expect(res.body.services).toBeUndefined();
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
  });
});

describe("agri-academy REST bridge — full ecosystem up", () => {
  let bank;
  let grader;
  let examEvents;
  let authServer;
  let ecServer;
  let certServer;
  let eeInternals;

  beforeAll(async () => {
    // Leaves + authoring first, then the exam center (so it can dial them).
    const { start } = require(path.join(ROOT, "question-bank-service", "server", "index.js"));
    const started = await start();
    bank = started.server;
    process.env.QUESTION_BANK_GRPC_TARGET = `localhost:${started.port}`;

    const gr = await require(path.join(ROOT, "grading-service", "server", "index.js")).start();
    grader = gr.server;
    process.env.GRADING_GRPC_TARGET = `localhost:${gr.port}`;

    const ee = await require(path.join(ROOT, "exam-events-service", "server", "index.js")).start();
    examEvents = ee.server;
    process.env.EXAM_EVENTS_TARGET = `localhost:${ee.port}`;
    eeInternals = require(path.join(ROOT, "exam-events-service", "server", "handlers.js"))._internals;

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

  it("serves the exam-events activity log UNAUTHENTICATED, per-unit and across all units", async () => {
    // Enroll + start so the exam center actually feeds the leaf, then read the log
    // back through the bridge exactly as the two pages do.
    const actor = tokenHelpers.generateToken("user-aa-events");
    const created = await request(app)
      .post("/api/v1/agri-academy/sessions")
      .set("token", actor)
      .send({ examId: "pesticide-basics" })
      .expect(201);
    const sid = created.body.sessionId;
    await request(app).post(`/api/v1/agri-academy/sessions/${sid}/start`).set("token", actor).expect(200);

    // Per-unit — no token, because an entry names a session, never a taker.
    const unitLog = await request(app).get("/api/v1/agri-academy/units/unit-demo/events").expect(200);
    expect(unitLog.body.total).toBeGreaterThanOrEqual(2); // entitled → active
    expect(unitLog.body.events.every((e) => e.unitId === "unit-demo")).toBe(true);
    const mine = unitLog.body.events.filter((e) => e.sessionId === sid);
    expect(mine.map((e) => e.state)).toContain("active");
    // Newest first, and the ids are resolved to readable labels by the gateway.
    expect(unitLog.body.events[0].sequence).toBeGreaterThanOrEqual(unitLog.body.events[unitLog.body.events.length - 1].sequence);
    expect(mine.find((e) => e.state === "active").examTitle).toBeTruthy();
    expect(mine.find((e) => e.state === "active").window).toBe("completion");
    // No taker identity anywhere in the payload — the property the public surface rests on.
    expect(JSON.stringify(unitLog.body)).not.toContain("user-aa-events");

    // All units.
    const allLog = await request(app).get("/api/v1/agri-academy/events?limit=100").expect(200);
    expect(allLog.body.events.some((e) => e.sessionId === sid)).toBe(true);
    expect(allLog.body.total).toBeGreaterThanOrEqual(unitLog.body.total);

    // Filters and paging pass through to the leaf.
    const one = await request(app).get("/api/v1/agri-academy/events?limit=1").expect(200);
    expect(one.body.events).toHaveLength(1);
    expect(one.body.total).toBeGreaterThan(1);
    const byUnit = await request(app).get("/api/v1/agri-academy/events?unitId=unit-demo&examId=pesticide-basics").expect(200);
    expect(byUnit.body.events.every((e) => e.examId === "pesticide-basics")).toBe(true);
    // `since` is a poll cursor: nothing is newer than the high-water mark.
    const caughtUp = await request(app).get(`/api/v1/agri-academy/events?since=${allLog.body.latestSequence}`).expect(200);
    expect(caughtUp.body.events).toEqual([]);

    // A unit with no public profile 404s rather than exposing its log.
    await request(app).get("/api/v1/agri-academy/units/no-such-unit/events").expect(404);
  });

  it("pages BACKWARDS through the activity log with `before`, and reports whether history remains", async () => {
    // Scroll-back's contract, end to end: browser → proxy → exam center → leaf. Enough
    // entries first that a two-at-a-time walk takes several pages.
    for (const who of ["user-aa-back-1", "user-aa-back-2", "user-aa-back-3"]) {
      const actor = tokenHelpers.generateToken(who);
      const created = await request(app)
        .post("/api/v1/agri-academy/sessions")
        .set("token", actor)
        .send({ examId: "pesticide-basics" })
        .expect(201);
      await request(app).post(`/api/v1/agri-academy/sessions/${created.body.sessionId}/start`).set("token", actor).expect(200);
    }

    // One page big enough to hold the log: nothing is left underneath it.
    const whole = await request(app).get("/api/v1/agri-academy/events?limit=500").expect(200);
    expect(whole.body.hasMore).toBe(false);
    const everySequence = whole.body.events.map((e) => e.sequence);
    expect(everySequence.length).toBeGreaterThanOrEqual(6);

    // Walk the same log two at a time, handing back the lowest sequence each page
    // returned — exactly what the activity page's sentinel does.
    const walked = [];
    let before = 0;
    let body;
    let guard = 0;
    do {
      const query = new URLSearchParams({ limit: "2" });
      if (before) query.set("before", String(before));
      ({ body } = await request(app).get(`/api/v1/agri-academy/events?${query.toString()}`).expect(200));
      // `before` is a page bound, not a filter — so the total a view is counting
      // against must not move while it pages into history.
      expect(body.total).toBe(whole.body.total);
      walked.push(...body.events.map((e) => e.sequence));
      before = body.events.length ? body.events[body.events.length - 1].sequence : 0;
    } while (body.hasMore && ++guard < 50);

    expect(body.hasMore).toBe(false); // the last page says it is the last page
    // The walk reconstructs the log exactly: same order, no gap, no entry twice.
    expect(walked).toEqual(everySequence);

    // The two cursors are NOT mirror images: `since` narrows the query, `before`
    // only positions the window.
    const pivot = everySequence[2];
    const forwards = await request(app).get(`/api/v1/agri-academy/events?since=${pivot}`).expect(200);
    expect(forwards.body.total).toBeLessThan(whole.body.total);
    expect(forwards.body.events.every((e) => e.sequence > pivot)).toBe(true);
    const backwards = await request(app).get(`/api/v1/agri-academy/events?before=${pivot}`).expect(200);
    expect(backwards.body.total).toBe(whole.body.total);
    expect(backwards.body.events.every((e) => e.sequence < pivot)).toBe(true);

    // Scoping composes with paging: a unit's history stays that unit's history.
    const unitPage = await request(app).get("/api/v1/agri-academy/units/unit-demo/events?limit=2").expect(200);
    expect(unitPage.body.hasMore).toBe(true);
    const unitOlder = await request(app)
      .get(`/api/v1/agri-academy/units/unit-demo/events?limit=2&before=${unitPage.body.events[1].sequence}`)
      .expect(200);
    expect(unitOlder.body.events.every((e) => e.unitId === "unit-demo")).toBe(true);
    expect(unitOlder.body.events.every((e) => e.sequence < unitPage.body.events[1].sequence)).toBe(true);
    expect(unitOlder.body.total).toBe(unitPage.body.total);
  });

  it("tails the activity log over SSE, RE-STREAMING each entry as it happens", async () => {
    // The streaming sibling of the read above, through the whole chain: browser →
    // Rolnopol proxy → exam-center bridge → leaf tail. Driven with a raw
    // incremental reader, because supertest buffers and so cannot tell a
    // re-streaming proxy from one that collects the stream and answers once.
    const server = await listen(app, 0);
    const port = server.address().port;
    const actor = tokenHelpers.generateToken("user-aa-tail");
    try {
      const page = await request(app).get("/api/v1/agri-academy/events?limit=1").expect(200);
      const cursor = page.body.latestSequence;

      const s = await openStream({ port, path: `/api/v1/agri-academy/events/stream?since=${cursor}&pollMs=20` });
      expect(s.status).toBe(200);
      expect(s.headers["content-type"]).toBe("text/event-stream");
      expect(s.headers["content-length"]).toBeUndefined();
      expect((await s.nextBlock()).retry).toBeGreaterThanOrEqual(1000);
      // Nothing has happened since the page was read, and the tail says so rather
      // than staying silent (which a proxy is entitled to mistake for a dead peer).
      expect((await s.nextEvent()).event).toBe("ping");

      // Now make something happen. The entry must arrive on the OPEN stream.
      const created = await request(app)
        .post("/api/v1/agri-academy/sessions")
        .set("token", actor)
        .send({ examId: "pesticide-basics" })
        .expect(201);
      const frame = await s.nextEvent();
      expect(frame.event).toBe("entry");
      expect(frame.json).toMatchObject({ sessionId: created.body.sessionId, state: "entitled", unitId: "unit-demo", backlog: false });
      // Labels are overlaid by the gateway (the leaf stores ids and resolves nothing).
      expect(frame.json.examTitle).toBeTruthy();
      expect(frame.json.unitName).toBeTruthy();
      // `id:` is the browser's reconnect cursor, and no taker identity rides along.
      expect(frame.id).toBe(String(frame.json.sequence));
      expect(s.buffered()).not.toContain("user-aa-tail");
      expect(s.ended).toBe(false);

      // Starting the attempt moves the clock, so the same open stream reports it.
      await request(app).post(`/api/v1/agri-academy/sessions/${created.body.sessionId}/start`).set("token", actor).expect(200);
      const next = await s.nextEvent();
      expect(next.json).toMatchObject({ sessionId: created.body.sessionId, state: "active", window: "completion" });
      expect(next.json.sequence).toBeGreaterThan(frame.json.sequence);

      s.close();
      // The browser leaving must reach the leaf: no tail may outlive this test.
      await waitUntil(() => eeInternals.activeEventStreams() === 0, { label: "the leaf to clear the cancelled tail" });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("tails ONE unit's log, and 404s a unit with no public profile before opening a tail", async () => {
    const server = await listen(app, 0);
    const port = server.address().port;
    const actor = tokenHelpers.generateToken("user-aa-unit-tail");
    try {
      await request(app).get("/api/v1/agri-academy/units/no-such-unit/events/stream").expect(404, { error: "UNIT_NOT_FOUND" });
      expect(eeInternals.activeEventStreams()).toBe(0);

      const page = await request(app).get("/api/v1/agri-academy/units/unit-demo/events?limit=1").expect(200);
      const s = await openStream({
        port,
        path: `/api/v1/agri-academy/units/unit-demo/events/stream?since=${page.body.latestSequence}&pollMs=20`,
      });
      expect(s.status).toBe(200);
      await s.nextBlock();
      expect((await s.nextEvent()).event).toBe("ping");

      const created = await request(app)
        .post("/api/v1/agri-academy/sessions")
        .set("token", actor)
        .send({ examId: "pesticide-basics" })
        .expect(201);
      const frame = await s.nextEvent();
      expect(frame.json).toMatchObject({ sessionId: created.body.sessionId, unitId: "unit-demo" });

      s.close();
      await waitUntil(() => eeInternals.activeEventStreams() === 0, { label: "the leaf to clear the cancelled tail" });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("404s the activity tail when the feature flag is off", async () => {
    await setFlag(false);
    try {
      await request(app).get("/api/v1/agri-academy/events/stream").expect(404);
      await request(app).get("/api/v1/agri-academy/units/unit-demo/events/stream").expect(404);
    } finally {
      await setFlag(true);
    }
  });

  it("proxies the published catalog (200) and never leaks keys", async () => {
    const res = await request(app).get("/api/v1/agri-academy/exams").set("token", token).expect(200);
    expect(res.body.exams.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toContain("correct");
  });

  it("flows exam difficulty + category through the catalog, and proxies the difficulty set", async () => {
    const diffs = await request(app).get("/api/v1/agri-academy/exam-difficulties").set("token", token).expect(200);
    expect(diffs.body.difficulties).toEqual(["beginner", "intermediate", "advanced"]);

    const res = await request(app).get("/api/v1/agri-academy/exams").set("token", token).expect(200);
    const seeded = res.body.exams.find((e) => e.id === "pesticide-basics");
    expect(seeded.difficulty).toBe("beginner");
    expect(seeded.category).toBe("Crop Protection");
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
    expect(ratedProfile.body.passedCount).toBeGreaterThanOrEqual(1);
    const ratedExam = ratedProfile.body.exams.find((e) => e.id === examId);
    expect(ratedExam.rating).toBe(4);
    expect(ratedExam.ratings).toBe(1);
    expect(ratedExam.passedCount).toBeGreaterThanOrEqual(1);

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

  it("aggregate health proxies through the bridge (all six up)", async () => {
    const res = await request(app).get("/api/v1/agri-academy/health").set("token", token).expect(200);
    expect(res.body.overall).toBe("SERVING");
    expect(res.body.services).toHaveLength(6);
  });

  it("mints a certificate on the e2e pass and lists it", async () => {
    const certs = await request(app).get("/api/v1/agri-academy/certificates").set("token", token).expect(200);
    expect(certs.body.certificates.length).toBeGreaterThanOrEqual(1);
    const certNo = certs.body.certificates[0].certNo;
    // Public verify is UNAUTHENTICATED.
    const verify = await request(app).get(`/api/v1/agri-academy/verify/${certNo}`).expect(200);
    expect(verify.body.status).toBe("valid");
  });

  it("bookmarks: add / list (resolved) / remove through the bridge, auth required", async () => {
    // Auth required.
    await request(app).get("/api/v1/agri-academy/bookmarks").expect(401);

    const add = await request(app).put("/api/v1/agri-academy/bookmarks/pesticide-basics").set("token", token).expect(200);
    expect(add.body.bookmarks).toContain("pesticide-basics");

    const list = await request(app).get("/api/v1/agri-academy/bookmarks").set("token", token).expect(200);
    const card = list.body.bookmarks.find((b) => b.examId === "pesticide-basics");
    expect(card).toBeTruthy();
    expect(card.available).toBe(true);
    expect(card.title).toBeTruthy();

    const remove = await request(app).delete("/api/v1/agri-academy/bookmarks/pesticide-basics").set("token", token).expect(200);
    expect(remove.body.bookmarks).not.toContain("pesticide-basics");
  });

  it("shareable certificate: private by default, holder shares a public link + Open-Badge", async () => {
    const certs = await request(app).get("/api/v1/agri-academy/certificates").set("token", token).expect(200);
    const certNo = certs.body.certificates[0].certNo;

    // Private detail is holder-only.
    const mine = await request(app).get(`/api/v1/agri-academy/certificates/${certNo}`).set("token", token).expect(200);
    expect(mine.body.certNo).toBe(certNo);
    expect(mine.body.shared).toBe(false);
    const otherToken = tokenHelpers.generateToken("aa-not-the-holder");
    await request(app).get(`/api/v1/agri-academy/certificates/${certNo}`).set("token", otherToken).expect(403);

    // Holder generates a public share link.
    const shared = await request(app).post(`/api/v1/agri-academy/certificates/${certNo}/share`).set("token", token).expect(200);
    const shareToken = shared.body.shareToken;
    expect(shareToken).toMatch(/^[a-f0-9]{32}$/);

    // Anyone (unauthenticated) can resolve the share link → rich view + Open-Badge.
    const pub = await request(app).get(`/api/v1/agri-academy/shared/${shareToken}`).expect(200);
    expect(pub.body.certNo).toBe(certNo);
    expect(pub.body.shared).toBe(true);
    expect(pub.body.openBadge["@context"]).toBe("https://w3id.org/openbadges/v2");

    // A non-holder cannot share/unshare.
    await request(app).post(`/api/v1/agri-academy/certificates/${certNo}/share`).set("token", otherToken).expect(403);

    // Revoke the link → it stops resolving publicly.
    await request(app).delete(`/api/v1/agri-academy/certificates/${certNo}/share`).set("token", token).expect(200);
    await request(app).get(`/api/v1/agri-academy/shared/${shareToken}`).expect(404);
  });

  it("popular / trending row ranks by enrollment count through the bridge (no keys)", async () => {
    // Two distinct takers enroll in a seeded exam so it has a popularity signal.
    for (const uid of ["aa-pop-1", "aa-pop-2"]) {
      const t = tokenHelpers.generateToken(uid);
      await request(app).post("/api/v1/agri-academy/sessions").set("token", t).send({ examId: "pesticide-basics" }).expect(201);
    }
    const res = await request(app).get("/api/v1/agri-academy/exams/popular").set("token", token).expect(200);
    expect(Array.isArray(res.body.exams)).toBe(true);
    expect(res.body.windowDays).toBe(30);
    const hot = res.body.exams.find((e) => e.id === "pesticide-basics");
    expect(hot).toBeTruthy();
    expect(hot.enrollments).toBeGreaterThanOrEqual(2);
    // Ranked by enrollments descending; never leaks answer keys.
    const counts = res.body.exams.map((e) => e.enrollments);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(JSON.stringify(res.body)).not.toContain("correct");
  });

  it("owner previews their own exam as a taker (key-stripped, no side effects); non-owner is 403", async () => {
    const ownerToken = tokenHelpers.generateToken("aa-preview-owner");
    const admin = (method, p) => request(app)[method](`/api/v1/agri-academy${p}`).set("token", ownerToken);

    await admin("post", "/units").send({ name: "Preview Unit", description: "preview" }).expect(201);
    const exam = await admin("post", "/exams")
      .send({
        title: "Preview Exam",
        description: "d",
        durationSec: 600,
        accessWindowDays: 3,
        passPct: 60,
        attemptsAllowed: 2,
        certValidMonths: 12,
        questionCount: 2,
        pricing: { mode: "free" },
      })
      .expect(201);
    const examId = exam.body.id;
    for (const q of [
      {
        id: "q1",
        type: "single",
        text: "Q1",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["a"],
      },
      {
        id: "q2",
        type: "single",
        text: "Q2",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correct: ["b"],
      },
    ]) {
      await admin("post", `/exams/${examId}/questions`).send(q).expect(201);
    }

    // Preview works even on a DRAFT (pre-publish sanity check), key-stripped.
    const preview = await admin("get", `/exams/${examId}/preview`).expect(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.exam.title).toBe("Preview Exam");
    expect(preview.body.questions).toHaveLength(2);
    expect(JSON.stringify(preview.body)).not.toContain("correct");

    // No side effects: previewing minted no session for the owner.
    const sessions = await admin("get", "/sessions").expect(200);
    expect(sessions.body.sessions.find((s) => s.examId === examId)).toBeUndefined();

    // A different user does not own this exam → 403.
    const otherToken = tokenHelpers.generateToken("aa-preview-other");
    await request(app).get(`/api/v1/agri-academy/exams/${examId}/preview`).set("token", otherToken).expect(403);
  });

  it("a disabled exam — and every exam of a disabled unit — cannot be enrolled or seen in the catalog", async () => {
    const ownerToken = tokenHelpers.generateToken("aa-toggle-owner");
    const takerToken = tokenHelpers.generateToken("aa-toggle-taker");
    const admin = (method, p) => request(app)[method](`/api/v1/agri-academy${p}`).set("token", ownerToken);

    const unit = await admin("post", "/units").send({ name: "Toggle Unit", description: "e2e gating" }).expect(201);
    const unitId = unit.body.unitId;
    const exam = await admin("post", "/exams")
      .send({
        title: "Toggle Exam",
        durationSec: 300,
        accessWindowDays: 3,
        passPct: 50,
        attemptsAllowed: 2,
        certValidMonths: 12,
        questionCount: 1,
        pricing: { mode: "free" },
      })
      .expect(201);
    const examId = exam.body.id;
    await admin("post", `/exams/${examId}/questions`)
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
