/**
 * Training service (PRD §8.4) — what the crew is qualified to do, and when that
 * lapses.
 *
 * Scoping lives here as it does in every pillar: every read filters by the
 * context's `userId` and every write stamps it, so a future transport cannot skip
 * isolation (§9).
 *
 * Four rules worth reading before changing anything:
 *
 *   1. **Status is computed, never stored.** `valid | expiring_soon | expired |
 *      revoked` is a function of the row and today's date (`expiry.js`). A stored
 *      status would be a cron job's worth of drift, and would go stale silently —
 *      the worst possible failure for a safety record.
 *
 *   2. **A pass MINTS; nothing else does.** The transition check and the mint happen
 *      inside one transaction, so two concurrent "passed" reports for the same
 *      enrollment produce exactly one certificate rather than two with different
 *      reference numbers.
 *
 *   3. **Nothing is edited or deleted.** Re-passing a course mints a new certificate
 *      beside the old one; revoking sets a date and a reason. Both are §6.6, and both
 *      exist so "was Marek certified last August?" and "why is this ticket void?"
 *      stay answerable.
 *
 *   4. **The academy link may only ever return null.** It is optional and external;
 *      `academy-gateway.js` is written so no failure of it can fail a crew query.
 *
 * This pillar also owns the seam the tools pillar's certification gate uses from
 * Phase 6: `evaluateCertification`. It is written FAIL-CLOSED — see its own note.
 */
const { validationFailed, versionConflict, memberNotFound } = require("../../errors");
const { getStore, read, transact } = require("./store");
const {
  CERTIFICATION_STATUSES,
  ENROLLMENT_STATUSES,
  EXPIRING_SOON_DAYS,
  expiryDateFor,
  certificationStatus,
  daysUntilExpiry,
  permitsWork,
  currentCertification,
  isSuperseded,
  gapsForMember,
  buildMatrix,
  latestEnrollmentFor,
} = require("./expiry");

/**
 * The enrollment lifecycle, as data (§6.4).
 *
 * `planned → passed` is allowed on purpose, and it is the one place this table is
 * more permissive than §8.4's arrow. The office usually only hears about a course
 * after somebody has been on it, and forcing a bookkeeping trip through
 * `in_progress` first would mean the paperwork is refused and the record simply
 * never gets made. Terminal states stay strictly terminal, which is the part that
 * actually protects the data: no second outcome, no resurrection.
 */
const ENROLLMENT_TRANSITIONS = {
  planned: ["in_progress", "passed", "failed", "cancelled"],
  in_progress: ["passed", "failed", "cancelled"],
  passed: [],
  failed: [],
  cancelled: [],
};

/** Statuses that still occupy a member's slot on a course. */
const LIVE_ENROLLMENT_STATUSES = ["planned", "in_progress"];

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_VALID_MONTHS = 600;
const MAX_SCORE = 100;

function createTrainingService(context, { store: storeOverride } = {}) {
  const store = storeOverride || getStore();
  const { userId, clock } = context;

  /** Everything this user owns, read once per request. */
  const own = context.addLoader("crewTrainingDocument", async () => {
    context.onStoreRead("crewTraining");
    const document = await read(store);
    const mine = (rows) => rows.filter((row) => Number(row.userId) === userId);
    return new Map([
      ["courses", mine(document.courses)],
      ["enrollments", mine(document.enrollments)],
      ["certifications", mine(document.certifications)],
    ]);
  });

  const ownedCourses = async () => (await own.all()).get("courses");
  const ownedEnrollments = async () => (await own.all()).get("enrollments");
  const ownedCertifications = async () => (await own.all()).get("certifications");

  const invalidate = () => context.resetLoaders("crewTrainingDocument");

  const today = () => clock.today();

  /**
   * The member, or `MEMBER_NOT_FOUND`.
   *
   * Same read/write split as the leave pillar (§12 rule 4): a member whose staff
   * record was deleted still has a training history worth reading, but nothing new
   * may be recorded against them.
   */
  async function requireMember(staffId, { allowOrphaned = false } = {}) {
    const member = await context.services.profiles.findMember(staffId);
    if (!member) throw memberNotFound(staffId);
    if (!member.staff && !allowOrphaned) throw memberNotFound(staffId);
    return member;
  }

  const service = {
    CERTIFICATION_STATUSES,
    ENROLLMENT_STATUSES,
    ENROLLMENT_TRANSITIONS,
    EXPIRING_SOON_DAYS,

    // --- courses -----------------------------------------------------------

    async listCourses() {
      return (await ownedCourses()).slice().sort((a, b) => a.code.localeCompare(b.code));
    },

    async findCourse(courseId) {
      const id = Number(courseId);
      if (!Number.isInteger(id)) return null;
      return (await ownedCourses()).find((row) => Number(row.id) === id) || null;
    },

    /** By code — the handle the tools pillar's `requiresCertification` uses. */
    async findCourseByCode(code) {
      if (typeof code !== "string") return null;
      return (await ownedCourses()).find((row) => row.code === code) || null;
    },

    async defineCourse(input) {
      context.assertWritableIdentity();

      // Known roles come from the profiles SERVICE, not from a require() into its
      // directory: §11's convention is that a pillar reaches another through
      // `context.services.<name>`, so the dependency is greppable at runtime rather
      // than baked in at module load. `profiles` is a hard dependency of this
      // pillar, so the registry guarantees it is there.
      const fieldErrors = validateCourseInput(input, context.services.profiles?.ROLES);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const nowIso = clock.nowIso();
      const result = await transact(store, (document) => {
        const taken = document.courses.some((row) => Number(row.userId) === userId && row.code === input.code);
        if (taken) {
          // A course code is what the tools pillar's certification gate refers to.
          // Two courses answering to one code would make every gate check ambiguous
          // — and the safe reading of an ambiguous safety check is "refuse", so the
          // duplicate would quietly start blocking tool issues.
          return {
            document,
            result: {
              outcome: "VALIDATION_FAILED",
              fieldErrors: [{ field: "code", message: `Course code "${input.code}" is already in use.` }],
            },
          };
        }

        const nextId = document.counters.lastCourseId + 1;
        const course = {
          id: nextId,
          userId,
          code: input.code,
          name: input.name,
          provider: input.provider ?? null,
          validMonths: normaliseValidMonths(input.validMonths),
          // Stored lower_snake_case per §6.4; the resolvers translate to CrewRole.
          mandatoryForRoles: [...new Set((input.mandatoryForRoles || []).map((role) => String(role).toLowerCase()))].sort(),
          academyExamId: input.academyExamId ?? null,
          createdAt: nowIso,
        };
        return {
          document: {
            ...document,
            courses: [...document.courses, course],
            counters: { ...document.counters, lastCourseId: nextId },
          },
          result: { outcome: "DEFINED", course },
        };
      });

      if (result.outcome === "DEFINED") invalidate();
      return result;
    },

    // --- enrollments -------------------------------------------------------

    async listEnrollments({ status, staffId, courseId } = {}) {
      const rows = await ownedEnrollments();
      return rows
        .filter((row) => (status ? row.status === status : true))
        .filter((row) => (staffId === undefined || staffId === null ? true : Number(row.staffId) === Number(staffId)))
        .filter((row) => (courseId === undefined || courseId === null ? true : Number(row.courseId) === Number(courseId)))
        .slice()
        .sort((a, b) => Number(a.id) - Number(b.id));
    },

    async findEnrollment(enrollmentId) {
      const id = Number(enrollmentId);
      if (!Number.isInteger(id)) return null;
      return (await ownedEnrollments()).find((row) => Number(row.id) === id) || null;
    },

    async enroll(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateEnrollmentInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      // Throws MEMBER_NOT_FOUND for an unknown, unowned or orphaned staff id.
      await requireMember(input.staffId);

      const course = await service.findCourse(input.courseId);
      if (!course) return { outcome: "COURSE_NOT_FOUND", courseId: String(input.courseId) };

      const nowIso = clock.nowIso();
      const numericStaffId = Number(input.staffId);

      const result = await transact(store, (document) => {
        // A second live booking on the same course is almost always a
        // double-entry, and allowing it would make "the latest enrollment" — what
        // the matrix shows in an amber cell — ambiguous. Re-enrolling after a
        // pass, a fail or a cancellation is fine and is how re-certification works.
        const live = document.enrollments.find(
          (row) =>
            Number(row.userId) === userId &&
            Number(row.staffId) === numericStaffId &&
            Number(row.courseId) === Number(course.id) &&
            LIVE_ENROLLMENT_STATUSES.includes(row.status),
        );
        if (live) return { document, result: { outcome: "ALREADY_ENROLLED", enrollmentId: String(live.id), status: live.status } };

        const nextId = document.counters.lastEnrollmentId + 1;
        const enrollment = {
          id: nextId,
          userId,
          staffId: numericStaffId,
          courseId: Number(course.id),
          status: "planned",
          scheduledFor: input.scheduledFor ?? null,
          completedOn: null,
          score: null,
          note: input.note ?? null,
          certificationId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        };
        return {
          document: {
            ...document,
            enrollments: [...document.enrollments, enrollment],
            counters: { ...document.counters, lastEnrollmentId: nextId },
          },
          result: { outcome: "ENROLLED", enrollment },
        };
      });

      if (result.outcome === "ENROLLED") invalidate();
      return result;
    },

    /**
     * Move an enrollment through its lifecycle, minting on a pass (rule 2).
     *
     * The mint is inside the same transaction as the transition check, which is
     * what makes "one pass ⇒ one certificate" true under concurrency rather than
     * usually true.
     */
    async recordOutcome(input) {
      context.assertWritableIdentity();

      const fieldErrors = validateOutcomeInput(input);
      if (fieldErrors.length > 0) return { outcome: "VALIDATION_FAILED", fieldErrors };

      const numericEnrollmentId = Number(input.enrollmentId);
      const target = String(input.outcome).toLowerCase();
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const index = document.enrollments.findIndex((row) => Number(row.id) === numericEnrollmentId && Number(row.userId) === userId);
        if (index === -1) return { document, result: { outcome: "ENROLLMENT_NOT_FOUND", enrollmentId: String(input.enrollmentId) } };

        const current = document.enrollments[index];
        const allowed = ENROLLMENT_TRANSITIONS[current.status] || [];
        if (!allowed.includes(target)) {
          return {
            document,
            result: {
              outcome: "ILLEGAL_TRANSITION",
              enrollmentId: String(input.enrollmentId),
              from: current.status,
              to: target,
              allowed,
            },
          };
        }

        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          Number(input.expectedVersion) !== Number(current.version)
        ) {
          throw versionConflict(current.staffId, Number(input.expectedVersion), Number(current.version));
        }

        const course = document.courses.find((row) => Number(row.id) === Number(current.courseId) && Number(row.userId) === userId);
        // A completion date is what a certificate's validity runs from, so a pass
        // without one has nothing to compute an expiry against.
        const completedOn = target === "passed" || target === "failed" ? (input.completedOn ?? nowIso.slice(0, 10)) : current.completedOn;

        const updated = {
          ...current,
          status: target,
          completedOn,
          score: input.score === undefined || input.score === null ? current.score : Number(input.score),
          note: input.note === undefined ? current.note : input.note,
          updatedAt: nowIso,
          version: Number(current.version) + 1,
        };

        const enrollments = [...document.enrollments];
        let certifications = document.certifications;
        let counters = document.counters;
        let certification = null;

        if (target === "passed") {
          const nextCertificationId = counters.lastCertificationId + 1;
          certification = {
            id: nextCertificationId,
            userId,
            staffId: Number(current.staffId),
            courseId: Number(current.courseId),
            enrollmentId: Number(current.id),
            issuedOn: completedOn,
            // Null for a course with no `validMonths` — a certificate for life.
            expiresOn: expiryDateFor(completedOn, course?.validMonths),
            reference: input.reference ?? null,
            revokedOn: null,
            revokedReason: null,
            createdAt: nowIso,
          };
          certifications = [...certifications, certification];
          counters = { ...counters, lastCertificationId: nextCertificationId };
          updated.certificationId = nextCertificationId;
        }

        enrollments[index] = updated;
        return {
          document: { ...document, enrollments, certifications, counters },
          result: { outcome: "RECORDED", enrollment: updated, certification },
        };
      });

      if (result.outcome === "RECORDED") invalidate();
      return result;
    },

    // --- certifications ----------------------------------------------------

    async listCertifications({ staffId, status, includeSuperseded = true } = {}) {
      const rows = await ownedCertifications();
      const day = today();

      return rows
        .filter((row) => (staffId === undefined || staffId === null ? true : Number(row.staffId) === Number(staffId)))
        .filter((row) => (includeSuperseded ? true : !isSuperseded(row, rows)))
        .filter((row) => (status ? certificationStatus(row, day) === status : true))
        .slice()
        .sort((a, b) => (a.issuedOn === b.issuedOn ? Number(b.id) - Number(a.id) : b.issuedOn.localeCompare(a.issuedOn)));
    },

    async findCertification(certificationId) {
      const id = Number(certificationId);
      if (!Number.isInteger(id)) return null;
      return (await ownedCertifications()).find((row) => Number(row.id) === id) || null;
    },

    /** Computed status. Exposed so resolvers never re-derive it a second way. */
    statusOf(certification) {
      return certificationStatus(certification, today());
    },

    daysUntilExpiryOf(certification) {
      return daysUntilExpiry(certification, today());
    },

    async isSupersededCertification(certification) {
      return isSuperseded(certification, await ownedCertifications());
    },

    /**
     * Void a certificate. Terminal (§8.4).
     *
     * Not repeatable, and never reversed: a revoked ticket is replaced by a new
     * pass, not reinstated. Reinstating would mean the reason it was voided had
     * been erased, which is the one thing a safety record must not allow.
     */
    async revokeCertification({ certificationId, reason }) {
      context.assertWritableIdentity();

      if (typeof reason !== "string" || reason.trim().length === 0) {
        return { outcome: "VALIDATION_FAILED", fieldErrors: [{ field: "reason", message: "A revocation needs a reason." }] };
      }

      const numericId = Number(certificationId);
      const day = today();
      const nowIso = clock.nowIso();

      const result = await transact(store, (document) => {
        const index = document.certifications.findIndex((row) => Number(row.id) === numericId && Number(row.userId) === userId);
        if (index === -1) return { document, result: { outcome: "NOT_FOUND", certificationId: String(certificationId) } };

        const current = document.certifications[index];
        if (current.revokedOn) {
          return {
            document,
            result: {
              outcome: "ALREADY_REVOKED",
              certificationId: String(certificationId),
              revokedOn: current.revokedOn,
              revokedReason: current.revokedReason ?? null,
            },
          };
        }

        const updated = { ...current, revokedOn: day, revokedReason: reason.trim(), revokedAt: nowIso };
        const certifications = [...document.certifications];
        certifications[index] = updated;
        return { document: { ...document, certifications }, result: { outcome: "REVOKED", certification: updated } };
      });

      if (result.outcome === "REVOKED") {
        invalidate();
        // What revoking just opened up. Voiding a chainsaw ticket is exactly the
        // moment somebody needs to know the member is now non-compliant, and
        // making them run a second query for it invites nobody running it.
        result.gaps = await service.gapsFor(result.certification.staffId);
      }
      return result;
    },

    // --- compliance --------------------------------------------------------

    /**
     * Certificates running out inside a window, across the crew or one member.
     *
     * Already-expired ones are INCLUDED: a list called "expiring" that hid the
     * ones that had already lapsed would be the most dangerous possible report,
     * because the rows it omits are the urgent ones.
     */
    async expiring({ withinDays, staffId } = {}) {
      const window = withinDays === undefined || withinDays === null ? EXPIRING_SOON_DAYS : Math.max(0, Number(withinDays));
      const day = today();
      const rows = await ownedCertifications();

      return (
        rows
          .filter((row) => (staffId === undefined || staffId === null ? true : Number(row.staffId) === Number(staffId)))
          .filter((row) => !row.revokedOn)
          // Superseded rows are dropped here, unlike in `listCertifications`: a
          // re-certified member is not expiring, and showing last year's ticket in a
          // "renew these" list would send them on a course they have already sat.
          .filter((row) => !isSuperseded(row, rows))
          .filter((row) => {
            const left = daysUntilExpiry(row, day);
            return left !== null && left <= window;
          })
          .slice()
          .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      );
    },

    /** One member's mandatory-course gaps. */
    async gapsFor(staffId) {
      const member = await requireMember(staffId, { allowOrphaned: true });
      return gapsForMember({
        member,
        courses: await ownedCourses(),
        certifications: await ownedCertifications(),
        today: today(),
      });
    },

    /** Every gap across the crew, grouped by nothing — a flat list is what a page renders. */
    async allGaps() {
      const members = await context.services.profiles.listCrew();
      const courses = await ownedCourses();
      const certifications = await ownedCertifications();
      const day = today();

      const gaps = [];
      for (const member of members) {
        gaps.push(...gapsForMember({ member, courses, certifications, today: day }));
      }
      return gaps.sort((a, b) => (a.staffId === b.staffId ? a.course.code.localeCompare(b.course.code) : a.staffId - b.staffId));
    },

    async compliantFor(staffId) {
      return (await service.gapsFor(staffId)).length === 0;
    },

    /** The crew × course grid (§8.4). One read of each store, whatever the crew size. */
    async matrix() {
      const members = await context.services.profiles.listCrew();
      const matrix = buildMatrix({
        members,
        courses: await ownedCourses(),
        certifications: await ownedCertifications(),
        enrollments: await ownedEnrollments(),
        today: today(),
      });

      const rows = matrix.rows.map((row) => ({
        ...row,
        gapCount: row.cells.filter((cell) => cell.mandatory && !cell.compliant).length,
      }));
      return {
        courses: matrix.courses,
        rows,
        totalGaps: rows.reduce((total, row) => total + row.gapCount, 0),
      };
    },

    /**
     * The cross-pillar seam the tools pillar's certification gate uses (§8.5).
     *
     * **FAIL-CLOSED, and that is the whole point.** Three outcomes:
     *
     *   - `PERMITTED` — the member holds a certificate that has not run out;
     *   - `NOT_CERTIFIED` — the check ran and the answer is no. `status` says why:
     *     null for never certified, `expired`, or `revoked`;
     *   - `UNAVAILABLE` — the check could not be EVALUATED at all: no course
     *     answers to that code, the code is unusable, or the store could not be
     *     read. The caller must treat this as a refusal, never as a pass. §8.5 is
     *     explicit that failing open here would be a safety bug, and the mistake it
     *     guards against is the natural one — an empty result read as "no objection".
     *
     * Note that `expiring_soon` PERMITS. It has not run out; a ticket with three
     * weeks left is still a ticket, and refusing on it would ground the crew for the
     * length of the notice window every cycle.
     *
     * @param {number|string} staffId
     * @param {string} courseCode - a `Course.code`
     */
    async evaluateCertification(staffId, courseCode) {
      let course;
      try {
        if (typeof courseCode !== "string" || courseCode.trim().length === 0) {
          return { outcome: "UNAVAILABLE", reason: "NO_COURSE_CODE", detail: "No certification course code was given." };
        }
        course = await service.findCourseByCode(courseCode);
      } catch (error) {
        // An unreadable store is the case §8.5 names explicitly. Refuse.
        return { outcome: "UNAVAILABLE", reason: "STORE_UNREADABLE", detail: error.message };
      }

      if (!course) {
        return {
          outcome: "UNAVAILABLE",
          reason: "COURSE_NOT_DEFINED",
          detail: `No course is defined with code "${courseCode}", so the certification cannot be checked.`,
          courseCode,
        };
      }

      let certifications;
      try {
        certifications = await ownedCertifications();
      } catch (error) {
        return { outcome: "UNAVAILABLE", reason: "STORE_UNREADABLE", detail: error.message, course };
      }

      const certification = currentCertification(certifications, staffId, course.id);
      const status = certificationStatus(certification, today());

      if (permitsWork(status)) return { outcome: "PERMITTED", course, certification, status };
      return { outcome: "NOT_CERTIFIED", course, certification, status };
    },

    /** Rows referencing a staff member who no longer exists (§12 rule 4). */
    async findOrphanedOverlays() {
      const staffRecords = await context.loaders.ownedStaff.get();
      const live = new Set(staffRecords.map((staff) => Number(staff.id)));

      const orphans = [];
      for (const enrollment of await ownedEnrollments()) {
        if (live.has(Number(enrollment.staffId))) continue;
        orphans.push({
          staffId: String(enrollment.staffId),
          rowId: String(enrollment.id),
          detail: `Enrollment ${enrollment.id} references a deleted staff record.`,
        });
      }
      for (const certification of await ownedCertifications()) {
        if (live.has(Number(certification.staffId))) continue;
        orphans.push({
          staffId: String(certification.staffId),
          rowId: String(certification.id),
          detail: `Certification ${certification.id} references a deleted staff record.`,
        });
      }
      return orphans;
    },

    /** The latest enrollment a member has on a course, for the matrix cell. */
    async latestEnrollment(staffId, courseId) {
      return latestEnrollmentFor(await ownedEnrollments(), staffId, courseId);
    },

    /** The certificate that currently counts for a member on a course. */
    async currentCertificationFor(staffId, courseId) {
      return currentCertification(await ownedCertifications(), staffId, courseId);
    },
  };

  return service;
}

// --- pure helpers -----------------------------------------------------------

/** Null (a certificate for life) or a positive whole number of months. */
function normaliseValidMonths(value) {
  if (value === undefined || value === null || value === "") return null;
  const months = Number(value);
  return Number.isInteger(months) && months > 0 ? months : null;
}

/**
 * @param {object} input
 * @param {string[]} [knownRoles] - the profiles service's `ROLES`. Omitted ⇒ the
 *   role check is skipped, which is safe because `mandatoryForRoles: [CrewRole!]`
 *   in the SDL means `graphql-js` has already rejected an unknown role before a
 *   resolver ran. This layer is defence in depth for a non-GraphQL caller, not the
 *   only gate.
 */
function validateCourseInput(input, knownRoles) {
  const fieldErrors = [];

  if (typeof input.code !== "string" || !CODE_PATTERN.test(input.code)) {
    fieldErrors.push({ field: "code", message: "code must be lower_snake_case, 2–40 characters, starting with a letter." });
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 120) {
    fieldErrors.push({ field: "name", message: "name is required and must be at most 120 characters." });
  }
  if (input.provider !== undefined && input.provider !== null && String(input.provider).length > 120) {
    fieldErrors.push({ field: "provider", message: "provider must be at most 120 characters." });
  }

  if (input.validMonths !== undefined && input.validMonths !== null) {
    const months = Number(input.validMonths);
    if (!Number.isInteger(months) || months < 1 || months > MAX_VALID_MONTHS) {
      // Zero is refused rather than read as "for life": a caller who meant a
      // certificate for life omits the field, and one who typed 0 made a mistake
      // that would otherwise create a permanent ticket.
      fieldErrors.push({
        field: "validMonths",
        message: `validMonths must be a whole number between 1 and ${MAX_VALID_MONTHS}, or omitted.`,
      });
    }
  }

  if (Array.isArray(knownRoles) && knownRoles.length > 0) {
    for (const role of input.mandatoryForRoles || []) {
      if (!knownRoles.includes(String(role).toUpperCase())) {
        fieldErrors.push({ field: "mandatoryForRoles", message: `"${role}" is not a known CrewRole.` });
        break;
      }
    }
  }

  if (input.academyExamId !== undefined && input.academyExamId !== null && String(input.academyExamId).length > 80) {
    fieldErrors.push({ field: "academyExamId", message: "academyExamId must be at most 80 characters." });
  }
  return fieldErrors;
}

function validateEnrollmentInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.staffId))) fieldErrors.push({ field: "staffId", message: "staffId is required." });
  if (!Number.isInteger(Number(input.courseId))) fieldErrors.push({ field: "courseId", message: "courseId is required." });
  if (input.scheduledFor !== undefined && input.scheduledFor !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) {
    fieldErrors.push({ field: "scheduledFor", message: "scheduledFor must be YYYY-MM-DD." });
  }
  return fieldErrors;
}

function validateOutcomeInput(input) {
  const fieldErrors = [];
  if (!Number.isInteger(Number(input.enrollmentId))) {
    fieldErrors.push({ field: "enrollmentId", message: "enrollmentId is required." });
  }

  const outcome = String(input.outcome || "").toLowerCase();
  if (!["in_progress", "passed", "failed", "cancelled"].includes(outcome)) {
    fieldErrors.push({ field: "outcome", message: "outcome must be IN_PROGRESS, PASSED, FAILED or CANCELLED." });
  }

  if (input.completedOn !== undefined && input.completedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn)) {
    fieldErrors.push({ field: "completedOn", message: "completedOn must be YYYY-MM-DD." });
  }
  if (outcome === "passed" && (input.completedOn === undefined || input.completedOn === null)) {
    // Not fatal — the service falls back to today — but a caller recording a
    // historical pass without a date would silently get today's validity window,
    // which is the difference between a ticket that is current and one that lapsed
    // two years ago. Better to be told.
    fieldErrors.push({ field: "completedOn", message: "completedOn is required for a PASSED outcome — it is what validity runs from." });
  }

  if (input.score !== undefined && input.score !== null) {
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
      fieldErrors.push({ field: "score", message: `score must be between 0 and ${MAX_SCORE}.` });
    }
  }

  if (input.reference !== undefined && input.reference !== null && String(input.reference).length > 80) {
    fieldErrors.push({ field: "reference", message: "reference must be at most 80 characters." });
  }
  return fieldErrors;
}

module.exports = {
  createTrainingService,
  validateCourseInput,
  validateEnrollmentInput,
  validateOutcomeInput,
  normaliseValidMonths,
  ENROLLMENT_TRANSITIONS,
  LIVE_ENROLLMENT_STATUSES,
  MAX_VALID_MONTHS,
  MAX_SCORE,
};
