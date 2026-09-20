/**
 * Work service (PRD §8.2).
 *
 * Who is doing what, when, and what actually got done. Scoping lives here as it
 * does in every pillar — every read filters by the context's `userId` and every
 * write stamps it, so a future transport cannot skip isolation (§9).
 *
 * The two rules worth reading before changing anything:
 *
 *   - **The overlap check and the shift insert happen inside ONE transaction.**
 *     Two roster managers planning clashing shifts at the same moment must resolve
 *     to exactly one booking, and that is only true if the check cannot be
 *     separated from the write.
 *   - **Work-log corrections append.** `amendWorkLog` never edits the row it
 *     corrects; it writes a new row carrying `amendsId` and a reason. The effective
 *     hours for a logical entry are the LAST row in its amendment chain, and the
 *     rollup sums effective rows only.
 */
const { validationFailed, versionConflict, memberNotFound, CrewError, CREW_ERROR_CODES } = require("../../errors");
const { getStore, read, transact } = require("./store");
const { parseTime, shiftInterval, intervalsOverlap, shiftHours, weekBounds, monthBounds, withinRange } = require("./work-time");

const SHIFT_STATUSES = ["PLANNED", "CONFIRMED", "COMPLETED", "CANCELLED"];

/**
 * The lifecycle, as data rather than as a chain of ifs — so the legal moves are
 * greppable and the illegal ones are a lookup rather than an omission.
 * `COMPLETED` and `CANCELLED` are terminal.
 */
const SHIFT_TRANSITIONS = {
  PLANNED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Only these block another shift. A cancelled shift frees its slot. */
const BLOCKING_STATUSES = ["PLANNED", "CONFIRMED", "COMPLETED"];

const MAX_HOURS_PER_ENTRY = 24;
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function createWorkService(context) {
  const store = getStore();
  const { userId, clock } = context;

  /** Everything this user owns, read once per request. */
  const own = context.addLoader("crewWorkDocument", async () => {
    context.onStoreRead("crewWork");
    const document = await read(store);
    // A Map keyed by collection keeps the loader interface (`all()`) while still
    // returning all three lists from the single read.
    return new Map([
      ["dutyTypes", document.dutyTypes.filter((row) => Number(row.userId) === userId)],
      ["shifts", document.shifts.filter((row) => Number(row.userId) === userId)],
      ["workLog", document.workLog.filter((row) => Number(row.userId) === userId)],
    ]);
  });

  const ownedDutyTypes = async () => (await own.all()).get("dutyTypes");
  const ownedShifts = async () => (await own.all()).get("shifts");
  const ownedWorkLog = async () => (await own.all()).get("workLog");

  const invalidate = () => context.resetLoaders("crewWorkDocument");

  const service = {
    SHIFT_STATUSES,
    SHIFT_TRANSITIONS,

    // --- duty types --------------------------------------------------------

    async listDutyTypes() {
      return (await ownedDutyTypes()).slice().sort((a, b) => a.code.localeCompare(b.code));
    },

    async findDutyType(dutyTypeId) {
      const id = Number(dutyTypeId);
      if (!Number.isInteger(id)) return null;
      return (await ownedDutyTypes()).find((row) => Number(row.id) === id) || null;
    },

    async defineDutyType(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateDutyTypeInput(input);
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const nowIso = clock.nowIso();
      const created = await transact(store, (document) => {
        const taken = document.dutyTypes.some((row) => Number(row.userId) === userId && row.code === input.code);
        if (taken) {
          // A duty code is how a roster refers to a duty; two meanings for one code
          // would make every later reference ambiguous.
          throw new CrewError(CREW_ERROR_CODES.VALIDATION_FAILED, `Duty type code "${input.code}" is already in use.`, {
            fieldErrors: [{ field: "code", message: "That code is already in use." }],
            duplicate: true,
          });
        }

        const nextId = document.counters.lastDutyTypeId + 1;
        const row = {
          id: nextId,
          userId,
          code: input.code,
          name: input.name,
          startTime: input.startTime,
          endTime: input.endTime,
          requiredRole: input.requiredRole ?? null,
          colour: input.colour ?? null,
          createdAt: nowIso,
        };
        return {
          document: {
            ...document,
            dutyTypes: [...document.dutyTypes, row],
            counters: { ...document.counters, lastDutyTypeId: nextId },
          },
          result: row,
        };
      });

      invalidate();
      return created;
    },

    // --- shifts ------------------------------------------------------------

    async listShifts({ from, to, status, staffId } = {}) {
      const shifts = await ownedShifts();
      return shifts
        .filter((shift) => withinRange(shift.date, from, to))
        .filter((shift) => (status ? shift.status === status : true))
        .filter((shift) => (staffId === undefined || staffId === null ? true : Number(shift.staffId) === Number(staffId)))
        .slice()
        .sort((a, b) => (a.date === b.date ? Number(a.id) - Number(b.id) : a.date.localeCompare(b.date)));
    },

    async findShift(shiftId) {
      const id = Number(shiftId);
      if (!Number.isInteger(id)) return null;
      return (await ownedShifts()).find((row) => Number(row.id) === id) || null;
    },

    /**
     * Plan a shift.
     *
     * Returns an outcome object rather than throwing for the cases a caller can act
     * on — an overlap and a leave conflict are answers, not exceptions.
     */
    async planShift(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateShiftInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const member = await context.services.profiles.findMember(input.staffId);
      if (!member || !member.staff) return { outcome: "MEMBER_NOT_FOUND", staffId: String(input.staffId) };

      const dutyType = await service.findDutyType(input.dutyTypeId);
      if (!dutyType) return { outcome: "DUTY_TYPE_NOT_FOUND", dutyTypeId: String(input.dutyTypeId) };

      const interval = shiftInterval(input.date, dutyType.startTime, dutyType.endTime);
      if (!interval) {
        return {
          outcome: "VALIDATION_FAILED",
          fieldErrors: [{ field: "date", message: "The shift date or the duty type's times are not usable." }],
        };
      }

      // Cross-pillar check, run only when the leave pillar is actually assembled.
      // Until Phase 4 there is no leave service, so the check is skipped rather
      // than failed — the seam is here, documented, and exercised by a test that
      // injects a stub service.
      const leaveService = context.services.leave;
      if (leaveService && typeof leaveService.hasApprovedLeaveOn === "function") {
        const onLeave = await leaveService.hasApprovedLeaveOn(input.staffId, input.date);
        if (onLeave) {
          return { outcome: "CONFLICTS_LEAVE", staffId: String(input.staffId), date: input.date };
        }
      }

      // A required role the member does not have is a WARNING, not a block (§8.2):
      // the farm decides who covers a duty, and refusing would make the roster
      // unusable the first time someone stands in for a colleague.
      const warnings = [];
      if (dutyType.requiredRole && member.profile?.role !== dutyType.requiredRole) {
        warnings.push({
          code: "ROLE_MISMATCH",
          message:
            `${dutyType.name} normally needs ${dutyType.requiredRole}` +
            (member.profile ? `, and this member is ${member.profile.role}.` : ", and this member has no profile yet."),
        });
      }

      const nowIso = clock.nowIso();
      const numericStaffId = Number(input.staffId);

      const result = await transact(store, (document) => {
        // Re-check overlaps INSIDE the transaction against the freshest data, so
        // two concurrent plans cannot both pass a check made before either wrote.
        const existing = document.shifts.filter(
          (row) => Number(row.userId) === userId && Number(row.staffId) === numericStaffId && BLOCKING_STATUSES.includes(row.status),
        );

        for (const other of existing) {
          const otherDuty = document.dutyTypes.find((row) => Number(row.id) === Number(other.dutyTypeId));
          if (!otherDuty) continue;
          const otherInterval = shiftInterval(other.date, otherDuty.startTime, otherDuty.endTime);
          if (intervalsOverlap(interval, otherInterval)) {
            return { document, result: { outcome: "OVERLAP", conflictingShiftId: String(other.id) } };
          }
        }

        const nextId = document.counters.lastShiftId + 1;
        const shift = {
          id: nextId,
          userId,
          staffId: numericStaffId,
          dutyTypeId: Number(dutyType.id),
          date: input.date,
          status: "PLANNED",
          // Read-only reference: Crew Office displays where a shift happens and
          // never creates or edits a field or an assignment (§12.2).
          fieldId: input.fieldId === undefined || input.fieldId === null ? null : Number(input.fieldId),
          note: input.note ?? null,
          cancelReason: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        };

        return {
          document: {
            ...document,
            shifts: [...document.shifts, shift],
            counters: { ...document.counters, lastShiftId: nextId },
          },
          result: { outcome: "PLANNED", shift, warnings },
        };
      });

      if (result.outcome === "PLANNED") invalidate();
      return result;
    },

    /**
     * Move a shift through its lifecycle.
     *
     * One function for confirm/complete/cancel because the rules are identical
     * apart from the target state — three near-copies would be three places for a
     * transition table to drift.
     */
    async transitionShift({ shiftId, to, reason, expectedVersion }) {
      context.assertWritableIdentity();

      if (!SHIFT_STATUSES.includes(to)) {
        throw validationFailed([{ field: "status", message: `Unknown shift status "${to}".` }]);
      }

      const numericShiftId = Number(shiftId);
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const index = document.shifts.findIndex((row) => Number(row.id) === numericShiftId && Number(row.userId) === userId);
        if (index === -1) return { document, result: { outcome: "SHIFT_NOT_FOUND", shiftId: String(shiftId) } };

        const current = document.shifts[index];
        const allowed = SHIFT_TRANSITIONS[current.status] || [];
        if (!allowed.includes(to)) {
          return {
            document,
            result: { outcome: "ILLEGAL_TRANSITION", shiftId: String(shiftId), from: current.status, to, allowed },
          };
        }

        if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(current.version)) {
          throw versionConflict(current.staffId, Number(expectedVersion), Number(current.version));
        }

        const updated = {
          ...current,
          status: to,
          cancelReason: to === "CANCELLED" ? (reason ?? null) : current.cancelReason,
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };
        const shifts = [...document.shifts];
        shifts[index] = updated;
        return { document: { ...document, shifts }, result: { outcome: "TRANSITIONED", shift: updated } };
      });

      if (result.outcome === "TRANSITIONED") invalidate();
      return result;
    },

    // --- work log ----------------------------------------------------------

    async listWorkLog({ from, to, staffId } = {}) {
      const rows = await ownedWorkLog();
      return rows
        .filter((row) => withinRange(row.date, from, to))
        .filter((row) => (staffId === undefined || staffId === null ? true : Number(row.staffId) === Number(staffId)))
        .slice()
        .sort((a, b) => (a.date === b.date ? Number(a.id) - Number(b.id) : a.date.localeCompare(b.date)));
    },

    async logWork(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateWorkLogInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const member = await context.services.profiles.findMember(input.staffId);
      if (!member || !member.staff) return { outcome: "MEMBER_NOT_FOUND", staffId: String(input.staffId) };

      // A shift reference is optional — standalone work happens — but a reference
      // that names someone else's shift, or a shift for another member, is wrong.
      if (input.shiftId !== undefined && input.shiftId !== null) {
        const shift = await service.findShift(input.shiftId);
        if (!shift) return { outcome: "SHIFT_NOT_FOUND", shiftId: String(input.shiftId) };
        if (Number(shift.staffId) !== Number(input.staffId)) {
          return {
            outcome: "VALIDATION_FAILED",
            fieldErrors: [{ field: "shiftId", message: "That shift belongs to a different crew member." }],
          };
        }
      }

      const nowIso = clock.nowIso();
      const entry = await transact(store, (document) => {
        const nextId = document.counters.lastWorkLogId + 1;
        const row = {
          id: nextId,
          userId,
          staffId: Number(input.staffId),
          shiftId: input.shiftId === undefined || input.shiftId === null ? null : Number(input.shiftId),
          date: input.date,
          hours: Number(input.hours),
          activity: input.activity,
          note: input.note ?? null,
          // Amendment bookkeeping. A fresh entry amends nothing and is not itself
          // superseded until some later row points at it.
          amendsId: null,
          amendedByReason: null,
          createdAt: nowIso,
        };
        return {
          document: {
            ...document,
            workLog: [...document.workLog, row],
            counters: { ...document.counters, lastWorkLogId: nextId },
          },
          result: row,
        };
      });

      invalidate();
      return { outcome: "LOGGED", entry };
    },

    /**
     * Correct a work-log entry by APPENDING a correction (§6.6).
     *
     * The original row is never touched. The correction points back at it, so the
     * history reads as "3 hours were claimed, then amended to 2.5 because …" rather
     * than as "it was always 2.5".
     */
    async amendWorkLog({ entryId, hours, activity, note, reason }) {
      context.assertWritableIdentity();

      if (typeof reason !== "string" || reason.trim().length === 0) {
        return { outcome: "VALIDATION_FAILED", fieldErrors: [{ field: "reason", message: "An amendment needs a reason." }] };
      }

      const numericEntryId = Number(entryId);
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const original = document.workLog.find((row) => Number(row.id) === numericEntryId && Number(row.userId) === userId);
        if (!original) return { document, result: { outcome: "ENTRY_NOT_FOUND", entryId: String(entryId) } };

        // Amending an entry that has already been amended would fork the chain and
        // make "the effective value" ambiguous. Amend the latest row instead.
        const alreadyAmended = document.workLog.some((row) => Number(row.amendsId) === numericEntryId);
        if (alreadyAmended) {
          return {
            document,
            result: {
              outcome: "VALIDATION_FAILED",
              fieldErrors: [{ field: "entryId", message: "That entry has already been amended — amend the correction instead." }],
            },
          };
        }

        const nextHours = hours === undefined || hours === null ? Number(original.hours) : Number(hours);
        const fieldErrors = validateWorkLogInput({
          staffId: original.staffId,
          date: original.date,
          hours: nextHours,
          activity: activity ?? original.activity,
        });
        if (fieldErrors.length > 0) return { document, result: { outcome: "VALIDATION_FAILED", fieldErrors } };

        const nextId = document.counters.lastWorkLogId + 1;
        const correction = {
          id: nextId,
          userId,
          staffId: Number(original.staffId),
          shiftId: original.shiftId,
          date: original.date,
          hours: nextHours,
          activity: activity ?? original.activity,
          note: note === undefined ? original.note : note,
          amendsId: numericEntryId,
          amendedByReason: reason.trim(),
          createdAt: nowIso,
        };

        return {
          document: {
            ...document,
            workLog: [...document.workLog, correction],
            counters: { ...document.counters, lastWorkLogId: nextId },
          },
          result: { outcome: "AMENDED", correction, original },
        };
      });

      if (result.outcome === "AMENDED") invalidate();
      return result;
    },

    // --- rollups -----------------------------------------------------------

    /** Hours actually worked in a range, counting each logical entry once. */
    async rollup({ from, to, staffId }) {
      const rows = await service.listWorkLog({ staffId });
      return rollupOf(rows, { from, to });
    },

    async weeklyRollup({ weekStarting, staffId }) {
      const bounds = weekBounds(weekStarting);
      if (!bounds) throw validationFailed([{ field: "weekStarting", message: "weekStarting must be YYYY-MM-DD." }]);
      return service.rollup({ ...bounds, staffId });
    },

    async monthlyRollup({ month, staffId }) {
      const bounds = monthBounds(month);
      if (!bounds) throw validationFailed([{ field: "month", message: "month must be a YYYY-MM-DD date inside the month." }]);
      return service.rollup({ ...bounds, staffId });
    },

    /** The next shift that has not happened yet, for the member summary. */
    async nextShift(staffId) {
      const today = clock.today();
      const shifts = await service.listShifts({ staffId, from: today });
      return shifts.find((shift) => shift.status === "PLANNED" || shift.status === "CONFIRMED") || null;
    },

    /** Shift hours from its duty type — computed, never stored on the shift. */
    async hoursForShift(shift) {
      const dutyType = await service.findDutyType(shift.dutyTypeId);
      if (!dutyType) return 0;
      return shiftHours(shiftInterval(shift.date, dutyType.startTime, dutyType.endTime));
    },

    /** Rows referencing a staff member who no longer exists (§12 rule 4). */
    async findOrphanedOverlays() {
      const staffRecords = await context.loaders.ownedStaff.get();
      const live = new Set(staffRecords.map((staff) => Number(staff.id)));

      const orphans = [];
      for (const shift of await ownedShifts()) {
        if (live.has(Number(shift.staffId))) continue;
        orphans.push({
          staffId: String(shift.staffId),
          rowId: String(shift.id),
          detail: `Shift ${shift.id} references a deleted staff record.`,
        });
      }
      for (const entry of await ownedWorkLog()) {
        if (live.has(Number(entry.staffId))) continue;
        orphans.push({
          staffId: String(entry.staffId),
          rowId: String(entry.id),
          detail: `Work-log entry ${entry.id} references a deleted staff record.`,
        });
      }
      return orphans;
    },
  };

  return service;
}

// --- pure helpers -----------------------------------------------------------

/**
 * Reduce an append-only work log to the entries that currently count.
 *
 * An entry is superseded when some other row amends it. Following each chain to
 * its end — rather than simply taking the newest row per date — is what keeps two
 * separate entries on the same day from collapsing into one.
 */
function effectiveEntries(rows) {
  const amendedIds = new Set(rows.filter((row) => row.amendsId !== null && row.amendsId !== undefined).map((row) => Number(row.amendsId)));
  return rows.filter((row) => !amendedIds.has(Number(row.id)));
}

/** Sum effective entries in a range, grouped by activity. */
function rollupOf(rows, { from, to } = {}) {
  const effective = effectiveEntries(rows).filter((row) => withinRange(row.date, from, to));

  const byActivity = new Map();
  let hours = 0;
  for (const row of effective) {
    hours += Number(row.hours) || 0;
    byActivity.set(row.activity, (byActivity.get(row.activity) || 0) + (Number(row.hours) || 0));
  }

  return {
    from: from || null,
    to: to || null,
    // Two decimals: hours are quarter-hours in practice, and floating-point sums
    // of 0.25s otherwise surface as 7.249999999999999 in a UI.
    hours: Math.round(hours * 100) / 100,
    entries: effective.length,
    byActivity: [...byActivity.entries()]
      .map(([activity, activityHours]) => ({ activity, hours: Math.round(activityHours * 100) / 100 }))
      .sort((a, b) => a.activity.localeCompare(b.activity)),
  };
}

function validateDutyTypeInput(input) {
  const fieldErrors = [];

  if (typeof input.code !== "string" || !CODE_PATTERN.test(input.code)) {
    fieldErrors.push({ field: "code", message: "code must be lower_snake_case, 2–40 characters, starting with a letter." });
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 80) {
    fieldErrors.push({ field: "name", message: "name is required and must be at most 80 characters." });
  }
  if (parseTime(input.startTime) === null) {
    fieldErrors.push({ field: "startTime", message: "startTime must be HH:MM in 24-hour form." });
  }
  if (parseTime(input.endTime) === null) {
    fieldErrors.push({ field: "endTime", message: "endTime must be HH:MM in 24-hour form." });
  }
  if (input.colour !== undefined && input.colour !== null && !COLOUR_PATTERN.test(input.colour)) {
    fieldErrors.push({ field: "colour", message: "colour must be a #rrggbb hex value." });
  }
  return fieldErrors;
}

function validateShiftInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.staffId))) fieldErrors.push({ field: "staffId", message: "staffId is required." });
  if (!Number.isInteger(Number(input.dutyTypeId))) fieldErrors.push({ field: "dutyTypeId", message: "dutyTypeId is required." });
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    fieldErrors.push({ field: "date", message: "date is required as YYYY-MM-DD." });
  }
  return fieldErrors;
}

function validateWorkLogInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.staffId))) fieldErrors.push({ field: "staffId", message: "staffId is required." });
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    fieldErrors.push({ field: "date", message: "date is required as YYYY-MM-DD." });
  }

  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    fieldErrors.push({ field: "hours", message: "hours must be greater than zero." });
  } else if (hours > MAX_HOURS_PER_ENTRY) {
    fieldErrors.push({ field: "hours", message: `hours must not exceed ${MAX_HOURS_PER_ENTRY} in a single entry.` });
  } else if (Math.round(hours * 4) !== hours * 4) {
    // Quarter-hour granularity: farm hours are recorded in quarters, and allowing
    // arbitrary fractions makes two rollups of the same week disagree in the tail.
    fieldErrors.push({ field: "hours", message: "hours must be in 0.25 steps." });
  }

  if (typeof input.activity !== "string" || input.activity.trim().length === 0 || input.activity.trim().length > 60) {
    fieldErrors.push({ field: "activity", message: "activity is required and must be at most 60 characters." });
  }
  return fieldErrors;
}

module.exports = {
  createWorkService,
  effectiveEntries,
  rollupOf,
  validateDutyTypeInput,
  validateShiftInput,
  validateWorkLogInput,
  SHIFT_STATUSES,
  SHIFT_TRANSITIONS,
  BLOCKING_STATUSES,
  MAX_HOURS_PER_ENTRY,
};
