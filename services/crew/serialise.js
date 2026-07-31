/**
 * A per-resource critical section for crew store writes (PRD §14.4 item 4).
 *
 * **Why this exists.** The module's central concurrency claim is that a
 * read-modify-write on a crew store is atomic: two leave requests that each fit
 * the balance but not together must resolve to exactly one booking, because the
 * second writer recomputes the balance against a document that already contains
 * the first writer's row.
 *
 * `JSONDatabase.update()` does not quite give that. Its body reads
 * `this.data`, computes the next document, and then calls `replaceAll`, which
 * `await`s `ensureInitialized()` BEFORE assigning `this.data`. That await is a
 * lost-update window: two callers whose awaits line up both read the pre-write
 * document, both compute a next document from it, and the second assignment
 * silently discards the first writer's change. In practice the window is usually
 * missed, because two HTTP requests rarely reach it in the same microtask — the
 * file write in between is slow enough to hide it. "Usually missed" is not a
 * guarantee, and a booking quietly overwritten is the worst failure this module
 * has: nobody is told, and the balance is wrong from then on.
 *
 * So writes are serialised here instead, on a promise chain per store resource.
 * The lock spans the whole read → decide → write → persist sequence, which is
 * what makes the balance check and the append genuinely inseparable.
 *
 * **Scope.** In-process only, which is the right scope: this app is one process
 * and every crew store is reached through one `dbManager` singleton. A
 * multi-process deployment would need the lock in the store layer, not here.
 *
 * **The rule for callers:** the work you pass in must be the ENTIRE critical
 * section. Reading before taking the lock and writing inside it reintroduces
 * exactly the bug above, one layer up.
 */

/** resource name → tail of that resource's write chain. */
const chains = new Map();

/**
 * Run `work` with exclusive access to `resource`, queued behind any write already
 * in flight for it.
 *
 * @param {string} resource - the store resource name, e.g. "crewLeave"
 * @param {() => Promise<T>} work
 * @returns {Promise<T>} whatever `work` resolves to; rejections propagate
 * @template T
 */
function withStoreLock(resource, work) {
  const previous = chains.get(resource) || Promise.resolve();

  // `then(work, work)` on purpose: a write that threw must release the lock, not
  // wedge every later write behind its rejection.
  const current = previous.then(work, work);

  // The queue tail must never be a rejected promise, or the next caller would
  // inherit someone else's failure. The caller still sees the real rejection via
  // `current`.
  chains.set(
    resource,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );

  return current;
}

/** Test hook: drop every queue. Only safe between tests, with nothing in flight. */
function resetStoreLocks() {
  chains.clear();
}

module.exports = { withStoreLock, resetStoreLocks };
