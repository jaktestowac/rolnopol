/**
 * Exam-center REST service — standalone process (:4350).
 * Start with:  npm run academy:exam-center
 *
 *   GET  /health
 *   GET  /v1/exams                              published catalog (read from authoring)
 *   GET  /v1/exams/:examId
 *   GET  /v1/units[/:unitId]                     public unit directory / profile (from authoring)
 *   POST /v1/sessions            { examId }      free → entitled (access window opens)
 *   POST /v1/sessions/:id/start                  entitled → active (draw from bank + completion clock)
 *   GET  /v1/sessions/:id                         resume (lazy-settled + lazy-graded)
 *   PUT  /v1/sessions/:id/answers/:qid { answer }
 *   POST /v1/sessions/:id/submit                 grade via grading service → scored
 *
 * Runtime/read plane: reads published exam defs + public units from the authoring
 * service, snapshots the def onto each session, and draws questions from the
 * question bank. TWO server-side clocks (access window + completion window),
 * injectable via AGRI_ACADEMY_TIME_OFFSET_MS. Answer keys are held server-side
 * (from the draw) and stripped before any taker response.
 *
 * Phase 3: scoring is delegated to the grading service (per-type strategies) at
 * both submit and lazy finalization. If grading is unavailable the session parks
 * as `submitted` and the next GET/submit retries (grading_pending). Attempt policy
 * is enforced here: attempts are consumed at `start`, and exhausting
 * `attemptsAllowed` on a failed attempt locks the exam for a cooldown.
 */
const express = require("express");
const { HOST, PORT, ACTIVATION_TTL_MS, COOLDOWN_MS } = require("../config");
const db = require("./db");
const clock = require("../../shared/clock");
const { createLogger } = require("../../shared/logger");

const log = createLogger("exam-center");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

// States that count as an OPEN enrollment: the taker already has (or is paying
// for) access to this exam, so a repeat enroll must reuse the session rather than
// mint a duplicate. Terminal/dead states (scored, expired_*, abandoned) are NOT
// here, so a legitimate retry after a completed/lapsed attempt starts fresh.
const OPEN_ENROLLMENT_STATES = new Set(["awaiting_payment", "entitled", "active", "submitted"]);

// ---- pure helpers -----------------------------------------------------------

/** A question as a taker may see it — no `correct` key. */
function publicQuestion(q) {
  return { id: q.id, type: q.type, text: q.text, options: q.options, weight: q.weight };
}

/** Normalize a saved answer to a list of option ids (single or multi). */
function normalizeAnswer(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  return [String(raw)];
}

/** Build the per-question items the grading service scores (carries the key). */
function buildGradeItems(session) {
  return (session.questions || []).map((q) => ({
    question_id: q.id,
    type: q.type,
    answer: normalizeAnswer(session.answers[q.id]),
    key: q.correct || [],
    weight: q.weight || 1,
  }));
}

/**
 * Time-only settle: bring a session's state up to date with the clock before
 * responding. Scoring is NOT done here — a completion-window lapse freezes the
 * attempt into `submitted` (finalReason "expiry"); the async grade happens in
 * gradeIfPending. Payment/access lapses are terminal and need no grade.
 */
function settle(session, now) {
  if (session.state === "awaiting_payment" && now > session.activationExpiresAt) {
    session.state = "abandoned";
  } else if (session.state === "entitled" && now > session.accessExpiresAt) {
    session.state = "expired_unstarted";
  } else if (session.state === "active" && now > session.expiresAt) {
    session.state = "submitted";
    session.finalReason = "expiry";
    session.submittedAt = now;
  }
}

/** Taker-facing view of a session (never leaks keys). */
function sessionView(session) {
  const base = { sessionId: session.id, examId: session.examId, state: session.state };
  switch (session.state) {
    case "awaiting_payment":
      base.payment = session.payment;
      base.activationExpiresAt = session.activationExpiresAt;
      break;
    case "entitled":
      base.accessExpiresAt = session.accessExpiresAt;
      break;
    case "active":
      base.questions = session.questions.map(publicQuestion);
      base.answers = session.answers;
      base.expiresAt = session.expiresAt;
      break;
    case "submitted":
      base.questions = session.questions.map(publicQuestion);
      base.answers = session.answers;
      base.expiresAt = session.expiresAt;
      base.submittedAt = session.submittedAt;
      break;
    case "scored":
    case "expired_scored":
      base.result = session.result;
      base.expiresAt = session.expiresAt;
      base.rating = session.rating?.stars ?? null; // the taker's own 1–5 star rating (passed exams only)
      break;
    case "expired_unstarted":
      base.accessExpiresAt = session.accessExpiresAt;
      break;
    default:
      break;
  }
  return base;
}

function findSession(data, userId, sessionId) {
  return data.users?.[userId]?.sessions?.[sessionId] || null;
}

function newSeed() {
  return Math.floor(Math.random() * 2147483647);
}

/**
 * Aggregate runtime analytics for one certification unit from every user's
 * sessions (enrollments, attempts, completions, passes, certificates, scores),
 * per-exam and overall. `publishedExams` seeds the per-exam list so exams with
 * zero enrollments still appear. Pure — no I/O — so it is unit-testable.
 */
function aggregateUnitAnalytics(data, unitId, unitName, publishedExams) {
  const exams = new Map();
  const ensure = (examId, title, pricing) => {
    if (!exams.has(examId)) {
      exams.set(examId, {
        examId,
        title: title || examId,
        pricing: pricing || null,
        enrollments: 0,
        takers: new Set(),
        started: 0,
        completed: 0,
        passed: 0,
        failed: 0,
        certificates: 0,
        scoreSum: 0,
        scoreCount: 0,
        paidEnrollments: 0,
      });
    }
    return exams.get(examId);
  };
  for (const e of publishedExams || []) ensure(e.id, e.title, e.pricing);

  const takers = new Set();
  const byState = {};
  let enrollments = 0;
  let started = 0;
  let completed = 0;
  let passed = 0;
  let failed = 0;
  let certificates = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let paidEnrollments = 0;

  for (const [uid, u] of Object.entries(data.users || {})) {
    for (const s of Object.values(u.sessions || {})) {
      if (s.snapshot?.ownerUnitId !== unitId) continue;
      const ex = ensure(s.examId, s.snapshot?.title, s.snapshot?.pricing);
      enrollments += 1;
      ex.enrollments += 1;
      takers.add(uid);
      ex.takers.add(uid);
      byState[s.state] = (byState[s.state] || 0) + 1;
      if (s.startedAt) {
        started += 1;
        ex.started += 1;
      }
      const isDone = s.state === "scored" || s.state === "expired_scored";
      if (isDone && s.result) {
        completed += 1;
        ex.completed += 1;
        const pct = s.result.scorePct || 0;
        scoreSum += pct;
        scoreCount += 1;
        ex.scoreSum += pct;
        ex.scoreCount += 1;
        if (s.result.passed) {
          passed += 1;
          ex.passed += 1;
        } else {
          failed += 1;
          ex.failed += 1;
        }
        if (s.result.certNo) {
          certificates += 1;
          ex.certificates += 1;
        }
      }
      if (s.snapshot?.pricing?.mode === "paid" && s.state !== "awaiting_payment" && s.state !== "abandoned") {
        paidEnrollments += 1;
        ex.paidEnrollments += 1;
      }
    }
  }

  const perExam = [...exams.values()]
    .map((e) => ({
      examId: e.examId,
      title: e.title,
      pricing: e.pricing,
      enrollments: e.enrollments,
      uniqueTakers: e.takers.size,
      started: e.started,
      completed: e.completed,
      passed: e.passed,
      failed: e.failed,
      certificates: e.certificates,
      passRate: e.completed ? Math.round((e.passed / e.completed) * 100) : 0,
      avgScore: e.scoreCount ? Math.round(e.scoreSum / e.scoreCount) : 0,
      paidEnrollments: e.paidEnrollments,
      priceRol: e.pricing?.mode === "paid" ? e.pricing.priceRol : 0,
    }))
    .sort((a, b) => b.enrollments - a.enrollments || a.title.localeCompare(b.title));

  return {
    unit: { unitId, name: unitName || null },
    examCount: perExam.length,
    enrollments,
    uniqueTakers: takers.size,
    started,
    completed,
    inProgress: (byState.active || 0) + (byState.entitled || 0) + (byState.submitted || 0),
    passed,
    failed,
    certificates,
    passRate: completed ? Math.round((passed / completed) * 100) : 0,
    avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : 0,
    paidEnrollments,
    byState,
    exams: perExam,
  };
}

// Farm-themed word lists for stable, non-reversible learner pseudonyms. A userId
// is hashed to one adjective + one noun + a 2-digit suffix, so the same learner
// always shows the same alias on the board but the real identity never leaks.
const ALIAS_ADJ = [
  "Golden", "Silent", "Rolling", "Misty", "Hardy", "Sunlit", "Verdant", "Rugged",
  "Amber", "Frosty", "Wild", "Nimble", "Quiet", "Bright", "Ancient", "Hidden",
];
const ALIAS_NOUN = [
  "Harvester", "Shepherd", "Plowman", "Vintner", "Grower", "Rancher", "Orchardist", "Sower",
  "Reaper", "Herder", "Farmhand", "Steward", "Grazier", "Miller", "Beekeeper", "Forager",
];

/** Deterministic farm-themed alias for a userId (anonymizes the leaderboard). */
function learnerAlias(userId) {
  const s = String(userId);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const adj = ALIAS_ADJ[h % ALIAS_ADJ.length];
  const noun = ALIAS_NOUN[Math.floor(h / ALIAS_ADJ.length) % ALIAS_NOUN.length];
  return `${adj} ${noun} #${(h % 89) + 10}`;
}

/**
 * Public, anonymized cross-ecosystem leaderboards for the showcase page. Rolls up
 * every user's sessions into three ranked boards — units, (aliased) learners, and
 * exams — each with enrollments, completions, passes, certificates, pass rate, and
 * average score. `units`/`exams` (from authoring) seed display metadata + let a
 * zero-activity entry still appear. Learner identity is never leaked — each userId
 * becomes a stable pseudonym via learnerAlias. Pure (no I/O) so it is unit-testable.
 * @returns {{units:object[], learners:object[], exams:object[], totals:object}}
 */
function computeLeaderboards(data, units = [], exams = [], limit = 50) {
  const unitMeta = new Map(units.map((u) => [u.unitId, u]));
  const examMeta = new Map(exams.map((e) => [e.id, e]));
  const unitNameOf = (unitId, fallback) => unitMeta.get(unitId)?.name || fallback || unitId || null;
  const blank = () => ({ enrollments: 0, completed: 0, passed: 0, certificates: 0, scoreSum: 0, scoreCount: 0, ratingSum: 0, ratingCount: 0 });

  const unitAgg = new Map();
  const learnerAgg = new Map();
  const examAgg = new Map();

  const ensureUnit = (unitId, name) => {
    if (!unitAgg.has(unitId)) {
      const m = unitMeta.get(unitId);
      unitAgg.set(unitId, { unitId, name: unitNameOf(unitId, name), icon: m?.icon || "graduation-cap", color: m?.color || "#3fae6b", learners: new Set(), ...blank() });
    }
    return unitAgg.get(unitId);
  };
  const ensureExam = (examId, title, ownerUnitId, pricing) => {
    if (!examAgg.has(examId)) {
      const m = examMeta.get(examId);
      const owner = m?.ownerUnitId || ownerUnitId;
      const pr = m?.pricing || pricing;
      examAgg.set(examId, { examId, title: m?.title || title || examId, unitName: unitNameOf(owner), mode: pr?.mode || "free", priceRol: pr?.mode === "paid" ? pr.priceRol : 0, learners: new Set(), ...blank() });
    }
    return examAgg.get(examId);
  };
  const ensureLearner = (userId) => {
    if (!learnerAgg.has(userId)) learnerAgg.set(userId, { userId, alias: learnerAlias(userId), bestScore: 0, units: new Set(), ...blank() });
    return learnerAgg.get(userId);
  };

  // Seed from the catalog so units/exams with no enrollments still appear.
  for (const u of units) ensureUnit(u.unitId, u.name);
  for (const e of exams) ensureExam(e.id, e.title, e.ownerUnitId, e.pricing);

  for (const [uid, u] of Object.entries(data.users || {})) {
    for (const s of Object.values(u.sessions || {})) {
      const unitId = s.snapshot?.ownerUnitId;
      if (!unitId) continue;
      const unit = ensureUnit(unitId, s.snapshot?.unitName);
      const exam = ensureExam(s.examId, s.snapshot?.title, unitId, s.snapshot?.pricing);
      const learner = ensureLearner(uid);

      unit.enrollments += 1;
      unit.learners.add(uid);
      exam.enrollments += 1;
      exam.learners.add(uid);
      learner.enrollments += 1;
      learner.units.add(unitId);

      if ((s.state === "scored" || s.state === "expired_scored") && s.result) {
        const pct = s.result.scorePct || 0;
        for (const a of [unit, exam, learner]) {
          a.completed += 1;
          a.scoreSum += pct;
          a.scoreCount += 1;
        }
        if (s.result.passed) {
          unit.passed += 1;
          exam.passed += 1;
          learner.passed += 1;
        }
        if (s.result.certNo) {
          unit.certificates += 1;
          exam.certificates += 1;
          learner.certificates += 1;
        }
        if (pct > learner.bestScore) learner.bestScore = pct;
      }
      // Star rating (only ever set on a passed exam) folds into the unit + exam averages.
      const stars = s.rating?.stars;
      if (Number.isInteger(stars)) {
        unit.ratingSum += stars;
        unit.ratingCount += 1;
        exam.ratingSum += stars;
        exam.ratingCount += 1;
      }
    }
  }

  const avg = (a) => (a.scoreCount ? Math.round(a.scoreSum / a.scoreCount) : 0);
  const rate = (a) => (a.completed ? Math.round((a.passed / a.completed) * 100) : 0);
  const rating = (a) => (a.ratingCount ? Math.round((a.ratingSum / a.ratingCount) * 10) / 10 : 0);
  const ranked = (arr, cmp) => arr.sort(cmp).slice(0, limit).map((x, i) => ({ rank: i + 1, ...x }));

  const units_ = ranked(
    [...unitAgg.values()].map((u) => ({
      unitId: u.unitId, name: u.name, icon: u.icon, color: u.color,
      enrollments: u.enrollments, learners: u.learners.size, completed: u.completed,
      passed: u.passed, certificates: u.certificates, passRate: rate(u), avgScore: avg(u),
      avgRating: rating(u), ratings: u.ratingCount,
    })),
    (a, b) => b.certificates - a.certificates || b.enrollments - a.enrollments || b.avgScore - a.avgScore || a.name.localeCompare(b.name),
  );
  const learners_ = ranked(
    [...learnerAgg.values()].map((l) => ({
      userId: l.userId, alias: l.alias, enrollments: l.enrollments, completed: l.completed, passed: l.passed,
      certificates: l.certificates, avgScore: avg(l), bestScore: l.bestScore, units: l.units.size,
    })),
    (a, b) => b.certificates - a.certificates || b.avgScore - a.avgScore || b.passed - a.passed || a.alias.localeCompare(b.alias),
  );
  const exams_ = ranked(
    [...examAgg.values()].map((e) => ({
      examId: e.examId, title: e.title, unitName: e.unitName, mode: e.mode, priceRol: e.priceRol,
      enrollments: e.enrollments, learners: e.learners.size, completed: e.completed, passRate: rate(e), avgScore: avg(e),
      avgRating: rating(e), ratings: e.ratingCount,
    })),
    (a, b) =>
      b.avgRating - a.avgRating || b.ratings - a.ratings || b.avgScore - a.avgScore || b.enrollments - a.enrollments || a.title.localeCompare(b.title),
  );

  return {
    totals: {
      units: unitAgg.size,
      learners: learnerAgg.size,
      exams: examAgg.size,
      certificates: [...unitAgg.values()].reduce((n, u) => n + u.certificates, 0),
    },
    units: units_,
    learners: learners_,
    exams: exams_,
  };
}

/**
 * Roll up taker star ratings from every session into per-exam and per-unit averages
 * (rounded to 1 dp) with a count. A unit's rating pools ALL ratings across its exams
 * (so a busier exam weighs more), matching the leaderboard's unit rating. Pure — used
 * to overlay ratings onto the public unit directory / profile, which are otherwise
 * authoring-only. Returns `{ exams: {examId:{rating,ratings}}, units: {unitId:{...}} }`.
 */
function aggregateRatings(data) {
  const exams = {};
  const units = {};
  const bump = (map, key, stars) => {
    const a = (map[key] = map[key] || { sum: 0, count: 0 });
    a.sum += stars;
    a.count += 1;
  };
  for (const u of Object.values(data.users || {})) {
    for (const s of Object.values(u.sessions || {})) {
      const stars = s.rating?.stars;
      if (!Number.isInteger(stars)) continue;
      bump(exams, s.examId, stars);
      const unitId = s.snapshot?.ownerUnitId;
      if (unitId) bump(units, unitId, stars);
    }
  }
  const finalize = (map) => {
    const out = {};
    for (const [k, a] of Object.entries(map)) out[k] = { rating: Math.round((a.sum / a.count) * 10) / 10, ratings: a.count };
    return out;
  };
  return { exams: finalize(exams), units: finalize(units) };
}

/**
 * Grade a session that is parked in `submitted` (either an explicit submit or an
 * expiry auto-submit). Calls the grading service outside the mutate; on success
 * commits the result and finalizes (`scored` / `expired_scored`) and applies the
 * attempt-limit cooldown lock on a failed final attempt. If grading is
 * unavailable the session stays `submitted` and the caller returns grading_pending.
 * Idempotent: a session that already has a result (or isn't submitted) is a no-op.
 * @returns {Promise<{code:"OK"|"PENDING"|"NOT_FOUND", session?}>}
 */
async function gradeIfPending(userId, sessionId, grading) {
  const data = await db.getAll();
  const current = findSession(data, userId, sessionId);
  if (!current) return { code: "NOT_FOUND" };
  if (current.state !== "submitted" || current.result) return { code: "OK", session: current };

  const items = buildGradeItems(current);
  const passPct = current.snapshot.passPct;
  let reply;
  try {
    reply = await grading.gradeAttempt(items, passPct);
  } catch (err) {
    log.warn("grade: grading unavailable", { id: sessionId, error: err.message });
    return { code: "PENDING", session: current };
  }

  const outcome = await db.mutate((store) => {
    const session = findSession(store, userId, sessionId);
    if (!session) return { value: { code: "NOT_FOUND" } };
    if (session.state !== "submitted" || session.result) {
      return { next: store, value: { code: "OK", session } }; // someone else won the race
    }
    const now = clock.now();
    session.result = {
      scorePct: reply.score_pct,
      passed: reply.passed,
      perQuestion: reply.per_question || [],
      finalizedAt: new Date(now).toISOString(),
      certNo: null,
      ...(reply.passed ? { certificateStatus: "pending" } : {}),
    };
    session.state = session.finalReason === "expiry" ? "expired_scored" : "scored";

    const user = store.users[userId];
    let locks = user.locks || {};
    if (!reply.passed) {
      const used = user.attempts?.[session.examId] || 0;
      if (used >= session.snapshot.attemptsAllowed) {
        locks = { ...locks, [session.examId]: now + COOLDOWN_MS };
      }
    }
    const nextUser = { ...user, locks, sessions: { ...user.sessions, [session.id]: session } };
    return { next: { ...store, users: { ...store.users, [userId]: nextUser } }, value: { code: "OK", session } };
  });
  return outcome;
}

/**
 * Mint a certificate for a passed-but-unissued session. Idempotent per session
 * both here (skips once a `certNo` is stored) and at the issuer (keyed by
 * { examId, holder, sessionId }). Issuer unavailable → the result stays
 * `certificateStatus: "pending"` and the next touch retries.
 */
async function issueIfNeeded(userId, sessionId, certificates) {
  const data = await db.getAll();
  const s = findSession(data, userId, sessionId);
  if (!s || !s.result || !s.result.passed || s.result.certNo) return;

  let reply;
  try {
    reply = await certificates.issue({
      examId: s.examId,
      examTitle: s.snapshot.title,
      ownerUnitId: s.snapshot.ownerUnitId,
      unitName: s.snapshot.unitName,
      holder: userId,
      sessionId: s.id,
      scorePct: s.result.scorePct,
      certValidMonths: s.snapshot.certValidMonths,
      template: s.snapshot.certTemplate,
    });
  } catch (err) {
    log.warn("issue: issuer error", { id: sessionId, error: err.message });
    return; // stays pending
  }

  if ((reply.status === 200 || reply.status === 201) && reply.body?.certNo) {
    await db.mutate((store) => {
      const session = findSession(store, userId, sessionId);
      if (!session || !session.result) return { value: null };
      session.result = { ...session.result, certNo: reply.body.certNo, certificateStatus: "issued" };
      return { next: store, value: null };
    });
  } else {
    log.warn("issue: issuer unavailable", { id: sessionId, status: reply.status });
  }
}

/**
 * The read/finalize pipeline shared by GET and submit: grade a parked attempt,
 * then (on a pass) mint the certificate, re-reading the session so the response
 * carries the freshly-issued `certNo`. Returns the same `{ code, session }` shape
 * as gradeIfPending (PENDING when grading is still unavailable).
 */
async function settleGradeIssue(userId, sessionId, grading, certificates) {
  const graded = await gradeIfPending(userId, sessionId, grading);
  if (graded.code !== "OK") return graded;
  if (graded.session?.result?.passed && !graded.session.result.certNo) {
    await issueIfNeeded(userId, sessionId, certificates);
    const data = await db.getAll();
    const fresh = findSession(data, userId, sessionId);
    return { code: "OK", session: fresh || graded.session };
  }
  return graded;
}

// ---- app --------------------------------------------------------------------

function buildApp({
  authoring = require("../clients/authoring-client"),
  questionBank = require("../clients/question-bank-client"),
  grading = require("../clients/grading-client"),
  certificates = require("../clients/certificate-client"),
} = {}) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "SERVING", version: SERVICE_VERSION, uptime_ms: Date.now() - startedAt });
  });

  // Aggregate health across all five services (self + authoring + 2 gRPC leaves +
  // issuer). Never throws: an unreachable service becomes UNREACHABLE.
  app.get("/health/all", async (req, res) => {
    const services = [
      { name: "exam-center", status: "SERVING", version: SERVICE_VERSION, uptimeMs: Date.now() - startedAt, target: `:${PORT}` },
    ];
    const httpProbe = async (name, client) => {
      try {
        const r = await client.health();
        if (r && r.status === 200)
          return { name, status: "SERVING", version: r.body?.version || "", uptimeMs: r.body?.uptime_ms || 0, target: client.target };
      } catch {
        /* fall through */
      }
      return { name, status: "UNREACHABLE", version: "", uptimeMs: 0, target: client.target };
    };
    const grpcProbe = async (name, client) => {
      try {
        const r = await client.health();
        return { name, status: "SERVING", version: r.version || "", uptimeMs: r.uptime_ms || 0, target: client.target };
      } catch {
        return { name, status: "UNREACHABLE", version: "", uptimeMs: 0, target: client.target };
      }
    };
    const results = await Promise.all([
      httpProbe("authoring", authoring),
      grpcProbe("question-bank", questionBank),
      grpcProbe("grading", grading),
      httpProbe("certificate-issuer", certificates),
    ]);
    services.push(...results);
    const down = results.filter((s) => s.status !== "SERVING").length;
    const overall = down === 0 ? "SERVING" : down === results.length ? "DOWN" : "DEGRADED";
    res.status(overall === "SERVING" ? 200 : 503).json({ overall, services });
  });

  // Public catalog — proxied from authoring's published read surface.
  app.get("/v1/exams", async (req, res) => {
    const r = await authoring.listPublishedExams();
    if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    res.status(r.status).json(r.body);
  });

  app.get("/v1/exams/:examId", async (req, res) => {
    const r = await authoring.getPublishedExam(req.params.examId);
    if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    if (r.status === 404) return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    res.status(r.status).json(r.body);
  });

  // Public unit directory / profile — proxied from authoring, then overlaid with
  // taker star ratings (owned here, in the session store). Each unit gets an overall
  // `rating`/`ratings`; on the profile, each exam card gets its own `rating`/`ratings`.
  app.get("/v1/units", async (req, res) => {
    const r = await authoring.listPublicUnits();
    if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    if (r.status === 200 && Array.isArray(r.body?.units)) {
      try {
        const { units } = aggregateRatings(await db.getAll());
        for (const u of r.body.units) {
          const ur = units[u.unitId] || { rating: 0, ratings: 0 };
          u.rating = ur.rating;
          u.ratings = ur.ratings;
        }
      } catch (err) {
        log.warn("units: rating overlay failed", { error: err.message });
      }
    }
    res.status(r.status).json(r.body);
  });
  app.get("/v1/units/:unitId", async (req, res) => {
    const r = await authoring.getPublicUnit(req.params.unitId);
    if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    if (r.status === 404) return res.status(404).json({ error: "UNIT_NOT_FOUND" });
    if (r.status === 200 && r.body) {
      try {
        const { exams, units } = aggregateRatings(await db.getAll());
        const ur = units[req.params.unitId] || { rating: 0, ratings: 0 };
        r.body.rating = ur.rating;
        r.body.ratings = ur.ratings;
        for (const e of r.body.exams || []) {
          const er = exams[e.id] || { rating: 0, ratings: 0 };
          e.rating = er.rating;
          e.ratings = er.ratings;
        }
      } catch (err) {
        log.warn("unit profile: rating overlay failed", { error: err.message });
      }
    }
    res.status(r.status).json(r.body);
  });

  // Public, anonymized leaderboards for the showcase page — cross-unit rankings of
  // units, (aliased) learners, and exams. Seeded from authoring's public units +
  // published exams so the boards render even before much activity. No identity;
  // degrades gracefully (empty catalog) if authoring is unavailable.
  app.get("/v1/leaderboard", async (req, res) => {
    let units = [];
    let exams = [];
    try {
      const r = await authoring.listPublicUnits();
      if (r.status === 200) units = r.body?.units || [];
    } catch {
      /* degrade: derive units from sessions only */
    }
    try {
      const r = await authoring.listPublishedExams();
      if (r.status === 200) exams = r.body?.exams || [];
    } catch {
      /* degrade: derive exams from sessions only */
    }
    try {
      const data = await db.getAll();
      res.status(200).json({ generatedAt: new Date(clock.now()).toISOString(), ...computeLeaderboards(data, units, exams, 50) });
    } catch (err) {
      log.error("leaderboard failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Owner-only unit analytics — enrollments, completions, passes, certificates,
  // scores (per-exam + overall). Ownership is verified against authoring: the
  // caller's own unit must be the requested unit. Income (ROL) is added by the
  // Rolnopol bridge, which is the only place money lives.
  app.get("/v1/units/:unitId/analytics", async (req, res) => {
    const userId = req.get("x-academy-user");
    if (!userId) return res.status(401).json({ error: "MISSING_IDENTITY" });
    const unitId = req.params.unitId;

    let myUnit;
    try {
      const r = await authoring.getMyUnit(userId);
      if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
      myUnit = r.status === 200 ? r.body : null;
    } catch (err) {
      log.warn("analytics: authoring unavailable", { error: err.message });
      return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    }
    if (!myUnit || myUnit.unitId !== unitId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "only the unit owner can view analytics" });
    }

    // Seed per-exam rows from the unit's published exams (so zero-enrollment exams show).
    let publishedExams = [];
    try {
      const r = await authoring.listPublishedExams();
      if (r.status === 200) publishedExams = (r.body.exams || []).filter((e) => e.ownerUnitId === unitId);
    } catch {
      /* degrade: derive exams from sessions only */
    }

    try {
      const data = await db.getAll();
      res.status(200).json(aggregateUnitAnalytics(data, unitId, myUnit.name, publishedExams));
    } catch (err) {
      log.error("analytics failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Everything under /v1/sessions requires the forwarded identity header.
  app.use("/v1/sessions", (req, res, next) => {
    const u = req.get("x-academy-user");
    if (!u) return res.status(401).json({ error: "MISSING_IDENTITY" });
    req.academyUser = String(u);
    next();
  });

  // Create a session. Reads + snapshots the published exam def from authoring.
  // Free exams open the access window immediately (entitled); paid exams park as
  // awaiting_payment (settled in Phase 4).
  app.post("/v1/sessions", async (req, res) => {
    const userId = req.academyUser;
    const examId = req.body?.examId;
    if (!examId) return res.status(400).json({ error: "examId required" });

    const defRes = await authoring.getPublishedExam(examId);
    if (defRes.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    if (defRes.status === 404) return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (defRes.status !== 200) return res.status(502).json({ error: "AUTHORING_BAD_RESPONSE" });
    const def = defRes.body;

    try {
      const { session, reused } = await db.mutate((data) => {
        const now = clock.now();
        const user = data.users[userId] || { sessions: {}, attempts: {}, locks: {} };

        // Idempotent enroll: reuse an existing OPEN enrollment for this exam instead
        // of minting a duplicate. This stops duplicate rows piling up in the taker's
        // history, and — because the ROL charge is keyed by session id — stops a paid
        // exam being charged again on every click. Settle first so a lapsed session
        // (expired window / abandoned) drops out of the reusable set.
        for (const s of Object.values(user.sessions || {})) {
          if (s.examId !== def.id) continue;
          settle(s, now);
          if (OPEN_ENROLLMENT_STATES.has(s.state)) {
            const nextUser = { ...user, sessions: { ...user.sessions, [s.id]: s } };
            return { next: { ...data, users: { ...data.users, [userId]: nextUser } }, value: { session: s, reused: true } };
          }
        }

        const seq = (data.seq || 0) + 1;
        const snapshot = {
          examId: def.id,
          title: def.title,
          questionCount: def.questionCount,
          durationSec: def.durationSec,
          accessWindowDays: def.accessWindowDays,
          passPct: def.passPct,
          attemptsAllowed: def.attemptsAllowed,
          certValidMonths: def.certValidMonths,
          certTemplate: def.certTemplate,
          pricing: def.pricing,
          ownerUnitId: def.ownerUnitId,
          unitName: def.unit?.name,
          payoutUserId: def.payoutUserId,
        };
        const session = {
          id: `sess-${seq}`,
          userId,
          examId: def.id,
          snapshot,
          seed: null,
          answers: {},
          questions: null,
          entitledAt: null,
          accessExpiresAt: null,
          startedAt: null,
          expiresAt: null,
          submittedAt: null,
          finalReason: null,
          result: null,
        };
        if (def.pricing?.mode === "paid") {
          session.state = "awaiting_payment";
          session.activationExpiresAt = now + ACTIVATION_TTL_MS;
          session.payment = { priceRol: def.pricing.priceRol, ownerUnitId: def.ownerUnitId, payoutUserId: def.payoutUserId };
        } else {
          session.state = "entitled";
          session.entitledAt = now;
          session.accessExpiresAt = now + def.accessWindowDays * DAY_MS;
        }
        const nextUser = { ...user, sessions: { ...user.sessions, [session.id]: session } };
        return { next: { ...data, seq, users: { ...data.users, [userId]: nextUser } }, value: { session, reused: false } };
      });
      log.info(reused ? "session reused" : "session created", { id: session.id, examId, state: session.state, user: userId });
      res.status(reused ? 200 : 201).json(sessionView(session));
    } catch (err) {
      log.error("create session failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // List the caller's sessions (lazy-settled). Paid sessions carry the pricing +
  // payout fields the Rolnopol money bridge needs for reconciliation; these are
  // never on the per-session taker view.
  app.get("/v1/sessions", async (req, res) => {
    const userId = req.academyUser;
    try {
      const sessions = await db.mutate((data) => {
        const user = data.users?.[userId];
        const now = clock.now();
        const out = [];
        for (const s of Object.values(user?.sessions || {})) {
          settle(s, now);
          const view = sessionView(s);
          view.examTitle = s.snapshot?.title || s.examId;
          // A single "attempt date" (epoch ms) for the taker's history table:
          // finalized › started › enrolled/entitled › submitted.
          view.date =
            (s.result?.finalizedAt ? Date.parse(s.result.finalizedAt) : null) || s.startedAt || s.entitledAt || s.submittedAt || null;
          if (s.snapshot?.pricing?.mode === "paid") {
            view.pricing = s.snapshot.pricing;
            view.priceRol = s.snapshot.pricing.priceRol;
            view.payoutUserId = s.snapshot.payoutUserId;
          }
          out.push(view);
        }
        return { next: data, value: out };
      });
      res.status(200).json({ sessions: sessions || [] });
    } catch (err) {
      log.error("list sessions failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Start the attempt within the access window — draw questions from the bank and
  // begin the completion clock. Attempt is consumed HERE. Enforces the attempt
  // limit + cooldown lock.
  app.post("/v1/sessions/:id/start", async (req, res) => {
    const userId = req.academyUser;
    try {
      // Step 1: settle + check current state / attempt lock (persists any transition).
      const pre = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());
        if (session.state === "active") return { next: data, value: { code: "ACTIVE", session } }; // idempotent
        if (session.state === "awaiting_payment") return { next: data, value: { code: "PAYMENT_REQUIRED" } };
        if (session.state !== "entitled") return { next: data, value: { code: "GONE", state: session.state } };

        // Attempt policy: enforce the exam lock before consuming an attempt.
        const now = clock.now();
        const user = data.users[userId];
        const lockedUntil = user.locks?.[session.examId];
        if (lockedUntil != null && now < lockedUntil) {
          return { next: data, value: { code: "LOCKED", lockedUntil } };
        }
        if (lockedUntil != null) {
          // Cooldown elapsed → fresh slate of attempts.
          const attempts = { ...user.attempts, [session.examId]: 0 };
          const locks = { ...user.locks };
          delete locks[session.examId];
          data.users[userId] = { ...user, attempts, locks };
          return { next: data, value: { code: "ENTITLED", session } };
        }
        const used = user.attempts?.[session.examId] || 0;
        if (used >= session.snapshot.attemptsAllowed) {
          // Limit reached with no lock (e.g. abandoned attempts) → lock now.
          const locks = { ...user.locks, [session.examId]: now + COOLDOWN_MS };
          data.users[userId] = { ...user, locks };
          return { next: data, value: { code: "LOCKED", lockedUntil: now + COOLDOWN_MS } };
        }
        return { next: data, value: { code: "ENTITLED", session } };
      });
      if (!pre || pre.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (pre.code === "ACTIVE") return res.status(200).json(sessionView(pre.session)); // idempotent replay
      if (pre.code === "PAYMENT_REQUIRED") return res.status(409).json({ error: "PAYMENT_REQUIRED" });
      if (pre.code === "LOCKED") return res.status(403).json({ error: "EXAM_LOCKED", lockedUntil: pre.lockedUntil });
      if (pre.code === "GONE") return res.status(410).json({ error: "ACCESS_WINDOW_EXPIRED", state: pre.state });

      // Step 2: draw questions (async, outside the mutate).
      const s = pre.session;
      const seed = newSeed();
      let drawn;
      try {
        const reply = await questionBank.draw(s.examId, s.snapshot.questionCount, seed);
        drawn = reply.questions || [];
      } catch (err) {
        log.warn("start: bank unavailable", { id: s.id, error: err.message });
        return res.status(503).json({ error: "QUESTION_BANK_UNAVAILABLE" });
      }
      if (!drawn.length) return res.status(502).json({ error: "NO_QUESTIONS" });

      // Step 3: commit the draw (re-check state; idempotent under a race).
      const outcome = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());
        if (session.state === "active") return { next: data, value: { code: "OK", session } }; // someone else won the race
        if (session.state !== "entitled") return { next: data, value: { code: "GONE", session } };

        const now = clock.now();
        const user = data.users[userId];
        const attempts = { ...user.attempts, [session.examId]: (user.attempts?.[session.examId] || 0) + 1 };
        session.seed = seed;
        session.questions = drawn.map((q) => ({
          id: q.id,
          type: q.type,
          text: q.text,
          options: q.options || [],
          correct: q.correct || [],
          weight: q.weight || 1,
        }));
        session.startedAt = now;
        session.expiresAt = now + session.snapshot.durationSec * 1000;
        session.state = "active";
        const nextUser = { ...user, attempts, sessions: { ...user.sessions, [session.id]: session } };
        return { next: { ...data, users: { ...data.users, [userId]: nextUser } }, value: { code: "OK", session } };
      });

      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (outcome.code === "GONE") return res.status(410).json({ error: "ACCESS_WINDOW_EXPIRED", state: outcome.session.state });
      log.info("session started", { id: outcome.session.id, user: userId });
      res.status(200).json(sessionView(outcome.session));
    } catch (err) {
      log.error("start session failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Entitle — INTERNAL, called by the Rolnopol bridge after a successful ROL
  // charge. awaiting_payment → entitled (opens the access window). No draw, no
  // attempt, no completion clock. Idempotent.
  app.post("/v1/sessions/:id/entitle", async (req, res) => {
    const userId = req.academyUser;
    try {
      const outcome = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());
        if (session.state === "entitled") return { next: data, value: { code: "OK", session } }; // idempotent
        if (session.state === "abandoned") return { next: data, value: { code: "GONE", state: session.state } };
        if (session.state !== "awaiting_payment") return { next: data, value: { code: "CONFLICT", state: session.state } };
        const now = clock.now();
        session.state = "entitled";
        session.entitledAt = now;
        session.accessExpiresAt = now + session.snapshot.accessWindowDays * DAY_MS;
        return { next: data, value: { code: "OK", session } };
      });
      if (!outcome || outcome.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (outcome.code === "GONE") return res.status(410).json({ error: "SESSION_ABANDONED", state: outcome.state });
      if (outcome.code === "CONFLICT") return res.status(409).json({ error: "NOT_AWAITING_PAYMENT", state: outcome.state });
      log.info("session entitled", { id: outcome.session.id, user: userId });
      res.status(200).json(sessionView(outcome.session));
    } catch (err) {
      log.error("entitle failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Resume / poll — lazy-settled, then lazy-graded (retries a parked grade).
  app.get("/v1/sessions/:id", async (req, res) => {
    const userId = req.academyUser;
    try {
      const pre = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());
        return { next: data, value: { code: "OK" } };
      });
      if (!pre || pre.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });

      const graded = await settleGradeIssue(userId, req.params.id, grading, certificates);
      if (graded.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (graded.code === "PENDING") {
        return res.status(200).json({ ...sessionView(graded.session), status: "grading_pending" });
      }
      res.status(200).json(sessionView(graded.session));
    } catch (err) {
      log.error("get session failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Save/overwrite one answer. Idempotent. Enforces the completion deadline.
  app.put("/v1/sessions/:id/answers/:qid", async (req, res) => {
    const userId = req.academyUser;
    const answer = req.body?.answer;
    try {
      const outcome = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());

        if (session.state === "awaiting_payment") return { next: data, value: { code: "PAYMENT_REQUIRED" } };
        if (session.state === "entitled") return { next: data, value: { code: "NOT_STARTED" } };
        if (session.state === "scored") return { next: data, value: { code: "ALREADY_SUBMITTED" } };
        if (session.state !== "active") return { next: data, value: { code: "GONE" } }; // submitted / expired_scored / abandoned

        if (!session.questions.some((q) => q.id === req.params.qid)) {
          return { next: data, value: { code: "UNKNOWN_QUESTION" } };
        }
        session.answers = { ...session.answers, [req.params.qid]: answer };
        return { next: data, value: { code: "OK", session } };
      });

      if (!outcome || outcome.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (outcome.code === "PAYMENT_REQUIRED") return res.status(409).json({ error: "PAYMENT_REQUIRED" });
      if (outcome.code === "NOT_STARTED") return res.status(409).json({ error: "NOT_STARTED" });
      if (outcome.code === "ALREADY_SUBMITTED") return res.status(409).json({ error: "ALREADY_SUBMITTED" });
      if (outcome.code === "GONE") return res.status(410).json({ error: "SESSION_EXPIRED" });
      if (outcome.code === "UNKNOWN_QUESTION") return res.status(404).json({ error: "UNKNOWN_QUESTION" });
      res.status(200).json({ saved: true, questionId: req.params.qid });
    } catch (err) {
      log.error("save answer failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Submit — freeze the attempt then grade via the grading service. Idempotent
  // once scored; grading unavailable → 202 grading_pending (retried on next GET).
  app.post("/v1/sessions/:id/submit", async (req, res) => {
    const userId = req.academyUser;
    try {
      // Step 1: settle + freeze active → submitted (finalReason "submit").
      const pre = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        settle(session, clock.now());

        if (session.state === "scored" || session.state === "expired_scored") {
          return { next: data, value: { code: "DONE", session } }; // idempotent
        }
        if (session.state === "awaiting_payment") return { next: data, value: { code: "PAYMENT_REQUIRED" } };
        if (session.state === "entitled") return { next: data, value: { code: "NOT_STARTED" } };
        if (session.state === "submitted") return { next: data, value: { code: "SUBMITTED" } }; // frozen (expiry / prior submit)
        if (session.state !== "active") return { next: data, value: { code: "GONE", state: session.state } };

        session.state = "submitted";
        session.finalReason = "submit";
        session.submittedAt = clock.now();
        return { next: data, value: { code: "SUBMITTED" } };
      });

      if (!pre || pre.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (pre.code === "PAYMENT_REQUIRED") return res.status(409).json({ error: "PAYMENT_REQUIRED" });
      if (pre.code === "NOT_STARTED") return res.status(409).json({ error: "NOT_STARTED" });
      if (pre.code === "GONE") return res.status(410).json({ error: "SESSION_EXPIRED", state: pre.state });
      if (pre.code === "DONE") return res.status(200).json(sessionView(pre.session));

      // Step 2: grade the frozen attempt, then issue on a pass. Grading down → grading_pending.
      const graded = await settleGradeIssue(userId, req.params.id, grading, certificates);
      if (graded.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (graded.code === "PENDING") {
        return res.status(202).json({ status: "grading_pending", sessionId: req.params.id, state: "submitted" });
      }
      log.info("session submitted", { id: graded.session.id, passed: graded.session.result.passed });
      res.status(200).json(sessionView(graded.session));
    } catch (err) {
      log.error("submit session failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Rate a passed exam 1–5 stars (idempotent — re-rating overwrites the previous
  // value). Only the taker of a scored, PASSED session may rate it; anything else
  // is rejected. Feeds the "highest-rated certifications" leaderboard.
  app.post("/v1/sessions/:id/rating", async (req, res) => {
    const userId = req.academyUser;
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "INVALID_RATING", message: "stars must be an integer 1–5" });
    }
    try {
      const outcome = await db.mutate((data) => {
        const session = findSession(data, userId, req.params.id);
        if (!session) return { value: { code: "NOT_FOUND" } };
        const scored = (session.state === "scored" || session.state === "expired_scored") && session.result;
        if (!scored || !session.result.passed) return { next: data, value: { code: "NOT_RATEABLE", state: session.state } };
        session.rating = { stars, ratedAt: new Date(clock.now()).toISOString() };
        return { next: data, value: { code: "OK", session } };
      });
      if (!outcome || outcome.code === "NOT_FOUND") return res.status(404).json({ error: "SESSION_NOT_FOUND" });
      if (outcome.code === "NOT_RATEABLE") {
        return res.status(409).json({ error: "NOT_RATEABLE", message: "only a passed exam can be rated", state: outcome.state });
      }
      log.info("session rated", { id: outcome.session.id, stars });
      res.status(200).json(sessionView(outcome.session));
    } catch (err) {
      log.error("rate session failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // ── Certificates ─────────────────────────────────────────────────────────────

  // The caller's earned certificates, gathered from their scored sessions. The
  // issuer owns the canonical records; the exam center already stored each certNo
  // on the session's result, so this needs no issuer round-trip.
  app.get("/v1/certificates", async (req, res) => {
    const userId = req.get("x-academy-user");
    if (!userId) return res.status(401).json({ error: "MISSING_IDENTITY" });
    const data = await db.getAll();
    const user = data.users?.[String(userId)];
    const list = [];
    for (const s of Object.values(user?.sessions || {})) {
      if (s.result?.certNo) {
        list.push({
          certNo: s.result.certNo,
          examId: s.examId,
          examTitle: s.snapshot?.title,
          scorePct: s.result.scorePct,
          sessionId: s.id,
          finalizedAt: s.result.finalizedAt,
        });
      }
    }
    res.status(200).json({ certificates: list });
  });

  // Public verification — proxied to the issuer (no identity).
  app.get("/v1/verify/:certNo", async (req, res) => {
    const r = await certificates.verify(req.params.certNo);
    if (r.status === 503) return res.status(503).json({ error: "CERTIFICATE_ISSUER_UNAVAILABLE" });
    res.status(r.status).json(r.body);
  });

  // Revoke — unit-owner only. Verify the cert, confirm the caller owns the issuing
  // unit (checked against authoring), then proxy the revoke to the issuer.
  app.post("/v1/certificates/:certNo/revoke", async (req, res) => {
    const userId = req.get("x-academy-user");
    if (!userId) return res.status(401).json({ error: "MISSING_IDENTITY" });

    const ver = await certificates.verify(req.params.certNo);
    if (ver.status === 503) return res.status(503).json({ error: "CERTIFICATE_ISSUER_UNAVAILABLE" });
    if (ver.status !== 200 || !ver.body || ver.body.status === "unknown") {
      return res.status(404).json({ error: "CERTIFICATE_NOT_FOUND" });
    }

    let myUnit;
    try {
      const r = await authoring.getMyUnit(userId);
      if (r.status === 503) return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
      myUnit = r.status === 200 ? r.body : null;
    } catch (err) {
      log.warn("revoke: authoring unavailable", { error: err.message });
      return res.status(503).json({ error: "AUTHORING_UNAVAILABLE" });
    }
    if (!myUnit || myUnit.unitId !== ver.body.unit) {
      return res.status(403).json({ error: "FORBIDDEN", message: "only the issuing unit can revoke" });
    }

    const r = await certificates.revoke(req.params.certNo, req.body?.reason);
    if (r.status === 503) return res.status(503).json({ error: "CERTIFICATE_ISSUER_UNAVAILABLE" });
    res.status(r.status).json(r.body);
  });

  return app;
}

async function start() {
  await db.init();
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "exam-center", host: HOST, port: server.address().port, path: db.DB_PATH });
  });
  const shutdown = (signal) => {
    log.info("shutting down", { signal });
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

if (require.main === module) start();

module.exports = { buildApp, start, publicQuestion, settle, buildGradeItems, aggregateUnitAnalytics, computeLeaderboards, learnerAlias, aggregateRatings };
