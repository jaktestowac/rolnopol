/**
 * The injectable clock (PRD §4.2).
 *
 * Domain logic in this module never calls `Date.now()` or `new Date()` directly.
 * Everything time-dependent — tenure, employment status, certification expiry,
 * leave accrual — takes a clock, so a test can stand on 29 February or one second
 * before a certificate lapses without touching the system clock.
 *
 * The rule is worth stating as a rule because the failure it prevents is
 * invisible: a boundary bug that only appears on the last day of a month is a bug
 * you cannot reproduce on demand unless the clock is a parameter.
 */

/**
 * @param {object} [options]
 * @param {Date|string|number} [options.now] - fixed instant; omit for the real clock
 */
function createClock({ now } = {}) {
  const fixed = now === undefined ? null : new Date(now);
  if (fixed && Number.isNaN(fixed.getTime())) {
    throw new Error(`createClock: invalid "now" value ${JSON.stringify(now)}`);
  }

  return {
    /** @returns {Date} */
    now() {
      return fixed ? new Date(fixed.getTime()) : new Date();
    },
    /** ISO-8601 UTC instant — the store format for timestamps. */
    nowIso() {
      return this.now().toISOString();
    },
    /** YYYY-MM-DD in UTC — the store format for dates. */
    today() {
      return toDateString(this.now());
    },
    get isFixed() {
      return fixed !== null;
    },
  };
}

/** UTC calendar date of an instant, as YYYY-MM-DD. */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD as a UTC midnight instant. Returns null for anything else. */
function fromDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days between two YYYY-MM-DD dates.
 *
 * Deliberately computed from UTC midnights rather than by subtracting instants:
 * a DST transition changes the number of hours in a local day but never the
 * number of days on the calendar, and it is the calendar that employment and
 * expiry rules talk about.
 */
function daysBetween(fromDate, toDate) {
  const from = fromDateString(fromDate);
  const to = fromDateString(toDate);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Add whole days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
function addDays(dateString, days) {
  const date = fromDateString(dateString);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

module.exports = { createClock, toDateString, fromDateString, daysBetween, addDays };
