import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// Concurrency (PRD §14.2, §14.4 item 4).
//
// The module's core race, and one of the six tests the PRD says must exist:
// **two leave requests that each fit the balance but not together must resolve to
// exactly one booking.**
//
// It is worth being precise about what makes that true, because it is one line of
// design and it is easy to undo. The balance check and the append happen inside a
// single `store.update()` critical section (`leave/store.js`), and the mutate
// function passed to it is SYNCHRONOUS. If the check moved outside the section —
// or if an `await` were introduced inside it — both writers would compute their
// balance against a document that predated the other, both would pass, and the
// member would be overdrawn with no rule broken anywhere.
//
// Every case below therefore asserts the STORE as well as the responses. Two
// answers that look right while the store holds two bookings is the exact failure
// this file exists to catch.
const {
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
const today = () => iso(new Date());

function shift(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

/** A Monday well clear of the notice rule, whose week does not cross a year end. */
function workWeekStart(minDaysAhead = 21) {
  let candidate = shift(today(), minDaysAhead);
  while (new Date(`${candidate}T00:00:00.000Z`).getUTCDay() !== 1) candidate = shift(candidate, 1);
  while (candidate.slice(0, 4) !== shift(candidate, 11).slice(0, 4)) candidate = shift(candidate, 7);
  return candidate;
}

const SET_POLICY = `
  mutation SetPolicy($input: LeavePolicyInput!) {
    setLeavePolicy(input: $input) { __typename ... on LeavePolicySet { policy { version } } }
  }
`;

const REQUEST_LEAVE = `
  mutation RequestLeave($input: RequestLeaveInput!) {
    requestLeave(input: $input) {
      __typename
      ... on LeaveBooked { request { id workingDays } balance { remaining } }
      ... on LeaveBookedWithWarning { request { id workingDays } }
      ... on InsufficientBalance { requested remaining shortfall }
      ... on OverlapsExistingLeave { conflictingRequestId }
      ... on BlackoutPeriod { firstClash }
      ... on InsufficientNotice { earliestStart }
    }
  }
`;

const APPROVE = `
  mutation Approve($requestId: ID!, $expectedVersion: Int) {
    approveLeave(requestId: $requestId, expectedVersion: $expectedVersion) {
      __typename
      ... on LeaveRequestDecided { request { id status version } }
      ... on IllegalLeaveTransition { from to }
      ... on InsufficientBalance { shortfall }
      ... on VersionConflict { expectedVersion actualVersion }
    }
  }
`;

const CANCEL = `
  mutation Cancel($requestId: ID!, $expectedVersion: Int) {
    cancelLeave(requestId: $requestId, expectedVersion: $expectedVersion) {
      __typename
      ... on LeaveRequestDecided { request { id status version } }
      ... on IllegalLeaveTransition { from to }
      ... on VersionConflict { expectedVersion actualVersion }
    }
  }
`;

const ADJUST = `
  mutation Adjust($input: AdjustLeaveBalanceInput!) {
    adjustLeaveBalance(input: $input) {
      __typename
      ... on LeaveBalanceAdjusted { adjustment { id days kind } balance { carriedOver remaining } }
      ... on InsufficientBalance { shortfall }
      ... on LeaveValidationFailed { fieldErrors { field message } }
    }
  }
`;

const BALANCE = `
  query Balance($staffId: ID!, $asOf: Date!) {
    crewMember(staffId: $staffId) {
      leave {
        balance(asOf: $asOf) { accrued carriedOver taken booked remaining }
        requests { nodes { id status workingDays version } }
      }
    }
  }
`;

describe("Crew Office — leave concurrency", () => {
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

  /**
   * A member with an entitlement chosen so a known number of days is available.
   *
   * `upfront` accrual on purpose: it makes the balance a flat number independent
   * of which month the suite runs in, so "each fits, both do not" is arranged
   * exactly rather than approximately.
   */
  async function setup({ entitlementDays, startDate = shift(today(), -400) } = {}) {
    const policy = await graphData({
      query: SET_POLICY,
      variables: {
        input: {
          annualEntitlementDaysFullTime: entitlementDays,
          accrualMode: "UPFRONT",
          carryOverCapDays: 5,
          carryOverExpiresOn: "12-31",
          leaveYearStart: "01-01",
          publicHolidays: [],
          blackoutWindows: [],
          minNoticeDays: 0,
        },
      },
      token,
    });
    expect(policy.setLeavePolicy.__typename).toBe("LeavePolicySet");

    const hire = await graphData({ query: HIRE_MUTATION, variables: { input: { ...VALID_HIRE_INPUT, startDate } }, token });
    expect(hire.hireCrewMember.__typename).toBe("CrewMemberHired");
    return { staffId: hire.hireCrewMember.crewMember.staffId };
  }

  const liveRequests = (data) => data.crewMember.leave.requests.nodes.filter((node) => ["REQUESTED", "APPROVED"].includes(node.status));

  describe("two requests that each fit but not together", () => {
    it("books EXACTLY one, and the store agrees", async () => {
      // 8 days available; two non-overlapping five-day weeks. Either alone fits,
      // the pair does not. The overlap check cannot save us here — the two weeks
      // do not touch — so only the in-transaction balance check can.
      const { staffId } = await setup({ entitlementDays: 8 });
      const first = workWeekStart();
      const second = shift(first, 14);

      const [a, b] = await Promise.all([
        graph({ query: REQUEST_LEAVE, variables: { input: { staffId, type: "ANNUAL", from: first, to: shift(first, 4) } }, token }),
        graph({ query: REQUEST_LEAVE, variables: { input: { staffId, type: "ANNUAL", from: second, to: shift(second, 4) } }, token }),
      ]);

      const outcomes = [a.body.data.requestLeave.__typename, b.body.data.requestLeave.__typename].sort();
      expect(outcomes).toEqual(["InsufficientBalance", "LeaveBooked"]);

      // The assertion that matters: one booking in the store, not two.
      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(liveRequests(data)).toHaveLength(1);
      expect(data.crewMember.leave.balance.booked).toBe(5);
      expect(data.crewMember.leave.balance.remaining).toBe(3);
    });

    it("never lets a member end up overdrawn, whichever request wins", async () => {
      const { staffId } = await setup({ entitlementDays: 8 });
      const first = workWeekStart();

      await Promise.all([
        graph({ query: REQUEST_LEAVE, variables: { input: { staffId, type: "ANNUAL", from: first, to: shift(first, 4) } }, token }),
        graph({
          query: REQUEST_LEAVE,
          variables: { input: { staffId, type: "ANNUAL", from: shift(first, 14), to: shift(first, 18) } },
          token,
        }),
      ]);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.remaining).toBeGreaterThanOrEqual(0);
    });

    it("books BOTH when the balance genuinely covers both", async () => {
      // The other half of the claim: serialising the check must not turn a legal
      // pair into a refusal. A guard that simply refused the second writer would
      // pass the test above and fail this one.
      const { staffId } = await setup({ entitlementDays: 20 });
      const first = workWeekStart();

      const [a, b] = await Promise.all([
        graph({ query: REQUEST_LEAVE, variables: { input: { staffId, type: "ANNUAL", from: first, to: shift(first, 4) } }, token }),
        graph({
          query: REQUEST_LEAVE,
          variables: { input: { staffId, type: "ANNUAL", from: shift(first, 14), to: shift(first, 18) } },
          token,
        }),
      ]);

      expect([a.body.data.requestLeave.__typename, b.body.data.requestLeave.__typename]).toEqual(["LeaveBooked", "LeaveBooked"]);
      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.booked).toBe(10);
    });

    it("resolves two requests for the SAME week to exactly one booking", async () => {
      // Here the overlap check is what decides it, and it is inside the same
      // critical section for the same reason.
      const { staffId } = await setup({ entitlementDays: 26 });
      const week = workWeekStart();
      const input = { staffId, type: "ANNUAL", from: week, to: shift(week, 4) };

      const [a, b] = await Promise.all([
        graph({ query: REQUEST_LEAVE, variables: { input }, token }),
        graph({ query: REQUEST_LEAVE, variables: { input }, token }),
      ]);

      expect([a.body.data.requestLeave.__typename, b.body.data.requestLeave.__typename].sort()).toEqual([
        "LeaveBooked",
        "OverlapsExistingLeave",
      ]);
      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(liveRequests(data)).toHaveLength(1);
    });

    it("survives a burst of five identical requests with exactly one booking", async () => {
      const { staffId } = await setup({ entitlementDays: 26 });
      const week = workWeekStart();
      const input = { staffId, type: "ANNUAL", from: week, to: shift(week, 4) };

      const results = await Promise.all(Array.from({ length: 5 }, () => graph({ query: REQUEST_LEAVE, variables: { input }, token })));
      const booked = results.filter((res) => res.body.data.requestLeave.__typename === "LeaveBooked");
      expect(booked).toHaveLength(1);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(liveRequests(data)).toHaveLength(1);
    });
  });

  describe("concurrent decisions on one request", () => {
    async function pending(entitlementDays = 26, weekOffset = 0) {
      const { staffId } = await setup({ entitlementDays });
      const week = shift(workWeekStart(), weekOffset);
      const result = await graphData({
        query: REQUEST_LEAVE,
        variables: { input: { staffId, type: "ANNUAL", from: week, to: shift(week, 4) } },
        token,
      });
      expect(result.requestLeave.__typename).toBe("LeaveBooked");
      return { staffId, requestId: result.requestLeave.request.id };
    }

    it("applies one approval and refuses the duplicate as an illegal transition", async () => {
      const { requestId } = await pending();
      const [a, b] = await Promise.all([
        graph({ query: APPROVE, variables: { requestId }, token }),
        graph({ query: APPROVE, variables: { requestId }, token }),
      ]);

      const outcomes = [a.body.data.approveLeave.__typename, b.body.data.approveLeave.__typename].sort();
      expect(outcomes).toEqual(["IllegalLeaveTransition", "LeaveRequestDecided"]);
    });

    it("leaves one coherent state when approve and cancel race", async () => {
      // NOT "exactly one winner": approve-then-cancel is a legal two-step, so both
      // mutations succeeding is a correct outcome when they land in that order.
      // What must hold whichever order they land in is that the row is the product
      // of a legal PATH — every applied transition allowed from the state before
      // it, and the version equal to one plus the number that applied. A request
      // that ended up both granted and withdrawn, or at a version that does not
      // match its history, is the corruption this guards against.
      const { staffId, requestId } = await pending();
      const [approve, cancel] = await Promise.all([
        graph({ query: APPROVE, variables: { requestId }, token }),
        graph({ query: CANCEL, variables: { requestId }, token }),
      ]);

      const results = [approve.body.data.approveLeave, cancel.body.data.cancelLeave];
      const applied = results.filter((result) => result.__typename === "LeaveRequestDecided");
      // Anything that did not apply was REFUSED with a reason, never ignored.
      for (const result of results) {
        expect(["LeaveRequestDecided", "IllegalLeaveTransition", "VersionConflict"]).toContain(result.__typename);
      }

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      const [row] = data.crewMember.leave.requests.nodes;
      expect(row.version).toBe(1 + applied.length);
      // Reachable end states: cancel first ⇒ WITHDRAWN and the approval refused;
      // approve first ⇒ CANCELLED, both having applied in a legal order.
      expect(applied.length === 1 ? ["WITHDRAWN", "APPROVED"] : ["CANCELLED"]).toContain(row.status);
    });

    it("refuses the loser of a version race rather than overwriting it", async () => {
      // Both hold version 1 and both pass it back, so at most one can apply. The
      // loser's refusal depends on which landed first — a stale version if its
      // transition was still legal, an illegal transition if the winner moved the
      // row somewhere the loser cannot leave. Either way it is TOLD, and the row
      // reflects exactly one write.
      const { staffId, requestId } = await pending();
      const [a, b] = await Promise.all([
        graph({ query: APPROVE, variables: { requestId, expectedVersion: 1 }, token }),
        graph({ query: CANCEL, variables: { requestId, expectedVersion: 1 }, token }),
      ]);

      const results = [a.body.data.approveLeave, b.body.data.cancelLeave];
      expect(results.filter((result) => result.__typename === "LeaveRequestDecided")).toHaveLength(1);
      expect(results.filter((result) => ["VersionConflict", "IllegalLeaveTransition"].includes(result.__typename))).toHaveLength(1);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.requests.nodes[0].version).toBe(2);
    });
  });

  describe("concurrent adjustments", () => {
    it("keeps two carry-over grants within the cap, refusing the one that breaks it", async () => {
      // The cap check reads the append-only log inside the transaction, so the
      // second grant sees the first. Otherwise both would pass and the member
      // would carry over more than the policy allows.
      const { staffId } = await setup({ entitlementDays: 26 });
      const leaveYear = Number(today().slice(0, 4));
      const input = { staffId, leaveYear, days: 4, reason: "carry-over", carryOver: true };

      const [a, b] = await Promise.all([
        graph({ query: ADJUST, variables: { input }, token }),
        graph({ query: ADJUST, variables: { input }, token }),
      ]);

      const outcomes = [a.body.data.adjustLeaveBalance.__typename, b.body.data.adjustLeaveBalance.__typename].sort();
      expect(outcomes).toEqual(["LeaveBalanceAdjusted", "LeaveValidationFailed"]);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.carriedOver).toBe(4);
    });

    it("refuses the negative correction that would overdraw, and applies the one that would not", async () => {
      const { staffId } = await setup({ entitlementDays: 10 });
      const leaveYear = Number(today().slice(0, 4));
      const input = { staffId, leaveYear, days: -6, reason: "clawback" };

      const [a, b] = await Promise.all([
        graph({ query: ADJUST, variables: { input }, token }),
        graph({ query: ADJUST, variables: { input }, token }),
      ]);

      const outcomes = [a.body.data.adjustLeaveBalance.__typename, b.body.data.adjustLeaveBalance.__typename].sort();
      expect(outcomes).toEqual(["InsufficientBalance", "LeaveBalanceAdjusted"]);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe("a request racing a policy change", () => {
    it("leaves the store consistent when a blackout is declared at the same moment", async () => {
      // Whichever order they land in, the outcome must be one of two coherent
      // ones — booked because the window was not there yet, or refused because it
      // was. What must never happen is a booking the policy forbids AND no record
      // of why, or a corrupted policy.
      const { staffId } = await setup({ entitlementDays: 26 });
      const week = workWeekStart();

      const [request, declare] = await Promise.all([
        graph({ query: REQUEST_LEAVE, variables: { input: { staffId, type: "ANNUAL", from: week, to: shift(week, 4) } }, token }),
        graph({
          query: `mutation D($input: BlackoutWindowInput!) {
            declareBlackout(input: $input) { __typename ... on BlackoutDeclared { blackout { from to } affectedRequests { id } } }
          }`,
          variables: { input: { from: week, to: shift(week, 4), reason: "Harvest" } },
          token,
        }),
      ]);

      expect(declare.body.data.declareBlackout.__typename).toBe("BlackoutDeclared");
      expect(["LeaveBooked", "BlackoutPeriod"]).toContain(request.body.data.requestLeave.__typename);

      // The policy survived intact, and holds exactly one window.
      const policy = await graphData({ query: "{ leavePolicy { version blackoutWindows { from to reason } } }", token });
      expect(policy.leavePolicy.blackoutWindows).toHaveLength(1);

      const data = await graphData({ query: BALANCE, variables: { staffId, asOf: today() }, token });
      expect(data.crewMember.leave.balance.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  // §14.2 puts "concurrent `issueTool`; version conflicts" in this file rather than
  // in a suite of its own, and it belongs here: it is the same claim as the leave
  // race, in a domain where the consequence is physical. Two people cannot both be
  // holding one chainsaw, and a ledger that says they are is append-only — so the row
  // is wrong permanently, and nobody is told.
  //
  // What makes it true is the same one line of design: the "is anybody holding it?"
  // scan and the append happen inside a single `store.update()` critical section with
  // a SYNCHRONOUS mutate (`tools/store.js`). The pre-flight availability check in
  // `issueTool` runs OUTSIDE that section on purpose — it is a courtesy, so an
  // unavailable tool does not cost a training-store read — which means both writers
  // reach the lock believing the tool is free. Only the in-lock re-check refuses.
  describe("concurrent tool issues (§8.5)", () => {
    const REGISTER_TOOL = `
      mutation Register($input: RegisterToolInput!) {
        registerTool(input: $input) {
          __typename
          ... on ToolRegistered { tool { id assetTag status version } }
          ... on ToolValidationFailed { fieldErrors { field message } }
        }
      }
    `;

    const ISSUE_TOOL = `
      mutation Issue($input: IssueToolInput!) {
        issueTool(input: $input) {
          __typename
          ... on ToolIssued { issuance { id staffId dueBack returnedAt } tool { id status } }
          ... on ToolUnavailable { reason currentHolder { staffId } }
          ... on ToolRequiresCertification { tool { id } requiredCertification certificationStatus }
          ... on CertificationCheckUnavailable { tool { id } requiredCertification failure detail }
          ... on MemberNotFound { staffId }
        }
      }
    `;

    const RETURN_TOOL = `
      mutation Return($input: ReturnToolInput!) {
        returnTool(input: $input) {
          __typename
          ... on ToolReturned { late tool { id status version } }
          ... on ToolNotOnIssue { status }
        }
      }
    `;

    const TOOL = `
      query Tool($id: ID!) {
        tool(id: $id) {
          id
          status
          version
          currentHolder { staffId }
          currentIssuance { id staffId }
          issuanceHistory { id staffId returnedAt conditionOnReturn }
          serviceHistory { id servicedOn }
        }
      }
    `;

    // A per-test asset tag, because the tag is unique per owner and every test in
    // this block registers one. A counter rather than a random suffix, so a failure
    // is reproducible from the test name alone.
    let tagCounter = 0;

    /** Two hired members and a tool that needs no certification. */
    async function toolAndCrew({ requiresCertification = null, serviceIntervalDays = 180 } = {}) {
      const first = await graphData({ query: HIRE_MUTATION, variables: { input: VALID_HIRE_INPUT }, token });
      const second = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Tomasz", surname: "Wisniewski" } },
        token,
      });
      expect(first.hireCrewMember.__typename).toBe("CrewMemberHired");
      expect(second.hireCrewMember.__typename).toBe("CrewMemberHired");

      const registered = await graphData({
        query: REGISTER_TOOL,
        variables: {
          input: {
            assetTag: `CHS-${(tagCounter += 1)}`,
            name: "Chainsaw MS261",
            category: "POWERED_HAND_TOOL",
            requiresCertification,
            serviceIntervalDays,
            lastServicedOn: today(),
            storageLocation: "Workshop A",
          },
        },
        token,
      });
      expect(registered.registerTool.__typename).toBe("ToolRegistered");

      return {
        toolId: registered.registerTool.tool.id,
        version: registered.registerTool.tool.version,
        staffIds: [first.hireCrewMember.crewMember.staffId, second.hireCrewMember.crewMember.staffId],
      };
    }

    const issue = (toolId, staffId, dueInDays = 3) =>
      graph({ query: ISSUE_TOOL, variables: { input: { toolId, staffId, dueBack: shift(today(), dueInDays) } }, token });

    it("issues to EXACTLY one of two concurrent callers, and the ledger agrees", async () => {
      const { toolId, staffIds } = await toolAndCrew();

      const [a, b] = await Promise.all([issue(toolId, staffIds[0]), issue(toolId, staffIds[1])]);

      const outcomes = [a.body.data.issueTool.__typename, b.body.data.issueTool.__typename].sort();
      expect(outcomes).toEqual(["ToolIssued", "ToolUnavailable"]);

      const refused = a.body.data.issueTool.__typename === "ToolUnavailable" ? a : b;
      expect(refused.body.data.issueTool.reason).toBe("ON_ISSUE");
      // The refusal names the person actually holding it, which is the answer whoever
      // wanted the chainsaw needs.
      expect(refused.body.data.issueTool.currentHolder.staffId).toBeDefined();

      // The assertion that matters: ONE row in the ledger, not two. Two answers that
      // look right while the ledger holds two open rows is the exact failure this
      // test exists to catch — and the row would be permanent.
      const data = await graphData({ query: TOOL, variables: { id: toolId }, token });
      expect(data.tool.issuanceHistory).toHaveLength(1);
      expect(data.tool.status).toBe("ON_ISSUE");
      expect(data.tool.currentIssuance.id).toBe(data.tool.issuanceHistory[0].id);
      expect(data.tool.currentHolder.staffId).toBe(data.tool.currentIssuance.staffId);
    });

    it("survives a burst of five concurrent issues with exactly one ToolIssued", async () => {
      const { toolId, staffIds } = await toolAndCrew();

      const results = await Promise.all(Array.from({ length: 5 }, (_unused, index) => issue(toolId, staffIds[index % 2])));
      const issued = results.filter((res) => res.body.data.issueTool.__typename === "ToolIssued");
      expect(issued).toHaveLength(1);

      const data = await graphData({ query: TOOL, variables: { id: toolId }, token });
      expect(data.tool.issuanceHistory).toHaveLength(1);
    });

    it("does not serialise two DIFFERENT tools into one winner", async () => {
      // The other half of the claim, and the reason the guard has to be "is THIS tool
      // free" rather than "is a write in flight": a lock that refused the second
      // writer unconditionally would pass every test above and fail this one.
      const { toolId: chainsaw, staffIds } = await toolAndCrew();
      const drill = await graphData({
        query: REGISTER_TOOL,
        variables: { input: { assetTag: "DRL-002", name: "Cordless drill", category: "POWERED_HAND_TOOL" } },
        token,
      });

      const [a, b] = await Promise.all([issue(chainsaw, staffIds[0]), issue(drill.registerTool.tool.id, staffIds[1])]);
      expect([a.body.data.issueTool.__typename, b.body.data.issueTool.__typename]).toEqual(["ToolIssued", "ToolIssued"]);
    });

    it("leaves a coherent ledger when a return and a reissue land together", async () => {
      const { toolId, staffIds } = await toolAndCrew();
      expect((await issue(toolId, staffIds[0])).body.data.issueTool.__typename).toBe("ToolIssued");

      const [returned, reissued] = await Promise.all([
        graph({ query: RETURN_TOOL, variables: { input: { toolId, condition: "GOOD" } }, token }),
        issue(toolId, staffIds[1]),
      ]);

      expect(returned.body.data.returnTool.__typename).toBe("ToolReturned");
      // Whichever order they land in, only two outcomes are coherent: the reissue got
      // in first and was refused, or the return got in first and it succeeded.
      expect(["ToolIssued", "ToolUnavailable"]).toContain(reissued.body.data.issueTool.__typename);

      const data = await graphData({ query: TOOL, variables: { id: toolId }, token });
      const open = data.tool.issuanceHistory.filter((row) => row.returnedAt === null);
      // Never two people holding it at once, whatever the interleaving.
      expect(open.length).toBeLessThanOrEqual(1);
      expect(data.tool.status).toBe(open.length === 1 ? "ON_ISSUE" : "AVAILABLE");
      expect(data.tool.currentHolder === null).toBe(open.length === 0);
    });

    it("refuses to issue a certification-controlled tool when the records cannot answer — FAIL CLOSED", async () => {
      // §8.5's cross-pillar rule end to end, and the reason it is in a concurrency
      // suite: a gate that fell open under load would fail here without any race at
      // all. No course answers to `chainsaw` in a freshly reset store, so the check
      // cannot be EVALUATED — which must refuse, not allow.
      const { toolId, staffIds } = await toolAndCrew({ requiresCertification: "chainsaw" });

      const results = await Promise.all([issue(toolId, staffIds[0]), issue(toolId, staffIds[1])]);
      for (const res of results) {
        expect(res.body.data.issueTool.__typename).toBe("CertificationCheckUnavailable");
        expect(res.body.data.issueTool.failure).toBe("COURSE_NOT_DEFINED");
      }

      // And nothing was written: the ledger is empty and the tool is still on the shelf.
      const data = await graphData({ query: TOOL, variables: { id: toolId }, token });
      expect(data.tool.issuanceHistory).toEqual([]);
      expect(data.tool.status).toBe("AVAILABLE");
    });
  });

  describe("version conflicts on a tool", () => {
    const RECORD_SERVICE = `
      mutation Service($input: RecordServiceInput!) {
        recordService(input: $input) {
          __typename
          ... on ServiceRecorded { tool { id version } }
          ... on ToolVersionConflict { toolId expectedVersion actualVersion }
        }
      }
    `;

    const RETIRE_TOOL = `
      mutation Retire($toolId: ID!, $reason: NonEmptyString!, $expectedVersion: Int) {
        retireTool(toolId: $toolId, reason: $reason, expectedVersion: $expectedVersion) {
          __typename
          ... on ToolRetired { tool { id status } }
          ... on ToolAlreadyRetired { retiredReason }
          ... on ToolVersionConflict { expectedVersion actualVersion }
        }
      }
    `;

    const REGISTER = `
      mutation Register($input: RegisterToolInput!) {
        registerTool(input: $input) { __typename ... on ToolRegistered { tool { id version } } }
      }
    `;

    async function registerTool(assetTag) {
      const result = await graphData({
        query: REGISTER,
        variables: { input: { assetTag, name: "Tractor Zetor", category: "VEHICLE", serviceIntervalDays: 90, lastServicedOn: today() } },
        token,
      });
      expect(result.registerTool.__typename).toBe("ToolRegistered");
      return result.registerTool.tool;
    }

    it("applies one of two concurrent services and reports the other as a conflict", async () => {
      // A tool has no `staffId`, so this is `ToolVersionConflict` rather than the
      // shared `VersionConflict` — the shared type's `staffId` would have nothing
      // true to put in it.
      const tool = await registerTool("TRC-100");

      const input = { toolId: tool.id, performedBy: "Workshop", expectedVersion: tool.version };
      const [a, b] = await Promise.all([
        graph({ query: RECORD_SERVICE, variables: { input }, token }),
        graph({ query: RECORD_SERVICE, variables: { input }, token }),
      ]);

      const outcomes = [a.body.data.recordService.__typename, b.body.data.recordService.__typename].sort();
      expect(outcomes).toEqual(["ServiceRecorded", "ToolVersionConflict"]);

      const conflict = a.body.data.recordService.__typename === "ToolVersionConflict" ? a : b;
      expect(conflict.body.data.recordService).toMatchObject({ expectedVersion: tool.version, actualVersion: tool.version + 1 });
    });

    it("retires once and reports the second attempt as already retired", async () => {
      const tool = await registerTool("TRC-101");

      const [a, b] = await Promise.all([
        graph({ query: RETIRE_TOOL, variables: { toolId: tool.id, reason: "beyond economic repair" }, token }),
        graph({ query: RETIRE_TOOL, variables: { toolId: tool.id, reason: "beyond economic repair" }, token }),
      ]);

      // Retirement is terminal and not repeatable, so the loser is told what happened
      // rather than being handed a version number to retry with.
      expect([a.body.data.retireTool.__typename, b.body.data.retireTool.__typename].sort()).toEqual(["ToolAlreadyRetired", "ToolRetired"]);
    });

    it("refuses a retirement carrying a stale expectedVersion", async () => {
      const tool = await registerTool("TRC-102");
      await graphData({ query: RECORD_SERVICE, variables: { input: { toolId: tool.id } }, token });

      const stale = await graphData({
        query: RETIRE_TOOL,
        variables: { toolId: tool.id, reason: "x", expectedVersion: tool.version },
        token,
      });
      expect(stale.retireTool).toMatchObject({ __typename: "ToolVersionConflict", expectedVersion: 1, actualVersion: 2 });
    });
  });
});
