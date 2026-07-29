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
const featureFlagsService = require("../../services/feature-flags.service");
const { formatResponseBody } = require("../../helpers/response-helper");
const { logError } = require("../../helpers/logger-api");

const router = express.Router();

// A separate limiter instance on this route only — never a change to the shared
// limiter config (§9, last rule; §12 rule 2).
const apiLimiter = createRateLimiter("api");
const gate = requireFeatureFlag("crewOfficeEnabled", { resourceName: "Crew Office" });

/**
 * The pillar set, as flags. Phase 2 replaces this literal with
 * `services/crew/registry.js` — the registry becomes the single source of truth
 * and this file stops knowing pillar names at all. Until pillars exist, health
 * still has to answer honestly, so the shape is right from the start.
 *
 * `profiles` deliberately has no flag: it is part of the master flag because
 * every other pillar joins through `CrewMember` (§5.2 rule 4).
 */
const PILLARS = [
  { name: "profiles", flag: null, file: "crew-profiles.json" },
  { name: "work", flag: "crewWorkEnabled", file: "crew-work.json" },
  { name: "leave", flag: "crewLeaveEnabled", file: "crew-leave.json" },
  { name: "training", flag: "crewTrainingEnabled", file: "crew-training.json" },
  { name: "tools", flag: "crewToolsEnabled", file: "crew-tools.json" },
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
    const data = await featureFlagsService.getFeatureFlags();
    const flags = data?.flags || {};

    const pillars = PILLARS.map((pillar) => ({
      name: pillar.name,
      // Master-wins is already enforced by the gate above: reaching this handler
      // means `crewOfficeEnabled` is true, so a pillar's own flag decides.
      enabled: pillar.flag === null ? true : flags[pillar.flag] === true,
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
