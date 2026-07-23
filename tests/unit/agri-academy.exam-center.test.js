import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Throwaway DB + silent logs before requiring the service.
const TMP_DB = path.join(os.tmpdir(), `aa-exam-center-unit-${process.pid}.json`);
process.env.EXAM_CENTER_DB_PATH = TMP_DB;
process.env.AGRI_ACADEMY_LOG = "silent";

const AA = path.join(__dirname, "..", "..", "external-services", "agri-academy", "exam-center-service");
const db = require(path.join(AA, "server", "db.js"));
const { buildApp, aggregateUnitAnalytics, publicQuestion, settle, buildGradeItems } = require(path.join(AA, "server", "index.js"));
// The grading fake scores with the REAL grading registry so the exam-center
// wiring is exercised without booting the gRPC leaf.
const gradingRegistry = require(
  path.join(__dirname, "..", "..", "external-services", "agri-academy", "grading-service", "question-types", "index.js"),
);

const DAY_MS = 24 * 60 * 60 * 1000;
// Enroll is now idempotent per (user, exam): a repeat enroll for the same exam
// reuses the open session instead of minting a duplicate. Each lifecycle test
// therefore needs its own taker so its enroll always creates a fresh session.
let USER = "taker-1";
let userSeq = 0;
const as = (req) => req.set("x-academy-user", USER);

// ── in-memory fakes for the injected clients ──────────────────────────────────
const EXAM = {
  id: "e1",
  ownerUnitId: "u1",
  title: "Test Exam",
  description: "d",
  questionCount: 3,
  durationSec: 1800,
  accessWindowDays: 7,
  passPct: 60,
  // Generous so the shared-user happy-path suite (many starts on e1) never trips
  // the attempt lock; the attempt-policy block below uses a dedicated low-limit exam.
  attemptsAllowed: 25,
  certValidMonths: 24,
  pricing: { mode: "free", priceRol: 0 },
};
const POOL = [
  {
    id: "q1",
    type: "single",
    text: "Q1",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correct: ["a"],
    weight: 1,
  },
  {
    id: "q2",
    type: "multi",
    text: "Q2",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    correct: ["a", "c"],
    weight: 1,
  },
  {
    id: "q3",
    type: "single",
    text: "Q3",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correct: ["b"],
    weight: 1,
  },
];
const CORRECT = { q1: ["a"], q2: ["a", "c"], q3: ["b"] };
const PAID = { ...EXAM, id: "paid1", pricing: { mode: "paid", priceRol: 25 }, payoutUserId: "unit-owner-1", certValidMonths: 24 };

function fakeAuthoring({ down = false, exams = { e1: EXAM }, myUnit = null } = {}) {
  const wrap =
    (fn) =>
    async (...a) =>
      down ? { status: 503, body: { error: "AUTHORING_UNAVAILABLE" } } : fn(...a);
  return {
    target: "http://fake-authoring",
    health: async () => (down ? { status: 503, body: {} } : { status: 200, body: { version: "1.0.0", uptime_ms: 1 } }),
    getMyUnit: wrap(async () => (myUnit ? { status: 200, body: myUnit } : { status: 404, body: { error: "UNIT_NOT_FOUND" } })),
    listPublishedExams: wrap(async () => ({ status: 200, body: { exams: Object.values(exams) } })),
    getPublishedExam: wrap(async (id) =>
      exams[id] ? { status: 200, body: exams[id] } : { status: 404, body: { error: "EXAM_NOT_FOUND" } },
    ),
    getPublicUnit: wrap(async () => ({ status: 404, body: { error: "UNIT_NOT_FOUND" } })),
    listPublicUnits: wrap(async () => ({ status: 200, body: { units: [] } })),
  };
}
function fakeBank({ down = false, pool = POOL } = {}) {
  return {
    target: "localhost:0",
    health: async () => {
      if (down) throw Object.assign(new Error("unavailable"), { code: 14 });
      return { version: "1.0.0", uptime_ms: 1 };
    },
    draw: async (examId, count) => {
      if (down) throw Object.assign(new Error("unavailable"), { code: 14 });
      return { questions: pool.slice(0, count || pool.length), total: pool.length };
    },
    getAnswerKey: async () => ({ keys: [] }),
  };
}
function fakeGrading({ down = false } = {}) {
  return {
    target: "localhost:0",
    health: async () => {
      if (down) throw Object.assign(new Error("unavailable"), { code: 14 });
      return { version: "1.0.0", uptime_ms: 1 };
    },
    gradeAttempt: async (items, passPct) => {
      if (down) throw Object.assign(new Error("unavailable"), { code: 14 });
      return gradingRegistry.grade(items, passPct);
    },
  };
}
function fakeCertificates({ down = false, seq = { n: 0 } } = {}) {
  const minted = new Map(); // idempotency key → certNo
  return {
    target: "http://fake-issuer",
    health: async () => (down ? { status: 503, body: {} } : { status: 200, body: { version: "1.0.0", uptime_ms: 1 } }),
    issue: async (payload) => {
      if (down) return { status: 503, body: { error: "CERTIFICATE_ISSUER_UNAVAILABLE" } };
      const key = `${payload.examId}::${payload.holder}::${payload.sessionId}`;
      if (!minted.has(key)) minted.set(key, `AA-2026-${String(++seq.n).padStart(6, "0")}`);
      return { status: 201, body: { certNo: minted.get(key), revoked: false } };
    },
    verify: async (certNo) => (down ? { status: 503, body: {} } : { status: 200, body: { status: "valid", certNo, unit: "u1" } }),
    revoke: async (certNo, reason) =>
      down ? { status: 503, body: {} } : { status: 200, body: { status: "revoked", certNo, revokedReason: reason } },
  };
}

function appWith(opts = {}) {
  return buildApp({
    authoring: fakeAuthoring(opts.authoring),
    questionBank: fakeBank(opts.bank),
    grading: fakeGrading(opts.grading),
    certificates: fakeCertificates(opts.certificates),
  });
}

let app;
beforeAll(async () => {
  await db.init();
  app = appWith();
});
beforeEach(() => {
  USER = `taker-${++userSeq}`;
});
afterEach(() => {
  delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
});
afterAll(() => {
  delete process.env.AGRI_ACADEMY_TIME_OFFSET_MS;
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    /* ignore */
  }
});

describe("exam-center — catalog (read from authoring)", () => {
  it("lists the published catalog", async () => {
    const res = await request(app).get("/v1/exams").expect(200);
    expect(res.body.exams.map((e) => e.id)).toContain("e1");
  });
  it("503s when authoring is down", async () => {
    const res = await request(appWith({ authoring: { down: true } }))
      .get("/v1/exams")
      .expect(503);
    expect(res.body.error).toBe("AUTHORING_UNAVAILABLE");
  });
  it("404s an unknown exam", async () => {
    await request(app).get("/v1/exams/nope").expect(404);
  });
});

describe("exam-center — identity", () => {
  it("401s a session call with no x-academy-user", async () => {
    await request(app).post("/v1/sessions").send({ examId: "e1" }).expect(401);
  });
});

describe("exam-center — free session happy path (enroll → start → submit)", () => {
  it("enroll returns entitled with an access window (no questions, no timer)", async () => {
    const res = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    expect(res.body.state).toBe("entitled");
    expect(res.body.accessExpiresAt).toBeTypeOf("number");
    expect(res.body.questions).toBeUndefined();
  });

  it("rejects saving an answer before start with 409 NOT_STARTED", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const res = await as(request(app).put(`/v1/sessions/${created.body.sessionId}/answers/q1`))
      .send({ answer: ["a"] })
      .expect(409);
    expect(res.body.error).toBe("NOT_STARTED");
  });

  it("start draws questions (no keys) and begins the completion clock", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const started = await as(request(app).post(`/v1/sessions/${created.body.sessionId}/start`)).expect(200);
    expect(started.body.state).toBe("active");
    expect(started.body.questions).toHaveLength(3);
    expect(started.body.expiresAt).toBeTypeOf("number");
    for (const q of started.body.questions) expect(q.correct).toBeUndefined();
    expect(JSON.stringify(started.body)).not.toContain("correct");
  });

  it("start is idempotent", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const first = await as(request(app).post(`/v1/sessions/${created.body.sessionId}/start`)).expect(200);
    const second = await as(request(app).post(`/v1/sessions/${created.body.sessionId}/start`)).expect(200);
    expect(second.body.expiresAt).toBe(first.body.expiresAt);
  });

  it("saves answers and submits to a passing score", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    for (const [qid, answer] of Object.entries(CORRECT)) {
      await as(request(app).put(`/v1/sessions/${sid}/answers/${qid}`))
        .send({ answer })
        .expect(200);
    }
    const res = await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200);
    expect(res.body.state).toBe("scored");
    expect(res.body.result.scorePct).toBe(100);
    expect(res.body.result.passed).toBe(true);
  });

  it("fails a submission below passPct", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).put(`/v1/sessions/${sid}/answers/q1`))
      .send({ answer: ["a"] })
      .expect(200);
    const res = await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200);
    expect(res.body.result.passed).toBe(false);
  });
});

describe("exam-center — idempotent enroll (no duplicate sessions)", () => {
  it("re-enrolling an entitled exam reuses the session (200, same id) — no duplicate", async () => {
    const first = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const again = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(200);
    expect(again.body.sessionId).toBe(first.body.sessionId);
    const list = await as(request(app).get("/v1/sessions")).expect(200);
    expect(list.body.sessions.filter((s) => s.examId === "e1")).toHaveLength(1);
  });

  it("re-enrolling once the attempt is active reuses the active session (200, same id)", async () => {
    const first = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = first.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    const again = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(200);
    expect(again.body.sessionId).toBe(sid);
    expect(again.body.state).toBe("active");
  });

  it("re-enrolling a paid exam awaiting payment reuses the session (200, same id) — no second charge", async () => {
    const a = appWith({ authoring: { exams: { paid1: PAID } } });
    const first = await as(request(a).post("/v1/sessions")).send({ examId: "paid1" }).expect(201);
    expect(first.body.state).toBe("awaiting_payment");
    const again = await as(request(a).post("/v1/sessions")).send({ examId: "paid1" }).expect(200);
    expect(again.body.sessionId).toBe(first.body.sessionId);
    expect(again.body.state).toBe("awaiting_payment");
  });

  it("re-enrolling after a completed attempt starts a fresh session (201, new id) — retry allowed", async () => {
    const first = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = first.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200); // → scored (terminal)
    const retry = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    expect(retry.body.sessionId).not.toBe(sid);
  });
});

describe("exam-center — degradation", () => {
  it("503s at start when the question bank is down (session stays entitled, no attempt)", async () => {
    const a = appWith({ bank: { down: true } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    const res = await as(request(a).post(`/v1/sessions/${sid}/start`)).expect(503);
    expect(res.body.error).toBe("QUESTION_BANK_UNAVAILABLE");
    const got = await as(request(a).get(`/v1/sessions/${sid}`)).expect(200);
    expect(got.body.state).toBe("entitled");
  });

  it("503s on enroll when authoring is down", async () => {
    const a = appWith({ authoring: { down: true } });
    const res = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(503);
    expect(res.body.error).toBe("AUTHORING_UNAVAILABLE");
  });
});

describe("exam-center — two clocks", () => {
  it("access-window lapse → 410 + expired_unstarted", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(7 * DAY_MS + 1000);
    const res = await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(410);
    expect(res.body.error).toBe("ACCESS_WINDOW_EXPIRED");
    const got = await as(request(app).get(`/v1/sessions/${sid}`)).expect(200);
    expect(got.body.state).toBe("expired_unstarted");
  });

  it("completion-deadline lapse → PUT 410, GET finalizes to expired_scored", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).put(`/v1/sessions/${sid}/answers/q1`))
      .send({ answer: ["a"] })
      .expect(200);
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(1800 * 1000 + 1000);
    await as(request(app).put(`/v1/sessions/${sid}/answers/q2`))
      .send({ answer: ["a"] })
      .expect(410);
    const got = await as(request(app).get(`/v1/sessions/${sid}`)).expect(200);
    expect(got.body.state).toBe("expired_scored");
    expect(got.body.result.perQuestion).toHaveLength(3);
  });
});

describe("exam-center — attempt policy (limit + cooldown lock)", () => {
  const EX2 = { ...EXAM, id: "e2", attemptsAllowed: 2 };
  const lockApp = () => appWith({ authoring: { exams: { e2: EX2 } } });
  const asUser = (req, user) => req.set("x-academy-user", user);

  // One full failing attempt: enroll → start → submit with no answers (0% fail).
  async function failOnce(app, user) {
    const created = await asUser(request(app).post("/v1/sessions"), user).send({ examId: "e2" }).expect(201);
    const sid = created.body.sessionId;
    await asUser(request(app).post(`/v1/sessions/${sid}/start`), user).expect(200);
    const res = await asUser(request(app).post(`/v1/sessions/${sid}/submit`), user).expect(200);
    return res.body;
  }

  it("locks the exam after the allowed attempts are exhausted with failures", async () => {
    const app = lockApp();
    const user = "lock-user-1";
    const first = await failOnce(app, user);
    expect(first.state).toBe("scored");
    expect(first.result.passed).toBe(false);
    await failOnce(app, user); // second (and final) failed attempt → lock

    const created = await asUser(request(app).post("/v1/sessions"), user).send({ examId: "e2" }).expect(201);
    const res = await asUser(request(app).post(`/v1/sessions/${created.body.sessionId}/start`), user).expect(403);
    expect(res.body.error).toBe("EXAM_LOCKED");
    expect(res.body.lockedUntil).toBeTypeOf("number");
  });

  it("cooldown lapse resets attempts so start succeeds again", async () => {
    const app = lockApp();
    const user = "lock-user-2";
    await failOnce(app, user);
    await failOnce(app, user); // exhausted → locked
    const created = await asUser(request(app).post("/v1/sessions"), user).send({ examId: "e2" }).expect(201);
    // Jump past the default 10-minute cooldown (still well within the 7-day access window).
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(10 * 60 * 1000 + 1000);
    const res = await asUser(request(app).post(`/v1/sessions/${created.body.sessionId}/start`), user).expect(200);
    expect(res.body.state).toBe("active");
  });
});

describe("exam-center — grading degradation (grading_pending)", () => {
  const asUser = (req, user) => req.set("x-academy-user", user);

  it("parks as grading_pending when grading is down, then grades on a later touch", async () => {
    const user = "pending-user";
    const down = appWith({ grading: { down: true } });
    const created = await asUser(request(down).post("/v1/sessions"), user).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await asUser(request(down).post(`/v1/sessions/${sid}/start`), user).expect(200);
    await asUser(request(down).put(`/v1/sessions/${sid}/answers/q1`), user)
      .send({ answer: ["a"] })
      .expect(200);

    const parked = await asUser(request(down).post(`/v1/sessions/${sid}/submit`), user).expect(202);
    expect(parked.body.status).toBe("grading_pending");

    // GET while grading is still down → stays submitted, still pending.
    const stillDown = await asUser(request(down).get(`/v1/sessions/${sid}`), user).expect(200);
    expect(stillDown.body.state).toBe("submitted");
    expect(stillDown.body.status).toBe("grading_pending");

    // Grading recovers (shares the same DB) → next GET finalizes to scored.
    const up = appWith();
    const done = await asUser(request(up).get(`/v1/sessions/${sid}`), user).expect(200);
    expect(done.body.state).toBe("scored");
    expect(done.body.result.scorePct).toBeTypeOf("number");
  });
});

describe("exam-center — paid lifecycle (entitle)", () => {
  const asU = (req, u) => req.set("x-academy-user", u);
  const paidApp = () => appWith({ authoring: { exams: { paid1: PAID } } });

  it("create → awaiting_payment (no draw, no attempt, no clock)", async () => {
    const res = await asU(request(paidApp()).post("/v1/sessions"), "pu1").send({ examId: "paid1" }).expect(201);
    expect(res.body.state).toBe("awaiting_payment");
    expect(res.body.payment.priceRol).toBe(25);
    expect(res.body.payment.payoutUserId).toBe("unit-owner-1");
    expect(res.body.questions).toBeUndefined();
  });

  it("entitle opens the access window and is idempotent", async () => {
    const app = paidApp();
    const created = await asU(request(app).post("/v1/sessions"), "pu2").send({ examId: "paid1" }).expect(201);
    const sid = created.body.sessionId;
    const ent = await asU(request(app).post(`/v1/sessions/${sid}/entitle`), "pu2").expect(200);
    expect(ent.body.state).toBe("entitled");
    expect(ent.body.accessExpiresAt).toBeTypeOf("number");
    const again = await asU(request(app).post(`/v1/sessions/${sid}/entitle`), "pu2").expect(200);
    expect(again.body.state).toBe("entitled");
  });

  it("start before entitle → 409 PAYMENT_REQUIRED", async () => {
    const app = paidApp();
    const created = await asU(request(app).post("/v1/sessions"), "pu3").send({ examId: "paid1" }).expect(201);
    const res = await asU(request(app).post(`/v1/sessions/${created.body.sessionId}/start`), "pu3").expect(409);
    expect(res.body.error).toBe("PAYMENT_REQUIRED");
  });

  it("activationTtl lapse → abandoned; a later entitle → 410", async () => {
    const app = paidApp();
    const created = await asU(request(app).post("/v1/sessions"), "pu4").send({ examId: "paid1" }).expect(201);
    const sid = created.body.sessionId;
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(15 * 60 * 1000 + 1000);
    const got = await asU(request(app).get(`/v1/sessions/${sid}`), "pu4").expect(200);
    expect(got.body.state).toBe("abandoned");
    const ent = await asU(request(app).post(`/v1/sessions/${sid}/entitle`), "pu4").expect(410);
    expect(ent.body.error).toBe("SESSION_ABANDONED");
  });
});

describe("exam-center — certificate issuance", () => {
  const asU = (req, u) => req.set("x-academy-user", u);
  async function readyToSubmit(app, user) {
    const created = await asU(request(app).post("/v1/sessions"), user).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await asU(request(app).post(`/v1/sessions/${sid}/start`), user).expect(200);
    for (const [qid, answer] of Object.entries(CORRECT)) {
      await asU(request(app).put(`/v1/sessions/${sid}/answers/${qid}`), user)
        .send({ answer })
        .expect(200);
    }
    return sid;
  }

  it("mints a certificate on a pass and lists it", async () => {
    const app = appWith();
    const user = "cert-user-1";
    const sid = await readyToSubmit(app, user);
    const res = await asU(request(app).post(`/v1/sessions/${sid}/submit`), user).expect(200);
    expect(res.body.result.passed).toBe(true);
    expect(res.body.result.certNo).toMatch(/^AA-2026-/);
    expect(res.body.result.certificateStatus).toBe("issued");
    const certs = await asU(request(app).get("/v1/certificates"), user).expect(200);
    expect(certs.body.certificates.map((c) => c.certNo)).toContain(res.body.result.certNo);
  });

  it("issuer down → certificateStatus pending, then a later GET mints", async () => {
    const user = "cert-user-2";
    const down = appWith({ certificates: { down: true } });
    const sid = await readyToSubmit(down, user);
    const submitted = await asU(request(down).post(`/v1/sessions/${sid}/submit`), user).expect(200);
    expect(submitted.body.result.passed).toBe(true);
    expect(submitted.body.result.certNo).toBeNull();
    expect(submitted.body.result.certificateStatus).toBe("pending");
    const up = appWith();
    const got = await asU(request(up).get(`/v1/sessions/${sid}`), user).expect(200);
    expect(got.body.result.certNo).toMatch(/^AA-2026-/);
    expect(got.body.result.certificateStatus).toBe("issued");
  });

  it("does not mint on a fail", async () => {
    const app = appWith();
    const user = "cert-user-3";
    const created = await asU(request(app).post("/v1/sessions"), user).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await asU(request(app).post(`/v1/sessions/${sid}/start`), user).expect(200);
    const res = await asU(request(app).post(`/v1/sessions/${sid}/submit`), user).expect(200);
    expect(res.body.result.passed).toBe(false);
    expect(res.body.result.certNo).toBeNull();
    expect(res.body.result.certificateStatus).toBeUndefined();
  });
});

describe("exam-center — aggregate health", () => {
  it("SERVING (200) when all probes are up", async () => {
    const res = await request(appWith()).get("/health/all").expect(200);
    expect(res.body.overall).toBe("SERVING");
    expect(res.body.services.map((s) => s.name)).toEqual(
      expect.arrayContaining(["exam-center", "authoring", "question-bank", "grading", "certificate-issuer"]),
    );
  });

  it("DEGRADED (503) when a probe is unreachable", async () => {
    const res = await request(appWith({ certificates: { down: true } }))
      .get("/health/all")
      .expect(503);
    expect(res.body.overall).toBe("DEGRADED");
    expect(res.body.services.find((s) => s.name === "certificate-issuer").status).toBe("UNREACHABLE");
  });
});

describe("exam-center — unit analytics aggregation (pure)", () => {
  it("computes per-exam and overall stats, ignoring other units", () => {
    const data = {
      users: {
        u_a: {
          sessions: {
            s1: {
              id: "s1",
              examId: "e1",
              state: "scored",
              startedAt: 1,
              snapshot: { ownerUnitId: "u1", title: "E1", pricing: { mode: "free" } },
              result: { scorePct: 80, passed: true, certNo: "AA-1" },
            },
            s2: {
              id: "s2",
              examId: "e1",
              state: "expired_scored",
              startedAt: 1,
              snapshot: { ownerUnitId: "u1", title: "E1", pricing: { mode: "free" } },
              result: { scorePct: 40, passed: false },
            },
          },
        },
        u_b: {
          sessions: {
            s3: {
              id: "s3",
              examId: "e2",
              state: "entitled",
              snapshot: { ownerUnitId: "u1", title: "E2", pricing: { mode: "paid", priceRol: 25 } },
            },
            s4: {
              id: "s4",
              examId: "eX",
              state: "scored",
              startedAt: 1,
              snapshot: { ownerUnitId: "OTHER", title: "X" },
              result: { scorePct: 90, passed: true, certNo: "AA-2" },
            },
          },
        },
      },
    };
    const a = aggregateUnitAnalytics(data, "u1", "Unit One", [
      { id: "e1", title: "E1", pricing: { mode: "free" } },
      { id: "e2", title: "E2", pricing: { mode: "paid", priceRol: 25 } },
    ]);
    expect(a.enrollments).toBe(3); // s1,s2,s3 — s4 (other unit) excluded
    expect(a.uniqueTakers).toBe(2);
    expect(a.completed).toBe(2);
    expect(a.passed).toBe(1);
    expect(a.failed).toBe(1);
    expect(a.certificates).toBe(1);
    expect(a.passRate).toBe(50);
    expect(a.avgScore).toBe(60);
    expect(a.paidEnrollments).toBe(1);
    const e1 = a.exams.find((e) => e.examId === "e1");
    expect(e1.enrollments).toBe(2);
    expect(e1.passRate).toBe(50);
  });
});

describe("exam-center — unit analytics endpoint (owner-only)", () => {
  const asU = (req, u) => req.set("x-academy-user", u);

  it("401s without identity", async () => {
    await request(appWith({ authoring: { myUnit: { unitId: "u1", name: "U1" } } }))
      .get("/v1/units/u1/analytics")
      .expect(401);
  });

  it("403s when the caller is not the unit owner", async () => {
    const app = appWith({ authoring: { myUnit: { unitId: "u2", name: "Other" } } });
    const res = await asU(request(app).get("/v1/units/u1/analytics"), "not-owner").expect(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("returns aggregated stats for the owner", async () => {
    const app = appWith({ authoring: { myUnit: { unitId: "u1", name: "Unit One" }, exams: { e1: EXAM } } });
    const user = "analytics-taker";
    const created = await asU(request(app).post("/v1/sessions"), user).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await asU(request(app).post(`/v1/sessions/${sid}/start`), user).expect(200);
    for (const [qid, answer] of Object.entries(CORRECT)) {
      await asU(request(app).put(`/v1/sessions/${sid}/answers/${qid}`), user)
        .send({ answer })
        .expect(200);
    }
    await asU(request(app).post(`/v1/sessions/${sid}/submit`), user).expect(200);

    const res = await asU(request(app).get("/v1/units/u1/analytics"), "owner-1").expect(200);
    expect(res.body.unit.unitId).toBe("u1");
    expect(res.body.enrollments).toBeGreaterThanOrEqual(1);
    expect(res.body.passed).toBeGreaterThanOrEqual(1);
    expect(res.body.certificates).toBeGreaterThanOrEqual(1);
    expect(res.body.exams.find((e) => e.examId === "e1")).toBeTruthy();
  });
});

describe("exam-center — validation guards", () => {
  it("404s an unknown session", async () => {
    await as(request(app).get("/v1/sessions/sess-nope")).expect(404);
  });
  it("404s an unknown question on a live session", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).put(`/v1/sessions/${sid}/answers/does-not-exist`))
      .send({ answer: ["a"] })
      .expect(404);
  });
});

describe("exam-center — enroll input / upstream negatives", () => {
  it("400s when examId is missing", async () => {
    const res = await as(request(app).post("/v1/sessions")).send({}).expect(400);
    expect(res.body.error).toMatch(/examId/);
  });
  it("404s an unknown exam id", async () => {
    await as(request(app).post("/v1/sessions")).send({ examId: "nope" }).expect(404);
  });
  it("502s when authoring returns an unexpected status", async () => {
    const a = buildApp({ authoring: { getPublishedExam: async () => ({ status: 500, body: {} }) } });
    const res = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(502);
    expect(res.body.error).toBe("AUTHORING_BAD_RESPONSE");
  });
});

describe("exam-center — start wrong-state / edge", () => {
  it("404s starting an unknown session", async () => {
    await as(request(app).post("/v1/sessions/sess-nope/start")).expect(404);
  });
  it("410s starting a terminal (scored) session", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200); // → scored
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(410);
  });
  it("502 NO_QUESTIONS when the bank returns an empty draw", async () => {
    const a = appWith({ bank: { pool: [] } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    const res = await as(request(a).post(`/v1/sessions/${sid}/start`)).expect(502);
    expect(res.body.error).toBe("NO_QUESTIONS");
  });
});

describe("exam-center — entitle wrong-state", () => {
  it("409 NOT_AWAITING_PAYMENT entitling an already-active session", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200); // → active
    const res = await as(request(app).post(`/v1/sessions/${sid}/entitle`)).expect(409);
    expect(res.body.error).toBe("NOT_AWAITING_PAYMENT");
  });
  it("404 entitling an unknown session", async () => {
    await as(request(app).post("/v1/sessions/sess-nope/entitle")).expect(404);
  });
});

describe("exam-center — save-answer wrong-state", () => {
  it("409 PAYMENT_REQUIRED saving on a paid awaiting_payment session", async () => {
    const a = appWith({ authoring: { exams: { paid1: PAID } } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "paid1" }).expect(201);
    expect(created.body.state).toBe("awaiting_payment");
    const res = await as(request(a).put(`/v1/sessions/${created.body.sessionId}/answers/q1`)).send({ answer: ["a"] }).expect(409);
    expect(res.body.error).toBe("PAYMENT_REQUIRED");
  });
  it("409 ALREADY_SUBMITTED saving after a scored submit", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200); // → scored
    const res = await as(request(app).put(`/v1/sessions/${sid}/answers/q1`)).send({ answer: ["a"] }).expect(409);
    expect(res.body.error).toBe("ALREADY_SUBMITTED");
  });
  it("404 saving on an unknown session", async () => {
    await as(request(app).put("/v1/sessions/sess-nope/answers/q1")).send({ answer: ["a"] }).expect(404);
  });
});

describe("exam-center — submit wrong-state / idempotency", () => {
  it("409 NOT_STARTED submitting an entitled session", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const res = await as(request(app).post(`/v1/sessions/${created.body.sessionId}/submit`)).expect(409);
    expect(res.body.error).toBe("NOT_STARTED");
  });
  it("409 PAYMENT_REQUIRED submitting a paid awaiting_payment session", async () => {
    const a = appWith({ authoring: { exams: { paid1: PAID } } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "paid1" }).expect(201);
    await as(request(a).post(`/v1/sessions/${created.body.sessionId}/submit`)).expect(409);
  });
  it("404 submitting an unknown session", async () => {
    await as(request(app).post("/v1/sessions/sess-nope/submit")).expect(404);
  });
  it("is idempotent once scored — a repeat submit returns 200 with the same result", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(app).post(`/v1/sessions/${sid}/start`)).expect(200);
    const first = await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200);
    const again = await as(request(app).post(`/v1/sessions/${sid}/submit`)).expect(200);
    expect(again.body.state).toBe("scored");
    expect(again.body.result.scorePct).toBe(first.body.result.scorePct);
  });
});

describe("exam-center — idempotent enroll: more state combinations", () => {
  it("reuses a submitted (awaiting-grade) session rather than minting a new one", async () => {
    const a = appWith({ grading: { down: true } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(a).post(`/v1/sessions/${sid}/start`)).expect(200);
    await as(request(a).post(`/v1/sessions/${sid}/submit`)).expect(202); // grading down → parked as submitted
    const again = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(200);
    expect(again.body.sessionId).toBe(sid);
    expect(again.body.state).toBe("submitted");
  });
  it("does NOT reuse a lapsed (expired_unstarted) session — mints a fresh one", async () => {
    const created = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    // Jump past the 7-day access window so the old session lapses.
    process.env.AGRI_ACADEMY_TIME_OFFSET_MS = String(8 * 24 * 60 * 60 * 1000);
    const fresh = await as(request(app).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    expect(fresh.body.sessionId).not.toBe(sid);
    expect(fresh.body.state).toBe("entitled");
  });
});

describe("exam-center — public unit directory (proxied)", () => {
  it("200 lists units (proxied from authoring)", async () => {
    const res = await request(app).get("/v1/units").expect(200);
    expect(res.body).toHaveProperty("units");
  });
  it("503 when authoring is down", async () => {
    const a = appWith({ authoring: { down: true } });
    const res = await request(a).get("/v1/units").expect(503);
    expect(res.body.error).toBe("AUTHORING_UNAVAILABLE");
  });
  it("404 for an unknown unit", async () => {
    await request(app).get("/v1/units/ghost").expect(404);
  });
});

describe("exam-center — certificates + verify negatives", () => {
  it("401 on GET /v1/certificates with no identity", async () => {
    await request(app).get("/v1/certificates").expect(401);
  });
  it("empty certificate list for a taker who never passed", async () => {
    const res = await as(request(app).get("/v1/certificates")).expect(200);
    expect(res.body.certificates).toEqual([]);
  });
  it("503 verifying when the issuer is down", async () => {
    const a = appWith({ certificates: { down: true } });
    const res = await request(a).get("/v1/verify/AA-2026-000001").expect(503);
    expect(res.body.error).toBe("CERTIFICATE_ISSUER_UNAVAILABLE");
  });
});

describe("exam-center — revoke certificate (ownership + degradation)", () => {
  const owns = (unitId) => appWith({ authoring: { myUnit: { unitId, name: unitId } } });
  it("401 with no identity", async () => {
    await request(app).post("/v1/certificates/AA-2026-000001/revoke").expect(401);
  });
  it("200 when the caller owns the issuing unit", async () => {
    const a = owns("u1"); // fake issuer.verify returns unit:"u1"
    const res = await as(request(a).post("/v1/certificates/AA-2026-000001/revoke")).send({ reason: "x" }).expect(200);
    expect(res.body.status).toBe("revoked");
  });
  it("403 when the caller's unit is not the issuing unit", async () => {
    const a = owns("u2");
    await as(request(a).post("/v1/certificates/AA-2026-000001/revoke")).send({ reason: "x" }).expect(403);
  });
  it("404 when the certificate is unknown/invalid at the issuer", async () => {
    // Issuer answers verify with status:"unknown" → the exam center treats it as not found.
    const a = buildApp({
      authoring: { getMyUnit: async () => ({ status: 200, body: { unitId: "u1" } }) },
      certificates: { verify: async () => ({ status: 200, body: { status: "unknown" } }) },
    });
    await as(request(a).post("/v1/certificates/AA-2026-000000/revoke")).send({ reason: "x" }).expect(404);
  });
  it("503 when the issuer is down at verify", async () => {
    const a = appWith({ certificates: { down: true }, authoring: { myUnit: { unitId: "u1" } } });
    await as(request(a).post("/v1/certificates/AA-2026-000001/revoke")).send({ reason: "x" }).expect(503);
  });
  it("503 when authoring is down (can't confirm ownership)", async () => {
    const a = buildApp({
      authoring: { getMyUnit: async () => ({ status: 503, body: {} }) },
      certificates: { verify: async () => ({ status: 200, body: { status: "valid", unit: "u1" } }), revoke: async () => ({ status: 200, body: {} }) },
    });
    await as(request(a).post("/v1/certificates/AA-2026-000001/revoke")).send({ reason: "x" }).expect(503);
  });
});

describe("exam-center — aggregate health DOWN", () => {
  it("overall DOWN (503) when every downstream is unreachable", async () => {
    const a = appWith({ authoring: { down: true }, bank: { down: true }, grading: { down: true }, certificates: { down: true } });
    const res = await request(a).get("/health/all").expect(503);
    expect(res.body.overall).toBe("DOWN");
  });
});

describe("exam-center — key stripping beyond start", () => {
  it("never leaks `correct` on an active or submitted GET", async () => {
    const a = appWith({ grading: { down: true } });
    const created = await as(request(a).post("/v1/sessions")).send({ examId: "e1" }).expect(201);
    const sid = created.body.sessionId;
    await as(request(a).post(`/v1/sessions/${sid}/start`)).expect(200);
    const active = await as(request(a).get(`/v1/sessions/${sid}`)).expect(200);
    expect(JSON.stringify(active.body)).not.toContain("correct");
    await as(request(a).post(`/v1/sessions/${sid}/submit`)).expect(202); // → submitted (grading down)
    const submitted = await as(request(a).get(`/v1/sessions/${sid}`)).expect(200);
    expect(JSON.stringify(submitted.body)).not.toContain("correct");
  });
});

describe("exam-center — pure helpers", () => {
  it("publicQuestion omits the answer key", () => {
    const pub = publicQuestion({ id: "q", type: "single", text: "T", options: [{ id: "a", text: "A" }], correct: ["a"], weight: 2 });
    expect(pub).toEqual({ id: "q", type: "single", text: "T", options: [{ id: "a", text: "A" }], weight: 2 });
    expect(pub).not.toHaveProperty("correct");
  });

  it("buildGradeItems normalizes single / multi / null answers and carries key+weight", () => {
    const session = {
      answers: { q1: "a", q2: ["a", "c"], q3: null },
      questions: [
        { id: "q1", type: "single", correct: ["a"], weight: 1 },
        { id: "q2", type: "multi", correct: ["a", "c"], weight: 2 },
        { id: "q3", type: "single", correct: ["b"], weight: 1 },
      ],
    };
    const items = buildGradeItems(session);
    expect(items[0]).toEqual({ question_id: "q1", type: "single", answer: ["a"], key: ["a"], weight: 1 });
    expect(items[1].answer).toEqual(["a", "c"]);
    expect(items[2].answer).toEqual([]); // null → []
  });

  it("settle drives each time transition (and is a no-op otherwise)", () => {
    const t = 1_000_000;
    const pay = { state: "awaiting_payment", activationExpiresAt: t - 1 };
    settle(pay, t);
    expect(pay.state).toBe("abandoned");

    const ent = { state: "entitled", accessExpiresAt: t - 1 };
    settle(ent, t);
    expect(ent.state).toBe("expired_unstarted");

    const act = { state: "active", expiresAt: t - 1 };
    settle(act, t);
    expect(act.state).toBe("submitted");
    expect(act.finalReason).toBe("expiry");

    const fresh = { state: "entitled", accessExpiresAt: t + 1000 };
    settle(fresh, t);
    expect(fresh.state).toBe("entitled"); // still within window → unchanged
  });
});
