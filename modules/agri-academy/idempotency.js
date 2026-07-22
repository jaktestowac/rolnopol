/**
 * Idempotency guard for the AgriAcademy taker bridge's money operation
 * (POST /sessions for a paid exam). A client that double-taps enroll, or retries
 * after a dropped response, must not charge twice.
 *
 * Callers wrap the handler body in `withIdempotency({ namespace, user, key }, fn)`:
 * the FIRST call runs `fn` and its resolved `{ status, body }` is cached under the
 * (namespace, user, key) tuple, so any repeat with the same Idempotency-Key
 * REPLAYS that stored result instead of re-running the side effect. The in-flight
 * Promise is stored up front so two concurrent duplicates share one execution.
 *
 * In-memory Map with a TTL — retry-dedup is short-lived, and keeping money
 * side-effects out of a shared on-disk store avoids cross-test contamination.
 * No key supplied → passthrough (dedup is opt-in per request). This mirrors the
 * FarmStay bridge guard; the ROL `referenceId` on each transaction is the durable
 * backstop that `reconcile` relies on.
 */
const TTL_MS = Number(process.env.AGRI_ACADEMY_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);
const MAX_ENTRIES = Number(process.env.AGRI_ACADEMY_IDEMPOTENCY_MAX || 5000);

/** @type {Map<string, { expires: number, promise: Promise<{status:number, body:any}> }>} */
const store = new Map();

function prune(nowMs) {
  if (store.size <= MAX_ENTRIES) return;
  for (const [k, v] of store) if (v.expires <= nowMs) store.delete(k);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

async function withIdempotency({ namespace, user, key }, fn) {
  const now = Date.now();
  if (!key) {
    const result = await fn();
    return { ...result, replayed: false };
  }

  const composite = `${namespace}::${user}::${key}`;
  const existing = store.get(composite);
  if (existing && existing.expires > now) {
    const result = await existing.promise;
    return { ...result, replayed: true };
  }

  const promise = Promise.resolve().then(fn);
  store.set(composite, { expires: now + TTL_MS, promise });
  prune(now);

  try {
    const result = await promise;
    return { ...result, replayed: false };
  } catch (err) {
    store.delete(composite); // a thrown handler is not cacheable — let a retry try again
    throw err;
  }
}

function _clear() {
  store.clear();
}

module.exports = { withIdempotency, _clear };
