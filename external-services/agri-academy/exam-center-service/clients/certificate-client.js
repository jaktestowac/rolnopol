/**
 * HTTP client → certificate-issuer-service (exam-center side).
 *
 * The exam center mints a certificate on a pass (issuance is idempotent per
 * session), proxies public verification, and revokes on the unit owner's behalf.
 * Every method resolves with `{ status, body }`; a network error / timeout
 * surfaces as `{ status: 503, body: { error: "CERTIFICATE_ISSUER_UNAVAILABLE" } }`
 * so the exam center can degrade to `certificateStatus: "pending"` and retry.
 */
const { CERTIFICATE_TARGET, HTTP_TIMEOUT_MS } = require("../config");

async function req(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${CERTIFICATE_TARGET}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    return { status: 503, body: { error: "CERTIFICATE_ISSUER_UNAVAILABLE" } };
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
  target: CERTIFICATE_TARGET,
  health: () => req("GET", "/health"),
  issue: (payload) => req("POST", "/v1/certificates", payload),
  verify: (certNo) => req("GET", `/v1/verify/${encodeURIComponent(certNo)}`),
  revoke: (certNo, reason) => req("POST", `/v1/certificates/${encodeURIComponent(certNo)}/revoke`, { reason }),
};
