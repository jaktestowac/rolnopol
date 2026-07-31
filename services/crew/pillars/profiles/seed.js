/**
 * Idempotent demo seed (PRD §11).
 *
 * Gives the fifteen existing staff records plausible employment profiles so the
 * roster is not empty on first enable. Two rules:
 *
 *   - **Idempotent.** Running it twice changes nothing. It only ever ADDS a
 *     profile for a staff member that has none, so a seed can never overwrite a
 *     profile someone edited.
 *   - **It writes only to the crew overlay.** Seeding never touches `staff.json`
 *     — it profiles the records that are already there (§12.2).
 */
const { getStore, read, transact } = require("./store");
const { ROLES, EMPLOYMENT_TYPES } = require("./service");

// Spread deterministically rather than randomly: the same staff list always
// produces the same roster, so a screenshot or a test expectation stays valid.
const FTE_CYCLE = [1.0, 1.0, 0.8, 1.0, 0.5, 1.0, 0.6];
const HOURS_CYCLE = [40, 40, 32, 40, 20, 40, 24];

/**
 * @param {object} options
 * @param {Array<{id:number,userId:number}>} options.staffRecords - existing staff
 * @param {string} options.today - YYYY-MM-DD from the injected clock
 * @param {string} options.nowIso
 * @returns {Promise<{created: number, skipped: number}>}
 */
async function seedProfiles({ staffRecords, today, nowIso }) {
  const store = getStore();
  const { profiles } = await read(store);

  const alreadyProfiled = new Set(profiles.map((profile) => `${profile.userId}:${profile.staffId}`));
  const toCreate = staffRecords.filter((staff) => !alreadyProfiled.has(`${Number(staff.userId)}:${Number(staff.id)}`));

  if (toCreate.length === 0) {
    return { created: 0, skipped: staffRecords.length };
  }

  return transact(store, (document) => {
    let lastProfileId = document.counters.lastProfileId;
    const added = [];

    for (const [index, staff] of toCreate.entries()) {
      lastProfileId += 1;
      added.push({
        id: lastProfileId,
        staffId: Number(staff.id),
        userId: Number(staff.userId),
        role: ROLES[index % ROLES.length],
        employmentType: EMPLOYMENT_TYPES[index % EMPLOYMENT_TYPES.length],
        fte: FTE_CYCLE[index % FTE_CYCLE.length],
        contractedHoursPerWeek: HOURS_CYCLE[index % HOURS_CYCLE.length],
        // Staggered start dates, oldest hire first, so tenure and probation are
        // both represented in the seeded roster.
        startDate: startDateFor(today, index),
        endDate: null,
        endReason: null,
        emergencyContact: null,
        notes: "Seeded demo profile.",
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      });
    }

    return {
      document: {
        profiles: [...document.profiles, ...added],
        counters: { ...document.counters, lastProfileId },
      },
      result: { created: added.length, skipped: staffRecords.length - added.length },
    };
  });
}

/** index 0 starts ~5 years ago, later ones progressively more recent. */
function startDateFor(today, index) {
  const base = new Date(`${today}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - Math.max(20, 1800 - index * 120));
  return base.toISOString().slice(0, 10);
}

module.exports = { seedProfiles, startDateFor };
