import { describe, it, expect } from "vitest";

// Training pillar (PRD §14.1, §8.4).
//
// The four things Phase 5 names, and they are all boundary questions:
//
//   1. **Expiry boundaries** — expires today / at 23:59 / yesterday. A ticket is
//      valid THROUGH its expiry date, so the first of those is valid and the last
//      is not. Getting it wrong by one day means somebody is either grounded a day
//      early or working a day uncertified, and only one of those gets noticed.
//   2. **Revoked before expiry is never `valid`.** Revocation is a statement about
//      a certificate's legitimacy; expiry is a statement about its age.
//   3. **Mandatory-course gaps per role** — a gap is a mandatory course this
//      member's role requires and they do not currently hold.
//   4. **Academy-offline degradation returns `null`, not an error.** The link is
//      optional and external; a training matrix must render whether or not a
//      separate ecosystem is running.
//
// Driven at the pure-function and service layers, with an in-memory store double,
// for the same reason as the leave pillar: the interesting cases are dense and a
// round trip each would make the sweep too expensive to keep. The end-to-end path
// is `tests/crew-training.test.js`.
const {
  addMonthsClamped,
  expiryDateFor,
  certificationStatus,
  daysUntilExpiry,
  permitsWork,
  currentCertification,
  isSuperseded,
  coursesMandatoryForRole,
  gapReason,
  buildMatrix,
  EXPIRING_SOON_DAYS,
  CERTIFICATION_STATUSES,
} = require("../../services/crew/pillars/training/expiry");
const {
  createTrainingService,
  validateCourseInput,
  validateOutcomeInput,
  normaliseValidMonths,
  ENROLLMENT_TRANSITIONS,
} = require("../../services/crew/pillars/training/service");
const { DEFAULT_DATA } = require("../../services/crew/pillars/training/store");
const { createAcademyGateway } = require("../../services/crew/academy-gateway");
const { CREW_ERROR_CODES, CrewError } = require("../../services/crew/errors");

const TODAY = "2026-07-30";
const NOW_ISO = "2026-07-30T09:00:00.000Z";
const USER_ID = 1;

// --- the pure core ----------------------------------------------------------

describe("addMonthsClamped", () => {
  it("clamps to the end of a short month rather than rolling over", () => {
    // A certificate earned on 31 January valid one month expires in February, not
    // in March. Rolling over would silently extend every end-of-month ticket.
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("asks the calendar how long February is, so a leap year clamps to the 29th", () => {
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 13)).toBe("2027-02-28");
  });

  it("crosses years and handles multi-year spans", () => {
    expect(addMonthsClamped("2026-09-01", 36)).toBe("2029-09-01");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("returns null for an unusable input rather than a wrong date", () => {
    expect(addMonthsClamped("2026-9-1", 12)).toBeNull();
    expect(addMonthsClamped(null, 12)).toBeNull();
    expect(addMonthsClamped("2026-09-01", NaN)).toBeNull();
  });
});

describe("expiryDateFor", () => {
  it("returns the LAST VALID day, not the first invalid one", () => {
    // Three years from 1 September 2026 runs out at the end of 31 August 2029.
    // §6.4's sketch writes 2029-09-01; we store the last valid day so `expiresOn`
    // has one meaning, because two meanings for one field is how an off-by-one-day
    // lapse gets shipped.
    expect(expiryDateFor("2026-09-01", 36)).toBe("2029-08-31");
    expect(expiryDateFor("2026-01-01", 12)).toBe("2026-12-31");
  });

  it("returns null for a certificate for life", () => {
    // Decision 3: a missing `validMonths` must not expire the ticket the day it was
    // issued, which is the more dangerous of the two possible errors.
    expect(expiryDateFor("2026-09-01", null)).toBeNull();
    expect(expiryDateFor("2026-09-01", 0)).toBeNull();
    expect(expiryDateFor("2026-09-01", undefined)).toBeNull();
  });

  it("handles a pass taken ON the leap day", () => {
    // 29 February 2028 + 12 months clamps to 28 February 2029, so the last valid
    // day is the 27th. Surprising, and correct: the clamp is what stops it becoming
    // 1 March.
    expect(expiryDateFor("2028-02-29", 12)).toBe("2029-02-27");
  });

  it("is monotonic in validMonths", () => {
    let previous = "";
    for (const months of [1, 6, 12, 24, 36, 60]) {
      const expiry = expiryDateFor("2026-07-30", months);
      expect(expiry > previous).toBe(true);
      previous = expiry;
    }
  });
});

describe("certificationStatus — the expiry boundaries Phase 5 names", () => {
  const cert = (expiresOn, revokedOn = null) => ({ expiresOn, revokedOn });

  it("is VALID on the expiry date itself — the ticket is good all day", () => {
    // "Expires today" and "expires at 23:59 today" are the same value here, because
    // these dates carry no time of day. That is deliberate: there is no hour at
    // which a ticket silently lapses mid-shift.
    expect(certificationStatus(cert("2026-07-30"), "2026-07-30")).toBe("expiring_soon");
    expect(permitsWork(certificationStatus(cert("2026-07-30"), "2026-07-30"))).toBe(true);
  });

  it("is EXPIRED the day after", () => {
    expect(certificationStatus(cert("2026-07-29"), "2026-07-30")).toBe("expired");
    expect(permitsWork(certificationStatus(cert("2026-07-29"), "2026-07-30"))).toBe(false);
  });

  it("walks the whole boundary in one sweep", () => {
    // Yesterday / today / tomorrow, stated together so a change to the comparison
    // cannot pass by satisfying one case and breaking another.
    expect(certificationStatus(cert("2026-07-29"), TODAY)).toBe("expired");
    expect(certificationStatus(cert("2026-07-30"), TODAY)).toBe("expiring_soon");
    expect(certificationStatus(cert("2026-07-31"), TODAY)).toBe("expiring_soon");
  });

  it("switches from valid to expiring_soon exactly at the notice window", () => {
    const justInside = addDays(TODAY, EXPIRING_SOON_DAYS);
    const justOutside = addDays(TODAY, EXPIRING_SOON_DAYS + 1);
    expect(certificationStatus(cert(justInside), TODAY)).toBe("expiring_soon");
    expect(certificationStatus(cert(justOutside), TODAY)).toBe("valid");
  });

  it("honours a caller's own window", () => {
    expect(certificationStatus(cert(addDays(TODAY, 20)), TODAY, { expiringSoonDays: 10 })).toBe("valid");
    expect(certificationStatus(cert(addDays(TODAY, 20)), TODAY, { expiringSoonDays: 30 })).toBe("expiring_soon");
  });

  it("is VALID forever when there is no expiry date", () => {
    expect(certificationStatus(cert(null), "2099-01-01")).toBe("valid");
  });

  it("is null when there is no certificate at all", () => {
    // Distinct from `expired`: never certified and lapsed are different facts, and
    // the compliance report names them differently.
    expect(certificationStatus(null, TODAY)).toBeNull();
    expect(certificationStatus(undefined, TODAY)).toBeNull();
  });

  describe("revoked beats everything", () => {
    it("is REVOKED even while comfortably in date", () => {
      // The Phase 5 assertion: revoked-before-expiry is never `valid`. An
      // illegitimate certificate does not become legitimate because it is young.
      expect(certificationStatus(cert("2030-01-01", "2026-01-15"), TODAY)).toBe("revoked");
      expect(permitsWork(certificationStatus(cert("2030-01-01", "2026-01-15"), TODAY))).toBe(false);
    });

    it("is REVOKED, not EXPIRED, when it is both", () => {
      // Reporting `expired` would suggest renewing it. The reason it is void has to
      // survive the date passing.
      expect(certificationStatus(cert("2026-01-01", "2025-12-01"), TODAY)).toBe("revoked");
    });

    it("is REVOKED even for a certificate for life", () => {
      expect(certificationStatus(cert(null, "2026-01-15"), TODAY)).toBe("revoked");
    });

    it("never reports a status outside the four in the schema", () => {
      for (const [expiresOn, revokedOn] of [
        ["2030-01-01", null],
        [addDays(TODAY, 10), null],
        ["2020-01-01", null],
        ["2030-01-01", "2026-01-01"],
        [null, null],
      ]) {
        expect(CERTIFICATION_STATUSES).toContain(certificationStatus(cert(expiresOn, revokedOn), TODAY));
      }
    });
  });
});

describe("daysUntilExpiry", () => {
  it("counts down to zero on the last valid day and goes negative after", () => {
    expect(daysUntilExpiry({ expiresOn: addDays(TODAY, 5) }, TODAY)).toBe(5);
    expect(daysUntilExpiry({ expiresOn: TODAY }, TODAY)).toBe(0);
    expect(daysUntilExpiry({ expiresOn: addDays(TODAY, -3) }, TODAY)).toBe(-3);
  });

  it("is null for a certificate that never expires", () => {
    expect(daysUntilExpiry({ expiresOn: null }, TODAY)).toBeNull();
    expect(daysUntilExpiry(null, TODAY)).toBeNull();
  });
});

describe("permitsWork", () => {
  it("permits a certificate that has not run out, including one running out soon", () => {
    // An `expiring_soon` chainsaw ticket is still a ticket. Refusing on it would
    // ground the crew for the length of the notice window every cycle.
    expect(permitsWork("valid")).toBe(true);
    expect(permitsWork("expiring_soon")).toBe(true);
  });

  it("refuses everything else, including the absence of a status", () => {
    for (const status of ["expired", "revoked", null, undefined, "unknown"]) {
      expect(permitsWork(status)).toBe(false);
    }
  });
});

describe("currentCertification — which row counts", () => {
  const rows = [
    { id: 1, staffId: 3, courseId: 7, issuedOn: "2023-01-01", revokedOn: null },
    { id: 2, staffId: 3, courseId: 7, issuedOn: "2026-01-01", revokedOn: null },
    { id: 3, staffId: 4, courseId: 7, issuedOn: "2026-05-01", revokedOn: null },
  ];

  it("picks the most recently issued for that member and course", () => {
    expect(currentCertification(rows, 3, 7).id).toBe(2);
  });

  it("does not cross members or courses", () => {
    expect(currentCertification(rows, 4, 7).id).toBe(3);
    expect(currentCertification(rows, 3, 99)).toBeNull();
    expect(currentCertification(rows, 99, 7)).toBeNull();
  });

  it("prefers a live certificate over a newer revoked one", () => {
    const withRevoked = [...rows, { id: 4, staffId: 3, courseId: 7, issuedOn: "2026-06-01", revokedOn: "2026-06-15" }];
    expect(currentCertification(withRevoked, 3, 7).id).toBe(2);
  });

  it("falls back to a revoked certificate when it is all there is", () => {
    // Returning null would report the member as merely uncertified and lose the
    // reason, which is the one thing the compliance view needs to show.
    const onlyRevoked = [{ id: 9, staffId: 5, courseId: 7, issuedOn: "2026-01-01", revokedOn: "2026-02-01" }];
    expect(currentCertification(onlyRevoked, 5, 7).id).toBe(9);
  });

  it("breaks a same-day tie by the newer id", () => {
    const sameDay = [
      { id: 10, staffId: 6, courseId: 7, issuedOn: "2026-03-01", revokedOn: null },
      { id: 11, staffId: 6, courseId: 7, issuedOn: "2026-03-01", revokedOn: null },
    ];
    expect(currentCertification(sameDay, 6, 7).id).toBe(11);
  });

  it("marks the older row superseded and the current one not", () => {
    expect(isSuperseded(rows[0], rows)).toBe(true);
    expect(isSuperseded(rows[1], rows)).toBe(false);
  });
});

describe("mandatory courses by role", () => {
  const courses = [
    { id: 1, code: "pesticide_application", mandatoryForRoles: ["agronomist", "tractor_driver"] },
    { id: 2, code: "chainsaw", mandatoryForRoles: ["mechanic"] },
    { id: 3, code: "farm_induction", mandatoryForRoles: [] },
  ];

  it("matches the store's lower_snake_case against the graph's CrewRole", () => {
    // §6.4 stores `["agronomist"]`; the graph says `AGRONOMIST`. The comparison has
    // to survive both spellings or every gap check silently returns nothing.
    expect(coursesMandatoryForRole(courses, "AGRONOMIST").map((c) => c.code)).toEqual(["pesticide_application"]);
    expect(coursesMandatoryForRole(courses, "agronomist").map((c) => c.code)).toEqual(["pesticide_application"]);
  });

  it("returns nothing for a role nothing is mandatory for, and for no role at all", () => {
    expect(coursesMandatoryForRole(courses, "SEASONAL_PICKER")).toEqual([]);
    expect(coursesMandatoryForRole(courses, null)).toEqual([]);
  });

  it("names the gap after the reason, and treats expiring_soon as no gap", () => {
    expect(gapReason(null)).toBe("MISSING");
    expect(gapReason("expired")).toBe("EXPIRED");
    expect(gapReason("revoked")).toBe("REVOKED");
    // Still valid. Calling it a gap would make the compliance list cry wolf every
    // two months and be ignored by the time something real appeared on it.
    expect(gapReason("expiring_soon")).toBeNull();
    expect(gapReason("valid")).toBeNull();
  });
});

describe("buildMatrix", () => {
  const courses = [
    { id: 2, code: "chainsaw", mandatoryForRoles: ["mechanic"], validMonths: 24 },
    { id: 1, code: "pesticide_application", mandatoryForRoles: ["agronomist"], validMonths: 36 },
  ];
  const members = [
    { staffId: 3, staff: { id: 3, name: "Marek" }, profile: { role: "MECHANIC" } },
    { staffId: 4, staff: { id: 4, name: "Ala" }, profile: { role: "AGRONOMIST" } },
    { staffId: 5, staff: { id: 5, name: "Nowy" }, profile: null },
  ];

  it("gives every row a cell for every course, present or not", () => {
    // A grid with holes punched out of it is not a grid: the value of the matrix is
    // that a blank cell in a mandatory column is visible at a glance.
    const matrix = buildMatrix({ members, courses, certifications: [], enrollments: [], today: TODAY });
    expect(matrix.rows).toHaveLength(3);
    for (const row of matrix.rows) expect(row.cells).toHaveLength(2);
  });

  it("orders courses by code, so the columns do not move between reads", () => {
    const matrix = buildMatrix({ members, courses, certifications: [], enrollments: [], today: TODAY });
    expect(matrix.courses.map((course) => course.code)).toEqual(["chainsaw", "pesticide_application"]);
  });

  it("marks a cell mandatory from the member's role", () => {
    const matrix = buildMatrix({ members, courses, certifications: [], enrollments: [], today: TODAY });
    const mechanic = matrix.rows.find((row) => row.staffId === 3);
    expect(mechanic.cells.find((cell) => cell.course.code === "chainsaw").mandatory).toBe(true);
    expect(mechanic.cells.find((cell) => cell.course.code === "pesticide_application").mandatory).toBe(false);
  });

  it("treats a member with no profile as having nothing mandatory", () => {
    // Awaiting a contract is not being out of compliance; they are not yet doing
    // the job.
    const matrix = buildMatrix({ members, courses, certifications: [], enrollments: [], today: TODAY });
    const noProfile = matrix.rows.find((row) => row.staffId === 5);
    expect(noProfile.cells.every((cell) => cell.mandatory === false)).toBe(true);
    expect(noProfile.cells.every((cell) => cell.compliant === true)).toBe(true);
  });

  it("is compliant only when a MANDATORY course is currently held", () => {
    const certifications = [{ id: 1, staffId: 3, courseId: 2, issuedOn: "2026-01-01", expiresOn: "2026-01-31", revokedOn: null }];
    const matrix = buildMatrix({ members, courses, certifications, enrollments: [], today: TODAY });
    const mechanic = matrix.rows.find((row) => row.staffId === 3);
    const chainsaw = mechanic.cells.find((cell) => cell.course.code === "chainsaw");
    expect(chainsaw.status).toBe("expired");
    expect(chainsaw.compliant).toBe(false);
  });

  it("shows the latest enrollment, which is what tells 'not certified' from 'booked'", () => {
    const enrollments = [
      { id: 1, staffId: 3, courseId: 2, status: "cancelled" },
      { id: 2, staffId: 3, courseId: 2, status: "planned" },
    ];
    const matrix = buildMatrix({ members, courses, certifications: [], enrollments, today: TODAY });
    const cell = matrix.rows.find((row) => row.staffId === 3).cells.find((c) => c.course.code === "chainsaw");
    expect(cell.enrollment.id).toBe(2);
  });
});

// --- validation -------------------------------------------------------------

describe("course validation", () => {
  const valid = { code: "chainsaw", name: "Chainsaw operation", validMonths: 24, mandatoryForRoles: ["MECHANIC"] };

  it("accepts a well-formed course", () => {
    expect(validateCourseInput(valid, PROFILE_ROLES)).toEqual([]);
  });

  it("accepts a course with no validMonths — a certificate for life", () => {
    expect(validateCourseInput({ code: "induction", name: "Induction" }, PROFILE_ROLES)).toEqual([]);
  });

  it("skips the role check when no role list is supplied", () => {
    // Defence in depth, not the only gate: `mandatoryForRoles: [CrewRole!]` means
    // `graphql-js` has already rejected an unknown role before a resolver runs. A
    // caller that cannot supply the list still gets every other rule.
    expect(validateCourseInput({ ...valid, mandatoryForRoles: ["WIZARD"] })).toEqual([]);
    expect(validateCourseInput({ ...valid, mandatoryForRoles: ["WIZARD"] }, PROFILE_ROLES)[0].field).toBe("mandatoryForRoles");
  });

  it.each([
    [{ code: "Chainsaw" }, "code"],
    [{ code: "c" }, "code"],
    [{ code: "2_stroke" }, "code"],
    [{ name: "" }, "name"],
    [{ validMonths: 0 }, "validMonths"],
    [{ validMonths: 1.5 }, "validMonths"],
    [{ validMonths: 9999 }, "validMonths"],
    [{ mandatoryForRoles: ["WIZARD"] }, "mandatoryForRoles"],
  ])("rejects %o naming the field", (patch, field) => {
    const errors = validateCourseInput({ ...valid, ...patch }, PROFILE_ROLES);
    expect(errors.map((error) => error.field)).toContain(field);
  });

  it("refuses validMonths: 0 rather than reading it as 'for life'", () => {
    // A caller who meant a certificate for life omits the field. One who typed 0
    // made a mistake, and reading it as permanent would create a ticket that never
    // expires by accident.
    expect(validateCourseInput({ ...valid, validMonths: 0 })[0].field).toBe("validMonths");
    expect(normaliseValidMonths(0)).toBeNull();
    expect(normaliseValidMonths(null)).toBeNull();
    expect(normaliseValidMonths(24)).toBe(24);
  });
});

describe("outcome validation", () => {
  it("requires completedOn for a pass — it is what validity runs from", () => {
    const errors = validateOutcomeInput({ enrollmentId: 1, outcome: "PASSED" });
    expect(errors.map((error) => error.field)).toContain("completedOn");
  });

  it("does not require completedOn for anything else", () => {
    for (const outcome of ["IN_PROGRESS", "FAILED", "CANCELLED"]) {
      expect(validateOutcomeInput({ enrollmentId: 1, outcome })).toEqual([]);
    }
  });

  it.each([
    [{ outcome: "MAYBE" }, "outcome"],
    [{ score: 101 }, "score"],
    [{ score: -1 }, "score"],
    [{ completedOn: "30/07/2026" }, "completedOn"],
    [{ enrollmentId: "abc" }, "enrollmentId"],
  ])("rejects %o naming the field", (patch, field) => {
    const errors = validateOutcomeInput({ enrollmentId: 1, outcome: "PASSED", completedOn: TODAY, ...patch });
    expect(errors.map((error) => error.field)).toContain(field);
  });
});

describe("the enrollment lifecycle table", () => {
  it("keeps every terminal state terminal", () => {
    // The part that actually protects the data: no second outcome, no resurrection.
    for (const status of ["passed", "failed", "cancelled"]) {
      expect(ENROLLMENT_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("lets a planned enrollment be recorded straight as passed", () => {
    // More permissive than §8.4's arrow, on purpose: the office usually only hears
    // about a course after somebody has been on it, and refusing the paperwork
    // means the record simply never gets made.
    expect(ENROLLMENT_TRANSITIONS.planned).toContain("passed");
    expect(ENROLLMENT_TRANSITIONS.planned).toContain("in_progress");
  });

  it("does not let an in-progress enrollment go back to planned", () => {
    expect(ENROLLMENT_TRANSITIONS.in_progress).not.toContain("planned");
  });
});

// --- the service ------------------------------------------------------------

/** An in-memory stand-in for a JSONDatabase: same two methods the store uses. */
function makeStoreDouble(initial = DEFAULT_DATA) {
  let data = clone(initial);
  return {
    async getAll() {
      return clone(data);
    },
    async update(mutate) {
      data = mutate(clone(data));
      return data;
    },
    snapshot: () => clone(data),
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const STAFF = [
  { id: 3, userId: USER_ID, name: "Marek", surname: "Nowak", age: 41 },
  { id: 4, userId: USER_ID, name: "Ala", surname: "Zielinska", age: 29 },
];

const MECHANIC = { fte: 1.0, startDate: "2026-01-01", endDate: null, role: "MECHANIC" };
const AGRONOMIST = { fte: 1.0, startDate: "2026-01-01", endDate: null, role: "AGRONOMIST" };

/** The real profiles service's role list, taken from the real profiles service. */
const { ROLES: PROFILE_ROLES } = require("../../services/crew/pillars/profiles/service");

/** A context with real loader semantics, and an academy gateway a test can steer. */
function makeContext({ userId = USER_ID, staff = STAFF, profiles = {}, today = TODAY, academy } = {}) {
  const loaders = {};
  const makeLoader = (load) => {
    let promise = null;
    return {
      all: () => (promise = promise || load()),
      get: async (key) => (await (promise = promise || load())).get(key),
      reset: () => {
        promise = null;
      },
    };
  };

  const staffById = new Map(staff.map((record) => [Number(record.id), record]));

  const context = {
    userId,
    hasWritableIdentity: Number.isFinite(userId),
    assertWritableIdentity() {
      if (!this.hasWritableIdentity) throw new CrewError(CREW_ERROR_CODES.UNAUTHENTICATED, "no usable account id");
    },
    clock: { today: () => today, nowIso: () => NOW_ISO },
    pillars: ["profiles", "training"],
    services: {},
    storeReads: { total: 0, byStore: {} },
    onStoreRead: () => {},
    loaders: { ownedStaff: { get: async () => staff }, staffById: makeLoader(async () => staffById) },
    addLoader(name, load) {
      if (!loaders[name]) loaders[name] = makeLoader(load);
      return loaders[name];
    },
    resetLoaders(...names) {
      for (const name of names) loaders[name]?.reset();
    },
    academyGateway: createAcademyGateway(academy || { isEnabled: async () => false }),
  };

  context.services.profiles = {
    // Mirrors the real profiles service's surface, including `ROLES` — the training
    // pillar reads known roles from the SERVICE rather than requiring into its
    // directory (§11), so a stub that omitted it would silently skip role validation.
    ROLES: PROFILE_ROLES,
    async findMember(staffId) {
      const id = Number(staffId);
      const record = staffById.get(id) || null;
      const profile = profiles[id] ?? null;
      if (!record && !profile) return null;
      return { staffId: id, staff: record, profile };
    },
    async listCrew() {
      return staff.map((record) => ({ staffId: Number(record.id), staff: record, profile: profiles[record.id] ?? null }));
    },
  };

  return context;
}

async function setup({ profiles = { 3: MECHANIC, 4: AGRONOMIST }, today, academy, staff } = {}) {
  const store = makeStoreDouble();
  const context = makeContext({ profiles, today, academy, staff });
  const service = createTrainingService(context, { store });
  context.services.training = service;
  return { service, store, context };
}

/** A course, and a member passed on it, which is the starting point for most cases. */
async function certified(service, { code = "chainsaw", validMonths = 24, completedOn = TODAY, staffId = 3, roles = ["MECHANIC"] } = {}) {
  const course = await service.defineCourse({ code, name: code, validMonths, mandatoryForRoles: roles });
  expect(course.outcome).toBe("DEFINED");

  const enrollment = await service.enroll({ staffId, courseId: course.course.id });
  expect(enrollment.outcome).toBe("ENROLLED");

  const recorded = await service.recordOutcome({ enrollmentId: enrollment.enrollment.id, outcome: "PASSED", completedOn, score: 90 });
  expect(recorded.outcome).toBe("RECORDED");
  return { course: course.course, enrollment: enrollment.enrollment, certification: recorded.certification };
}

describe("courses", () => {
  it("defines a course and finds it by code", async () => {
    const { service } = await setup();
    const result = await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24 });
    expect(result.outcome).toBe("DEFINED");
    expect(await service.findCourseByCode("chainsaw")).toMatchObject({ code: "chainsaw", validMonths: 24 });
  });

  it("stores mandatoryForRoles lower_snake_case, deduplicated and sorted", async () => {
    const { service } = await setup();
    const result = await service.defineCourse({
      code: "first_aid",
      name: "First aid",
      mandatoryForRoles: ["MANAGER", "STOCKPERSON", "MANAGER"],
    });
    expect(result.course.mandatoryForRoles).toEqual(["manager", "stockperson"]);
  });

  it("refuses a duplicate code — the tools gate refers to it and must be unambiguous", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    const again = await service.defineCourse({ code: "chainsaw", name: "Chainsaw again" });
    expect(again.outcome).toBe("VALIDATION_FAILED");
    expect(again.fieldErrors[0].field).toBe("code");
  });

  it("refuses to write on behalf of a session with no usable account id", async () => {
    const store = makeStoreDouble();
    const context = makeContext({ userId: NaN });
    const service = createTrainingService(context, { store });
    context.services.training = service;
    await expect(service.defineCourse({ code: "chainsaw", name: "Chainsaw" })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.UNAUTHENTICATED,
    });
  });
});

describe("enrollment", () => {
  it("enrolls a member as PLANNED", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    const result = await service.enroll({ staffId: 3, courseId: course.course.id, scheduledFor: addDays(TODAY, 30) });

    expect(result.outcome).toBe("ENROLLED");
    expect(result.enrollment).toMatchObject({ status: "planned", staffId: 3, userId: USER_ID, version: 1 });
  });

  it("refuses a second LIVE enrollment on the same course", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    const first = await service.enroll({ staffId: 3, courseId: course.course.id });
    const second = await service.enroll({ staffId: 3, courseId: course.course.id });

    expect(second.outcome).toBe("ALREADY_ENROLLED");
    expect(second.enrollmentId).toBe(String(first.enrollment.id));
  });

  it("allows re-enrolling after a pass — that is how re-certification works", async () => {
    const { service } = await setup();
    const { course } = await certified(service);
    expect((await service.enroll({ staffId: 3, courseId: course.id })).outcome).toBe("ENROLLED");
  });

  it("allows re-enrolling after a fail or a cancellation", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    const first = await service.enroll({ staffId: 3, courseId: course.course.id });
    await service.recordOutcome({ enrollmentId: first.enrollment.id, outcome: "FAILED" });
    expect((await service.enroll({ staffId: 3, courseId: course.course.id })).outcome).toBe("ENROLLED");
  });

  it("reports a course that does not exist", async () => {
    const { service } = await setup();
    expect((await service.enroll({ staffId: 3, courseId: 999 })).outcome).toBe("COURSE_NOT_FOUND");
  });

  it("throws MEMBER_NOT_FOUND for an unknown or unowned staff id", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    await expect(service.enroll({ staffId: 999, courseId: course.course.id })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.MEMBER_NOT_FOUND,
    });
  });
});

describe("recording an outcome", () => {
  it("mints a certificate on a pass, with the expiry computed from validMonths", async () => {
    const { service } = await setup();
    const { certification } = await certified(service, { completedOn: "2026-01-15", validMonths: 24 });
    expect(certification).toMatchObject({ issuedOn: "2026-01-15", expiresOn: "2028-01-14", staffId: 3 });
  });

  it("mints a certificate with NO expiry for a course with no validMonths", async () => {
    const { service } = await setup();
    const { certification } = await certified(service, { validMonths: null });
    expect(certification.expiresOn).toBeNull();
    expect(service.statusOf(certification)).toBe("valid");
  });

  it("links the enrollment to the certificate it minted", async () => {
    const { service } = await setup();
    const { enrollment, certification } = await certified(service);
    const stored = await service.findEnrollment(enrollment.id);
    expect(stored.certificationId).toBe(certification.id);
    expect(stored).toMatchObject({ status: "passed", version: 2 });
  });

  it("mints NOTHING on a fail or a cancellation", async () => {
    // The difference between "did not qualify" and "was never assessed" — both
    // recorded, neither certified.
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });

    for (const outcome of ["FAILED", "CANCELLED"]) {
      const enrollment = await service.enroll({ staffId: outcome === "FAILED" ? 3 : 4, courseId: course.course.id });
      const recorded = await service.recordOutcome({ enrollmentId: enrollment.enrollment.id, outcome });
      expect(recorded.outcome).toBe("RECORDED");
      expect(recorded.certification).toBeNull();
    }
    expect(await service.listCertifications({})).toHaveLength(0);
  });

  it("moves planned → in_progress → passed", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24 });
    const enrollment = await service.enroll({ staffId: 3, courseId: course.course.id });

    const started = await service.recordOutcome({ enrollmentId: enrollment.enrollment.id, outcome: "IN_PROGRESS" });
    expect(started.enrollment).toMatchObject({ status: "in_progress", version: 2 });
    expect(started.certification).toBeNull();

    const passed = await service.recordOutcome({ enrollmentId: enrollment.enrollment.id, outcome: "PASSED", completedOn: TODAY });
    expect(passed.enrollment).toMatchObject({ status: "passed", version: 3 });
    expect(passed.certification).not.toBeNull();
  });

  it("refuses a second outcome on a terminal enrollment, listing what is allowed", async () => {
    const { service } = await setup();
    const { enrollment } = await certified(service);
    const again = await service.recordOutcome({ enrollmentId: enrollment.id, outcome: "FAILED" });

    expect(again.outcome).toBe("ILLEGAL_TRANSITION");
    expect(again).toMatchObject({ from: "passed", to: "failed", allowed: [] });
  });

  it("mints exactly ONE certificate for one enrollment, however many times a pass is reported", async () => {
    const { service } = await setup();
    const { enrollment } = await certified(service);
    await service.recordOutcome({ enrollmentId: enrollment.id, outcome: "PASSED", completedOn: TODAY });
    expect(await service.listCertifications({ staffId: 3 })).toHaveLength(1);
  });

  it("reports an enrollment that does not exist", async () => {
    const { service } = await setup();
    expect((await service.recordOutcome({ enrollmentId: 999, outcome: "CANCELLED" })).outcome).toBe("ENROLLMENT_NOT_FOUND");
  });

  it("refuses an outcome recorded against a stale version", async () => {
    const { service } = await setup();
    const course = await service.defineCourse({ code: "chainsaw", name: "Chainsaw" });
    const enrollment = await service.enroll({ staffId: 3, courseId: course.course.id });
    await expect(
      service.recordOutcome({ enrollmentId: enrollment.enrollment.id, outcome: "CANCELLED", expectedVersion: 99 }),
    ).rejects.toMatchObject({ code: CREW_ERROR_CODES.VERSION_CONFLICT });
  });

  it("mints a SECOND certificate on re-certification, keeping the first", async () => {
    // Rule 3: nothing is edited. "Was Marek certified last August?" stays
    // answerable after this August's re-certification.
    const { service } = await setup();
    const { course, certification: first } = await certified(service, { completedOn: "2024-06-01" });

    const again = await service.enroll({ staffId: 3, courseId: course.id });
    const recorded = await service.recordOutcome({ enrollmentId: again.enrollment.id, outcome: "PASSED", completedOn: TODAY });

    const all = await service.listCertifications({ staffId: 3 });
    expect(all).toHaveLength(2);
    expect(await service.isSupersededCertification(first)).toBe(true);
    expect(await service.isSupersededCertification(recorded.certification)).toBe(false);
    // And the current one is what compliance reads.
    expect(service.statusOf(await service.currentCertificationFor(3, course.id))).toBe("valid");
  });
});

describe("revocation", () => {
  it("voids a certificate with a date and a reason, keeping the row", async () => {
    const { service, store } = await setup();
    const { certification } = await certified(service);
    const result = await service.revokeCertification({ certificationId: certification.id, reason: "falsified assessment" });

    expect(result.outcome).toBe("REVOKED");
    expect(result.certification).toMatchObject({ revokedOn: TODAY, revokedReason: "falsified assessment" });
    expect(store.snapshot().certifications).toHaveLength(1);
  });

  it("makes the status REVOKED immediately, even though the expiry is years away", async () => {
    const { service } = await setup();
    const { certification } = await certified(service, { validMonths: 36 });
    expect(service.statusOf(certification)).toBe("valid");

    const result = await service.revokeCertification({ certificationId: certification.id, reason: "voided" });
    expect(service.statusOf(result.certification)).toBe("revoked");
  });

  it("reports the compliance gaps revoking just opened", async () => {
    // Voiding a chainsaw ticket is exactly the moment somebody needs to know the
    // member is now non-compliant.
    const { service } = await setup();
    const { certification } = await certified(service, { code: "chainsaw", roles: ["MECHANIC"] });
    const result = await service.revokeCertification({ certificationId: certification.id, reason: "voided" });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ reason: "REVOKED", staffId: 3 });
  });

  it("is not repeatable", async () => {
    const { service } = await setup();
    const { certification } = await certified(service);
    await service.revokeCertification({ certificationId: certification.id, reason: "first" });
    const again = await service.revokeCertification({ certificationId: certification.id, reason: "second" });

    expect(again.outcome).toBe("ALREADY_REVOKED");
    expect(again.revokedReason).toBe("first");
  });

  it("requires a reason", async () => {
    const { service } = await setup();
    const { certification } = await certified(service);
    const result = await service.revokeCertification({ certificationId: certification.id, reason: "  " });
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(result.fieldErrors[0].field).toBe("reason");
  });

  it("reports a certificate that does not exist", async () => {
    const { service } = await setup();
    expect((await service.revokeCertification({ certificationId: 999, reason: "x" })).outcome).toBe("NOT_FOUND");
  });

  it("is cured by a NEW pass, not by reinstatement", async () => {
    // Reinstating would mean the reason it was voided had been erased, which is the
    // one thing a safety record must not allow.
    const { service } = await setup();
    const { course, certification } = await certified(service);
    await service.revokeCertification({ certificationId: certification.id, reason: "voided" });
    expect(await service.compliantFor(3)).toBe(false);

    const again = await service.enroll({ staffId: 3, courseId: course.id });
    await service.recordOutcome({ enrollmentId: again.enrollment.id, outcome: "PASSED", completedOn: TODAY });
    expect(await service.compliantFor(3)).toBe(true);
  });
});

describe("compliance gaps", () => {
  it("reports MISSING for a mandatory course never sat", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });

    const gaps = await service.gapsFor(3);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ reason: "MISSING", status: null });
  });

  it("reports EXPIRED once the certificate has lapsed", async () => {
    const { service } = await setup();
    await certified(service, { validMonths: 12, completedOn: "2024-01-01" });
    const gaps = await service.gapsFor(3);
    expect(gaps[0]).toMatchObject({ reason: "EXPIRED", status: "expired" });
  });

  it("reports NO gap while a certificate is merely expiring soon", async () => {
    const { service } = await setup();
    await certified(service, { validMonths: 12, completedOn: addDays(TODAY, -350) });
    expect(service.statusOf(await service.currentCertificationFor(3, 1))).toBe("expiring_soon");
    expect(await service.gapsFor(3)).toEqual([]);
    expect(await service.compliantFor(3)).toBe(true);
  });

  it("only applies a course to the roles it is mandatory for", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });

    // Staff 3 is the mechanic; staff 4 is the agronomist and is unaffected.
    expect(await service.gapsFor(3)).toHaveLength(1);
    expect(await service.gapsFor(4)).toHaveLength(0);
  });

  it("reports nothing for a member with no profile", async () => {
    const { service } = await setup({ profiles: { 3: MECHANIC } });
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });
    expect(await service.gapsFor(4)).toEqual([]);
  });

  it("collects every gap across the crew, sorted so a page can render it", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });
    await service.defineCourse({ code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: ["AGRONOMIST"] });

    const gaps = await service.allGaps();
    expect(gaps).toHaveLength(2);
    expect(gaps.map((gap) => gap.staffId)).toEqual([3, 4]);
  });
});

describe("expiring certificates", () => {
  it("includes ones that have ALREADY lapsed — they are the urgent rows", async () => {
    // A list called "expiring" that hid the ones already lapsed would be the most
    // dangerous possible report.
    const { service } = await setup();
    await certified(service, { validMonths: 12, completedOn: "2024-01-01" });
    const expiring = await service.expiring({});
    expect(expiring).toHaveLength(1);
    expect(service.statusOf(expiring[0])).toBe("expired");
  });

  it("respects the window", async () => {
    const { service } = await setup();
    await certified(service, { validMonths: 12, completedOn: addDays(TODAY, -300) });
    expect(await service.expiring({ withinDays: 10 })).toHaveLength(0);
    expect(await service.expiring({ withinDays: 90 })).toHaveLength(1);
  });

  it("excludes a certificate that never expires", async () => {
    const { service } = await setup();
    await certified(service, { validMonths: null });
    expect(await service.expiring({ withinDays: 100000 })).toHaveLength(0);
  });

  it("excludes revoked certificates — renewal is not the remedy", async () => {
    const { service } = await setup();
    const { certification } = await certified(service, { validMonths: 12, completedOn: "2024-01-01" });
    await service.revokeCertification({ certificationId: certification.id, reason: "voided" });
    expect(await service.expiring({})).toHaveLength(0);
  });

  it("excludes a SUPERSEDED certificate, so nobody is sent on a course they have sat", async () => {
    const { service } = await setup();
    const { course } = await certified(service, { validMonths: 12, completedOn: "2024-01-01" });
    const again = await service.enroll({ staffId: 3, courseId: course.id });
    await service.recordOutcome({ enrollmentId: again.enrollment.id, outcome: "PASSED", completedOn: TODAY });

    expect(await service.expiring({})).toHaveLength(0);
  });

  it("sorts by soonest first", async () => {
    const { service } = await setup();
    await certified(service, { code: "chainsaw", validMonths: 12, completedOn: addDays(TODAY, -340), staffId: 3 });
    await certified(service, { code: "pesticide", validMonths: 12, completedOn: addDays(TODAY, -320), staffId: 4, roles: [] });

    const expiring = await service.expiring({ withinDays: 90 });
    expect(expiring.map((row) => row.staffId)).toEqual([3, 4]);
  });
});

describe("the training matrix", () => {
  it("renders a grid with a gap count per row and a total", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24, mandatoryForRoles: ["MECHANIC"] });
    await service.defineCourse({ code: "pesticide", name: "Pesticide", validMonths: 36, mandatoryForRoles: ["AGRONOMIST"] });

    const matrix = await service.matrix();
    expect(matrix.courses).toHaveLength(2);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows.map((row) => row.gapCount)).toEqual([1, 1]);
    expect(matrix.totalGaps).toBe(2);
  });

  it("drops a row's gap once the member is certified", async () => {
    const { service } = await setup();
    await certified(service, { code: "chainsaw", roles: ["MECHANIC"] });
    const matrix = await service.matrix();
    expect(matrix.rows.find((row) => row.staffId === 3).gapCount).toBe(0);
  });
});

describe("the tools pillar's certification gate seam — FAIL CLOSED", () => {
  // §8.5's cross-pillar rule, tested here because this is the side that computes it.
  // The mistake it guards against is the natural one: an empty result read as "no
  // objection". Every branch below that is not a live certificate must refuse.

  it("PERMITS a member holding a valid certificate", async () => {
    const { service } = await setup();
    await certified(service, { code: "chainsaw" });
    const result = await service.evaluateCertification(3, "chainsaw");
    expect(result).toMatchObject({ outcome: "PERMITTED", status: "valid" });
  });

  it("PERMITS one that is merely expiring soon", async () => {
    const { service } = await setup();
    await certified(service, { code: "chainsaw", validMonths: 12, completedOn: addDays(TODAY, -350) });
    expect((await service.evaluateCertification(3, "chainsaw")).outcome).toBe("PERMITTED");
  });

  it("refuses when the member was never certified", async () => {
    const { service } = await setup();
    await service.defineCourse({ code: "chainsaw", name: "Chainsaw", validMonths: 24 });
    expect(await service.evaluateCertification(3, "chainsaw")).toMatchObject({ outcome: "NOT_CERTIFIED", status: null });
  });

  it("refuses on an expired certificate", async () => {
    const { service } = await setup();
    await certified(service, { code: "chainsaw", validMonths: 12, completedOn: "2024-01-01" });
    expect(await service.evaluateCertification(3, "chainsaw")).toMatchObject({ outcome: "NOT_CERTIFIED", status: "expired" });
  });

  it("refuses on a revoked certificate", async () => {
    const { service } = await setup();
    const { certification } = await certified(service, { code: "chainsaw" });
    await service.revokeCertification({ certificationId: certification.id, reason: "voided" });
    expect(await service.evaluateCertification(3, "chainsaw")).toMatchObject({ outcome: "NOT_CERTIFIED", status: "revoked" });
  });

  it("reports UNAVAILABLE — not a pass — when NO COURSE answers to the code", async () => {
    // The case §8.5 names explicitly. The check could not be evaluated at all, and
    // the caller must treat that as a refusal.
    const { service } = await setup();
    const result = await service.evaluateCertification(3, "chainsaw");
    expect(result).toMatchObject({ outcome: "UNAVAILABLE", reason: "COURSE_NOT_DEFINED" });
    expect(result.outcome).not.toBe("PERMITTED");
  });

  it("reports UNAVAILABLE for a missing or unusable course code", async () => {
    const { service } = await setup();
    for (const code of [null, undefined, "", "   "]) {
      expect((await service.evaluateCertification(3, code)).outcome).toBe("UNAVAILABLE");
    }
  });

  it("reports UNAVAILABLE when the store cannot be read", async () => {
    const context = makeContext({ profiles: { 3: MECHANIC } });
    const exploding = {
      async getAll() {
        throw new Error("store on fire");
      },
      async update() {
        throw new Error("store on fire");
      },
    };
    const service = createTrainingService(context, { store: exploding });
    context.services.training = service;

    expect((await service.evaluateCertification(3, "chainsaw")).outcome).toBe("UNAVAILABLE");
  });

  it("never returns PERMITTED for a member who is not certified, on any path", async () => {
    // The one assertion that matters restated as a sweep, because fail-closed is a
    // property of the whole function rather than of any one branch.
    const { service } = await setup();
    const { certification } = await certified(service, { code: "chainsaw", validMonths: 12, completedOn: "2024-01-01" });
    await service.revokeCertification({ certificationId: certification.id, reason: "voided" });

    for (const [staffId, code] of [
      [3, "chainsaw"],
      [4, "chainsaw"],
      [3, "no_such_course"],
      [3, ""],
      [999, "chainsaw"],
    ]) {
      expect((await service.evaluateCertification(staffId, code)).outcome).not.toBe("PERMITTED");
    }
  });
});

describe("orphaned overlays (§12 rule 4)", () => {
  it("reports enrollments and certificates whose staff record is gone", async () => {
    const { service, store } = await setup();
    await certified(service);
    expect(await service.findOrphanedOverlays()).toHaveLength(0);

    // Rebuild over the same rows with staff 3 no longer in staff.json.
    const context = makeContext({ staff: STAFF.filter((record) => record.id !== 3), profiles: { 3: MECHANIC } });
    const orphaned = createTrainingService(context, { store: makeStoreDouble(store.snapshot()) });
    context.services.training = orphaned;

    const orphans = await orphaned.findOrphanedOverlays();
    expect(orphans).toHaveLength(2);
    expect(orphans.map((row) => row.detail)).toEqual([expect.stringContaining("Enrollment"), expect.stringContaining("Certification")]);
  });

  it("still reads an orphan's certificates, but refuses to enroll them", async () => {
    const { service, store } = await setup();
    const { course } = await certified(service);

    const context = makeContext({ staff: STAFF.filter((record) => record.id !== 3), profiles: { 3: MECHANIC } });
    const orphaned = createTrainingService(context, { store: makeStoreDouble(store.snapshot()) });
    context.services.training = orphaned;

    expect(await orphaned.listCertifications({ staffId: 3 })).toHaveLength(1);
    await expect(orphaned.enroll({ staffId: 3, courseId: course.id })).rejects.toMatchObject({
      code: CREW_ERROR_CODES.MEMBER_NOT_FOUND,
    });
  });
});

// --- the academy link -------------------------------------------------------

describe("the AgriAcademy link degrades to null, never to an error", () => {
  // The fourth thing Phase 5 names. Every one of these is a reason for null, and a
  // caller cannot tell them apart — deliberately, because a training matrix has
  // nothing useful to do with the difference.

  const CERT_ROWS = [
    { examId: "exam-7", certificateNo: "AC-1", examTitle: "Pesticide handling", issuedAt: "2026-03-01T00:00:00.000Z", score: 92 },
  ];

  it("returns the certificate when the flag is on and the academy answers", async () => {
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 200, body: CERT_ROWS }) },
    });
    expect(await gateway.certificateForExam(1, "exam-7")).toMatchObject({
      certificateNo: "AC-1",
      examId: "exam-7",
      issuedOn: "2026-03-01",
      score: 92,
    });
  });

  it("returns null when the flag is OFF, without dialling the academy at all", async () => {
    let called = false;
    const gateway = createAcademyGateway({
      isEnabled: async () => false,
      client: {
        listCertificates: async () => {
          called = true;
          return { status: 200, body: CERT_ROWS };
        },
      },
    });
    expect(await gateway.certificateForExam(1, "exam-7")).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null when the academy is OFFLINE", async () => {
    // The client's documented offline shape — a 503 envelope rather than a throw.
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 503, body: { error: "AGRI_ACADEMY_OFFLINE" } }) },
    });
    expect(await gateway.certificateForExam(1, "exam-7")).toBeNull();
  });

  it("returns null when the client THROWS, not just when it reports an error", async () => {
    // Belt and braces: this file's promise is that it never fails a query, and a
    // promise that depends on another module keeping its documentation accurate is
    // not a promise.
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: {
        listCertificates: async () => {
          throw new Error("socket hang up");
        },
      },
    });
    expect(await gateway.certificateForExam(1, "exam-7")).toBeNull();
  });

  it("returns null when the response is an unreadable shape", async () => {
    for (const body of [null, "not json", { unexpected: true }, 42]) {
      const gateway = createAcademyGateway({
        isEnabled: async () => true,
        client: { listCertificates: async () => ({ status: 200, body }) },
      });
      expect(await gateway.certificateForExam(1, "exam-7")).toBeNull();
    }
  });

  it("returns null when the account holds no certificate for that exam", async () => {
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 200, body: CERT_ROWS }) },
    });
    expect(await gateway.certificateForExam(1, "exam-999")).toBeNull();
  });

  it("returns null for a course with no academyExamId", async () => {
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 200, body: [] }) },
    });
    for (const examId of [null, undefined, ""]) {
      expect(await gateway.certificateForExam(1, examId)).toBeNull();
    }
  });

  it("tolerates the { certificates: [...] } envelope as well as a bare array", async () => {
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: { listCertificates: async () => ({ status: 200, body: { certificates: CERT_ROWS } }) },
    });
    expect(await gateway.certificateForExam(1, "exam-7")).not.toBeNull();
  });

  it("dials the academy at most ONCE per request, however many courses ask", async () => {
    let calls = 0;
    const gateway = createAcademyGateway({
      isEnabled: async () => true,
      client: {
        listCertificates: async () => {
          calls += 1;
          return { status: 200, body: CERT_ROWS };
        },
      },
    });

    await Promise.all([
      gateway.certificateForExam(1, "exam-7"),
      gateway.certificateForExam(1, "exam-7"),
      gateway.certificateForExam(1, "exam-8"),
    ]);
    expect(calls).toBe(1);
  });

  it("is reachable through the service's own context, with a course that links out", async () => {
    const { service, context } = await setup({
      academy: { isEnabled: async () => true, client: { listCertificates: async () => ({ status: 200, body: CERT_ROWS }) } },
    });
    const course = await service.defineCourse({ code: "pesticide", name: "Pesticide", validMonths: 36, academyExamId: "exam-7" });
    expect(course.course.academyExamId).toBe("exam-7");
    expect(await context.academyGateway.certificateForExam(USER_ID, course.course.academyExamId)).toMatchObject({ certificateNo: "AC-1" });
  });
});
