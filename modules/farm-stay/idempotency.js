/**
 * Idempotency guard for the FarmStay bridge's money operations (confirm / cancel).
 *
 * A client that double-taps "confirm", or retries after a dropped response, must
 * not charge/refund twice. Callers wrap the handler body in `withIdempotency(key,
 * fn)`; the FIRST call runs `fn` and its resolved `{ status, body }` is cached
 * under the key, so any repeat with the same key REPLAYS that stored result
 * instead of re-running the side effect.
 *
 * Concurrency: the in-flight Promise is stored immediately, so two simultaneous
 * requests with the same key share one execution (the second awaits the first)
 * rather than both hitting the financial service.
 *
 * Store: in-memory Map with a TTL — retry-dedup is inherently short-lived, and
 * keeping money side-effects out of a shared on-disk store avoids cross-test
 * contamination. Keys are namespaced by caller so two users cannot collide.
 *
 * If no key is supplied the guard is a passthrough (dedup is opt-in per request).
 */

const TTL_MS = Number(process.env.FARM_STAY_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);
const MAX_ENTRIES = Number(process.env.FARM_STAY_IDEMPOTENCY_MAX || 5000);

/** @type {Map<string, { expires: number, promise: Promise<{status:number, body:any}> }>} */
const store = new Map();

function prune(nowMs) {
  if (store.size <= MAX_ENTRIES) {
    // fast path: only drop expired lazily when we look them up
    return;
  }
  for (const [k, v] of store) {
    if (v.expires <= nowMs) store.delete(k);
  }
  // Still over budget after dropping expired → evict oldest (insertion order).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Run `fn` at most once per (namespace, key); replay the cached result otherwise.
 *
 * @param {object} opts
 * @param {string} opts.namespace  logical operation, e.g. "confirm" | "cancel"
 * @param {string|number} opts.user  caller id (keys are per-user)
 * @param {string} [opts.key]       client-supplied Idempotency-Key; falsy → no dedup
 * @param {() => Promise<{status:number, body:any}>} fn  the handler body
 * @returns {Promise<{ status:number, body:any, replayed:boolean }>}
 */
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

  // Store the in-flight promise up front so concurrent duplicates await it.
  const promise = Promise.resolve().then(fn);
  store.set(composite, { expires: now + TTL_MS, promise });
  prune(now);

  try {
    const result = await promise;
    return { ...result, replayed: false };
  } catch (err) {
    // A thrown handler is not a cacheable outcome — drop the entry so a later
    // retry can try again rather than replaying a rejection forever.
    store.delete(composite);
    throw err;
  }
}

/** Test/maintenance helper. */
function _clear() {
  store.clear();
}

module.exports = { withIdempotency, _clear };
