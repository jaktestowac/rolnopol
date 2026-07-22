/**
 * HTTP client → authoring-service (exam-center side).
 *
 * The exam center reads the published exam catalog + defs and public unit pages
 * from authoring. Read-only; no identity needed (published/public surfaces).
 * A network error / timeout surfaces as { status: 503, body: { error } } so the
 * exam center can map it to a defined degradation shape.
 */
const { AUTHORING_TARGET, HTTP_TIMEOUT_MS } = require("../config");

async function get(path, { userId } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${AUTHORING_TARGET}${path}`, {
      headers: { "content-type": "application/json", ...(userId ? { "x-academy-user": String(userId) } : {}) },
      signal: controller.signal,
    });
  } catch {
    return { status: 503, body: { error: "AUTHORING_UNAVAILABLE" } };
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body };
}

module.exports = {
  target: AUTHORING_TARGET,
  health: () => get("/health"),
  listPublishedExams: () => get("/v1/published/exams"),
  getPublishedExam: (id) => get(`/v1/published/exams/${encodeURIComponent(id)}`),
  getPublicUnit: (unitId) => get(`/v1/public/units/${encodeURIComponent(unitId)}`),
  listPublicUnits: () => get("/v1/public/units"),
  // Identity-scoped: the caller's own unit (used for revoke ownership checks).
  getMyUnit: (userId) => get("/v1/units/me", { userId }),
};
