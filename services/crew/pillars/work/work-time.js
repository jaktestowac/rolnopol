/**
 * Shift time arithmetic — the pure core of the work pillar (PRD §8.2).
 *
 * Kept free of stores and context so every boundary is testable as a function
 * call. Three decisions live here, and each of them is a bug someone would
 * otherwise find in production:
 *
 *   1. **Intervals are half-open, `[start, end)`.** A shift that ends at 08:00 and
 *      one that starts at 08:00 do NOT overlap — they are a handover. Treating the
 *      boundary as a clash would refuse the most ordinary roster there is.
 *   2. **A shift whose end time is at or before its start time crosses midnight.**
 *      `night_watch 22:00 → 06:00` is a real duty, not a typo, so it resolves to
 *      22:00 today until 06:00 tomorrow. Without this, night watch would either be
 *      rejected as invalid or silently collapse to a negative-length shift that
 *      overlaps nothing.
 *   3. **Everything is minutes since a UTC epoch date**, so comparisons never touch
 *      local time and a DST transition cannot change whether two shifts clash.
 */
const { fromDateString, toDateString } = require("../../clock");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

/** "05:30" → 330. Returns null for anything that is not a 24-hour HH:MM. */
function parseTime(value) {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 330 → "05:30". Minutes beyond a day wrap, so an end time can be printed too. */
function formatTime(minutes) {
  const normalised = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalised / 60);
  const mins = normalised % 60;
  return String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
}

/** Whole minutes from the UTC epoch for a YYYY-MM-DD date. Null if unparseable. */
function dateToMinutes(dateString) {
  const date = fromDateString(dateString);
  return date === null ? null : Math.round(date.getTime() / 60000);
}

/**
 * Resolve a shift to an absolute half-open minute interval.
 *
 * @param {string} date - YYYY-MM-DD, the day the shift STARTS
 * @param {string} startTime - HH:MM
 * @param {string} endTime - HH:MM; at or before startTime ⇒ crosses midnight
 * @returns {{start: number, end: number, crossesMidnight: boolean}|null}
 */
function shiftInterval(date, startTime, endTime) {
  const dayStart = dateToMinutes(date);
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (dayStart === null || start === null || end === null) return null;

  // `end <= start` is the midnight-crossing case, INCLUDING equality: a duty from
  // 06:00 to 06:00 is a full 24 hours, not a zero-length shift. A zero-length
  // shift would overlap nothing and log no hours, which is never what anyone meant.
  const crossesMidnight = end <= start;
  return {
    start: dayStart + start,
    end: dayStart + end + (crossesMidnight ? MINUTES_PER_DAY : 0),
    crossesMidnight,
  };
}

/**
 * Do two half-open intervals intersect?
 *
 * The `<` on both sides is the whole point — see decision 1 above.
 */
function intervalsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

/** Length of a shift in hours, to two decimals. */
function shiftHours(interval) {
  if (!interval) return 0;
  return Math.round(((interval.end - interval.start) / 60) * 100) / 100;
}

/**
 * The Monday-based week containing a date.
 *
 * Monday because a farm week is talked about as "week beginning Monday", and
 * because JavaScript's Sunday-is-0 would otherwise put Sunday's work in the wrong
 * week — an off-by-one that only shows up in the weekend column.
 *
 * @returns {{from: string, to: string}|null} inclusive Monday, inclusive Sunday
 */
function weekBounds(dateString) {
  const date = fromDateString(dateString);
  if (date === null) return null;
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(date.getTime());
  monday.setUTCDate(monday.getUTCDate() + offsetToMonday);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  return { from: toDateString(monday), to: toDateString(sunday) };
}

/** The calendar month containing a date, as an inclusive range. */
function monthBounds(dateString) {
  const date = fromDateString(dateString);
  if (date === null) return null;
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { from: toDateString(first), to: toDateString(last) };
}

/** Inclusive-range membership for YYYY-MM-DD strings. Lexicographic is enough. */
function withinRange(dateString, from, to) {
  if (typeof dateString !== "string") return false;
  if (from && dateString < from) return false;
  if (to && dateString > to) return false;
  return true;
}

module.exports = {
  MINUTES_PER_DAY,
  parseTime,
  formatTime,
  dateToMinutes,
  shiftInterval,
  intervalsOverlap,
  shiftHours,
  weekBounds,
  monthBounds,
  withinRange,
};
