/**
 * Promo codes — compiled-in, NOT data.
 *
 * Coupons live here for the same reason seasons do: the pricing service is
 * stateless (no `data/`, no `db.js`), and a quote must be a pure, deterministic
 * function of its inputs so the confirm-time re-quote reproduces the booked total
 * to the penny. A coupon's effect therefore depends only on (code, nights) — no
 * per-user usage counters (that would require state and break determinism).
 *
 * Eligibility that CAN stay deterministic:
 *   - `minNights` — the stay must be at least this many nights.
 * Redemption limits / expiry-by-wall-clock are intentionally out of scope for the
 * stateless pricing leaf; add them in a stateful coupon owner if ever needed.
 */

// code → rule. `type`: "percent" (value = 0-100) | "fixed" (value = ROL off).
const COUPONS = {
  WELCOME10: { type: "percent", value: 10, label: "Welcome — 10% off", minNights: 1 },
  SPRING25: { type: "fixed", value: 25, label: "Spring — 25 ROL off", minNights: 2 },
  LONGHAUL15: { type: "percent", value: 15, label: "Long-haul — 15% off", minNights: 5 },
};

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

/**
 * Resolve a raw coupon code.
 * @returns {null|{code:string, def?:object, error?:string}}
 *   - `null` when no code was supplied
 *   - `{ code, def }` when the code is known
 *   - `{ code, error: "COUPON_NOT_FOUND" }` when it is not
 */
function findCoupon(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const def = COUPONS[normalized];
  if (!def) return { code: normalized, error: "COUPON_NOT_FOUND" };
  return { code: normalized, def };
}

/**
 * Compute the discount a coupon applies to a nightly `subtotal` for a stay of
 * `nights` nights. Pure. Returns a structured outcome the quote can embed.
 *
 * @returns {{ code:string, applied:boolean, amount:number, label?:string, error?:string }}
 */
function applyCoupon(rawCode, subtotal, nights, round2) {
  const resolved = findCoupon(rawCode);
  if (!resolved) return { code: "", applied: false, amount: 0 };
  if (resolved.error) return { code: resolved.code, applied: false, amount: 0, error: resolved.error };

  const { code, def } = resolved;
  if (def.minNights && nights < def.minNights) {
    return { code, applied: false, amount: 0, error: "COUPON_MIN_NIGHTS", minNights: def.minNights };
  }

  let amount = def.type === "percent" ? round2((subtotal * def.value) / 100) : round2(def.value);
  // Never discount below zero.
  if (amount > subtotal) amount = subtotal;
  return { code, applied: true, amount, label: def.label };
}

module.exports = { COUPONS, normalizeCode, findCoupon, applyCoupon };
