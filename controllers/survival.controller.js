/**
 * Rolnopol Survival — HTTP surface for expedition records (PRD 10.2).
 *
 * Identity always comes from the session token, never from the request body
 * (PRD 10.1). A `userId` in the payload is ignored.
 *
 * Somebody else's expedition answers 404, not 403: confirming that an id exists
 * would leak which runs other players have.
 */
const survivalService = require("../services/survival/survival.service");
const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");

function sendFailure(res, error, context) {
  const status = error && Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    logError("Survival " + context + " failed", { error: error instanceof Error ? error.stack || error.message : error });
    return res.status(500).json(formatResponseBody({ error: "Internal error" }));
  }
  return res.status(status).json(formatResponseBody({ error: error.message }));
}

/** POST /api/v1/survival/sessions */
async function startSession(req, res) {
  try {
    const body = req.body || {};
    const { session, abandoned } = await survivalService.startSession({
      userId: req.user.userId,
      scenarioId: body.scenarioId,
      difficulty: body.difficulty,
      mapSize: body.mapSize,
      seed: body.seed,
      daily: body.daily === true,
    });

    return res.status(201).json(formatResponseBody({ data: { session, abandoned } }));
  } catch (error) {
    return sendFailure(res, error, "session start");
  }
}

/** PATCH /api/v1/survival/sessions/:sessionId */
async function closeSession(req, res) {
  try {
    const body = req.body || {};
    const session = await survivalService.closeSession({
      userId: req.user.userId,
      sessionId: req.params.sessionId,
      status: body.status,
      result: body.result,
      cheatsUsed: body.cheatsUsed === true,
      // The chronicle of the run (PRD 8.17) and what it earned (PRD 8.18).
      // Both are validated in the service, not here.
      moments: body.moments,
      route: body.route,
      achievements: body.achievements,
    });

    return res.status(200).json(formatResponseBody({ data: { session } }));
  } catch (error) {
    return sendFailure(res, error, "session close");
  }
}

/** PUT /api/v1/survival/sessions/:sessionId/snapshot */
async function saveSnapshot(req, res) {
  try {
    const body = req.body || {};
    const session = await survivalService.saveSnapshot({
      userId: req.user.userId,
      sessionId: req.params.sessionId,
      snapshot: body.snapshot,
    });

    return res.status(200).json(formatResponseBody({ data: { saved: true, id: session.id } }));
  } catch (error) {
    return sendFailure(res, error, "snapshot save");
  }
}

/** GET /api/v1/survival/sessions */
async function listSessions(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10);
    const sessions = await survivalService.listSessions(
      req.user.userId,
      Number.isInteger(limit) && limit > 0 ? Math.min(limit, survivalService.HISTORY_LIMIT) : undefined,
    );

    return res.status(200).json(formatResponseBody({ data: { sessions } }));
  } catch (error) {
    return sendFailure(res, error, "session list");
  }
}

/** GET /api/v1/survival/scoreboard */
async function getScoreboard(req, res) {
  try {
    const entries = await survivalService.getScoreboard(req.user.userId);
    return res.status(200).json(formatResponseBody({ data: { entries } }));
  } catch (error) {
    return sendFailure(res, error, "scoreboard");
  }
}

/** GET /api/v1/survival/progress */
async function getProgress(req, res) {
  try {
    const progress = await survivalService.getProgress(req.user.userId);
    return res.status(200).json(formatResponseBody({ data: { progress } }));
  } catch (error) {
    return sendFailure(res, error, "progress");
  }
}

/** GET /api/v1/survival/sessions/:sessionId */
async function getSession(req, res) {
  try {
    const session = await survivalService.getSession(req.user.userId, req.params.sessionId);
    return res.status(200).json(formatResponseBody({ data: { session } }));
  } catch (error) {
    return sendFailure(res, error, "session read");
  }
}

module.exports = { startSession, closeSession, saveSnapshot, listSessions, getSession, getScoreboard, getProgress };
