/**
 * Work resolvers (PRD §8.2).
 *
 * Thin, like the profiles pillar's: take arguments, call the per-request service,
 * shape the answer into a union member. No scoping and no validation here — those
 * live in the service so a different transport cannot skip them (§9).
 *
 * Every outcome a caller can act on is a union member rather than a thrown error.
 * An overlap, a leave conflict and an illegal transition are answers, and putting
 * them in the type system means a client handling `__typename` exhaustively cannot
 * silently miss one.
 */
const { CrewError, CREW_ERROR_CODES } = require("../../errors");
const { shiftInterval, shiftHours, parseTime } = require("./work-time");
const { effectiveEntries } = require("./service");

/** Map a thrown CrewError onto a work union member, or rethrow if it is not ours. */
function toUnionMember(error) {
  if (!(error instanceof CrewError)) throw error;

  if (error.code === CREW_ERROR_CODES.VALIDATION_FAILED) {
    return { __typename: "WorkValidationFailed", fieldErrors: error.extensions.fieldErrors || [] };
  }
  if (error.code === CREW_ERROR_CODES.VERSION_CONFLICT) {
    return {
      __typename: "VersionConflict",
      staffId: String(error.extensions.staffId),
      expectedVersion: error.extensions.expectedVersion,
      actualVersion: error.extensions.actualVersion,
    };
  }
  throw error;
}

/** Turn a service outcome into its union member. One table, so the shapes agree. */
function planShiftOutcome(result) {
  switch (result.outcome) {
    case "PLANNED":
      return { __typename: "ShiftPlanned", shift: result.shift, warnings: result.warnings || [] };
    case "OVERLAP":
      return { __typename: "ShiftOverlap", conflictingShiftId: result.conflictingShiftId };
    case "CONFLICTS_LEAVE":
      return { __typename: "ShiftConflictsLeave", staffId: result.staffId, date: result.date };
    case "MEMBER_NOT_FOUND":
      return { __typename: "MemberNotFound", staffId: result.staffId };
    case "DUTY_TYPE_NOT_FOUND":
      return { __typename: "DutyTypeNotFound", dutyTypeId: result.dutyTypeId };
    default:
      return { __typename: "WorkValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function transitionOutcome(result) {
  switch (result.outcome) {
    case "TRANSITIONED":
      return { __typename: "ShiftTransitioned", shift: result.shift };
    case "SHIFT_NOT_FOUND":
      return { __typename: "ShiftNotFound", shiftId: result.shiftId };
    default:
      return {
        __typename: "IllegalShiftTransition",
        shiftId: result.shiftId,
        from: result.from,
        to: result.to,
        allowed: result.allowed,
      };
  }
}

const resolvers = {
  Query: {
    dutyTypes: (_source, _args, context) => context.services.work.listDutyTypes(),

    shifts: (_source, { from, to, status, staffId }, context) => context.services.work.listShifts({ from, to, status, staffId }),

    workLog: (_source, { from, to, staffId }, context) => context.services.work.listWorkLog({ from, to, staffId }),

    workRollup: (_source, { from, to, staffId }, context) => context.services.work.rollup({ from, to, staffId }),
  },

  Mutation: {
    defineDutyType: async (_source, { input }, context) => {
      try {
        const dutyType = await context.services.work.defineDutyType(input);
        return { __typename: "DutyTypeDefined", dutyType };
      } catch (error) {
        return toUnionMember(error);
      }
    },

    planShift: async (_source, { input }, context) => {
      const result = await context.services.work.planShift(input);
      return planShiftOutcome(result);
    },

    confirmShift: async (_source, { shiftId, expectedVersion }, context) => {
      try {
        return transitionOutcome(await context.services.work.transitionShift({ shiftId, to: "CONFIRMED", expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    completeShift: async (_source, { shiftId, expectedVersion }, context) => {
      try {
        return transitionOutcome(await context.services.work.transitionShift({ shiftId, to: "COMPLETED", expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    cancelShift: async (_source, { shiftId, reason, expectedVersion }, context) => {
      try {
        return transitionOutcome(await context.services.work.transitionShift({ shiftId, to: "CANCELLED", reason, expectedVersion }));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    logWork: async (_source, { input }, context) => {
      const result = await context.services.work.logWork(input);
      switch (result.outcome) {
        case "LOGGED":
          return { __typename: "WorkLogged", entry: result.entry };
        case "MEMBER_NOT_FOUND":
          return { __typename: "MemberNotFound", staffId: result.staffId };
        case "SHIFT_NOT_FOUND":
          return { __typename: "ShiftNotFound", shiftId: result.shiftId };
        default:
          return { __typename: "WorkValidationFailed", fieldErrors: result.fieldErrors || [] };
      }
    },

    amendWorkLog: async (_source, { entryId, hours, activity, note, reason }, context) => {
      const result = await context.services.work.amendWorkLog({ entryId, hours, activity, note, reason });
      switch (result.outcome) {
        case "AMENDED":
          return { __typename: "WorkLogAmended", correction: result.correction, original: result.original };
        case "ENTRY_NOT_FOUND":
          return { __typename: "WorkLogEntryNotFound", entryId: result.entryId };
        default:
          return { __typename: "WorkValidationFailed", fieldErrors: result.fieldErrors || [] };
      }
    },
  },

  // The pillar's one field on the join point. `source` is the CrewMember, and it is
  // passed straight through — the summary's own fields do the work lazily, so a
  // query selecting only `nextShift` never computes a rollup.
  CrewMember: {
    work: (member) => ({ staffId: member.staffId }),
  },

  WorkSummary: {
    shifts: (summary, { from, to, status }, context) => context.services.work.listShifts({ from, to, status, staffId: summary.staffId }),
    nextShift: (summary, _args, context) => context.services.work.nextShift(summary.staffId),
    workLog: (summary, { from, to }, context) => context.services.work.listWorkLog({ from, to, staffId: summary.staffId }),
    weeklyRollup: (summary, { weekStarting }, context) => context.services.work.weeklyRollup({ weekStarting, staffId: summary.staffId }),
    monthlyRollup: (summary, { month }, context) => context.services.work.monthlyRollup({ month, staffId: summary.staffId }),
  },

  DutyType: {
    id: (dutyType) => String(dutyType.id),
    // Computed from the window rather than stored, so the two can never disagree.
    hours: (dutyType) => shiftHours({ start: 0, end: durationMinutes(dutyType) }),
    crossesMidnight: (dutyType) => parseTime(dutyType.endTime) <= parseTime(dutyType.startTime),
  },

  Shift: {
    id: (shift) => String(shift.id),
    staffId: (shift) => String(shift.staffId),
    fieldId: (shift) => (shift.fieldId === null || shift.fieldId === undefined ? null : String(shift.fieldId)),
    dutyType: (shift, _args, context) => context.services.work.findDutyType(shift.dutyTypeId),
    hours: (shift, _args, context) => context.services.work.hoursForShift(shift),
  },

  WorkLogEntry: {
    id: (entry) => String(entry.id),
    staffId: (entry) => String(entry.staffId),
    shiftId: (entry) => (entry.shiftId === null || entry.shiftId === undefined ? null : String(entry.shiftId)),
    amendsId: (entry) => (entry.amendsId === null || entry.amendsId === undefined ? null : String(entry.amendsId)),
    /**
     * Whether this row still counts.
     *
     * Resolved against the member's whole log rather than from a stored flag: a
     * boolean written at amend time would be a second source of truth, and the one
     * thing an append-only log must not have is a mutable field.
     */
    effective: async (entry, _args, context) => {
      const rows = await context.services.work.listWorkLog({ staffId: entry.staffId });
      return effectiveEntries(rows).some((row) => Number(row.id) === Number(entry.id));
    },
  },

  DefineDutyTypeResult: { __resolveType: (value) => value.__typename },
  PlanShiftResult: { __resolveType: (value) => value.__typename },
  ShiftTransitionResult: { __resolveType: (value) => value.__typename },
  LogWorkResult: { __resolveType: (value) => value.__typename },
  AmendWorkLogResult: { __resolveType: (value) => value.__typename },
};

/** Minutes a duty type covers, midnight-crossing included. */
function durationMinutes(dutyType) {
  const interval = shiftInterval("2000-01-01", dutyType.startTime, dutyType.endTime);
  return interval ? interval.end - interval.start : 0;
}

module.exports = { resolvers, planShiftOutcome, transitionOutcome, toUnionMember };
