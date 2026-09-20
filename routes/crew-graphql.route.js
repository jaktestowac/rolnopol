/**
 * The crew graph route (PRD §7.1).
 *
 * Mounted at `/api/graphql` from `api/index.js`, so the endpoint is
 * `POST /api/graphql/crew` — the path the PRD specifies.
 *
 * **A note on where this file lives.** §4.2 sketched the graph endpoint inside
 * `routes/v1/crew.route.js`, but that router is mounted at `/api/v1` and would
 * therefore have served `/api/v1/graphql/crew`. The URL in §7.1 is the contract
 * the pages and the docs are written against, so the URL wins and the file moves
 * out of `v1/` — `routes/contact.route.js` is the existing precedent for a
 * non-versioned route module. `/api/v1/crew/health` stays where it was.
 *
 * The middleware chain is identical to the health route's, and the order is
 * load-bearing (§9.1.2): flag → auth → rate limit. Flag first so a disabled
 * module reveals nothing; auth before the limiter so anonymous traffic cannot
 * consume a real user's quota.
 */
const express = require("express");
const { createRateLimiter } = require("../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../middleware/auth.middleware");
const { executeCrewOperation, getCrewSdl } = require("../controllers/crew-graphql.controller");

const router = express.Router();

// Its own limiter instance — never a change to any existing limiter's config.
const apiLimiter = createRateLimiter("api");
const gate = requireFeatureFlag("crewOfficeEnabled", { resourceName: "Crew Office" });

const chain = [gate, authenticateSessionUser, apiLimiter];

// POST is the API. GET returns the SDL and nothing else: a GET can be triggered
// cross-origin by a plain navigation, so it must never carry a mutation.
router.post("/crew", ...chain, executeCrewOperation);
router.get("/crew", ...chain, getCrewSdl);

module.exports = router;
