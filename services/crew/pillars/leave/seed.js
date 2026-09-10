/**
 * Idempotent demo seed for the leave pillar (PRD §11).
 *
 * Gives a fresh install something worth looking at: a policy per owner, a
 * plausible set of public holidays, a harvest blackout, and a couple of requests
 * in different states so the approval queue is not empty on first visit.
 *
 * Same two rules as the other pillars' seeds —
 *
 *   - **idempotent**: a policy is only written when that owner has none, and
 *     requests are only added when that owner has none, so running it twice
 *     changes nothing;
 *   - **crew stores only**: it never touches `staff.json`; it gives holidays to
 *     the people who are already there (§12.2).
 *
 * The seeded requests deliberately stay small. The balance is computed, so a
 * generous demo booking would leave every seeded member looking nearly out of
 * days — which is a worse first impression than an almost-empty calendar.
 */
const { getStore, read, transact } = require("./store");
const { addDays } = require("../../clock");

/** Fixed dates, so the demo policy does not silently change meaning each year. */
const PUBLIC_HOLIDAYS_BY_YEAR = {
  2026: ["2026-01-01", "2026-01-06", "2026-04-06", "2026-05-01", "2026-05-03", "2026-08-15", "2026-11-11", "2026-12-25", "2026-12-26"],
  2027: ["2027-01-01", "2027-01-06", "2027-03-29", "2027-05-01", "2027-05-03", "2027-08-15", "2027-11-11", "2027-12-25", "2027-12-26"],
};

function demoPolicy(today) {
  const year = Number(today.slice(0, 4));
  // Whatever year the clock says, plus the next one, so a request planned across
  // the new year still meets a policy that knows about its holidays.
  const holidays = [...(PUBLIC_HOLIDAYS_BY_YEAR[year] || []), ...(PUBLIC_HOLIDAYS_BY_YEAR[year + 1] || [])];

  return {
    annualEntitlementDaysFullTime: 26,
    accrualMode: "monthly",
    carryOverCapDays: 5,
    carryOverExpiresOn: "03-31",
    leaveYearStart: "01-01",
    publicHolidays: holidays,
    // The blackout the domain exists to model: nobody takes annual leave during
    // harvest, and the module should show that rule rather than describe it.
    blackoutWindows: [{ from: `${year}-08-15`, to: `${year}-09-15`, reason: "Harvest" }],
    minNoticeDays: 3,
  };
}

async function seedLeave({ staffRecords, today, nowIso }) {
  const store = getStore();
  const existing = await read(store);

  return transact(store, (document) => {
    let lastPolicyId = document.counters.lastPolicyId;
    let lastRequestId = document.counters.lastRequestId;

    const byUser = new Map();
    for (const staff of staffRecords) {
      const list = byUser.get(Number(staff.userId)) || [];
      list.push(staff);
      byUser.set(Number(staff.userId), list);
    }

    const addedPolicies = [];
    const addedRequests = [];

    for (const [userId, staff] of byUser.entries()) {
      if (!document.policies.some((row) => Number(row.userId) === userId)) {
        lastPolicyId += 1;
        addedPolicies.push({ id: lastPolicyId, userId, ...demoPolicy(today), createdAt: nowIso, updatedAt: nowIso, version: 1 });
      }

      // Only when this owner has no requests at all, so a seed can never scribble
      // over a calendar somebody built.
      if (document.requests.some((row) => Number(row.userId) === userId)) continue;

      staff.slice(0, 2).forEach((member, index) => {
        // Far enough out to clear the 3-day notice rule and the harvest blackout
        // is in August, so a request in the next few weeks is safe either way
        // unless the clock happens to sit in August — in which case the seeded
        // request is simply a pending one the office can reject. Still honest.
        const from = addDays(today, 21 + index * 14);
        const to = addDays(from, 2);
        lastRequestId += 1;
        addedRequests.push({
          id: lastRequestId,
          userId,
          staffId: Number(member.id),
          type: "annual",
          from,
          to,
          halfDayStart: false,
          halfDayEnd: false,
          // Three calendar days; the real cost depends on where the weekend falls,
          // which is why this is recomputed rather than hard-coded.
          workingDays: countWorkingDays(from, to, addedPolicies[0] || document.policies[0]),
          // One approved and one pending, so the calendar and the approval queue
          // both show something.
          status: index === 0 ? "approved" : "requested",
          reason: "Seeded demo request.",
          decidedBy: index === 0 ? userId : null,
          decidedAt: index === 0 ? nowIso : null,
          createdAt: nowIso,
          version: 1,
        });
      });
    }

    return {
      document: {
        ...document,
        policies: [...document.policies, ...addedPolicies],
        requests: [...document.requests, ...addedRequests],
        counters: { ...document.counters, lastPolicyId, lastRequestId },
      },
      result: {
        policiesCreated: addedPolicies.length,
        requestsCreated: addedRequests.length,
        policiesBefore: existing.policies.length,
      },
    };
  });
}

/**
 * Working days in a seeded range.
 *
 * A local copy of the rule rather than a call into `accrual.js`, because the seed
 * runs before any request context exists and only needs the plain case: no half
 * days, weekends and listed holidays excluded.
 */
function countWorkingDays(from, to, policy) {
  const holidays = new Set(policy?.publicHolidays || []);
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

module.exports = { seedLeave, demoPolicy, countWorkingDays, PUBLIC_HOLIDAYS_BY_YEAR };
