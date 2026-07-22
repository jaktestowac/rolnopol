/**
 * AgriAcademy REST companion routes — TAKER plane (+ money).
 *
 * Thin proxy: feature-flag gate → rate limit → (session auth) → HTTP call to the
 * standalone exam-center gateway → passthrough. The app never touches AgriAcademy
 * data directly; it dials ONLY the gateway, which orchestrates the ecosystem.
 * Identity is forwarded as `x-academy-user`.
 *
 * MONEY lives in Rolnopol, not in the (independent) ecosystem — so pay-before-exam
 * is handled HERE against Rolnopol's financial service (ROL). For a PAID exam,
 * `POST /sessions` returns `awaiting_payment`; the bridge charges the taker
 * (`agri-attempt-<sid>`), pays out the unit (`agri-payout-<sid>`), then calls the
 * internal `entitle` to open the access window. Insufficient funds → 402 (session
 * stays `awaiting_payment`, no attempt). If `entitle` fails after a charge, the
 * bridge refunds the taker + claws back the unit payout (`agri-refund-<sid>`).
 * Every ROL move is keyed by a stable `referenceId` and `POST /sessions` honours
 * an `Idempotency-Key`; `POST /reconcile` repairs stuck charges/payouts/refunds.
 * The completion clock never starts here — only at `start`.
 *
 * The public unit directory / profile pages are flag-gated but UNAUTHENTICATED
 * (registered before the auth middleware). Everything else requires a session.
 *
 * Mounted under /api/v1 (see routes/v1/index.js).
 */
const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { examCenter } = require("../../modules/agri-academy");
const { withIdempotency } = require("../../modules/agri-academy/idempotency");
const financialService = require("../../services/financial.service");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();
const apiLimiter = createRateLimiter("api");
const gate = requireFeatureFlag("agriAcademyEnabled", { resourceName: "AgriAcademy" });

const userOf = (req) => req.user?.userId;
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const CATEGORY = "agri-academy";

function forward(res, result) {
  return res.status(result.status).json(result.body);
}
async function proxy(res, promise) {
  try {
    forward(res, await promise);
  } catch (err) {
    logError("[agri-academy] proxy failed", { error: err.message });
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
}

// ── ROL money helpers (idempotent by referenceId) ─────────────────────────────

async function ensureAccount(userId) {
  try {
    const acc = await financialService.getAccount(userId);
    if (acc) return acc;
  } catch {
    /* fall through to init */
  }
  try {
    return await financialService.initializeAccount(userId);
  } catch {
    return null;
  }
}
async function currentBalance(userId) {
  try {
    const acc = await financialService.getAccount(userId);
    return acc ? acc.balance : null;
  } catch {
    return null;
  }
}
async function hasTx(userId, referenceId, type) {
  try {
    const acc = await financialService.getAccount(userId);
    return (acc?.transactions || []).some((t) => String(t.referenceId) === referenceId && (!type || t.type === type));
  } catch {
    return false;
  }
}

// Charge the taker (idempotent). Throws on insufficient funds.
async function chargeTaker(userId, amount, sid) {
  const ref = `agri-attempt-${sid}`;
  if (await hasTx(userId, ref, "expense")) return;
  await financialService.addTransaction(userId, {
    type: "expense",
    amount,
    description: `AgriAcademy exam attempt ${sid}`,
    category: CATEGORY,
    referenceId: ref,
  });
}
// Pay the unit's payout user (idempotent, best-effort — reconcile is the backstop).
async function payoutUnit(payoutUserId, amount, sid) {
  const ref = `agri-payout-${sid}`;
  await ensureAccount(payoutUserId);
  if (await hasTx(payoutUserId, ref, "income")) return;
  await financialService.addTransaction(payoutUserId, {
    type: "income",
    amount,
    description: `AgriAcademy payout ${sid}`,
    category: CATEGORY,
    referenceId: ref,
  });
}
// Refund the taker (idempotent) — only when an entitle fails after a charge.
async function refundTaker(userId, amount, sid) {
  const ref = `agri-refund-${sid}`;
  if (await hasTx(userId, ref, "income")) return;
  await financialService.addTransaction(userId, {
    type: "income",
    amount,
    description: `AgriAcademy refund ${sid}`,
    category: CATEGORY,
    referenceId: ref,
  });
}
// Claw back a unit payout (idempotent) — mirrors a refund on the unit side.
async function clawbackUnit(payoutUserId, amount, sid) {
  const ref = `agri-refund-${sid}`;
  if (await hasTx(payoutUserId, ref, "expense")) return;
  const paidOut = await hasTx(payoutUserId, `agri-payout-${sid}`, "income");
  if (!paidOut) return; // nothing was ever paid out — nothing to claw back
  try {
    await financialService.addTransaction(payoutUserId, {
      type: "expense",
      amount,
      description: `AgriAcademy payout clawback ${sid}`,
      category: CATEGORY,
      referenceId: ref,
    });
  } catch (err) {
    logError("[agri-academy] clawback failed", err.message);
  }
}

// The unit's ROL income, read from the owner's own ledger: payouts credited as
// `agri-payout-<sid>` (income) net of clawbacks `agri-refund-<sid>` (expense). The
// caller is the verified unit owner (one unit per user), so their ledger is the unit's.
async function unitIncome(userId) {
  try {
    const acc = await financialService.getAccount(userId);
    let gross = 0;
    let clawback = 0;
    let payouts = 0;
    for (const t of acc?.transactions || []) {
      const ref = String(t.referenceId || "");
      if (t.type === "income" && ref.startsWith("agri-payout-")) {
        gross += Number(t.amount) || 0;
        payouts += 1;
      } else if (t.type === "expense" && ref.startsWith("agri-refund-")) {
        clawback += Number(t.amount) || 0;
      }
    }
    return { grossRol: money(gross), clawbackRol: money(clawback), netRol: money(gross - clawback), payouts, currency: "ROL" };
  } catch {
    return { grossRol: 0, clawbackRol: 0, netRol: 0, payouts: 0, currency: "ROL" };
  }
}

// ── Public unit pages (flag-gated, NO auth) — registered before the auth gate ──
router.get("/agri-academy/units", gate, apiLimiter, (req, res) => proxy(res, examCenter.listUnits()));
router.get("/agri-academy/units/:unitId", gate, apiLimiter, (req, res) => proxy(res, examCenter.getUnit(req.params.unitId)));

// Public certificate verification — flag-gated but unauthenticated (third-party).
router.get("/agri-academy/verify/:certNo", gate, apiLimiter, (req, res) => proxy(res, examCenter.verify(req.params.certNo)));

// Public system-status surface for the status page — flag-gated but unauthenticated
// (a GitHub-style status page is viewable without logging in). Same aggregate as the
// authenticated `/health` below, proxied from the exam center's /health/all.
router.get("/agri-academy/status", gate, apiLimiter, (req, res) => proxy(res, examCenter.healthAll()));

// ── Authenticated taker plane ─────────────────────────────────────────────────
router.use("/agri-academy", gate, apiLimiter, authenticateSessionUser);

// Aggregate health across all five services (200 all-up, 503 when any is down).
router.get("/agri-academy/health", (req, res) => proxy(res, examCenter.healthAll()));

router.get("/agri-academy/exams", (req, res) => proxy(res, examCenter.listExams(userOf(req))));
router.get("/agri-academy/exams/:examId", (req, res) => proxy(res, examCenter.getExam(userOf(req), req.params.examId)));

// The caller's own sessions (enrolled / in-progress / completed) for the "My exams" tab.
router.get("/agri-academy/sessions", (req, res) => proxy(res, examCenter.listSessions(userOf(req))));

// Owner-only unit analytics. The exam center aggregates enrollments/passes/certs
// (and enforces ownership); the bridge overlays ROL income from the owner's ledger.
router.get("/agri-academy/units/:unitId/analytics", async (req, res) => {
  const userId = userOf(req);
  try {
    const r = await examCenter.getUnitAnalytics(userId, req.params.unitId);
    if (r.status !== 200) return forward(res, r);
    const income = await unitIncome(userId);
    res.status(200).json({ ...r.body, income });
  } catch (err) {
    logError("[agri-academy] analytics failed", { error: err.message });
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

/**
 * Enroll (pay-before-exam). A FREE exam returns `entitled` with no money moved.
 * A PAID exam is charged + paid out + entitled here, before any question is drawn.
 * Idempotent when an `Idempotency-Key` header is supplied.
 */
router.post("/agri-academy/sessions", async (req, res) => {
  const userId = userOf(req);
  const idemKey = req.get("idempotency-key") || "";
  try {
    const { status, body } = await withIdempotency({ namespace: "enroll", user: userId, key: idemKey }, () => doEnroll(userId, req.body));
    res.status(status).json(body);
  } catch (err) {
    logError("[agri-academy] enroll failed", { error: err.message });
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

async function doEnroll(userId, reqBody) {
  const created = await examCenter.createSession(userId, reqBody);
  // 201 = a fresh enrollment; 200 = an existing OPEN enrollment reused (idempotent
  // — the taker already has access, so we must NOT charge again). Both fall through
  // to the money flow below, which is itself keyed by session id and so a no-op on
  // a session that was already charged/entitled.
  if (created.status !== 201 && created.status !== 200) return { status: created.status, body: created.body };

  const session = created.body;
  const sid = session.sessionId;
  if (session.state !== "awaiting_payment") {
    return { status: created.status, body: session }; // free/entitled — no money to move
  }

  const priceRol = money(session.payment?.priceRol || 0);
  const payoutUserId = session.payment?.payoutUserId;
  await ensureAccount(userId);

  // 1) Charge the taker. Insufficient → 402, session stays awaiting_payment.
  try {
    await chargeTaker(userId, priceRol, sid);
  } catch (err) {
    if (/insufficient/i.test(err.message)) {
      const balance = await currentBalance(userId);
      return {
        status: 402,
        body: {
          error: "INSUFFICIENT_FUNDS",
          code: "INSUFFICIENT_FUNDS",
          message: "Insufficient ROL balance for this exam",
          needed: priceRol,
          balance: balance != null ? money(balance) : null,
          currency: "ROL",
          sessionId: sid,
          state: "awaiting_payment",
        },
      };
    }
    throw err;
  }

  // 2) Pay the unit (best-effort — reconcile retries a miss).
  if (payoutUserId != null && priceRol > 0) {
    try {
      await payoutUnit(payoutUserId, priceRol, sid);
    } catch (err) {
      logError("[agri-academy] payout failed at enroll", err.message);
    }
  }

  // 3) Entitle. Failure after a charge → refund + clawback (reconcile also repairs).
  const ent = await examCenter.entitleSession(userId, sid);
  if (ent.status !== 200) {
    logError("[agri-academy] entitle failed after charge", { sid, status: ent.status });
    await refundTaker(userId, priceRol, sid).catch((e) => logError("[agri-academy] refund failed", e.message));
    if (payoutUserId != null) await clawbackUnit(payoutUserId, priceRol, sid);
    const balance = await currentBalance(userId);
    return {
      status: 502,
      body: {
        error: "ENTITLE_FAILED",
        code: "ENTITLE_FAILED",
        message: "Payment refunded — the exam could not be entitled",
        sessionId: sid,
        refunded: priceRol,
        balance: balance != null ? money(balance) : null,
        currency: "ROL",
      },
    };
  }

  const balance = await currentBalance(userId);
  return { status: 200, body: { ...ent.body, charged: priceRol, balance: balance != null ? money(balance) : null, currency: "ROL" } };
}

router.post("/agri-academy/sessions/:id/start", (req, res) => proxy(res, examCenter.startSession(userOf(req), req.params.id)));
router.get("/agri-academy/sessions/:id", (req, res) => proxy(res, examCenter.getSession(userOf(req), req.params.id)));
router.put("/agri-academy/sessions/:id/answers/:qid", (req, res) =>
  proxy(res, examCenter.saveAnswer(userOf(req), req.params.id, req.params.qid, req.body)),
);
router.post("/agri-academy/sessions/:id/submit", (req, res) => proxy(res, examCenter.submitSession(userOf(req), req.params.id)));

// ── Certificates ───────────────────────────────────────────────────────────────
router.get("/agri-academy/certificates", (req, res) => proxy(res, examCenter.listCertificates(userOf(req))));
router.post("/agri-academy/certificates/:certNo/revoke", (req, res) =>
  proxy(res, examCenter.revokeCertificate(userOf(req), req.params.certNo, req.body)),
);

/**
 * Reconcile stuck money for the caller. Retries the charge-then-entitle failure
 * window (a charged but still-`awaiting_payment` session is paid-out + entitled;
 * an un-entitlable one is refunded + clawed back) and any missed unit payout.
 * Idempotent (every ROL move is keyed by referenceId) — safe to call repeatedly.
 */
router.post("/agri-academy/reconcile", async (req, res) => {
  const userId = userOf(req);
  try {
    const list = await examCenter.listSessions(userId);
    const sessions = Array.isArray(list.body?.sessions) ? list.body.sessions : [];
    const repaired = [];
    for (const s of sessions) {
      const sid = s.sessionId;
      if (s.pricing?.mode !== "paid" && !s.payment) continue; // free exam — no money
      const charged = await hasTx(userId, `agri-attempt-${sid}`, "expense");
      if (!charged) continue; // taker never paid — nothing stuck
      if (await hasTx(userId, `agri-refund-${sid}`, "income")) continue; // already refunded

      const payoutUserId = s.payoutUserId ?? s.payment?.payoutUserId;
      const amount = money(s.priceRol ?? s.payment?.priceRol ?? 0);

      if (s.state === "awaiting_payment") {
        if (payoutUserId != null && amount > 0) await payoutUnit(payoutUserId, amount, sid).catch(() => {});
        const ent = await examCenter.entitleSession(userId, sid);
        if (ent.status === 200) {
          repaired.push({ sessionId: sid, status: "entitled" });
        } else {
          await refundTaker(userId, amount, sid).catch(() => {});
          if (payoutUserId != null) await clawbackUnit(payoutUserId, amount, sid);
          repaired.push({ sessionId: sid, status: "refunded" });
        }
      } else if (payoutUserId != null && amount > 0) {
        if (!(await hasTx(payoutUserId, `agri-payout-${sid}`, "income"))) {
          await payoutUnit(payoutUserId, amount, sid).catch(() => {});
          repaired.push({ sessionId: sid, status: "payout_retried" });
        }
      }
    }
    const balance = await currentBalance(userId);
    res.status(200).json({ repaired, balance: balance != null ? money(balance) : null, currency: "ROL" });
  } catch (err) {
    logError("[agri-academy] reconcile failed", { error: err.message });
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
});

module.exports = router;
