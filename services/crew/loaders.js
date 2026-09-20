/**
 * Per-request batching (PRD §7.2, §16 "N+1 store reads").
 *
 * Hand-rolled in ~40 lines instead of adding `dataloader`, and the reason is not
 * only dependency count: a loader whose lifetime is one request cannot leak data
 * between users, because there is nowhere for it to leak TO. A process-wide cache
 * keyed by staff id would be one missing scope check away from serving user A's
 * crew member to user B. This design makes that bug unrepresentable rather than
 * merely absent.
 *
 * Two consequences worth knowing when using it:
 *   - a loader is created fresh in `context.js` for every request and thrown away
 *     with it. Never hoist one to module scope;
 *   - within a request, a value is fetched at most once, so a roster query reads
 *     each store once regardless of crew size. `extensions.storeReads` reports
 *     that number, and a test asserts it does not grow with the roster.
 */

/**
 * A single-value lazy cache: the batch function runs once per request, on first
 * use, and every caller after that gets the same promise.
 *
 * @param {() => Promise<T>} load
 * @template T
 */
function createOnce(load) {
  let promise = null;
  return {
    get() {
      if (!promise) promise = load();
      return promise;
    },
    /** Whether this loader was ever used — handy for asserting laziness. */
    get isLoaded() {
      return promise !== null;
    },
    reset() {
      promise = null;
    },
  };
}

/**
 * A keyed loader that satisfies every key from one batch read.
 *
 * Individual `get(key)` calls do NOT each hit the store: the first one triggers
 * the batch, everyone else waits on it. That is the whole N+1 fix.
 *
 * @param {() => Promise<Map<K, V>>} loadAll
 * @template K, V
 */
function createBatchLoader(loadAll) {
  const once = createOnce(loadAll);
  return {
    async get(key) {
      const map = await once.get();
      return map.get(key);
    },
    async getMany(keys) {
      const map = await once.get();
      return keys.map((key) => map.get(key));
    },
    async all() {
      return once.get();
    },
    /**
     * Drop the batch so the next read hits the store again.
     *
     * Required after a WRITE. A loader exists to answer the same question once
     * per request — but a mutation changes the answer mid-request, and a resolver
     * that re-reads to report what it just wrote would otherwise be served the
     * pre-write snapshot. Every write path calls this; forgetting to is how a
     * mutation ends up returning stale data in its own response.
     */
    reset() {
      once.reset();
    },
    get isLoaded() {
      return once.isLoaded;
    },
  };
}

/** Index an array of rows by a numeric key, collecting duplicates into arrays. */
function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

/** Index an array of rows by a unique key, last write winning. */
function indexBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) map.set(keyOf(row), row);
  return map;
}

module.exports = { createOnce, createBatchLoader, groupBy, indexBy };
