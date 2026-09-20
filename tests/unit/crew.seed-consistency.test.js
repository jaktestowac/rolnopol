import { describe, it, expect } from "vitest";

// Demo seed data for the crew pillars (PRD §11).
//
// The seeds themselves need a store and a transaction, so what is checked here is
// the part that is pure: the templates, and the arithmetic that makes them mean
// something. That matters more than it sounds, because each seed's docblock makes
// specific claims — "175 days ago on a 180-day interval leaves 5 days, which is
// inside the 14-day notice window ⇒ due_soon", "23 months ago on a 24-month course
// ⇒ expiring_soon" — and those claims are the entire reason a fresh install shows
// one of each interesting state instead of a wall of green.
//
// Also checked: the references that cross a pillar boundary. A tool requiring a
// `chainsaw` certification and a course whose code is `chainsaw` are two files that
// never import each other, so nothing but a test stops one being renamed alone.
const { COURSES, PASS_PLAN } = require("../../services/crew/pillars/training/seed");
const { TOOLS, ISSUANCE_PLAN } = require("../../services/crew/pillars/tools/seed");
const { DUTY_TYPES } = require("../../services/crew/pillars/work/seed");
const { startDateFor } = require("../../services/crew/pillars/profiles/seed");
const { demoPolicy, countWorkingDays, PUBLIC_HOLIDAYS_BY_YEAR } = require("../../services/crew/pillars/leave/seed");
const { expiryDateFor, certificationStatus, EXPIRING_SOON_DAYS } = require("../../services/crew/pillars/training/expiry");
const { parseTime, shiftInterval } = require("../../services/crew/pillars/work/work-time");
const { addDays, daysBetween, fromDateString } = require("../../services/crew/clock");
const { readPillarSdl } = require("../helpers/crew-sdl");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOWER_SNAKE = /^[a-z][a-z0-9_]*$/;
const SCREAMING = /^[A-Z][A-Z0-9_]*$/;

/** The canonical role vocabulary, read from the SDL rather than copied. */
const CREW_ROLES = (() => {
  const match = readPillarSdl("profiles").match(/enum CrewRole \{([^}]*)\}/);
  if (!match) throw new Error("enum CrewRole not found in the profiles SDL");
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
})();

// A fixed date so nothing here depends on the day the suite runs.
const TODAY = "2026-08-27";

describe("seed data — training courses", () => {
  it("has unique lower_snake_case codes", () => {
    const codes = COURSES.map((course) => course.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(LOWER_SNAKE);
    }
  });

  it("gives every course the fields the pillar reads", () => {
    for (const course of COURSES) {
      expect(typeof course.name).toBe("string");
      expect(course.name.length).toBeGreaterThan(0);
      expect(typeof course.provider).toBe("string");
      expect(Array.isArray(course.mandatoryForRoles)).toBe(true);
      expect(course).toHaveProperty("academyExamId");
    }
  });

  it("stores validMonths as null or a positive integer, never zero", () => {
    for (const course of COURSES) {
      if (course.validMonths === null) continue;
      expect(Number.isInteger(course.validMonths)).toBe(true);
      expect(course.validMonths).toBeGreaterThan(0);
    }
  });

  it("stores mandatory roles lower_snake_case, as §6.4 writes them to disk", () => {
    for (const course of COURSES) {
      for (const role of course.mandatoryForRoles) {
        expect(role).toMatch(LOWER_SNAKE);
      }
    }
  });

  it("names only roles the CrewRole enum declares", () => {
    const known = new Set(CREW_ROLES.map((role) => role.toLowerCase()));

    for (const course of COURSES) {
      for (const role of course.mandatoryForRoles) {
        expect(known.has(role)).toBe(true);
      }
    }
  });

  it("keeps the 'certificate for life' case in the demo data", () => {
    // The branch is easy to lose and impossible to notice: every course having an
    // expiry date means the never-expires path is only ever exercised in tests.
    expect(COURSES.some((course) => course.validMonths === null)).toBe(true);
  });

  it("leaves at least one role uncovered, so the matrix shows a compliance gap", () => {
    const covered = new Set(COURSES.flatMap((course) => course.mandatoryForRoles));
    expect(covered.size).toBeLessThan(CREW_ROLES.length);
  });
});

describe("seed data — the pass plan produces one of each certificate state", () => {
  it("references only courses that exist", () => {
    const codes = new Set(COURSES.map((course) => course.code));

    for (const plan of PASS_PLAN) {
      expect(codes.has(plan.courseCode)).toBe(true);
    }
  });

  it("gives each pass a plausible score and a reference", () => {
    for (const plan of PASS_PLAN) {
      expect(plan.score).toBeGreaterThanOrEqual(0);
      expect(plan.score).toBeLessThanOrEqual(100);
      expect(typeof plan.reference).toBe("string");
      expect(plan.daysAgo).toBeGreaterThan(0);
    }
  });

  it("uses each course at most once, so a member is not certified twice over", () => {
    const codes = PASS_PLAN.map((plan) => plan.courseCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("lands the three seeded passes on three DIFFERENT statuses", () => {
    const byCode = Object.fromEntries(COURSES.map((course) => [course.code, course]));

    const statuses = PASS_PLAN.map((plan) => {
      const completedOn = addDays(TODAY, -plan.daysAgo);
      const expiresOn = expiryDateFor(completedOn, byCode[plan.courseCode].validMonths);
      return certificationStatus({ completedOn, expiresOn }, TODAY);
    });

    // The docblock promises valid / expiring_soon / expired, in that order.
    expect(statuses).toEqual(["valid", "expiring_soon", "expired"]);
  });

  it("puts the expiring_soon pass genuinely inside the notice window", () => {
    const plan = PASS_PLAN[1];
    const course = COURSES.find((entry) => entry.code === plan.courseCode);
    const completedOn = addDays(TODAY, -plan.daysAgo);
    const daysLeft = daysBetween(TODAY, expiryDateFor(completedOn, course.validMonths));

    expect(daysLeft).toBeGreaterThan(0);
    expect(daysLeft).toBeLessThanOrEqual(EXPIRING_SOON_DAYS);
  });
});

describe("seed data — tools", () => {
  it("has unique upper-case asset tags", () => {
    const tags = TOOLS.map((tool) => tool.assetTag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) {
      expect(tag).toBe(tag.toUpperCase());
    }
  });

  it("gives every tool the fields the pillar reads", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.category).toMatch(LOWER_SNAKE);
      expect(typeof tool.storageLocation).toBe("string");
      expect(tool).toHaveProperty("icon");
      expect(tool).toHaveProperty("requiresCertification");
      expect(tool).toHaveProperty("serviceIntervalDays");
      expect(tool).toHaveProperty("servicedDaysAgo");
    }
  });

  it("requires only certifications the training seed actually grants", () => {
    // The cross-pillar reference. Rename the course and this fails here, rather
    // than as a tool nobody can ever be issued.
    const codes = new Set(COURSES.map((course) => course.code));

    for (const tool of TOOLS.filter((entry) => entry.requiresCertification)) {
      expect(codes.has(tool.requiresCertification)).toBe(true);
    }
  });

  it("keeps exactly one certification-gated tool, so the gate demonstrates both answers", () => {
    const gated = TOOLS.filter((tool) => tool.requiresCertification);
    expect(gated).toHaveLength(1);
    // And the course it needs is one the pass plan grants to a real member.
    expect(PASS_PLAN.map((plan) => plan.courseCode)).toContain(gated[0].requiresCertification);
  });

  it("never records a service date for a tool with no service interval", () => {
    for (const tool of TOOLS.filter((entry) => entry.serviceIntervalDays === null)) {
      expect(tool.servicedDaysAgo).toBeNull();
    }
  });

  it("keeps the 'interval but no history' tool, which the ledger reads as overdue", () => {
    expect(TOOLS.some((tool) => tool.serviceIntervalDays !== null && tool.servicedDaysAgo === null)).toBe(true);
  });

  it("keeps the 'no schedule at all' tool, so never-due is distinguishable from not-yet-due", () => {
    expect(TOOLS.some((tool) => tool.serviceIntervalDays === null)).toBe(true);
  });

  it("lands one tool due_soon and one overdue, exactly as the docblock claims", () => {
    const NOTICE_DAYS = 14;
    const daysLeft = (tool) => tool.serviceIntervalDays - tool.servicedDaysAgo;
    const scheduled = TOOLS.filter((tool) => tool.serviceIntervalDays !== null && tool.servicedDaysAgo !== null);

    const dueSoon = scheduled.filter((tool) => daysLeft(tool) >= 0 && daysLeft(tool) <= NOTICE_DAYS);
    const overdue = scheduled.filter((tool) => daysLeft(tool) < 0);
    const comfortable = scheduled.filter((tool) => daysLeft(tool) > NOTICE_DAYS);

    expect(dueSoon).toHaveLength(1);
    expect(overdue).toHaveLength(1);
    expect(comfortable.length).toBeGreaterThan(0);
  });
});

describe("seed data — the issuance plan", () => {
  it("issues only tools that exist", () => {
    const tags = new Set(TOOLS.map((tool) => tool.assetTag));

    for (const plan of ISSUANCE_PLAN) {
      expect(tags.has(plan.assetTag)).toBe(true);
    }
  });

  it("addresses members by list position, because a seed cannot know real staff ids", () => {
    for (const plan of ISSUANCE_PLAN) {
      expect(Number.isInteger(plan.staffIndex)).toBe(true);
      expect(plan.staffIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("never issues a certification-gated tool, which would need the seed to check the gate", () => {
    const gated = new Set(TOOLS.filter((tool) => tool.requiresCertification).map((tool) => tool.assetTag));

    for (const plan of ISSUANCE_PLAN) {
      expect(gated.has(plan.assetTag)).toBe(false);
    }
  });

  it("never issues the same tool twice while it is still out", () => {
    const openTags = ISSUANCE_PLAN.filter((plan) => plan.returnedDaysAgo === undefined).map((plan) => plan.assetTag);
    expect(new Set(openTags).size).toBe(openTags.length);
  });

  it("includes one open-and-in-date, one open-and-overdue, and one closed row", () => {
    const open = ISSUANCE_PLAN.filter((plan) => plan.returnedDaysAgo === undefined);
    const closed = ISSUANCE_PLAN.filter((plan) => plan.returnedDaysAgo !== undefined);

    expect(open.filter((plan) => plan.dueInDays >= 0)).toHaveLength(1);
    expect(open.filter((plan) => plan.dueInDays < 0)).toHaveLength(1);
    expect(closed).toHaveLength(1);
  });

  it("returns the closed row after it was issued, not before", () => {
    for (const plan of ISSUANCE_PLAN.filter((entry) => entry.returnedDaysAgo !== undefined)) {
      expect(plan.returnedDaysAgo).toBeLessThan(plan.issuedDaysAgo);
    }
  });
});

describe("seed data — duty types", () => {
  it("has unique lower_snake_case codes and a name apiece", () => {
    const codes = DUTY_TYPES.map((duty) => duty.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const duty of DUTY_TYPES) {
      expect(duty.code).toMatch(LOWER_SNAKE);
      expect(typeof duty.name).toBe("string");
      expect(duty.name.length).toBeGreaterThan(0);
    }
  });

  it("gives every duty type a parseable 24-hour window", () => {
    for (const duty of DUTY_TYPES) {
      expect(parseTime(duty.startTime)).not.toBeNull();
      expect(parseTime(duty.endTime)).not.toBeNull();
    }
  });

  it("names required roles in the work pillar's own SCREAMING_CASE, and only known roles", () => {
    // The work pillar stores shift statuses and roles SCREAMING_CASE and therefore
    // has no enum translation at all — see work/resolvers.js. Training stores the
    // same vocabulary lower_snake_case. Both are checked against one SDL enum.
    const known = new Set(CREW_ROLES);

    for (const duty of DUTY_TYPES.filter((entry) => entry.requiredRole)) {
      expect(duty.requiredRole).toMatch(SCREAMING);
      expect(known.has(duty.requiredRole)).toBe(true);
    }
  });

  it("leaves at least one duty type open to any role", () => {
    expect(DUTY_TYPES.some((duty) => duty.requiredRole === null)).toBe(true);
  });

  it("keeps exactly one midnight-crossing duty, so the roster handles it from day one", () => {
    const crossing = DUTY_TYPES.filter((duty) => parseTime(duty.endTime) <= parseTime(duty.startTime));

    expect(crossing).toHaveLength(1);
    expect(crossing[0].code).toBe("night_watch");
  });

  it("resolves every duty type to a positive-length interval", () => {
    for (const duty of DUTY_TYPES) {
      const interval = shiftInterval(TODAY, duty.startTime, duty.endTime);
      expect(interval).not.toBeNull();
      expect(interval.end).toBeGreaterThan(interval.start);
    }
  });

  it("gives every duty type a colour the roster can paint with", () => {
    for (const duty of DUTY_TYPES) {
      expect(duty.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("seed data — the leave policy", () => {
  it("fixes the holiday lists to real, unique, sorted calendar dates", () => {
    for (const [year, holidays] of Object.entries(PUBLIC_HOLIDAYS_BY_YEAR)) {
      expect(new Set(holidays).size).toBe(holidays.length);
      expect([...holidays].sort()).toEqual(holidays);

      for (const holiday of holidays) {
        expect(holiday).toMatch(ISO_DATE);
        expect(fromDateString(holiday)).not.toBeNull();
        expect(holiday.slice(0, 4)).toBe(year);
      }
    }
  });

  it("covers consecutive years, so a request across the new year still meets a policy that knows its holidays", () => {
    const years = Object.keys(PUBLIC_HOLIDAYS_BY_YEAR).map(Number).sort();

    expect(years.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < years.length; index += 1) {
      expect(years[index]).toBe(years[index - 1] + 1);
    }
  });

  it("hands a policy both this year's and next year's holidays", () => {
    const policy = demoPolicy("2026-05-01");

    expect(policy.publicHolidays).toEqual([...PUBLIC_HOLIDAYS_BY_YEAR[2026], ...PUBLIC_HOLIDAYS_BY_YEAR[2027]]);
  });

  it("degrades to an empty holiday list for a year nobody fixed, rather than throwing", () => {
    const policy = demoPolicy("2099-01-01");

    expect(policy.publicHolidays).toEqual([]);
    expect(policy.annualEntitlementDaysFullTime).toBe(26);
  });

  it("declares the harvest blackout in the policy's own year", () => {
    const policy = demoPolicy("2027-03-15");

    expect(policy.blackoutWindows).toEqual([{ from: "2027-08-15", to: "2027-09-15", reason: "Harvest" }]);
    expect(policy.blackoutWindows[0].from < policy.blackoutWindows[0].to).toBe(true);
  });

  it("keeps the policy's own fields internally coherent", () => {
    const policy = demoPolicy(TODAY);

    expect(policy.accrualMode).toMatch(LOWER_SNAKE);
    expect(policy.carryOverCapDays).toBeLessThan(policy.annualEntitlementDaysFullTime);
    expect(policy.minNoticeDays).toBeGreaterThan(0);
    expect(policy.leaveYearStart).toMatch(/^\d{2}-\d{2}$/);
    expect(policy.carryOverExpiresOn).toMatch(/^\d{2}-\d{2}$/);
  });
});

describe("seed data — countWorkingDays", () => {
  // A local copy of the working-day rule, because the seed runs before any request
  // context exists. That makes it worth its own tests: nothing else exercises it.
  const noHolidays = { publicHolidays: [] };

  it("counts a plain midweek range inclusively", () => {
    // Monday to Wednesday.
    expect(countWorkingDays("2026-08-24", "2026-08-26", noHolidays)).toBe(3);
  });

  it("counts a single working day as one", () => {
    expect(countWorkingDays("2026-08-24", "2026-08-24", noHolidays)).toBe(1);
  });

  it("counts a single weekend day as none", () => {
    expect(countWorkingDays("2026-08-29", "2026-08-29", noHolidays)).toBe(0); // Saturday
    expect(countWorkingDays("2026-08-30", "2026-08-30", noHolidays)).toBe(0); // Sunday
  });

  it("skips the weekend inside a range", () => {
    // Friday to Monday: Friday and Monday only.
    expect(countWorkingDays("2026-08-28", "2026-08-31", noHolidays)).toBe(2);
  });

  it("counts a full week as five", () => {
    expect(countWorkingDays("2026-08-24", "2026-08-30", noHolidays)).toBe(5);
  });

  it("excludes a listed public holiday that falls on a weekday", () => {
    // 2026-05-01 is a Friday and a listed holiday.
    const policy = { publicHolidays: ["2026-05-01"] };

    expect(countWorkingDays("2026-04-27", "2026-05-01", policy)).toBe(4);
    expect(countWorkingDays("2026-04-27", "2026-05-01", noHolidays)).toBe(5);
  });

  it("does not double-discount a holiday that already falls on a weekend", () => {
    const saturday = "2026-08-29";
    const policy = { publicHolidays: [saturday] };

    expect(countWorkingDays(saturday, saturday, policy)).toBe(0);
  });

  it("returns zero for an inverted range rather than looping forever", () => {
    expect(countWorkingDays("2026-08-26", "2026-08-24", noHolidays)).toBe(0);
  });

  it("treats a missing or holiday-less policy as no holidays", () => {
    expect(countWorkingDays("2026-08-24", "2026-08-26", undefined)).toBe(3);
    expect(countWorkingDays("2026-08-24", "2026-08-26", {})).toBe(3);
  });

  it("agrees with the real policy on a range containing a fixed holiday", () => {
    const policy = demoPolicy("2026-01-05");

    // 2026-01-06 (Epiphany) is a Tuesday and listed, so Mon–Wed counts two.
    expect(countWorkingDays("2026-01-05", "2026-01-07", policy)).toBe(2);
  });
});

describe("seed data — profile start dates", () => {
  it("returns a calendar date in the past", () => {
    const start = startDateFor(TODAY, 0);

    expect(start).toMatch(ISO_DATE);
    expect(start < TODAY).toBe(true);
  });

  it("gives every seeded member at least 20 days of tenure", () => {
    // A profile created today would show a tenure of zero, which reads as a bug
    // rather than as a new hire.
    for (let index = 0; index < 40; index += 1) {
      expect(daysBetween(startDateFor(TODAY, index), TODAY)).toBeGreaterThanOrEqual(20);
    }
  });

  it("hires later members more recently, so the demo roster has a spread of tenures", () => {
    const first = startDateFor(TODAY, 0);
    const second = startDateFor(TODAY, 1);

    expect(first < second).toBe(true);
    expect(daysBetween(first, second)).toBe(120);
  });

  it("stops receding once the floor is reached rather than passing today", () => {
    const late = startDateFor(TODAY, 100);

    expect(late < TODAY).toBe(true);
    expect(daysBetween(late, TODAY)).toBe(20);
  });

  it("is a pure function of the day it is given", () => {
    expect(startDateFor(TODAY, 3)).toBe(startDateFor(TODAY, 3));
    expect(startDateFor("2026-08-28", 3)).not.toBe(startDateFor(TODAY, 3));
  });
});
