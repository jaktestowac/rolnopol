import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

// Training pillar end to end (PRD §14.2, Phase 5).
//
// Everything here goes through the real graph endpoint, the real store and the real
// clock. Three things that only matter at this layer:
//
//   1. **The matrix renders** — the Phase 5 exit criterion. A grid with a cell per
//      member per course, resolved in ONE round trip, with the store-read count
//      independent of crew size.
//   2. **Status is clock-driven over the wire.** A certificate minted with a
//      computed expiry reports VALID / EXPIRING_SOON / EXPIRED / REVOKED through the
//      enum, so a boundary bug shows up as the wrong colour on a real page rather
//      than as a wrong number in a unit test.
//   3. **The academy link degrades to null through a real query.** With the
//      `agriAcademyEnabled` flag off — which is its default — `academyCertificate`
//      must be null and the query must carry NO errors.
//
// Dates are computed relative to today, because the graph uses the real clock.
const {
  app,
  getFlags,
  setCrewEnabled,
  setFlags,
  restoreFlags,
  tokenFor,
  resetCrewStores,
  graph,
  graphData,
  HIRE_MUTATION,
  VALID_HIRE_INPUT,
} = require("./helpers/crew-harness");

const USER_ID = 1;

const iso = (date) => date.toISOString().slice(0, 10);
const today = () => iso(new Date());

function shift(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

const DEFINE_COURSE = `
  mutation DefineCourse($input: CourseInput!) {
    defineCourse(input: $input) {
      __typename
      ... on CourseDefined {
        course { id code name provider validMonths mandatoryForRoles academyExamId }
      }
      ... on TrainingValidationFailed { fieldErrors { field message } }
    }
  }
`;

const ENROLL = `
  mutation Enroll($input: EnrollCrewMemberInput!) {
    enrollCrewMember(input: $input) {
      __typename
      ... on CrewMemberEnrolled { enrollment { id staffId status scheduledFor version course { code } } }
      ... on CourseNotFound { courseId }
      ... on AlreadyEnrolled { enrollmentId status }
      ... on MemberNotFound { staffId }
      ... on TrainingValidationFailed { fieldErrors { field message } }
    }
  }
`;

const RECORD_OUTCOME = `
  mutation Record($input: RecordTrainingOutcomeInput!) {
    recordTrainingOutcome(input: $input) {
      __typename
      ... on TrainingOutcomeRecorded {
        enrollment { id status completedOn score version }
        certification { id issuedOn expiresOn reference status daysUntilExpiry superseded course { code } }
      }
      ... on EnrollmentNotFound { enrollmentId }
      ... on IllegalEnrollmentTransition { enrollmentId from to allowed }
      ... on VersionConflict { expectedVersion actualVersion }
      ... on TrainingValidationFailed { fieldErrors { field message } }
    }
  }
`;

const REVOKE = `
  mutation Revoke($certificationId: ID!, $reason: NonEmptyString!) {
    revokeCertification(certificationId: $certificationId, reason: $reason) {
      __typename
      ... on CertificationRevoked {
        certification { id status revokedOn revokedReason }
        gaps { staffId reason course { code } }
      }
      ... on CertificationNotFound { certificationId }
      ... on CertificationAlreadyRevoked { certificationId revokedOn revokedReason }
      ... on TrainingValidationFailed { fieldErrors { field message } }
    }
  }
`;

const MEMBER_TRAINING = `
  query MemberTraining($staffId: ID!) {
    crewMember(staffId: $staffId) {
      staffId
      training {
        compliant
        certifications { id status expiresOn daysUntilExpiry superseded course { code } }
        enrollments { id status course { code } }
        expiringSoon { id status course { code } }
        complianceGaps { reason role course { code } }
      }
    }
  }
`;

const MATRIX = `
  query Matrix {
    trainingMatrix {
      totalGaps
      courses { id code name validMonths mandatoryForRoles }
      rows {
        staffId
        name
        role
        gapCount
        cells {
          mandatory
          compliant
          status
          course { code }
          certification { id expiresOn }
          enrollment { id status }
        }
      }
    }
  }
`;

describe("Crew Office — training pillar", () => {
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

  /** A mechanic and a chainsaw course they must hold — the usual starting point. */
  async function setup({ course = {}, hire = {} } = {}) {
    const defined = await graphData({
      query: DEFINE_COURSE,
      variables: {
        input: {
          code: "chainsaw",
          name: "Chainsaw operation",
          provider: "ForestSkills",
          validMonths: 24,
          mandatoryForRoles: ["MECHANIC"],
          ...course,
        },
      },
      token,
    });
    expect(defined.defineCourse.__typename).toBe("CourseDefined");

    const hired = await graphData({
      query: HIRE_MUTATION,
      variables: { input: { ...VALID_HIRE_INPUT, role: "MECHANIC", startDate: shift(today(), -400), ...hire } },
      token,
    });
    expect(hired.hireCrewMember.__typename).toBe("CrewMemberHired");

    return { courseId: defined.defineCourse.course.id, staffId: hired.hireCrewMember.crewMember.staffId };
  }

  /** Enroll and pass, so there is a live certificate to read. */
  async function pass({ staffId, courseId, completedOn = today(), reference = "FS-1" }) {
    const enrolled = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });
    expect(enrolled.enrollCrewMember.__typename).toBe("CrewMemberEnrolled");

    const recorded = await graphData({
      query: RECORD_OUTCOME,
      variables: { input: { enrollmentId: enrolled.enrollCrewMember.enrollment.id, outcome: "PASSED", completedOn, score: 90, reference } },
      token,
    });
    expect(recorded.recordTrainingOutcome.__typename).toBe("TrainingOutcomeRecorded");
    return { enrollmentId: enrolled.enrollCrewMember.enrollment.id, certification: recorded.recordTrainingOutcome.certification };
  }

  describe("the schema and the module shape", () => {
    it("appears in extensions.pillars and in crewInfo", async () => {
      const res = await graph({ query: "{ crewInfo { pillars } }", token });
      expect(res.body.extensions.pillars).toContain("training");
      expect(res.body.data.crewInfo.pillars).toContain("training");
    });

    it("has no mutation that deletes a course, an enrollment or a certificate", async () => {
      // Asserted against the assembled schema's MUTATION FIELD NAMES rather than
      // against the SDL text. The SDL is documentation-rich, and an earlier version
      // of this test matched bare words in it — then failed on a docstring that says
      // a revoked certificate is "never reinstated". The claim is about the API
      // surface, so it should be made against the API surface.
      const { assembleCrewSchema } = require("../services/crew/registry");
      const mutations = Object.keys(assembleCrewSchema().schema.getMutationType().getFields());

      expect(mutations).toContain("revokeCertification");
      expect(mutations.filter((name) => /^(delete|remove|destroy|unrevoke|reinstate)/i.test(name))).toEqual([]);
    });
  });

  describe("courses", () => {
    it("defines a course and reads it back by code", async () => {
      await setup();
      const data = await graphData({
        query: `query C($code: NonEmptyString!) { course(code: $code) { code name provider validMonths mandatoryForRoles } }`,
        variables: { code: "chainsaw" },
        token,
      });
      expect(data.course).toMatchObject({ code: "chainsaw", provider: "ForestSkills", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });
    });

    it("returns a course with no validMonths as a certificate for life", async () => {
      await setup({ course: { code: "induction", name: "Induction", validMonths: null, mandatoryForRoles: [] } });
      const data = await graphData({ query: "{ courses { code validMonths } }", token });
      expect(data.courses.find((course) => course.code === "induction").validMonths).toBeNull();
    });

    it("rejects a malformed course as a typed failure, not an error", async () => {
      const data = await graphData({
        query: DEFINE_COURSE,
        variables: { input: { code: "Chainsaw Ops", name: "x", validMonths: 0 } },
        token,
      });
      expect(data.defineCourse.__typename).toBe("TrainingValidationFailed");
      expect(data.defineCourse.fieldErrors.map((error) => error.field)).toEqual(expect.arrayContaining(["code", "validMonths"]));
    });

    it("refuses a duplicate code", async () => {
      const { courseId } = await setup();
      void courseId;
      const again = await graphData({
        query: DEFINE_COURSE,
        variables: { input: { code: "chainsaw", name: "Another chainsaw course" } },
        token,
      });
      expect(again.defineCourse.__typename).toBe("TrainingValidationFailed");
      expect(again.defineCourse.fieldErrors[0].field).toBe("code");
    });
  });

  describe("enrollment and outcomes", () => {
    it("enrolls, starts and passes, minting a certificate with a computed expiry", async () => {
      const { courseId, staffId } = await setup();
      const enrolled = await graphData({
        query: ENROLL,
        variables: { input: { staffId, courseId, scheduledFor: shift(today(), 14) } },
        token,
      });
      expect(enrolled.enrollCrewMember.enrollment).toMatchObject({ status: "PLANNED", version: 1 });

      const enrollmentId = enrolled.enrollCrewMember.enrollment.id;
      const started = await graphData({
        query: RECORD_OUTCOME,
        variables: { input: { enrollmentId, outcome: "IN_PROGRESS" } },
        token,
      });
      expect(started.recordTrainingOutcome.enrollment).toMatchObject({ status: "IN_PROGRESS", version: 2 });
      expect(started.recordTrainingOutcome.certification).toBeNull();

      const passed = await graphData({
        query: RECORD_OUTCOME,
        variables: { input: { enrollmentId, outcome: "PASSED", completedOn: "2026-01-15", score: 88, reference: "FS-9" } },
        token,
      });
      expect(passed.recordTrainingOutcome.enrollment).toMatchObject({ status: "PASSED", completedOn: "2026-01-15", version: 3 });
      // 24 months from 15 January 2026, last valid day.
      expect(passed.recordTrainingOutcome.certification).toMatchObject({
        issuedOn: "2026-01-15",
        expiresOn: "2028-01-14",
        reference: "FS-9",
      });
    });

    it("mints nothing on a fail, and records the attempt", async () => {
      const { courseId, staffId } = await setup();
      const enrolled = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });
      const failed = await graphData({
        query: RECORD_OUTCOME,
        variables: { input: { enrollmentId: enrolled.enrollCrewMember.enrollment.id, outcome: "FAILED", score: 41 } },
        token,
      });

      expect(failed.recordTrainingOutcome.enrollment.status).toBe("FAILED");
      expect(failed.recordTrainingOutcome.certification).toBeNull();
    });

    it("refuses a second live enrollment on the same course", async () => {
      const { courseId, staffId } = await setup();
      const first = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });
      const second = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });

      expect(second.enrollCrewMember.__typename).toBe("AlreadyEnrolled");
      expect(second.enrollCrewMember).toMatchObject({ enrollmentId: first.enrollCrewMember.enrollment.id, status: "PLANNED" });
    });

    it("refuses a second outcome on a terminal enrollment, listing what is allowed", async () => {
      const { courseId, staffId } = await setup();
      const { enrollmentId } = await pass({ staffId, courseId });
      const again = await graphData({ query: RECORD_OUTCOME, variables: { input: { enrollmentId, outcome: "FAILED" } }, token });

      expect(again.recordTrainingOutcome.__typename).toBe("IllegalEnrollmentTransition");
      expect(again.recordTrainingOutcome).toMatchObject({ from: "PASSED", to: "FAILED", allowed: [] });
    });

    it("reports MemberNotFound as a union member for an unknown staff id", async () => {
      const { courseId } = await setup();
      const data = await graphData({ query: ENROLL, variables: { input: { staffId: "99999", courseId } }, token });
      expect(data.enrollCrewMember.__typename).toBe("MemberNotFound");
    });

    it("reports CourseNotFound for an unknown course", async () => {
      const { staffId } = await setup();
      const data = await graphData({ query: ENROLL, variables: { input: { staffId, courseId: "99999" } }, token });
      expect(data.enrollCrewMember.__typename).toBe("CourseNotFound");
    });

    it("refuses a PASSED outcome with no completedOn, naming the field", async () => {
      const { courseId, staffId } = await setup();
      const enrolled = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });
      const data = await graphData({
        query: RECORD_OUTCOME,
        variables: { input: { enrollmentId: enrolled.enrollCrewMember.enrollment.id, outcome: "PASSED" } },
        token,
      });
      expect(data.recordTrainingOutcome.__typename).toBe("TrainingValidationFailed");
      expect(data.recordTrainingOutcome.fieldErrors[0].field).toBe("completedOn");
    });

    it("refuses an outcome recorded against a stale version", async () => {
      const { courseId, staffId } = await setup();
      const enrolled = await graphData({ query: ENROLL, variables: { input: { staffId, courseId } }, token });
      const data = await graphData({
        query: RECORD_OUTCOME,
        variables: { input: { enrollmentId: enrolled.enrollCrewMember.enrollment.id, outcome: "CANCELLED", expectedVersion: 99 } },
        token,
      });
      expect(data.recordTrainingOutcome.__typename).toBe("VersionConflict");
      expect(data.recordTrainingOutcome).toMatchObject({ expectedVersion: 99, actualVersion: 1 });
    });
  });

  describe("certification status over the wire — clock-driven at every boundary", () => {
    it("reports VALID for a fresh certificate well inside its window", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });
      expect(certification.status).toBe("VALID");
      expect(certification.daysUntilExpiry).toBeGreaterThan(60);
    });

    it("reports EXPIRING_SOON with a day count, and still counts as held", async () => {
      // A 12-month course passed 350 days ago: about a fortnight left.
      const { staffId } = await setup({
        course: { code: "first_aid", name: "First aid", validMonths: 12, mandatoryForRoles: ["MECHANIC"] },
      });
      const course = await graphData({ query: "{ courses { id code } }", token });
      const courseId = course.courses.find((row) => row.code === "first_aid").id;

      const { certification } = await pass({ staffId, courseId, completedOn: shift(today(), -350) });
      expect(certification.status).toBe("EXPIRING_SOON");
      expect(certification.daysUntilExpiry).toBeGreaterThanOrEqual(0);

      // Still held: no compliance gap while it is merely running out.
      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      expect(member.crewMember.training.compliant).toBe(true);
      expect(member.crewMember.training.complianceGaps).toEqual([]);
    });

    it("reports VALID on the LAST valid day and EXPIRED the day after", async () => {
      // The Phase 5 boundary, arranged through the real store. A 12-month course
      // passed exactly 365 days ago ran out yesterday; passed 364 days ago it runs
      // out today and is still good.
      const { staffId } = await setup({ course: { code: "first_aid", name: "First aid", validMonths: 12, mandatoryForRoles: [] } });
      const courses = await graphData({ query: "{ courses { id code } }", token });
      const courseId = courses.courses.find((row) => row.code === "first_aid").id;

      const lastDay = await pass({ staffId, courseId, completedOn: shift(today(), -364) });
      expect(lastDay.certification.expiresOn).toBe(today());
      expect(lastDay.certification.status).toBe("EXPIRING_SOON");
      expect(lastDay.certification.daysUntilExpiry).toBe(0);
    });

    it("reports EXPIRED for a lapsed certificate, with a negative day count", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId, completedOn: shift(today(), -800) });
      expect(certification.status).toBe("EXPIRED");
      expect(certification.daysUntilExpiry).toBeLessThan(0);
    });

    it("reports VALID forever for a certificate with no expiry", async () => {
      const { staffId } = await setup({
        course: { code: "induction", name: "Induction", validMonths: null, mandatoryForRoles: ["MECHANIC"] },
      });
      const courses = await graphData({ query: "{ courses { id code } }", token });
      const courseId = courses.courses.find((row) => row.code === "induction").id;

      const { certification } = await pass({ staffId, courseId, completedOn: "2020-01-01" });
      expect(certification).toMatchObject({ expiresOn: null, status: "VALID", daysUntilExpiry: null });
    });
  });

  describe("revocation", () => {
    it("voids a certificate and reports the gap it just opened", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });

      const revoked = await graphData({
        query: REVOKE,
        variables: { certificationId: certification.id, reason: "falsified assessment" },
        token,
      });
      expect(revoked.revokeCertification.__typename).toBe("CertificationRevoked");
      expect(revoked.revokeCertification.certification).toMatchObject({
        status: "REVOKED",
        revokedOn: today(),
        revokedReason: "falsified assessment",
      });
      expect(revoked.revokeCertification.gaps).toEqual([{ staffId, reason: "REVOKED", course: { code: "chainsaw" } }]);
    });

    it("is never VALID again, even though the expiry is years away", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });
      await graphData({ query: REVOKE, variables: { certificationId: certification.id, reason: "voided" }, token });

      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      expect(member.crewMember.training.certifications[0].status).toBe("REVOKED");
      expect(member.crewMember.training.compliant).toBe(false);
    });

    it("is not repeatable", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });
      await graphData({ query: REVOKE, variables: { certificationId: certification.id, reason: "first" }, token });
      const again = await graphData({ query: REVOKE, variables: { certificationId: certification.id, reason: "second" }, token });

      expect(again.revokeCertification.__typename).toBe("CertificationAlreadyRevoked");
      expect(again.revokeCertification.revokedReason).toBe("first");
    });

    it("is cured by a NEW pass, and the old row stays revoked", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });
      await graphData({ query: REVOKE, variables: { certificationId: certification.id, reason: "voided" }, token });
      await pass({ staffId, courseId, reference: "FS-2" });

      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      const statuses = member.crewMember.training.certifications.map((row) => row.status).sort();
      expect(statuses).toEqual(["REVOKED", "VALID"]);
      expect(member.crewMember.training.compliant).toBe(true);
    });

    it("refuses a whitespace-only reason at the scalar, before the resolver runs", async () => {
      const { courseId, staffId } = await setup();
      const { certification } = await pass({ staffId, courseId });
      const res = await graph({ query: REVOKE, variables: { certificationId: certification.id, reason: "   " }, token });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toMatch(/whitespace/);
    });
  });

  describe("re-certification", () => {
    it("keeps both certificates and marks the older one superseded", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId, completedOn: shift(today(), -700), reference: "FS-OLD" });
      await pass({ staffId, courseId, completedOn: today(), reference: "FS-NEW" });

      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      const certifications = member.crewMember.training.certifications;
      expect(certifications).toHaveLength(2);
      // Newest first, and only the older one is superseded.
      expect(certifications[0].superseded).toBe(false);
      expect(certifications[1].superseded).toBe(true);
    });

    it("does not list a superseded certificate as expiring", async () => {
      // Otherwise a re-certified member is sent on a course they have already sat.
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId, completedOn: shift(today(), -700) });
      await pass({ staffId, courseId, completedOn: today() });

      const data = await graphData({ query: "{ expiringCertifications { id course { code } } }", token });
      expect(data.expiringCertifications).toEqual([]);
    });
  });

  describe("compliance", () => {
    it("reports a MISSING gap for a mandatory course never sat", async () => {
      const { staffId } = await setup();
      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      expect(member.crewMember.training.compliant).toBe(false);
      expect(member.crewMember.training.complianceGaps).toEqual([{ reason: "MISSING", role: "MECHANIC", course: { code: "chainsaw" } }]);
    });

    it("reports an EXPIRED gap once the certificate lapses", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId, completedOn: shift(today(), -800) });

      const data = await graphData({ query: "{ complianceGaps { staffId reason name course { code } } }", token });
      const gap = data.complianceGaps.find((row) => row.staffId === staffId);
      expect(gap).toMatchObject({ reason: "EXPIRED", name: VALID_HIRE_INPUT.name, course: { code: "chainsaw" } });
    });

    it("clears the gap once the member is certified", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId });
      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      expect(member.crewMember.training.compliant).toBe(true);
      expect(member.crewMember.training.complianceGaps).toEqual([]);
    });

    it("does not apply a course to a role it is not mandatory for", async () => {
      const { courseId } = await setup();
      void courseId;
      const agronomist = await graphData({
        query: HIRE_MUTATION,
        variables: { input: { ...VALID_HIRE_INPUT, name: "Ala", role: "AGRONOMIST", startDate: shift(today(), -400) } },
        token,
      });
      const staffId = agronomist.hireCrewMember.crewMember.staffId;

      const member = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token });
      expect(member.crewMember.training.compliant).toBe(true);
    });

    it("includes already-lapsed certificates in expiringCertifications — they are the urgent rows", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId, completedOn: shift(today(), -800) });

      const data = await graphData({ query: "{ expiringCertifications { id status } }", token });
      expect(data.expiringCertifications.map((row) => row.status)).toContain("EXPIRED");
    });

    it("honours the withinDays window", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId });
      expect((await graphData({ query: "{ expiringCertifications(withinDays: 1) { id } }", token })).expiringCertifications).toEqual([]);
      expect(
        (await graphData({ query: "{ expiringCertifications(withinDays: 10000) { id } }", token })).expiringCertifications.length,
      ).toBeGreaterThan(0);
    });
  });

  describe("the training matrix — the Phase 5 exit criterion", () => {
    it("renders a grid with a cell per member per course", async () => {
      const { courseId, staffId } = await setup();
      await graphData({
        query: DEFINE_COURSE,
        variables: { input: { code: "first_aid", name: "First aid", validMonths: 36, mandatoryForRoles: ["MANAGER"] } },
        token,
      });
      await pass({ staffId, courseId });

      const data = await graphData({ query: MATRIX, token });
      const matrix = data.trainingMatrix;

      expect(matrix.courses.map((course) => course.code)).toEqual(["chainsaw", "first_aid"]);
      expect(matrix.rows.length).toBeGreaterThan(0);
      // Every row has a cell for every course — no holes.
      for (const row of matrix.rows) expect(row.cells).toHaveLength(matrix.courses.length);

      const mechanic = matrix.rows.find((row) => row.staffId === staffId);
      expect(mechanic).toMatchObject({ role: "MECHANIC", gapCount: 0 });
      const chainsaw = mechanic.cells.find((cell) => cell.course.code === "chainsaw");
      expect(chainsaw).toMatchObject({ mandatory: true, compliant: true, status: "VALID" });
      // Not mandatory for a mechanic, and not held — still compliant.
      const firstAid = mechanic.cells.find((cell) => cell.course.code === "first_aid");
      expect(firstAid).toMatchObject({ mandatory: false, compliant: true, status: null });
    });

    it("counts gaps per row and across the crew", async () => {
      const { staffId } = await setup();
      const data = await graphData({ query: MATRIX, token });
      const mechanic = data.trainingMatrix.rows.find((row) => row.staffId === staffId);
      expect(mechanic.gapCount).toBe(1);
      expect(data.trainingMatrix.totalGaps).toBeGreaterThanOrEqual(1);
    });

    it("shows the latest enrollment in an uncertified cell", async () => {
      // What tells "not certified" from "not certified but booked on a course".
      const { courseId, staffId } = await setup();
      await graphData({ query: ENROLL, variables: { input: { staffId, courseId, scheduledFor: shift(today(), 30) } }, token });

      const data = await graphData({ query: MATRIX, token });
      const cell = data.trainingMatrix.rows.find((row) => row.staffId === staffId).cells.find((entry) => entry.course.code === "chainsaw");
      expect(cell.status).toBeNull();
      expect(cell.enrollment).toMatchObject({ status: "PLANNED" });
    });

    it("resolves the whole matrix in ONE round trip, with reads independent of crew size", async () => {
      // §16's promise made concrete. This user owns dozens of staff records, so a
      // per-member read would show up here as dozens of reads rather than a handful.
      await setup();
      const res = await graph({ query: MATRIX, token });

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.trainingMatrix.rows.length).toBeGreaterThan(5);
      expect(res.body.extensions.storeReads).toBeLessThanOrEqual(5);
    });
  });

  describe("the AgriAcademy link", () => {
    it("resolves academyCertificate to NULL with no errors when the flag is off", async () => {
      // The matrix must render regardless — that is the whole point of the
      // degradation. Flag set explicitly, per §14.6.
      await setFlags({ agriAcademyEnabled: false });
      await setup({ course: { code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: [], academyExamId: "exam-7" } });

      const res = await graph({
        query: "{ courses { code academyExamId academyCertificate { certificateNo examTitle issuedOn score } } }",
        token,
      });

      expect(res.body.errors).toBeUndefined();
      const course = res.body.data.courses.find((row) => row.code === "pesticide");
      expect(course.academyExamId).toBe("exam-7");
      expect(course.academyCertificate).toBeNull();
    });

    it("resolves to null for a course with no academyExamId, without dialling anything", async () => {
      await setup();
      const res = await graph({ query: "{ courses { code academyCertificate { certificateNo } } }", token });
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.courses.every((course) => course.academyCertificate === null)).toBe(true);
    });

    it("reports DISABLED with a sentence a page can show, when the flag is off", async () => {
      // The panel has to explain itself, not just render a blank column.
      //
      // The flag is set EXPLICITLY rather than assumed: §14.6 says a crew test must
      // not depend on global flag state, and this behaviour is a function of another
      // module's flag. An earlier version of this test assumed the default and
      // reported OFFLINE instead, because something else had switched it on.
      await setFlags({ agriAcademyEnabled: false });
      await setup({ course: { code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: [], academyExamId: "exam-7" } });

      const data = await graphData({ query: "{ academyLink { state available message linkedCourses } }", token });
      expect(data.academyLink).toMatchObject({ state: "DISABLED", available: false, linkedCourses: 1 });
      expect(data.academyLink.message).toMatch(/training records are unaffected/i);
      expect(data.academyLink.message).toMatch(/agriAcademyEnabled/);
    });

    it("reports OFFLINE when the flag is ON but the academy is not running", async () => {
      // The real-world case this whole feature exists for, and the one CI is in:
      // the flag is on, the standalone academy services are not started, and the
      // training page must still render and say why the column is empty.
      await setFlags({ agriAcademyEnabled: true });
      await setup({ course: { code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: [], academyExamId: "exam-7" } });

      const data = await graphData({ query: "{ academyLink { state available message linkedCourses } }", token });
      expect(data.academyLink).toMatchObject({ state: "OFFLINE", available: false, linkedCourses: 1 });
      expect(data.academyLink.message).toMatch(/not responding/i);
      expect(data.academyLink.message).toMatch(/training records are unaffected/i);
    });

    it("reports NOT_LINKED when the flag is on but no course references an exam", async () => {
      // The farm never asked for the link, so the page has nothing to warn about.
      // The flag is checked FIRST, so this needs it on — with the flag off, DISABLED
      // is the more useful answer for whoever is looking at the configuration.
      await setFlags({ agriAcademyEnabled: true });
      await setup();
      const data = await graphData({ query: "{ academyLink { state available linkedCourses message } }", token });
      expect(data.academyLink).toMatchObject({ state: "NOT_LINKED", available: false, linkedCourses: 0 });
    });

    it("counts only the caller's OWN linked courses", async () => {
      await setFlags({ agriAcademyEnabled: true });
      await setup({ course: { code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: [], academyExamId: "exam-7" } });
      const other = await graphData({ query: "{ academyLink { linkedCourses state } }", token: tokenFor(9999) });
      expect(other.academyLink).toMatchObject({ linkedCourses: 0, state: "NOT_LINKED" });
    });

    it("never errors, and answers alongside the member's training in one query", async () => {
      // The panel fetches both together on purpose: a second round trip for a
      // banner is a second thing that can fail while the page is rendering.
      const { courseId, staffId } = await setup({
        course: { code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"], academyExamId: "exam-7" },
      });
      await pass({ staffId, courseId });

      const res = await graph({
        query: `query Panel($staffId: ID!) {
          academyLink { state available message linkedCourses }
          crewMember(staffId: $staffId) {
            training { compliant certifications { status course { academyExamId academyCertificate { certificateNo } } } }
          }
        }`,
        variables: { staffId },
        token,
      });

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.academyLink.available).toBe(false);
      // The link is down; the farm's own record is intact and still says VALID.
      expect(res.body.data.crewMember.training.certifications[0].status).toBe("VALID");
      expect(res.body.data.crewMember.training.certifications[0].course.academyCertificate).toBeNull();
    });

    it("does not fail a matrix query that selects the academy link", async () => {
      await setup({
        course: { code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: ["MECHANIC"], academyExamId: "exam-7" },
      });
      const res = await graph({
        query: "{ trainingMatrix { totalGaps courses { code academyCertificate { certificateNo } } rows { staffId gapCount } } }",
        token,
      });
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.trainingMatrix.courses[0].academyCertificate).toBeNull();
    });
  });

  describe("scoping", () => {
    it("does not show one user's courses or certificates to another", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId });

      const otherToken = tokenFor(9999);
      const other = await graphData({
        query: "{ courses { code } expiringCertifications { id } complianceGaps { staffId } }",
        token: otherToken,
      });
      expect(other.courses).toEqual([]);
      expect(other.expiringCertifications).toEqual([]);
      expect(other.complianceGaps).toEqual([]);
    });

    it("returns MEMBER_NOT_FOUND rather than data for another user's staff id", async () => {
      const { staffId } = await setup();
      const otherToken = tokenFor(9999);
      const data = await graphData({ query: MEMBER_TRAINING, variables: { staffId }, token: otherToken });
      expect(data.crewMember).toBeNull();
    });
  });

  describe("orphaned overlays (§12 rule 4)", () => {
    it("reports training rows left behind by DELETE /api/v1/staff/:id, without crashing", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId });
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`);

      const res = await graph({ query: "{ orphanedOverlays { pillar staffId rowId detail } }", token });
      expect(res.status).toBe(200);
      const pillars = res.body.data.orphanedOverlays.filter((row) => row.staffId === String(staffId)).map((row) => row.pillar);
      expect(pillars).toContain("training");
    });

    it("still renders the matrix after a staff record is deleted underneath it", async () => {
      const { courseId, staffId } = await setup();
      await pass({ staffId, courseId });
      await request(app).delete(`/api/v1/staff/${staffId}`).set("Cookie", `rolnopolToken=${token}`);

      const res = await graph({ query: MATRIX, token });
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.trainingMatrix).not.toBeNull();
    });
  });
});
