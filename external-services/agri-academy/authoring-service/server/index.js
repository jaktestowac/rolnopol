/**
 * Authoring REST service — standalone process (:4352).
 * Start with:  npm run academy:authoring
 *
 * Authoring / command plane. Owns certification units + exam definitions; authors
 * questions by dialing the question-bank's write RPCs. Also serves the PUBLIC unit
 * pages and the PUBLISHED read surface the exam center depends on.
 *
 *   Authoring (x-academy-user required):
 *     POST/GET/PATCH /v1/units[/me]  · POST /v1/units/me/(disable|enable)
 *     POST/GET/PATCH /v1/exams[/:id]  · POST /v1/exams/:id/(publish|unpublish|disable|enable)
 *     POST/PATCH/DELETE/GET /v1/exams/:id/questions[/:qid]   (proxied to the bank)
 *   Public (no identity):
 *     GET /v1/public/units[/:unitId]           (fancy unit directory + profile)
 *     GET /v1/published/exams[/:id]            (read surface for the exam center)
 *
 * Availability has two orthogonal switches on top of publish: a per-exam `enabled`
 * flag and a per-unit `status` (active|disabled). An exam is takeable only when it
 * is published AND enabled AND its unit is not disabled; anything else is invisible
 * to takers (absent from both the public surfaces and the exam center's read plane).
 *
 * Ownership: every authoring write is scoped to the caller's unit (derived from
 * x-academy-user); cross-unit writes → 403.
 */
const express = require("express");
const { HOST, PORT } = require("../config");
const db = require("./db");
const questionTypes = require("../question-types");
const { ICON_KEYS, PALETTE, DEFAULT_ICON, DEFAULT_COLOR, sanitizeBranding } = require("../unit-presets");
const { TEMPLATES, TEMPLATE_IDS, DEFAULT_TEMPLATE, isValidTemplate } = require("../../shared/cert-templates");
const { nowIso } = require("../../shared/clock");
const { createLogger } = require("../../shared/logger");

const log = createLogger("authoring");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

// ── shapes ───────────────────────────────────────────────────────────────────

function publishedExamDef(exam, unit) {
  return {
    id: exam.id,
    ownerUnitId: exam.ownerUnitId,
    // payoutUserId travels on the exam-center-only read surface so the money bridge
    // can credit the unit; it is NEVER on the public unit profile (publicExamCard).
    payoutUserId: unit ? unit.payoutUserId : null,
    unit: unit ? { unitId: unit.unitId, name: unit.name } : null,
    title: exam.title,
    description: exam.description,
    questionCount: exam.questionCount,
    durationSec: exam.durationSec,
    accessWindowDays: exam.accessWindowDays,
    passPct: exam.passPct,
    attemptsAllowed: exam.attemptsAllowed,
    certValidMonths: exam.certValidMonths,
    certTemplate: exam.certTemplate || DEFAULT_TEMPLATE,
    pricing: exam.pricing,
  };
}

function publicExamCard(exam) {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    certTemplate: exam.certTemplate || DEFAULT_TEMPLATE,
    durationSec: exam.durationSec,
    accessWindowDays: exam.accessWindowDays,
    passPct: exam.passPct,
    attemptsAllowed: exam.attemptsAllowed,
    pricing: exam.pricing,
  };
}

function unitForUser(data, userId) {
  return Object.values(data.units || {}).find((u) => u.ownerUserId === userId) || null;
}
// A unit is disabled when its owner has switched it off; every exam it owns then
// becomes untakeable. Absent status is treated as active (back-compat with older data).
function isUnitDisabled(unit) {
  return unit?.status === "disabled";
}
// An exam is takeable only when it is published, individually enabled (absent flag
// = enabled, back-compat), and owned by a unit that is not disabled.
function isExamTakeable(exam, unit) {
  return exam.status === "published" && exam.enabled !== false && !!unit && !isUnitDisabled(unit);
}
// Published exams of a unit that a taker may actually see/take (drops disabled exams;
// callers already skip disabled units).
function publishedExamsOfUnit(data, unitId) {
  const unit = data.units?.[unitId];
  return Object.values(data.exams || {}).filter((e) => e.ownerUnitId === unitId && isExamTakeable(e, unit));
}

function validateExamInput(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  const num = (v) => Number(v);
  const want = (k) => !partial || b[k] !== undefined;

  if (want("title")) {
    if (!String(b.title || "").trim()) return { error: "title required" };
    out.title = String(b.title).trim();
  }
  if (want("description")) out.description = String(b.description || "").trim();
  if (want("durationSec")) {
    const n = num(b.durationSec);
    if (!(n > 0)) return { error: "durationSec must be > 0" };
    out.durationSec = Math.floor(n);
  }
  if (want("accessWindowDays")) {
    const n = num(b.accessWindowDays);
    if (!(n >= 1)) return { error: "accessWindowDays must be >= 1" };
    out.accessWindowDays = Math.floor(n);
  }
  if (want("passPct")) {
    const n = num(b.passPct);
    if (!(n >= 1 && n <= 100)) return { error: "passPct must be 1..100" };
    out.passPct = Math.floor(n);
  }
  if (want("attemptsAllowed")) {
    const n = num(b.attemptsAllowed);
    if (!(n >= 1)) return { error: "attemptsAllowed must be >= 1" };
    out.attemptsAllowed = Math.floor(n);
  }
  if (want("certValidMonths")) {
    const n = num(b.certValidMonths);
    if (!(n >= 1)) return { error: "certValidMonths must be >= 1" };
    out.certValidMonths = Math.floor(n);
  }
  if (want("questionCount")) {
    const n = num(b.questionCount);
    if (!(n >= 1)) return { error: "questionCount must be >= 1" };
    out.questionCount = Math.floor(n);
  }
  if (want("pricing")) {
    const p = b.pricing || {};
    if (!["free", "paid"].includes(p.mode)) return { error: "pricing.mode must be free|paid" };
    const priceRol = p.mode === "paid" ? num(p.priceRol) : 0;
    if (p.mode === "paid" && !(priceRol > 0)) return { error: "paid exams need priceRol > 0" };
    out.pricing = { mode: p.mode, priceRol };
  }
  // Certificate template: pick from the predefined set. Optional (defaults on create).
  if (b.certTemplate !== undefined) {
    if (!isValidTemplate(b.certTemplate)) return { error: "certTemplate must be one of the predefined templates" };
    out.certTemplate = b.certTemplate;
  } else if (!partial) {
    out.certTemplate = DEFAULT_TEMPLATE;
  }
  return { value: out };
}

// ── app ──────────────────────────────────────────────────────────────────────

function buildApp({ questionBank = require("../clients/question-bank-client") } = {}) {
  const app = express();
  app.use(express.json());

  app.get("/health", async (req, res) => {
    const data = await db.getAll().catch(() => null);
    res.json({
      status: "SERVING",
      version: SERVICE_VERSION,
      uptime_ms: Date.now() - startedAt,
      unit_count: data ? Object.keys(data.units || {}).length : 0,
      exam_count: data ? Object.keys(data.exams || {}).length : 0,
    });
  });

  // Predefined branding presets (icons + palette) for the unit console picker.
  app.get("/v1/unit-presets", (req, res) => {
    res.json({ icons: ICON_KEYS, palette: PALETTE, defaultIcon: DEFAULT_ICON, defaultColor: DEFAULT_COLOR });
  });

  // The ten predefined certificate templates, for the exam-creation picker + preview.
  app.get("/v1/cert-templates", (req, res) => {
    res.json({ templates: TEMPLATES, defaultTemplate: DEFAULT_TEMPLATE });
  });

  // ── Public: unit directory + profile (no identity) ──────────────────────────
  app.get("/v1/public/units", async (req, res) => {
    const data = await db.getAll();
    const units = Object.values(data.units || {})
      .filter((u) => !isUnitDisabled(u)) // a disabled unit disappears from the public directory
      .map((u) => ({
      unitId: u.unitId,
      name: u.name,
      description: u.description,
      tags: u.tags || [],
      color: u.color || DEFAULT_COLOR,
      icon: u.icon || DEFAULT_ICON,
      examCount: publishedExamsOfUnit(data, u.unitId).length,
    }));
    res.json({ units });
  });

  app.get("/v1/public/units/:unitId", async (req, res) => {
    const data = await db.getAll();
    const unit = data.units?.[req.params.unitId];
    if (!unit || isUnitDisabled(unit)) return res.status(404).json({ error: "UNIT_NOT_FOUND" }); // disabled → hidden publicly
    res.json({
      unitId: unit.unitId,
      name: unit.name,
      description: unit.description,
      tags: unit.tags || [],
      color: unit.color || DEFAULT_COLOR,
      icon: unit.icon || DEFAULT_ICON,
      exams: publishedExamsOfUnit(data, unit.unitId).map(publicExamCard),
    });
  });

  // ── Published read surface (consumed by the exam center) ─────────────────────
  app.get("/v1/published/exams", async (req, res) => {
    const data = await db.getAll();
    // Only takeable exams reach the exam center — a disabled exam, or any exam of a
    // disabled unit, is absent here, so it never shows in the catalog nor enrolls.
    const exams = Object.values(data.exams || {})
      .filter((e) => isExamTakeable(e, data.units?.[e.ownerUnitId]))
      .map((e) => publishedExamDef(e, data.units?.[e.ownerUnitId]));
    res.json({ exams });
  });

  app.get("/v1/published/exams/:id", async (req, res) => {
    const data = await db.getAll();
    const exam = data.exams?.[req.params.id];
    // 404 (not 403) when disabled: the exam center maps it to EXAM_NOT_FOUND and the
    // taker simply can't enroll — a disabled exam is invisible, not merely forbidden.
    if (!exam || !isExamTakeable(exam, data.units?.[exam.ownerUnitId])) return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    res.json(publishedExamDef(exam, data.units?.[exam.ownerUnitId]));
  });

  // ── Identity gate for the authoring plane ────────────────────────────────────
  app.use("/v1", (req, res, next) => {
    const u = req.get("x-academy-user");
    if (!u) return res.status(401).json({ error: "MISSING_IDENTITY" });
    req.academyUser = String(u);
    next();
  });

  // ── Units ────────────────────────────────────────────────────────────────────
  app.post("/v1/units", async (req, res) => {
    const userId = req.academyUser;
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const contactEmail = String(req.body?.contactEmail || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const branding = sanitizeBranding(req.body);
    if (branding.error) return res.status(400).json({ error: "INVALID", message: branding.error });
    try {
      const { unit, created } = await db.mutate((data) => {
        const existing = unitForUser(data, userId);
        if (existing) return { value: { unit: existing, created: false } }; // idempotent (one unit per user)
        const seq = (data.seq || 0) + 1;
        const unit = {
          unitId: `unit-${seq}`,
          ownerUserId: userId,
          name,
          description,
          contactEmail,
          tags: branding.value.tags || [],
          color: branding.value.color || DEFAULT_COLOR,
          icon: branding.value.icon || DEFAULT_ICON,
          payoutUserId: userId,
          createdAt: nowIso(),
          status: "active",
        };
        return { next: { ...data, seq, units: { ...data.units, [unit.unitId]: unit } }, value: { unit, created: true } };
      });
      log.info("unit registered", { unitId: unit.unitId, user: userId, created });
      res.status(created ? 201 : 200).json(unit);
    } catch (err) {
      log.error("register unit failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  app.get("/v1/units/me", async (req, res) => {
    const data = await db.getAll();
    const unit = unitForUser(data, req.academyUser);
    if (!unit) return res.status(404).json({ error: "UNIT_NOT_FOUND" });
    res.json(unit);
  });

  app.patch("/v1/units/me", async (req, res) => {
    const userId = req.academyUser;
    const branding = sanitizeBranding(req.body);
    if (branding.error) return res.status(400).json({ error: "INVALID", message: branding.error });
    try {
      const outcome = await db.mutate((data) => {
        const unit = unitForUser(data, userId);
        if (!unit) return { value: { code: "NOT_FOUND" } };
        const next = { ...unit };
        if (req.body?.name !== undefined) {
          if (!String(req.body.name).trim()) return { value: { code: "BAD", message: "name cannot be empty" } };
          next.name = String(req.body.name).trim();
        }
        if (req.body?.description !== undefined) next.description = String(req.body.description).trim();
        if (req.body?.contactEmail !== undefined) next.contactEmail = String(req.body.contactEmail).trim();
        if (branding.value.tags !== undefined) next.tags = branding.value.tags;
        if (branding.value.color !== undefined) next.color = branding.value.color;
        if (branding.value.icon !== undefined) next.icon = branding.value.icon;
        return { next: { ...data, units: { ...data.units, [unit.unitId]: next } }, value: { code: "OK", unit: next } };
      });
      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "UNIT_NOT_FOUND" });
      if (outcome.code === "BAD") return res.status(400).json({ error: "INVALID", message: outcome.message });
      res.json(outcome.unit);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Enable / disable the caller's unit. Disabling makes EVERY exam it owns
  // untakeable at once (hidden from the catalog + public directory, no new
  // enrollments) without touching each exam's own published/enabled state, so
  // re-enabling restores exactly what was live before. Idempotent.
  function setUnitStatus(status) {
    return async (req, res) => {
      try {
        const outcome = await db.mutate((data) => {
          const unit = unitForUser(data, req.academyUser);
          if (!unit) return { value: { code: "NOT_FOUND" } };
          const next = { ...unit, status };
          return { next: { ...data, units: { ...data.units, [unit.unitId]: next } }, value: { code: "OK", unit: next } };
        });
        if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "UNIT_NOT_FOUND" });
        log.info("unit status changed", { unitId: outcome.unit.unitId, status, user: req.academyUser });
        res.json(outcome.unit);
      } catch (err) {
        log.error("set unit status failed", { error: err.message });
        res.status(500).json({ error: "INTERNAL" });
      }
    };
  }
  app.post("/v1/units/me/disable", setUnitStatus("disabled"));
  app.post("/v1/units/me/enable", setUnitStatus("active"));

  // ── Exams ──────────────────────────────────────────────────────────────────
  app.post("/v1/exams", async (req, res) => {
    const userId = req.academyUser;
    const parsed = validateExamInput(req.body, { partial: false });
    if (parsed.error) return res.status(400).json({ error: "INVALID", message: parsed.error });
    try {
      const outcome = await db.mutate((data) => {
        const unit = unitForUser(data, userId);
        if (!unit) return { value: { code: "NO_UNIT" } };
        const seq = (data.seq || 0) + 1;
        const at = nowIso();
        const exam = {
          id: `exam-${seq}`,
          ownerUnitId: unit.unitId,
          ...parsed.value,
          status: "draft",
          enabled: true,
          createdAt: at,
          updatedAt: at,
        };
        return { next: { ...data, seq, exams: { ...data.exams, [exam.id]: exam } }, value: { code: "OK", exam } };
      });
      if (outcome.code === "NO_UNIT") return res.status(409).json({ error: "NO_UNIT", message: "register a certification unit first" });
      res.status(201).json(outcome.exam);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  app.get("/v1/exams", async (req, res) => {
    const data = await db.getAll();
    const unit = unitForUser(data, req.academyUser);
    const exams = unit ? Object.values(data.exams || {}).filter((e) => e.ownerUnitId === unit.unitId) : [];
    res.json({ exams });
  });

  app.get("/v1/exams/:id", async (req, res) => {
    const data = await db.getAll();
    const unit = unitForUser(data, req.academyUser);
    const exam = data.exams?.[req.params.id];
    if (!exam) return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (!unit || exam.ownerUnitId !== unit.unitId) return res.status(403).json({ error: "FORBIDDEN" });
    res.json(exam);
  });

  app.patch("/v1/exams/:id", async (req, res) => {
    const userId = req.academyUser;
    const parsed = validateExamInput(req.body, { partial: true });
    if (parsed.error) return res.status(400).json({ error: "INVALID", message: parsed.error });
    try {
      const outcome = await db.mutate((data) => {
        const unit = unitForUser(data, userId);
        const exam = data.exams?.[req.params.id];
        if (!exam) return { value: { code: "NOT_FOUND" } };
        if (!unit || exam.ownerUnitId !== unit.unitId) return { value: { code: "FORBIDDEN" } };
        const next = { ...exam, ...parsed.value, updatedAt: nowIso() };
        return { next: { ...data, exams: { ...data.exams, [exam.id]: next } }, value: { code: "OK", exam: next } };
      });
      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
      if (outcome.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
      res.json(outcome.exam);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  app.post("/v1/exams/:id/publish", async (req, res) => {
    const data = await db.getAll();
    const unit = unitForUser(data, req.academyUser);
    const exam = data.exams?.[req.params.id];
    if (!exam) return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (!unit || exam.ownerUnitId !== unit.unitId) return res.status(403).json({ error: "FORBIDDEN" });

    // Validate enough questions exist in the bank.
    let poolTotal;
    try {
      const list = await questionBank.list(exam.id);
      poolTotal = list.total || (list.questions || []).length;
    } catch (err) {
      log.warn("publish: bank unavailable", { exam: exam.id, error: err.message });
      return res.status(503).json({ error: "QUESTION_BANK_UNAVAILABLE" });
    }
    if (poolTotal < exam.questionCount) {
      return res.status(400).json({ error: "NOT_ENOUGH_QUESTIONS", have: poolTotal, need: exam.questionCount });
    }
    const updated = await db.mutate((d) => {
      const e = d.exams[exam.id];
      const next = { ...e, status: "published", updatedAt: nowIso() };
      return { next: { ...d, exams: { ...d.exams, [e.id]: next } }, value: next };
    });
    log.info("exam published", { exam: exam.id, unit: unit.unitId });
    res.json(updated);
  });

  app.post("/v1/exams/:id/unpublish", async (req, res) => {
    const userId = req.academyUser;
    const outcome = await db.mutate((data) => {
      const unit = unitForUser(data, userId);
      const exam = data.exams?.[req.params.id];
      if (!exam) return { value: { code: "NOT_FOUND" } };
      if (!unit || exam.ownerUnitId !== unit.unitId) return { value: { code: "FORBIDDEN" } };
      const next = { ...exam, status: "draft", updatedAt: nowIso() };
      return { next: { ...data, exams: { ...data.exams, [exam.id]: next } }, value: { code: "OK", exam: next } };
    });
    if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (outcome.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
    res.json(outcome.exam);
  });

  // Enable / disable a single exam. Orthogonal to publish: a disabled published exam
  // is pulled from the catalog and can't be enrolled, but keeps its published state
  // so enabling makes it live again with no re-validation. Owner-scoped, idempotent.
  function setExamEnabled(enabled) {
    return async (req, res) => {
      try {
        const outcome = await db.mutate((data) => {
          const unit = unitForUser(data, req.academyUser);
          const exam = data.exams?.[req.params.id];
          if (!exam) return { value: { code: "NOT_FOUND" } };
          if (!unit || exam.ownerUnitId !== unit.unitId) return { value: { code: "FORBIDDEN" } };
          const next = { ...exam, enabled, updatedAt: nowIso() };
          return { next: { ...data, exams: { ...data.exams, [exam.id]: next } }, value: { code: "OK", exam: next } };
        });
        if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
        if (outcome.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
        log.info("exam enabled changed", { exam: outcome.exam.id, enabled, user: req.academyUser });
        res.json(outcome.exam);
      } catch (err) {
        log.error("set exam enabled failed", { error: err.message });
        res.status(500).json({ error: "INTERNAL" });
      }
    };
  }
  app.post("/v1/exams/:id/disable", setExamEnabled(false));
  app.post("/v1/exams/:id/enable", setExamEnabled(true));

  // ── Questions (proxied to the bank; validated by the type registry) ──────────
  async function ownedExam(userId, examId) {
    const data = await db.getAll();
    const unit = unitForUser(data, userId);
    const exam = data.exams?.[examId];
    if (!exam) return { code: "NOT_FOUND" };
    if (!unit || exam.ownerUnitId !== unit.unitId) return { code: "FORBIDDEN" };
    return { code: "OK", unit, exam };
  }

  async function upsertQuestion(req, res, id) {
    const own = await ownedExam(req.academyUser, req.params.id);
    if (own.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (own.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
    const question = {
      id: id || req.body?.id || "",
      type: req.body?.type,
      text: req.body?.text,
      options: Array.isArray(req.body?.options) ? req.body.options : [],
      correct: Array.isArray(req.body?.correct) ? req.body.correct : [],
      weight: req.body?.weight != null ? Number(req.body.weight) : 1,
    };
    const err = questionTypes.validate(question);
    if (err) return res.status(400).json({ error: "INVALID_QUESTION", message: err });
    try {
      const saved = await questionBank.upsert(req.params.id, question);
      res.status(id ? 200 : 201).json(saved);
    } catch (e) {
      log.warn("question upsert: bank unavailable", { exam: req.params.id, error: e.message });
      res.status(503).json({ error: "QUESTION_BANK_UNAVAILABLE" });
    }
  }

  app.post("/v1/exams/:id/questions", (req, res) => upsertQuestion(req, res, null));
  app.patch("/v1/exams/:id/questions/:qid", (req, res) => upsertQuestion(req, res, req.params.qid));

  app.delete("/v1/exams/:id/questions/:qid", async (req, res) => {
    const own = await ownedExam(req.academyUser, req.params.id);
    if (own.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (own.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
    try {
      const reply = await questionBank.remove(req.params.id, req.params.qid);
      res.json({ deleted: !!reply.deleted });
    } catch (e) {
      res.status(503).json({ error: "QUESTION_BANK_UNAVAILABLE" });
    }
  });

  app.get("/v1/exams/:id/questions", async (req, res) => {
    const own = await ownedExam(req.academyUser, req.params.id);
    if (own.code === "NOT_FOUND") return res.status(404).json({ error: "EXAM_NOT_FOUND" });
    if (own.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
    try {
      const list = await questionBank.list(req.params.id);
      res.json({ questions: list.questions || [], total: list.total || 0 });
    } catch (e) {
      res.status(503).json({ error: "QUESTION_BANK_UNAVAILABLE" });
    }
  });

  return app;
}

async function start() {
  await db.init();
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "authoring", host: HOST, port: server.address().port, path: db.DB_PATH });
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

module.exports = { buildApp, start, validateExamInput };
