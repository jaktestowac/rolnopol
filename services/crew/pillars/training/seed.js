/**
 * Idempotent demo seed for the training pillar (PRD §11).
 *
 * Gives a fresh install a training matrix worth looking at, which means one of each
 * interesting state rather than a wall of green: a current certificate, one already
 * inside the expiring-soon window, one that lapsed, and a compliance gap where a
 * mandatory course was never sat. A demo where everything is fine demonstrates
 * nothing.
 *
 * Same two rules as the other pillars' seeds —
 *
 *   - **idempotent**: courses are only added when their code is absent, and
 *     enrollments only when that owner has none, so running it twice changes
 *     nothing;
 *   - **crew stores only**: it never touches `staff.json`; it certifies the people
 *     who are already there (§12.2).
 */
const { getStore, read, transact } = require("./store");
const { expiryDateFor } = require("./expiry");
const { addDays } = require("../../clock");

/**
 * The courses. `mandatoryForRoles` is stored lower_snake_case per §6.4.
 *
 * `chainsaw` is deliberately the one with a `requiresCertification` counterpart in
 * the tools pillar, so the certification gate has something real to check.
 */
const COURSES = [
  {
    code: "pesticide_application",
    name: "Pesticide application",
    provider: "AgriSafe",
    validMonths: 36,
    mandatoryForRoles: ["agronomist", "tractor_driver"],
    academyExamId: null,
  },
  {
    code: "chainsaw",
    name: "Chainsaw operation and maintenance",
    provider: "ForestSkills",
    validMonths: 24,
    mandatoryForRoles: ["mechanic"],
    academyExamId: null,
  },
  {
    code: "first_aid",
    name: "Emergency first aid at work",
    provider: "RedCross",
    validMonths: 36,
    mandatoryForRoles: ["manager", "stockperson", "dairy_hand"],
    academyExamId: null,
  },
  {
    // No `validMonths`: a certificate for life, so the "never expires" branch is
    // present in the demo data rather than waiting to be discovered.
    code: "farm_induction",
    name: "Farm safety induction",
    provider: "In-house",
    validMonths: null,
    mandatoryForRoles: [],
    academyExamId: null,
  },
];

/**
 * How far back each seeded pass was taken, chosen so the resulting certificate
 * lands in a different state. Read with `validMonths` above:
 *
 *   - 30 days ago on a 36-month course ⇒ comfortably `valid`;
 *   - 23 months ago on a 24-month course ⇒ `expiring_soon` (about a month left);
 *   - 40 months ago on a 36-month course ⇒ `expired`.
 */
const PASS_PLAN = [
  { courseCode: "pesticide_application", daysAgo: 30, score: 88, reference: "AS-DEMO-1" },
  { courseCode: "chainsaw", daysAgo: 700, score: 91, reference: "FS-DEMO-2" },
  { courseCode: "first_aid", daysAgo: 1220, score: 76, reference: "RC-DEMO-3" },
];

async function seedTraining({ staffRecords, today, nowIso }) {
  const store = getStore();
  const existing = await read(store);

  return transact(store, (document) => {
    let lastCourseId = document.counters.lastCourseId;
    let lastEnrollmentId = document.counters.lastEnrollmentId;
    let lastCertificationId = document.counters.lastCertificationId;

    const byUser = new Map();
    for (const staff of staffRecords) {
      const list = byUser.get(Number(staff.userId)) || [];
      list.push(staff);
      byUser.set(Number(staff.userId), list);
    }

    const addedCourses = [];
    const addedEnrollments = [];
    const addedCertifications = [];

    for (const [userId] of byUser.entries()) {
      const codesPresent = new Set(document.courses.filter((row) => Number(row.userId) === userId).map((row) => row.code));
      for (const template of COURSES) {
        if (codesPresent.has(template.code)) continue;
        lastCourseId += 1;
        addedCourses.push({ id: lastCourseId, userId, ...template, createdAt: nowIso });
      }
    }

    const courses = [...document.courses, ...addedCourses];

    for (const [userId, staff] of byUser.entries()) {
      // Only when this owner has no enrollments at all, so a seed can never
      // scribble over a training record somebody built.
      if (document.enrollments.some((row) => Number(row.userId) === userId)) continue;

      const usersCourses = courses.filter((row) => Number(row.userId) === userId);
      const courseByCode = new Map(usersCourses.map((course) => [course.code, course]));

      // The first three members get one pass each, one per state. Whoever comes
      // after them is left uncertified on purpose — that is where the compliance
      // gaps come from, and gaps are the report this pillar exists to produce.
      staff.slice(0, PASS_PLAN.length).forEach((member, index) => {
        const plan = PASS_PLAN[index];
        const course = courseByCode.get(plan.courseCode);
        if (!course) return;

        const completedOn = addDays(today, -plan.daysAgo);
        lastEnrollmentId += 1;
        lastCertificationId += 1;

        addedCertifications.push({
          id: lastCertificationId,
          userId,
          staffId: Number(member.id),
          courseId: course.id,
          enrollmentId: lastEnrollmentId,
          issuedOn: completedOn,
          expiresOn: expiryDateFor(completedOn, course.validMonths),
          reference: plan.reference,
          revokedOn: null,
          revokedReason: null,
          createdAt: nowIso,
        });

        addedEnrollments.push({
          id: lastEnrollmentId,
          userId,
          staffId: Number(member.id),
          courseId: course.id,
          status: "passed",
          scheduledFor: completedOn,
          completedOn,
          score: plan.score,
          note: "Seeded demo enrollment.",
          certificationId: lastCertificationId,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 2,
        });
      });

      // One member booked on a course but not yet assessed, so the matrix shows the
      // difference between "not certified" and "not certified but booked".
      const nextMember = staff[PASS_PLAN.length];
      const inductionCourse = courseByCode.get("farm_induction");
      if (nextMember && inductionCourse) {
        lastEnrollmentId += 1;
        addedEnrollments.push({
          id: lastEnrollmentId,
          userId,
          staffId: Number(nextMember.id),
          courseId: inductionCourse.id,
          status: "planned",
          scheduledFor: addDays(today, 21),
          completedOn: null,
          score: null,
          note: "Seeded demo enrollment.",
          certificationId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        });
      }
    }

    return {
      document: {
        ...document,
        courses,
        enrollments: [...document.enrollments, ...addedEnrollments],
        certifications: [...document.certifications, ...addedCertifications],
        counters: { ...document.counters, lastCourseId, lastEnrollmentId, lastCertificationId },
      },
      result: {
        coursesCreated: addedCourses.length,
        enrollmentsCreated: addedEnrollments.length,
        certificationsCreated: addedCertifications.length,
        coursesBefore: existing.courses.length,
      },
    };
  });
}

module.exports = { seedTraining, COURSES, PASS_PLAN };
