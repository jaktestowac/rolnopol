/**
 * Date helpers for FarmStay. All ranges are half-open [from, to): a booking's
 * checkout day equals the next guest's check-in day and the two do NOT overlap.
 * Dates are plain "YYYY-MM-DD" strings — no timezone math in v1.
 *
 * Owned by the ecosystem — no dependency on Rolnopol.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate a [from, to) range: both valid dates and from strictly before to. */
function isValidRange(from, to) {
  return isValidDate(from) && isValidDate(to) && from < to;
}

/** Do half-open ranges [aFrom, aTo) and [bFrom, bTo) overlap? */
function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

/** Number of nights in [from, to). */
function nightsBetween(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Enumerate the check-in dates (each night) of [from, to) as YYYY-MM-DD. */
function eachNight(from, to) {
  const out = [];
  let t = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (t < end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

/** Day-of-week for a YYYY-MM-DD (0=Sun..6=Sat), UTC. */
function dayOfWeek(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

module.exports = { isValidDate, isValidRange, rangesOverlap, nightsBetween, eachNight, dayOfWeek };
