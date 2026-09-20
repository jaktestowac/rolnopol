/**
 * Certification expiry arithmetic — the pure core of the training pillar
 * (PRD §8.4, §14.1).
 *
 * No store, no context, no clock of its own: `today` is always a parameter. That
 * is the whole reason this file exists separately, because the questions this
 * pillar answers are all questions about a boundary, and a boundary you cannot
 * stand on is a boundary you cannot test. "Is a chainsaw ticket that expires today
 * still valid?" has exactly one right answer and two plausible wrong ones.
 *
 * Five decisions live here:
 *
 *   1. **A certificate is valid THROUGH its expiry date.** `expiresOn` is the last
 *      good day, not the first bad one. So expiring today is `valid`, and expiring
 *      yesterday is `expired`. Dates in this module carry no time of day, so
 *      "23:59 on the expiry date" and "the expiry date" are the same value — which
 *      is the point: there is no hour at which a ticket silently lapses mid-shift.
 *
 *   2. **`revoked` beats everything.** A revoked certificate is never `valid`, and
 *      never `expiring_soon`, whatever its dates say. Revocation is a statement
 *      about the certificate's legitimacy; expiry is a statement about its age, and
 *      an illegitimate certificate does not become legitimate because it is young.
 *
 *   3. **No `validMonths` means no expiry.** Some tickets are for life. Treating a
 *      missing `validMonths` as zero would expire them the day they were issued,
 *      which is the more dangerous error of the two.
 *
 *   4. **Adding months CLAMPS to the end of the month.** A certificate earned on
 *      31 January and valid one month expires on 28 February, not 3 March. Rolling
 *      over would silently extend every end-of-month certificate.
 *
 *   5. **`expiring_soon` is a fixed window, not a per-course setting.** It exists so
 *      somebody has time to book a re-certification course; making it configurable
 *      per course would mean the training matrix showed two different meanings of
 *      amber in the same column.
 */
const { fromDateString, toDateString, daysBetween } = require("../../clock");

/** The four states a certificate can be in (§8.4). */
const CERTIFICATION_STATUSES = ["valid", "expiring_soon", "expired", "revoked"];

/** The enrollment lifecycle states (§6.4). */
const ENROLLMENT_STATUSES = ["planned", "in_progress", "passed", "failed", "cancelled"];

/**
 * Enough notice to book a course and sit it. Decision 5 above.
 *
 * Sixty days rather than thirty because the courses this models — pesticide
 * handling, chainsaw, first aid — run monthly at best, and a warning that arrives
 * after the last course before the deadline is not a warning.
 */
const EXPIRING_SOON_DAYS = 60;

/**
 * Add whole months to a date, clamping to the end of the target month.
 *
 * Decision 4. `2026-01-31` + 1 month is `2026-02-28`, and in a leap year
 * `2028-01-31` + 1 month is `2028-02-29` — the clamp asks the calendar rather than
 * assuming 28.
 *
 * @param {string} dateString - YYYY-MM-DD
 * @param {number} months
 * @returns {string|null} YYYY-MM-DD, or null when the input is unusable
 */
function addMonthsClamped(dateString, months) {
  const date = fromDateString(dateString);
  if (!date || !Number.isFinite(months)) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  // Day 0 of the following month is the last day of the target month, which is how
  // the calendar itself is asked how long February is this year.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDateString(new Date(Date.UTC(year, month, Math.min(day, lastDayOfTargetMonth))));
}

/**
 * When a certificate earned on `completedOn` runs out.
 *
 * @param {string} completedOn - YYYY-MM-DD
 * @param {number|null} validMonths - null/0-or-less ⇒ never expires (decision 3)
 * @returns {string|null} the LAST valid day, or null for a certificate for life
 */
function expiryDateFor(completedOn, validMonths) {
  const months = Number(validMonths);
  if (!Number.isFinite(months) || months <= 0) return null;
  // `- 1` because `expiresOn` is the last valid day: three years from 1 September
  // 2026 runs out at the end of 31 August 2029, not on 1 September.
  //
  // NOTE: §6.4's example writes `expiresOn: "2029-09-01"` for a 36-month ticket
  // issued on 2026-09-01, i.e. the first INVALID day. We keep the last VALID day
  // instead, because decision 1 makes `expiresOn` mean "valid through", and two
  // meanings for one field is how an off-by-one-day lapse gets shipped.
  const anniversary = addMonthsClamped(completedOn, months);
  return anniversary === null ? null : addDaysTo(anniversary, -1);
}

/** Local day arithmetic, kept here so this file needs nothing but the clock's parser. */
function addDaysTo(dateString, days) {
  const date = fromDateString(dateString);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/**
 * The computed status of a certificate on a given day (§8.4).
 *
 * @param {object} certification - needs `expiresOn` and `revokedOn`
 * @param {string} today - YYYY-MM-DD
 * @param {object} [options]
 * @param {number} [options.expiringSoonDays]
 * @returns {"valid"|"expiring_soon"|"expired"|"revoked"|null} null for no certificate
 */
function certificationStatus(certification, today, { expiringSoonDays = EXPIRING_SOON_DAYS } = {}) {
  if (!certification) return null;

  // Decision 2: revoked wins, unconditionally and before any date is looked at.
  if (certification.revokedOn) return "revoked";

  // Decision 3: a certificate for life.
  if (!certification.expiresOn) return "valid";

  const daysLeft = daysBetween(today, certification.expiresOn);
  if (daysLeft === null) return "valid";

  // Decision 1: `expiresOn` is the last valid day, so `daysLeft === 0` is still
  // valid and `daysLeft === -1` is the first expired day.
  if (daysLeft < 0) return "expired";
  if (daysLeft <= expiringSoonDays) return "expiring_soon";
  return "valid";
}

/** Days until a certificate runs out. Negative once past, null when it never does. */
function daysUntilExpiry(certification, today) {
  if (!certification?.expiresOn) return null;
  return daysBetween(today, certification.expiresOn);
}

/** A status that still permits work: valid, or valid but running out. */
const PERMITTING_STATUSES = ["valid", "expiring_soon"];

/**
 * Does this status let somebody do the thing the certificate is for?
 *
 * Used by the training pillar's own compliance reads and, from Phase 6, by the
 * tools pillar's certification gate. Written as one predicate precisely so those
 * two cannot drift into disagreeing about whether an `expiring_soon` chainsaw
 * ticket is good enough. It is: it has not run out yet.
 */
function permitsWork(status) {
  return PERMITTING_STATUSES.includes(status);
}

/**
 * The certificate that currently counts for a staff member on a course.
 *
 * Re-passing a course mints a NEW certificate rather than editing the old one, so
 * a member can hold several for the same course. The one that counts is the most
 * recently issued that has not been revoked — falling back to the most recent
 * revoked one when that is all there is, because "revoked" is an answer the
 * compliance view needs to show. Returning null there would report the member as
 * merely uncertified and lose the reason.
 *
 * @param {Array} certifications - any set of rows
 * @param {number|string} staffId
 * @param {number|string} courseId
 */
function currentCertification(certifications, staffId, courseId) {
  const mine = (certifications || []).filter((row) => Number(row.staffId) === Number(staffId) && Number(row.courseId) === Number(courseId));
  if (mine.length === 0) return null;

  const byNewest = (a, b) => (a.issuedOn === b.issuedOn ? Number(b.id) - Number(a.id) : b.issuedOn.localeCompare(a.issuedOn));
  const live = mine.filter((row) => !row.revokedOn).sort(byNewest);
  return live[0] || mine.slice().sort(byNewest)[0];
}

/**
 * Is this certificate superseded by a later one for the same course?
 *
 * Computed rather than stored, for the same reason the work pillar computes
 * `effective` rather than storing it: a flag written at mint time would be a second
 * source of truth about which row counts.
 */
function isSuperseded(certification, certifications) {
  if (!certification) return false;
  const current = currentCertification(certifications, certification.staffId, certification.courseId);
  return current != null && Number(current.id) !== Number(certification.id);
}

/** Courses a role must hold. `mandatoryForRoles` is stored lower_snake_case (§6.4). */
function coursesMandatoryForRole(courses, role) {
  if (!role) return [];
  const normalised = String(role).toLowerCase();
  return (courses || []).filter((course) =>
    (course.mandatoryForRoles || []).map((value) => String(value).toLowerCase()).includes(normalised),
  );
}

/**
 * Why a member falls short on a mandatory course.
 *
 * `expiring_soon` is deliberately NOT a gap: the certificate is still good, and
 * calling it a gap would make the compliance list cry wolf every two months and be
 * ignored by the time something real appeared on it. `expiringCertifications` is
 * the forward-looking view.
 *
 * @returns {"MISSING"|"EXPIRED"|"REVOKED"|null} null when there is no gap
 */
function gapReason(status) {
  if (status === null || status === undefined) return "MISSING";
  if (status === "expired") return "EXPIRED";
  if (status === "revoked") return "REVOKED";
  return null;
}

/**
 * Every mandatory course a member does not currently hold.
 *
 * @param {object} options
 * @param {object} options.member - { staffId, staff, profile }
 * @param {Array} options.courses
 * @param {Array} options.certifications
 * @param {string} options.today
 */
function gapsForMember({ member, courses, certifications, today, expiringSoonDays }) {
  // No profile ⇒ no role ⇒ nothing is mandatory. A member awaiting their contract
  // is not out of compliance; they are not yet doing the job.
  const role = member.profile?.role;
  if (!role) return [];

  const gaps = [];
  for (const course of coursesMandatoryForRole(courses, role)) {
    const certification = currentCertification(certifications, member.staffId, course.id);
    const status = certificationStatus(certification, today, { expiringSoonDays });
    const reason = gapReason(status);
    if (reason) gaps.push({ staffId: member.staffId, member, course, certification, status, reason });
  }
  return gaps;
}

/**
 * The crew × course grid (§8.4).
 *
 * One cell per member per course, always present even when there is nothing in it,
 * because a grid with holes punched out of it is not a grid — the whole value of the
 * matrix is that a blank cell in a mandatory column is visible at a glance.
 */
function buildMatrix({ members, courses, certifications, enrollments, today, expiringSoonDays }) {
  const sortedCourses = (courses || []).slice().sort((a, b) => a.code.localeCompare(b.code));

  const rows = (members || []).map((member) => {
    const role = member.profile?.role || null;
    const mandatoryIds = new Set(coursesMandatoryForRole(sortedCourses, role).map((course) => Number(course.id)));

    const cells = sortedCourses.map((course) => {
      const certification = currentCertification(certifications, member.staffId, course.id);
      const status = certificationStatus(certification, today, { expiringSoonDays });
      // The latest enrollment tells the difference between "not certified" and
      // "not certified but booked on a course next month", which is exactly the
      // distinction a manager looking at an amber cell wants.
      const latestEnrollment = latestEnrollmentFor(enrollments, member.staffId, course.id);
      return {
        courseId: course.id,
        course,
        certification,
        status,
        mandatory: mandatoryIds.has(Number(course.id)),
        enrollment: latestEnrollment,
        compliant: !mandatoryIds.has(Number(course.id)) || permitsWork(status),
      };
    });

    return { staffId: member.staffId, member, role, cells };
  });

  return { courses: sortedCourses, rows };
}

/** The most recent enrollment a member has on a course, by id. */
function latestEnrollmentFor(enrollments, staffId, courseId) {
  const mine = (enrollments || []).filter((row) => Number(row.staffId) === Number(staffId) && Number(row.courseId) === Number(courseId));
  return mine.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
}

module.exports = {
  CERTIFICATION_STATUSES,
  ENROLLMENT_STATUSES,
  EXPIRING_SOON_DAYS,
  PERMITTING_STATUSES,
  addMonthsClamped,
  addDaysTo,
  expiryDateFor,
  certificationStatus,
  daysUntilExpiry,
  permitsWork,
  currentCertification,
  isSuperseded,
  coursesMandatoryForRole,
  gapReason,
  gapsForMember,
  buildMatrix,
  latestEnrollmentFor,
};
