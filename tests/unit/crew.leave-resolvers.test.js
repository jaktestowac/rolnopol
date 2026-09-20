import { describe, it, expect } from "vitest";

// The leave pillar's transport boundary (services/crew/pillars/leave/resolvers.js).
//
// Three things are held down here:
//
//   1. the ONE vocabulary translation the pillar owns — store lower_snake_case in,
//      graph SCREAMING_CASE out — happens in exactly one place, so a stored value
//      can never leak out as an invalid enum;
//   2. `toUnionMember` maps precisely three CrewError codes onto union members and
//      rethrows everything else, which is what keeps MEMBER_NOT_FOUND an error
//      rather than a seventh member of RequestLeaveResult;
//   3. every `__typename` the outcome tables can emit is actually a member of the
//      union it is returned from, checked against the SDL rather than a list
//      copied out of it.
const {
  requestLeaveOutcome,
  decisionOutcome,
  toUnionMember,
  toStoreEnum,
  toGraphEnum,
  resolvers,
} = require("../../services/crew/pillars/leave/resolvers");
const { CrewError, CREW_ERROR_CODES } = require("../../services/crew/errors");
const { unionMembers } = require("../helpers/crew-sdl");

const leaveUnion = (name) => unionMembers("leave", name);
const crewError = (code, extensions = {}, message = "nope") => new CrewError(code, message, extensions);

describe("leave resolvers — enum translation", () => {
  it("lowercases a graph enum on the way into the store", () => {
    expect(toStoreEnum("ANNUAL")).toBe("annual");
    expect(toStoreEnum("IN_LIEU")).toBe("in_lieu");
    expect(toStoreEnum("REQUESTED")).toBe("requested");
  });

  it("uppercases a stored value on the way out to the graph", () => {
    expect(toGraphEnum("annual")).toBe("ANNUAL");
    expect(toGraphEnum("in_lieu")).toBe("IN_LIEU");
    expect(toGraphEnum("requested")).toBe("REQUESTED");
  });

  it("passes null and undefined through untouched — an absent filter is not an enum", () => {
    expect(toStoreEnum(null)).toBeNull();
    expect(toStoreEnum(undefined)).toBeUndefined();
    expect(toGraphEnum(null)).toBeNull();
    expect(toGraphEnum(undefined)).toBeUndefined();
  });

  it("passes non-strings through untouched rather than coercing them", () => {
    for (const value of [0, 42, false, true]) {
      expect(toStoreEnum(value)).toBe(value);
      expect(toGraphEnum(value)).toBe(value);
    }
    const list = ["a"];
    expect(toStoreEnum(list)).toBe(list);
  });

  it("round-trips a store value through the graph and back", () => {
    for (const stored of ["annual", "sick", "unpaid", "in_lieu", "requested", "approved", "rejected", "withdrawn"]) {
      expect(toStoreEnum(toGraphEnum(stored))).toBe(stored);
    }
  });

  it("is the translation the field resolvers use — nothing reaches the graph lowercase", () => {
    expect(resolvers.LeaveRequest.type({ type: "annual" })).toBe("ANNUAL");
    expect(resolvers.LeaveRequest.status({ status: "requested" })).toBe("REQUESTED");
    expect(resolvers.LeaveAbsence.type({ type: "sick" })).toBe("SICK");
    expect(resolvers.LeaveAbsence.status({ status: "approved" })).toBe("APPROVED");
    expect(resolvers.LeaveTypeDays.type({ type: "unpaid" })).toBe("UNPAID");
    expect(resolvers.LeavePolicy.accrualMode({ accrualMode: "monthly" })).toBe("MONTHLY");
  });

  it("stringifies ids, so a numeric store id satisfies the graph's ID!", () => {
    expect(resolvers.LeaveRequest.id({ id: 17 })).toBe("17");
    expect(resolvers.LeaveRequest.staffId({ staffId: 4 })).toBe("4");
    expect(resolvers.LeaveAdjustment.id({ id: 3 })).toBe("3");
    expect(resolvers.LeaveAdjustment.staffId({ staffId: 9 })).toBe("9");
  });

  it("defaults the policy's two list fields to empty arrays, never null", () => {
    expect(resolvers.LeavePolicy.publicHolidays({})).toEqual([]);
    expect(resolvers.LeavePolicy.blackoutWindows({})).toEqual([]);
    expect(resolvers.LeavePolicy.publicHolidays({ publicHolidays: ["2026-01-01"] })).toEqual(["2026-01-01"]);
  });
});

describe("leave resolvers — toUnionMember", () => {
  it("maps VALIDATION_FAILED onto LeaveValidationFailed, carrying the field errors", () => {
    const fieldErrors = [{ field: "from", message: "required" }];
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED, { fieldErrors }))).toEqual({
      __typename: "LeaveValidationFailed",
      fieldErrors,
    });
  });

  it("defaults missing field errors to an empty list rather than null", () => {
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED)).fieldErrors).toEqual([]);
  });

  it("maps VERSION_CONFLICT onto VersionConflict with a stringified staffId", () => {
    const error = crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 7, expectedVersion: 2, actualVersion: 3 });

    expect(toUnionMember(error)).toEqual({
      __typename: "VersionConflict",
      staffId: "7",
      expectedVersion: 2,
      actualVersion: 3,
    });
  });

  it("maps LEAVE_POLICY_MISSING onto LeavePolicyMissing, surfacing the message", () => {
    const error = crewError(CREW_ERROR_CODES.LEAVE_POLICY_MISSING, {}, "No leave policy configured.");

    expect(toUnionMember(error)).toEqual({ __typename: "LeavePolicyMissing", message: "No leave policy configured." });
  });

  it("rethrows MEMBER_NOT_FOUND — existence is not disclosed as an outcome", () => {
    const error = crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, { staffId: 99 });

    expect(() => toUnionMember(error)).toThrow(error);
  });

  it("rethrows every other crew error code", () => {
    const unmapped = Object.values(CREW_ERROR_CODES).filter(
      (code) =>
        ![CREW_ERROR_CODES.VALIDATION_FAILED, CREW_ERROR_CODES.VERSION_CONFLICT, CREW_ERROR_CODES.LEAVE_POLICY_MISSING].includes(code),
    );
    expect(unmapped.length).toBeGreaterThan(0);

    for (const code of unmapped) {
      expect(() => toUnionMember(crewError(code))).toThrow(CrewError);
    }
  });

  it("rethrows a plain Error untouched — only our own errors become members", () => {
    const boom = new Error("disk full");
    expect(() => toUnionMember(boom)).toThrow(boom);
  });

  it("rethrows non-Error throwables rather than swallowing them", () => {
    expect(() => toUnionMember("a string")).toThrow();
    expect(() => toUnionMember(null)).toThrow();
  });
});

describe("leave resolvers — requestLeaveOutcome", () => {
  const request = { id: 1, staffId: 2 };
  const balance = { remaining: 12 };

  it("maps BOOKED onto LeaveBooked", () => {
    expect(requestLeaveOutcome({ outcome: "BOOKED", request, balance })).toEqual({
      __typename: "LeaveBooked",
      request,
      balance,
    });
  });

  it("maps BOOKED_WITH_WARNING onto its own member — a success, not a rejection", () => {
    const result = requestLeaveOutcome({ outcome: "BOOKED_WITH_WARNING", request, balance, warnings: ["thin cover"] });

    expect(result).toEqual({
      __typename: "LeaveBookedWithWarning",
      request,
      balance,
      warnings: ["thin cover"],
    });
  });

  it("defaults absent warnings to an empty list", () => {
    expect(requestLeaveOutcome({ outcome: "BOOKED_WITH_WARNING", request, balance }).warnings).toEqual([]);
  });

  it("maps INSUFFICIENT_BALANCE with its four numbers intact", () => {
    expect(requestLeaveOutcome({ outcome: "INSUFFICIENT_BALANCE", requested: 5, remaining: 2, shortfall: 3, asOf: "2026-08-27" })).toEqual({
      __typename: "InsufficientBalance",
      requested: 5,
      remaining: 2,
      shortfall: 3,
      asOf: "2026-08-27",
    });
  });

  it("maps OVERLAPS onto OverlapsExistingLeave, naming the request it clashes with", () => {
    expect(requestLeaveOutcome({ outcome: "OVERLAPS", conflictingRequestId: 8, from: "2026-09-01", to: "2026-09-03" })).toEqual({
      __typename: "OverlapsExistingLeave",
      conflictingRequestId: 8,
      from: "2026-09-01",
      to: "2026-09-03",
    });
  });

  it("maps BLACKOUT onto BlackoutPeriod with the reason and the first clashing day", () => {
    expect(
      requestLeaveOutcome({ outcome: "BLACKOUT", from: "2026-08-15", to: "2026-09-15", reason: "Harvest", firstClash: "2026-08-20" }),
    ).toEqual({
      __typename: "BlackoutPeriod",
      from: "2026-08-15",
      to: "2026-09-15",
      reason: "Harvest",
      firstClash: "2026-08-20",
    });
  });

  it("falls through to InsufficientNotice for the remaining outcome", () => {
    expect(
      requestLeaveOutcome({ outcome: "INSUFFICIENT_NOTICE", minNoticeDays: 3, requestedStart: "2026-08-28", earliestStart: "2026-08-30" }),
    ).toEqual({
      __typename: "InsufficientNotice",
      minNoticeDays: 3,
      requestedStart: "2026-08-28",
      earliestStart: "2026-08-30",
    });
  });

  it("emits only members RequestLeaveResult actually declares, and can reach all six", () => {
    const declared = leaveUnion("RequestLeaveResult");
    expect(declared).toHaveLength(6);

    const produced = [
      { outcome: "BOOKED" },
      { outcome: "BOOKED_WITH_WARNING" },
      { outcome: "INSUFFICIENT_BALANCE" },
      { outcome: "OVERLAPS" },
      { outcome: "BLACKOUT" },
      { outcome: "INSUFFICIENT_NOTICE" },
    ].map((result) => requestLeaveOutcome(result).__typename);

    expect(new Set(produced).size).toBe(6);
    expect([...produced].sort()).toEqual([...declared].sort());
  });
});

describe("leave resolvers — decisionOutcome", () => {
  it("maps DECIDED onto LeaveRequestDecided", () => {
    const request = { id: 4, status: "approved" };
    const balance = { remaining: 9 };

    expect(decisionOutcome({ outcome: "DECIDED", request, balance })).toEqual({
      __typename: "LeaveRequestDecided",
      request,
      balance,
    });
  });

  it("nulls a missing balance rather than leaving it undefined", () => {
    expect(decisionOutcome({ outcome: "DECIDED", request: {} }).balance).toBeNull();
  });

  it("maps REQUEST_NOT_FOUND onto LeaveRequestNotFound", () => {
    expect(decisionOutcome({ outcome: "REQUEST_NOT_FOUND", requestId: 12 })).toEqual({
      __typename: "LeaveRequestNotFound",
      requestId: 12,
    });
  });

  it("translates every enum on an illegal transition, including the allowed list", () => {
    const result = decisionOutcome({
      outcome: "ILLEGAL_TRANSITION",
      requestId: 5,
      from: "approved",
      to: "requested",
      allowed: ["cancelled", "withdrawn"],
    });

    expect(result).toEqual({
      __typename: "IllegalLeaveTransition",
      requestId: 5,
      from: "APPROVED",
      to: "REQUESTED",
      allowed: ["CANCELLED", "WITHDRAWN"],
    });
  });

  it("defaults an absent allowed list to an empty array", () => {
    expect(decisionOutcome({ outcome: "ILLEGAL_TRANSITION", requestId: 5, from: "approved", to: "requested" }).allowed).toEqual([]);
  });

  it("maps INSUFFICIENT_BALANCE the same way requestLeave does, so the shapes agree", () => {
    const payload = { requested: 4, remaining: 1, shortfall: 3, asOf: "2026-08-27" };

    expect(decisionOutcome({ outcome: "INSUFFICIENT_BALANCE", ...payload })).toEqual(
      requestLeaveOutcome({ outcome: "INSUFFICIENT_BALANCE", ...payload }),
    );
  });

  it("falls through to LeaveValidationFailed for anything else", () => {
    const fieldErrors = [{ field: "reason", message: "required" }];

    expect(decisionOutcome({ outcome: "VALIDATION_FAILED", fieldErrors })).toEqual({
      __typename: "LeaveValidationFailed",
      fieldErrors,
    });
    expect(decisionOutcome({ outcome: "SOMETHING_NEW" }).fieldErrors).toEqual([]);
  });

  it("emits only members LeaveDecisionResult declares", () => {
    const declared = new Set(leaveUnion("LeaveDecisionResult"));
    const produced = [
      { outcome: "DECIDED", request: {} },
      { outcome: "REQUEST_NOT_FOUND" },
      { outcome: "ILLEGAL_TRANSITION" },
      { outcome: "INSUFFICIENT_BALANCE" },
      { outcome: "ANYTHING_ELSE" },
    ].map((result) => decisionOutcome(result).__typename);

    for (const typename of produced) {
      expect(declared.has(typename)).toBe(true);
    }
    // VersionConflict is the sixth member, reached through toUnionMember rather
    // than through the outcome table.
    expect(declared.has(toUnionMember(crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 1 })).__typename)).toBe(true);
  });
});

describe("leave resolvers — union type resolution", () => {
  it("resolves every union by the __typename the outcome tables stamped", () => {
    const unions = [
      "RequestLeaveResult",
      "LeaveDecisionResult",
      "SetLeavePolicyResult",
      "AdjustLeaveBalanceResult",
      "DeclareBlackoutResult",
    ];

    for (const union of unions) {
      expect(resolvers[union].__resolveType({ __typename: "Whatever" })).toBe("Whatever");
    }
  });
});

describe("leave resolvers — query and field plumbing", () => {
  const contextWith = (leave) => ({ services: { leave } });

  it("translates the two enum filters on leaveRequests and leaves the rest alone", async () => {
    const listRequests = (args) => Promise.resolve(args);
    const args = { status: "APPROVED", type: "ANNUAL", staffId: "7", from: "2026-01-01", to: "2026-12-31" };

    const passed = await resolvers.Query.leaveRequests(null, args, contextWith({ listRequests }));

    expect(passed).toEqual({ status: "approved", type: "annual", staffId: "7", from: "2026-01-01", to: "2026-12-31" });
  });

  it("passes only the staffId to the leave summary, so nothing is computed eagerly", () => {
    expect(resolvers.CrewMember.leave({ staffId: 3, profile: { note: "unused" } })).toEqual({ staffId: 3 });
  });

  it("pages LeaveSummary.requests without hiding the true total", async () => {
    const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const context = contextWith({ listRequests: async () => all });

    const page = await resolvers.LeaveSummary.requests({ staffId: 1 }, { first: 2 }, context);
    expect(page).toEqual({ nodes: [{ id: 1 }, { id: 2 }], totalCount: 3, hasMore: true });
  });

  it("returns everything when first is omitted, and reports no more pages", async () => {
    const all = [{ id: 1 }, { id: 2 }];
    const context = contextWith({ listRequests: async () => all });

    for (const args of [{}, { first: null }]) {
      const page = await resolvers.LeaveSummary.requests({ staffId: 1 }, args, context);
      expect(page).toEqual({ nodes: all, totalCount: 2, hasMore: false });
    }
  });

  it("clamps a negative first to zero rather than slicing from the end", async () => {
    const context = contextWith({ listRequests: async () => [{ id: 1 }, { id: 2 }] });

    const page = await resolvers.LeaveSummary.requests({ staffId: 1 }, { first: -5 }, context);
    expect(page).toEqual({ nodes: [], totalCount: 2, hasMore: true });
  });

  it("scopes the summary's requests to its own staffId and translates its filters", async () => {
    let seen = null;
    const context = contextWith({
      listRequests: async (args) => {
        seen = args;
        return [];
      },
    });

    await resolvers.LeaveSummary.requests({ staffId: 11 }, { status: "REQUESTED", type: "SICK" }, context);
    expect(seen).toEqual({ staffId: 11, status: "requested", type: "sick" });
  });
});
