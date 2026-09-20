/**
 * Training resolvers (PRD §8.4).
 *
 * Thin, like the three pillars before it: take arguments, call the per-request
 * service, shape the answer into a union member. No scoping and no validation here
 * — those live in the service so a different transport cannot skip them (§9).
 *
 * As in the leave pillar, this file owns the ONE translation the pillar needs: the
 * store speaks lower_snake_case (`"in_progress"`, `"expiring_soon"`, and
 * `mandatoryForRoles: ["agronomist"]`) because that is what §6.4 writes to disk,
 * and the graph speaks SCREAMING_CASE because that is what a GraphQL enum is.
 *
 * The one resolver worth reading carefully is `Course.academyCertificate`, and the
 * thing to notice is what it does NOT do: it has no error path. Every failure of
 * the external link — flag off, academy down, nothing found — is `null`, because a
 * training matrix must render whether or not a separate ecosystem is running (§8.4).
 */
const { CrewError, CREW_ERROR_CODES } = require("../../errors");

/** `"IN_PROGRESS"` → `"in_progress"`. Undefined and null pass through untouched. */
const toStoreEnum = (value) => (typeof value === "string" ? value.toLowerCase() : value);

/** `"expiring_soon"` → `"EXPIRING_SOON"`. */
const toGraphEnum = (value) => (typeof value === "string" ? value.toUpperCase() : value);

/** Map a thrown CrewError onto a training union member, or rethrow if not ours. */
function toUnionMember(error) {
  if (!(error instanceof CrewError)) throw error;

  if (error.code === CREW_ERROR_CODES.VALIDATION_FAILED) {
    return { __typename: "TrainingValidationFailed", fieldErrors: error.extensions.fieldErrors || [] };
  }
  if (error.code === CREW_ERROR_CODES.VERSION_CONFLICT) {
    return {
      __typename: "VersionConflict",
      staffId: String(error.extensions.staffId),
      expectedVersion: error.extensions.expectedVersion,
      actualVersion: error.extensions.actualVersion,
    };
  }
  // MEMBER_NOT_FOUND stays an error with a code (§15), as it does everywhere else
  // in this module — existence is not disclosed, and it is not a training outcome.
  throw error;
}

function enrollOutcome(result) {
  switch (result.outcome) {
    case "ENROLLED":
      return { __typename: "CrewMemberEnrolled", enrollment: result.enrollment };
    case "COURSE_NOT_FOUND":
      return { __typename: "CourseNotFound", courseId: result.courseId, code: null };
    case "ALREADY_ENROLLED":
      return { __typename: "AlreadyEnrolled", enrollmentId: result.enrollmentId, status: toGraphEnum(result.status) };
    default:
      return { __typename: "TrainingValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function outcomeResult(result) {
  switch (result.outcome) {
    case "RECORDED":
      // `certification` is null for anything but a pass — the difference between
      // "did not qualify" and "was never assessed" is visible in the type.
      return { __typename: "TrainingOutcomeRecorded", enrollment: result.enrollment, certification: result.certification ?? null };
    case "ENROLLMENT_NOT_FOUND":
      return { __typename: "EnrollmentNotFound", enrollmentId: result.enrollmentId };
    case "ILLEGAL_TRANSITION":
      return {
        __typename: "IllegalEnrollmentTransition",
        enrollmentId: result.enrollmentId,
        from: toGraphEnum(result.from),
        to: toGraphEnum(result.to),
        allowed: (result.allowed || []).map(toGraphEnum),
      };
    default:
      return { __typename: "TrainingValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

function revokeOutcome(result) {
  switch (result.outcome) {
    case "REVOKED":
      return { __typename: "CertificationRevoked", certification: result.certification, gaps: result.gaps || [] };
    case "NOT_FOUND":
      return { __typename: "CertificationNotFound", certificationId: result.certificationId };
    case "ALREADY_REVOKED":
      return {
        __typename: "CertificationAlreadyRevoked",
        certificationId: result.certificationId,
        revokedOn: result.revokedOn,
        revokedReason: result.revokedReason,
      };
    default:
      return { __typename: "TrainingValidationFailed", fieldErrors: result.fieldErrors || [] };
  }
}

const resolvers = {
  Query: {
    courses: (_source, _args, context) => context.services.training.listCourses(),

    course: (_source, { code }, context) => context.services.training.findCourseByCode(code),

    /**
     * The academy link's state, for a page to explain itself with.
     *
     * `probe` is false when nothing references an academy exam: a farm that never
     * uses the link should not pay for a network call to be told so. Note the check
     * reads the caller's OWN courses, so the answer is scoped like everything else.
     */
    academyLink: async (_source, _args, context) => {
      const courses = await context.services.training.listCourses();
      const linkedCourses = courses.filter((course) => Boolean(course.academyExamId)).length;
      const status = await context.academyGateway.status({ userId: context.userId, probe: linkedCourses > 0 });
      return { ...status, linkedCourses };
    },

    trainingMatrix: (_source, _args, context) => context.services.training.matrix(),

    expiringCertifications: (_source, { withinDays }, context) => context.services.training.expiring({ withinDays }),

    complianceGaps: (_source, _args, context) => context.services.training.allGaps(),

    enrollments: (_source, { status, staffId, courseId }, context) =>
      context.services.training.listEnrollments({ status: toStoreEnum(status), staffId, courseId }),
  },

  Mutation: {
    defineCourse: async (_source, { input }, context) => {
      try {
        const result = await context.services.training.defineCourse(input);
        if (result.outcome === "DEFINED") return { __typename: "CourseDefined", course: result.course };
        return { __typename: "TrainingValidationFailed", fieldErrors: result.fieldErrors || [] };
      } catch (error) {
        return toUnionMember(error);
      }
    },

    enrollCrewMember: async (_source, { input }, context) => {
      // No try/catch swallowing MEMBER_NOT_FOUND: an unknown member is an error
      // with a code, not an enrollment outcome. `MemberNotFound` is in the union so
      // a caller CAN branch on it, and the service reaches it by returning rather
      // than throwing — see below.
      try {
        return enrollOutcome(await context.services.training.enroll(input));
      } catch (error) {
        if (error instanceof CrewError && error.code === CREW_ERROR_CODES.MEMBER_NOT_FOUND) {
          return { __typename: "MemberNotFound", staffId: String(error.extensions.staffId) };
        }
        return toUnionMember(error);
      }
    },

    recordTrainingOutcome: async (_source, { input }, context) => {
      try {
        return outcomeResult(await context.services.training.recordOutcome(input));
      } catch (error) {
        return toUnionMember(error);
      }
    },

    revokeCertification: async (_source, { certificationId, reason }, context) => {
      try {
        return revokeOutcome(await context.services.training.revokeCertification({ certificationId, reason }));
      } catch (error) {
        return toUnionMember(error);
      }
    },
  },

  // The pillar's one field on the join point. `source` is the CrewMember, passed
  // straight through — the summary's fields do the work lazily, so a query
  // selecting only `compliant` never builds a certificate list.
  CrewMember: {
    training: (member) => ({ staffId: member.staffId }),
  },

  TrainingSummary: {
    certifications: (summary, { status, includeSuperseded }, context) =>
      context.services.training.listCertifications({
        staffId: summary.staffId,
        status: toStoreEnum(status),
        includeSuperseded: includeSuperseded === undefined || includeSuperseded === null ? true : includeSuperseded,
      }),

    enrollments: (summary, { status }, context) =>
      context.services.training.listEnrollments({ staffId: summary.staffId, status: toStoreEnum(status) }),

    expiringSoon: (summary, { withinDays }, context) => context.services.training.expiring({ withinDays, staffId: summary.staffId }),

    complianceGaps: (summary, _args, context) => context.services.training.gapsFor(summary.staffId),

    compliant: (summary, _args, context) => context.services.training.compliantFor(summary.staffId),
  },

  Course: {
    id: (course) => String(course.id),
    mandatoryForRoles: (course) => (course.mandatoryForRoles || []).map(toGraphEnum),

    /**
     * The optional AgriAcademy link (§8.4).
     *
     * Deliberately has no failure path. The gateway resolves to data or to null,
     * and every reason for null — flag off, academy offline, no such certificate —
     * is indistinguishable here on purpose: a matrix has nothing useful to do with
     * the difference, and five ways of saying "no link" in the graph would be five
     * things for a client to handle and get wrong.
     */
    academyCertificate: (course, _args, context) => {
      if (!course.academyExamId) return null;
      return context.academyGateway.certificateForExam(context.userId, course.academyExamId);
    },
  },

  Enrollment: {
    id: (enrollment) => String(enrollment.id),
    staffId: (enrollment) => String(enrollment.staffId),
    status: (enrollment) => toGraphEnum(enrollment.status),
    course: (enrollment, _args, context) => context.services.training.findCourse(enrollment.courseId),
    certification: (enrollment, _args, context) =>
      enrollment.certificationId ? context.services.training.findCertification(enrollment.certificationId) : null,
  },

  Certification: {
    id: (certification) => String(certification.id),
    staffId: (certification) => String(certification.staffId),
    course: (certification, _args, context) => context.services.training.findCourse(certification.courseId),
    // Computed through the service so there is exactly one implementation of
    // "what state is this certificate in" — rule 1 in service.js.
    status: (certification, _args, context) => toGraphEnum(context.services.training.statusOf(certification)),
    daysUntilExpiry: (certification, _args, context) => context.services.training.daysUntilExpiryOf(certification),
    superseded: (certification, _args, context) => context.services.training.isSupersededCertification(certification),
  },

  ComplianceGap: {
    staffId: (gap) => String(gap.staffId),
    name: (gap) => gap.member?.staff?.name ?? null,
    surname: (gap) => gap.member?.staff?.surname ?? null,
    role: (gap) => toGraphEnum(gap.member?.profile?.role) ?? null,
  },

  TrainingMatrixRow: {
    staffId: (row) => String(row.staffId),
    name: (row) => row.member?.staff?.name ?? null,
    surname: (row) => row.member?.staff?.surname ?? null,
    role: (row) => toGraphEnum(row.role) ?? null,
  },

  TrainingMatrixCell: {
    status: (cell) => (cell.status === null || cell.status === undefined ? null : toGraphEnum(cell.status)),
  },

  DefineCourseResult: { __resolveType: (value) => value.__typename },
  EnrollCrewMemberResult: { __resolveType: (value) => value.__typename },
  RecordTrainingOutcomeResult: { __resolveType: (value) => value.__typename },
  RevokeCertificationResult: { __resolveType: (value) => value.__typename },
};

module.exports = { resolvers, enrollOutcome, outcomeResult, revokeOutcome, toUnionMember, toStoreEnum, toGraphEnum };
