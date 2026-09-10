import { describe, it, expect } from "vitest";

// Leave accrual — the pure core (PRD §14.1, §8.3).
//
// This is the file the PRD calls a "pure-function boundary sweep", and the reason
// it exists is stated in §16: leave arithmetic goes wrong at month, year and DST
// boundaries, and those are precisely the bugs you cannot reproduce on demand
// unless the clock is a parameter. Everything below is a function call with an
// explicit date, so 29 February and the midnight a carry-over grant expires are
// as cheap to stand on as any other day.
//
// The cases were chosen to be the ones a reviewer would ask about:
//   - does a part-time contract get a sensible half-day number, or 7.8 days?
//   - does a 28-day February accrue the same twelfth as a 31-day January?
//   - does somebody who joins in July accrue half a year, and does somebody who
//     leaves in March stop accruing in March?
//   - is a week off over a public holiday four days or five?
//   - and does `remaining` still equal the definition after all of that?
const {
  roundDays,
  parseMonthDay,
  leaveYearBounds,
  monthSlices,
  inclusiveDays,
  entitlementFor,
  accruedTo,
  isWeekend,
  isWorkingDay,
  datesInRange,
  workingDaysFor,
  blackoutHit,
  rangesOverlap,
  carryOverExpiryDate,
  computeBalance,
  TYPE_RULES,
  LEAVE_TYPES,
} = require("../../services/crew/pillars/leave/accrual");

/** The ordinary policy: 26 days, monthly accrual, calendar leave year. */
const POLICY = {
  annualEntitlementDaysFullTime: 26,
  accrualMode: "monthly",
  carryOverCapDays: 5,
  carryOverExpiresOn: "03-31",
  leaveYearStart: "01-01",
  publicHolidays: ["2026-01-01", "2026-05-01", "2026-12-25"],
  blackoutWindows: [{ from: "2026-08-15", to: "2026-09-15", reason: "Harvest" }],
  minNoticeDays: 3,
};

const FULL_TIME = { fte: 1.0, startDate: "2026-01-01", endDate: null };
const yearOf = (policy, date) => leaveYearBounds(policy, date);
const accrued = (policy, profile, asOf) => accruedTo(policy, profile, yearOf(policy, asOf), asOf);

describe("roundDays — the half-day unit", () => {
  it.each([
    [0, 0],
    [2.16, 2],
    [2.25, 2.5],
    [2.24, 2],
    [7.8, 8],
    [12.75, 13],
    [-0.4, -0.5],
  ])("rounds %s to %s", (input, expected) => {
    expect(roundDays(input)).toBe(expected);
  });

  it("returns 0 for a non-number, so a bad row cannot poison a sum", () => {
    expect(roundDays(NaN)).toBe(0);
    expect(roundDays(Infinity)).toBe(0);
    expect(roundDays(undefined)).toBe(0);
  });
});

describe("parseMonthDay", () => {
  it.each(["01-01", "03-31", "12-25", "02-28"])("accepts %s", (value) => {
    expect(parseMonthDay(value)).not.toBeNull();
  });

  it("REJECTS 02-29 — an anchor that does not exist three years in four is a bug", () => {
    // The whole reason this rejection exists: a policy anchored on the leap day
    // would work in 2028 and throw, or silently shift, in 2029.
    expect(parseMonthDay("02-29")).toBeNull();
  });

  it.each(["04-31", "13-01", "00-10", "1-1", "2026-01-01", "", null, 101])("rejects %s", (value) => {
    expect(parseMonthDay(value)).toBeNull();
  });

  it("caps the day at 28 when asked, for a leave-year anchor", () => {
    // A leave year starting on the 29th–31st would have month slices that do not
    // exist in February. `leaveYearStart` therefore allows 1–28 only.
    expect(parseMonthDay("03-31", { maxDay: 28 })).toBeNull();
    expect(parseMonthDay("03-28", { maxDay: 28 })).toEqual({ month: 3, day: 28 });
  });
});

describe("leave-year bounds", () => {
  it("names a calendar leave year after its own year", () => {
    expect(yearOf(POLICY, "2026-07-30")).toEqual({ leaveYear: 2026, from: "2026-01-01", to: "2026-12-31" });
  });

  it("names an April-to-March year after the year it STARTS in", () => {
    // The only choice that keeps the label stable as the year runs on: in
    // February 2027 you are still in the 2026 leave year.
    const april = { ...POLICY, leaveYearStart: "04-06" };
    expect(yearOf(april, "2026-05-01")).toEqual({ leaveYear: 2026, from: "2026-04-06", to: "2027-04-05" });
    expect(yearOf(april, "2027-02-14")).toEqual({ leaveYear: 2026, from: "2026-04-06", to: "2027-04-05" });
    expect(yearOf(april, "2027-04-06").leaveYear).toBe(2027);
  });

  it("puts the first and last day of a leave year INSIDE it, and the day before OUTSIDE", () => {
    const april = { ...POLICY, leaveYearStart: "04-06" };
    expect(yearOf(april, "2026-04-06").leaveYear).toBe(2026);
    expect(yearOf(april, "2027-04-05").leaveYear).toBe(2026);
    expect(yearOf(april, "2026-04-05").leaveYear).toBe(2025);
  });

  it("makes consecutive leave years abut exactly — no date in both, none in neither", () => {
    const april = { ...POLICY, leaveYearStart: "04-06" };
    const first = yearOf(april, "2026-06-01");
    const second = yearOf(april, "2027-06-01");
    expect(inclusiveDays(first.from, first.to) + 1).toBe(inclusiveDays(first.from, second.from));
  });

  it("cuts a leave year into exactly twelve slices that tile it with no gap or overlap", () => {
    for (const anchor of ["01-01", "04-06", "07-28"]) {
      const year = yearOf({ ...POLICY, leaveYearStart: anchor }, "2026-08-01");
      const slices = monthSlices(year);
      expect(slices).toHaveLength(12);
      expect(slices[0].from).toBe(year.from);
      expect(slices[11].to).toBe(year.to);
      // Each slice starts the day after the previous one ends.
      const total = slices.reduce((sum, slice) => sum + inclusiveDays(slice.from, slice.to), 0);
      expect(total).toBe(inclusiveDays(year.from, year.to));
    }
  });

  it("returns null for an anchor with a day above 28", () => {
    expect(yearOf({ ...POLICY, leaveYearStart: "01-31" }, "2026-07-30")).toBeNull();
  });
});

describe("entitlement — pro-rata to FTE and nothing else", () => {
  it.each([
    [1.0, 26],
    [0.8, 21],
    [0.5, 13],
    [0.3, 8],
    [0.1, 2.5],
  ])("fte %s of 26 days is %s", (fte, expected) => {
    expect(entitlementFor(POLICY, { fte })).toBe(expected);
  });

  it("is a whole leave year even for somebody who joins in December", () => {
    // Entitlement is the year's allowance; ACCRUAL is what pro-rates by time.
    // Conflating the two is why part-year staff see numbers nobody can explain.
    expect(entitlementFor(POLICY, { fte: 1.0, startDate: "2026-12-01" })).toBe(26);
  });

  it("is 0 when the contract or the policy is unusable, rather than NaN", () => {
    expect(entitlementFor(POLICY, null)).toBe(0);
    expect(entitlementFor(POLICY, { fte: "part time" })).toBe(0);
    expect(entitlementFor({}, FULL_TIME)).toBe(0);
  });
});

describe("monthly accrual — the month-length boundaries", () => {
  it("credits one twelfth by the end of January and the whole lot by 31 December", () => {
    expect(accrued(POLICY, FULL_TIME, "2026-01-31")).toBe(2); // 26/12 = 2.16 → 2
    expect(accrued(POLICY, FULL_TIME, "2026-12-31")).toBe(26);
  });

  it("gives a 28-day February the same twelfth as a 31-day January", () => {
    // The denominator is the slice's own length, which is the whole reason month
    // lengths need no special case. Two months ⇒ two twelfths ⇒ 4.33 → 4.5.
    expect(accrued(POLICY, FULL_TIME, "2026-02-28")).toBe(4.5);
  });

  it("treats 29 February as a full month, not a 29/28 overrun", () => {
    // 2028 is a leap year. Two months of a leap year is still exactly two
    // twelfths — the extra day is one twenty-ninth of February, not a bonus.
    const leap = { fte: 1.0, startDate: "2028-01-01", endDate: null };
    expect(accrued(POLICY, leap, "2028-02-29")).toBe(4.5);
    expect(accrued(POLICY, leap, "2028-12-31")).toBe(26);
  });

  it("accrues on 29 February itself without the day vanishing", () => {
    const leap = { fte: 1.0, startDate: "2028-02-29", endDate: "2028-02-29" };
    // One day of a 29-day February: 26/12 × 1/29 = 0.075 → rounds to 0. The point
    // is that it computes a number rather than dividing by a February that the
    // implementation thought had 28 days.
    expect(accrued(POLICY, leap, "2028-02-29")).toBe(0);
    expect(accruedTo(POLICY, leap, yearOf(POLICY, "2028-02-29"), "2028-02-29")).not.toBeNaN();
  });

  it("never exceeds the entitlement, whatever asOf says", () => {
    expect(accrued(POLICY, FULL_TIME, "2026-12-31")).toBe(26);
    // An asOf past the leave year is clamped by the year's own end date.
    expect(accruedTo(POLICY, FULL_TIME, yearOf(POLICY, "2026-06-01"), "2027-06-01")).toBe(26);
  });

  it("is monotonic in asOf — the guard on a request depends on it", () => {
    // A booking is checked against the balance on its LAST day. An accrual that
    // could go backwards would let a request pass its check and then fail it.
    let previous = -1;
    for (let day = 1; day <= 365; day += 7) {
      const asOf = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      const value = accrued(POLICY, FULL_TIME, asOf);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("pro-rates a mid-year joiner from their start date", () => {
    // Starting 1 July, half the year ⇒ half the allowance by 31 December.
    const joiner = { fte: 1.0, startDate: "2026-07-01", endDate: null };
    expect(accrued(POLICY, joiner, "2026-12-31")).toBe(13);
    expect(accrued(POLICY, joiner, "2026-06-30")).toBe(0);
  });

  it("stops accruing at the end date", () => {
    const leaver = { fte: 1.0, startDate: "2026-01-01", endDate: "2026-03-31" };
    expect(accrued(POLICY, leaver, "2026-03-31")).toBe(6.5); // three twelfths
    // Still 6.5 in December: the end date, not asOf, is what stopped it.
    expect(accrued(POLICY, leaver, "2026-12-31")).toBe(6.5);
  });

  it("accrues nothing before the start date and nothing after the end date", () => {
    const seasonal = { fte: 1.0, startDate: "2026-06-01", endDate: "2026-08-31" };
    expect(accrued(POLICY, seasonal, "2026-05-31")).toBe(0);
    expect(accrued(POLICY, seasonal, "2026-08-31")).toBe(accrued(POLICY, seasonal, "2026-12-31"));
  });

  it("halves the accrual for a half-time contract", () => {
    expect(accrued(POLICY, { fte: 0.5, startDate: "2026-01-01" }, "2026-12-31")).toBe(13);
    expect(accrued(POLICY, { fte: 0.5, startDate: "2026-01-01" }, "2026-06-30")).toBe(6.5);
  });

  it("earns a month day by day, not in one jump at the month end", () => {
    // Mid-January is worth about half of January's twelfth. A step function here
    // would make a mid-month joiner's first month either free or worthless.
    const midMonth = accrued(POLICY, FULL_TIME, "2026-01-15");
    expect(midMonth).toBeGreaterThan(0);
    expect(midMonth).toBeLessThan(accrued(POLICY, FULL_TIME, "2026-01-31"));
  });
});

describe("upfront accrual", () => {
  const upfront = { ...POLICY, accrualMode: "upfront" };

  it("grants the whole allowance on day one of the leave year", () => {
    expect(accrued(upfront, FULL_TIME, "2026-01-01")).toBe(26);
  });

  it("grants nothing before the person starts, then everything", () => {
    const joiner = { fte: 1.0, startDate: "2026-07-01", endDate: null };
    expect(accrued(upfront, joiner, "2026-06-30")).toBe(0);
    // Not pro-rated: front-loading is the entire point of the mode, and
    // pro-rating it would make it monthly accrual under another name.
    expect(accrued(upfront, joiner, "2026-07-01")).toBe(26);
  });

  it("is still pro-rata to FTE", () => {
    expect(accrued(upfront, { fte: 0.5, startDate: "2026-01-01" }, "2026-01-01")).toBe(13);
  });
});

describe("working days — what a holiday actually costs", () => {
  it("counts Monday to Friday as five days", () => {
    expect(workingDaysFor(POLICY, { from: "2026-10-05", to: "2026-10-09" }).workingDays).toBe(5);
  });

  it("does not charge for the weekend in the middle of a fortnight", () => {
    expect(workingDaysFor(POLICY, { from: "2026-10-05", to: "2026-10-16" }).workingDays).toBe(10);
  });

  it("does not charge for a public holiday", () => {
    // 27 April to 1 May is five weekdays, but 1 May is a listed holiday.
    expect(workingDaysFor(POLICY, { from: "2026-04-27", to: "2026-05-01" }).workingDays).toBe(4);
  });

  it("costs nothing over a pure weekend, which the service refuses as a request", () => {
    expect(workingDaysFor(POLICY, { from: "2026-10-10", to: "2026-10-11" }).workingDays).toBe(0);
  });

  it.each([
    [{ halfDayStart: true }, 4.5],
    [{ halfDayEnd: true }, 4.5],
    [{ halfDayStart: true, halfDayEnd: true }, 4],
  ])("applies half days: %o ⇒ %s", (flags, expected) => {
    expect(workingDaysFor(POLICY, { from: "2026-10-05", to: "2026-10-09", ...flags }).workingDays).toBe(expected);
  });

  it("makes a one-day request with BOTH flags half a day, never zero", () => {
    // Somebody ticking both boxes on a one-day form means "half a day off".
    // Returning 0 would book a holiday that costs nothing and shows as nothing.
    expect(workingDaysFor(POLICY, { from: "2026-10-05", to: "2026-10-05", halfDayStart: true, halfDayEnd: true }).workingDays).toBe(0.5);
    expect(workingDaysFor(POLICY, { from: "2026-10-05", to: "2026-10-05", halfDayStart: true }).workingDays).toBe(0.5);
  });

  it("takes the half day off the first WORKING day, not off `from`", () => {
    // Saturday to Tuesday with a half-day start: the half comes off Monday,
    // because a half-day on a day you were not working is not a thing.
    const saturdayStart = workingDaysFor(POLICY, { from: "2026-10-03", to: "2026-10-06", halfDayStart: true });
    expect(saturdayStart.days[0]).toBe("2026-10-05");
    expect(saturdayStart.workingDays).toBe(1.5);
  });

  it("always lands on a half-day multiple", () => {
    for (const to of datesInRange("2026-10-05", "2026-10-30")) {
      const { workingDays } = workingDaysFor(POLICY, { from: "2026-10-05", to, halfDayStart: true, halfDayEnd: true });
      expect(Math.round(workingDays * 2)).toBe(workingDays * 2);
    }
  });

  it("knows a weekend from a working day", () => {
    expect(isWeekend("2026-10-03")).toBe(true); // Saturday
    expect(isWeekend("2026-10-04")).toBe(true); // Sunday
    expect(isWeekend("2026-10-05")).toBe(false);
    expect(isWorkingDay(POLICY, "2026-05-01")).toBe(false); // public holiday
  });
});

describe("blackout windows", () => {
  it("catches a chargeable day inside the window and names it", () => {
    const { days } = workingDaysFor(POLICY, { from: "2026-08-14", to: "2026-08-18" });
    const hit = blackoutHit(POLICY, days);
    expect(hit.window.reason).toBe("Harvest");
    expect(hit.date).toBe("2026-08-17"); // the 15th and 16th are the weekend
  });

  it("ignores an overlap that is only a weekend", () => {
    // A harvest blackout must not refuse a request whose sole overlap with it is
    // a Sunday nobody was going to work anyway.
    const august = { ...POLICY, blackoutWindows: [{ from: "2026-08-15", to: "2026-08-16", reason: "Harvest" }] };
    const { days } = workingDaysFor(august, { from: "2026-08-13", to: "2026-08-16" });
    expect(blackoutHit(august, days)).toBeNull();
  });

  it("returns null when there are no windows at all", () => {
    expect(blackoutHit({ ...POLICY, blackoutWindows: [] }, ["2026-08-17"])).toBeNull();
    expect(blackoutHit({}, ["2026-08-17"])).toBeNull();
  });

  it("treats ranges that merely touch as overlapping, because days are inclusive", () => {
    expect(rangesOverlap({ from: "2026-10-05", to: "2026-10-09" }, { from: "2026-10-09", to: "2026-10-12" })).toBe(true);
    expect(rangesOverlap({ from: "2026-10-05", to: "2026-10-09" }, { from: "2026-10-10", to: "2026-10-12" })).toBe(false);
  });
});

describe("carry-over expiry dates", () => {
  it("places a 03-31 expiry inside a calendar leave year", () => {
    expect(carryOverExpiryDate(POLICY, 2026)).toBe("2026-03-31");
  });

  it("places a 03-31 expiry in the FOLLOWING calendar year for an April leave year", () => {
    // The 2026 leave year runs Apr 2026 → Apr 2027, so its March deadline is in
    // 2027. Anchoring it to the leave year's own number would put the deadline
    // before the year began.
    const april = { ...POLICY, leaveYearStart: "04-06" };
    expect(carryOverExpiryDate(april, 2026)).toBe("2027-03-31");
  });

  it("is null when the policy sets no expiry", () => {
    expect(carryOverExpiryDate({ ...POLICY, carryOverExpiresOn: null }, 2026)).toBeNull();
  });
});

describe("computeBalance", () => {
  const request = (overrides) => ({
    staffId: 3,
    type: "annual",
    from: "2026-06-01",
    to: "2026-06-05",
    workingDays: 5,
    status: "approved",
    ...overrides,
  });

  const balance = (options) => computeBalance({ policy: POLICY, profile: FULL_TIME, requests: [], adjustments: [], ...options });

  it("satisfies the §8.3 invariant by construction", () => {
    const result = balance({
      asOf: "2026-07-30",
      requests: [request(), request({ from: "2026-11-02", to: "2026-11-06", status: "requested" })],
      adjustments: [{ staffId: 3, leaveYear: 2026, days: 2, kind: "carry_over_grant" }],
    });
    expect(result.remaining).toBe(roundDays(result.accrued + result.carriedOver - result.taken - result.booked));
  });

  it("counts a finished holiday as taken and a future one as booked", () => {
    const result = balance({ asOf: "2026-07-30", requests: [request(), request({ from: "2026-11-02", to: "2026-11-06" })] });
    expect(result.taken).toBe(5);
    expect(result.booked).toBe(5);
  });

  it("counts a holiday IN PROGRESS as booked, because a request is counted where it ends", () => {
    const result = balance({ asOf: "2026-06-03", requests: [request()] });
    expect(result.taken).toBe(0);
    expect(result.booked).toBe(5);
  });

  it("counts a pending request against the balance", () => {
    // Otherwise the same days could be booked twice while a decision is pending.
    const result = balance({ asOf: "2026-07-30", requests: [request({ status: "requested" })] });
    expect(result.booked).toBe(5);
  });

  it("ignores rejected, cancelled and withdrawn requests", () => {
    for (const status of ["rejected", "cancelled", "withdrawn"]) {
      const result = balance({ asOf: "2026-07-30", requests: [request({ status })] });
      expect(result.taken + result.booked).toBe(0);
    }
  });

  it("does not deduct sick leave from the annual balance (§17 Q4)", () => {
    const result = balance({ asOf: "2026-07-30", requests: [request({ type: "sick" })] });
    expect(result.taken).toBe(0);
    expect(result.booked).toBe(0);
    // But it IS counted, in its own bucket — the decision is pinned, not lost.
    expect(result.byType.find((row) => row.type === "sick").taken).toBe(5);
  });

  it("reports a bucket for every leave type, so a new type cannot go unreported", () => {
    expect(balance({ asOf: "2026-07-30" }).byType.map((row) => row.type)).toEqual(LEAVE_TYPES);
  });

  it("only counts requests belonging to the leave year being asked about", () => {
    const result = balance({ asOf: "2026-07-30", requests: [request({ from: "2025-06-01", to: "2025-06-05" })] });
    expect(result.taken).toBe(0);
  });

  it("folds a manual adjustment into accrued", () => {
    const withAdjustment = balance({
      asOf: "2026-07-30",
      adjustments: [{ staffId: 3, leaveYear: 2026, days: -2, kind: "manual", reason: "over-credited" }],
    });
    expect(withAdjustment.accrued).toBe(balance({ asOf: "2026-07-30" }).accrued - 2);
  });

  it("caps carry-over at the policy cap, across grants", () => {
    const result = balance({
      asOf: "2026-02-01",
      adjustments: [
        { staffId: 3, leaveYear: 2026, days: 4, kind: "carry_over_grant" },
        { staffId: 3, leaveYear: 2026, days: 4, kind: "carry_over_grant" },
      ],
    });
    expect(result.carriedOver).toBe(5); // the cap, not 8
  });

  describe("carry-over expiring at midnight", () => {
    const carried = [{ staffId: 3, leaveYear: 2026, days: 4, kind: "carry_over_grant" }];

    it("counts the whole grant ON the expiry date", () => {
      const result = balance({ asOf: "2026-03-31", adjustments: carried });
      expect(result.carriedOver).toBe(4);
      expect(result.expiringSoon).toBe(4);
    });

    it("has dropped the unused part by the very next day", () => {
      // The midnight boundary the PRD asks for: 31 March still has the days,
      // 1 April does not.
      const result = balance({ asOf: "2026-04-01", adjustments: carried });
      expect(result.carriedOver).toBe(0);
      expect(result.expiringSoon).toBe(0);
    });

    it("keeps the part that was actually spent before the deadline", () => {
      // Carry-over is spent first, because it is the money that expires. Three
      // days taken in February survive the deadline as three days of credit.
      const spent = [request({ from: "2026-02-02", to: "2026-02-04", workingDays: 3 })];
      const before = balance({ asOf: "2026-03-31", adjustments: carried, requests: spent });
      const after = balance({ asOf: "2026-04-01", adjustments: carried, requests: spent });
      expect(before.carriedOver).toBe(4);
      expect(before.expiringSoon).toBe(1);
      expect(after.carriedOver).toBe(3);
      expect(after.expiringSoon).toBe(0);
    });

    it("never lets the expiry push remaining below zero", () => {
      // The property that makes the design safe: the surviving credit is exactly
      // the part already spent, so expiry can only remove credit that was not
      // financing anything.
      const spent = [request({ from: "2026-02-02", to: "2026-02-04", workingDays: 3 })];
      expect(balance({ asOf: "2026-04-01", adjustments: carried, requests: spent }).remaining).toBeGreaterThanOrEqual(0);
    });

    it("keeps carried-over days all year when the policy sets no expiry", () => {
      const noExpiry = { ...POLICY, carryOverExpiresOn: null };
      const result = computeBalance({ policy: noExpiry, profile: FULL_TIME, requests: [], adjustments: carried, asOf: "2026-12-31" });
      expect(result.carriedOver).toBe(4);
      expect(result.carryOverExpiresOn).toBeNull();
    });
  });

  it("returns zeroes rather than NaN for a member with no employment profile", () => {
    // No contract ⇒ no FTE ⇒ nothing to pro-rate. The service refuses such a
    // request outright; this makes sure a read cannot produce nonsense either.
    const result = balance({ asOf: "2026-07-30", profile: null });
    expect(result.entitlement).toBe(0);
    expect(result.accrued).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it("returns null when the policy has no usable leave-year anchor", () => {
    expect(computeBalance({ policy: { leaveYearStart: "nonsense" }, profile: FULL_TIME, asOf: "2026-07-30" })).toBeNull();
  });
});

describe("per-type rules", () => {
  it("gives every leave type a rule, so a new type cannot slip through unruled", () => {
    for (const type of LEAVE_TYPES) {
      expect(TYPE_RULES[type]).toBeDefined();
    }
  });

  it("makes annual the only type with a budget", () => {
    const consuming = LEAVE_TYPES.filter((type) => TYPE_RULES[type].consumesBalance);
    expect(consuming).toEqual(["annual"]);
  });

  it("exempts sick leave from notice, which is what permits retrospective entry", () => {
    expect(TYPE_RULES.sick.requiresNotice).toBe(false);
    expect(TYPE_RULES.bereavement.requiresNotice).toBe(false);
    // Planned absences keep the rule.
    expect(TYPE_RULES.unpaid.requiresNotice).toBe(true);
    expect(TYPE_RULES.parental.requiresNotice).toBe(true);
  });

  it("applies a harvest blackout only to the types that are planned around it", () => {
    expect(TYPE_RULES.annual.honoursBlackout).toBe(true);
    expect(TYPE_RULES.sick.honoursBlackout).toBe(false);
  });
});

describe("datesInRange", () => {
  it("is inclusive on both ends, because that is how holidays are talked about", () => {
    expect(datesInRange("2026-10-05", "2026-10-09")).toHaveLength(5);
    expect(datesInRange("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
  });

  it("returns nothing for a backwards range rather than spinning", () => {
    expect(datesInRange("2026-10-09", "2026-10-05")).toEqual([]);
  });

  it("crosses a month, a year and a leap day correctly", () => {
    expect(datesInRange("2026-01-31", "2026-02-01")).toEqual(["2026-01-31", "2026-02-01"]);
    expect(datesInRange("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(datesInRange("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("honours its own cap, so a nonsense range cannot run away", () => {
    expect(datesInRange("2026-01-01", "2099-01-01", { limit: 10 })).toHaveLength(10);
  });
});
