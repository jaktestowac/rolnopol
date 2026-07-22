/**
 * AgriAcademy exam-center client (app side) — thin HTTP proxy to the exam center.
 *
 * The Rolnopol app holds no AgriAcademy domain logic or data and dials ONLY the
 * two gateways. This client covers the TAKER plane (exam-center, AGRI_ACADEMY_TARGET);
 * the authoring plane gets its own client. Identity is forwarded as the
 * `x-academy-user` header.
 *
 * Every method resolves with `{ status, body }` so the route layer can decide how
 * to translate it (mostly passthrough). A network error / timeout surfaces as
 * `{ status: 503, body: { error: "AGRI_ACADEMY_OFFLINE" } }`.
 */
const BASE = process.env.AGRI_ACADEMY_TARGET || `http://localhost:${process.env.EXAM_CENTER_PORT || 4350}`;
const TIMEOUT_MS = Number(process.env.AGRI_ACADEMY_CLIENT_TIMEOUT_MS || 4000);

async function call(method, path, { userId, body, query } = {}) {
  const url = new URL(`${BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(userId ? { "x-academy-user": String(userId) } : {}) },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    return {
      status: 503,
      body: { error: "AGRI_ACADEMY_OFFLINE", detail: "AgriAcademy exam center offline — run `npm run academy:exam-center`" },
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

module.exports = {
  base: BASE,
  health: () => call("GET", "/health"),
  healthAll: () => call("GET", "/health/all"),
  listExams: (userId) => call("GET", "/v1/exams", { userId }),
  getExam: (userId, examId) => call("GET", `/v1/exams/${encodeURIComponent(examId)}`, { userId }),
  // Public unit directory / profile (no identity needed).
  listUnits: () => call("GET", "/v1/units"),
  getUnit: (unitId) => call("GET", `/v1/units/${encodeURIComponent(unitId)}`),
  // Owner-only unit analytics (ownership enforced upstream by the exam center).
  getUnitAnalytics: (userId, unitId) => call("GET", `/v1/units/${encodeURIComponent(unitId)}/analytics`, { userId }),
  createSession: (userId, body) => call("POST", "/v1/sessions", { userId, body }),
  listSessions: (userId) => call("GET", "/v1/sessions", { userId }),
  // Internal, bridge-only: opens the access window after a successful ROL charge.
  entitleSession: (userId, id) => call("POST", `/v1/sessions/${encodeURIComponent(id)}/entitle`, { userId }),
  startSession: (userId, id) => call("POST", `/v1/sessions/${encodeURIComponent(id)}/start`, { userId }),
  getSession: (userId, id) => call("GET", `/v1/sessions/${encodeURIComponent(id)}`, { userId }),
  saveAnswer: (userId, id, qid, body) =>
    call("PUT", `/v1/sessions/${encodeURIComponent(id)}/answers/${encodeURIComponent(qid)}`, { userId, body }),
  submitSession: (userId, id) => call("POST", `/v1/sessions/${encodeURIComponent(id)}/submit`, { userId }),
  listCertificates: (userId) => call("GET", "/v1/certificates", { userId }),
  verify: (certNo) => call("GET", `/v1/verify/${encodeURIComponent(certNo)}`),
  revokeCertificate: (userId, certNo, body) => call("POST", `/v1/certificates/${encodeURIComponent(certNo)}/revoke`, { userId, body }),
};
