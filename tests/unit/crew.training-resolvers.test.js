import { describe, it, expect } from "vitest";

// The training pillar's transport boundary (services/crew/pillars/training/resolvers.js).
//
// The pillar's two documented promises are what this file pins down:
//
//   1. the store/graph vocabulary translation happens here and only here, so a
//      stored `"in_progress"` can never leave as an invalid enum, and a
//      `mandatoryForRoles: ["agronomist"]` list is translated element by element;
//   2. `Course.academyCertificate` has NO error path — flag off, academy down and
//      nothing found are all `null`, because a training matrix has to render
//      whether or not a separate ecosystem is running.
const {
  resolvers,
  enrollOutcome,
  outcomeResult,
  revokeOutcome,
  toUnionMember,
  toStoreEnum,
  toGraphEnum,
} = require("../../services/crew/pillars/training/resolvers");
const { CrewError, CREW_ERROR_CODES } = require("../../services/crew/errors");
const { unionMembers } = require("../helpers/crew-sdl");

const trainingUnion = (name) => unionMembers("training", name);
const crewError = (code, extensions = {}, message = "nope") => new CrewError(code, message, extensions);

describe("training resolvers — enum translation", () => {
  it("translates in both directions, including multi-word values", () => {
    expect(toStoreEnum("IN_PROGRESS")).toBe("in_progress");
    expect(toGraphEnum("expiring_soon")).toBe("EXPIRING_SOON");
  });

  it("passes null and undefined through untouched", () => {
    expect(toStoreEnum(null)).toBeNull();
    expect(toStoreEnum(undefined)).toBeUndefined();
    expect(toGraphEnum(null)).toBeNull();
    expect(toGraphEnum(undefined)).toBeUndefined();
  });

  it("round-trips every enrollment and certification state", () => {
    for (const stored of ["enrolled", "in_progress", "passed", "failed", "cancelled", "valid", "expiring_soon", "expired", "revoked"]) {
      expect(toStoreEnum(toGraphEnum(stored))).toBe(stored);
    }
  });

  it("translates a course's mandatory roles element by element", () => {
    expect(resolvers.Course.mandatoryForRoles({ mandatoryForRoles: ["agronomist", "dairy_hand"] })).toEqual(["AGRONOMIST", "DAIRY_HAND"]);
  });

  it("defaults absent mandatory roles to an empty list, never null", () => {
    expect(resolvers.Course.mandatoryForRoles({})).toEqual([]);
    expect(resolvers.Course.mandatoryForRoles({ mandatoryForRoles: null })).toEqual([]);
  });

  it("stringifies every id the graph declares as ID!", () => {
    expect(resolvers.Course.id({ id: 3 })).toBe("3");
    expect(resolvers.Enrollment.id({ id: 4 })).toBe("4");
    expect(resolvers.Enrollment.staffId({ staffId: 5 })).toBe("5");
    expect(resolvers.Certification.id({ id: 6 })).toBe("6");
    expect(resolvers.Certification.staffId({ staffId: 7 })).toBe("7");
    expect(resolvers.ComplianceGap.staffId({ staffId: 8 })).toBe("8");
    expect(resolvers.TrainingMatrixRow.staffId({ staffId: 9 })).toBe("9");
  });

  it("translates the enrollment's status on the way out", () => {
    expect(resolvers.Enrollment.status({ status: "in_progress" })).toBe("IN_PROGRESS");
  });

  it("keeps a matrix cell's absent status null rather than uppercasing undefined", () => {
    expect(resolvers.TrainingMatrixCell.status({ status: null })).toBeNull();
    expect(resolvers.TrainingMatrixCell.status({})).toBeNull();
    expect(resolvers.TrainingMatrixCell.status({ status: "valid" })).toBe("VALID");
  });
});

describe("training resolvers — toUnionMember", () => {
  it("maps VALIDATION_FAILED onto TrainingValidationFailed", () => {
    const fieldErrors = [{ field: "code", message: "taken" }];

    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED, { fieldErrors }))).toEqual({
      __typename: "TrainingValidationFailed",
      fieldErrors,
    });
    expect(toUnionMember(crewError(CREW_ERROR_CODES.VALIDATION_FAILED)).fieldErrors).toEqual([]);
  });

  it("maps VERSION_CONFLICT onto VersionConflict with a stringified staffId", () => {
    const error = crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 2, expectedVersion: 1, actualVersion: 4 });

    expect(toUnionMember(error)).toEqual({
      __typename: "VersionConflict",
      staffId: "2",
      expectedVersion: 1,
      actualVersion: 4,
    });
  });

  it("rethrows MEMBER_NOT_FOUND — it is an error with a code, not a training outcome", () => {
    const error = crewError(CREW_ERROR_CODES.MEMBER_NOT_FOUND, { staffId: 1 });

    expect(() => toUnionMember(error)).toThrow(error);
  });

  it("rethrows every code it does not map, including LEAVE_POLICY_MISSING", () => {
    const mapped = [CREW_ERROR_CODES.VALIDATION_FAILED, CREW_ERROR_CODES.VERSION_CONFLICT];

    for (const code of Object.values(CREW_ERROR_CODES).filter((value) => !mapped.includes(value))) {
      expect(() => toUnionMember(crewError(code))).toThrow(CrewError);
    }
  });

  it("rethrows anything that is not a CrewError", () => {
    const boom = new TypeError("bad shape");
    expect(() => toUnionMember(boom)).toThrow(boom);
  });
});

describe("training resolvers — enrollOutcome", () => {
  it("maps ENROLLED onto CrewMemberEnrolled", () => {
    const enrollment = { id: 1, status: "enrolled" };

    expect(enrollOutcome({ outcome: "ENROLLED", enrollment })).toEqual({ __typename: "CrewMemberEnrolled", enrollment });
  });

  it("maps COURSE_NOT_FOUND, nulling the code the SDL also allows", () => {
    expect(enrollOutcome({ outcome: "COURSE_NOT_FOUND", courseId: 9 })).toEqual({
      __typename: "CourseNotFound",
      courseId: 9,
      code: null,
    });
  });

  it("translates the existing enrollment's status on ALREADY_ENROLLED", () => {
    expect(enrollOutcome({ outcome: "ALREADY_ENROLLED", enrollmentId: 4, status: "in_progress" })).toEqual({
      __typename: "AlreadyEnrolled",
      enrollmentId: 4,
      status: "IN_PROGRESS",
    });
  });

  it("falls through to TrainingValidationFailed", () => {
    expect(enrollOutcome({ outcome: "WHATEVER" })).toEqual({ __typename: "TrainingValidationFailed", fieldErrors: [] });
  });

  it("emits only members EnrollCrewMemberResult declares", () => {
    const declared = new Set(trainingUnion("EnrollCrewMemberResult"));
    const produced = [
      enrollOutcome({ outcome: "ENROLLED" }).__typename,
      enrollOutcome({ outcome: "COURSE_NOT_FOUND" }).__typename,
      enrollOutcome({ outcome: "ALREADY_ENROLLED" }).__typename,
      enrollOutcome({ outcome: "ANYTHING" }).__typename,
      // The fifth member is reached by the mutation's own catch, not the table.
      "MemberNotFound",
    ];

    for (const typename of produced) {
      expect(declared.has(typename)).toBe(true);
    }
    expect(declared.size).toBe(new Set(produced).size);
  });
});

describe("training resolvers — outcomeResult", () => {
  it("maps RECORDED and carries the minted certification", () => {
    const enrollment = { id: 2 };
    const certification = { id: 5 };

    expect(outcomeResult({ outcome: "RECORDED", enrollment, certification })).toEqual({
      __typename: "TrainingOutcomeRecorded",
      enrollment,
      certification,
    });
  });

  it("nulls the certification for a non-pass — 'did not qualify' is visible in the type", () => {
    expect(outcomeResult({ outcome: "RECORDED", enrollment: { id: 2 } }).certification).toBeNull();
    expect(outcomeResult({ outcome: "RECORDED", enrollment: { id: 2 }, certification: null }).certification).toBeNull();
  });

  it("maps ENROLLMENT_NOT_FOUND", () => {
    expect(outcomeResult({ outcome: "ENROLLMENT_NOT_FOUND", enrollmentId: 3 })).toEqual({
      __typename: "EnrollmentNotFound",
      enrollmentId: 3,
    });
  });

  it("translates from, to and the whole allowed list on an illegal transition", () => {
    expect(
      outcomeResult({ outcome: "ILLEGAL_TRANSITION", enrollmentId: 3, from: "passed", to: "in_progress", allowed: ["cancelled"] }),
    ).toEqual({
      __typename: "IllegalEnrollmentTransition",
      enrollmentId: 3,
      from: "PASSED",
      to: "IN_PROGRESS",
      allowed: ["CANCELLED"],
    });
  });

  it("defaults an absent allowed list to an empty array", () => {
    expect(outcomeResult({ outcome: "ILLEGAL_TRANSITION", enrollmentId: 3 }).allowed).toEqual([]);
  });

  it("falls through to TrainingValidationFailed", () => {
    expect(outcomeResult({ outcome: "NOPE", fieldErrors: [{ field: "x" }] })).toEqual({
      __typename: "TrainingValidationFailed",
      fieldErrors: [{ field: "x" }],
    });
  });

  it("emits only members RecordTrainingOutcomeResult declares", () => {
    const declared = new Set(trainingUnion("RecordTrainingOutcomeResult"));
    const produced = [
      outcomeResult({ outcome: "RECORDED", enrollment: {} }).__typename,
      outcomeResult({ outcome: "ENROLLMENT_NOT_FOUND" }).__typename,
      outcomeResult({ outcome: "ILLEGAL_TRANSITION" }).__typename,
      outcomeResult({ outcome: "OTHER" }).__typename,
      toUnionMember(crewError(CREW_ERROR_CODES.VERSION_CONFLICT, { staffId: 1 })).__typename,
    ];

    expect(new Set(produced)).toEqual(declared);
  });
});

describe("training resolvers — revokeOutcome", () => {
  it("maps REVOKED and reports the gaps revoking opened", () => {
    const certification = { id: 8 };

    expect(revokeOutcome({ outcome: "REVOKED", certification, gaps: [{ courseId: 1 }] })).toEqual({
      __typename: "CertificationRevoked",
      certification,
      gaps: [{ courseId: 1 }],
    });
  });

  it("defaults absent gaps to an empty list — revoking need not open one", () => {
    expect(revokeOutcome({ outcome: "REVOKED", certification: {} }).gaps).toEqual([]);
  });

  it("maps NOT_FOUND", () => {
    expect(revokeOutcome({ outcome: "NOT_FOUND", certificationId: 4 })).toEqual({
      __typename: "CertificationNotFound",
      certificationId: 4,
    });
  });

  it("maps ALREADY_REVOKED, keeping the original date and reason", () => {
    expect(
      revokeOutcome({ outcome: "ALREADY_REVOKED", certificationId: 4, revokedOn: "2026-05-01", revokedReason: "expired kit" }),
    ).toEqual({
      __typename: "CertificationAlreadyRevoked",
      certificationId: 4,
      revokedOn: "2026-05-01",
      revokedReason: "expired kit",
    });
  });

  it("emits exactly the members RevokeCertificationResult declares", () => {
    const produced = [
      revokeOutcome({ outcome: "REVOKED", certification: {} }).__typename,
      revokeOutcome({ outcome: "NOT_FOUND" }).__typename,
      revokeOutcome({ outcome: "ALREADY_REVOKED" }).__typename,
      revokeOutcome({ outcome: "ELSE" }).__typename,
    ];

    expect(new Set(produced)).toEqual(new Set(trainingUnion("RevokeCertificationResult")));
  });
});

describe("training resolvers — Course.academyCertificate has no error path", () => {
  const gatewayThat = (behaviour) => ({ userId: 1, academyGateway: { certificateForExam: behaviour } });

  it("returns null without calling the gateway when the course has no academy exam", () => {
    let called = false;
    const context = gatewayThat(() => {
      called = true;
      return { id: 1 };
    });

    expect(resolvers.Course.academyCertificate({ academyExamId: null }, {}, context)).toBeNull();
    expect(resolvers.Course.academyCertificate({}, {}, context)).toBeNull();
    expect(called).toBe(false);
  });

  it("asks the gateway with the caller's own userId when the course is linked", async () => {
    const seen = [];
    const context = gatewayThat((userId, examId) => {
      seen.push([userId, examId]);
      return { id: "cert-1" };
    });

    await resolvers.Course.academyCertificate({ academyExamId: "exam-7" }, {}, context);
    expect(seen).toEqual([[1, "exam-7"]]);
  });

  it("passes a gateway null straight through — 'no link' has one spelling", async () => {
    const context = gatewayThat(async () => null);

    await expect(resolvers.Course.academyCertificate({ academyExamId: "exam-7" }, {}, context)).resolves.toBeNull();
  });
});

describe("training resolvers — query and summary plumbing", () => {
  const contextWith = (training, extra = {}) => ({ services: { training }, ...extra });

  it("translates the status filter on enrollments and leaves ids alone", async () => {
    const context = contextWith({ listEnrollments: async (args) => args });

    const passed = await resolvers.Query.enrollments(null, { status: "IN_PROGRESS", staffId: "3", courseId: "9" }, context);
    expect(passed).toEqual({ status: "in_progress", staffId: "3", courseId: "9" });
  });

  it("passes only the staffId to the training summary, so nothing is computed eagerly", () => {
    expect(resolvers.CrewMember.training({ staffId: 4, profile: { note: "unused" } })).toEqual({ staffId: 4 });
  });

  it("defaults includeSuperseded to true when the argument is omitted or null", async () => {
    const seen = [];
    const context = contextWith({
      listCertifications: async (args) => {
        seen.push(args);
        return [];
      },
    });

    await resolvers.TrainingSummary.certifications({ staffId: 1 }, {}, context);
    await resolvers.TrainingSummary.certifications({ staffId: 1 }, { includeSuperseded: null }, context);
    await resolvers.TrainingSummary.certifications({ staffId: 1 }, { includeSuperseded: false }, context);

    expect(seen.map((args) => args.includeSuperseded)).toEqual([true, true, false]);
  });

  it("scopes the summary's certifications to its own staffId and translates the status", async () => {
    let seen = null;
    const context = contextWith({
      listCertifications: async (args) => {
        seen = args;
        return [];
      },
    });

    await resolvers.TrainingSummary.certifications({ staffId: 12 }, { status: "EXPIRING_SOON" }, context);
    expect(seen).toMatchObject({ staffId: 12, status: "expiring_soon" });
  });

  it("counts linked courses before asking the academy whether to probe", async () => {
    const seen = [];
    const context = contextWith(
      {
        listCourses: async () => [{ academyExamId: "e1" }, { academyExamId: null }, { academyExamId: "e2" }],
      },
      {
        userId: 5,
        academyGateway: {
          status: async (args) => {
            seen.push(args);
            return { reachable: true };
          },
        },
      },
    );

    const result = await resolvers.Query.academyLink(null, {}, context);
    expect(seen).toEqual([{ userId: 5, probe: true }]);
    expect(result).toEqual({ reachable: true, linkedCourses: 2 });
  });

  it("does not probe the academy when nothing references an exam", async () => {
    const seen = [];
    const context = contextWith(
      { listCourses: async () => [{ academyExamId: null }, {}] },
      {
        userId: 5,
        academyGateway: {
          status: async (args) => {
            seen.push(args);
            return { reachable: false };
          },
        },
      },
    );

    const result = await resolvers.Query.academyLink(null, {}, context);
    expect(seen).toEqual([{ userId: 5, probe: false }]);
    expect(result.linkedCourses).toBe(0);
  });

  it("resolves the certification's status through the service, so there is one implementation", () => {
    const context = contextWith({ statusOf: () => "expiring_soon" });

    expect(resolvers.Certification.status({ id: 1 }, {}, context)).toBe("EXPIRING_SOON");
  });

  it("nulls an enrollment's certification when nothing was minted", () => {
    const context = contextWith({ findCertification: () => ({ id: 9 }) });

    expect(resolvers.Enrollment.certification({ certificationId: null }, {}, context)).toBeNull();
    expect(resolvers.Enrollment.certification({ certificationId: 9 }, {}, context)).toEqual({ id: 9 });
  });

  it("reads a compliance gap's display fields defensively", () => {
    expect(resolvers.ComplianceGap.name({})).toBeNull();
    expect(resolvers.ComplianceGap.surname({ member: {} })).toBeNull();
    expect(resolvers.ComplianceGap.role({ member: { profile: {} } })).toBeNull();
    expect(resolvers.ComplianceGap.role({ member: { profile: { role: "agronomist" } } })).toBe("AGRONOMIST");
    expect(resolvers.ComplianceGap.name({ member: { staff: { name: "Ola" } } })).toBe("Ola");
  });

  it("reads a matrix row's display fields defensively", () => {
    expect(resolvers.TrainingMatrixRow.name({})).toBeNull();
    expect(resolvers.TrainingMatrixRow.surname({ member: { staff: {} } })).toBeNull();
    expect(resolvers.TrainingMatrixRow.role({})).toBeNull();
    expect(resolvers.TrainingMatrixRow.role({ role: "tractor_driver" })).toBe("TRACTOR_DRIVER");
  });
});

describe("training resolvers — union type resolution", () => {
  it("resolves every union by the stamped __typename", () => {
    for (const union of ["DefineCourseResult", "EnrollCrewMemberResult", "RecordTrainingOutcomeResult", "RevokeCertificationResult"]) {
      expect(resolvers[union].__resolveType({ __typename: "Stamped" })).toBe("Stamped");
    }
  });
});
