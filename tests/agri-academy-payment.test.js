import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
const path = require("path");
const os = require("os");
const fs = require("fs");

// Exercises the Rolnopol taker bridge's PAY-BEFORE-EXAM flow against a REAL
// AgriAcademy ecosystem, but with an IN-MEMORY financial service so no real
// data/financial.json is touched and insufficient funds can be simulated
// deterministically. Money lives ONLY in the bridge; the ecosystem never sees ROL.
const EC_PORT = 4471;
const AU_PORT = 4472;
const CI_PORT = 4473;
const EC_DB = path.join(os.tmpdir(), `aa-ec-pay-${process.pid}.json`);
const AU_DB = path.join(os.tmpdir(), `aa-au-pay-${process.pid}.json`);
const QB_DB = path.join(os.tmpdir(), `aa-qb-pay-${process.pid}.json`);
const CI_DB = path.join(os.tmpdir(), `aa-ci-pay-${process.pid}.json`);

process.env.AGRI_ACADEMY_TARGET = `http://localhost:${EC_PORT}`;
process.env.AGRI_ACADEMY_AUTHORING_TARGET = `http://localhost:${AU_PORT}`;
process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS = "2000";
process.env.AUTHORING_TARGET = `http://localhost:${AU_PORT}`;
process.env.CERTIFICATE_ISSUER_TARGET = `http://localhost:${CI_PORT}`;
process.env.EXAM_CENTER_DB_PATH = EC_DB;
process.env.AUTHORING_DB_PATH = AU_DB;
process.env.QUESTION_BANK_DB_PATH = QB_DB;
process.env.CERTIFICATES_DB_PATH = CI_DB;
process.env.QUESTION_BANK_GRPC_PORT = "0";
process.env.GRADING_GRPC_PORT = "0";
process.env.AGRI_ACADEMY_LOG = "silent";

const app = require("../api/index.js");
const tokenHelpers = require("../helpers/token.helpers.js");
const financialService = require("../services/financial.service.js");
const { examCenter } = require("../modules/agri-academy");
const { _clear: clearIdempotency } = require("../modules/agri-academy/idempotency.js");
const ROOT = path.join(__dirname, "..", "external-services", "agri-academy");

const FLAG = "agriAcademyEnabled";

// ── In-memory financial fake (overrides the singleton's methods in place) ──────
const accounts = new Map();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const acc = (id) => accounts.get(String(id));
const ensure = (id) => {
  if (!acc(id)) accounts.set(String(id), { userId: id, balance: 0, currency: "ROL", transactions: [] });
  return acc(id);
};
const fund = (id, amount) => {
  ensure(id).balance = amount;
};
const txOf = (id, ref, type) => (acc(id)?.transactions || []).filter((t) => String(t.referenceId) === ref && (!type || t.type === type));

function installFinancialFake() {
  financialService.getAccount = vi.fn(async (id) => acc(id) || null);
  financialService.initializeAccount = vi.fn(async (id) => ensure(id));
  financialService.addTransaction = vi.fn(async (id, tx) => {
    const a = ensure(id);
    if (tx.type === "expense" && a.balance < tx.amount) throw new Error("Insufficient funds: overdraft is not allowed");
    const t = { id: a.transactions.length + 1, ...tx, timestamp: new Date().toISOString() };
    a.transactions.push(t);
    a.balance = round2(a.balance + (tx.type === "income" ? tx.amount : -tx.amount));
    return t;
  });
}

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
const tok = (u) => tokenHelpers.generateToken(u);
const bridge = (method, p, token) => {
  const r = request(app)[method](`/api/v1/agri-academy${p}`);
  return token ? r.set("token", token) : r;
};

// Author a PAID exam owned by `authorToken`'s unit; returns its id.
async function authorPaidExam(authorToken, priceRol = 25) {
  await bridge("post", "/units", authorToken).send({ name: "Pay Unit", description: "money e2e" }).expect(201);
  const exam = await bridge("post", "/exams", authorToken)
    .send({
      title: "Paid Exam",
      description: "d",
      durationSec: 900,
      accessWindowDays: 3,
      passPct: 60,
      attemptsAllowed: 2,
      certValidMonths: 12,
      questionCount: 1,
      pricing: { mode: "paid", priceRol },
    })
    .expect(201);
  const examId = exam.body.id;
  await bridge("post", `/exams/${examId}/questions`, authorToken)
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
  await bridge("post", `/exams/${examId}/publish`, authorToken).expect(200);
  return examId;
}

let bank;
let grader;
let certServer;
let authServer;
let ecServer;
let originalFlags;
let examId;

const AUTHOR = "aa-pay-author";
const AUTHOR_TOKEN = tokenHelpers.generateToken(AUTHOR);

beforeAll(async () => {
  originalFlags = await getFlags();
  installFinancialFake();

  const started = await require(path.join(ROOT, "question-bank-service", "server", "index.js")).start();
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
  examId = await authorPaidExam(AUTHOR_TOKEN);
});

afterAll(async () => {
  if (ecServer) await new Promise((r) => ecServer.close(r));
  if (authServer) await new Promise((r) => authServer.close(r));
  if (certServer) await new Promise((r) => certServer.close(r));
  if (bank) bank.forceShutdown();
  if (grader) grader.forceShutdown();
  if (originalFlags) await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags });
  for (const f of [EC_DB, AU_DB, QB_DB, CI_DB]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("agri-academy bridge — pay before exam (happy path)", () => {
  it("charges the taker + pays the unit, entitles BEFORE any draw; the clock starts at start", async () => {
    const taker = "pay-happy";
    const token = tok(taker);
    fund(taker, 100);
    const authorBefore = ensure(AUTHOR).balance;

    const enrolled = await bridge("post", "/sessions", token).send({ examId }).expect(200);
    expect(enrolled.body.state).toBe("entitled");
    expect(enrolled.body.charged).toBe(25);
    expect(enrolled.body.questions).toBeUndefined(); // no draw yet
    expect(enrolled.body.expiresAt).toBeUndefined(); // completion clock not started

    // Money moved: taker debited, unit (author) credited.
    expect(acc(taker).balance).toBe(75);
    expect(acc(AUTHOR).balance).toBe(authorBefore + 25);
    const sid = enrolled.body.sessionId;
    expect(txOf(taker, `agri-attempt-${sid}`, "expense")).toHaveLength(1);
    expect(txOf(AUTHOR, `agri-payout-${sid}`, "income")).toHaveLength(1);

    // Now start — the completion clock begins here, not at payment.
    const started = await bridge("post", `/sessions/${sid}/start`, token).expect(200);
    expect(started.body.state).toBe("active");
    expect(started.body.expiresAt).toBeTypeOf("number");
  });
});

describe("agri-academy bridge — insufficient funds", () => {
  it("402 and the session stays awaiting_payment; no attempt, no money moved", async () => {
    const taker = "pay-broke";
    const token = tok(taker);
    fund(taker, 10); // price is 25

    const res = await bridge("post", "/sessions", token).send({ examId }).expect(402);
    expect(res.body.error).toBe("INSUFFICIENT_FUNDS");
    expect(res.body.needed).toBe(25);
    expect(res.body.state).toBe("awaiting_payment");
    expect(acc(taker).balance).toBe(10); // untouched

    const got = await bridge("get", `/sessions/${res.body.sessionId}`, token).expect(200);
    expect(got.body.state).toBe("awaiting_payment");
  });
});

describe("agri-academy bridge — idempotent enroll", () => {
  it("charges once for repeated enrolls carrying the same Idempotency-Key", async () => {
    clearIdempotency();
    const taker = "pay-idem";
    const token = tok(taker);
    fund(taker, 100);

    const first = await bridge("post", "/sessions", token).set("idempotency-key", "enroll-1").send({ examId }).expect(200);
    const second = await bridge("post", "/sessions", token).set("idempotency-key", "enroll-1").send({ examId }).expect(200);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(acc(taker).balance).toBe(75); // charged once
    expect(txOf(taker, `agri-attempt-${first.body.sessionId}`, "expense")).toHaveLength(1);
  });

  it("charges once even WITHOUT an Idempotency-Key — the open session is reused (the UI's double-click case)", async () => {
    clearIdempotency();
    const taker = "pay-noidem";
    const token = tok(taker);
    fund(taker, 100);

    // No idempotency key on either call (this is what the taker page actually sends).
    const first = await bridge("post", "/sessions", token).send({ examId }).expect(200);
    const second = await bridge("post", "/sessions", token).send({ examId }).expect(200);
    expect(second.body.sessionId).toBe(first.body.sessionId); // same enrollment reused
    expect(acc(taker).balance).toBe(75); // charged exactly once
    expect(txOf(taker, `agri-attempt-${first.body.sessionId}`, "expense")).toHaveLength(1);

    // And it isn't duplicated in the taker's history.
    const list = await bridge("get", "/sessions", token).expect(200);
    expect(list.body.sessions.filter((s) => s.examId === examId)).toHaveLength(1);
  });
});

describe("agri-academy bridge — entitle fails after a charge", () => {
  it("refunds the taker and claws back the unit payout (net zero), returns 502", async () => {
    const taker = "pay-entfail";
    const token = tok(taker);
    fund(taker, 100);
    const authorBefore = ensure(AUTHOR).balance;

    const orig = examCenter.entitleSession;
    examCenter.entitleSession = vi.fn(async () => ({ status: 500, body: { error: "boom" } }));
    try {
      const res = await bridge("post", "/sessions", token).send({ examId }).expect(502);
      expect(res.body.error).toBe("ENTITLE_FAILED");
      expect(res.body.refunded).toBe(25);
    } finally {
      examCenter.entitleSession = orig;
    }
    expect(acc(taker).balance).toBe(100); // charge refunded
    expect(acc(AUTHOR).balance).toBe(authorBefore); // payout clawed back (net zero)
  });
});

describe("agri-academy bridge — reconcile repairs a charge-then-entitle failure", () => {
  it("entitles a charged-but-awaiting_payment session without double-charging", async () => {
    const taker = "pay-reconcile";
    const token = tok(taker);
    fund(taker, 100);

    // Out-of-band: create an awaiting_payment session directly on the exam center
    // and record the taker's charge — simulating a charge that landed before an
    // entitle that never ran.
    const created = await examCenter.createSession(taker, { examId });
    const sid = created.body.sessionId;
    expect(created.body.state).toBe("awaiting_payment");
    await financialService.addTransaction(taker, {
      type: "expense",
      amount: 25,
      description: "manual charge",
      category: "agri-academy",
      referenceId: `agri-attempt-${sid}`,
    });
    expect(acc(taker).balance).toBe(75);

    const rec = await bridge("post", "/reconcile", token).expect(200);
    const entry = rec.body.repaired.find((r) => r.sessionId === sid);
    expect(entry.status).toBe("entitled");

    const got = await bridge("get", `/sessions/${sid}`, token).expect(200);
    expect(got.body.state).toBe("entitled");
    expect(acc(AUTHOR).balance).toBeGreaterThanOrEqual(25); // unit paid out

    // Repeat reconcile → idempotent (no further charge).
    const before = acc(taker).balance;
    await bridge("post", "/reconcile", token).expect(200);
    expect(acc(taker).balance).toBe(before);
    expect(txOf(taker, `agri-attempt-${sid}`, "expense")).toHaveLength(1);
  });
});
