/**
 * AgriAcademy REST companion routes — AUTHORING plane.
 *
 * Thin proxy to the standalone authoring gateway: feature-flag gate → rate limit
 * → session auth → HTTP call (identity forwarded as `x-academy-user`) →
 * passthrough. Certification units register here and author their own exams and
 * (typed) questions; ownership is enforced upstream by the authoring service.
 *
 * Registered BEFORE the taker route (see routes/v1/index.js) so its literal paths
 * (`/units/me`, `/exams/mine`) win over the taker plane's `/units/:unitId` and
 * `/exams/:examId` param routes. Every route here requires a session.
 *
 * Mounted under /api/v1.
 */
const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { authoring } = require("../../modules/agri-academy");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();
const apiLimiter = createRateLimiter("api");
const gate = requireFeatureFlag("agriAcademyEnabled", { resourceName: "AgriAcademy" });
const guards = [gate, apiLimiter, authenticateSessionUser];

const userOf = (req) => req.user?.userId;

function forward(res, result) {
  return res.status(result.status).json(result.body);
}
async function proxy(res, promise) {
  try {
    forward(res, await promise);
  } catch (err) {
    logError("[agri-academy-admin] proxy failed", { error: err.message });
    res.status(500).json({ error: "INTERNAL", message: err.message });
  }
}

// ── Units ─────────────────────────────────────────────────────────────────────
// Predefined branding presets (icons + palette) for the unit console picker.
router.get("/agri-academy/unit-presets", guards, (req, res) => proxy(res, authoring.getUnitPresets()));
// The ten certificate templates, for the exam-creation picker + preview.
router.get("/agri-academy/cert-templates", guards, (req, res) => proxy(res, authoring.getCertTemplates()));
router.get("/agri-academy/units/me", guards, (req, res) => proxy(res, authoring.getMyUnit(userOf(req))));
router.post("/agri-academy/units", guards, (req, res) => proxy(res, authoring.registerUnit(userOf(req), req.body)));
router.patch("/agri-academy/units/me", guards, (req, res) => proxy(res, authoring.updateMyUnit(userOf(req), req.body)));
// Disable/enable the whole unit — disabling pulls every exam it owns from the catalog.
router.post("/agri-academy/units/me/disable", guards, (req, res) => proxy(res, authoring.disableMyUnit(userOf(req))));
router.post("/agri-academy/units/me/enable", guards, (req, res) => proxy(res, authoring.enableMyUnit(userOf(req))));

// ── Exams (authoring) ─────────────────────────────────────────────────────────
router.get("/agri-academy/exams/mine", guards, (req, res) => proxy(res, authoring.listMyExams(userOf(req))));
router.post("/agri-academy/exams", guards, (req, res) => proxy(res, authoring.createExam(userOf(req), req.body)));
router.patch("/agri-academy/exams/:id", guards, (req, res) => proxy(res, authoring.updateExam(userOf(req), req.params.id, req.body)));
router.post("/agri-academy/exams/:id/publish", guards, (req, res) => proxy(res, authoring.publishExam(userOf(req), req.params.id)));
router.post("/agri-academy/exams/:id/unpublish", guards, (req, res) => proxy(res, authoring.unpublishExam(userOf(req), req.params.id)));
router.post("/agri-academy/exams/:id/disable", guards, (req, res) => proxy(res, authoring.disableExam(userOf(req), req.params.id)));
router.post("/agri-academy/exams/:id/enable", guards, (req, res) => proxy(res, authoring.enableExam(userOf(req), req.params.id)));

// ── Questions (authoring; proxied to the bank upstream) ───────────────────────
router.get("/agri-academy/exams/:id/questions", guards, (req, res) => proxy(res, authoring.listQuestions(userOf(req), req.params.id)));
router.post("/agri-academy/exams/:id/questions", guards, (req, res) =>
  proxy(res, authoring.addQuestion(userOf(req), req.params.id, req.body)),
);
router.patch("/agri-academy/exams/:id/questions/:qid", guards, (req, res) =>
  proxy(res, authoring.updateQuestion(userOf(req), req.params.id, req.params.qid, req.body)),
);
router.delete("/agri-academy/exams/:id/questions/:qid", guards, (req, res) =>
  proxy(res, authoring.deleteQuestion(userOf(req), req.params.id, req.params.qid)),
);

module.exports = router;
