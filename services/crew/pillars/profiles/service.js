/**
 * Profiles service — the pillar's domain logic (PRD §8.1).
 *
 * **Scoping lives here, not in the resolvers** (§9). Every read filters by the
 * context's `userId` and every write stamps it, so a future transport — a REST
 * shim, a CLI, a second graph — cannot bypass isolation by calling the service
 * directly. A resolver that forgot to scope would still be safe; that is the
 * point of putting it at this layer.
 *
 * The service is created per request from the context, so `userId` is fixed for
 * its whole lifetime and cannot be re-pointed mid-operation.
 */
const { validationFailed, versionConflict, memberNotFound, CREW_ERROR_CODES, CrewError } = require("../../errors");
const { daysBetween } = require("../../clock");
const { getStore, read, transact } = require("./store");
const { employmentEnded } = require("./notifications");

const ROLES = ["STOCKPERSON", "TRACTOR_DRIVER", "AGRONOMIST", "DAIRY_HAND", "MECHANIC", "SEASONAL_PICKER", "MANAGER"];
const EMPLOYMENT_TYPES = ["PERMANENT", "FIXED_TERM", "SEASONAL", "CONTRACTOR"];

const MIN_FTE = 0.1;
const MAX_FTE = 1.0;
const MIN_AGE = 16;
const MAX_AGE = 120;
const MAX_HOURS_PER_WEEK = 80;
// A profile younger than this many days is on probation. Farm-office convention,
// not a legal rule (§2.2 — no HR compliance claims).
const PROBATION_DAYS = 90;
// Once the end date is within this window, the member is working their notice.
const NOTICE_WINDOW_DAYS = 30;

/**
 * @param {object} context - the per-request context (context.js)
 * @param {object} [deps]
 * @param {object} [deps.store] - store override, the same seam the other three
 *   pillars carry. The registry never passes one; a test does, so a write path
 *   can be driven without a file on disk. Read-only from the pillar's point of
 *   view: nothing here behaves differently because it was passed a double.
 */
function createProfilesService(context, { store: storeOverride } = {}) {
  const store = storeOverride || getStore();
  const { userId, clock } = context;

  /** Every profile row this user owns. One store read per request, via the loader. */
  const ownedProfiles = context.addLoader("crewProfilesByStaffId", async () => {
    context.onStoreRead("crewProfiles");
    const { profiles } = await read(store);
    const map = new Map();
    for (const profile of profiles) {
      if (Number(profile.userId) !== userId) continue;
      map.set(Number(profile.staffId), profile);
    }
    return map;
  });

  const service = {
    ROLES,
    EMPLOYMENT_TYPES,

    /**
     * The roster: every owned staff record, joined to its profile if it has one.
     *
     * A staff member with no profile IS listed, with `profile: null` (§17 Q1) —
     * hiding them would make onboarding invisible. Rows are also produced for
     * orphaned overlays so a deleted staff member's data is visible rather than
     * silently lost.
     */
    async listCrew({ filter } = {}) {
      const staffRecords = await context.loaders.ownedStaff.get();
      const profilesByStaffId = await ownedProfiles.all();

      const members = staffRecords.map((staff) => ({
        staffId: Number(staff.id),
        staff,
        profile: profilesByStaffId.get(Number(staff.id)) || null,
      }));

      // Overlay rows whose staff record is gone. They belong in the roster only
      // when explicitly asked for; the default view is live crew.
      const knownStaffIds = new Set(members.map((member) => member.staffId));
      const orphans = [];
      for (const [staffId, profile] of profilesByStaffId.entries()) {
        if (knownStaffIds.has(staffId)) continue;
        orphans.push({ staffId, staff: null, profile });
      }

      const all = filter?.includeOrphaned ? [...members, ...orphans] : members;
      return all.filter((member) => matchesFilter(member, filter, clock));
    },

    /** One member, or null when unknown OR not owned — the same answer either way (§9). */
    async findMember(staffId) {
      const numericStaffId = Number(staffId);
      if (!Number.isInteger(numericStaffId)) return null;

      const staff = await context.loaders.staffById.get(numericStaffId);
      const profile = (await ownedProfiles.all()).get(numericStaffId) || null;

      if (!staff && !profile) return null; // unknown, or someone else's
      return { staffId: numericStaffId, staff: staff || null, profile };
    },

    /** Computed employment status. Clock-driven, so every boundary is testable. */
    employmentStatus(profile) {
      return employmentStatusOf(profile, clock.today());
    },

    /** Whole days since the start date; 0 before it begins. */
    tenureDays(profile) {
      const days = daysBetween(profile.startDate, clock.today());
      return days === null ? 0 : Math.max(0, days);
    },

    /**
     * Validate hire input. Stricter than the base staff module on purpose (§8.1.1)
     * — `POST /api/v1/staff` has no validation at all — but the strictness applies
     * ONLY to input. The read path stays lenient so every existing record,
     * including the 88-year-old, resolves normally. Crew Office must never reject
     * data the base module allows.
     */
    validateHireInput(input) {
      const fieldErrors = [];
      validateName(input.name, "name", fieldErrors);
      validateName(input.surname, "surname", fieldErrors);
      validateAge(input.age, fieldErrors);
      validateProfileFields(input, fieldErrors, { requireCore: true });
      if (input.userId !== undefined) {
        // Rejected outright rather than ignored: a caller trying to hire into
        // someone else's farm should be told no, not silently redirected (§9).
        fieldErrors.push({ field: "userId", message: "userId is not accepted — a hire always belongs to the caller." });
      }
      return fieldErrors;
    },

    /**
     * Write the employment profile for an EXISTING staff id.
     *
     * Creates on first call, updates thereafter — an upsert, because a staff
     * member acquiring their first profile and one being corrected are the same
     * user action ("save this profile").
     */
    async upsertProfile(input) {
      context.assertWritableIdentity();
      const numericStaffId = Number(input.staffId);
      const member = await service.findMember(numericStaffId);
      if (!member || !member.staff) {
        // No staff record ⇒ nothing to attach a profile to. Not-owned lands here
        // too, and gets the same answer.
        throw memberNotFound(input.staffId);
      }

      const existing = member.profile;
      const fieldErrors = [];
      validateProfileFields(input, fieldErrors, { requireCore: !existing });
      if (fieldErrors.length > 0) throw validationFailed(fieldErrors);

      const nowIso = clock.nowIso();

      // Whatever this write does, the profile snapshot taken earlier in this
      // request is now stale — see loaders.js.
      const written = await transact(store, (document) => {
        const index = document.profiles.findIndex((row) => Number(row.staffId) === numericStaffId && Number(row.userId) === userId);

        if (index === -1) {
          const nextId = document.counters.lastProfileId + 1;
          const created = {
            id: nextId,
            staffId: numericStaffId,
            userId, // always the caller's — never read from input
            role: input.role,
            employmentType: input.employmentType,
            fte: Number(input.fte),
            contractedHoursPerWeek: input.contractedHoursPerWeek ?? null,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            endReason: null,
            emergencyContact: input.emergencyContact ?? null,
            notes: input.notes ?? null,
            createdAt: nowIso,
            updatedAt: nowIso,
            version: 1,
          };
          return {
            document: {
              profiles: [...document.profiles, created],
              counters: { ...document.counters, lastProfileId: nextId },
            },
            result: created,
          };
        }

        const current = document.profiles[index];
        // Optimistic concurrency. GraphQL has no If-Match, so the version travels
        // in the input; a stale one loses rather than overwriting a newer write.
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          Number(input.expectedVersion) !== Number(current.version)
        ) {
          throw versionConflict(numericStaffId, Number(input.expectedVersion), Number(current.version));
        }

        const updated = {
          ...current,
          role: input.role ?? current.role,
          employmentType: input.employmentType ?? current.employmentType,
          fte: input.fte === undefined || input.fte === null ? current.fte : Number(input.fte),
          contractedHoursPerWeek:
            input.contractedHoursPerWeek === undefined ? current.contractedHoursPerWeek : input.contractedHoursPerWeek,
          startDate: input.startDate ?? current.startDate,
          endDate: input.endDate === undefined ? current.endDate : input.endDate,
          emergencyContact: input.emergencyContact === undefined ? current.emergencyContact : input.emergencyContact,
          notes: input.notes === undefined ? current.notes : input.notes,
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };

        const profiles = [...document.profiles];
        profiles[index] = updated;
        return { document: { ...document, profiles }, result: updated };
      });

      context.resetLoaders("crewProfilesByStaffId");
      return written;
    },

    /**
     * Hire: one staff record plus one profile (§8.1.1).
     *
     * The order matters and the failure mode is the interesting part. Step 2
     * commits to `staff.json`; if step 3 fails, the obvious compensation — delete
     * the staff record — is FORBIDDEN by the no-firing rule. So the design makes
     * the failure harmless instead: the result is a staff member with no profile,
     * which is exactly the pre-existing shape of all 15 original records and is
     * already a supported state. The caller is told, and offered "complete
     * profile". Nothing is ever rolled back by deletion.
     */
    async hire(input) {
      context.assertWritableIdentity();
      const fieldErrors = service.validateHireInput(input);
      if (fieldErrors.length > 0) {
        return { outcome: "VALIDATION_FAILED", fieldErrors };
      }

      const staff = await context.staffGateway.hire(userId, {
        name: input.name,
        surname: input.surname,
        age: Number(input.age),
      });
      // A new person exists now, so any roster snapshot from earlier in this
      // request no longer includes everyone.
      context.resetLoaders("ownedStaff", "staffById");

      try {
        const profile = await service.upsertProfile({
          staffId: staff.id,
          role: input.role,
          employmentType: input.employmentType,
          fte: input.fte,
          contractedHoursPerWeek: input.contractedHoursPerWeek,
          startDate: input.startDate,
          emergencyContact: input.emergencyContact,
        });
        return { outcome: "HIRED", staff, profile };
      } catch (error) {
        return {
          outcome: "HIRED_WITHOUT_PROFILE",
          staff,
          reason: error instanceof CrewError ? error.message : "The employment profile could not be saved.",
          code: CREW_ERROR_CODES.PROFILE_WRITE_FAILED,
        };
      }
    },

    /**
     * End employment — which is NOT firing (§8.1.2).
     *
     * Writes `endDate` (+ reason) to the overlay only. The staff record survives,
     * its assignments survive, and the member resolves with `employmentStatus:
     * ENDED`. There is deliberately no delete mutation anywhere in this module.
     */
    async recordEmploymentEnd({ staffId, lastDay, reason, expectedVersion }) {
      context.assertWritableIdentity();
      const member = await service.findMember(staffId);
      if (!member || !member.staff) throw memberNotFound(staffId);
      if (!member.profile) {
        throw validationFailed(
          [{ field: "staffId", message: "This crew member has no employment profile to end." }],
          "Cannot end employment without a profile.",
        );
      }
      if (daysBetween(member.profile.startDate, lastDay) < 0) {
        throw validationFailed([{ field: "lastDay", message: "The last day cannot be before the start date." }]);
      }

      const numericStaffId = Number(staffId);
      const nowIso = clock.nowIso();

      const ended = await transact(store, (document) => {
        const index = document.profiles.findIndex((row) => Number(row.staffId) === numericStaffId && Number(row.userId) === userId);
        if (index === -1) throw memberNotFound(staffId);

        const current = document.profiles[index];
        if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(current.version)) {
          throw versionConflict(numericStaffId, Number(expectedVersion), Number(current.version));
        }

        const updated = {
          ...current,
          endDate: lastDay,
          endReason: reason ?? null,
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };
        const profiles = [...document.profiles];
        profiles[index] = updated;
        return { document: { ...document, profiles }, result: updated };
      });

      context.resetLoaders("crewProfilesByStaffId");
      // NOT a firing (see the note at the top of schema.graphql) — an end date on
      // the overlay. The staff record and its assignments are untouched, which is
      // exactly why this needs announcing: nothing else downstream changes shape.
      context.notifier.publishEvent(employmentEnded(ended));
      return ended;
    },

    /** Overlay rows pointing at a staff record that no longer exists (§12 rule 4). */
    async findOrphanedOverlays() {
      const staffRecords = await context.loaders.ownedStaff.get();
      const liveStaffIds = new Set(staffRecords.map((staff) => Number(staff.id)));
      const profilesByStaffId = await ownedProfiles.all();

      const orphans = [];
      for (const [staffId, profile] of profilesByStaffId.entries()) {
        if (liveStaffIds.has(staffId)) continue;
        orphans.push({
          staffId: String(staffId),
          rowId: String(profile.id),
          detail: `Profile ${profile.id} references a deleted staff record.`,
        });
      }
      return orphans;
    },
  };

  return service;
}

// --- pure helpers -----------------------------------------------------------
// Kept free of `context` so they can be unit-tested without building a request.

function employmentStatusOf(profile, today) {
  if (!profile) return null;
  if (profile.endDate) {
    const daysUntilEnd = daysBetween(today, profile.endDate);
    if (daysUntilEnd !== null && daysUntilEnd < 0) return "ENDED";
    // Last day is today or in the future: still employed, working notice.
    if (daysUntilEnd !== null && daysUntilEnd <= NOTICE_WINDOW_DAYS) return "NOTICE";
  }
  const tenure = daysBetween(profile.startDate, today);
  if (tenure !== null && tenure < PROBATION_DAYS) return "PROBATION";
  return "ACTIVE";
}

function matchesFilter(member, filter, clock) {
  if (!filter) return true;
  if (filter.role && member.profile?.role !== filter.role) return false;
  if (filter.employmentType && member.profile?.employmentType !== filter.employmentType) return false;
  if (filter.status) {
    // A member with no profile has no employment status, so a status filter
    // excludes them rather than matching them by accident.
    if (!member.profile) return false;
    if (employmentStatusOf(member.profile, clock.today()) !== filter.status) return false;
  }
  return true;
}

function validateName(value, field, fieldErrors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fieldErrors.push({ field, message: `${field} is required.` });
    return;
  }
  if (value.trim().length > 100) {
    fieldErrors.push({ field, message: `${field} must be at most 100 characters.` });
  }
}

function validateAge(value, fieldErrors) {
  const age = Number(value);
  if (!Number.isInteger(age)) {
    fieldErrors.push({ field: "age", message: "age must be a whole number." });
    return;
  }
  if (age < MIN_AGE || age > MAX_AGE) {
    fieldErrors.push({ field: "age", message: `age must be between ${MIN_AGE} and ${MAX_AGE}.` });
  }
}

function validateProfileFields(input, fieldErrors, { requireCore }) {
  if (requireCore || input.role !== undefined) {
    if (!ROLES.includes(input.role)) fieldErrors.push({ field: "role", message: "role is required and must be a known CrewRole." });
  }
  if (requireCore || input.employmentType !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(input.employmentType)) {
      fieldErrors.push({ field: "employmentType", message: "employmentType is required and must be a known EmploymentType." });
    }
  }
  if (requireCore || (input.fte !== undefined && input.fte !== null)) {
    const fte = Number(input.fte);
    if (!Number.isFinite(fte) || fte < MIN_FTE || fte > MAX_FTE) {
      fieldErrors.push({ field: "fte", message: `fte must be between ${MIN_FTE} and ${MAX_FTE}.` });
    }
  }
  if (requireCore || input.startDate !== undefined) {
    if (typeof input.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
      fieldErrors.push({ field: "startDate", message: "startDate is required as YYYY-MM-DD." });
    }
  }
  if (input.contractedHoursPerWeek !== undefined && input.contractedHoursPerWeek !== null) {
    const hours = Number(input.contractedHoursPerWeek);
    if (!Number.isInteger(hours) || hours <= 0 || hours > MAX_HOURS_PER_WEEK) {
      fieldErrors.push({ field: "contractedHoursPerWeek", message: `contractedHoursPerWeek must be 1–${MAX_HOURS_PER_WEEK}.` });
    }
  }
  if (input.endDate) {
    if (typeof input.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
      fieldErrors.push({ field: "endDate", message: "endDate must be YYYY-MM-DD." });
    } else if (input.startDate && daysBetween(input.startDate, input.endDate) < 0) {
      fieldErrors.push({ field: "endDate", message: "endDate must not be before startDate." });
    }
  }
}

module.exports = {
  createProfilesService,
  employmentStatusOf,
  matchesFilter,
  validateProfileFields,
  ROLES,
  EMPLOYMENT_TYPES,
  MIN_FTE,
  MAX_FTE,
  PROBATION_DAYS,
  NOTICE_WINDOW_DAYS,
};
