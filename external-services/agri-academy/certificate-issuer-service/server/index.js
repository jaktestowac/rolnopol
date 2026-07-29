/**
 * Certificate-issuer REST service — standalone process (:4351).
 * Start with:  npm run academy:certs
 *
 *   GET  /health
 *   POST /v1/certificates { examId, examTitle, ownerUnitId, holder, sessionId, scorePct, certValidMonths }
 *        → mint a numbered certificate (AA-<year>-<000123>); idempotent by
 *          { examId, holder, sessionId } so a retried submit never double-mints.
 *   GET  /v1/verify/:certNo → { status: valid | expired | revoked | unknown, ... }  (public)
 *   POST /v1/certificates/:certNo/revoke { reason } → mark revoked (admin path, proxied)
 *
 * A leaf: no clients. Because paid exams are settled BEFORE the attempt, a minted
 * certificate is always `valid`; expiry is applied lazily at verify time.
 */
const express = require("express");
const crypto = require("crypto");
const { HOST, PORT, CERT_PREFIX, DEFAULT_VALID_MONTHS } = require("../config");
const db = require("./db");
const clock = require("../../shared/clock");
const { getTemplate, DEFAULT_TEMPLATE, isValidTemplate } = require("../../shared/cert-templates");
const { createLogger } = require("../../shared/logger");

const log = createLogger("certificate-issuer");
const SERVICE_VERSION = "1.0.0";
const startedAt = Date.now();

// ── pure helpers ───────────────────────────────────────────────────────────────

function certNumber(seq, nowMs) {
  const year = new Date(nowMs).getUTCFullYear();
  return `${CERT_PREFIX}-${year}-${String(seq).padStart(6, "0")}`;
}

/** issuedAt + n months, as an ISO string (month arithmetic, clamped by Date). */
function addMonthsIso(fromMs, months) {
  const d = new Date(fromMs);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  return d.toISOString();
}

function idemKeyOf(c) {
  return `${c.examId}::${c.holder}::${c.sessionId}`;
}

/** An unguessable, URL-safe share token (holder generates it to share a cert). */
function newShareToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * An Open-Badge-style, machine-readable assertion third parties can consume
 * (the spirit of Open Badges v2 — no external context fetch, no new dependency).
 * Only ever carries the same PUBLIC fields as the verify view; never internal
 * ids (sessionId / idem key) or the private share token.
 */
function openBadgeAssertion(cert, nowMs, { verifyUrl } = {}) {
  const v = verifyView(cert, nowMs);
  if (v.status === "unknown") return { status: "unknown" };
  return {
    "@context": "https://w3id.org/openbadges/v2",
    type: "Assertion",
    id: verifyUrl || null,
    status: v.status,
    recipient: { type: "id", identity: v.holder },
    issuedOn: v.issuedAt,
    expires: v.expiresAt || null,
    badge: {
      type: "BadgeClass",
      name: v.examTitle,
      description: `AgriAcademy certification — ${v.examTitle}`,
      criteria: { narrative: `Passed the ${v.examTitle} exam with a score of ${v.scorePct}%.` },
      issuer: { type: "Profile", id: v.unit, name: v.unitName || v.unit },
    },
    verification: { type: "HostedBadge", url: verifyUrl || null },
    certNo: v.certNo,
    scorePct: v.scorePct,
    ...(v.status === "revoked" ? { revokedReason: v.revokedReason } : {}),
  };
}

/** Public verify view — never leaks internal fields. */
function verifyView(cert, nowMs) {
  if (!cert) return { status: "unknown" };
  let status;
  if (cert.revoked) status = "revoked";
  else if (cert.expiresAt && nowMs > Date.parse(cert.expiresAt)) status = "expired";
  else status = "valid";
  const template = cert.template || DEFAULT_TEMPLATE;
  return {
    status,
    certNo: cert.certNo,
    holder: cert.holder,
    examTitle: cert.examTitle,
    unit: cert.ownerUnitId,
    unitName: cert.unitName || "",
    scorePct: cert.scorePct,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    template,
    templateStyle: getTemplate(template), // full descriptor so the client can render the styled document
    ...(status === "revoked" ? { revokedReason: cert.revokedReason || "" } : {}),
  };
}

// ── app ──────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", async (req, res) => {
    const data = await db.getAll().catch(() => null);
    res.json({
      status: "SERVING",
      version: SERVICE_VERSION,
      uptime_ms: Date.now() - startedAt,
      certificate_count: data ? Object.keys(data.certificates || {}).length : 0,
    });
  });

  // Mint — idempotent by { examId, holder, sessionId }.
  app.post("/v1/certificates", async (req, res) => {
    const b = req.body || {};
    const examId = b.examId;
    const holder = b.holder != null ? String(b.holder) : "";
    const sessionId = b.sessionId;
    if (!examId || !holder || !sessionId) {
      return res.status(400).json({ error: "examId, holder and sessionId are required" });
    }
    try {
      const cert = await db.mutate((data) => {
        const key = idemKeyOf({ examId, holder, sessionId });
        const existing = Object.values(data.certificates || {}).find((c) => idemKeyOf(c) === key);
        if (existing) return { value: existing }; // idempotent — never double-mints

        const nowMs = clock.now();
        const seq = (data.seq || 0) + 1;
        const validMonths = b.certValidMonths != null ? Number(b.certValidMonths) : DEFAULT_VALID_MONTHS;
        const cert = {
          certNo: certNumber(seq, nowMs),
          examId,
          examTitle: b.examTitle || "",
          ownerUnitId: b.ownerUnitId || "",
          unitName: b.unitName || "",
          holder,
          sessionId,
          scorePct: b.scorePct != null ? Number(b.scorePct) : 0,
          template: isValidTemplate(b.template) ? b.template : DEFAULT_TEMPLATE,
          issuedAt: new Date(nowMs).toISOString(),
          expiresAt: addMonthsIso(nowMs, validMonths),
          revoked: false,
          revokedReason: null,
          shareToken: null,
        };
        return { next: { ...data, seq, certificates: { ...data.certificates, [cert.certNo]: cert } }, value: cert };
      });
      log.info("certificate minted", { certNo: cert.certNo, exam: examId, holder });
      res.status(201).json(cert);
    } catch (err) {
      log.error("mint failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Verify — public (no identity). Lazy expiry.
  app.get("/v1/verify/:certNo", async (req, res) => {
    const data = await db.getAll();
    const cert = data.certificates?.[req.params.certNo] || null;
    res.status(200).json(verifyView(cert, clock.now()));
  });

  // Machine-readable Open-Badge assertion by certNo — public, CORS-open so a
  // third party's page can fetch it. Same public shape as verify; no private
  // fields (sessionId / idem key / share token) ever appear.
  app.get("/v1/verify/:certNo/badge.json", async (req, res) => {
    const data = await db.getAll();
    const cert = data.certificates?.[req.params.certNo] || null;
    res.set("Access-Control-Allow-Origin", "*");
    const verifyUrl = `${req.protocol}://${req.get("host")}/v1/verify/${encodeURIComponent(req.params.certNo)}/badge.json`;
    res.status(200).json(openBadgeAssertion(cert, clock.now(), { verifyUrl }));
  });

  // Read-only share status for a certificate — the current token (or null). Holder-
  // ownership is enforced UPSTREAM; the issuer is a leaf dialed only by the exam
  // center, never routed publicly.
  app.get("/v1/certificates/:certNo/share", async (req, res) => {
    const data = await db.getAll();
    const cert = data.certificates?.[req.params.certNo];
    if (!cert) return res.status(404).json({ error: "CERTIFICATE_NOT_FOUND" });
    res.status(200).json({ certNo: cert.certNo, shareToken: cert.shareToken || null });
  });

  // Generate (or return the existing) share token for a certificate — the holder
  // uses this to mint an unguessable public share link. Idempotent: a cert that
  // already has a token keeps it. Holder-ownership is enforced UPSTREAM (the exam
  // center only proxies this for a cert the caller actually earned).
  app.post("/v1/certificates/:certNo/share", async (req, res) => {
    try {
      const outcome = await db.mutate((data) => {
        const cert = data.certificates?.[req.params.certNo];
        if (!cert) return { value: { code: "NOT_FOUND" } };
        if (cert.shareToken) return { next: data, value: { code: "OK", cert } }; // idempotent
        const next = { ...cert, shareToken: newShareToken() };
        return { next: { ...data, certificates: { ...data.certificates, [cert.certNo]: next } }, value: { code: "OK", cert: next } };
      });
      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "CERTIFICATE_NOT_FOUND" });
      log.info("certificate share enabled", { certNo: outcome.cert.certNo });
      res.status(200).json({ certNo: outcome.cert.certNo, shareToken: outcome.cert.shareToken });
    } catch (err) {
      log.error("share failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Revoke the share link (stop sharing). The cert stays valid; only the public
  // token is cleared so existing links stop resolving. Idempotent.
  app.delete("/v1/certificates/:certNo/share", async (req, res) => {
    try {
      const outcome = await db.mutate((data) => {
        const cert = data.certificates?.[req.params.certNo];
        if (!cert) return { value: { code: "NOT_FOUND" } };
        if (!cert.shareToken) return { next: data, value: { code: "OK", cert } }; // already private
        const next = { ...cert, shareToken: null };
        return { next: { ...data, certificates: { ...data.certificates, [cert.certNo]: next } }, value: { code: "OK", cert: next } };
      });
      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "CERTIFICATE_NOT_FOUND" });
      log.info("certificate share revoked", { certNo: outcome.cert.certNo });
      res.status(200).json({ certNo: outcome.cert.certNo, shareToken: null });
    } catch (err) {
      log.error("unshare failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  // Public share resolution by token — the rich, renderable certificate view plus
  // an embedded Open-Badge assertion. Only resolves while a share token exists
  // (revoking share → 404). CORS-open for third-party fetch. No token = no leak:
  // the sequential certNo is never enough to reach this endpoint.
  app.get("/v1/shared/:shareToken", async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const token = String(req.params.shareToken || "");
    const data = await db.getAll();
    const cert = token ? Object.values(data.certificates || {}).find((c) => c.shareToken === token) : null;
    if (!cert) return res.status(404).json({ status: "unknown", error: "SHARE_NOT_FOUND" });
    const now = clock.now();
    const verifyUrl = `${req.protocol}://${req.get("host")}/v1/shared/${encodeURIComponent(token)}`;
    res.status(200).json({ ...verifyView(cert, now), shared: true, openBadge: openBadgeAssertion(cert, now, { verifyUrl }) });
  });

  // Revoke — admin path (proxied through the exam center). Idempotent.
  app.post("/v1/certificates/:certNo/revoke", async (req, res) => {
    const reason = String(req.body?.reason || "").trim();
    try {
      const outcome = await db.mutate((data) => {
        const cert = data.certificates?.[req.params.certNo];
        if (!cert) return { value: { code: "NOT_FOUND" } };
        const next = { ...cert, revoked: true, revokedReason: reason || cert.revokedReason || "revoked" };
        return { next: { ...data, certificates: { ...data.certificates, [cert.certNo]: next } }, value: { code: "OK", cert: next } };
      });
      if (outcome.code === "NOT_FOUND") return res.status(404).json({ error: "CERTIFICATE_NOT_FOUND" });
      log.info("certificate revoked", { certNo: outcome.cert.certNo, reason });
      res.status(200).json(verifyView(outcome.cert, clock.now()));
    } catch (err) {
      log.error("revoke failed", { error: err.message });
      res.status(500).json({ error: "INTERNAL" });
    }
  });

  return app;
}

async function start() {
  await db.init();
  const app = buildApp();
  const server = app.listen(PORT, HOST, () => {
    log.info("listening", { codename: "certificate-issuer", host: HOST, port: server.address().port, path: db.DB_PATH });
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

module.exports = { buildApp, start, verifyView, certNumber, addMonthsIso, openBadgeAssertion, newShareToken };
