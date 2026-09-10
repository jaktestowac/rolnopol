import { describe, it, expect } from "vitest";

// The work pillar's transport boundary (services/crew/pillars/work/resolvers.js).
//
// The pillar's stated design is that every outcome a caller can act on is a union
// member rather than a thrown error — an overlap, a leave conflict and an illegal
// transition are answers. This file checks that the outcome tables actually spell
// all of them, that they spell nothing the SDL does not declare, and that the two
// resolvers doing real work (`DutyType.crossesMidnight` and `WorkLogEntry.effective`)
// agree with the arithmetic and the append-only log they are derived from.
const { resolvers, planShiftOutcome, transitionOutcome, toUnionMember } = require("../../services/crew/pillars/work/resolvers");
const { CrewError, CREW_ERROR_CODES } = require("../../services/crew/errors");
const { SHIFT_STATUSES } = require("../../services/crew/pillars/work/service");
const { unionMembers } = require("../helpers/crew-sdl");

const workUnion = (name) => unionMembers("work", name);
const crewError = (code, extensions = {}, message = "nope") => new CrewError(code, message, extensions);

describe("work resolvers — toUnionMember", () => {
  it("maps VALIDATION_FAILED onto WorkValidationFailed", () => {
    const fieldErrors = [{ field: "date", message: "required" }];

    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED, { fieldErrors }))).toEqual({
      __typename: "WorkValidationFailed",
      fieldErrors,
    });
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED)).fieldErrors).toEqual([]);
  });

  it("maps VERSION_CONFLICT onto VersionConflict with a stringified staffId", () => {
    const error = crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 6, expectedVersion: 3, actualVersion: 5 });

    expect(toUnionMember(error)).toEqual({
      __typename: "VersionConflict",
      staffId: "6",
      expectedVersion: 3,
      actualVersion: 5,
    });
  });

  it("rethrows every code it does not map, MEMBER_NOT_FOUND included", () => {
    const mapped = [CREW_ERROR_CODES.VALIDATION_FAILED, CREW_ERROR_CODES.VERSION_CONFLICT];

    for (const code of Object.values(CREW_ERROR_CODES).filter((value) => !mapped.includes(value))) {
      expect(() => toUnionMember(crewError(code))).toThrow(CrewError);
    }
  });

  it("rethrows anything that is not a CrewError", () => {
    const boom = new Error("store unavailable");
    expect(() => toUnionMember(boom)).toThrow(boom);
  });
});

describe("work resolvers — planShiftOutcome", () => {
  it("maps PLANNED, defaulting warnings to an empty list", () => {
    const shift = { id: 1 };

    expect(planShiftOutcome({ outcome: "PLANNED", shift, warnings: ["long day"] })).toEqual({
      __typename: "ShiftPlanned",
      shift,
      warnings: ["long day"],
    });
    expect(planShiftOutcome({ outcome: "PLANNED", shift }).warnings).toEqual([]);
  });

  it("maps OVERLAP, naming the shift it clashes with", () => {
    expect(planShiftOutcome({ outcome: "OVERLAP", conflictingShiftId: 4 })).toEqual({
      __typename: "ShiftOverlap",
      conflictingShiftId: 4,
    });
  });

  it("maps CONFLICTS_LEAVE — booked leave is an answer, not an error", () => {
    expect(planShiftOutcome({ outcome: "CONFLICTS_LEAVE", staffId: 2, date: "2026-09-01" })).toEqual({
      __typename: "ShiftConflictsLeave",
      staffId: 2,
      date: "2026-09-01",
    });
  });

  it("maps MEMBER_NOT_FOUND as a union member here, because the service returns rather than throws", () => {
    expect(planShiftOutcome({ outcome: "MEMBER_NOT_FOUND", staffId: 9 })).toEqual({
      __typename: "MemberNotFound",
      staffId: 9,
    });
  });

  it("maps DUTY_TYPE_NOT_FOUND", () => {
    expect(planShiftOutcome({ outcome: "DUTY_TYPE_NOT_FOUND", dutyTypeId: 3 })).toEqual({
      __typename: "DutyTypeNotFound",
      dutyTypeId: 3,
    });
  });

  it("falls through to WorkValidationFailed", () => {
    expect(planShiftOutcome({ outcome: "ANYTHING", fieldErrors: [{ field: "x" }] })).toEqual({
      __typename: "WorkValidationFailed",
      fieldErrors: [{ field: "x" }],
    });
    expect(planShiftOutcome({ outcome: "ANYTHING" }).fieldErrors).toEqual([]);
  });

  it("reaches every member PlanShiftResult declares, and no other", () => {
    const produced = ["PLANNED", "OVERLAP", "CONFLICTS_LEAVE", "MEMBER_NOT_FOUND", "DUTY_TYPE_NOT_FOUND", "SOMETHING_ELSE"].map(
      (outcome) => planShiftOutcome({ outcome }).__typename,
    );

    expect(new Set(produced)).toEqual(new Set(workUnion("PlanShiftResult")));
  });
});

describe("work resolvers — transitionOutcome", () => {
  it("maps TRANSITIONED onto ShiftTransitioned", () => {
    const shift = { id: 2, status: "CONFIRMED" };

    expect(transitionOutcome({ outcome: "TRANSITIONED", shift })).toEqual({ __typename: "ShiftTransitioned", shift });
  });

  it("maps SHIFT_NOT_FOUND", () => {
    expect(transitionOutcome({ outcome: "SHIFT_NOT_FOUND", shiftId: 7 })).toEqual({
      __typename: "ShiftNotFound",
      shiftId: 7,
    });
  });

  it("falls through to IllegalShiftTransition, passing the states through unchanged", () => {
    // Shift statuses are already SCREAMING_CASE in the store, so this pillar has no
    // enum translation — a translation here would double-uppercase and hide drift.
    expect(transitionOutcome({ outcome: "ILLEGAL", shiftId: 7, from: "COMPLETED", to: "PLANNED", allowed: ["CANCELLED"] })).toEqual({
      __typename: "IllegalShiftTransition",
      shiftId: 7,
      from: "COMPLETED",
      to: "PLANNED",
      allowed: ["CANCELLED"],
    });
  });

  it("reaches every member ShiftTransitionResult declares", () => {
    const declared = new Set(workUnion("ShiftTransitionResult"));
    const produced = [
      transitionOutcome({ outcome: "TRANSITIONED" }).__typename,
      transitionOutcome({ outcome: "SHIFT_NOT_FOUND" }).__typename,
      transitionOutcome({ outcome: "ELSE" }).__typename,
      toUnionMember(crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 1 })).__typename,
    ];

    expect(new Set(produced)).toEqual(declared);
  });

  it("does not declare WorkValidationFailed, so the transition mutations must never mint one", () => {
    // `transitionShift` throws VALIDATION_FAILED for an unknown target status, and
    // the mutations catch it through `toUnionMember` — which would yield
    // `WorkValidationFailed`, a type this union does NOT declare, and therefore a
    // runtime abstract-type error rather than a tidy union member.
    //
    // Today that path is unreachable because the three target states are literals
    // in the resolver rather than client input. This test is what keeps it
    // unreachable: rename a status in the service and it fails here, at the seam,
    // instead of in production on the first confirmShift.
    expect(workUnion("ShiftTransitionResult")).not.toContain("WorkValidationFailed");
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED)).__typename).toBe("WorkValidationFailed");

    for (const target of ["CONFIRMED", "COMPLETED", "CANCELLED"]) {
      expect(SHIFT_STATUSES).toContain(target);
    }
  });
});

describe("work resolvers — logWork and amendWorkLog outcome tables", () => {
  const contextWith = (work) => ({ services: { work } });

  it("maps every logWork outcome, and only members LogWorkResult declares", async () => {
    const outcomes = [
      { outcome: "LOGGED", entry: { id: 1 } },
      { outcome: "MEMBER_NOT_FOUND", staffId: 3 },
      { outcome: "SHIFT_NOT_FOUND", shiftId: 4 },
      { outcome: "ANYTHING_ELSE" },
    ];

    const produced = [];
    for (const result of outcomes) {
      const context = contextWith({ logWork: async () => result });
      produced.push((await resolvers.Mutation.logWork(null, { input: {} }, context)).__typename);
    }

    expect(produced).toEqual(["WorkLogged", "MemberNotFound", "ShiftNotFound", "WorkValidationFailed"]);
    expect(new Set(produced)).toEqual(new Set(workUnion("LogWorkResult")));
  });

  it("carries the logged entry through unchanged", async () => {
    const entry = { id: 11, hours: 7.5 };
    const context = contextWith({ logWork: async () => ({ outcome: "LOGGED", entry }) });

    expect(await resolvers.Mutation.logWork(null, { input: {} }, context)).toEqual({ __typename: "WorkLogged", entry });
  });

  it("maps every amendWorkLog outcome, and only members AmendWorkLogResult declares", async () => {
    const outcomes = [
      { outcome: "AMENDED", correction: { id: 2 }, original: { id: 1 } },
      { outcome: "ENTRY_NOT_FOUND", entryId: 5 },
      { outcome: "NOPE", fieldErrors: [{ field: "hours" }] },
    ];

    const produced = [];
    for (const result of outcomes) {
      const context = contextWith({ amendWorkLog: async () => result });
      produced.push((await resolvers.Mutation.amendWorkLog(null, { entryId: 1 }, context)).__typename);
    }

    expect(produced).toEqual(["WorkLogAmended", "WorkLogEntryNotFound", "WorkValidationFailed"]);
    expect(new Set(produced)).toEqual(new Set(workUnion("AmendWorkLogResult")));
  });

  it("returns both sides of an amendment, so a caller can show what changed", async () => {
    const correction = { id: 2, amendsId: 1, hours: 8 };
    const original = { id: 1, hours: 6 };
    const context = contextWith({ amendWorkLog: async () => ({ outcome: "AMENDED", correction, original }) });

    expect(await resolvers.Mutation.amendWorkLog(null, { entryId: 1 }, context)).toEqual({
      __typename: "WorkLogAmended",
      correction,
      original,
    });
  });

  it("forwards exactly the five amend arguments the SDL declares", async () => {
    let seen = null;
    const context = contextWith({
      amendWorkLog: async (args) => {
        seen = args;
        return { outcome: "ENTRY_NOT_FOUND", entryId: args.entryId };
      },
    });

    await resolvers.Mutation.amendWorkLog(null, { entryId: "9", hours: 4, activity: "feeding", note: "n", reason: "typo" }, context);
    expect(seen).toEqual({ entryId: "9", hours: 4, activity: "feeding", note: "n", reason: "typo" });
  });
});

describe("work resolvers — DutyType", () => {
  it("computes crossesMidnight from the window rather than reading a stored flag", () => {
    expect(resolvers.DutyType.crossesMidnight({ startTime: "22:00", endTime: "06:00" })).toBe(true);
    expect(resolvers.DutyType.crossesMidnight({ startTime: "05:00", endTime: "08:00" })).toBe(false);
  });

  it("treats an end time equal to the start as a full day, not a zero-length shift", () => {
    expect(resolvers.DutyType.crossesMidnight({ startTime: "06:00", endTime: "06:00" })).toBe(true);
    expect(resolvers.DutyType.hours({ startTime: "06:00", endTime: "06:00" })).toBe(24);
  });

  it("computes hours for an ordinary daytime window", () => {
    expect(resolvers.DutyType.hours({ startTime: "05:00", endTime: "08:00" })).toBe(3);
    expect(resolvers.DutyType.hours({ startTime: "07:00", endTime: "19:00" })).toBe(12);
  });

  it("computes hours across midnight rather than going negative", () => {
    expect(resolvers.DutyType.hours({ startTime: "22:00", endTime: "06:00" })).toBe(8);
  });

  it("reports zero hours for an unparseable window instead of throwing", () => {
    expect(resolvers.DutyType.hours({ startTime: "not-a-time", endTime: "06:00" })).toBe(0);
    expect(resolvers.DutyType.hours({})).toBe(0);
  });

  it("stringifies the id", () => {
    expect(resolvers.DutyType.id({ id: 5 })).toBe("5");
  });
});

describe("work resolvers — Shift and WorkLogEntry id handling", () => {
  it("stringifies required ids and preserves null for optional ones", () => {
    expect(resolvers.Shift.id({ id: 3 })).toBe("3");
    expect(resolvers.Shift.staffId({ staffId: 4 })).toBe("4");
    expect(resolvers.Shift.fieldId({ fieldId: 7 })).toBe("7");
    expect(resolvers.Shift.fieldId({ fieldId: null })).toBeNull();
    expect(resolvers.Shift.fieldId({})).toBeNull();
  });

  it("does not turn a zero id into null — 0 is a value, not an absence", () => {
    expect(resolvers.Shift.fieldId({ fieldId: 0 })).toBe("0");
    expect(resolvers.WorkLogEntry.shiftId({ shiftId: 0 })).toBe("0");
    expect(resolvers.WorkLogEntry.amendsId({ amendsId: 0 })).toBe("0");
  });

  it("preserves null for a log entry's optional links", () => {
    expect(resolvers.WorkLogEntry.shiftId({ shiftId: null })).toBeNull();
    expect(resolvers.WorkLogEntry.amendsId({})).toBeNull();
    expect(resolvers.WorkLogEntry.id({ id: 12 })).toBe("12");
    expect(resolvers.WorkLogEntry.staffId({ staffId: 13 })).toBe("13");
  });
});

describe("work resolvers — WorkLogEntry.effective", () => {
  // The log is append-only: an amendment is a new row pointing at the one it
  // replaces, and `effective` is derived from the whole log so no stored boolean
  // can drift out of agreement with it.
  const logOf = (rows) => ({ services: { work: { listWorkLog: async () => rows } } });

  it("is true for a row nothing has amended", async () => {
    const rows = [{ id: 1, staffId: 5, amendsId: null }];

    await expect(resolvers.WorkLogEntry.effective(rows[0], {}, logOf(rows))).resolves.toBe(true);
  });

  it("is false for a row an amendment replaced", async () => {
    const original = { id: 1, staffId: 5, amendsId: null };
    const rows = [original, { id: 2, staffId: 5, amendsId: 1 }];

    await expect(resolvers.WorkLogEntry.effective(original, {}, logOf(rows))).resolves.toBe(false);
  });

  it("is true for the amendment itself", async () => {
    const correction = { id: 2, staffId: 5, amendsId: 1 };
    const rows = [{ id: 1, staffId: 5, amendsId: null }, correction];

    await expect(resolvers.WorkLogEntry.effective(correction, {}, logOf(rows))).resolves.toBe(true);
  });

  it("follows a chain of amendments — only the last link counts", async () => {
    const first = { id: 1, staffId: 5, amendsId: null };
    const second = { id: 2, staffId: 5, amendsId: 1 };
    const third = { id: 3, staffId: 5, amendsId: 2 };
    const rows = [first, second, third];
    const context = logOf(rows);

    expect(await resolvers.WorkLogEntry.effective(first, {}, context)).toBe(false);
    expect(await resolvers.WorkLogEntry.effective(second, {}, context)).toBe(false);
    expect(await resolvers.WorkLogEntry.effective(third, {}, context)).toBe(true);
  });

  it("compares ids numerically, so a string id from the graph still matches", async () => {
    const original = { id: "1", staffId: 5, amendsId: null };
    const rows = [
      { id: 1, staffId: 5, amendsId: null },
      { id: 2, staffId: 5, amendsId: "1" },
    ];

    await expect(resolvers.WorkLogEntry.effective(original, {}, logOf(rows))).resolves.toBe(false);
  });

  it("asks for the entry's own member's log, not the whole farm's", async () => {
    let seen = null;
    const context = {
      services: {
        work: {
          listWorkLog: async (args) => {
            seen = args;
            return [];
          },
        },
      },
    };

    await resolvers.WorkLogEntry.effective({ id: 1, staffId: 42 }, {}, context);
    expect(seen).toEqual({ staffId: 42 });
  });
});

describe("work resolvers — summary and query plumbing", () => {
  const contextWith = (work) => ({ services: { work } });

  it("passes only the staffId to the work summary, so nothing is computed eagerly", () => {
    expect(resolvers.CrewMember.work({ staffId: 6, profile: { note: "unused" } })).toEqual({ staffId: 6 });
  });

  it("scopes every summary field to the summary's own staffId", async () => {
    const seen = {};
    const context = contextWith({
      listShifts: async (args) => ((seen.shifts = args), []),
      nextShift: async (staffId) => ((seen.nextShift = staffId), null),
      listWorkLog: async (args) => ((seen.workLog = args), []),
      weeklyRollup: async (args) => ((seen.weekly = args), null),
      monthlyRollup: async (args) => ((seen.monthly = args), null),
    });
    const summary = { staffId: 21 };

    await resolvers.WorkSummary.shifts(summary, { from: "2026-01-01", to: "2026-01-31", status: "PLANNED" }, context);
    await resolvers.WorkSummary.nextShift(summary, {}, context);
    await resolvers.WorkSummary.workLog(summary, { from: "2026-01-01", to: "2026-01-31" }, context);
    await resolvers.WorkSummary.weeklyRollup(summary, { weekStarting: "2026-01-05" }, context);
    await resolvers.WorkSummary.monthlyRollup(summary, { month: "2026-01" }, context);

    expect(seen.shifts).toEqual({ from: "2026-01-01", to: "2026-01-31", status: "PLANNED", staffId: 21 });
    expect(seen.nextShift).toBe(21);
    expect(seen.workLog).toEqual({ from: "2026-01-01", to: "2026-01-31", staffId: 21 });
    expect(seen.weekly).toEqual({ weekStarting: "2026-01-05", staffId: 21 });
    expect(seen.monthly).toEqual({ month: "2026-01", staffId: 21 });
  });

  it("forwards the top-level shift filters without inventing a staff scope", async () => {
    let seen = null;
    const context = contextWith({ listShifts: async (args) => ((seen = args), []) });

    await resolvers.Query.shifts(null, { from: "2026-02-01", to: "2026-02-28", status: "CONFIRMED", staffId: "3" }, context);
    expect(seen).toEqual({ from: "2026-02-01", to: "2026-02-28", status: "CONFIRMED", staffId: "3" });
  });
});

describe("work resolvers — union type resolution", () => {
  it("resolves every union by the stamped __typename", () => {
    for (const union of ["DefineDutyTypeResult", "PlanShiftResult", "ShiftTransitionResult", "LogWorkResult", "AmendWorkLogResult"]) {
      expect(resolvers[union].__resolveType({ __typename: "Stamped" })).toBe("Stamped");
    }
  });
});
