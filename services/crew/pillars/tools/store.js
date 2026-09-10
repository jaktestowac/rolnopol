/**
 * The tools store (PRD §6.5).
 *
 * Three collections: `tools`, `issuances` and `serviceRecords`.
 *
 * `issuances` is the **append-only ledger** (§6.6) and the current holder is never
 * written to a tool row (§8.5) — `ledger.js` derives it. The one in-place write the
 * ledger allows is a return stamping `returnedAt` and `conditionOnReturn` on the
 * row it closes, once, never again. Everything else appends.
 *
 * Note what a tool row's `status` does and does not hold: `available`,
 * `in_service` or `retired` only. `on_issue` is computed, because two writable
 * sources of truth for "is the chainsaw out?" is the drift this pillar exists to
 * avoid — see decision 1 in `ledger.js`.
 */
const dbManager = require("../../../../data/database-manager");
const { withStoreLock } = require("../../serialise");

const RESOURCE = "crewTools";
const FILE = "crew-tools.json";
const DEFAULT_DATA = {
  tools: [],
  issuances: [],
  serviceRecords: [],
  counters: { lastToolId: 0, lastIssuanceId: 0, lastServiceRecordId: 0 },
};

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, {
    tools: [],
    issuances: [],
    serviceRecords: [],
    counters: { ...DEFAULT_DATA.counters },
  });
}

/** Normalise on read, so a hand-edited file cannot crash a query. */
function normalise(data) {
  return {
    tools: Array.isArray(data?.tools) ? data.tools : [],
    issuances: Array.isArray(data?.issuances) ? data.issuances : [],
    serviceRecords: Array.isArray(data?.serviceRecords) ? data.serviceRecords : [],
    counters: {
      lastToolId: Number(data?.counters?.lastToolId) || 0,
      lastIssuanceId: Number(data?.counters?.lastIssuanceId) || 0,
      lastServiceRecordId: Number(data?.counters?.lastServiceRecordId) || 0,
    },
  };
}

async function read(store) {
  return normalise(await store.getAll());
}

/**
 * Read-modify-write inside a genuine critical section.
 *
 * The race this exists for is `issueTool`, and it is the sharpest one in the
 * module: **two concurrent issues of the same tool must produce exactly one
 * `ToolIssued`.** What makes that true is that the "is anybody holding it?" scan of
 * the ledger and the append of the new row happen inside one section, with a
 * SYNCHRONOUS `mutate`. Move the scan out — or introduce an `await` inside — and
 * both writers scan a ledger that predates the other, both find the tool free, and
 * the chainsaw is issued twice with no rule broken anywhere.
 *
 * See the long note in `serialise.js` for why `JSONDatabase.update()` alone does
 * not give this.
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
