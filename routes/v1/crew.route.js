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

module.exports = router;
