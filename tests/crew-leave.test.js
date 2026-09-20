import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

// Leave pillar end to end (PRD §14.2, Phase 4).
//
// Everything here goes through the real graph endpoint, the real store and the
// real clock, which is what makes three things meaningful that a unit test cannot
// show:
//
//   1. **The six-member union crosses the wire intact.** Every outcome of asking
//      for leave is reachable by a client selecting `__typename`, and the two
//      outcomes that are NOT union members — an unknown member, a malformed input —
//      arrive as `errors[].extensions.code` instead (§15).
//   2. **`leave: null` plus one error** is the shape §7.3 documents for a balance
//      asked for before a policy exists. Null propagation is `graphql-js`'s job;
//      this proves the module hands it the right nullability to do it with.
//   3. **The cross-pillar seam is real now.** Phase 3 could only test
//      `ShiftConflictsLeave` with a stub leave service. With the pillar assembled,
//      approved leave refuses a shift for real.
//
// Dates are computed RELATIVE TO TODAY, because the graph uses the real clock and
// the notice rule is measured against it. Hard-coded dates would pass until they
// silently stopped being in the future.
const {
  app,
  getFlags,
  setCrewEnabled,
  restoreFlags,
  tokenFor,
  resetCrewStores,
  graph,
  graphData,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
} = require("./helpers/crew-harness");

const USER_ID = 1;

const iso = (date) => date.toISOString().slice(0, 10);

/** Today, in the same form the graph expects. */
function today() {
  return iso(new Date());
}

function shift(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

/**
 * A Monday at least `minDaysAhead` out whose Friday is in the same calendar year.
 *
 * Both halves matter. A Monday keeps the working-day arithmetic predictable
 * (Mon–Fri is always five). The same-year condition keeps the request inside one
 * leave year, which the module refuses to span — without it this suite would
 * start failing every December for a reason that has nothing to do with the code.
 */
function workWeekStart(minDaysAhead = 21) {
  let candidate = shift(today(), minDaysAhead);
  while (new Date(`${candidate}T00:00:00.000Z`).getUTCDay() !== 1) {
    candidate = shift(candidate, 1);
  }
  while (candidate.slice(0, 4) !== shift(candidate, 4).slice(0, 4)) {
    candidate = shift(candidate, 7);
  }
  return candidate;
}

const SET_POLICY = `
  mutation SetPolicy($input: LeavePolicyInput!) {
    setLeavePolicy(input: $input) {
      __typename
      ... on LeavePolicySet {
        policy {
          annualEntitlementDaysFullTime
          accrualMode
          carryOverCapDays
          carryOverExpiresOn
          leaveYearStart
          publicHolidays
          minNoticeDays
          version
          blackoutWindows { from to reason }
        }
      }
      ... on LeaveValidationFailed { fieldErrors { field message } }
      ... on VersionConflict { expectedVersion actualVersion }
    }
  }
`;

const REQUEST_LEAVE = `
  mutation RequestLeave($input: RequestLeaveInput!) {
    requestLeave(input: $input) {
      __typename
      ... on LeaveBooked {
        request { id staffId type from to halfDayStart halfDayEnd workingDays status reason version }
        balance { leaveYear entitlement accrued taken booked remaining }
      }
      ... on LeaveBookedWithWarning {
        request { id status workingDays }
        balance { booked remaining }
        warnings { code message }
      }
      ... on InsufficientBalance { requested remaining shortfall asOf }
      ... on OverlapsExistingLeave { conflictingRequestId from to }
      ... on BlackoutPeriod { from to reason firstClash }
      ... on InsufficientNotice { minNoticeDays requestedStart earliestStart }
    }
  }
`;

const DECISION = (mutation, args, call) => `
  mutation Decide(${args}) {
    ${call} {
      __typename
      ... on LeaveRequestDecided { request { id status version reason decidedAt } balance { taken booked remaining } }
      ... on LeaveRequestNotFound { requestId }
      ... on IllegalLeaveTransition { requestId from to allowed }
      ... on InsufficientBalance { requested remaining shortfall }
      ... on VersionConflict { expectedVersion actualVersion }
      ... on LeaveValidationFailed { fieldErrors { field message } }
    }
  }
`;

const APPROVE = DECISION(
  "approveLeave",
  "$requestId: ID!, $expectedVersion: Int",
  "approveLeave(requestId: $requestId, expectedVersion: $expectedVersion)",
);
const REJECT = DECISION("rejectLeave", "$requestId: ID!, $reason: NonEmptyString!", "rejectLeave(requestId: $requestId, reason: $reason)");
const CANCEL = DECISION("cancelLeave", "$requestId: ID!, $reason: String", "cancelLeave(requestId: $requestId, reason: $reason)");

const ADJUST = `
  mutation Adjust($input: AdjustLeaveBalanceInput!) {
    adjustLeaveBalance(input: $input) {
      __typename
      ... on LeaveBalanceAdjusted {
        adjustment { id staffId leaveYear days kind reason }
        balance { accrued carriedOver expiringSoon remaining }
      }
      ... on InsufficientBalance { requested shortfall }
      ... on LeaveValidationFailed { fieldErrors { field message } }
      ... on LeavePolicyMissing { message }
    }
  }
`;

const DECLARE_BLACKOUT = `
  mutation Declare($input: BlackoutWindowInput!) {
    declareBlackout(input: $input) {
      __typename
      ... on BlackoutDeclared { blackout { from to reason } affectedRequests { id status } }
      ... on LeaveValidationFailed { fieldErrors { field message } }
      ... on LeavePolicyMissing { message }
    }
  }
`;

const MEMBER_LEAVE = `
  query MemberLeave($staffId: ID!, $asOf: Date!) {
    crewMember(staffId: $staffId) {
      staffId
      leave {
        balance(asOf: $asOf) {
          leaveYear from to entitlement accrued carriedOver taken booked expiringSoon carryOverExpiresOn remaining
          byType { type taken booked }
        }
        requests { totalCount hasMore nodes { id from to status type workingDays } }
        nextBooked { id from status }
      }
    }
  }
`;

const POLICY_INPUT = {
  annualEntitlementDaysFullTime: 26,
  accrualMode: "MONTHLY",
  carryOverCapDays: 5,
  carryOverExpiresOn: "03-31",
  leaveYearStart: "01-01",
  // Empty on purpose: the working-day arithmetic below is then predictable
  // whatever month the suite happens to run in. The holiday rule has its own case.
  publicHolidays: [],
  blackoutWindows: [],
  minNoticeDays: 3,
};

describe("Crew Office — leave pillar", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenFor(USER_ID);
    await setCrewEnabled(true);
  });

  afterAll(async () => {
    await restoreFlags(originalFlags);
  });

  beforeEach(async () => {
    await resetCrewStores();
  });

  /** A policy and a hired member — the starting point for most cases below. */
  async function setup({ policy = {}, hire = {} } = {}) {
    const policyResult = await graphData({ query: SET_POLICY, variables: { input: { ...POLICY_INPUT, ...policy } }, token });
    expect(policyResult.setLeavePolicy.__typename).toBe("LeavePolicySet");

    const hireResult = await graphData({
      query: HIRE_MUTATION,
      // A start date a year back, so a full year has accrued whatever today is.
      variables: { input: { ...VALID_HIRE_INPUT, startDate: shift(today(), -400), ...hire } },
      token,
    });
    expect(hireResult.hireCrewMember.__typename).toBe("CrewMemberHired");

    return { staffId: hireResult.hireCrewMember.crewMember.staffId };
  }

  const ask = (staffId, overrides = {}) => {
    const from = workWeekStart();
    return { staffId, type: "ANNUAL", from, to: shift(from, 4), ...overrides };
  };

  describe("the schema and the module shape", () => {
    it("appears in extensions.pillars and in crewInfo", async () => {
      const res = await graph({ query: "{ crewInfo { pillars } }", token });
      expect(res.body.extensions.pillars).toContain("leave");
      expect(res.body.data.crewInfo.pillars).toContain("leave");
    });

    it("publishes the six-member union and the LEAVE_POLICY_MISSING code in the SDL", async () => {
      const sdl = await request(app).get("/api/graphql/crew").set("Cookie", `rolnopolToken=${token}`).expect(200);
      // Exactly six: adding a seventh would turn "the outcomes of asking for
      // leave" into a list a client cannot exhaust (§8.3).
      //
      // The regex walks pipe-separated member names rather than assuming a layout,
      // because how the declaration is wrapped is Prettier's business and not this
      // test's — an earlier version matched to the next blank line and broke the
      // first time the file was formatted.
      const union = /union RequestLeaveResult =\s*\|?\s*(\w+(?:\s*\|\s*\w+)*)/.exec(sdl.text);
      expect(
        union[1]
          .split("|")
          .map((name) => name.trim())
          .sort(),
      ).toEqual([
        "BlackoutPeriod",
        "InsufficientBalance",
        "InsufficientNotice",
        "LeaveBooked",
        "LeaveBookedWithWarning",
        "OverlapsExistingLeave",
      ]);
      // Every reachable code is documented in the header (§15).
      expect(sdl.text).toContain("LEAVE_POLICY_MISSING");
    });

    it("has no mutation that deletes a leave request", async () => {
      const sdl = await request(app).get("/api/graphql/crew").set("Cookie", `rolnopolToken=${token}`).expect(200);
      expect(sdl.text).not.toMatch(/deleteLeave|removeLeave|deleteLeaveRequest/);
    });
  });

  describe("the policy", () => {
    it("sets a policy and reads it back", async () => {
      await setup();
      const data = await graphData({ query: "{ leavePolicy { annualEntitlementDaysFullTime accrualMode minNoticeDays version } }", token });
      expect(data.leavePolicy).toMatchObject({ annualEntitlementDaysFullTime: 26, accrualMode: "MONTHLY", minNoticeDays: 3, version: 1 });
    });

    it("returns null — not an error — when no policy is configured", async () => {
      const data = await graphData({ query: "{ leavePolicy { version } }", token });
      expect(data.leavePolicy).toBeNull();
    });

    it("rejects a malformed policy as a typed failure, not an error", async () => {
      const data = await graphData({
        query: SET_POLICY,
        variables: { input: { ...POLICY_INPUT, leaveYearStart: "01-31", carryOverExpiresOn: "02-29", minNoticeDays: -1 } },
        token,
      });
      expect(data.setLeavePolicy.__typename).toBe("LeaveValidationFailed");
      const fields = data.setLeavePolicy.fieldErrors.map((error) => error.field);
      expect(fields).toEqual(expect.arrayContaining(["leaveYearStart", "carryOverExpiresOn", "minNoticeDays"]));
    });

    it("refuses a Days value that is not a half-day step, at the scalar", async () => {
      // The `Days` scalar catches this before the domain sees it, which is the
      // point of having it.
      const res = await graph({
        query: SET_POLICY,
        variables: { input: { ...POLICY_INPUT, annualEntitlementDaysFullTime: 26.3 } },
        token,
      });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toMatch(/0\.5 steps/);
    });
  });

  describe("the balance", () => {
    it("resolves leave: null plus ONE error when no policy exists (§7.3)", async () => {
      // The exact partial-response shape the PRD documents. Not an empty balance:
      // "not configured" and "no days left" are different statements.
      const hire = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const staffId = hire.hireCrewMember.crewMember.staffId;

      const res = await graph({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      expect(res.status).toBe(200);
      expect(res.body.data.crewMember.leave).toBeNull();
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].extensions.code).toBe("LEAVE_POLICY_MISSING");
      expect(res.body.errors[0].path).toEqual(["crewMember", "leave", "balance"]);
    });

    it("computes a full entitlement for somebody who has been here a year", async () => {
      const { staffId } = await setup();
      const data = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      const balance = data.crewMember.leave.balance;

      expect(balance).toMatchObject({ entitlement: 26, taken: 0, booked: 0 });
      expect(balance.remaining).toBe(balance.accrued + balance.carriedOver);
      expect(balance.byType).toHaveLength(5);
    });

    it("halves the entitlement for a half-time contract", async () => {
      const { staffId } = await setup({ hire: { fte: 0.5 } });
      const data = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.entitlement).toBe(13);
    });

    it("satisfies the §8.3 invariant over the wire", async () => {
      const { staffId } = await setup();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });
      await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: Number(today().slice(0, 4)), days: 2, reason: "goodwill" } },
        token,
      });

      const data = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      const { accrued, carriedOver, taken, booked, remaining } = data.crewMember.leave.balance;
      expect(remaining).toBe(accrued + carriedOver - taken - booked);
    });
  });

  describe("requesting leave", () => {
    it("books a week and hangs it on the crew member", async () => {
      const { staffId } = await setup();
      const input = ask(staffId);
      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input }, token });

      expect(booked.requestLeave.__typename).toBe("LeaveBooked");
      expect(booked.requestLeave.request).toMatchObject({ status: "REQUESTED", type: "ANNUAL", workingDays: 5, version: 1 });
      expect(booked.requestLeave.balance.booked).toBe(5);

      const member = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      expect(member.crewMember.leave.requests.totalCount).toBe(1);
      expect(member.crewMember.leave.nextBooked.id).toBe(booked.requestLeave.request.id);
    });

    it("charges 4.5 days for a half day at the end", async () => {
      const { staffId } = await setup();
      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { halfDayEnd: true }) }, token });
      expect(booked.requestLeave.request.workingDays).toBe(4.5);
    });

    it("does not charge for a public holiday inside the period", async () => {
      const from = workWeekStart();
      const { staffId } = await setup({ policy: { publicHolidays: [shift(from, 2)] } });
      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });
      expect(booked.requestLeave.request.workingDays).toBe(4);
    });

    it("refuses a request with too little notice", async () => {
      const { staffId } = await setup();
      const tomorrow = shift(today(), 1);
      const data = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from: tomorrow, to: tomorrow }) }, token });

      expect(data.requestLeave.__typename).toBe("InsufficientNotice");
      expect(data.requestLeave).toMatchObject({ minNoticeDays: 3, requestedStart: tomorrow, earliestStart: shift(today(), 3) });
    });

    it("refuses a request inside a blackout window and names the first clash", async () => {
      const from = workWeekStart();
      const { staffId } = await setup({ policy: { blackoutWindows: [{ from: shift(from, 1), to: shift(from, 3), reason: "Harvest" }] } });
      const data = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      expect(data.requestLeave.__typename).toBe("BlackoutPeriod");
      expect(data.requestLeave).toMatchObject({ reason: "Harvest", firstClash: shift(from, 1) });
    });

    it("refuses an overlapping request and names the conflict", async () => {
      const { staffId } = await setup();
      const from = workWeekStart();
      const first = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      const second = await graphData({
        query: REQUEST_LEAVE,
        variables: { input: ask(staffId, { from: shift(from, 3), to: shift(from, 7) }) },
        token,
      });
      expect(second.requestLeave.__typename).toBe("OverlapsExistingLeave");
      expect(second.requestLeave.conflictingRequestId).toBe(first.requestLeave.request.id);
    });

    it("refuses a request the balance cannot cover, and says by how much", async () => {
      const { staffId } = await setup({ policy: { annualEntitlementDaysFullTime: 3 } });
      const data = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });

      expect(data.requestLeave.__typename).toBe("InsufficientBalance");
      expect(data.requestLeave.requested).toBe(5);
      expect(data.requestLeave.shortfall).toBe(data.requestLeave.requested - data.requestLeave.remaining);
    });

    it("BOOKS with a warning when another member is already off — the warning never blocks", async () => {
      // The Phase 4 exit criterion. A warning that silently refuses is the
      // planted-bug shape: the office is told everything is fine and nobody is off.
      const { staffId: first } = await setup();
      const second = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Ala", surname: "Zielinska", startDate: shift(today(), -400) } },
        token,
      });
      const secondId = second.hireCrewMember.crewMember.staffId;

      const from = workWeekStart();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(first, { from, to: shift(from, 4) }) }, token });
      const overlapping = await graphData({
        query: REQUEST_LEAVE,
        variables: { input: ask(secondId, { from, to: shift(from, 4) }) },
        token,
      });

      expect(overlapping.requestLeave.__typename).toBe("LeaveBookedWithWarning");
      expect(overlapping.requestLeave.warnings.map((warning) => warning.code)).toContain("COVERAGE_THIN");
      expect(overlapping.requestLeave.request.status).toBe("REQUESTED");

      // The proof it BOOKED: the request is readable, and the balance moved.
      const member = await graphData({ query: MEMBER_LEAVE, variables: { staffId: secondId, asOf: today() }, token });
      expect(member.crewMember.leave.requests.totalCount).toBe(1);
      expect(member.crewMember.leave.balance.booked).toBe(5);
    });

    it("records sick leave retrospectively, with no notice rule and no deduction", async () => {
      const { staffId } = await setup();
      const yesterday = shift(today(), -1);
      const booked = await graphData({
        query: REQUEST_LEAVE,
        variables: { input: { staffId, type: "SICK", from: yesterday, to: yesterday } },
        token,
      });

      // A weekend "yesterday" has no chargeable day, which is a validation error
      // rather than a booking — so accept either, and assert the rule that matters.
      if (booked.requestLeave) {
        expect(booked.requestLeave.__typename).toBe("LeaveBooked");
        const member = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
        expect(member.crewMember.leave.balance.taken).toBe(0);
        expect(member.crewMember.leave.balance.booked).toBe(0);
      }
    });

    it("returns MEMBER_NOT_FOUND as an ERROR, not a seventh union member", async () => {
      await setup();
      const res = await graph({ query: REQUEST_LEAVE, variables: { input: ask("99999") }, token });
      // 200 with `errors`, not 400: the operation ran and a resolver refused
      // (§7.3). `requestLeave` is non-null, so the error nulls `data` entirely —
      // which is `graphql-js` propagating correctly, and is the observable
      // difference between an error and a union member.
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.code).toBe("MEMBER_NOT_FOUND");
      expect(res.body.errors[0].path).toEqual(["requestLeave"]);
    });

    it("returns VALIDATION_FAILED with fieldErrors as an ERROR for a malformed request", async () => {
      const { staffId } = await setup();
      const from = workWeekStart();
      const res = await graph({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, -3) }) }, token });
      expect(res.body.errors[0].extensions.code).toBe("VALIDATION_FAILED");
      expect(res.body.errors[0].extensions.fieldErrors[0].field).toBe("to");
    });
  });

  describe("the lifecycle", () => {
    async function booked(overrides) {
      const { staffId } = await setup();
      const result = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, overrides) }, token });
      expect(result.requestLeave.__typename).toBe("LeaveBooked");
      return { staffId, requestId: result.requestLeave.request.id };
    }

    it("approves a request, bumping the version and moving booked days", async () => {
      const { requestId } = await booked();
      const data = await graphData({ query: APPROVE, variables: { requestId }, token });
      expect(data.approveLeave.__typename).toBe("LeaveRequestDecided");
      expect(data.approveLeave.request).toMatchObject({ status: "APPROVED", version: 2 });
      expect(data.approveLeave.request.decidedAt).toBeTruthy();
    });

    it("rejects a request with a reason", async () => {
      const { requestId } = await booked();
      const data = await graphData({ query: REJECT, variables: { requestId, reason: "harvest cover" }, token });
      expect(data.rejectLeave.request).toMatchObject({ status: "REJECTED", reason: "harvest cover" });
    });

    it("WITHDRAWS a pending request and CANCELS an approved one", async () => {
      const pending = await booked();
      const withdrawn = await graphData({ query: CANCEL, variables: { requestId: pending.requestId }, token });
      expect(withdrawn.cancelLeave.request.status).toBe("WITHDRAWN");

      const other = await booked();
      await graphData({ query: APPROVE, variables: { requestId: other.requestId }, token });
      const cancelled = await graphData({ query: CANCEL, variables: { requestId: other.requestId, reason: "plans changed" }, token });
      expect(cancelled.cancelLeave.request.status).toBe("CANCELLED");
    });

    it("refuses an illegal transition and lists what is allowed", async () => {
      const { requestId } = await booked();
      await graphData({ query: APPROVE, variables: { requestId }, token });
      const again = await graphData({ query: APPROVE, variables: { requestId }, token });

      expect(again.approveLeave.__typename).toBe("IllegalLeaveTransition");
      expect(again.approveLeave).toMatchObject({ from: "APPROVED", to: "APPROVED", allowed: ["CANCELLED"] });
    });

    it("reports a request that does not exist", async () => {
      await setup();
      const data = await graphData({ query: APPROVE, variables: { requestId: "99999" }, token });
      expect(data.approveLeave.__typename).toBe("LeaveRequestNotFound");
    });

    it("refuses a decision made against a stale version", async () => {
      const { requestId } = await booked();
      const data = await graphData({ query: APPROVE, variables: { requestId, expectedVersion: 99 }, token });
      expect(data.approveLeave.__typename).toBe("VersionConflict");
      expect(data.approveLeave).toMatchObject({ expectedVersion: 99, actualVersion: 1 });
    });

    it("refuses a rejection with no reason at the schema, because the argument is non-null", async () => {
      const { requestId } = await booked();
      const res = await graph({ query: REJECT, variables: { requestId, reason: "   " }, token });
      // `NonEmptyString` rejects whitespace-only before the resolver runs.
      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toMatch(/whitespace/);
    });

    it("keeps every row — nothing is ever deleted", async () => {
      const { staffId, requestId } = await booked();
      await graphData({ query: CANCEL, variables: { requestId }, token });
      const member = await graphData({ query: MEMBER_LEAVE, variables: { staffId, asOf: today() }, token });
      expect(member.crewMember.leave.requests.nodes.map((node) => node.status)).toEqual(["WITHDRAWN"]);
    });
  });

  describe("adjustments and carry-over", () => {
    const leaveYear = () => Number(today().slice(0, 4));

    it("appends a manual correction and moves the balance", async () => {
      const { staffId } = await setup();
      const data = await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: leaveYear(), days: 2, reason: "goodwill day" } },
        token,
      });
      expect(data.adjustLeaveBalance.__typename).toBe("LeaveBalanceAdjusted");
      expect(data.adjustLeaveBalance.adjustment).toMatchObject({ kind: "manual", days: 2, reason: "goodwill day" });
    });

    it("grants carry-over as its own kind, visible as expiringSoon before its deadline", async () => {
      const { staffId } = await setup({ policy: { carryOverExpiresOn: "12-31" } });
      const data = await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: leaveYear(), days: 4, reason: "carry-over from last year", carryOver: true } },
        token,
      });
      expect(data.adjustLeaveBalance.adjustment.kind).toBe("carry_over_grant");
      expect(data.adjustLeaveBalance.balance).toMatchObject({ carriedOver: 4, expiringSoon: 4 });
    });

    it("refuses a carry-over grant above the cap rather than clamping it", async () => {
      const { staffId } = await setup();
      await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: leaveYear(), days: 4, reason: "co", carryOver: true } },
        token,
      });
      const data = await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: leaveYear(), days: 4, reason: "more", carryOver: true } },
        token,
      });
      expect(data.adjustLeaveBalance.__typename).toBe("LeaveValidationFailed");
      expect(data.adjustLeaveBalance.fieldErrors[0].message).toContain("cap");
    });

    it("refuses a negative correction that would overdraw the leave year", async () => {
      const { staffId } = await setup();
      const data = await graphData({
        query: ADJUST,
        variables: { input: { staffId, leaveYear: leaveYear(), days: -30, reason: "clawback" } },
        token,
      });
      expect(data.adjustLeaveBalance.__typename).toBe("InsufficientBalance");
    });

    it("reports LeavePolicyMissing rather than throwing when nothing is configured", async () => {
      const hire = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const data = await graphData({
        query: ADJUST,
        variables: { input: { staffId: hire.hireCrewMember.crewMember.staffId, leaveYear: leaveYear(), days: 1, reason: "x" } },
        token,
      });
      expect(data.adjustLeaveBalance.__typename).toBe("LeavePolicyMissing");
    });
  });

  describe("declaring a blackout", () => {
    it("appends the window and reports leave already approved inside it", async () => {
      // Declaring harvest cannot un-promise a holiday somebody already has.
      const { staffId } = await setup();
      const from = workWeekStart();
      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });
      await graphData({ query: APPROVE, variables: { requestId: booked.requestLeave.request.id }, token });

      const declared = await graphData({
        query: DECLARE_BLACKOUT,
        variables: { input: { from: shift(from, -7), to: shift(from, 14), reason: "Harvest" } },
        token,
      });
      expect(declared.declareBlackout.__typename).toBe("BlackoutDeclared");
      expect(declared.declareBlackout.affectedRequests).toEqual([{ id: booked.requestLeave.request.id, status: "APPROVED" }]);

      // And it blocks the NEXT request in that window.
      const blocked = await graphData({
        query: REQUEST_LEAVE,
        variables: { input: ask(staffId, { from: shift(from, 7), to: shift(from, 11) }) },
        token,
      });
      expect(blocked.requestLeave.__typename).toBe("BlackoutPeriod");
    });
  });

  describe("team-wide reads", () => {
    it("lists pending approvals and drops them once decided", async () => {
      const { staffId } = await setup();
      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });

      const pending = await graphData({ query: "{ pendingLeaveApprovals { id status } }", token });
      expect(pending.pendingLeaveApprovals).toEqual([{ id: booked.requestLeave.request.id, status: "REQUESTED" }]);

      await graphData({ query: APPROVE, variables: { requestId: booked.requestLeave.request.id }, token });
      expect((await graphData({ query: "{ pendingLeaveApprovals { id } }", token })).pendingLeaveApprovals).toEqual([]);
    });

    it("builds a calendar with weekends, absences and names", async () => {
      const { staffId } = await setup();
      const from = workWeekStart();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      const data = await graphData({
        query: `query Cal($from: Date!, $to: Date!) {
          leaveCalendar(from: $from, to: $to) {
            date weekend publicHoliday blackoutReason
            absences { staffId name type status halfDay requestId }
          }
        }`,
        variables: { from: shift(from, -2), to: shift(from, 1) },
        token,
      });

      expect(data.leaveCalendar).toHaveLength(4);
      expect(data.leaveCalendar[0].weekend).toBe(true); // the Saturday before
      const monday = data.leaveCalendar.find((day) => day.date === from);
      expect(monday.absences).toHaveLength(1);
      expect(monday.absences[0]).toMatchObject({ staffId, name: VALID_HIRE_INPUT.name, type: "ANNUAL", status: "REQUESTED" });
    });

    it("counts who is available on a date", async () => {
      const { staffId } = await setup();
      const from = workWeekStart();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      const data = await graphData({
        query: `query Absence($date: Date!) { teamAbsence(date: $date) { date availableCount absent { staffId type } } }`,
        variables: { date: from },
        token,
      });
      expect(data.teamAbsence.absent).toEqual([{ staffId, type: "ANNUAL" }]);

      // Everyone on the roster except the one person who is off. Derived from
      // `crewSize` rather than a literal, because this user owns the base
      // `staff.json` records too and pinning a number here would make the test
      // depend on how many of them there happen to be.
      const info = await graphData({ query: "{ crewInfo { crewSize } }", token });
      expect(data.teamAbsence.availableCount).toBe(info.crewInfo.crewSize - 1);
    });

    it("returns a request that merely OVERLAPS the range", async () => {
      // A calendar for a month must show the holiday that started the month before.
      const { staffId } = await setup();
      const from = workWeekStart();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      const data = await graphData({
        query: `query Reqs($from: Date, $to: Date) { leaveRequests(from: $from, to: $to) { id from to } }`,
        variables: { from: shift(from, 3), to: shift(from, 20) },
        token,
      });
      expect(data.leaveRequests).toHaveLength(1);
    });

    it("reads the whole crew's leave in ONE round trip, without an N+1 per member", async () => {
      // The promise §16 makes concrete: `extensions.storeReads` must not grow with
      // the roster. This user owns dozens of staff records, so a per-member read
      // would show up here as dozens of reads rather than a handful.
      await setup();

      const res = await graph({
        query: `query Roster($asOf: Date!) {
          crew { totalCount nodes { staffId leave { balance(asOf: $asOf) { remaining } nextBooked { id } } } }
        }`,
        variables: { asOf: today() },
        token,
      });

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.crew.totalCount).toBeGreaterThan(5);
      // A read each for staff, profiles and leave — bounded, and independent of
      // how many members the roster holds.
      expect(res.body.extensions.storeReads).toBeLessThanOrEqual(5);
    });
  });

  describe("the cross-pillar seam with the work pillar", () => {
    it("refuses a shift that clashes with APPROVED leave", async () => {
      // Phase 3 could only prove this with a stub leave service. With the pillar
      // assembled, `ShiftConflictsLeave` is reachable for real.
      const { staffId } = await setup();
      const from = workWeekStart();

      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });
      await graphData({ query: APPROVE, variables: { requestId: booked.requestLeave.request.id }, token });

      const duty = await graphData({
        query: `mutation D($input: DutyTypeInput!) {
          defineDutyType(input: $input) { __typename ... on DutyTypeDefined { dutyType { id } } }
        }`,
        variables: { input: { code: "milking_early", name: "Early milking", startTime: "05:00", endTime: "08:00" } },
        token,
      });

      const planned = await graphData({
        query: `mutation P($input: PlanShiftInput!) {
          planShift(input: $input) {
            __typename
            ... on ShiftPlanned { shift { id } }
            ... on ShiftConflictsLeave { staffId date }
          }
        }`,
        variables: { input: { staffId, dutyTypeId: duty.defineDutyType.dutyType.id, date: shift(from, 1) } },
        token,
      });

      expect(planned.planShift.__typename).toBe("ShiftConflictsLeave");
      expect(planned.planShift).toMatchObject({ staffId, date: shift(from, 1) });
    });

    it("does NOT refuse a shift when the leave is only PENDING", async () => {
      // Asking for leave must not silently remove somebody from the roster before
      // anyone has agreed to it.
      const { staffId } = await setup();
      const from = workWeekStart();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });

      const duty = await graphData({
        query: `mutation D($input: DutyTypeInput!) {
          defineDutyType(input: $input) { __typename ... on DutyTypeDefined { dutyType { id } } }
        }`,
        variables: { input: { code: "feeding", name: "Feeding round", startTime: "09:00", endTime: "12:00" } },
        token,
      });

      const planned = await graphData({
        query: `mutation P($input: PlanShiftInput!) {
          planShift(input: $input) { __typename ... on ShiftPlanned { shift { id } } ... on ShiftConflictsLeave { date } }
        }`,
        variables: { input: { staffId, dutyTypeId: duty.defineDutyType.dutyType.id, date: shift(from, 1) } },
        token,
      });
      expect(planned.planShift.__typename).toBe("ShiftPlanned");
    });

    it("warns about rostered shifts when leave is requested over them, and still books", async () => {
      const { staffId } = await setup();
      const from = workWeekStart();

      const duty = await graphData({
        query: `mutation D($input: DutyTypeInput!) {
          defineDutyType(input: $input) { __typename ... on DutyTypeDefined { dutyType { id } } }
        }`,
        variables: { input: { code: "fencing", name: "Fencing", startTime: "08:00", endTime: "16:00" } },
        token,
      });
      await graphData({
        query: `mutation P($input: PlanShiftInput!) { planShift(input: $input) { __typename ... on ShiftPlanned { shift { id } } } }`,
        variables: { input: { staffId, dutyTypeId: duty.defineDutyType.dutyType.id, date: shift(from, 1) } },
        token,
      });

      const booked = await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId, { from, to: shift(from, 4) }) }, token });
      expect(booked.requestLeave.__typename).toBe("LeaveBookedWithWarning");
      expect(booked.requestLeave.warnings.map((warning) => warning.code)).toContain("SHIFTS_ROSTERED");
      expect(booked.requestLeave.request.status).toBe("REQUESTED");
    });
  });

  describe("orphaned overlays (§12 rule 4)", () => {
    it("reports leave rows left behind by DELETE /api/v1/staff/:id, without crashing", async () => {
      // The most likely real crash, on a path the base entity's owner controls.
      const { staffId } = await setup();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });

      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`);

      const res = await graph({ query: "{ orphanedOverlays { pillar staffId rowId detail } }", token });
      expect(res.status).toBe(200);
      const pillars = res.body.data.orphanedOverlays.filter((row) => row.staffId === String(staffId)).map((row) => row.pillar);
      expect(pillars).toContain("leave");
      expect(pillars).toContain("profiles");
    });

    it("still resolves an orphan's balance — a read DEGRADES rather than erroring", async () => {
      // A roster asking for leave with `includeOrphaned` must not fail. The
      // person's leave history is still real; only their staff record is gone.
      const { staffId } = await setup();
      await graphData({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`);

      const res = await graph({
        query: `query Orphans($asOf: Date!) {
          crew(filter: { includeOrphaned: true }) {
            nodes { staffId orphaned name leave { balance(asOf: $asOf) { booked remaining } } }
          }
        }`,
        variables: { asOf: today() },
        token,
      });

      expect(res.body.errors).toBeUndefined();
      const orphan = res.body.data.crew.nodes.find((node) => node.staffId === String(staffId));
      expect(orphan).toMatchObject({ orphaned: true, name: null });
      expect(orphan.leave.balance.booked).toBe(5);
    });

    it("refuses to BOOK leave for an orphan — a row nothing can reach is worse than a refusal", async () => {
      const { staffId } = await setup();
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`);

      const res = await graph({ query: REQUEST_LEAVE, variables: { input: ask(staffId) }, token });
      expect(res.body.errors[0].extensions.code).toBe("MEMBER_NOT_FOUND");
    });
  });
});
