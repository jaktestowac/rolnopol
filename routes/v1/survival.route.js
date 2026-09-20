/**
 * Rolnopol Survival — expedition record endpoints (PRD 10.2).
 *
 * Mounted under /api/v1:
 *   POST   /survival/sessions             start an expedition, server issues the seed
 *   PATCH  /survival/sessions/:sessionId  close it: won, lost or abandoned
 *   GET    /survival/sessions             the caller's own history
 *   GET    /survival/sessions/:sessionId  one of the caller's expeditions
 *   GET    /survival/scoreboard           the league table, across players
 *   GET    /survival/progress             records, streak, marks and unlocks
 *   PUT    /survival/sessions/:sessionId/snapshot  save a run in progress
 *
 * Order of the guards matters: the feature flag answers 404 before anything
 * asks for credentials, so a disabled module cannot be detected by probing for
 * a 401 (WP-44, WP-39).
 */
const express = require("express");
const { createRateLimiter } = require("../../middleware/rate-limit.middleware");
const { requireFeatureFlag } = require("../../middleware/feature-flag.middleware");
const { authenticateSessionUser } = require("../../middleware/auth.middleware");
const survivalController = require("../../controllers/survival.controller");

const survivalRoute = express.Router();
const apiLimiter = createRateLimiter("api");
const survivalGate = requireFeatureFlag("survivalGameEnabled", { resourceName: "Rolnopol Survival" });

// The game is played by a person in a browser, so a session token is the only
// credential that makes sense here. Personal API keys are deliberately not
// accepted (PRD 10.1).
survivalRoute.use("/survival", apiLimiter, survivalGate, authenticateSessionUser);

survivalRoute.post("/survival/sessions", survivalController.startSession);
survivalRoute.get("/survival/sessions", survivalController.listSessions);
// Before the :sessionId route, or "scoreboard" reads as an expedition id.
survivalRoute.get("/survival/scoreboard", survivalController.getScoreboard);
survivalRoute.get("/survival/progress", survivalController.getProgress);
survivalRoute.get("/survival/sessions/:sessionId", survivalController.getSession);
survivalRoute.patch("/survival/sessions/:sessionId", survivalController.closeSession);
survivalRoute.put("/survival/sessions/:sessionId/snapshot", survivalController.saveSnapshot);

module.exports = survivalRoute;
