/**
 * Leave service (PRD §8.3) — the richest pillar, and the one with the most
 * boundary conditions.
 *
 * Scoping lives here as it does in every pillar: every read filters by the
 * context's `userId` and every write stamps it, so a future transport cannot skip
 * isolation (§9).
 *
 * Four rules to read before changing anything:
 *
 *   1. **The balance check and the append happen inside ONE transaction.** This is
 *      the module's core race (§14.4 item 4): two requests that each fit the
 *      balance but not together must resolve to exactly one booking. Checking
 *      before the transaction and writing inside it would let both pass.
 *
 *   2. **A request is measured on its LAST DAY, not on today.** Booking October's
 *      holiday in July has to be possible, and in July only half the year has
 *      accrued — so the guard asks "will this be earned by the time it is taken?"
 *      rather than "is it earned now?". This is also what keeps the balance from
 *      going negative at the end of a leave year: a booking that leans on
 *      carry-over is checked against a balance in which that carry-over has
 *      already expired if the leave falls after the expiry date.
 *
 *   3. **`workingDays` is snapshotted at submit.** A policy that later gains a
 *      public holiday must not silently re-price a holiday somebody already
 *      booked, and a balance that re-derived the cost of every historical request
 *      from today's policy would do exactly that.
 *
 *   4. **`LeaveBookedWithWarning` books the leave.** It is a success carrying an
 *      advisory — thin cover, or shifts already rostered. An implementation that
 *      returns it without writing the request has turned a warning into a silent
 *      refusal, which is the worst kind of bug: the office is told everything is
 *      fine and nobody is off.
 *
 * Nothing here is ever deleted. A pending request is WITHDRAWN, an approved one
 * is CANCELLED, corrections APPEND (§6.6).
 */
const { validationFailed, versionConflict, memberNotFound, CrewError, CREW_ERROR_CODES } = require("../../errors");
const { daysBetween, addDays } = require("../../clock");
const { getStore, read, transact } = require("./store");
const {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  LIVE_STATUSES,
  TYPE_RULES,
  roundDays,
  parseMonthDay,
  leaveYearBounds,
  isWeekend,
  isPublicHoliday,
  datesInRange,
  workingDaysFor,
  blackoutHit,
  rangesOverlap,
  computeBalance,
} = require("./accrual");

const ACCRUAL_MODES = ["monthly", "upfront"];

/**
 * The lifecycle, as data (§6.3). `cancelLeave` picks its target from the current
 * status rather than taking one, which is why both terminal states are reachable:
 * pulling a request nobody has decided yet is a WITHDRAWAL, calling off a holiday
 * that was granted is a CANCELLATION. One mutation, two honest words.
 */
const LEAVE_TRANSITIONS = {
  requested: ["approved", "rejected", "withdrawn"],
  approved: ["cancelled"],
  rejected: [],
  cancelled: [],
  withdrawn: [],
};

const MAX_ENTITLEMENT_DAYS = 60;
const MAX_CARRY_OVER_DAYS = 30;
const MAX_NOTICE_DAYS = 90;
// A single request longer than this is a career break, not a holiday, and an
// unbounded range would let one mutation walk a decade of dates.
const MAX_REQUEST_SPAN_DAYS = 180;
// A calendar wider than this is a report, not a page.
const MAX_CALENDAR_SPAN_DAYS = 400;
const MAX_ADJUSTMENT_DAYS = 60;

const DEFAULT_POLICY = {
  annualEntitlementDaysFullTime: 26,
  accrualMode: "monthly",
  carryOverCapDays: 5,
  carryOverExpiresOn: "03-31",
  leaveYearStart: "01-01",
  publicHolidays: [],
  blackoutWindows: [],
  minNoticeDays: 3,
};

/**
 * @param {object} context - the per-request context (context.js)
 * @param {object} [deps]
 * @param {object} [deps.store] - store override. The registry never passes one;
 *   `crew.leave.test.js` passes an in-memory double so the whole request
 *   lifecycle — half days, blackout, notice, every union outcome — is exercised as
 *   a unit test rather than only through HTTP. This pillar has by far the most
 *   branches of the three, and making them cost a function call instead of a
 *   round trip is what keeps the boundary sweep affordable. The seam is
 *   read-only from the pillar's point of view: nothing here behaves differently
 *   because it was passed a double.
 */
function createLeaveService(context, { store: storeOverride } = {}) {
  const store = storeOverride || getStore();
  const { userId, clock } = context;

  /** Everything this user owns, read once per request. */
  const own = context.addLoader("crewLeaveDocument", async () => {
    context.onStoreRead("crewLeave");
    const document = await read(store);
    const mine = (rows) => rows.filter((row) => Number(row.userId) === userId);
    return new Map([
      ["policy", mine(document.policies)[0] || null],
      ["requests", mine(document.requests)],
      ["adjustments", mine(document.adjustments)],
    ]);
  });

  const ownedPolicy = async () => (await own.all()).get("policy");
  const ownedRequests = async () => (await own.all()).get("requests");
  const ownedAdjustments = async () => (await own.all()).get("adjustments");

  const invalidate = () => context.resetLoaders("crewLeaveDocument");

  /** The caller's policy, or the typed error §7.3 shows as `leave: null` + errors. */
  async function requirePolicy() {
    const policy = await ownedPolicy();
    if (!policy) {
      throw new CrewError(
        CREW_ERROR_CODES.LEAVE_POLICY_MISSING,
        "No leave policy is configured, so balances cannot be computed. Set one with setLeavePolicy.",
      );
    }
    return policy;
  }

  /**
   * The member, or `MEMBER_NOT_FOUND`.
   *
   * Unknown and not-owned are the same answer on purpose (§9) — telling them
   * apart would let a caller enumerate other people's staff ids.
   *
   * `allowOrphaned` is the read/write split §12 rule 4 asks for. A member whose
   * staff record was deleted from under the overlay still has a leave history, and
   * a roster asking for it must DEGRADE rather than error — so reads tolerate the
   * orphan. Writes do not: booking a holiday for somebody who is no longer in
   * `staff.json` would create a row nothing can ever reach.
   */
  async function requireMember(staffId, { allowOrphaned = false } = {}) {
    const member = await context.services.profiles.findMember(staffId);
    if (!member) throw memberNotFound(staffId);
    if (!member.staff && !allowOrphaned) throw memberNotFound(staffId);
    return member;
  }

  const service = {
    LEAVE_TYPES,
    LEAVE_STATUSES,
    LEAVE_TRANSITIONS,
    DEFAULT_POLICY,

    // --- policy ------------------------------------------------------------

    async getPolicy() {
      return ownedPolicy();
    },

    async setPolicy(input) {
      context.assertWritableIdentity();

      const fieldErrors = validatePolicyInput(input);
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const nowIso = clock.nowIso();
      const written = await transact(store, (document) => {
        const index = document.policies.findIndex((row) => Number(row.userId) === userId);

        if (index === -1) {
          const nextId = document.counters.lastPolicyId + 1;
          const created = { id: nextId, userId, ...normalisePolicyInput(input), createdAt: nowIso, updatedAt: nowIso, version: 1 };
          return {
            document: {
              ...document,
              policies: [...document.policies, created],
              counters: { ...document.counters, lastPolicyId: nextId },
            },
            result: created,
          };
        }

        const current = document.policies[index];
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          Number(input.expectedVersion) !== Number(current.version)
        ) {
          // `staffId` in a version conflict is the record's identity; a policy has
          // none, so it reports the owner instead.
          throw versionConflict(userId, Number(input.expectedVersion), Number(current.version));
        }

        const updated = {
          ...current,
          ...normalisePolicyInput(input, current),
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };
        const policies = [...document.policies];
        policies[index] = updated;
        return { document: { ...document, policies }, result: updated };
      });

      invalidate();
      return written;
    },

    /**
     * Append a blackout window.
     *
     * Leave already APPROVED inside the window stays approved and is reported
     * back. Declaring harvest cannot un-promise a holiday: the office has to talk
     * to the person, and a mutation that silently voided their leave would be the
     * cruellest possible interpretation of a policy change.
     */
    async declareBlackout(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateRangeInput(input, { maxSpanDays: MAX_CALENDAR_SPAN_DAYS });
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);
      await requirePolicy();

      const nowIso = clock.nowIso();
      const window = { from: input.from, to: input.to, reason: input.reason ?? null };

      const result = await transact(store, (document) => {
        const index = document.policies.findIndex((row) => Number(row.userId) === userId);
        if (index === -1) {
          throw new CrewError(CREW_ERROR_CODES.LEAVE_POLICY_MISSING, "No leave policy is configured.");
        }

        const current = document.policies[index];
        const updated = {
          ...current,
          blackoutWindows: [...(current.blackoutWindows || []), window],
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };
        const policies = [...document.policies];
        policies[index] = updated;

        const affected = document.requests.filter(
          (row) => Number(row.userId) === userId && LIVE_STATUSES.includes(row.status) && rangesOverlap(window, row),
        );

        return { document: { ...document, policies }, result: { window, affected } };
      });

      invalidate();
      return result;
    },

    // --- reads -------------------------------------------------------------

    async listRequests({ status, type, staffId, from, to } = {}) {
      const requests = await ownedRequests();
      return (
        requests
          .filter((request) => (status ? request.status === status : true))
          .filter((request) => (type ? request.type === type : true))
          .filter((request) => (staffId === undefined || staffId === null ? true : Number(request.staffId) === Number(staffId)))
          // A request is in range when it OVERLAPS it, not when it is contained by
          // it: a calendar for August must show the holiday that started in July.
          .filter((request) => (from ? request.to >= from : true))
          .filter((request) => (to ? request.from <= to : true))
          .slice()
          .sort((a, b) => (a.from === b.from ? Number(a.id) - Number(b.id) : a.from.localeCompare(b.from)))
      );
    },

    async findRequest(requestId) {
      const id = Number(requestId);
      if (!Number.isInteger(id)) return null;
      return (await ownedRequests()).find((row) => Number(row.id) === id) || null;
    },

    async pendingApprovals() {
      const requests = await service.listRequests({ status: "requested" });
      // Oldest first: an approval queue is worked front to back, and sorting by
      // start date would push a request made months ago behind one made today.
      return requests.slice().sort((a, b) => Number(a.id) - Number(b.id));
    },

    async listAdjustments(staffId) {
      const rows = await ownedAdjustments();
      return rows
        .filter((row) => (staffId === undefined || staffId === null ? true : Number(row.staffId) === Number(staffId)))
        .slice()
        .sort((a, b) => Number(a.id) - Number(b.id));
    },

    /**
     * One member's balance on a date.
     *
     * Needs the profile for `fte` and `startDate`, which is why the leave pillar
     * depends on profiles: accrual is pro-rata to a contract, and there is no
     * contract in `staff.json` (§3).
     */
    async balanceFor(staffId, asOf) {
      const policy = await requirePolicy();
      // A read, so an orphaned overlay resolves rather than erroring.
      const member = await requireMember(staffId, { allowOrphaned: true });
      const numericStaffId = Number(staffId);

      return computeBalance({
        policy,
        profile: member.profile,
        requests: (await ownedRequests()).filter((row) => Number(row.staffId) === numericStaffId),
        adjustments: (await ownedAdjustments()).filter((row) => Number(row.staffId) === numericStaffId),
        asOf: asOf || clock.today(),
      });
    },

    /** The next leave that has not started yet, for the member summary. */
    async nextBooked(staffId) {
      const today = clock.today();
      const requests = await service.listRequests({ staffId });
      return (
        requests
          .filter((request) => LIVE_STATUSES.includes(request.status) && request.to >= today)
          .sort((a, b) => a.from.localeCompare(b.from))[0] || null
      );
    },

    /**
     * The work pillar's cross-pillar seam (§8.2).
     *
     * Answers "may this member be rostered on this date?". APPROVED only: a
     * pending request must not block a shift, or asking for leave would silently
     * remove someone from the roster before anyone agreed to it.
     *
     * The whole calendar span counts, weekends and half days included — somebody
     * half off is not available for a full shift, and a shift on the Saturday in
     * the middle of a fortnight off is not what anyone meant either.
     */
    async hasApprovedLeaveOn(staffId, date) {
      const numericStaffId = Number(staffId);
      const requests = await ownedRequests();
      return requests.some(
        (request) =>
          Number(request.staffId) === numericStaffId && request.status === "approved" && request.from <= date && request.to >= date,
      );
    },

    /** Everyone off on a date, with names, for the calendar and the absence board. */
    async absencesOn(date) {
      const requests = await ownedRequests();
      const staffById = await context.loaders.staffById.all();

      return requests
        .filter((request) => LIVE_STATUSES.includes(request.status) && request.from <= date && request.to >= date)
        .map((request) => {
          const staff = staffById.get(Number(request.staffId)) || null;
          return {
            staffId: String(request.staffId),
            name: staff?.name ?? null,
            surname: staff?.surname ?? null,
            type: request.type,
            status: request.status,
            requestId: String(request.id),
            halfDay: (request.halfDayStart && request.from === date) || (request.halfDayEnd && request.to === date),
          };
        })
        .sort((a, b) => Number(a.staffId) - Number(b.staffId));
    },

    async calendar({ from, to }) {
      const fieldErrors = validateRangeInput({ from, to }, { maxSpanDays: MAX_CALENDAR_SPAN_DAYS });
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const policy = await ownedPolicy();
      const days = [];
      for (const date of datesInRange(from, to, { limit: MAX_CALENDAR_SPAN_DAYS })) {
        const blackout = (policy?.blackoutWindows || []).find((window) => date >= window.from && date <= window.to);
        days.push({
          date,
          weekend: isWeekend(date),
          publicHoliday: isPublicHoliday(policy, date),
          blackoutReason: blackout ? (blackout.reason ?? "Blackout period") : null,
          absences: await service.absencesOn(date),
        });
      }
      return days;
    },

    async teamAbsence(date) {
      const absent = await service.absencesOn(date);
      const staffRecords = await context.loaders.ownedStaff.get();
      const absentIds = new Set(absent.map((row) => Number(row.staffId)));
      return {
        date,
        absent,
        availableCount: staffRecords.filter((staff) => !absentIds.has(Number(staff.id))).length,
      };
    },

    // --- requesting leave --------------------------------------------------

    /**
     * Ask for leave.
     *
     * Returns an outcome object for the six answers a caller can act on, and
     * THROWS for the two that are not answers: an unknown member and a malformed
     * input. That split is what keeps `RequestLeaveResult` at exactly the six
     * members §8.3 specifies (see the SDL note).
     */
    async requestLeave(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateRequestInput(input);
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const policy = await requirePolicy();
      const member = await requireMember(input.staffId);
      if (!member.profile) {
        // Accrual is pro-rata to a contract, and there is no contract here yet.
        throw validationFailed(
          [{ field: "staffId", message: "This crew member has no employment profile, so no entitlement can be computed." }],
          "Cannot request leave without an employment profile.",
        );
      }

      const rules = TYPE_RULES[input.type];
      const today = clock.today();

      // A request spanning two leave years has two different balances, two
      // different carry-over deadlines and no single answer to "which year did
      // that come out of?". Refused, with the fix named.
      const startYear = leaveYearBounds(policy, input.from);
      const endYear = leaveYearBounds(policy, input.to);
      if (!startYear || !endYear || startYear.leaveYear !== endYear.leaveYear) {
        throw validationFailed([
          {
            field: "to",
            message: `A request cannot span two leave years — split it at ${endYear ? endYear.from : "the leave-year boundary"}.`,
          },
        ]);
      }

      const { workingDays, days: chargeableDays } = workingDaysFor(policy, input);
      if (workingDays <= 0) {
        throw validationFailed([
          { field: "from", message: "That period has no chargeable days — it is entirely weekends and public holidays." },
        ]);
      }

      // Notice. Skipping this check for a type is exactly what permits a
      // retrospective entry, which is why sick leave has no notice rule.
      if (rules.requiresNotice) {
        const notice = daysBetween(today, input.from);
        const minNotice = Number(policy.minNoticeDays) || 0;
        if (notice === null || notice < minNotice) {
          return {
            outcome: "INSUFFICIENT_NOTICE",
            minNoticeDays: minNotice,
            requestedStart: input.from,
            earliestStart: addDays(today, minNotice),
          };
        }
      }

      if (rules.honoursBlackout) {
        const hit = blackoutHit(policy, chargeableDays);
        if (hit) {
          return {
            outcome: "BLACKOUT",
            from: hit.window.from,
            to: hit.window.to,
            reason: hit.window.reason ?? null,
            firstClash: hit.date,
          };
        }
      }

      // Advisories, gathered BEFORE the transaction. They are advice, not
      // decisions, so reading them from a snapshot taken a moment earlier cannot
      // make an answer wrong — it can only make a warning slightly stale.
      const warnings = await coverageWarnings(input);

      const nowIso = clock.nowIso();
      const numericStaffId = Number(input.staffId);
      const asOf = input.to;

      const result = await transact(store, (document) => {
        const mine = document.requests.filter((row) => Number(row.userId) === userId && Number(row.staffId) === numericStaffId);

        // Overlap first: being in two places at once is a harder no than being
        // out of days, and reporting the overlap is more useful than reporting a
        // shortfall caused by it.
        const clash = mine.find((row) => LIVE_STATUSES.includes(row.status) && rangesOverlap(row, input));
        if (clash) {
          return {
            document,
            result: { outcome: "OVERLAPS", conflictingRequestId: String(clash.id), from: clash.from, to: clash.to },
          };
        }

        // The balance, recomputed inside the critical section against the
        // freshest document — rule 1. Measured on the request's last day —
        // rule 2.
        if (rules.consumesBalance) {
          const before = computeBalance({
            policy,
            profile: member.profile,
            requests: mine,
            adjustments: document.adjustments.filter((row) => Number(row.userId) === userId && Number(row.staffId) === numericStaffId),
            asOf,
          });

          if (!before || before.remaining < workingDays) {
            const remaining = before ? before.remaining : 0;
            return {
              document,
              result: {
                outcome: "INSUFFICIENT_BALANCE",
                requested: workingDays,
                remaining,
                shortfall: roundDays(workingDays - remaining),
                asOf,
              },
            };
          }
        }

        const nextId = document.counters.lastRequestId + 1;
        const request = {
          id: nextId,
          userId,
          staffId: numericStaffId,
          type: input.type,
          from: input.from,
          to: input.to,
          halfDayStart: Boolean(input.halfDayStart),
          halfDayEnd: Boolean(input.halfDayEnd),
          // Snapshotted — rule 3.
          workingDays,
          status: "requested",
          reason: input.reason ?? null,
          decidedBy: null,
          decidedAt: null,
          createdAt: nowIso,
          version: 1,
        };

        return {
          document: {
            ...document,
            requests: [...document.requests, request],
            counters: { ...document.counters, lastRequestId: nextId },
          },
          // Rule 4: the request is in the document either way. A warning rides
          // along with the success; it never replaces it.
          result: { outcome: warnings.length > 0 ? "BOOKED_WITH_WARNING" : "BOOKED", request, warnings },
        };
      });

      if (result.outcome === "BOOKED" || result.outcome === "BOOKED_WITH_WARNING") {
        invalidate();
        result.balance = await service.balanceFor(numericStaffId, asOf);
      }
      return result;
    },

    /**
     * Move a request through its lifecycle.
     *
     * One function for approve/reject/cancel because the rules differ only in the
     * target state and in whether the balance is re-checked. Three near-copies
     * would be three places for the transition table to drift.
     */
    async decide({ requestId, to, reason, expectedVersion }) {
      context.assertWritableIdentity();

      if (!LEAVE_STATUSES.includes(to)) {
        throw validationFailed([{ field: "status", message: `Unknown leave status "${to}".` }]);
      }
      if (to === "rejected" && (typeof reason !== "string" || reason.trim().length === 0)) {
        // A rejection without a reason is the message "no" with no way to
        // respond to it.
        return { outcome: "VALIDATION_FAILED", fieldErrors: [{ field: "reason", message: "A rejection needs a reason." }] };
      }

      const policy = await ownedPolicy();
      const numericRequestId = Number(requestId);
      const nowIso = clock.nowIso();

      // The profile the approval's balance re-check needs, fetched HERE because
      // the transaction body is synchronous by design (store.js) and cannot await
      // a loader. Null when the request is unknown, which the transaction reports
      // as REQUEST_NOT_FOUND before the profile is ever used.
      const existing = await service.findRequest(requestId);
      const profile = existing ? (await context.services.profiles.findMember(existing.staffId))?.profile || null : null;

      const result = await transact(store, (document) => {
        const index = document.requests.findIndex((row) => Number(row.id) === numericRequestId && Number(row.userId) === userId);
        if (index === -1) return { document, result: { outcome: "REQUEST_NOT_FOUND", requestId: String(requestId) } };

        const current = document.requests[index];

        // `cancelLeave` resolves its own target: pending ⇒ withdrawn, approved ⇒
        // cancelled. Resolution happens here, inside the transaction, so it
        // cannot be decided against a status that has since changed.
        const target = to === "cancelled" && current.status === "requested" ? "withdrawn" : to;

        const allowed = LEAVE_TRANSITIONS[current.status] || [];
        if (!allowed.includes(target)) {
          return {
            document,
            result: { outcome: "ILLEGAL_TRANSITION", requestId: String(requestId), from: current.status, to: target, allowed },
          };
        }

        if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(current.version)) {
          throw versionConflict(current.staffId, Number(expectedVersion), Number(current.version));
        }

        // Approval re-checks the balance. A request that fit when it was made can
        // stop fitting — an earlier request approved since, a negative
        // adjustment, carry-over that expired — and approving into an overdraft
        // is how a balance goes negative without anybody breaking a rule.
        if (target === "approved" && policy && TYPE_RULES[current.type]?.consumesBalance) {
          // Everything EXCEPT this request, so the check asks "does what is
          // already committed leave room for this?" rather than double-counting it.
          const siblings = document.requests.filter(
            (row) =>
              Number(row.userId) === userId && Number(row.staffId) === Number(current.staffId) && Number(row.id) !== numericRequestId,
          );
          const check = computeBalance({
            policy,
            profile,
            requests: siblings,
            adjustments: document.adjustments.filter(
              (row) => Number(row.userId) === userId && Number(row.staffId) === Number(current.staffId),
            ),
            asOf: current.to,
          });
          if (check && check.remaining < Number(current.workingDays)) {
            return {
              document,
              result: {
                outcome: "INSUFFICIENT_BALANCE",
                requested: Number(current.workingDays),
                remaining: check.remaining,
                shortfall: roundDays(Number(current.workingDays) - check.remaining),
                asOf: current.to,
              },
            };
          }
        }

        const updated = {
          ...current,
          status: target,
          // A supplied reason always replaces the requester's note, and none
          // always keeps it. Rejections require one; cancellations and
          // withdrawals may carry one; approvals never do. Deciding per target
          // status is how a withdrawal's reason got silently dropped.
          reason: reason === undefined || reason === null ? current.reason : reason,
          decidedBy: userId,
          decidedAt: nowIso,
          version: Number(current.version) + 1,
        };
        const requests = [...document.requests];
        requests[index] = updated;
        return { document: { ...document, requests }, result: { outcome: "DECIDED", request: updated } };
      });

      if (result.outcome === "DECIDED") {
        invalidate();
        try {
          result.balance = await service.balanceFor(result.request.staffId, clock.today());
        } catch (error) {
          // A missing policy must not turn a successful decision into an error.
          // The decision stands; the balance is simply absent.
          result.balance = null;
        }
      }
      return result;
    },

    // --- adjustments -------------------------------------------------------

    /**
     * Append a manual correction or a carry-over grant (§6.3).
     *
     * Append-only: a wrong correction is answered with an opposite one, so the
     * reason a balance moved is always readable off the log.
     */
    async adjustBalance(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateAdjustmentInput(input);
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const policy = await requirePolicy();
      const member = await requireMember(input.staffId);

      const numericStaffId = Number(input.staffId);
      const leaveYear = Number(input.leaveYear);
      const days = Number(input.days);
      const kind = input.carryOver ? "carry_over_grant" : "manual";
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const mineFor = (rows) => rows.filter((row) => Number(row.userId) === userId && Number(row.staffId) === numericStaffId);
        const adjustments = mineFor(document.adjustments);

        if (kind === "carry_over_grant") {
          const cap = Number(policy.carryOverCapDays) || 0;
          const granted = adjustments
            .filter((row) => row.kind === "carry_over_grant" && Number(row.leaveYear) === leaveYear)
            .reduce((total, row) => total + (Number(row.days) || 0), 0);
          if (granted + days > cap) {
            // Refused rather than clamped: a grant that silently shrinks looks
            // like a bug the next time somebody reconciles the log against the
            // balance.
            return {
              document,
              result: {
                outcome: "VALIDATION_FAILED",
                fieldErrors: [
                  {
                    field: "days",
                    message: `Carry-over for ${leaveYear} would reach ${roundDays(granted + days)} days, above the ${cap}-day cap.`,
                  },
                ],
              },
            };
          }
        }

        // A negative correction may not overdraw the year. Measured at the leave
        // year's END, which is the strictest point: everything that will ever
        // accrue has accrued, and any carry-over has already expired.
        if (days < 0) {
          const yearBounds = leaveYearBounds(policy, `${leaveYear}-06-15`);
          const after = computeBalance({
            policy,
            profile: member.profile,
            requests: mineFor(document.requests),
            adjustments: [...adjustments, { staffId: numericStaffId, leaveYear, days, kind }],
            asOf: yearBounds ? yearBounds.to : `${leaveYear}-12-31`,
          });
          if (after && after.remaining < 0) {
            return {
              document,
              result: {
                outcome: "INSUFFICIENT_BALANCE",
                requested: Math.abs(days),
                remaining: roundDays(after.remaining - days),
                shortfall: roundDays(-after.remaining),
                asOf: yearBounds ? yearBounds.to : `${leaveYear}-12-31`,
              },
            };
          }
        }

        const nextId = document.counters.lastAdjustmentId + 1;
        const row = {
          id: nextId,
          userId,
          staffId: numericStaffId,
          leaveYear,
          days,
          kind,
          reason: String(input.reason).trim(),
          createdBy: userId,
          createdAt: nowIso,
        };
        return {
          document: {
            ...document,
            adjustments: [...document.adjustments, row],
            counters: { ...document.counters, lastAdjustmentId: nextId },
          },
          result: { outcome: "ADJUSTED", adjustment: row },
        };
      });

      if (result.outcome === "ADJUSTED") {
        invalidate();
        const yearBounds = leaveYearBounds(policy, `${leaveYear}-06-15`);
        result.balance = await service.balanceFor(numericStaffId, yearBounds ? yearBounds.from : clock.today());
      }
      return result;
    },

    /** Rows referencing a staff member who no longer exists (§12 rule 4). */
    async findOrphanedOverlays() {
      const staffRecords = await context.loaders.ownedStaff.get();
      const live = new Set(staffRecords.map((staff) => Number(staff.id)));

      const orphans = [];
      for (const request of await ownedRequests()) {
        if (live.has(Number(request.staffId))) continue;
        orphans.push({
          staffId: String(request.staffId),
          rowId: String(request.id),
          detail: `Leave request ${request.id} references a deleted staff record.`,
        });
      }
      for (const adjustment of await ownedAdjustments()) {
        if (live.has(Number(adjustment.staffId))) continue;
        orphans.push({
          staffId: String(adjustment.staffId),
          rowId: String(adjustment.id),
          detail: `Leave adjustment ${adjustment.id} references a deleted staff record.`,
        });
      }
      return orphans;
    },
  };

  /**
   * Advisories for a request that is otherwise fine (rule 4).
   *
   * Both are cross-cutting facts the office wants to know and neither is a reason
   * to refuse: the farm decides whether it can spare somebody.
   */
  async function coverageWarnings(input) {
    const warnings = [];

    // Somebody else already off on one of these days.
    const others = (await ownedRequests()).filter(
      (row) => Number(row.staffId) !== Number(input.staffId) && LIVE_STATUSES.includes(row.status) && rangesOverlap(row, input),
    );
    if (others.length > 0) {
      const staffRecords = await context.loaders.ownedStaff.get();
      const distinct = new Set(others.map((row) => Number(row.staffId)));
      warnings.push({
        code: "COVERAGE_THIN",
        message:
          `${distinct.size} other crew member${distinct.size === 1 ? " is" : "s are"} already off in that period` +
          ` (${staffRecords.length} on the roster).`,
      });
    }

    // Shifts already rostered in the period. Guarded on the work pillar being
    // assembled: a cross-pillar advisory must not become a hard dependency, or
    // the leave pillar would stop working the moment work failed to load.
    const workService = context.services.work;
    if (workService && typeof workService.listShifts === "function") {
      const shifts = await workService.listShifts({ staffId: input.staffId, from: input.from, to: input.to });
      const blocking = shifts.filter((shift) => shift.status === "PLANNED" || shift.status === "CONFIRMED");
      if (blocking.length > 0) {
        warnings.push({
          code: "SHIFTS_ROSTERED",
          message: `${blocking.length} shift${blocking.length === 1 ? " is" : "s are"} already rostered between ${input.from} and ${input.to}.`,
        });
      }
    }

    return warnings;
  }

  return service;
}

// --- pure helpers -----------------------------------------------------------
// Kept free of `context` so the whole validation matrix is unit-testable without
// building a request.

function normalisePolicyInput(input, current = null) {
  const pick = (key, fallback) => (input[key] === undefined || input[key] === null ? fallback : input[key]);
  const base = current || DEFAULT_POLICY;
  return {
    annualEntitlementDaysFullTime: Number(pick("annualEntitlementDaysFullTime", base.annualEntitlementDaysFullTime)),
    accrualMode: pick("accrualMode", base.accrualMode),
    carryOverCapDays: Number(pick("carryOverCapDays", base.carryOverCapDays)),
    // Explicitly nullable: a policy with no expiry keeps carried-over days for
    // the whole leave year, which is a real choice and not a missing value.
    carryOverExpiresOn: input.carryOverExpiresOn === undefined ? base.carryOverExpiresOn : input.carryOverExpiresOn,
    leaveYearStart: pick("leaveYearStart", base.leaveYearStart),
    publicHolidays: [...new Set(pick("publicHolidays", base.publicHolidays) || [])].sort(),
    blackoutWindows: (pick("blackoutWindows", base.blackoutWindows) || []).map((window) => ({
      from: window.from,
      to: window.to,
      reason: window.reason ?? null,
    })),
    minNoticeDays: Number(pick("minNoticeDays", base.minNoticeDays)),
  };
}

function validatePolicyInput(input) {
  const fieldErrors = [];
  const normalised = normalisePolicyInput(input);

  const entitlement = normalised.annualEntitlementDaysFullTime;
  if (!Number.isFinite(entitlement) || entitlement < 0 || entitlement > MAX_ENTITLEMENT_DAYS) {
    fieldErrors.push({
      field: "annualEntitlementDaysFullTime",
      message: `annualEntitlementDaysFullTime must be between 0 and ${MAX_ENTITLEMENT_DAYS}.`,
    });
  } else if (Math.round(entitlement * 2) !== entitlement * 2) {
    fieldErrors.push({ field: "annualEntitlementDaysFullTime", message: "annualEntitlementDaysFullTime must be in 0.5 steps." });
  }

  if (!ACCRUAL_MODES.includes(normalised.accrualMode)) {
    fieldErrors.push({ field: "accrualMode", message: `accrualMode must be one of ${ACCRUAL_MODES.join(", ")}.` });
  }

  const cap = normalised.carryOverCapDays;
  if (!Number.isFinite(cap) || cap < 0 || cap > MAX_CARRY_OVER_DAYS) {
    fieldErrors.push({ field: "carryOverCapDays", message: `carryOverCapDays must be between 0 and ${MAX_CARRY_OVER_DAYS}.` });
  }

  // Day 1–28 only: every one of the twelve month slices of a leave year has to
  // exist in February too (accrual.js).
  if (parseMonthDay(normalised.leaveYearStart, { maxDay: 28 }) === null) {
    fieldErrors.push({ field: "leaveYearStart", message: "leaveYearStart must be MM-DD with a day between 01 and 28." });
  }

  if (normalised.carryOverExpiresOn !== null && normalised.carryOverExpiresOn !== undefined) {
    if (parseMonthDay(normalised.carryOverExpiresOn) === null) {
      // 02-29 is rejected in parseMonthDay: an expiry date that does not exist in
      // three years out of four is a bug waiting for a non-leap year.
      fieldErrors.push({ field: "carryOverExpiresOn", message: "carryOverExpiresOn must be MM-DD, and 02-29 is not accepted." });
    }
  }

  const notice = normalised.minNoticeDays;
  if (!Number.isInteger(notice) || notice < 0 || notice > MAX_NOTICE_DAYS) {
    fieldErrors.push({ field: "minNoticeDays", message: `minNoticeDays must be a whole number between 0 and ${MAX_NOTICE_DAYS}.` });
  }

  for (const window of normalised.blackoutWindows) {
    if (typeof window.from !== "string" || typeof window.to !== "string" || window.from > window.to) {
      fieldErrors.push({ field: "blackoutWindows", message: "Each blackout window needs a from date at or before its to date." });
      break;
    }
  }

  return fieldErrors;
}

function validateRangeInput({ from, to }, { maxSpanDays }) {
  const fieldErrors = [];
  if (typeof from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    fieldErrors.push({ field: "from", message: "from is required as YYYY-MM-DD." });
  }
  if (typeof to !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    fieldErrors.push({ field: "to", message: "to is required as YYYY-MM-DD." });
  }
  if (fieldErrors.length > 0) return fieldErrors;

  const span = daysBetween(from, to);
  if (span === null || span < 0) {
    fieldErrors.push({ field: "to", message: "to must be on or after from." });
  } else if (span + 1 > maxSpanDays) {
    fieldErrors.push({ field: "to", message: `That range covers ${span + 1} days; the maximum is ${maxSpanDays}.` });
  }
  return fieldErrors;
}

function validateRequestInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.staffId))) fieldErrors.push({ field: "staffId", message: "staffId is required." });
  if (!LEAVE_TYPES.includes(input.type)) {
    fieldErrors.push({ field: "type", message: `type must be one of ${LEAVE_TYPES.join(", ")}.` });
  }
  fieldErrors.push(...validateRangeInput(input, { maxSpanDays: MAX_REQUEST_SPAN_DAYS }));
  if (input.reason !== undefined && input.reason !== null && String(input.reason).length > 500) {
    fieldErrors.push({ field: "reason", message: "reason must be at most 500 characters." });
  }
  return fieldErrors;
}

function validateAdjustmentInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.staffId))) fieldErrors.push({ field: "staffId", message: "staffId is required." });

  const leaveYear = Number(input.leaveYear);
  if (!Number.isInteger(leaveYear) || leaveYear < 2000 || leaveYear > 2100) {
    fieldErrors.push({ field: "leaveYear", message: "leaveYear must be a four-digit year between 2000 and 2100." });
  }

  const days = Number(input.days);
  if (!Number.isFinite(days) || days === 0) {
    fieldErrors.push({ field: "days", message: "days must be a non-zero number." });
  } else if (Math.abs(days) > MAX_ADJUSTMENT_DAYS) {
    fieldErrors.push({ field: "days", message: `days must be within ${MAX_ADJUSTMENT_DAYS} of zero.` });
  } else if (Math.round(days * 2) !== days * 2) {
    fieldErrors.push({ field: "days", message: "days must be in 0.5 steps." });
  }

  if (input.carryOver && days < 0) {
    // A negative carry-over grant is a manual correction wearing the wrong label,
    // and it would confuse the expiry arithmetic in accrual.js.
    fieldErrors.push({ field: "days", message: "A carry-over grant cannot be negative — use a manual correction instead." });
  }

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    fieldErrors.push({ field: "reason", message: "An adjustment needs a reason." });
  }
  return fieldErrors;
}

module.exports = {
  createLeaveService,
  normalisePolicyInput,
  validatePolicyInput,
  validateRangeInput,
  validateRequestInput,
  validateAdjustmentInput,
  LEAVE_TRANSITIONS,
  ACCRUAL_MODES,
  DEFAULT_POLICY,
  MAX_ENTITLEMENT_DAYS,
  MAX_CARRY_OVER_DAYS,
  MAX_NOTICE_DAYS,
  MAX_REQUEST_SPAN_DAYS,
  MAX_CALENDAR_SPAN_DAYS,
  MAX_ADJUSTMENT_DAYS,
};
