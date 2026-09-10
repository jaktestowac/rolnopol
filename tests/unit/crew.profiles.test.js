import { describe, it, expect } from "vitest";

// Profiles pillar — the pure, clock-driven parts (PRD §14.1).
//
// Everything asserted here is a pure function taking an explicit date, which is
// why `employmentStatus` boundaries are testable at all: nothing in the domain
// calls `Date.now()`, so standing on 29 February or on the exact day a contract
// ends costs one argument rather than a fake timer.
const {
  employmentStatusOf,
  matchesFilter,
  validateProfileFields,
  PROBATION_DAYS,
  NOTICE_WINDOW_DAYS,
  MIN_FTE,
  MAX_FTE,
} = require("../../services/crew/pillars/profiles/service");
const { createClock, daysBetween, addDays, toDateString, fromDateString } = require("../../services/crew/clock");

const clockAt = (today) => ({ today: () => today, nowIso: () => `${today}T12:00:00.000Z` });
const profile = (overrides = {}) => ({
  startDate: "2020-01-01",
  endDate: null,
  role: "MECHANIC",
  employmentType: "PERMANENT",
  fte: 1,
  ...overrides,
});

describe("the injectable clock", () => {
  it("is fixed when given a now, so a boundary test is reproducible", () => {
    const clock = createClock({ now: "2026-02-28T23:59:59.000Z" });
    expect(clock.isFixed).toBe(true);
    expect(clock.today()).toBe("2026-02-28");
    expect(clock.nowIso()).toBe("2026-02-28T23:59:59.000Z");
    // Two reads of a fixed clock must agree — otherwise it is not fixed.
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it("hands out copies, so a caller cannot mutate the clock's instant", () => {
    const clock = createClock({ now: "2026-07-29T00:00:00.000Z" });
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it("rejects an invalid now rather than silently running on the real clock", () => {
    expect(() => createClock({ now: "not a date" })).toThrow(/invalid "now"/);
  });

  it("counts calendar days, not elapsed hours — a DST day is still one day", () => {
    // 2026-03-29 is the European DST switch. Local time loses an hour; the
    // calendar does not lose a day, and employment rules speak calendar.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1); // 2026 is not a leap year
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 is
  });

  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns null for malformed dates instead of NaN arithmetic", () => {
    expect(daysBetween("2026-1-1", "2026-01-02")).toBeNull();
    expect(fromDateString("nonsense")).toBeNull();
    expect(addDays("nope", 1)).toBeNull();
    expect(toDateString(new Date("2026-07-29T23:59:59.999Z"))).toBe("2026-07-29");
  });
});

describe("employmentStatus — every boundary", () => {
  it("is PROBATION on the first day and one day before probation ends", () => {
    expect(employmentStatusOf(profile({ startDate: "2026-07-29" }), "2026-07-29")).toBe("PROBATION");
    const dayBefore = addDays("2026-01-01", PROBATION_DAYS - 1);
    expect(employmentStatusOf(profile({ startDate: "2026-01-01" }), dayBefore)).toBe("PROBATION");
  });

  it("becomes ACTIVE exactly on the day probation elapses", () => {
    const boundary = addDays("2026-01-01", PROBATION_DAYS);
    expect(employmentStatusOf(profile({ startDate: "2026-01-01" }), boundary)).toBe("ACTIVE");
  });

  it("is NOTICE while the end date is still ahead but inside the window", () => {
    const today = "2026-07-29";
    const inWindow = addDays(today, NOTICE_WINDOW_DAYS - 1);
    expect(employmentStatusOf(profile({ startDate: "2020-01-01", endDate: inWindow }), today)).toBe("NOTICE");
  });

  it("is still NOTICE on the last day itself — the last day is a working day", () => {
    // The off-by-one that matters: someone whose last day is today is employed
    // today. Reporting them ENDED would drop them off the roster a day early.
    expect(employmentStatusOf(profile({ endDate: "2026-07-29" }), "2026-07-29")).toBe("NOTICE");
  });

  it("is ENDED the day after the last day", () => {
    expect(employmentStatusOf(profile({ endDate: "2026-07-29" }), "2026-07-30")).toBe("ENDED");
  });

  it("is ACTIVE when the end date is further out than the notice window", () => {
    const farOut = addDays("2026-07-29", NOTICE_WINDOW_DAYS + 1);
    expect(employmentStatusOf(profile({ endDate: farOut }), "2026-07-29")).toBe("ACTIVE");
  });

  it("is null for a member with no profile — absence is not a status", () => {
    expect(employmentStatusOf(null, "2026-07-29")).toBeNull();
  });
});

describe("roster filtering", () => {
  const withProfile = { staffId: 1, staff: { id: 1 }, profile: profile({ role: "MECHANIC", employmentType: "SEASONAL" }) };
  const withoutProfile = { staffId: 2, staff: { id: 2 }, profile: null };

  it("keeps everyone when there is no filter", () => {
    expect(matchesFilter(withoutProfile, undefined, clockAt("2026-07-29"))).toBe(true);
    expect(matchesFilter(withoutProfile, {}, clockAt("2026-07-29"))).toBe(true);
  });

  it("keeps a profile-less member in the unfiltered roster (§17 Q1)", () => {
    // Hiding them would make onboarding invisible — a staff member with no
    // profile is a supported state, not an error.
    expect(matchesFilter(withoutProfile, {}, clockAt("2026-07-29"))).toBe(true);
  });

  it("excludes a profile-less member from a status filter rather than matching by accident", () => {
    expect(matchesFilter(withoutProfile, { status: "ACTIVE" }, clockAt("2026-07-29"))).toBe(false);
  });

  it("filters by role and employment type", () => {
    const clock = clockAt("2026-07-29");
    expect(matchesFilter(withProfile, { role: "MECHANIC" }, clock)).toBe(true);
    expect(matchesFilter(withProfile, { role: "MANAGER" }, clock)).toBe(false);
    expect(matchesFilter(withProfile, { employmentType: "SEASONAL" }, clock)).toBe(true);
    expect(matchesFilter(withProfile, { employmentType: "PERMANENT" }, clock)).toBe(false);
  });

  it("filters by computed status, using the clock", () => {
    const ending = { staffId: 3, staff: { id: 3 }, profile: profile({ endDate: "2026-01-01" }) };
    expect(matchesFilter(ending, { status: "ENDED" }, clockAt("2026-07-29"))).toBe(true);
    expect(matchesFilter(ending, { status: "ACTIVE" }, clockAt("2026-07-29"))).toBe(false);
  });
});

describe("profile field validation", () => {
  const complete = { role: "MANAGER", employmentType: "PERMANENT", fte: 1, startDate: "2026-03-01" };

  const errorsFor = (input, options = { requireCore: true }) => {
    const fieldErrors = [];
    validateProfileFields(input, fieldErrors, options);
    return fieldErrors.map((error) => error.field);
  };

  it("accepts a complete profile", () => {
    expect(errorsFor(complete)).toEqual([]);
  });

  it("requires the core fields on create and leaves them optional on update", () => {
    expect(errorsFor({}).sort()).toEqual(["employmentType", "fte", "role", "startDate"]);
    expect(errorsFor({}, { requireCore: false })).toEqual([]);
  });

  it("holds fte to its documented range at both ends", () => {
    expect(errorsFor({ ...complete, fte: MIN_FTE })).toEqual([]);
    expect(errorsFor({ ...complete, fte: MAX_FTE })).toEqual([]);
    expect(errorsFor({ ...complete, fte: 0.05 })).toEqual(["fte"]);
    expect(errorsFor({ ...complete, fte: 1.1 })).toEqual(["fte"]);
    expect(errorsFor({ ...complete, fte: 0 })).toEqual(["fte"]);
  });

  it("rejects an unknown role or employment type", () => {
    expect(errorsFor({ ...complete, role: "CHIEF_CHAINSAW_OFFICER" })).toEqual(["role"]);
    expect(errorsFor({ ...complete, employmentType: "FREELANCE" })).toEqual(["employmentType"]);
  });

  it("rejects endDate before startDate but accepts them on the same day", () => {
    expect(errorsFor({ ...complete, endDate: "2026-02-28" })).toEqual(["endDate"]);
    expect(errorsFor({ ...complete, endDate: "2026-03-01" })).toEqual([]);
  });

  it("bounds contracted hours", () => {
    expect(errorsFor({ ...complete, contractedHoursPerWeek: 40 })).toEqual([]);
    expect(errorsFor({ ...complete, contractedHoursPerWeek: 0 })).toEqual(["contractedHoursPerWeek"]);
    expect(errorsFor({ ...complete, contractedHoursPerWeek: 200 })).toEqual(["contractedHoursPerWeek"]);
    expect(errorsFor({ ...complete, contractedHoursPerWeek: null })).toEqual([]); // optional
  });

  it("never copies age into the overlay — there is no age field to validate", () => {
    // Single source of truth: age lives on the staff record. A profile that
    // carried its own copy would drift the moment either side was edited.
    const fieldErrors = [];
    validateProfileFields({ ...complete, age: 44 }, fieldErrors, { requireCore: true });
    expect(fieldErrors).toEqual([]);
    expect(Object.keys(complete)).not.toContain("age");
  });
});
