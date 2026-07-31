import { describe, it, expect } from "vitest";

// Leave request lifecycle (PRD §14.1, §8.3).
//
// Driven at the SERVICE layer against an in-memory store double, for two reasons.
// The pillar has by far the most branches of the three — six request outcomes, a
// five-state lifecycle, five leave types with different rules, and a balance that
// has to be recomputed inside a transaction — and a round trip per branch would
// make the sweep too expensive to keep. And scoping and validation live in the
// service by design (§9), so this is the layer where they can be proven without a
// transport being able to flatter them.
//
// The end-to-end path through the real graph and the real store is
// `tests/crew-leave.test.js`; the races are `tests/crew-leave-race.test.js`.
//
// The single most important assertion in this file is the one about
// `LeaveBookedWithWarning`: it must BOOK. A warning that silently blocks is the
// shape the PRD calls out as a bug, because the office is told everything is fine
// and nobody is off.
const { createLeaveService } = require("../../services/crew/pillars/leave/service");
const { DEFAULT_DATA } = require("../../services/crew/pillars/leave/store");
const { CREW_ERROR_CODES, CrewError } = require("../../services/crew/errors");

const TODAY = "2026-07-30";
const NOW_ISO = "2026-07-30T09:00:00.000Z";
const USER_ID = 1;

const POLICY_INPUT = {
  annualEntitlementDaysFullTime: 26,
  accrualMode: "monthly",
  carryOverCapDays: 5,
  carryOverExpiresOn: "03-31",
  leaveYearStart: "01-01",
  publicHolidays: ["2026-05-01", "2026-11-11", "2026-12-25"],
  blackoutWindows: [{ from: "2026-08-15", to: "2026-09-15", reason: "Harvest" }],
  minNoticeDays: 3,
};

/** An in-memory stand-in for a JSONDatabase: same two methods the store uses. */
function makeStoreDouble(initial = DEFAULT_DATA) {
  let data = clone(initial);
  return {
    async getAll() {
      return clone(data);
    },
    async update(mutate) {
      data = mutate(clone(data));
      return data;
    },
    /** Test-only: what is actually on "disk" right now. */
    snapshot() {
      return clone(data);
    },
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * A context with real loader semantics — lazy, per-request, resettable — because
 * the service leans on `resetLoaders` after every write and a stub that ignored
 * it would hide exactly the staleness bug loaders.js warns about.
 */
function makeContext({ userId = USER_ID, staff = [], profiles = {}, work = null, today = TODAY } = {}) {
  const loaders = {};
  const reads = [];

  const makeLoader = (load) => {
    let promise = null;
    return {
      all: () => (promise = promise || load()),
      get: async (key) => (await (promise = promise || load())).get(key),
      reset: () => {
        promise = null;
      },
    };
  };

  const staffById = new Map(staff.map((record) => [Number(record.id), record]));

  const context = {
    userId,
    hasWritableIdentity: Number.isFinite(userId),
    assertWritableIdentity() {
      if (!this.hasWritableIdentity) throw new CrewError(CREW_ERROR_CODES.UNAUTHENTICATED, "no usable account id");
    },
    clock: { today: () => today, nowIso: () => NOW_ISO },
    pillars: ["profiles", "leave"],
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead: (name) => reads.push(name),
    loaders: {
      ownedStaff: { get: async () => staff },
      staffById: makeLoader(async () => staffById),
    },
    addLoader(name, load) {
      if (!loaders[name]) loaders[name] = makeLoader(load);
      return loaders[name];
    },
    resetLoaders(...names) {
      for (const name of names) loaders[name]?.reset();
    },
    reads,
  };

  // The profiles service the leave pillar depends on, reduced to the one method
  // it actually calls — and matching its ORPHAN behaviour exactly: a profile with
  // no staff record resolves to `{ staff: null, profile }` rather than to null,
  // which is what distinguishes "deleted from under the overlay" from "unknown".
  context.services.profiles = {
    async findMember(staffId) {
      const id = Number(staffId);
      const record = staffById.get(id) || null;
      const profile = profiles[id] ?? null;
      if (!record && !profile) return null;
      return { staffId: id, staff: record, profile };
    },
  };
  if (work) context.services.work = work;

  return context;
}

const STAFF = [
  { id: 3, userId: USER_ID, name: "Marek", surname: "Nowak", age: 41 },
  { id: 4, userId: USER_ID, name: "Ala", surname: "Zielinska", age: 29 },
];

const FULL_TIME = { fte: 1.0, startDate: "2026-01-01", endDate: null, role: "STOCKPERSON" };

/** A service with a policy already set, which is the starting point for most cases. */
async function setup({ policy = POLICY_INPUT, profiles, work, today, initial } = {}) {
  const store = makeStoreDouble(initial);
  const context = makeContext({ staff: STAFF, profiles: profiles ?? { 3: FULL_TIME, 4: FULL_TIME }, work, today });
  const service = createLeaveService(context, { store });
  context.services.leave = service;
  if (policy) await service.setPolicy(policy);
  return { service, store, context };
}

/** Mon 5 Oct → Fri 9 Oct 2026: five clean working days, well past the notice rule. */
const OCTOBER_WEEK = { from: "2026-10-05", to: "2026-10-09" };

const request = (overrides = {}) => ({ staffId: 3, type: "annual", ...OCTOBER_WEEK, ...overrides });

/** Assert a promise rejects with a CrewError carrying a given code. */
async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("leave policy", () => {
  it("creates a policy on first call and versions it on the next", async () => {
    const { service } = await setup();
    const policy = await service.getPolicy();
    expect(policy).toMatchObject({ annualEntitlementDaysFullTime: 26, accrualMode: "monthly", version: 1 });

    const updated = await service.setPolicy({ ...POLICY_INPUT, minNoticeDays: 7 });
    expect(updated).toMatchObject({ minNoticeDays: 7, version: 2 });
  });

  it("refuses a stale expectedVersion rather than overwriting a newer write", async () => {
    const { service } = await setup();
    await expectCode(service.setPolicy({ ...POLICY_INPUT, expectedVersion: 99 }), CREW_ERROR_CODES.VERSION_CONFLICT);
  });

  it.each([
    [{ annualEntitlementDaysFullTime: 61 }, "annualEntitlementDaysFullTime"],
    [{ annualEntitlementDaysFullTime: 26.3 }, "annualEntitlementDaysFullTime"],
    [{ accrualMode: "quarterly" }, "accrualMode"],
    [{ carryOverCapDays: 99 }, "carryOverCapDays"],
    [{ leaveYearStart: "01-31" }, "leaveYearStart"],
    [{ leaveYearStart: "nonsense" }, "leaveYearStart"],
    [{ carryOverExpiresOn: "02-29" }, "carryOverExpiresOn"],
    [{ minNoticeDays: -1 }, "minNoticeDays"],
    [{ minNoticeDays: 2.5 }, "minNoticeDays"],
    [{ blackoutWindows: [{ from: "2026-09-15", to: "2026-08-15" }] }, "blackoutWindows"],
  ])("rejects %o naming the field", async (patch, field) => {
    const { service } = await setup({ policy: null });
    await expect(service.setPolicy({ ...POLICY_INPUT, ...patch })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VALIDATION_FAILED,
      extensions: { fieldErrors: expect.arrayContaining([expect.objectContaining({ field })]) },
    });
  });

  it("accepts a policy with no carry-over expiry at all", async () => {
    const { service } = await setup({ policy: { ...POLICY_INPUT, carryOverExpiresOn: null } });
    expect((await service.getPolicy()).carryOverExpiresOn).toBeNull();
  });

  it("deduplicates and sorts public holidays, so a double entry cannot double-count", async () => {
    const { service } = await setup({ policy: { ...POLICY_INPUT, publicHolidays: ["2026-05-01", "2026-01-01", "2026-05-01"] } });
    expect((await service.getPolicy()).publicHolidays).toEqual(["2026-01-01", "2026-05-01"]);
  });

  it("refuses a balance until a policy exists — never answers zero", async () => {
    // §7.3: "not configured" and "no days left" are different statements, and
    // answering the second to the first question is how a payroll query lies.
    const { service } = await setup({ policy: null });
    await expectCode(service.balanceFor(3, TODAY), CREW_ERROR_CODES.LEAVE_POLICY_MISSING);
  });
});

describe("requesting leave — the happy path", () => {
  it("books a request as REQUESTED with the cost snapshotted", async () => {
    const { service, store } = await setup();
    const result = await service.requestLeave(request());

    expect(result.outcome).toBe("BOOKED");
    expect(result.request).toMatchObject({ status: "requested", workingDays: 5, version: 1, userId: USER_ID });
    // It is genuinely in the store, not merely in the answer.
    expect(store.snapshot().requests).toHaveLength(1);
  });

  it("reports the balance the request leaves behind", async () => {
    const { service } = await setup();
    const before = await service.balanceFor(3, "2026-10-09");
    const result = await service.requestLeave(request());
    expect(result.balance.booked).toBe(5);
    expect(result.balance.remaining).toBe(before.remaining - 5);
  });

  it("charges 4.5 days for a week with a half day at the end", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request({ halfDayEnd: true }));
    expect(result.request.workingDays).toBe(4.5);
    expect(result.request.halfDayEnd).toBe(true);
  });

  it("charges half a day for a single day flagged at both ends", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request({ from: "2026-10-05", to: "2026-10-05", halfDayStart: true, halfDayEnd: true }));
    expect(result.request.workingDays).toBe(0.5);
  });

  it("does not charge for the public holiday inside the period", async () => {
    // 9–13 November 2026: five weekdays, but the 11th is Independence Day.
    const { service } = await setup();
    const result = await service.requestLeave(request({ from: "2026-11-09", to: "2026-11-13" }));
    expect(result.request.workingDays).toBe(4);
  });

  it("keeps the snapshotted cost when the policy later gains a holiday", async () => {
    // A policy change must not re-price a holiday somebody already booked.
    const { service } = await setup();
    const result = await service.requestLeave(request());
    await service.setPolicy({ ...POLICY_INPUT, publicHolidays: [...POLICY_INPUT.publicHolidays, "2026-10-07"] });
    expect((await service.findRequest(result.request.id)).workingDays).toBe(5);
  });

  it("stamps the caller's userId, never one from input", async () => {
    const { service } = await setup();
    const result = await service.requestLeave({ ...request(), userId: 999 });
    expect(result.request.userId).toBe(USER_ID);
  });
});

describe("requesting leave — the refusals", () => {
  it("refuses when the balance does not cover the request, and says by how much", async () => {
    const { service } = await setup({ policy: { ...POLICY_INPUT, annualEntitlementDaysFullTime: 5 } });
    const result = await service.requestLeave(request());

    expect(result.outcome).toBe("INSUFFICIENT_BALANCE");
    expect(result.requested).toBe(5);
    expect(result.shortfall).toBe(result.requested - result.remaining);
    // Measured on the request's LAST day, not on today.
    expect(result.asOf).toBe("2026-10-09");
  });

  it("measures the balance on the request's last day, so forward planning works", async () => {
    // The case this rule exists for: in July only about half the year has
    // accrued, but December's holiday will be earned by December. A guard using
    // today's accrual would refuse every autumn booking made in the summer.
    const { service } = await setup();
    const july = await service.balanceFor(3, TODAY);
    expect(july.accrued).toBeLessThan(26);

    const december = await service.requestLeave(request({ from: "2026-12-07", to: "2026-12-18" }));
    expect(december.outcome).toBe("BOOKED");
    expect(december.request.workingDays).toBe(10);
  });

  it("refuses a period overlapping a live request and names the clash", async () => {
    const { service } = await setup();
    const first = await service.requestLeave(request());
    const second = await service.requestLeave(request({ from: "2026-10-08", to: "2026-10-14" }));

    expect(second.outcome).toBe("OVERLAPS");
    expect(second.conflictingRequestId).toBe(String(first.request.id));
  });

  it("treats periods that merely touch as an overlap, because leave days are inclusive", async () => {
    const { service } = await setup();
    await service.requestLeave(request());
    const touching = await service.requestLeave(request({ from: "2026-10-09", to: "2026-10-13" }));
    expect(touching.outcome).toBe("OVERLAPS");
  });

  it("lets the day AFTER an existing request be booked", async () => {
    const { service } = await setup();
    await service.requestLeave(request());
    expect((await service.requestLeave(request({ from: "2026-10-12", to: "2026-10-14" }))).outcome).toBe("BOOKED");
  });

  it("does not treat another member's leave as an overlap", async () => {
    const { service } = await setup();
    await service.requestLeave(request({ staffId: 3 }));
    const other = await service.requestLeave(request({ staffId: 4 }));
    // A warning, yes — a refusal, no.
    expect(other.outcome).toBe("BOOKED_WITH_WARNING");
  });

  it("ignores a rejected or withdrawn request when checking overlaps", async () => {
    const { service } = await setup();
    const first = await service.requestLeave(request());
    await service.decide({ requestId: first.request.id, to: "rejected", reason: "cover needed" });
    expect((await service.requestLeave(request())).outcome).toBe("BOOKED");
  });

  it("refuses a chargeable day inside a blackout window and names the first clash", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request({ from: "2026-08-31", to: "2026-09-04" }));

    expect(result.outcome).toBe("BLACKOUT");
    expect(result.reason).toBe("Harvest");
    expect(result.firstClash).toBe("2026-08-31");
  });

  it("allows a request whose only overlap with a blackout is a weekend", async () => {
    const { service } = await setup({
      policy: { ...POLICY_INPUT, blackoutWindows: [{ from: "2026-10-10", to: "2026-10-11", reason: "Show" }] },
    });
    // Thu 8 – Sun 11 October: the blackout covers only the Saturday and Sunday.
    expect((await service.requestLeave(request({ from: "2026-10-08", to: "2026-10-11" }))).outcome).toBe("BOOKED");
  });

  it("refuses a request made with too little notice and names the earliest start", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request({ from: "2026-07-31", to: "2026-07-31" }));

    expect(result.outcome).toBe("INSUFFICIENT_NOTICE");
    expect(result.minNoticeDays).toBe(3);
    expect(result.earliestStart).toBe("2026-08-02");
  });

  it("accepts a request starting exactly on the notice boundary", async () => {
    // Exactly `minNoticeDays` out must pass; one day earlier must not. An
    // off-by-one here silently costs everybody a day of flexibility.
    const { service } = await setup();
    expect((await service.requestLeave(request({ from: "2026-08-02", to: "2026-08-03" }))).outcome).toBe("BOOKED");

    const { service: other } = await setup();
    expect((await other.requestLeave(request({ from: "2026-08-01", to: "2026-08-03" }))).outcome).toBe("INSUFFICIENT_NOTICE");
  });

  it("refuses annual leave dated in the past, via the notice rule", async () => {
    const { service } = await setup();
    expect((await service.requestLeave(request({ from: "2026-07-01", to: "2026-07-03" }))).outcome).toBe("INSUFFICIENT_NOTICE");
  });
});

describe("requesting leave — the errors that are NOT union members", () => {
  // §8.3 fixes `RequestLeaveResult` at six members. An unknown member and a
  // malformed input are errors with a code (§15) rather than a seventh and eighth
  // member, so "the outcomes of asking for leave" stays a list a client can
  // exhaust.

  it("throws MEMBER_NOT_FOUND for an unknown staff id", async () => {
    const { service } = await setup();
    await expectCode(service.requestLeave(request({ staffId: 999 })), CREW_ERROR_CODES.MEMBER_NOT_FOUND);
  });

  it("throws MEMBER_NOT_FOUND — not FORBIDDEN — for another user's staff id", async () => {
    // Existence is not disclosed (§9): telling the two apart would let a caller
    // enumerate other people's staff ids.
    const store = makeStoreDouble();
    const context = makeContext({ staff: STAFF, profiles: { 3: FULL_TIME } });
    const service = createLeaveService(context, { store });
    context.services.leave = service;
    await service.setPolicy(POLICY_INPUT);

    // Staff record 7 exists for somebody else, so this context cannot see it.
    await expectCode(service.requestLeave(request({ staffId: 7 })), CREW_ERROR_CODES.MEMBER_NOT_FOUND);
  });

  it("throws when the member has no employment profile — accrual needs a contract", async () => {
    const { service } = await setup({ profiles: {} });
    await expect(service.requestLeave(request())).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VALIDATION_FAILED,
      extensions: { fieldErrors: [expect.objectContaining({ field: "staffId" })] },
    });
  });

  it("throws LEAVE_POLICY_MISSING when nothing is configured", async () => {
    const { service } = await setup({ policy: null });
    await expectCode(service.requestLeave(request()), CREW_ERROR_CODES.LEAVE_POLICY_MISSING);
  });

  it("refuses a period that is entirely weekends and public holidays", async () => {
    const { service } = await setup();
    await expect(service.requestLeave(request({ from: "2026-10-10", to: "2026-10-11" }))).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it("refuses a request spanning two leave years, and says where to split it", async () => {
    // Two leave years means two balances, two carry-over deadlines and no single
    // answer to "which year did that come out of?".
    const { service } = await setup();
    await expect(service.requestLeave(request({ from: "2026-12-28", to: "2027-01-08" }))).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VALIDATION_FAILED,
      extensions: { fieldErrors: [expect.objectContaining({ field: "to", message: expect.stringContaining("2027-01-01") })] },
    });
  });

  it.each([
    [{ to: "2026-10-01" }, "to"],
    [{ from: "05/10/2026" }, "from"],
    [{ type: "sabbatical" }, "type"],
    [{ staffId: "abc" }, "staffId"],
    [{ from: "2026-10-05", to: "2027-09-01" }, "to"],
  ])("rejects %o naming the field", async (patch, field) => {
    const { service } = await setup();
    await expect(service.requestLeave(request(patch))).rejects.toMatchObject({
      extensions: { fieldErrors: expect.arrayContaining([expect.objectContaining({ field })]) },
    });
  });

  it("refuses to write anything on behalf of a session with no usable account id", async () => {
    const store = makeStoreDouble();
    const context = makeContext({ userId: NaN, staff: STAFF, profiles: { 3: FULL_TIME } });
    const service = createLeaveService(context, { store });
    context.services.leave = service;
    await expectCode(service.setPolicy(POLICY_INPUT), CREW_ERROR_CODES.UNAUTHENTICATED);
  });
});

describe("LeaveBookedWithWarning — a success that carries advice", () => {
  it("BOOKS the leave when cover is thin", async () => {
    // The assertion the PRD singles out. A warning that silently blocks is the
    // planted-bug shape: the office is told everything is fine and nobody is off.
    const { service, store } = await setup();
    await service.requestLeave(request({ staffId: 4 }));

    const result = await service.requestLeave(request({ staffId: 3 }));
    expect(result.outcome).toBe("BOOKED_WITH_WARNING");
    expect(result.warnings.map((warning) => warning.code)).toContain("COVERAGE_THIN");

    // The proof: the request is in the store, and the balance moved.
    expect(store.snapshot().requests.filter((row) => Number(row.staffId) === 3)).toHaveLength(1);
    expect(result.balance.booked).toBe(5);
  });

  it("warns about shifts already rostered in the period, and still books", async () => {
    const shifts = [{ id: 11, staffId: 3, date: "2026-10-06", status: "CONFIRMED" }];
    const { service } = await setup({ work: { listShifts: async () => shifts } });

    const result = await service.requestLeave(request());
    expect(result.outcome).toBe("BOOKED_WITH_WARNING");
    expect(result.warnings.map((warning) => warning.code)).toContain("SHIFTS_ROSTERED");
    expect(result.request.status).toBe("requested");
  });

  it("does not warn about cancelled shifts", async () => {
    const shifts = [{ id: 11, staffId: 3, date: "2026-10-06", status: "CANCELLED" }];
    const { service } = await setup({ work: { listShifts: async () => shifts } });
    expect((await service.requestLeave(request())).outcome).toBe("BOOKED");
  });

  it("works with no work pillar assembled at all — an advisory is not a dependency", async () => {
    const { service } = await setup({ work: null });
    expect((await service.requestLeave(request())).outcome).toBe("BOOKED");
  });
});

describe("leave types", () => {
  it("records sick leave retrospectively, with no notice and no blackout", async () => {
    // A fever gives no warning, and a system that refuses to record yesterday
    // simply never records it (§17 Q4).
    const { service } = await setup();
    const result = await service.requestLeave(request({ type: "sick", from: "2026-07-27", to: "2026-07-28" }));
    expect(result.outcome).toBe("BOOKED");
    expect(result.request.type).toBe("sick");
  });

  it("does not deduct sick leave from the annual balance", async () => {
    const { service } = await setup();
    const before = await service.balanceFor(3, "2026-12-31");
    const sick = await service.requestLeave(request({ type: "sick", from: "2026-07-27", to: "2026-07-28" }));
    await service.decide({ requestId: sick.request.id, to: "approved" });
    const after = await service.balanceFor(3, "2026-12-31");

    expect(after.remaining).toBe(before.remaining);
    expect(after.taken).toBe(0);
    // But it IS counted, in its own bucket — the §17 Q4 decision is pinned rather
    // than lost, so "does sickness cost me a holiday?" has an answer in the data.
    expect(after.byType.find((row) => row.type === "sick").taken).toBe(2);
  });

  it("records sick leave during a blackout window", async () => {
    const { service } = await setup();
    expect((await service.requestLeave(request({ type: "sick", from: "2026-09-01", to: "2026-09-02" }))).outcome).toBe("BOOKED");
  });

  it("still refuses sick leave overlapping existing leave — nobody is off twice", async () => {
    const { service } = await setup();
    await service.requestLeave(request());
    expect((await service.requestLeave(request({ type: "sick" }))).outcome).toBe("OVERLAPS");
  });

  it("applies notice and blackout to unpaid leave, and no balance", async () => {
    const { service } = await setup();
    expect((await service.requestLeave(request({ type: "unpaid", from: "2026-09-01", to: "2026-09-02" }))).outcome).toBe("BLACKOUT");

    const { service: fresh } = await setup({ policy: { ...POLICY_INPUT, annualEntitlementDaysFullTime: 0 } });
    // Zero annual entitlement, but unpaid leave has no budget to exhaust.
    expect((await fresh.requestLeave(request({ type: "unpaid" }))).outcome).toBe("BOOKED");
  });

  it("exempts bereavement leave from notice but not from blackout rules it shares", async () => {
    const { service } = await setup();
    expect((await service.requestLeave(request({ type: "bereavement", from: "2026-07-29", to: "2026-07-30" }))).outcome).toBe("BOOKED");
  });
});

describe("the request lifecycle", () => {
  async function booked(overrides) {
    const context = await setup();
    const result = await context.service.requestLeave(request(overrides));
    expect(result.outcome).toBe("BOOKED");
    return { ...context, requestId: result.request.id, request: result.request };
  }

  it("approves a pending request, bumping the version", async () => {
    const { service, requestId } = await booked();
    const result = await service.decide({ requestId, to: "approved" });
    expect(result.outcome).toBe("DECIDED");
    expect(result.request).toMatchObject({ status: "approved", version: 2, decidedBy: USER_ID, decidedAt: NOW_ISO });
  });

  it("rejects a pending request, keeping the reason", async () => {
    const { service, requestId } = await booked();
    const result = await service.decide({ requestId, to: "rejected", reason: "harvest cover" });
    expect(result.request).toMatchObject({ status: "rejected", reason: "harvest cover" });
  });

  it("refuses a rejection with no reason — 'no' with no way to respond to it", async () => {
    const { service, requestId } = await booked();
    const result = await service.decide({ requestId, to: "rejected" });
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(result.fieldErrors[0].field).toBe("reason");
  });

  it("WITHDRAWS a pending request when it is cancelled", async () => {
    // Two terminal words for two different events: pulling a request nobody has
    // decided yet is a withdrawal.
    const { service, requestId } = await booked();
    const result = await service.decide({ requestId, to: "cancelled" });
    expect(result.request.status).toBe("withdrawn");
  });

  it("CANCELS an approved request when it is cancelled", async () => {
    const { service, requestId } = await booked();
    await service.decide({ requestId, to: "approved" });
    const result = await service.decide({ requestId, to: "cancelled", reason: "plans changed" });
    expect(result.request.status).toBe("cancelled");
  });

  it("frees the days again when leave is cancelled", async () => {
    const { service, requestId } = await booked();
    const before = await service.balanceFor(3, "2026-12-31");
    await service.decide({ requestId, to: "approved" });
    await service.decide({ requestId, to: "cancelled" });
    expect((await service.balanceFor(3, "2026-12-31")).remaining).toBe(before.remaining + 5);
  });

  it("keeps a reason given on a withdrawal or a cancellation", async () => {
    const pending = await booked();
    const withdrawn = await pending.service.decide({ requestId: pending.requestId, to: "cancelled", reason: "changed my mind" });
    expect(withdrawn.request).toMatchObject({ status: "withdrawn", reason: "changed my mind" });
  });

  it("keeps the requester's own note when a decision carries no reason", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request({ reason: "family wedding" }));
    const approved = await service.decide({ requestId: result.request.id, to: "approved" });
    expect(approved.request.reason).toBe("family wedding");
  });

  it("keeps the row when a request is withdrawn — nothing is ever deleted", async () => {
    const { service, store, requestId } = await booked();
    await service.decide({ requestId, to: "cancelled" });
    expect(store.snapshot().requests).toHaveLength(1);
    expect(store.snapshot().requests[0].status).toBe("withdrawn");
  });

  it.each([
    ["approved", "approved"],
    ["rejected", "approved"],
    ["cancelled", "approved"],
  ])("refuses to move a %s request to %s, listing what is allowed", async (first, second) => {
    const { service, requestId } = await booked();
    await service.decide({ requestId, to: first === "cancelled" ? "approved" : first, reason: "r" });
    if (first === "cancelled") await service.decide({ requestId, to: "cancelled" });

    const result = await service.decide({ requestId, to: second, reason: "r" });
    expect(result.outcome).toBe("ILLEGAL_TRANSITION");
    expect(result.allowed).not.toContain(second);
  });

  it("reports a request that does not exist rather than throwing", async () => {
    const { service } = await setup();
    expect(await service.decide({ requestId: 999, to: "approved" })).toMatchObject({ outcome: "REQUEST_NOT_FOUND" });
  });

  it("refuses a decision made against a stale version", async () => {
    const { service, requestId } = await booked();
    await expectCode(service.decide({ requestId, to: "approved", expectedVersion: 99 }), CREW_ERROR_CODES.VERSION_CONFLICT);
  });

  it("re-checks the balance at APPROVAL, not only at request time", async () => {
    // A request that fit when it was made can stop fitting: a negative adjustment
    // since, or an earlier request approved since. Approving into an overdraft is
    // how a balance goes negative without anybody breaking a rule.
    const { service } = await setup();
    const first = await service.requestLeave(request());
    expect(first.outcome).toBe("BOOKED");

    // Take the room away underneath it. The correction is legal — the leave year
    // as a whole still balances — but by 9 October only part of the year has
    // accrued, and that is the date this request is measured on.
    const clawback = await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: -16, reason: "correction" });
    expect(clawback.outcome).toBe("ADJUSTED");

    const approval = await service.decide({ requestId: first.request.id, to: "approved" });
    expect(approval.outcome).toBe("INSUFFICIENT_BALANCE");
    expect((await service.findRequest(first.request.id)).status).toBe("requested");
  });

  it("does not re-check the balance for a type that has none", async () => {
    const { service } = await setup({ policy: { ...POLICY_INPUT, annualEntitlementDaysFullTime: 0 } });
    const sick = await service.requestLeave(request({ type: "sick", from: "2026-07-28", to: "2026-07-29" }));
    expect((await service.decide({ requestId: sick.request.id, to: "approved" })).outcome).toBe("DECIDED");
  });
});

describe("balance adjustments", () => {
  it("appends a manual correction and moves the balance", async () => {
    const { service, store } = await setup();
    const before = await service.balanceFor(3, "2026-12-31");
    const result = await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 2, reason: "goodwill day" });

    expect(result.outcome).toBe("ADJUSTED");
    expect(result.adjustment).toMatchObject({ kind: "manual", days: 2, reason: "goodwill day", createdBy: USER_ID });
    expect((await service.balanceFor(3, "2026-12-31")).remaining).toBe(before.remaining + 2);
    expect(store.snapshot().adjustments).toHaveLength(1);
  });

  it("grants carry-over as its own kind, with its own expiry", async () => {
    const { service } = await setup();
    const result = await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 4, reason: "2025 carry-over", carryOver: true });
    expect(result.adjustment.kind).toBe("carry_over_grant");

    // On the deadline the days are there; the day after, they are not.
    expect((await service.balanceFor(3, "2026-03-31")).carriedOver).toBe(4);
    expect((await service.balanceFor(3, "2026-04-01")).carriedOver).toBe(0);
  });

  it("refuses a carry-over grant that would break the cap, rather than clamping it", async () => {
    // A grant that silently shrinks looks like a bug the next time somebody
    // reconciles the append-only log against the balance.
    const { service } = await setup();
    await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 4, reason: "carry-over", carryOver: true });
    const result = await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 4, reason: "more", carryOver: true });

    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(result.fieldErrors[0].message).toContain("cap");
  });

  it("refuses a negative correction that would overdraw the leave year", async () => {
    // Measured at the leave year's END, which is the strictest point: everything
    // that will ever accrue has accrued and any carry-over has already expired.
    // 26 days earned, 5 booked, so a 25-day clawback leaves the year 4 short.
    const { service } = await setup();
    await service.requestLeave(request());
    const result = await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: -25, reason: "clawback" });

    expect(result.outcome).toBe("INSUFFICIENT_BALANCE");
    // Nothing was appended.
    expect(await service.listAdjustments(3)).toHaveLength(0);
  });

  it("allows a negative correction that still leaves the year solvent", async () => {
    const { service } = await setup();
    expect((await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: -2, reason: "over-credited" })).outcome).toBe("ADJUSTED");
  });

  it.each([
    [{ days: 0 }, "days"],
    [{ days: 0.3 }, "days"],
    [{ days: 999 }, "days"],
    [{ days: -1, carryOver: true }, "days"],
    [{ reason: "  " }, "reason"],
    [{ leaveYear: 1066 }, "leaveYear"],
  ])("rejects %o naming the field", async (patch, field) => {
    const { service } = await setup();
    await expect(service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 1, reason: "reason", ...patch })).rejects.toMatchObject({
      extensions: { fieldErrors: expect.arrayContaining([expect.objectContaining({ field })]) },
    });
  });

  it("throws MEMBER_NOT_FOUND for a staff id the caller does not own", async () => {
    const { service } = await setup();
    await expectCode(service.adjustBalance({ staffId: 999, leaveYear: 2026, days: 1, reason: "x" }), CREW_ERROR_CODES.MEMBER_NOT_FOUND);
  });
});

describe("declaring a blackout", () => {
  it("appends the window and versions the policy", async () => {
    const { service } = await setup();
    const result = await service.declareBlackout({ from: "2026-10-01", to: "2026-10-31", reason: "Stocktake" });
    expect(result.window).toMatchObject({ reason: "Stocktake" });
    expect((await service.getPolicy()).version).toBe(2);
  });

  it("blocks later requests in the window", async () => {
    const { service } = await setup();
    await service.declareBlackout({ from: "2026-10-01", to: "2026-10-31", reason: "Stocktake" });
    expect((await service.requestLeave(request())).outcome).toBe("BLACKOUT");
  });

  it("leaves leave already APPROVED inside the window alone, and reports it", async () => {
    // Declaring harvest cannot un-promise a holiday. A mutation that silently
    // voided somebody's approved leave would be the cruellest reading of a policy
    // change; the office is told instead, and has the conversation.
    const { service } = await setup();
    const existing = await service.requestLeave(request());
    await service.decide({ requestId: existing.request.id, to: "approved" });

    const result = await service.declareBlackout({ from: "2026-10-01", to: "2026-10-31", reason: "Stocktake" });
    expect(result.affected.map((row) => row.id)).toEqual([existing.request.id]);
    expect((await service.findRequest(existing.request.id)).status).toBe("approved");
  });

  it("refuses a backwards window", async () => {
    const { service } = await setup();
    await expect(service.declareBlackout({ from: "2026-10-31", to: "2026-10-01" })).rejects.toMatchObject({
      extensions: { fieldErrors: [expect.objectContaining({ field: "to" })] },
    });
  });

  it("refuses to declare anything without a policy", async () => {
    const { service } = await setup({ policy: null });
    await expectCode(service.declareBlackout({ from: "2026-10-01", to: "2026-10-31" }), CREW_ERROR_CODES.LEAVE_POLICY_MISSING);
  });
});

describe("reads across the crew", () => {
  it("lists pending approvals oldest first", async () => {
    // An approval queue is worked front to back; sorting by start date would push
    // a request made months ago behind one made today.
    const { service } = await setup();
    const later = await service.requestLeave(request({ staffId: 3, from: "2026-12-07", to: "2026-12-08" }));
    const earlier = await service.requestLeave(request({ staffId: 4, from: "2026-10-05", to: "2026-10-06" }));

    expect((await service.pendingApprovals()).map((row) => row.id)).toEqual([later.request.id, earlier.request.id]);
  });

  it("drops a request from the queue once it is decided", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request());
    await service.decide({ requestId: result.request.id, to: "approved" });
    expect(await service.pendingApprovals()).toHaveLength(0);
  });

  it("includes a request that merely OVERLAPS the range, not only one inside it", async () => {
    // A calendar for October must show the holiday that started in September.
    const { service } = await setup();
    await service.requestLeave(request({ from: "2026-09-28", to: "2026-10-02" }));
    expect(await service.listRequests({ from: "2026-10-01", to: "2026-10-31" })).toHaveLength(1);
  });

  it("builds a calendar day by day, flagging weekends, holidays and blackouts", async () => {
    const { service } = await setup();
    await service.requestLeave(request());
    const days = await service.calendar({ from: "2026-10-03", to: "2026-10-06" });

    expect(days.map((day) => day.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(days[0].weekend).toBe(true);
    expect(days[2].absences).toHaveLength(1);
    expect(days[2].absences[0]).toMatchObject({ staffId: "3", name: "Marek", type: "annual", status: "requested" });
  });

  it("marks the half day on the calendar day it actually falls on", async () => {
    const { service } = await setup();
    await service.requestLeave(request({ halfDayEnd: true }));
    const days = await service.calendar({ from: "2026-10-05", to: "2026-10-09" });
    expect(days[0].absences[0].halfDay).toBe(false);
    expect(days[4].absences[0].halfDay).toBe(true);
  });

  it("flags a blackout day with its reason", async () => {
    const { service } = await setup();
    const days = await service.calendar({ from: "2026-09-01", to: "2026-09-01" });
    expect(days[0].blackoutReason).toBe("Harvest");
  });

  it("refuses a calendar range wider than the cap", async () => {
    const { service } = await setup();
    await expect(service.calendar({ from: "2026-01-01", to: "2028-01-01" })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it("counts who is available on a date", async () => {
    const { service } = await setup();
    await service.requestLeave(request({ staffId: 3 }));
    const absence = await service.teamAbsence("2026-10-06");
    expect(absence.absent).toHaveLength(1);
    expect(absence.availableCount).toBe(STAFF.length - 1);
  });

  it("finds the next leave that has not finished yet", async () => {
    const { service } = await setup();
    await service.requestLeave(request({ from: "2026-12-07", to: "2026-12-08" }));
    const soon = await service.requestLeave(request({ from: "2026-10-05", to: "2026-10-06" }));
    expect((await service.nextBooked(3)).id).toBe(soon.request.id);
  });

  it("does not offer a rejected request as the next booked leave", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request());
    await service.decide({ requestId: result.request.id, to: "rejected", reason: "cover" });
    expect(await service.nextBooked(3)).toBeNull();
  });
});

describe("the work pillar's cross-pillar seam", () => {
  it("reports APPROVED leave on a date", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request());
    expect(await service.hasApprovedLeaveOn(3, "2026-10-06")).toBe(false);

    await service.decide({ requestId: result.request.id, to: "approved" });
    expect(await service.hasApprovedLeaveOn(3, "2026-10-06")).toBe(true);
  });

  it("does NOT report a pending request — asking for leave must not empty the roster", async () => {
    const { service } = await setup();
    await service.requestLeave(request());
    expect(await service.hasApprovedLeaveOn(3, "2026-10-06")).toBe(false);
  });

  it("covers the weekend in the middle of a fortnight off", async () => {
    // A shift on the Saturday in the middle of somebody's fortnight is not what
    // anyone meant, even though that Saturday cost them nothing.
    const { service } = await setup();
    const result = await service.requestLeave(request({ from: "2026-10-05", to: "2026-10-16" }));
    await service.decide({ requestId: result.request.id, to: "approved" });
    expect(await service.hasApprovedLeaveOn(3, "2026-10-10")).toBe(true);
  });

  it("says no for a member with no leave, and for the day after leave ends", async () => {
    const { service } = await setup();
    const result = await service.requestLeave(request());
    await service.decide({ requestId: result.request.id, to: "approved" });
    expect(await service.hasApprovedLeaveOn(4, "2026-10-06")).toBe(false);
    expect(await service.hasApprovedLeaveOn(3, "2026-10-12")).toBe(false);
  });
});

describe("orphaned overlays (§12 rule 4)", () => {
  it("reports nothing while the staff records are all there", async () => {
    const { service } = await setup();
    await service.requestLeave(request({ staffId: 3 }));
    await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 1, reason: "goodwill" });
    expect(await service.findOrphanedOverlays()).toHaveLength(0);
  });

  it("reports requests and adjustments whose staff record has been deleted", async () => {
    // Exactly what `DELETE /api/v1/staff/3` leaves behind: overlay rows pointing
    // at an id that is gone. The module must SEE them rather than crash on them —
    // this is the path the base entity's owner controls, and §14.4 calls it the
    // most likely real crash.
    const { service } = await setup();
    await service.requestLeave(request({ staffId: 3 }));
    await service.adjustBalance({ staffId: 3, leaveYear: 2026, days: 1, reason: "goodwill" });

    // Rebuild the service over the same rows with staff 3 no longer in staff.json.
    const survivingStore = makeStoreDouble((await setupSnapshotOf(service)) || undefined);
    const context = makeContext({ staff: STAFF.filter((record) => record.id !== 3), profiles: { 4: FULL_TIME } });
    const orphaned = createLeaveService(context, { store: survivingStore });
    context.services.leave = orphaned;

    const orphans = await orphaned.findOrphanedOverlays();
    expect(orphans).toHaveLength(2);
    expect(orphans.map((row) => row.staffId)).toEqual(["3", "3"]);
    expect(orphans.map((row) => row.detail)).toEqual([
      expect.stringContaining("Leave request"),
      expect.stringContaining("Leave adjustment"),
    ]);
  });

  it("still resolves a balance for an orphan — a READ degrades rather than erroring", async () => {
    // §12 rule 4. The leave history of somebody whose staff record was deleted is
    // still real, and a roster asking for it must not fail. Writes are the other
    // way round — see below.
    const { service } = await setup();
    await service.requestLeave(request({ staffId: 3 }));

    const survivingStore = makeStoreDouble(await setupSnapshotOf(service));
    const context = makeContext({ staff: STAFF.filter((record) => record.id !== 3), profiles: { 3: FULL_TIME } });
    const orphaned = createLeaveService(context, { store: survivingStore });
    context.services.leave = orphaned;

    const balance = await orphaned.balanceFor(3, "2026-12-31");
    expect(balance.booked).toBe(5);
  });

  it("refuses a WRITE for an orphan — a row nothing can reach is worse than a refusal", async () => {
    const { service } = await setup();
    const survivingStore = makeStoreDouble(await setupSnapshotOf(service));
    const context = makeContext({ staff: STAFF.filter((record) => record.id !== 3), profiles: { 3: FULL_TIME } });
    const orphaned = createLeaveService(context, { store: survivingStore });
    context.services.leave = orphaned;

    await expectCode(orphaned.requestLeave(request({ staffId: 3 })), CREW_ERROR_CODES.MEMBER_NOT_FOUND);
  });

  /** Read a service's whole document back out, for rebuilding it over new staff. */
  async function setupSnapshotOf(service) {
    return {
      policies: [{ id: 1, userId: USER_ID, ...POLICY_INPUT, createdAt: NOW_ISO, updatedAt: NOW_ISO, version: 1 }],
      requests: await service.listRequests(),
      adjustments: await service.listAdjustments(),
      counters: { lastPolicyId: 1, lastRequestId: 1, lastAdjustmentId: 1 },
    };
  }
});
