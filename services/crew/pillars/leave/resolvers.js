/**
 * Leave resolvers (PRD §8.3).
 *
 * Thin, like the two pillars before it: take arguments, call the per-request
 * service, shape the answer into a union member. No scoping and no validation
 * here — those live in the service so a different transport cannot skip them (§9).
 *
 * This file also owns the ONE translation the pillar needs: the store speaks
 * lower_snake_case (`"annual"`, `"requested"`) because that is what §6.3 writes to
 * disk, and the graph speaks SCREAMING_CASE because that is what a GraphQL enum
 * is. Doing it in exactly one place — here, at the transport boundary — is why the
 * domain never has to know which vocabulary it is in, and why a stored value can
 * never leak out as an invalid enum.
 */
const { CrewError, CREW_ERROR_CODES } = require("../../errors");

/** `"ANNUAL"` → `"annual"`. Undefined and null pass through untouched. */
const toStoreEnum = (value) => (typeof value === "string" ? value.toLowerCase() : value);

/** `"annual"` → `"ANNUAL"`. */
const toGraphEnum = (value) => (typeof value === "string" ? value.toUpperCase() : value);

/** Map a thrown CrewError onto a leave union member, or rethrow if it is not ours. */
function toUnionMember(error) {
  if (!(error instanceof CrewError)) throw error;

  if (error.code === CREW_ERROR_CODES.VALIDATION_FAILED) {
    return { __typename: "LeaveValidationFailed", fieldErrors: error.extensions.fieldErrors || [] };
  }
  if (error.code === CREW_ERROR_CODES.VERSION_CONFLICT) {
    return {
      __typename: "VersionConflict",
      staffId: String(error.extensions.staffId),
      expectedVersion: error.extensions.expectedVersion,
      actualVersion: error.extensions.actualVersion,
    };
  }
  if (error.code === CREW_ERROR_CODES.LEAVE_POLICY_MISSING) {
    return { __typename: "LeavePolicyMissing", message: error.message };
  }
  // MEMBER_NOT_FOUND and anything unanticipated stay errors. For requestLeave
  // that is what keeps `RequestLeaveResult` at exactly six members (see the SDL).
  throw error;
}

/** Turn a requestLeave outcome into its union member. One table, so shapes agree. */
function requestLeaveOutcome(result) {
  switch (result.outcome) {
    case "BOOKED":
      return { __typename: "LeaveBooked", request: result.request, balance: result.balance };
    case "BOOKED_WITH_WARNING":
      // A SUCCESS. The request is already in the store — see rule 4 in service.js.
      return { __typename: "LeaveBookedWithWarning", request: result.request, balance: result.balance, warnings: result.warnings || [] };
    case "INSUFFICIENT_BALANCE":
      return {
        __typename: "InsufficientBalance",
        requested: result.requested,
        remaining: result.remaining,
        shortfall: result.shortfall,
        asOf: result.asOf,
      };
    case "OVERLAPS":
      return { __typename: "OverlapsExistingLeave", conflictingRequestId: result.conflictingRequestId, from: result.from, to: result.to };
    case "BLACKOUT":
      return { __typename: "BlackoutPeriod", from: result.from, to: result.to, reason: result.reason, firstClash: result.firstClash };
    default:
      return {
        __typename: "InsufficientNotice",
        minNoticeDays: result.minNoticeDays,
        requestedStart: result.requestedStart,
        earliestStart: result.earliestStart,
      };
  }
}

function decisionOutcome(result) {
  switch (result.outcome) {
    case "DECIDED":
      return { __typename: "LeaveRequestDecided", request: result.request, balance: result.balance ?? null };
    case "REQUEST_NOT_FOUND":
      return { __typename: "LeaveRequestNotFound", requestId: result.requestId };
    case "ILLEGAL_TRANSITION":
      return {
        __typename: "IllegalLeaveTransition",
        requestId: result.requestId,
        from: toGraphEnum(result.from),
        to: toGraphEnum(result.to),
        allowed: (result.allowed || []).map(toGraphEnum),
      };
    case "INSUFFICIENT_BALANCE":
      return {
        __typename: "InsufficientBalance",
        requested: result.requested,
        remaining: result.remaining,
        shortfall: result.shortfall,
        asOf: result.asOf,
      };
    default:
      return { __typename: "LeaveValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

const resolvers = {
  Query: {
    leavePolicy: (_source, _args, context) => context.services.leave.getPolicy(),

    leaveCalendar: (_source, { from, to }, context) => context.services.leave.calendar({ from, to }),

    pendingLeaveApprovals: (_source, _args, context) => context.services.leave.pendingApprovals(),

    teamAbsence: (_source, { date }, context) => context.services.leave.teamAbsence(date),

    leaveRequests: (_source, { status, type, staffId, from, to }, context) =>
      context.services.leave.listRequests({ status: toStoreEnum(status), type: toStoreEnum(type), staffId, from, to }),
  },

  Mutation: {
    setLeavePolicy: async (_source, { input }, context) => {
      try {
        const policy = await context.services.leave.setPolicy({ ...input, accrualMode: toStoreEnum(input.accrualMode) });
        return { __typename: "LeavePolicySet", policy };
      } catch (error) {
        return toUnionMember(error);
      }
    },

    requestLeave: async (_source, { input }, context) => {
      // No try/catch around the union: a bad staffId is an ERROR here, not a
      // seventh member (§8.3, and the note in the SDL).
      const result = await context.services.leave.requestLeave({ ...input, type: toStoreEnum(input.type) });
      return requestLeaveOutcome(result);
    },

    approveLeave: async (_source, { requestId, expectedVersion }, context) => {
      try {
        return decisionOutcome(await context.services.leave.decide({ requestId, to: "approved", expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    rejectLeave: async (_source, { requestId, reason, expectedVersion }, context) => {
      try {
        return decisionOutcome(await context.services.leave.decide({ requestId, to: "rejected", reason, expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    cancelLeave: async (_source, { requestId, reason, expectedVersion }, context) => {
      try {
        // "cancelled" is the ASK; the service resolves it to withdrawn for a
        // request nobody has decided yet.
        return decisionOutcome(await context.services.leave.decide({ requestId, to: "cancelled", reason, expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    adjustLeaveBalance: async (_source, { input }, context) => {
      try {
        const result = await context.services.leave.adjustBalance(input);
        switch (result.outcome) {
          case "ADJUSTED":
            return { __typename: "LeaveBalanceAdjusted", adjustment: result.adjustment, balance: result.balance };
          case "INSUFFICIENT_BALANCE":
            return {
              __typename: "InsufficientBalance",
              requested: result.requested,
              remaining: result.remaining,
              shortfall: result.shortfall,
              asOf: result.asOf,
            };
          default:
            return { __typename: "LeaveValidationFailed", fieldErrors: result.fieldErrors || [] };
        }
      } catch (error) {
        return toUnionMember(error);
      }
    },

    declareBlackout: async (_source, { input }, context) => {
      try {
        const result = await context.services.leave.declareBlackout(input);
        return { __typename: "BlackoutDeclared", blackout: result.window, affectedRequests: result.affected };
      } catch (error) {
        return toUnionMember(error);
      }
    },
  },

  // The pillar's one field on the join point. `source` is the CrewMember and is
  // passed straight through — the summary's fields do the work lazily, so a query
  // selecting only `nextBooked` never computes a balance.
  CrewMember: {
    leave: (member) => ({ staffId: member.staffId }),
  },

  LeaveSummary: {
    /**
     * Throws LEAVE_POLICY_MISSING when no policy exists.
     *
     * `balance` is non-null, so the error propagates up to the nullable `leave`
     * field and the response is `leave: null` plus one entry in `errors` — exactly
     * the partial response §7.3 documents. Returning a zeroed balance instead
     * would answer "you have no days" to the question "how many days do I have?",
     * which is a different and false statement.
     */
    balance: (summary, { asOf }, context) => context.services.leave.balanceFor(summary.staffId, asOf),

    requests: async (summary, { status, type, first }, context) => {
      const all = await context.services.leave.listRequests({
        staffId: summary.staffId,
        status: toStoreEnum(status),
        type: toStoreEnum(type),
      });
      const limit = first === undefined || first === null ? all.length : Math.max(0, Number(first));
      return { nodes: all.slice(0, limit), totalCount: all.length, hasMore: all.length > limit };
    },

    nextBooked: (summary, _args, context) => context.services.leave.nextBooked(summary.staffId),
  },

  LeaveRequest: {
    id: (request) => String(request.id),
    staffId: (request) => String(request.staffId),
    type: (request) => toGraphEnum(request.type),
    status: (request) => toGraphEnum(request.status),
  },

  LeaveAbsence: {
    type: (absence) => toGraphEnum(absence.type),
    status: (absence) => toGraphEnum(absence.status),
  },

  LeaveTypeDays: {
    type: (row) => toGraphEnum(row.type),
  },

  LeavePolicy: {
    accrualMode: (policy) => toGraphEnum(policy.accrualMode),
    publicHolidays: (policy) => policy.publicHolidays || [],
    blackoutWindows: (policy) => policy.blackoutWindows || [],
  },

  LeaveAdjustment: {
    id: (adjustment) => String(adjustment.id),
    staffId: (adjustment) => String(adjustment.staffId),
  },

  RequestLeaveResult: { __resolveType: (value) => value.__typename },
  LeaveDecisionResult: { __resolveType: (value) => value.__typename },
  SetLeavePolicyResult: { __resolveType: (value) => value.__typename },
  AdjustLeaveBalanceResult: { __resolveType: (value) => value.__typename },
  DeclareBlackoutResult: { __resolveType: (value) => value.__typename },
};

module.exports = { resolvers, requestLeaveOutcome, decisionOutcome, toUnionMember, toStoreEnum, toGraphEnum };
