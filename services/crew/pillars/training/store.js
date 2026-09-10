/**
 * The training store (PRD §6.4).
 *
 * Three collections: `courses`, `enrollments` and `certifications`.
 *
 * **A certificate is never edited and never deleted.** Re-passing a course mints a
 * NEW certification rather than extending the old one, and revoking sets
 * `revokedOn` rather than removing the row. Both are the same rule as the work
 * pillar's append-only log (§6.6) and for the same reason: "was Marek certified
 * last August?" has to stay answerable after this August's re-certification, and
 * "why is this ticket void?" has to stay answerable after it is voided.
 *
 * As in the leave store, `policies` there and `courses` here are keyed by `userId`,
 * because one file holds every owner's rows.
 */
const dbManager = require("../../../../data/database-manager");
const { withStoreLock } = require("../../serialise");

const RESOURCE = "crewTraining";
const FILE = "crew-training.json";
const DEFAULT_DATA = {
  courses: [],
  enrollments: [],
  certifications: [],
  counters: { lastCourseId: 0, lastEnrollmentId: 0, lastCertificationId: 0 },
};

function getStore() {
  return dbManager.getDatabase(RESOURCE, FILE, {
    courses: [],
    enrollments: [],
    certifications: [],
    counters: { ...DEFAULT_DATA.counters },
  });
}

/** Normalise on read, so a hand-edited file cannot crash a query. */
function normalise(data) {
  return {
    courses: Array.isArray(data?.courses) ? data.courses : [],
    enrollments: Array.isArray(data?.enrollments) ? data.enrollments : [],
    certifications: Array.isArray(data?.certifications) ? data.certifications : [],
    counters: {
      lastCourseId: Number(data?.counters?.lastCourseId) || 0,
      lastEnrollmentId: Number(data?.counters?.lastEnrollmentId) || 0,
      lastCertificationId: Number(data?.counters?.lastCertificationId) || 0,
    },
  };
}

async function read(store) {
  return normalise(await store.getAll());
}

/**
 * Read-modify-write inside a genuine critical section.
 *
 * Two things make this atomic, and both are load-bearing — see the long note in
 * `serialise.js` for why `JSONDatabase.update()` alone is not enough, and keep
 * `mutate` SYNCHRONOUS so the section is not opened from the inside.
 *
 * The race that matters here is `recordTrainingOutcome`: the transition check and
 * the certificate mint happen together, so two concurrent "passed" reports for one
 * enrollment mint exactly one certificate rather than two identical tickets with
 * different reference numbers.
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
