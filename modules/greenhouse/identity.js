/**
 * Greenhouse identity resolution.
 *
 * The greenhouse is open to everyone, but every request carries an identity used
 * to scope the caller's greenhouse:
 *   • Logged-in user → identity from the existing session token (real userId).
 *   • Anonymous visitor → a demo identity provided by the browser via the
 *     `x-greenhouse-demo-id` header (stored in sessionStorage client-side).
 *
 * This is deliberately NOT a hard auth gate (which would 401 anonymous visitors).
 */
const { isUserLogged, getUserId } = require("../../helpers/token.helpers");
const { formatResponseBody } = require("../../helpers/response-helper");

const DEMO_ID_PATTERN = /^demo-[A-Za-z0-9_-]{6,}$/;

function extractSessionToken(req) {
  const authHeader = req.headers.authorization;
  let token = req.headers.token;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  if (!token && req.cookies && req.cookies.rolnopolToken) {
    token = req.cookies.rolnopolToken;
  }
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
}

/**
 * @returns {string|null} userId if the request carries a valid user session
 */
function tryGetUserId(req) {
  const token = extractSessionToken(req);
  if (token && isUserLogged(token)) {
    return getUserId(token) || null;
  }
  return null;
}

/**
 * Express middleware — sets req.ghIdentity = { kind, id } or responds 400.
 */
function resolveGreenhouseIdentity(req, res, next) {
  const userId = tryGetUserId(req);
  if (userId) {
    req.ghIdentity = { kind: "user", id: String(userId) };
    return next();
  }

  const demoId = req.get("x-greenhouse-demo-id");
  if (demoId && DEMO_ID_PATTERN.test(demoId)) {
    req.ghIdentity = { kind: "demo", id: demoId };
    return next();
  }

  return res
    .status(400)
    .json(formatResponseBody({ error: "Missing greenhouse identity (log in or send x-greenhouse-demo-id)" }));
}

module.exports = {
  resolveGreenhouseIdentity,
  tryGetUserId,
  DEMO_ID_PATTERN,
};
