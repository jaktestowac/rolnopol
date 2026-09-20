/**
 * Crew Office — health endpoint (PRD §7.1).
 *
 * This router carries `GET /api/v1/crew/health` and nothing else. The GraphQL
 * endpoint lives in `routes/crew-graphql.route.js`, mounted at `/api/graphql` so
 * the path is `/api/graphql/crew` as §7.1 specifies — this router is under
 * `/api/v1`, which would have made it `/api/v1/graphql/crew`. Both share the
 * middleware chain below, which was built here first precisely so the gate was
 * proven before there was anything behind it.
 *
 * Middleware order is `flag → auth → rate limit`, and that order is load-bearing
 * (§9.1.2):
 *   - flag first, so a disabled module reveals nothing to an authenticated *or*
 *     anonymous caller — 404, indistinguishable from a module that never existed;
 *   - auth before the limiter, so anonymous traffic cannot consume a real user's
 *     quota.
 *
 * Authentication is `authenticateSessionUser` — session token only, NOT the
 * `authenticateUser` that `staff.route.js` uses. Personal API keys resolve a
 * required scope from the request and there is no crew scope, so admitting keys
 * would silently widen every already-issued key into a new data domain (§9.1.1).
 * Programmatic access arrives with `crew:read` / `crew:write` scopes, not before.
 *
 * Mounted under /api/v1 (see routes/v1/index.js).
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const { formatResponseBody } = require("../../helpers/response-helper");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();

// A separate limiter instance on this route only — never a change to the shared
// limiter config (§9, last rule; §12 rule 2).
const apiLimiter = createRateLimiter("api");
const gate = requireFeatureFlag("crewOfficeEnabled", { resourceName: "Crew Office" });

const DATA_DIR = path.join(__dirname, "..", "..", "data");

/**
 * Store status without creating anything. "absent" is the correct, expected
 * answer until the pillar first writes — §6.6 forbids a filesystem footprint
 * before the module is enabled, and a health probe must not be what creates it.
 */
function storeStatusOf(file) {
  try {
    return fs.existsSync(path.join(DATA_DIR, file)) ? "present" : "absent";
  } catch (error) {
    return "unknown";
  }
}

router.get("/crew/health", gate, authenticateSessionUser, apiLimiter, async (req, res) => {
  try {
    // The pillar list comes from the registry, which is the single source of
    // truth: a pillar that failed to load is absent here too, so health reports
    // the module as it actually is rather than as it was configured to be.
    const { getCrewSchema, pillarHealth } = require("../../services/crew/registry");
    const { pillars: assembled } = getCrewSchema();
    const health = await pillarHealth();
    const healthByName = new Map(health.map((row) => [row.name, row]));

    const pillars = assembled.map((pillar) => {
      const storeFiles = (pillar.stores || []).map((store) => store.file);
      return {
        name: pillar.name,
        // The gate above already proved `crewOfficeEnabled` is true, and that
        // flag is the only one there is: the module is all-or-nothing.
        enabled: true,
        status: healthByName.get(pillar.name)?.status || "unknown",
        detail: healthByName.get(pillar.name)?.detail || null,
        storeStatus:
          storeFiles.length === 0 ? "none" : storeFiles.every((file) => storeStatusOf(file) === "present") ? "present" : "absent",
      };
    });

    const degraded = pillars.some((pillar) => pillar.status !== "ok");

    return res.status(200).json(
      formatResponseBody({
        data: {
          status: degraded ? "degraded" : "ok",
          graph: "mounted",
          graphEndpoint: "/api/graphql/crew",
          pillars,
        },
      }),
    );
  } catch (error) {
    logError("[crew] health check failed", { error: error instanceof Error ? error.stack || error.message : error });
    return res.status(500).json(formatResponseBody({ error: "Crew Office health check failed" }));
  }
});

/**
 * Download one personnel document (#100).
 *
 * REST rather than a graph field, deliberately. Bytes do not belong in a GraphQL
 * response: base64 in JSON costs a third more, cannot stream, and — the part that
 * matters — cannot carry `Content-Type` or `Content-Disposition`, which is how a
 * browser knows what it just received. So the graph answers `downloadPath` and
 * this route answers the bytes.
 *
 * Same middleware chain as everything else here (flag → auth → limit), and the
 * ownership check is the pillar's own `readDocumentBytes` rather than a second
 * implementation: a download that re-derived "is this yours?" would be the obvious
 * place for the two answers to drift.
 *
 * Status codes are the interesting part, and each says something different:
 *   404  no such document, or not the caller's — indistinguishable on purpose
 *   409  it exists and is not downloadable YET (the scan is still running)
 *   410  it exists, the scan rejected it, and it never will be downloadable
 *   500  the record is there and its bytes are not (see decision 3 in service.js)
 */
router.get("/crew/documents/:documentId", gate, authenticateSessionUser, apiLimiter, async (req, res) => {
  try {
    const { getCrewSchema } = require("../../services/crew/registry");
    const { createCrewContext } = require("../../services/crew/context");
    const { contentDisposition } = require("../../services/crew/upload/content-disposition");
    const { isPreviewable } = require("../../services/crew/pillars/documents/policy");

    const { pillars } = getCrewSchema();
    const context = createCrewContext({ userId: req.user.userId, pillars });
    const documents = context.services.documents;
    if (!documents) {
      return res.status(404).json(formatResponseBody({ error: "Document not found" }));
    }

    const result = await documents.readDocumentBytes(req.params.documentId);

    if (!result.ok) {
      // `details` and not `data`: `formatResponseBody` drops `data` entirely once
      // `error` is set, so an error that carried its context in `data` would say
      // nothing at all. The one place a caller can be handed structured context
      // alongside a refusal is `details`.
      if (result.code === "SCAN_PENDING") {
        return res.status(409).json(
          formatResponseBody({
            error: "This document is still being scanned.",
            details: { status: result.document.status, scanCompletesAt: result.document.scanCompletesAt },
          }),
        );
      }
      if (result.code === "SCAN_REJECTED") {
        return res.status(410).json(
          formatResponseBody({
            error: result.document.scanDetail || "This document was rejected by the scan.",
            details: { status: "REJECTED" },
          }),
        );
      }
      if (result.code === "BLOB_MISSING") {
        logError("[crew] document record has no bytes", { documentId: req.params.documentId });
        return res.status(500).json(formatResponseBody({ error: "This document's contents are missing." }));
      }
      return res.status(404).json(formatResponseBody({ error: "Document not found" }));
    }

    // `?disposition=inline` is what makes a preview possible: same bytes, same
    // ownership check, same status rules — the browser is simply told to render
    // rather than save. Anything other than the literal "inline" means attachment,
    // and a type that is not on the preview list is DOWNGRADED to attachment
    // rather than refused: the caller still gets their file, just not rendered
    // inside this origin. Refusing would be the more dramatic answer and the less
    // useful one.
    const wantsInline = String(req.query.disposition || "").toLowerCase() === "inline";
    const inline = wantsInline && isPreviewable(result.document.contentType);

    res.setHeader("Content-Type", result.document.contentType);
    res.setHeader("Content-Length", String(result.bytes.length));
    res.setHeader("Content-Disposition", contentDisposition(result.document.filename, { type: inline ? "inline" : "attachment" }));
    // The bytes are caller-supplied and served back verbatim, so the browser must
    // be told not to second-guess the recorded type. Without this, a .txt holding
    // markup is sniffed as HTML and runs in the app's own origin — and `nosniff`
    // is precisely what lets text/plain be on the preview list at all.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Defence in depth for the inline path, where the bytes are actually rendered.
    // Nothing on the preview list can execute script when served with its own type
    // and nosniff; this policy is the second lock, and it says so explicitly rather
    // than relying on that argument staying true. `frame-ancestors 'self'` keeps
    // another site from framing somebody's contract.
    if (inline) {
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; object-src 'none'; frame-ancestors 'self'");
    }
    res.setHeader("Cache-Control", "private, no-store");
    // Lets a client verify what it received against what the graph reported.
    res.setHeader("ETag", `"${result.document.checksum}"`);
    return res.status(200).send(result.bytes);
  } catch (error) {
    logError("[crew] document download failed", {
      documentId: req.params.documentId,
      error: error instanceof Error ? error.stack || error.message : error,
    });
    return res.status(500).json(formatResponseBody({ error: "Crew Office could not serve that document" }));
  }
});

module.exports = router;
