/**
 * AgriAcademy authoring client (app side) — thin HTTP proxy to the authoring gateway.
 *
 * Covers the AUTHORING plane (certification units + exam/question authoring).
 * Dials AGRI_ACADEMY_AUTHORING_TARGET and forwards identity as `x-academy-user`.
 * Every method resolves with `{ status, body }`; a network error / timeout →
 * `{ status: 503, body: { error: "AGRI_ACADEMY_OFFLINE" } }`.
 */
const BASE = process.env.AGRI_ACADEMY_AUTHORING_TARGET || `http://localhost:${process.env.AUTHORING_PORT || 4352}`;
const TIMEOUT_MS = Number(process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS || 4000);

async function call(method, path, { userId, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(userId ? { "x-academy-user": String(userId) } : {}) },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    return {
      status: 503,
      body: { error: "AGRI_ACADEMY_OFFLINE", detail: "AgriAcademy authoring offline — run `npm run academy:authoring`" },
    };
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: res.status, body: parsed };
}

const enc = encodeURIComponent;

module.exports = {
  base: BASE,
  health: () => call("GET", "/health"),
  // Units
  getUnitPresets: () => call("GET", "/v1/unit-presets"),
  getCertTemplates: () => call("GET", "/v1/cert-templates"),
  getMyUnit: (userId) => call("GET", "/v1/units/me", { userId }),
  registerUnit: (userId, body) => call("POST", "/v1/units", { userId, body }),
  updateMyUnit: (userId, body) => call("PATCH", "/v1/units/me", { userId, body }),
  // Enable/disable the unit — disabling makes all of its exams untakeable at once.
  disableMyUnit: (userId) => call("POST", "/v1/units/me/disable", { userId }),
  enableMyUnit: (userId) => call("POST", "/v1/units/me/enable", { userId }),
  // Exams
  listMyExams: (userId) => call("GET", "/v1/exams", { userId }),
  getExam: (userId, id) => call("GET", `/v1/exams/${enc(id)}`, { userId }),
  createExam: (userId, body) => call("POST", "/v1/exams", { userId, body }),
  updateExam: (userId, id, body) => call("PATCH", `/v1/exams/${enc(id)}`, { userId, body }),
  publishExam: (userId, id) => call("POST", `/v1/exams/${enc(id)}/publish`, { userId }),
  unpublishExam: (userId, id) => call("POST", `/v1/exams/${enc(id)}/unpublish`, { userId }),
  // Enable/disable a single exam (orthogonal to publish).
  disableExam: (userId, id) => call("POST", `/v1/exams/${enc(id)}/disable`, { userId }),
  enableExam: (userId, id) => call("POST", `/v1/exams/${enc(id)}/enable`, { userId }),
  // Questions
  listQuestions: (userId, id) => call("GET", `/v1/exams/${enc(id)}/questions`, { userId }),
  addQuestion: (userId, id, body) => call("POST", `/v1/exams/${enc(id)}/questions`, { userId, body }),
  updateQuestion: (userId, id, qid, body) => call("PATCH", `/v1/exams/${enc(id)}/questions/${enc(qid)}`, { userId, body }),
  deleteQuestion: (userId, id, qid) => call("DELETE", `/v1/exams/${enc(id)}/questions/${enc(qid)}`, { userId }),
};
