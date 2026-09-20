import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

// Work pillar end to end (PRD §14.2, Phase 3).
//
// Everything here goes through the real graph endpoint and the real store, which is
// what makes the two most interesting cases meaningful: a concurrent pair of
// clashing shift plans must resolve to exactly ONE booking, and a work-log
// correction must leave the original row in the store.
//
// The `ShiftConflictsLeave` case is reachable today by injecting a stub leave
// service — the leave pillar arrives in Phase 4, and this pins the seam it has to
// satisfy rather than leaving a union member untested until then.
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

const DEFINE_DUTY = `
  mutation DefineDuty($input: DutyTypeInput!) {
    defineDutyType(input: $input) {
      __typename
      ... on DutyTypeDefined { dutyType { id code name startTime endTime hours crossesMidnight requiredRole colour } }
      ... on WorkValidationFailed { fieldErrors { field message } }
    }
  }
`;

const PLAN_SHIFT = `
  mutation PlanShift($input: PlanShiftInput!) {
    planShift(input: $input) {
      __typename
      ... on ShiftPlanned { shift { id staffId date status hours version dutyType { code } } warnings { code message } }
      ... on ShiftOverlap { conflictingShiftId }
      ... on ShiftConflictsLeave { staffId date }
      ... on MemberNotFound { staffId }
      ... on DutyTypeNotFound { dutyTypeId }
      ... on WorkValidationFailed { fieldErrors { field message } }
    }
  }
`;

const TRANSITION = (mutation) => `
  mutation Transition($shiftId: ID!, $expectedVersion: Int) {
    ${mutation}(shiftId: $shiftId, expectedVersion: $expectedVersion) {
      __typename
      ... on ShiftTransitioned { shift { id status version cancelReason } }
      ... on ShiftNotFound { shiftId }
      ... on IllegalShiftTransition { shiftId from to allowed }
      ... on VersionConflict { expectedVersion actualVersion }
    }
  }
`;

const CANCEL = `
  mutation Cancel($shiftId: ID!, $reason: String) {
    cancelShift(shiftId: $shiftId, reason: $reason) {
      __typename
      ... on ShiftTransitioned { shift { id status cancelReason } }
      ... on IllegalShiftTransition { from to allowed }
    }
  }
`;

const LOG_WORK = `
  mutation LogWork($input: LogWorkInput!) {
    logWork(input: $input) {
      __typename
      ... on WorkLogged { entry { id staffId date hours activity effective amendsId } }
      ... on MemberNotFound { staffId }
      ... on ShiftNotFound { shiftId }
      ... on WorkValidationFailed { fieldErrors { field message } }
    }
  }
`;

const AMEND = `
  mutation Amend($entryId: ID!, $hours: Float, $activity: NonEmptyString, $reason: NonEmptyString!) {
    amendWorkLog(entryId: $entryId, hours: $hours, activity: $activity, reason: $reason) {
      __typename
      ... on WorkLogAmended {
        correction { id hours activity amendsId amendedByReason effective }
        original { id hours effective }
      }
      ... on WorkLogEntryNotFound { entryId }
      ... on WorkValidationFailed { fieldErrors { field message } }
    }
  }
`;

describe("Crew Office — work pillar", () => {
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

  /** A duty type and a hired member, the starting point for most cases below. */
  async function setup({ duty = {}, hire = {} } = {}) {
    const dutyResult = await graphData({
      query: DEFINE_DUTY,
      variables: {
        input: { code: "milking_early", name: "Early milking", startTime: "05:00", endTime: "08:00", ...duty },
      },
      token,
    });
    expect(dutyResult.defineDutyType.__typename).toBe("DutyTypeDefined");

    const hireResult = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, ...hire } },
      token,
    });
    expect(hireResult.hireCrewMember.__typename).toBe("CrewMemberHired");

    return {
      dutyTypeId: dutyResult.defineDutyType.dutyType.id,
      staffId: hireResult.hireCrewMember.crewMember.staffId,
    };
  }

  describe("duty types", () => {
    it("defines one and lists it", async () => {
      const { dutyTypeId } = await setup();
      const data = await graphData({ query: "{ dutyTypes { id code name hours crossesMidnight } }", token });
      const found = data.dutyTypes.find((duty) => duty.id === dutyTypeId);
      expect(found).toMatchObject({ code: "milking_early", hours: 3, crossesMidnight: false });
    });

    it("computes hours and the midnight flag for a night watch", async () => {
      await graphData({
        query: DEFINE_DUTY,
        variables: { input: { code: "night_watch", name: "Night watch", startTime: "22:00", endTime: "06:00" } },
        token,
      });
      const data = await graphData({ query: "{ dutyTypes { code hours crossesMidnight } }", token });
      const night = data.dutyTypes.find((duty) => duty.code === "night_watch");
      expect(night).toMatchObject({ hours: 8, crossesMidnight: true });
    });

    it("refuses a duplicate code — a roster reference must be unambiguous", async () => {
      await setup();
      const data = await graphData({
        query: DEFINE_DUTY,
        variables: { input: { code: "milking_early", name: "Another one", startTime: "06:00", endTime: "09:00" } },
        token,
      });
      expect(data.defineDutyType.__typename).toBe("WorkValidationFailed");
      expect(data.defineDutyType.fieldErrors[0].field).toBe("code");
    });

    it("rejects a malformed code, time or colour as a typed failure, not an error", async () => {
      const data = await graphData({
        query: DEFINE_DUTY,
        variables: { input: { code: "Bad Code", name: "x", startTime: "5am", endTime: "08:00", colour: "green" } },
        token,
      });
      expect(data.defineDutyType.__typename).toBe("WorkValidationFailed");
      const fields = data.defineDutyType.fieldErrors.map((error) => error.field);
      expect(fields).toEqual(expect.arrayContaining(["code", "startTime", "colour"]));
    });
  });

  describe("planning shifts", () => {
    it("plans a shift and hangs it on the crew member", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } },
        token,
      });
      expect(planned.planShift.__typename).toBe("ShiftPlanned");
      expect(planned.planShift.shift).toMatchObject({ status: "PLANNED", hours: 3, date: "2026-08-03" });

      const member = await graphData({
        query: `query M($id: ID!) { crewMember(staffId: $id) { work { shifts { id status date } nextShift { date } } } }`,
        variables: { id: staffId },
        token,
      });
      expect(member.crewMember.work.shifts).toHaveLength(1);
    });

    it("warns rather than refuses when the role does not match the duty", async () => {
      // §8.2: the farm decides who covers a duty. Refusing would break the roster
      // the first time somebody stands in for a colleague.
      const { dutyTypeId, staffId } = await setup({
        duty: { requiredRole: "DAIRY_HAND" },
        hire: { role: "MECHANIC" },
      });

      const planned = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } },
        token,
      });

      // The shift IS planned. A client treating warnings as failure has misread it.
      expect(planned.planShift.__typename).toBe("ShiftPlanned");
      expect(planned.planShift.shift.status).toBe("PLANNED");
      expect(planned.planShift.warnings).toHaveLength(1);
      expect(planned.planShift.warnings[0].code).toBe("ROLE_MISMATCH");
    });

    it("refuses an overlapping shift and names the conflict", async () => {
      const { dutyTypeId, staffId } = await setup();
      await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });

      const second = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } },
        token,
      });
      expect(second.planShift.__typename).toBe("ShiftOverlap");
      expect(second.planShift.conflictingShiftId).toBeTruthy();
    });

    it("allows a handover — shifts meeting exactly at an hour do not clash", async () => {
      const { dutyTypeId, staffId } = await setup();
      const handover = await graphData({
        query: DEFINE_DUTY,
        variables: { input: { code: "midday", name: "Midday round", startTime: "08:00", endTime: "11:00" } },
        token,
      });

      await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      const second = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId: handover.defineDutyType.dutyType.id, date: "2026-08-03" } },
        token,
      });
      expect(second.planShift.__typename).toBe("ShiftPlanned");
    });

    it("catches a night watch running into the next morning's shift", async () => {
      const { staffId, dutyTypeId } = await setup();
      const night = await graphData({
        query: DEFINE_DUTY,
        variables: { input: { code: "night_watch", name: "Night watch", startTime: "22:00", endTime: "06:00" } },
        token,
      });

      await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId: night.defineDutyType.dutyType.id, date: "2026-08-03" } },
        token,
      });

      // 05:00 on the 4th falls inside the 22:00→06:00 watch that began on the 3rd.
      const morning = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-04" } },
        token,
      });
      expect(morning.planShift.__typename).toBe("ShiftOverlap");
    });

    it("frees the slot once a shift is cancelled", async () => {
      const { dutyTypeId, staffId } = await setup();
      const first = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      await graphData({ query: CANCEL, variables: { shiftId: first.planShift.shift.id, reason: "weather" }, token });

      const replacement = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } },
        token,
      });
      expect(replacement.planShift.__typename).toBe("ShiftPlanned");
    });

    it("returns MemberNotFound and DutyTypeNotFound as typed outcomes", async () => {
      const { dutyTypeId, staffId } = await setup();

      const noMember = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId: "987654", dutyTypeId, date: "2026-08-03" } },
        token,
      });
      expect(noMember.planShift.__typename).toBe("MemberNotFound");

      const noDuty = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId: "987654", date: "2026-08-03" } },
        token,
      });
      expect(noDuty.planShift.__typename).toBe("DutyTypeNotFound");
    });

    it("resolves two concurrent clashing plans to exactly ONE booking", async () => {
      // The pillar's core race. The overlap check and the insert share one
      // transaction, so the second writer sees the first writer's shift.
      const { dutyTypeId, staffId } = await setup();

      const [a, b] = await Promise.all([
        graph({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token }),
        graph({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token }),
      ]);

      const outcomes = [a.body.data.planShift.__typename, b.body.data.planShift.__typename].sort();
      expect(outcomes).toEqual(["ShiftOverlap", "ShiftPlanned"]);

      // And the store agrees: one blocking shift, not two.
      const shifts = await graphData({ query: `{ shifts(status: PLANNED) { id } }`, token });
      expect(shifts.shifts).toHaveLength(1);
    });
  });

  describe("the shift lifecycle", () => {
    it("runs planned → confirmed → completed, bumping the version each time", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      const shiftId = planned.planShift.shift.id;
      expect(planned.planShift.shift.version).toBe(1);

      const confirmed = await graphData({ query: TRANSITION("confirmShift"), variables: { shiftId }, token });
      expect(confirmed.confirmShift.shift).toMatchObject({ status: "CONFIRMED", version: 2 });

      const completed = await graphData({ query: TRANSITION("completeShift"), variables: { shiftId }, token });
      expect(completed.completeShift.shift).toMatchObject({ status: "COMPLETED", version: 3 });
    });

    it("refuses to skip confirmation, and says what IS allowed", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });

      const illegal = await graphData({
        query: TRANSITION("completeShift"),
        variables: { shiftId: planned.planShift.shift.id },
        token,
      });
      expect(illegal.completeShift.__typename).toBe("IllegalShiftTransition");
      expect(illegal.completeShift).toMatchObject({ from: "PLANNED", to: "COMPLETED" });
      expect(illegal.completeShift.allowed).toEqual(["CONFIRMED", "CANCELLED"]);
    });

    it("treats COMPLETED and CANCELLED as terminal", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      const shiftId = planned.planShift.shift.id;

      await graphData({ query: TRANSITION("confirmShift"), variables: { shiftId }, token });
      await graphData({ query: TRANSITION("completeShift"), variables: { shiftId }, token });

      const afterCompletion = await graphData({ query: CANCEL, variables: { shiftId, reason: "too late" }, token });
      expect(afterCompletion.cancelShift.__typename).toBe("IllegalShiftTransition");
      expect(afterCompletion.cancelShift.allowed).toEqual([]);
    });

    it("records a cancellation reason", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      const cancelled = await graphData({
        query: CANCEL,
        variables: { shiftId: planned.planShift.shift.id, reason: "storm forecast" },
        token,
      });
      expect(cancelled.cancelShift.shift).toMatchObject({ status: "CANCELLED", cancelReason: "storm forecast" });
    });

    it("refuses a stale expectedVersion instead of overwriting a newer transition", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      const shiftId = planned.planShift.shift.id;

      await graphData({ query: TRANSITION("confirmShift"), variables: { shiftId, expectedVersion: 1 }, token });

      const stale = await graphData({ query: TRANSITION("completeShift"), variables: { shiftId, expectedVersion: 1 }, token });
      expect(stale.completeShift.__typename).toBe("VersionConflict");
      expect(stale.completeShift).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
    });

    it("returns ShiftNotFound for an unknown shift", async () => {
      const missing = await graphData({ query: TRANSITION("confirmShift"), variables: { shiftId: "987654" }, token });
      expect(missing.confirmShift.__typename).toBe("ShiftNotFound");
    });
  });

  describe("the work log", () => {
    it("logs work against a shift and reports it on the member", async () => {
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });

      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking", shiftId: planned.planShift.shift.id } },
        token,
      });
      expect(logged.logWork.__typename).toBe("WorkLogged");
      expect(logged.logWork.entry).toMatchObject({ hours: 3, activity: "milking", effective: true, amendsId: null });

      const member = await graphData({
        query: `query M($id: ID!) {
          crewMember(staffId: $id) {
            work {
              workLog { id hours activity effective }
              weeklyRollup(weekStarting: "2026-08-03") { from to hours entries byActivity { activity hours } }
            }
          }
        }`,
        variables: { id: staffId },
        token,
      });
      expect(member.crewMember.work.weeklyRollup).toMatchObject({ from: "2026-08-03", to: "2026-08-09", hours: 3, entries: 1 });
    });

    it("accepts standalone work with no shift", async () => {
      const { staffId } = await setup();
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-04", hours: 1.5, activity: "fencing" } },
        token,
      });
      expect(logged.logWork.__typename).toBe("WorkLogged");
      expect(logged.logWork.entry.hours).toBe(1.5);
    });

    it("refuses a shift belonging to a different member", async () => {
      const { dutyTypeId, staffId } = await setup();
      const other = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Other", surname: "Person" } },
        token,
      });
      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });

      const wrong = await graphData({
        query: LOG_WORK,
        variables: {
          input: {
            staffId: other.hireCrewMember.crewMember.staffId,
            date: "2026-08-03",
            hours: 3,
            activity: "milking",
            shiftId: planned.planShift.shift.id,
          },
        },
        token,
      });
      expect(wrong.logWork.__typename).toBe("WorkValidationFailed");
      expect(wrong.logWork.fieldErrors[0].field).toBe("shiftId");
    });

    it("rejects hours outside the domain rules as a typed failure", async () => {
      const { staffId } = await setup();
      for (const hours of [0, -1, 3.1, 25]) {
        const result = await graphData({
          query: LOG_WORK,
          variables: { input: { staffId, date: "2026-08-03", hours, activity: "milking" } },
          token,
        });
        expect(result.logWork.__typename, `hours=${hours}`).toBe("WorkValidationFailed");
        expect(result.logWork.fieldErrors.map((error) => error.field)).toContain("hours");
      }
    });

    it("amends by APPENDING — the original survives and stops counting", async () => {
      const { staffId } = await setup();
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });
      const entryId = logged.logWork.entry.id;

      const amended = await graphData({
        query: AMEND,
        variables: { entryId, hours: 2.5, reason: "finished early" },
        token,
      });
      expect(amended.amendWorkLog.__typename).toBe("WorkLogAmended");
      expect(amended.amendWorkLog.correction).toMatchObject({
        hours: 2.5,
        amendsId: entryId,
        amendedByReason: "finished early",
        effective: true,
      });
      // The original is still there, and no longer counts.
      expect(amended.amendWorkLog.original).toMatchObject({ id: entryId, hours: 3, effective: false });

      const member = await graphData({
        query: `query M($id: ID!) { crewMember(staffId: $id) { work { workLog { id hours effective } weeklyRollup(weekStarting: "2026-08-03") { hours entries } } } }`,
        variables: { id: staffId },
        token,
      });
      // Two rows in the log, one logical entry, 2.5 hours.
      expect(member.crewMember.work.workLog).toHaveLength(2);
      expect(member.crewMember.work.weeklyRollup).toMatchObject({ hours: 2.5, entries: 1 });
    });

    it("requires a reason for an amendment", async () => {
      const { staffId } = await setup();
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });
      // `reason` is NonEmptyString!, so whitespace is refused by the scalar itself.
      const res = await graph({
        query: AMEND,
        variables: { entryId: logged.logWork.entry.id, hours: 2, reason: "   " },
        token,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.errors)).toMatch(/NonEmptyString/);
    });

    it("refuses to fork a chain by amending an already-amended entry", async () => {
      const { staffId } = await setup();
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });
      const entryId = logged.logWork.entry.id;
      await graphData({ query: AMEND, variables: { entryId, hours: 2.5, reason: "first correction" }, token });

      const second = await graphData({ query: AMEND, variables: { entryId, hours: 2, reason: "second" }, token });
      expect(second.amendWorkLog.__typename).toBe("WorkValidationFailed");
      expect(second.amendWorkLog.fieldErrors[0].field).toBe("entryId");
    });

    it("returns WorkLogEntryNotFound for an unknown entry", async () => {
      const missing = await graphData({ query: AMEND, variables: { entryId: "987654", hours: 1, reason: "x" }, token });
      expect(missing.amendWorkLog.__typename).toBe("WorkLogEntryNotFound");
    });
  });

  describe("the leave-pillar seam (Phase 4 must satisfy this)", () => {
    it("returns ShiftConflictsLeave when a leave service reports approved leave", async () => {
      // The leave pillar does not exist yet, so the check is exercised through the
      // documented seam: `context.services.leave.hasApprovedLeaveOn(staffId, date)`.
      // This is what makes the union member reachable — and it pins the contract
      // Phase 4 has to implement.
      const { assembleCrewSchema } = require("../services/crew/registry");
      const { createCrewContext } = require("../services/crew/context");
      const { pillars } = assembleCrewSchema();

      const { dutyTypeId, staffId } = await setup();

      const context = createCrewContext({ userId: USER_ID, pillars });
      context.services.leave = {
        hasApprovedLeaveOn: async (candidateStaffId, date) => Number(candidateStaffId) === Number(staffId) && date === "2026-08-05",
      };

      const conflicting = await context.services.work.planShift({ staffId, dutyTypeId, date: "2026-08-05" });
      expect(conflicting.outcome).toBe("CONFLICTS_LEAVE");

      // A different date is unaffected.
      const fine = await context.services.work.planShift({ staffId, dutyTypeId, date: "2026-08-06" });
      expect(fine.outcome).toBe("PLANNED");
    });

    it("skips the check silently when no leave service is assembled", async () => {
      // Until Phase 4 there is nothing to ask, so planning must proceed rather than
      // fail — the absence of a pillar is not an error.
      const { dutyTypeId, staffId } = await setup();
      const planned = await graphData({
        query: PLAN_SHIFT,
        variables: { input: { staffId, dutyTypeId, date: "2026-08-05" } },
        token,
      });
      expect(planned.planShift.__typename).toBe("ShiftPlanned");
    });
  });

  describe("isolation and the non-impact contract", () => {
    it("writes only to the crew work store — staff.json is untouched by any work mutation", async () => {
      const dbManager = require("../data/database-manager");
      const staffDb = dbManager.getStaffDatabase();
      const before = JSON.stringify(await staffDb.getAll());

      const { dutyTypeId, staffId } = await setup(); // the hire here DOES write staff
      const afterHire = JSON.stringify(await staffDb.getAll());

      const planned = await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      await graphData({ query: TRANSITION("confirmShift"), variables: { shiftId: planned.planShift.shift.id }, token });
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });
      await graphData({ query: AMEND, variables: { entryId: logged.logWork.entry.id, hours: 2.5, reason: "early" }, token });

      // Every work operation after the hire left staff.json byte-identical.
      expect(JSON.stringify(await staffDb.getAll())).toBe(afterHire);
      expect(afterHire).not.toBe(before); // sanity: the hire really did write
    });

    it("reports work rows orphaned by a staff deletion instead of crashing", async () => {
      const { dutyTypeId, staffId } = await setup();
      await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });
      await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });

      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`).expect(200);

      const res = await graph({ query: "{ orphanedOverlays { pillar staffId rowId detail } }", token });
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();

      const pillars = res.body.data.orphanedOverlays.filter((row) => row.staffId === String(staffId)).map((row) => row.pillar);
      // Both pillars notice the same missing person, each about its own rows.
      expect(pillars).toContain("work");
      expect(pillars).toContain("profiles");
    });

    it("scopes duty types and shifts to the caller", async () => {
      const { dutyTypeId, staffId } = await setup();
      await graphData({ query: PLAN_SHIFT, variables: { input: { staffId, dutyTypeId, date: "2026-08-03" } }, token });

      // A different account id, which owns nothing. Scoping is swept exhaustively
      // with two real users in crew-scoping.test.js; here it only needs to show the
      // work pillar filters like every other one.
      const stranger = tokenFor(987_654);
      const theirView = await graphData({ query: "{ dutyTypes { id code } shifts { id } }", token: stranger });
      expect(theirView.dutyTypes).toEqual([]);
      expect(theirView.shifts).toEqual([]);
    });
  });

  describe("the team-wide work log query (Phase 3C)", () => {
    it("returns rows for the whole crew in one read, not one per member", () => {
      // The board's reason for existing: `CrewMember.work.workLog` is per person, so
      // a team view would otherwise need one query per row.
      return (async () => {
        const { dutyTypeId, staffId } = await setup();
        const other = await graphData({
          query: HIRE_MUTATION,
          variables: { input: { ...VALID_HIRE_INPUT, name: "Other", surname: "Person" } },
          token,
        });
        const otherStaffId = other.hireCrewMember.crewMember.staffId;

        await graphData({ query: LOG_WORK, variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } }, token });
        await graphData({
          query: LOG_WORK,
          variables: { input: { staffId: otherStaffId, date: "2026-08-03", hours: 2, activity: "feeding" } },
          token,
        });

        const data = await graphData({ query: "{ workLog { id staffId hours activity effective } }", token });
        const staffIds = data.workLog.map((entry) => entry.staffId);
        expect(staffIds).toContain(staffId);
        expect(staffIds).toContain(otherStaffId);
        expect(dutyTypeId).toBeTruthy();
      })();
    });

    it("filters by date range, inclusive at both ends", async () => {
      const { staffId } = await setup();
      for (const [date, hours] of [
        ["2026-08-02", 1],
        ["2026-08-03", 2],
        ["2026-08-09", 3],
        ["2026-08-10", 4],
      ]) {
        await graphData({ query: LOG_WORK, variables: { input: { staffId, date, hours, activity: "fencing" } }, token });
      }

      const data = await graphData({
        query: 'query R { workLog(from: "2026-08-03", to: "2026-08-09") { date hours } }',
        token,
      });
      expect(data.workLog.map((entry) => entry.date)).toEqual(["2026-08-03", "2026-08-09"]);
    });

    it("filters by crew member", async () => {
      const { staffId } = await setup();
      const other = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Solo", surname: "Worker" } },
        token,
      });
      await graphData({ query: LOG_WORK, variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } }, token });

      const data = await graphData({
        query: "query R($id: ID!) { workLog(staffId: $id) { staffId } }",
        variables: { id: other.hireCrewMember.crewMember.staffId },
        token,
      });
      expect(data.workLog).toEqual([]);
    });

    it("INCLUDES superseded rows, flagged — the log is append-only", async () => {
      const { staffId } = await setup();
      const logged = await graphData({
        query: LOG_WORK,
        variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } },
        token,
      });
      await graphData({ query: AMEND, variables: { entryId: logged.logWork.entry.id, hours: 2.5, reason: "early" }, token });

      const data = await graphData({ query: "{ workLog { id hours effective } }", token });
      // Both rows come back; `effective` says which one counts. A board that summed
      // them all would report 5.5 hours for a 2.5-hour day.
      expect(data.workLog).toHaveLength(2);
      expect(data.workLog.filter((entry) => entry.effective)).toHaveLength(1);
    });

    it("is scoped: another account sees an empty log, not someone else's hours", async () => {
      const { staffId } = await setup();
      await graphData({ query: LOG_WORK, variables: { input: { staffId, date: "2026-08-03", hours: 3, activity: "milking" } }, token });

      const stranger = tokenFor(987_654);
      const theirView = await graphData({ query: "{ workLog { id hours } shifts { id } }", token: stranger });
      expect(theirView.workLog).toEqual([]);
      expect(theirView.shifts).toEqual([]);
    });

    it("is unreachable without a session, and 404s when the module is off", async () => {
      const anonymous = await graph({ query: "{ workLog { id } }" });
      expect(anonymous.status).toBe(401);

      await setCrewEnabled(false);
      const gated = await graph({ query: "{ workLog { id } }", token });
      expect(gated.status).toBe(404);
      await setCrewEnabled(true);
    });
  });

  describe("the pillar is part of the assembled schema", () => {
    it("appears in extensions.pillars and in the SDL", async () => {
      const res = await graph({ query: "{ crewInfo { pillars } }", token });
      expect(res.body.extensions.pillars).toContain("work");
      expect(res.body.data.crewInfo.pillars).toContain("work");

      const sdl = await request(app).get("/api/graphql/crew").set("Cookie", `rolnopolToken=${token}`).expect(200);
      expect(sdl.text).toMatch(/type WorkSummary/);
      expect(sdl.text).toMatch(/work: WorkSummary/);
      // The header lists whatever is assembled; assert work is in it rather than
      // pinning the whole list, which later pillars would break.
      const headerLine = sdl.text.split("\n").find((line) => line.includes("Assembled pillars:"));
      expect(headerLine).toBeTruthy();
      expect(headerLine).toContain("work");
    });

    it("adds no mutation that deletes a shift or a log entry", async () => {
      const data = await graphData({ query: "{ __schema { mutationType { fields { name } } } }", token });
      const names = data.__schema.mutationType.fields.map((field) => field.name);
      expect(names).toEqual(
        expect.arrayContaining(["defineDutyType", "planShift", "confirmShift", "completeShift", "cancelShift", "logWork", "amendWorkLog"]),
      );
      expect(names.some((name) => /delete|remove/i.test(name))).toBe(false);
    });
  });
});
