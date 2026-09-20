/**
 * The work store (PRD §6.2).
 *
 * Three collections in one document: `dutyTypes`, `shifts` and `workLog`.
 *
 * `workLog` is **append-only** (§6.6). A correction never edits the row it
 * corrects; it appends a new row pointing back at it via `amendsId`. That is what
 * makes the rollup property test possible — the history is a replayable log rather
 * than a mutable total — and it is why a wrong hours entry can be audited instead
 * of merely fixed.
 */
const dbManager = require("../../../../data/database-manager");

const RESOURCE = "crewWork";
const FILE = "crew-work.json";
const DEFAULT_DATA = {
  dutyTypes: [],
  shifts: [],
  workLog: [],
  counters: { lastDutyTypeId: 0, lastShiftId: 0, lastWorkLogId: 0 },
};

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, {
    dutyTypes: [],
    shifts: [],
    workLog: [],
    counters: { ...DEFAULT_DATA.counters },
  });
}

/** Normalise on read, so a hand-edited file cannot crash a query. */
function normalise(data) {
  return {
    dutyTypes: Array.isArray(data?.dutyTypes) ? data.dutyTypes : [],
    shifts: Array.isArray(data?.shifts) ? data.shifts : [],
    workLog: Array.isArray(data?.workLog) ? data.workLog : [],
    counters: {
      lastDutyTypeId: Number(data?.counters?.lastDutyTypeId) || 0,
      lastShiftId: Number(data?.counters?.lastShiftId) || 0,
      lastWorkLogId: Number(data?.counters?.lastWorkLogId) || 0,
    },
  };
}

async function read(store) {
  return normalise(await store.getAll());
}

/**
 * Read-modify-write under the store's own lock.
 *
 * Serialising through `store.update()` is what makes two concurrent shift plans
 * resolve to one winner: the overlap check and the append happen inside the same
 * critical section, so the second writer sees the first writer's shift.
 */
async function transact(store, mutate) {
  let captured;
  await store.update((current) => {
    const document = normalise(current);
    const { document: next, result } = mutate(document);
    captured = result;
    return next;
  });
  return captured;
}

module.exports = { getStore, read, transact, normalise, RESOURCE, FILE, DEFAULT_DATA };
