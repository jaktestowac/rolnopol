/**
 * The profiles store (PRD §6.1).
 *
 * Created through the existing public `dbManager.getDatabase(...)`, which is why
 * `data/database-manager.js` needs no edit at all — a real isolation win, and the
 * reason the crew stores are invisible to the rest of the app.
 *
 * Note what constructing this does NOT do: `getDatabase` only builds the instance.
 * The file appears on disk at the first read or write, which happens only behind
 * the feature gate — so with the flag off there is no `data/crew-profiles.json`,
 * as §12 rule 1 requires and `crew-isolation.test.js` asserts.
 */
const dbManager = require("../../../../data/database-manager");

const RESOURCE = "crewProfiles";
const FILE = "crew-profiles.json";
const DEFAULT_DATA = { profiles: [], counters: { lastProfileId: 0 } };

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, { ...DEFAULT_DATA, profiles: [], counters: { ...DEFAULT_DATA.counters } });
}

/** Read the whole document, normalised so a hand-edited file cannot crash a query. */
async function read(store) {
  const data = await store.getAll();
  return {
    profiles: Array.isArray(data?.profiles) ? data.profiles : [],
    counters: { lastProfileId: Number(data?.counters?.lastProfileId) || 0 },
  };
}

/**
 * Read-modify-write under the store's own lock.
 *
 * `mutate` receives the normalised document and returns `{ document, result }`.
 * Serialising through `store.update()` is what makes two concurrent writes
 * resolve to one winner rather than to a lost update — the same reason the leave
 * race test in Phase 4 will lean on this function rather than on its own locking.
 */
async function transact(store, mutate) {
  let captured;
  await store.update((current) => {
    const document = {
      profiles: Array.isArray(current?.profiles) ? current.profiles : [],
      counters: { lastProfileId: Number(current?.counters?.lastProfileId) || 0 },
    };
    const { document: next, result } = mutate(document);
    captured = result;
    return next;
  });
  return captured;
}

module.exports = { getStore, read, transact, RESOURCE, FILE, DEFAULT_DATA };
