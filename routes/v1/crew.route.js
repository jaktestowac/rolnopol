/**
 * Crew Office — HTTP surface (PRD §7.1).
 *
 * Phase 0 ships the health endpoint only. The GraphQL endpoint lands in Phase 2
 * and mounts on the same middleware chain, which is the whole point of building
 * this router first: the gate is proven before there is anything behind it.
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

/**
 * The pillar set. `crewOfficeEnabled` is the module's ONE flag — there are no
 * per-pillar sub-flags, so reaching this handler means every pillar is live.
 *
 * Health still reports per-pillar rows, because the useful question a monitor
 * asks is not "is this pillar switched on" but "has it got a store yet" — and
 * that answer differs per pillar as the phases land.
 *
 * Phase 2 replaces this literal with `services/crew/registry.js`, after which
 * the registry is the single source of truth and this file stops knowing pillar
 * names at all.
 */
const PILLARS = [
  { name: "profiles", file: "crew-profiles.json" },
  { name: "work", file: "crew-work.json" },
  { name: "leave", file: "crew-leave.json" },
  { name: "training", file: "crew-training.json" },
  { name: "tools", file: "crew-tools.json" },
];

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
    const pillars = PILLARS.map((pillar) => ({
      name: pillar.name,
      // The gate above already proved `crewOfficeEnabled` is true, and that flag
      // is the only one there is: the module is all-or-nothing.
      enabled: true,
      storeStatus: storeStatusOf(pillar.file),
    }));

    return res.status(200).json(
      formatResponseBody({
        data: {
          status: "ok",
          // Phase 0: the graph is not mounted yet. The field is present from the
          // start so a monitor can watch it flip rather than watch it appear.
          graph: "not-mounted",
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
