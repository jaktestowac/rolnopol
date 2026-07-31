/**
 * The leave store (PRD §6.3).
 *
 * Three collections: `policies`, `requests` and `adjustments`.
 *
 * **`adjustments` is append-only** (§6.6) and holds both manual corrections and
 * carry-over grants. Nothing in this module edits or removes an adjustment row: a
 * mistaken correction is answered with an opposite one, so the reason someone's
 * balance moved is always readable off the log.
 *
 * Two deliberate departures from the §6.3 sketch, both because the sketch shows
 * one owner's slice of a store that in fact holds every owner's:
 *
 *   - `policy` becomes `policies: []`, one row per `userId`. A single object would
 *     have made the store un-shareable the moment a second user enabled the module.
 *   - the sketch's `reason: "carry_over_grant"` becomes `kind` + `reason`. One
 *     field cannot be both a machine discriminator and the sentence an auditor
 *     reads; overloading it means either the code greps for prose or the prose is
 *     lost.
 *
 * **Balance is not here, and must never be.** It is computed by `accrual.js` from
 * these rows plus the profile's FTE. A stored total is the classic drift bug, and
 * §6.3 rules it out explicitly.
 */
const dbManager = require("../../../../data/database-manager");
const { withStoreLock } = require("../../serialise");

const RESOURCE = "crewLeave";
const FILE = "crew-leave.json";
const DEFAULT_DATA = {
  policies: [],
  requests: [],
  adjustments: [],
  counters: { lastPolicyId: 0, lastRequestId: 0, lastAdjustmentId: 0 },
};

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, {
    policies: [],
    requests: [],
    adjustments: [],
    counters: { ...DEFAULT_DATA.counters },
  });
}

/** Normalise on read, so a hand-edited file cannot crash a query. */
function normalise(data) {
  return {
    policies: Array.isArray(data?.policies) ? data.policies : [],
    requests: Array.isArray(data?.requests) ? data.requests : [],
    adjustments: Array.isArray(data?.adjustments) ? data.adjustments : [],
    counters: {
      lastPolicyId: Number(data?.counters?.lastPolicyId) || 0,
      lastRequestId: Number(data?.counters?.lastRequestId) || 0,
      lastAdjustmentId: Number(data?.counters?.lastAdjustmentId) || 0,
    },
  };
}

async function read(store) {
  return normalise(await store.getAll());
}

/**
 * Read-modify-write inside a genuine critical section.
 *
 * This is the mechanism behind the module's core race (§14.4 item 4): two leave
 * requests that each fit the balance but not together must resolve to exactly one
 * booking. That is only true if the balance check and the append cannot be
 * separated, so the second writer recomputes the balance against a document that
 * already contains the first writer's request.
 *
 * Two things make it true, and both are load-bearing:
 *
 *   - **`withStoreLock`**, because `JSONDatabase.update()` alone is not atomic —
 *     it has an await between reading the document and assigning the new one. See
 *     the long note in `serialise.js`; without the lock the guarantee is a matter
 *     of timing luck rather than design.
 *   - **`mutate` stays SYNCHRONOUS.** An `await` inside it would open the section
 *     from the inside and hand the race straight back.
 */
async function transact(store, mutate) {
  return withStoreLock(RESOURCE, async () => {
    let captured;
    await store.update((current) => {
      const document = normalise(current);
      const { document: next, result } = mutate(document);
      captured = result;
      return next;
    });
    return captured;
  });
}

module.exports = { getStore, read, transact, normalise, RESOURCE, FILE, DEFAULT_DATA };
