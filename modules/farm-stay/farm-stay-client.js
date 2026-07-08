/**
 * FarmStay client (app side) — thin HTTP proxy to the stay-gateway.
 *
 * The Rolnopol app holds no FarmStay domain logic or data and dials ONLY the
 * gateway (FARM_STAY_TARGET). The gateway orchestrates the five-service
 * ecosystem behind it. Identity is forwarded as the `x-stay-user` header.
 *
 * Every method resolves with `{ status, body }` so the route layer can decide
 * how to translate it (mostly passthrough). A network error / timeout surfaces
 * as `{ status: 503, body: { error: "FARM_STAY_OFFLINE" } }`.
 */
const BASE = process.env.FARM_STAY_TARGET || `http://localhost:${process.env.STAY_GATEWAY_PORT || 4310}`;
const TIMEOUT_MS = Number(process.env.FARM_STAY_CLIENT_TIMEOUT_MS || 4000);

async function call(method, path, { userId, body, query } = {}) {
  const url = new URL(`${BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(userId ? { "x-stay-user": String(userId) } : {}) },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    return { status: 503, body: { error: "FARM_STAY_OFFLINE", detail: "FarmStay gateway offline — run `npm run farmstay`" } };
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
  healthAll: () => call("GET", "/health/all"),
  getCatalog: (userId) => call("GET", "/v1/catalog", { userId }),
  search: (userId, query) => call("GET", "/v1/search", { userId, query }),
  getProperty: (userId, id, query) => call("GET", `/v1/properties/${encodeURIComponent(id)}`, { userId, query }),
  listMine: (userId) => call("GET", "/v1/properties/mine", { userId }),
  createProperty: (userId, body) => call("POST", "/v1/properties", { userId, body }),
  updateProperty: (userId, id, body) => call("PATCH", `/v1/properties/${encodeURIComponent(id)}`, { userId, body }),
  deleteProperty: (userId, id) => call("DELETE", `/v1/properties/${encodeURIComponent(id)}`, { userId }),
  addBlackout: (userId, id, body) => call("POST", `/v1/properties/${encodeURIComponent(id)}/blackouts`, { userId, body }),
  removeBlackout: (userId, id, lockId) =>
    call("DELETE", `/v1/properties/${encodeURIComponent(id)}/blackouts/${encodeURIComponent(lockId)}`, { userId }),
  listReviews: (userId, id, query) => call("GET", `/v1/properties/${encodeURIComponent(id)}/reviews`, { userId, query }),
  createBooking: (userId, body) => call("POST", "/v1/bookings", { userId, body }),
  confirmBooking: (userId, id, body) => call("POST", `/v1/bookings/${encodeURIComponent(id)}/confirm`, { userId, body }),
  cancelBooking: (userId, id) => call("POST", `/v1/bookings/${encodeURIComponent(id)}/cancel`, { userId }),
  listBookings: (userId, query) => call("GET", "/v1/bookings", { userId, query }),
  getBooking: (userId, id) => call("GET", `/v1/bookings/${encodeURIComponent(id)}`, { userId }),
  reviewBooking: (userId, id, body) => call("POST", `/v1/bookings/${encodeURIComponent(id)}/review`, { userId, body }),
};
