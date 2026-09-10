import { describe, it, expect } from "vitest";

// Work pillar — the pure core (PRD §14.1).
//
// Everything here is a function of its arguments, which is what makes the awkward
// cases cheap to pin: a shift handing over at exactly 08:00, a night watch that
// runs past midnight, a week that starts on a Sunday, and a work log whose totals
// must survive arbitrary amendments.
const {
  parseTime,
  formatTime,
  shiftInterval,
  intervalsOverlap,
  shiftHours,
  weekBounds,
  monthBounds,
  withinRange,
} = require("../../services/crew/pillars/work/work-time");
const {
  effectiveEntries,
  rollupOf,
  validateDutyTypeInput,
  validateShiftInput,
  validateWorkLogInput,
  SHIFT_TRANSITIONS,
  SHIFT_STATUSES,
  BLOCKING_STATUSES,
  MAX_HOURS_PER_ENTRY,
} = require("../../services/crew/pillars/work/service");

const interval = (date, from, to) => shiftInterval(date, from, to);

describe("shift time parsing", () => {
  it.each(["00:00", "05:30", "13:45", "23:59"])("accepts %s", (value) => {
    expect(parseTime(value)).toBeTypeOf("number");
  });

  it.each(["24:00", "5:30", "05:60", "0530", "05:30:00", "", "noon", null, 530])("rejects %s", (value) => {
    expect(parseTime(value)).toBeNull();
  });

  it("round-trips through formatTime", () => {
    for (const value of ["00:00", "05:30", "13:45", "23:59"]) {
      expect(formatTime(parseTime(value))).toBe(value);
    }
  });
});

describe("shift intervals", () => {
  it("resolves an ordinary daytime shift", () => {
    const result = interval("2026-08-03", "05:00", "08:00");
    expect(result.crossesMidnight).toBe(false);
    expect(shiftHours(result)).toBe(3);
  });

  it("treats an end time BEFORE the start time as crossing midnight", () => {
    // night_watch 22:00 → 06:00 is a real duty, not a typo. Without this it would
    // be a negative-length shift that overlaps nothing.
    const result = interval("2026-08-03", "22:00", "06:00");
    expect(result.crossesMidnight).toBe(true);
    expect(shiftHours(result)).toBe(8);
  });

  it("treats equal start and end times as a full 24 hours, not a zero-length shift", () => {
    const result = interval("2026-08-03", "06:00", "06:00");
    expect(result.crossesMidnight).toBe(true);
    expect(shiftHours(result)).toBe(24);
  });

  it("returns null for an unusable date or time", () => {
    expect(interval("2026-8-3", "05:00", "08:00")).toBeNull();
    expect(interval("2026-08-03", "5:00", "08:00")).toBeNull();
    expect(interval("2026-02-30", "05:00", "08:00")).not.toBeNull(); // date parsing is lenient here…
    expect(interval("nonsense", "05:00", "08:00")).toBeNull(); // …but nonsense is not
  });
});

describe("overlap detection — the boundaries that matter", () => {
  it("does NOT treat a handover as an overlap", () => {
    // The case the PRD calls out: shifts meeting exactly at an hour. Half-open
    // intervals make 05:00–08:00 and 08:00–11:00 adjacent, not clashing. Getting
    // this wrong would refuse the most ordinary roster there is.
    const morning = interval("2026-08-03", "05:00", "08:00");
    const midday = interval("2026-08-03", "08:00", "11:00");
    expect(intervalsOverlap(morning, midday)).toBe(false);
    expect(intervalsOverlap(midday, morning)).toBe(false);
  });

  it("catches a one-minute intrusion", () => {
    const morning = interval("2026-08-03", "05:00", "08:00");
    const overlapping = interval("2026-08-03", "07:59", "11:00");
    expect(intervalsOverlap(morning, overlapping)).toBe(true);
  });

  it("catches full containment in both directions", () => {
    const longDay = interval("2026-08-03", "07:00", "19:00");
    const inside = interval("2026-08-03", "09:00", "12:00");
    expect(intervalsOverlap(longDay, inside)).toBe(true);
    expect(intervalsOverlap(inside, longDay)).toBe(true);
  });

  it("catches a night watch clashing with the NEXT morning's shift", () => {
    // 22:00→06:00 on the 3rd runs into the 4th, so an 05:00 start on the 4th is a
    // real clash. A same-date-only comparison would miss it entirely.
    const nightWatch = interval("2026-08-03", "22:00", "06:00");
    const nextMorning = interval("2026-08-04", "05:00", "08:00");
    expect(intervalsOverlap(nightWatch, nextMorning)).toBe(true);
  });

  it("lets a night watch sit next to the morning it hands over to", () => {
    const nightWatch = interval("2026-08-03", "22:00", "06:00");
    const handover = interval("2026-08-04", "06:00", "09:00");
    expect(intervalsOverlap(nightWatch, handover)).toBe(false);
  });

  it("does not treat the same duty on different days as an overlap", () => {
    const monday = interval("2026-08-03", "05:00", "08:00");
    const tuesday = interval("2026-08-04", "05:00", "08:00");
    expect(intervalsOverlap(monday, tuesday)).toBe(false);
  });

  it("is false when either interval is missing", () => {
    expect(intervalsOverlap(null, interval("2026-08-03", "05:00", "08:00"))).toBe(false);
    expect(intervalsOverlap(interval("2026-08-03", "05:00", "08:00"), null)).toBe(false);
  });
});

describe("week and month bounds", () => {
  it("uses Monday-based weeks", () => {
    // 2026-07-29 is a Wednesday.
    expect(weekBounds("2026-07-29")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("puts SUNDAY in the week that began the previous Monday", () => {
    // The off-by-one that only shows up in the weekend column: JS treats Sunday as
    // day 0, which would push it into the following week.
    expect(weekBounds("2026-08-02")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("keeps Monday itself as the start of its own week", () => {
    expect(weekBounds("2026-07-27")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("spans a month boundary without drifting", () => {
    expect(weekBounds("2026-01-01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });

  it("bounds months, including February in a leap and a non-leap year", () => {
    expect(monthBounds("2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2024-02-15")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthBounds("2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("returns null rather than guessing at a malformed date", () => {
    expect(weekBounds("2026-7-29")).toBeNull();
    expect(monthBounds("nope")).toBeNull();
  });

  it("treats ranges as inclusive at both ends", () => {
    expect(withinRange("2026-08-03", "2026-08-03", "2026-08-09")).toBe(true);
    expect(withinRange("2026-08-09", "2026-08-03", "2026-08-09")).toBe(true);
    expect(withinRange("2026-08-02", "2026-08-03", "2026-08-09")).toBe(false);
    expect(withinRange("2026-08-10", "2026-08-03", "2026-08-09")).toBe(false);
    // An open-ended range means "no bound on that side".
    expect(withinRange("2030-01-01", "2026-08-03", null)).toBe(true);
  });
});

describe("the shift lifecycle", () => {
  it("declares every status and no transition out of a terminal one", () => {
    expect(SHIFT_STATUSES).toEqual(["PLANNED", "CONFIRMED", "COMPLETED", "CANCELLED"]);
    expect(SHIFT_TRANSITIONS.COMPLETED).toEqual([]);
    expect(SHIFT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("allows exactly the documented moves", () => {
    expect(SHIFT_TRANSITIONS.PLANNED).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(SHIFT_TRANSITIONS.CONFIRMED).toEqual(["COMPLETED", "CANCELLED"]);
  });

  it("refuses to skip confirmation", () => {
    // planned → completed would let a shift be marked done without anyone
    // committing to it first.
    expect(SHIFT_TRANSITIONS.PLANNED).not.toContain("COMPLETED");
  });

  it("has no transition to a status that does not exist", () => {
    for (const [from, targets] of Object.entries(SHIFT_TRANSITIONS)) {
      expect(SHIFT_STATUSES, `${from} is not a known status`).toContain(from);
      for (const to of targets) expect(SHIFT_STATUSES, `${from} → ${to}`).toContain(to);
    }
  });

  it("frees the slot when a shift is cancelled", () => {
    // A cancelled shift must not block a replacement — that is the whole point of
    // cancelling one.
    expect(BLOCKING_STATUSES).toEqual(["PLANNED", "CONFIRMED", "COMPLETED"]);
    expect(BLOCKING_STATUSES).not.toContain("CANCELLED");
  });
});

describe("the append-only work log", () => {
  const entry = (id, overrides = {}) => ({
    id,
    staffId: 3,
    date: "2026-08-03",
    hours: 3,
    activity: "milking",
    amendsId: null,
    ...overrides,
  });

  it("counts a fresh entry", () => {
    expect(effectiveEntries([entry(1)]).map((row) => row.id)).toEqual([1]);
  });

  it("supersedes an amended entry with its correction", () => {
    const rows = [entry(1, { hours: 3 }), entry(2, { hours: 2.5, amendsId: 1 })];
    expect(effectiveEntries(rows).map((row) => row.id)).toEqual([2]);
    expect(rollupOf(rows).hours).toBe(2.5);
  });

  it("follows a chain of amendments to its end", () => {
    // Amend the amendment: only the last row counts, and the originals survive in
    // the store for audit.
    const rows = [entry(1, { hours: 3 }), entry(2, { hours: 2.5, amendsId: 1 }), entry(3, { hours: 2, amendsId: 2 })];
    expect(effectiveEntries(rows).map((row) => row.id)).toEqual([3]);
    expect(rollupOf(rows).hours).toBe(2);
    // Nothing was deleted — the history is all still there.
    expect(rows).toHaveLength(3);
  });

  it("keeps two separate entries on the same day separate", () => {
    // The bug a naive "newest row per date wins" would introduce.
    const rows = [entry(1, { hours: 3, activity: "milking" }), entry(2, { hours: 2, activity: "feeding" })];
    expect(rollupOf(rows).hours).toBe(5);
    expect(rollupOf(rows).entries).toBe(2);
  });

  it("amends one entry without disturbing its neighbour", () => {
    const rows = [
      entry(1, { hours: 3, activity: "milking" }),
      entry(2, { hours: 2, activity: "feeding" }),
      entry(3, { hours: 1, activity: "milking", amendsId: 1 }),
    ];
    expect(rollupOf(rows).hours).toBe(3); // 1 (amended) + 2 (untouched)
    expect(
      effectiveEntries(rows)
        .map((row) => row.id)
        .sort(),
    ).toEqual([2, 3]);
  });

  it("groups by activity and sorts predictably", () => {
    const rows = [
      entry(1, { hours: 3, activity: "milking" }),
      entry(2, { hours: 2, activity: "feeding" }),
      entry(3, { hours: 1.5, activity: "milking" }),
    ];
    expect(rollupOf(rows).byActivity).toEqual([
      { activity: "feeding", hours: 2 },
      { activity: "milking", hours: 4.5 },
    ]);
  });

  it("respects the range, counting the boundary days in", () => {
    const rows = [
      entry(1, { date: "2026-08-02", hours: 1 }),
      entry(2, { date: "2026-08-03", hours: 2 }),
      entry(3, { date: "2026-08-09", hours: 3 }),
      entry(4, { date: "2026-08-10", hours: 4 }),
    ];
    expect(rollupOf(rows, { from: "2026-08-03", to: "2026-08-09" }).hours).toBe(5);
  });

  it("keeps quarter-hour sums clean instead of leaking float noise", () => {
    // 0.25 × 29 would otherwise surface as 7.249999999999999 in a UI.
    const rows = Array.from({ length: 29 }, (_, index) => entry(index + 1, { hours: 0.25 }));
    expect(rollupOf(rows).hours).toBe(7.25);
  });

  it("is zero for an empty log rather than undefined", () => {
    expect(rollupOf([])).toMatchObject({ hours: 0, entries: 0, byActivity: [] });
  });
});

describe("work input validation", () => {
  const fields = (validate, input) => validate(input).map((error) => error.field);

  describe("duty types", () => {
    const valid = { code: "milking_early", name: "Early milking", startTime: "05:00", endTime: "08:00" };

    it("accepts a sane duty type", () => {
      expect(fields(validateDutyTypeInput, valid)).toEqual([]);
    });

    it("requires a lower_snake_case code", () => {
      expect(fields(validateDutyTypeInput, { ...valid, code: "Milking Early" })).toContain("code");
      expect(fields(validateDutyTypeInput, { ...valid, code: "1milking" })).toContain("code");
      expect(fields(validateDutyTypeInput, { ...valid, code: "m" })).toContain("code");
      expect(fields(validateDutyTypeInput, { ...valid, code: "night_watch_2" })).toEqual([]);
    });

    it("requires 24-hour times", () => {
      expect(fields(validateDutyTypeInput, { ...valid, startTime: "5am" })).toContain("startTime");
      expect(fields(validateDutyTypeInput, { ...valid, endTime: "24:00" })).toContain("endTime");
    });

    it("accepts a midnight-crossing window — it is not a validation error", () => {
      expect(fields(validateDutyTypeInput, { ...valid, startTime: "22:00", endTime: "06:00" })).toEqual([]);
    });

    it("checks the colour is a hex value when given", () => {
      expect(fields(validateDutyTypeInput, { ...valid, colour: "green" })).toContain("colour");
      expect(fields(validateDutyTypeInput, { ...valid, colour: "#22c55e" })).toEqual([]);
      expect(fields(validateDutyTypeInput, { ...valid, colour: null })).toEqual([]); // optional
    });
  });

  describe("shifts", () => {
    it("requires a member, a duty type and a date", () => {
      expect(fields(validateShiftInput, {}).sort()).toEqual(["date", "dutyTypeId", "staffId"]);
      expect(fields(validateShiftInput, { staffId: 3, dutyTypeId: 1, date: "2026-08-03" })).toEqual([]);
    });
  });

  describe("work log", () => {
    const valid = { staffId: 3, date: "2026-08-03", hours: 3, activity: "milking" };

    it("accepts a sane entry", () => {
      expect(fields(validateWorkLogInput, valid)).toEqual([]);
    });

    it("requires hours above zero", () => {
      expect(fields(validateWorkLogInput, { ...valid, hours: 0 })).toContain("hours");
      expect(fields(validateWorkLogInput, { ...valid, hours: -1 })).toContain("hours");
      expect(fields(validateWorkLogInput, { ...valid, hours: 0.25 })).toEqual([]);
    });

    it("caps a single entry at a day", () => {
      expect(fields(validateWorkLogInput, { ...valid, hours: MAX_HOURS_PER_ENTRY })).toEqual([]);
      expect(fields(validateWorkLogInput, { ...valid, hours: MAX_HOURS_PER_ENTRY + 0.25 })).toContain("hours");
    });

    it("insists on quarter-hour granularity", () => {
      // Arbitrary fractions make two rollups of the same week disagree in the tail.
      expect(fields(validateWorkLogInput, { ...valid, hours: 3.1 })).toContain("hours");
      expect(fields(validateWorkLogInput, { ...valid, hours: 3.75 })).toEqual([]);
    });

    it("requires an activity", () => {
      expect(fields(validateWorkLogInput, { ...valid, activity: "  " })).toContain("activity");
      expect(fields(validateWorkLogInput, { ...valid, activity: "x".repeat(61) })).toContain("activity");
    });
  });
});
