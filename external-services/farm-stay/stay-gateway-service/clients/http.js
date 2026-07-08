/**
 * Small fetch helper for the gateway's REST leaf clients (pricing, review-desk).
 *
 * Uses Node's global fetch (Node 18+) with an AbortController timeout. On a
 * network error or timeout it throws an error tagged `{ kind: "unavailable" }`
 * so the gateway maps it to 503. On a non-2xx HTTP response it throws
 * `{ kind: "http", status, body }` so the gateway can pass 4xx through.
 */
function unavailable(message) {
  return Object.assign(new Error(message), { kind: "unavailable" });
}

async function request(url, { method = "GET", body, headers = {}, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw unavailable(`Request to ${url} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status} from ${url}`), { kind: "http", status: res.status, body: payload });
  }
  return payload;
}

module.exports = { request, unavailable };
