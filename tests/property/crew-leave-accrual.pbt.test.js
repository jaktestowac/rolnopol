import { describe, test, expect } from "vitest";
import fc from "fast-check";

// The leave-balance invariant (PRD §14.3, §14.4 item 5).
//
// One of the six tests the PRD says must exist, and the reason is stated plainly:
// accrual arithmetic bugs are the kind no example-based test will corner. The
// interesting failures live where a part-time contract meets a 28-day month, a
// mid-year leaver meets a carry-over deadline, and a sequence of book / approve /
// cancel / adjust operations meets all of them at once.
//
// Two claims are under test, and they are different in kind:
//
//   1. **The identity** `accrued + carriedOver − taken − booked == remaining`,
//      at any `asOf`. True by construction in `accrual.js` — which is the point.
//      This test is the tripwire that fires if somebody ever computes `remaining`
//      a second way, or clamps it, or reorders the terms.
//
//   2. **`remaining ≥ 0` at the END of a leave year** for annual leave, after any
//      legal sequence of operations. This is the substantive claim, and it needs
//      the year end specifically: `remaining` at an arbitrary `asOf` may legally
//      be negative — booking October in July commits days not yet accrued — but a
//      leave year must never be able to FINISH overdrawn. Year end is also the
//      strictest point, because everything that will accrue has accrued and any
//      carry-over has already expired.
//
// The model below applies the same guards the service does (a request is measured
// on its LAST day; an adjustment may not overdraw the year) without touching a
// store, so what is being tested is the arithmetic rather than the plumbing.
const {
  LEAVE_TYPES,
  TYPE_RULES,
  roundDays,
  leaveYearBounds,
  entitlementFor,
  accruedTo,
  workingDaysFor,
  rangesOverlap,
  carryOverExpiryDate,
  computeBalance,
  inclusiveDays,
  datesInRange,
} = require("../../services/crew/pillars/leave/accrual");
const { addDays } = require("../../services/crew/clock");

const STAFF_ID = 3;
const LEAVE_YEAR = 2026;

/** Anchors with a day of 1–28, which is all `leaveYearStart` allows. */
const YEAR_STARTS = ["01-01", "04-06", "07-15", "02-01"];
const EXPIRY_ANCHORS = [null, "03-31", "06-30", "12-31"];

const policyArb = fc.record({
  // Half-day steps, including 0 — a policy with no annual allowance is legal and
  // is the case where every annual request must be refused.
  annualEntitlementDaysFullTime: fc.integer({ min: 0, max: 80 }).map((halves) => halves / 2),
  accrualMode: fc.constantFrom("monthly", "upfront"),
  carryOverCapDays: fc.integer({ min: 0, max: 20 }).map((halves) => halves / 2),
  carryOverExpiresOn: fc.constantFrom(...EXPIRY_ANCHORS),
  leaveYearStart: fc.constantFrom(...YEAR_STARTS),
  publicHolidays: fc.uniqueArray(fc.integer({ min: 0, max: 364 }), { maxLength: 12 }),
  minNoticeDays: fc.constant(0),
  blackoutWindows: fc.constant([]),
});

/**
 * A contract whose start and end can fall anywhere around the leave year —
 * including before it, inside it, and after it — so mid-year joiners and leavers
 * are generated rather than hoped for.
 */
const profileArb = fc.record({
  fte: fc.integer({ min: 1, max: 10 }).map((tenths) => tenths / 10),
  startOffset: fc.integer({ min: -400, max: 360 }),
  endOffset: fc.option(fc.integer({ min: -30, max: 500 }), { nil: null }),
});

const operationArb = fc.oneof(
  fc.record({
    kind: fc.constant("request"),
    type: fc.constantFrom(...LEAVE_TYPES),
    startOffset: fc.integer({ min: 0, max: 360 }),
    length: fc.integer({ min: 0, max: 13 }),
    halfDayStart: fc.boolean(),
    halfDayEnd: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("approve"), pick: fc.nat() }),
  fc.record({ kind: fc.constant("cancel"), pick: fc.nat() }),
  fc.record({ kind: fc.constant("reject"), pick: fc.nat() }),
  fc.record({ kind: fc.constant("adjust"), halves: fc.integer({ min: -20, max: 20 }) }),
  fc.record({ kind: fc.constant("carryOver"), halves: fc.integer({ min: 1, max: 20 }) }),
);

const scenarioArb = fc.record({
  policy: policyArb,
  profile: profileArb,
  operations: fc.array(operationArb, { maxLength: 30 }),
});

/**
 * Replay a scenario the way the service would, and return everything a balance
 * needs.
 *
 * Every refusal here mirrors a real one: an overlap, a period with no chargeable
 * day, a request the balance cannot cover ON ITS LAST DAY, an adjustment that
 * would overdraw the year, a carry-over grant above the cap. An operation that
 * would be refused is simply not applied — which is exactly what the service does.
 */
function replay({ policy: rawPolicy, profile: rawProfile, operations }) {
  const anchor = `${LEAVE_YEAR}-${rawPolicy.leaveYearStart}`;
  const year = leaveYearBounds({ leaveYearStart: rawPolicy.leaveYearStart }, anchor);

  // Public holidays are generated as day offsets so they always land inside the
  // leave year, whatever the anchor is.
  const policy = { ...rawPolicy, publicHolidays: rawPolicy.publicHolidays.map((offset) => addDays(year.from, offset)).sort() };

  const profile = {
    fte: rawProfile.fte,
    startDate: addDays(year.from, rawProfile.startOffset),
    endDate: rawProfile.endOffset === null ? null : addDays(year.from, rawProfile.endOffset),
  };
  // A contract that ends before it starts is not a contract; drop the end date
  // rather than generating nonsense.
  if (profile.endDate && profile.endDate < profile.startDate) profile.endDate = null;

  const requests = [];
  const adjustments = [];
  const yearLength = inclusiveDays(year.from, year.to);
  const balanceAt = (asOf, rows) => computeBalance({ policy, profile, requests: rows, adjustments, asOf });

  for (const operation of operations) {
    if (operation.kind === "request") {
      const from = addDays(year.from, Math.min(operation.startOffset, yearLength - 1));
      const to = addDays(from, operation.length);
      // The service refuses a request spanning two leave years; so does this.
      if (to > year.to) continue;

      const { workingDays } = workingDaysFor(policy, { from, to, halfDayStart: operation.halfDayStart, halfDayEnd: operation.halfDayEnd });
      if (workingDays <= 0) continue;

      const live = requests.filter((row) => ["requested", "approved"].includes(row.status));
      if (live.some((row) => rangesOverlap(row, { from, to }))) continue;

      // The guard: measured on the request's LAST day.
      if (TYPE_RULES[operation.type].consumesBalance) {
        const before = balanceAt(to, requests);
        if (!before || before.remaining < workingDays) continue;
      }

      requests.push({
        id: requests.length + 1,
        staffId: STAFF_ID,
        type: operation.type,
        from,
        to,
        halfDayStart: operation.halfDayStart,
        halfDayEnd: operation.halfDayEnd,
        workingDays,
        status: "requested",
      });
      continue;
    }

    if (operation.kind === "approve") {
      const pending = requests.filter((row) => row.status === "requested");
      if (pending.length === 0) continue;
      const target = pending[operation.pick % pending.length];

      // Approval re-checks the balance, exactly as the service does.
      if (TYPE_RULES[target.type].consumesBalance) {
        const others = requests.filter((row) => row.id !== target.id);
        const check = balanceAt(target.to, others);
        if (check && check.remaining < target.workingDays) continue;
      }
      target.status = "approved";
      continue;
    }

    if (operation.kind === "cancel") {
      const live = requests.filter((row) => ["requested", "approved"].includes(row.status));
      if (live.length === 0) continue;
      const target = live[operation.pick % live.length];
      // Pending ⇒ withdrawn, approved ⇒ cancelled. Both terminal, both keep the row.
      target.status = target.status === "requested" ? "withdrawn" : "cancelled";
      continue;
    }

    if (operation.kind === "reject") {
      const pending = requests.filter((row) => row.status === "requested");
      if (pending.length === 0) continue;
      pending[operation.pick % pending.length].status = "rejected";
      continue;
    }

    if (operation.kind === "adjust") {
      const days = operation.halves / 2;
      if (days === 0) continue;
      if (days < 0) {
        // Refused if it would overdraw the year, measured at the year's end.
        const after = computeBalance({
          policy,
          profile,
          requests,
          adjustments: [...adjustments, { staffId: STAFF_ID, leaveYear: year.leaveYear, days, kind: "manual" }],
          asOf: year.to,
        });
        if (after && after.remaining < 0) continue;
      }
      adjustments.push({ staffId: STAFF_ID, leaveYear: year.leaveYear, days, kind: "manual" });
      continue;
    }

    if (operation.kind === "carryOver") {
      const days = operation.halves / 2;
      const granted = adjustments.filter((row) => row.kind === "carry_over_grant").reduce((total, row) => total + row.days, 0);
      // Refused above the cap rather than clamped.
      if (granted + days > policy.carryOverCapDays) continue;
      adjustments.push({ staffId: STAFF_ID, leaveYear: year.leaveYear, days, kind: "carry_over_grant" });
    }
  }

  return { policy, profile, requests, adjustments, year };
}

/**
 * Dates worth sampling a balance on: the ends, the middle, and each expiry edge.
 *
 * Clamped to the leave year, because `balance(asOf)` answers for the leave year
 * CONTAINING `asOf`. A sample point one day past the year end asks about the next
 * year, where this year's requests correctly do not appear — so comparing it
 * against a model of this year's requests would be comparing two different
 * questions. (This test caught exactly that when the expiry anchor was `12-31`.)
 */
function samplePoints({ policy, year }) {
  const expiry = carryOverExpiryDate(policy, year.leaveYear);
  const middle = addDays(year.from, Math.floor(inclusiveDays(year.from, year.to) / 2));
  return [year.from, middle, year.to, ...(expiry ? [expiry, addDays(expiry, 1)] : [])]
    .filter(Boolean)
    .filter((date) => date >= year.from && date <= year.to);
}

const isHalfStep = (value) => Math.round(value * 2) === value * 2;

describe("leave balance — property based", () => {
  test("remaining always equals accrued + carriedOver − taken − booked", () => {
    // Claim 1: the identity, at every interesting date. A tripwire, on purpose.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        for (const asOf of samplePoints(state)) {
          const balance = computeBalance({ ...state, asOf });
          expect(balance.remaining).toBe(roundDays(balance.accrued + balance.carriedOver - balance.taken - balance.booked));
        }
      }),
      { numRuns: 300 },
    );
  });

  test("a leave year can never FINISH overdrawn", () => {
    // Claim 2, the substantive one. Every booking was guarded on its own last day
    // and every adjustment on the year's end; the property is that those local
    // checks compose into a solvent year.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        const balance = computeBalance({ ...state, asOf: state.year.to });
        expect(balance.remaining).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 400 },
    );
  });

  test("carry-over expiry costs exactly what was advertised as expiring", () => {
    // The honest form of "expiry is safe", and it is stronger than a
    // non-negativity claim.
    //
    // A first attempt asserted that a non-negative balance stays non-negative
    // across the deadline. That is FALSE, and this test found the counterexample:
    // a manual correction bigger than the accrual earned so far makes `accrued`
    // negative early in the year, carry-over can mask it, and the mask lifts at
    // the deadline. The balance is negative because of the correction, not because
    // of the expiry — and the design already allows a mid-year `remaining` to be
    // negative (see the year-end property above, which is the real solvency claim).
    //
    // What expiry must guarantee is that it takes nothing that was not already
    // reported as `expiringSoon`. Days that vanished with warning are a policy;
    // days that vanished without one are a bug.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        const expiry = carryOverExpiryDate(state.policy, state.year.leaveYear);
        fc.pre(expiry !== null && expiry < state.year.to);

        const before = computeBalance({ ...state, asOf: expiry });
        const after = computeBalance({ ...state, asOf: addDays(expiry, 1) });

        // The credit lost is exactly the credit that was flagged as expiring.
        expect(roundDays(before.carriedOver - after.carriedOver)).toBe(before.expiringSoon);
        // Nothing is left flagged once the deadline has passed.
        expect(after.expiringSoon).toBe(0);
        // And `remaining` fell by no more than that — accrual only ever grows, so
        // the day after the deadline can be better off, never worse than advertised.
        expect(after.remaining).toBeGreaterThanOrEqual(roundDays(before.remaining - before.expiringSoon));
      }),
      { numRuns: 300 },
    );
  });

  test("carried-over days that were spent in time survive the deadline", () => {
    // The other half: expiry must not claw back credit that has already been used.
    // Someone who took their carried-over days in February must not find them
    // deducted again in April.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        const expiry = carryOverExpiryDate(state.policy, state.year.leaveYear);
        fc.pre(expiry !== null && expiry < state.year.to);

        const after = computeBalance({ ...state, asOf: addDays(expiry, 1) });
        const spentInTime = state.requests
          .filter((row) => row.type === "annual" && ["requested", "approved"].includes(row.status) && row.to <= expiry)
          .reduce((total, row) => total + row.workingDays, 0);
        const granted = Math.min(
          state.adjustments.filter((row) => row.kind === "carry_over_grant").reduce((total, row) => total + row.days, 0),
          state.policy.carryOverCapDays,
        );

        expect(after.carriedOver).toBe(roundDays(Math.min(granted, spentInTime)));
      }),
      { numRuns: 300 },
    );
  });

  test("every reported figure is a whole or half day", () => {
    // The `Days` scalar refuses anything else, so a figure that is not a half step
    // is not merely untidy — it is a 500 at the transport layer.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        for (const asOf of samplePoints(state)) {
          const balance = computeBalance({ ...state, asOf });
          for (const key of ["entitlement", "accrued", "carriedOver", "taken", "booked", "expiringSoon", "remaining"]) {
            expect(isHalfStep(balance[key])).toBe(true);
          }
          for (const bucket of balance.byType) {
            expect(isHalfStep(bucket.taken)).toBe(true);
            expect(isHalfStep(bucket.booked)).toBe(true);
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  test("no counter except remaining is ever negative", () => {
    // `remaining` is signed by design; the others are not, and a negative number
    // of days taken would mean the accounting has inverted somewhere.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        for (const asOf of samplePoints(state)) {
          const balance = computeBalance({ ...state, asOf });
          for (const key of ["entitlement", "carriedOver", "taken", "booked", "expiringSoon"]) {
            expect(balance[key]).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  test("accrual never goes backwards as time passes", () => {
    // The guard on a request evaluates the balance on its LAST day. An accrual
    // that could decrease would let a booking pass its check and then fail it, and
    // the year-end property above would stop holding.
    fc.assert(
      fc.property(policyArb, profileArb, (rawPolicy, rawProfile) => {
        const { policy, profile, year } = replay({ policy: rawPolicy, profile: rawProfile, operations: [] });
        let previous = -1;
        for (const asOf of datesInRange(year.from, year.to).filter((_, index) => index % 11 === 0)) {
          const value = accruedTo(policy, profile, year, asOf);
          expect(value).toBeGreaterThanOrEqual(previous);
          previous = value;
        }
      }),
      { numRuns: 200 },
    );
  });

  test("accrual never exceeds the entitlement", () => {
    fc.assert(
      fc.property(policyArb, profileArb, (rawPolicy, rawProfile) => {
        const { policy, profile, year } = replay({ policy: rawPolicy, profile: rawProfile, operations: [] });
        const entitlement = entitlementFor(policy, profile);
        for (const asOf of samplePoints({ policy, year })) {
          expect(accruedTo(policy, profile, year, asOf)).toBeLessThanOrEqual(entitlement);
        }
      }),
      { numRuns: 250 },
    );
  });

  test("taken and booked together account for every live annual day, once each", () => {
    // The split between "finished" and "not finished yet" must lose nothing and
    // double-count nothing, whatever the amendment history of statuses.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        for (const asOf of samplePoints(state)) {
          const balance = computeBalance({ ...state, asOf });
          const liveAnnual = state.requests
            .filter((row) => row.type === "annual" && ["requested", "approved"].includes(row.status))
            .reduce((total, row) => total + row.workingDays, 0);
          expect(roundDays(balance.taken + balance.booked)).toBe(roundDays(liveAnnual));
        }
      }),
      { numRuns: 300 },
    );
  });

  test("cancelling every request restores the balance to its unbooked value", () => {
    // Reversibility. If cancelling did not fully release the days, a member who
    // planned and re-planned a holiday would slowly lose entitlement to nothing.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const state = replay(scenario);
        const asOf = state.year.to;

        const withNone = computeBalance({ ...state, requests: [], asOf });
        const allCancelled = computeBalance({
          ...state,
          requests: state.requests.map((row) => ({ ...row, status: "cancelled" })),
          asOf,
        });
        expect(allCancelled.remaining).toBe(withNone.remaining);
        expect(allCancelled.taken + allCancelled.booked).toBe(0);
      }),
      { numRuns: 250 },
    );
  });

  test("only annual leave moves the annual balance", () => {
    // §17 Q4, as a property rather than an example: replacing every request's type
    // with a non-consuming one must leave `remaining` at its unbooked value.
    fc.assert(
      fc.property(scenarioArb, fc.constantFrom("sick", "unpaid", "parental", "bereavement"), (scenario, type) => {
        const state = replay(scenario);
        const asOf = state.year.to;

        const unbooked = computeBalance({ ...state, requests: [], asOf });
        const retyped = computeBalance({ ...state, requests: state.requests.map((row) => ({ ...row, type })), asOf });
        expect(retyped.remaining).toBe(unbooked.remaining);
      }),
      { numRuns: 250 },
    );
  });
});
