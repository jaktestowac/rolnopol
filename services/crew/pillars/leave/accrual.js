/**
 * Leave arithmetic — the pure core of the leave pillar (PRD §8.3, §14.1).
 *
 * Everything here is a function of its arguments: no store, no context, no clock
 * of its own. That is deliberate, and it is what makes the pillar's most
 * dangerous code cheap to pin. Accrual bugs live on boundaries — the last day of
 * a 28-day month, 29 February, the midnight a carry-over grant expires — and a
 * boundary you cannot stand on is a boundary you cannot test.
 *
 * Six decisions live in this file. Each is a bug someone would otherwise find in
 * a payslip:
 *
 *   1. **Balance is computed, never stored** (§6.3). `computeBalance` is the only
 *      thing that says what someone has left, and it takes the whole request and
 *      adjustment history as input. A stored total would drift the first time a
 *      request was cancelled.
 *
 *   2. **`remaining` is DEFINED as `accrued + carriedOver − taken − booked`.**
 *      Not computed some other way and then checked against it — defined as it.
 *      The invariant in §8.3 is therefore true by construction, and the property
 *      test exists to stop a future "optimisation" from making it false.
 *
 *   3. **A monthly instalment accrues daily across its month.** The alternative,
 *      crediting a whole twelfth the moment a month ends, makes `accrued` jump and
 *      makes a mid-month joiner's first month either free or worthless. Daily
 *      pro-rata inside the month also means 28-, 29-, 30- and 31-day months need no
 *      special case: the denominator is the month's own length.
 *
 *   4. **Accrual stops at `endDate` and starts at `startDate`**, both inclusive, so
 *      a leaver accrues for the days they actually worked and no more.
 *
 *   5. **Carry-over is use-it-or-lose-it, and the loss is visible.** Before the
 *      expiry date the whole grant counts; after it, only the part actually spent
 *      on or before that date. So the balance shrinks at midnight rather than
 *      quietly financing leave taken in June with days that died in March.
 *
 *   6. **Intervals are inclusive on both ends**, because that is how people talk
 *      about holidays ("I'm off Monday to Friday" is five days, not four). The
 *      half-open convention in `work-time.js` is right for clock times and wrong
 *      for calendar days; mixing them up is the classic off-by-one.
 */
const { fromDateString, toDateString, daysBetween, addDays } = require("../../clock");

const MONTHS_PER_LEAVE_YEAR = 12;
const MONTH_DAY_PATTERN = /^(\d{2})-(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The five reasons someone is away. `annual` is the only one with a budget. */
const LEAVE_TYPES = ["annual", "sick", "unpaid", "parental", "bereavement"];

/** `requested → approved | rejected | cancelled | withdrawn` (§6.3). */
const LEAVE_STATUSES = ["requested", "approved", "rejected", "cancelled", "withdrawn"];

/**
 * Which statuses still hold a slot in the calendar.
 *
 * A pending request counts: two requests for the same week must clash, and a
 * balance that ignored pending days would let someone book the same days twice
 * while waiting for a decision.
 */
const LIVE_STATUSES = ["requested", "approved"];

/**
 * Per-type rules, as data rather than as a chain of ifs — so the awkward answers
 * are a lookup a reader can check, not a condition buried in a function.
 *
 * `sick` is the interesting row, and it answers §17 Q4 explicitly: sickness does
 * not touch the annual budget and is subject to no notice rule. The second half
 * is what permits **retrospective entry** — the notice check is the only thing
 * standing between a request and a start date in the past, so a type that skips
 * it can record yesterday's absence. A fever does not give three days' warning,
 * and a system that refuses to record yesterday simply never records it.
 *
 * `bereavement` skips notice for the same reason. `unpaid` and `parental` are
 * planned in advance, so they keep it.
 */
const TYPE_RULES = {
  annual: { consumesBalance: true, requiresNotice: true, honoursBlackout: true },
  sick: { consumesBalance: false, requiresNotice: false, honoursBlackout: false },
  unpaid: { consumesBalance: false, requiresNotice: true, honoursBlackout: true },
  parental: { consumesBalance: false, requiresNotice: true, honoursBlackout: false },
  bereavement: { consumesBalance: false, requiresNotice: false, honoursBlackout: false },
};

/** Saturday and Sunday. A farm works them, but leave is counted in office days. */
const WEEKEND_DAYS = [0, 6];

/**
 * Round to the nearest half day.
 *
 * Half days are the domain's unit — the `Days` scalar refuses anything else — so
 * every number that leaves this file passes through here. Nearest rather than
 * down: rounding down silently shortchanges every part-time contract, and doing
 * it per-month rather than per-total would compound the error twelve times, which
 * is why callers round once at the end.
 */
function roundDays(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 2) / 2;
}

/**
 * Parse an `MM-DD` policy anchor.
 *
 * Two rejections worth stating. A day above 28 is refused for `leaveYearStart`
 * (see `leaveYearBounds`) via `maxDay`, and `02-29` is refused everywhere: a leave
 * year or an expiry date that does not exist in three years out of four is not a
 * policy, it is a bug waiting for a non-leap year.
 */
function parseMonthDay(value, { maxDay = 31 } = {}) {
  if (typeof value !== "string") return null;
  const match = MONTH_DAY_PATTERN.exec(value);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > maxDay) return null;
  // Longest this month ever gets, in any year. February is capped at 28 on
  // purpose — see the note above.
  const longest = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > longest) return null;
  return { month, day };
}

/** `{month: 3, day: 31}` + 2026 → "2026-03-31". */
function monthDayInYear(monthDay, year) {
  if (!monthDay) return null;
  return `${String(year).padStart(4, "0")}-${String(monthDay.month).padStart(2, "0")}-${String(monthDay.day).padStart(2, "0")}`;
}

/**
 * Add whole months to a date, without the end-of-month trap.
 *
 * Kept local rather than pushed into `clock.js` because it is only safe for the
 * day-of-month range this file allows (1–28). A generic `addMonths` has to decide
 * what 31 January plus one month means, and every answer to that question is
 * wrong for somebody.
 */
function addMonths(dateString, months) {
  const date = fromDateString(dateString);
  if (!date) return null;
  return toDateString(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate())));
}

/**
 * The leave year containing a date.
 *
 * `leaveYear` is the calendar year the leave year STARTS in, so a policy running
 * April to March calls the 2026-04-06 → 2027-04-05 year "2026". Naming it after
 * the start is the only choice that keeps the label stable as the year runs on.
 *
 * @param {object} policy - needs `leaveYearStart` as MM-DD
 * @param {string} date - YYYY-MM-DD
 * @returns {{leaveYear: number, from: string, to: string}|null}
 */
function leaveYearBounds(policy, date) {
  // Day 1–28 only: every one of the twelve month slices below has to exist in
  // February too, and there is no 30th of February in any year.
  const anchor = parseMonthDay(policy?.leaveYearStart, { maxDay: 28 });
  if (!anchor || typeof date !== "string" || !DATE_PATTERN.test(date)) return null;

  const calendarYear = Number(date.slice(0, 4));
  const thisYearsStart = monthDayInYear(anchor, calendarYear);
  const leaveYear = date >= thisYearsStart ? calendarYear : calendarYear - 1;

  const from = monthDayInYear(anchor, leaveYear);
  // The day BEFORE next year's anchor, so consecutive leave years abut exactly
  // and no date falls into two of them or into neither.
  const to = addDays(monthDayInYear(anchor, leaveYear + 1), -1);
  return { leaveYear, from, to };
}

/**
 * The twelve month slices of a leave year, each inclusive.
 *
 * Slices rather than calendar months, because a leave year starting on the 6th
 * accrues in 6th-to-5th instalments. For the common `01-01` policy these ARE the
 * calendar months.
 */
function monthSlices({ from }) {
  const slices = [];
  for (let index = 0; index < MONTHS_PER_LEAVE_YEAR; index += 1) {
    const sliceFrom = addMonths(from, index);
    const sliceTo = addDays(addMonths(from, index + 1), -1);
    slices.push({ from: sliceFrom, to: sliceTo });
  }
  return slices;
}

/** Inclusive day count. "2026-10-05".."2026-10-09" is five days, not four. */
function inclusiveDays(from, to) {
  const days = daysBetween(from, to);
  return days === null ? 0 : days + 1;
}

/** The later of two dates, nulls ignored. */
function laterOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** The earlier of two dates, nulls ignored. */
function earlierOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * A full leave year's entitlement for this contract.
 *
 * Pro-rata to FTE and nothing else: a mid-year joiner's ENTITLEMENT is still the
 * whole year's allowance — it is their ACCRUAL that is pro-rated by time. Mixing
 * the two is why part-year staff so often see a number they cannot explain.
 */
function entitlementFor(policy, profile) {
  const annual = Number(policy?.annualEntitlementDaysFullTime);
  const fte = Number(profile?.fte);
  if (!Number.isFinite(annual) || !Number.isFinite(fte)) return 0;
  return roundDays(Math.max(0, annual) * Math.max(0, Math.min(1, fte)));
}

/**
 * Days earned by `asOf`, from the accrual mode.
 *
 * `upfront` grants the whole allowance the moment the leave year opens (or the
 * moment the person starts, if that is later) — that is the entire point of the
 * mode, and pro-rating it would make it monthly by another name. `monthly`
 * spreads the allowance over the twelve slices, each slice earned day by day
 * across its own length.
 *
 * The result is **monotonic in `asOf`** and capped at `entitlement`. Monotonic
 * matters: the guard on a request evaluates the balance on the request's last
 * day, and an accrual that could go backwards would let a booking pass its check
 * and then fail it.
 *
 * @param {object} policy
 * @param {object} profile - needs `fte`, `startDate`, optional `endDate`
 * @param {{from: string, to: string}} year - leave-year bounds
 * @param {string} asOf
 */
function accruedTo(policy, profile, year, asOf) {
  const entitlement = entitlementFor(policy, profile);
  if (entitlement === 0 || !profile?.startDate || !year) return 0;

  // Employment window intersected with the leave year, and with "so far".
  const employedFrom = laterOf(year.from, profile.startDate);
  const employedTo = earlierOf(earlierOf(year.to, profile.endDate || null), asOf);
  if (!employedFrom || !employedTo || employedTo < employedFrom) return 0;

  if (policy.accrualMode === "upfront") {
    // Employed at all within the window ⇒ the whole allowance is available.
    return entitlement;
  }

  const perMonth = entitlement / MONTHS_PER_LEAVE_YEAR;
  let earned = 0;
  for (const slice of monthSlices(year)) {
    const overlapFrom = laterOf(slice.from, employedFrom);
    const overlapTo = earlierOf(slice.to, employedTo);
    if (!overlapFrom || !overlapTo || overlapTo < overlapFrom) continue;

    const sliceLength = inclusiveDays(slice.from, slice.to);
    const employedDays = inclusiveDays(overlapFrom, overlapTo);
    // The denominator is the slice's OWN length, which is what makes February —
    // 28 days, or 29 in a leap year — need no special case at all.
    earned += perMonth * (employedDays / sliceLength);
  }

  // Rounded ONCE, at the end. Rounding each month would compound twelve times.
  return Math.min(entitlement, roundDays(earned));
}

/** True for a Saturday or a Sunday. */
function isWeekend(dateString) {
  const date = fromDateString(dateString);
  return date === null ? false : WEEKEND_DAYS.includes(date.getUTCDay());
}

/** True when the policy lists this date as a public holiday. */
function isPublicHoliday(policy, dateString) {
  const holidays = Array.isArray(policy?.publicHolidays) ? policy.publicHolidays : [];
  return holidays.includes(dateString);
}

/** A day leave is actually deducted for: not a weekend, not a public holiday. */
function isWorkingDay(policy, dateString) {
  return !isWeekend(dateString) && !isPublicHoliday(policy, dateString);
}

/** Every date in an inclusive range. Capped so a nonsense range cannot spin. */
function datesInRange(from, to, { limit = 800 } = {}) {
  const dates = [];
  if (typeof from !== "string" || typeof to !== "string" || from > to) return dates;
  let cursor = from;
  while (cursor <= to && dates.length < limit) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
    if (cursor === null) break;
  }
  return dates;
}

/**
 * How many days a request actually costs.
 *
 * Weekends and public holidays are free — a week off over Easter is not five
 * days of holiday. Half days come off the first and last WORKING day of the
 * range, not off `from` and `to`: a Friday-to-Monday request with a half-day
 * start takes the half off Friday, and one starting on a Saturday takes it off
 * the following Monday, because a half-day on a day you were not working is not
 * a thing.
 *
 * The one case with a special rule: a single-day request carrying BOTH half-day
 * flags is half a day, never zero. Someone ticking both boxes on a one-day form
 * means "half a day off", and returning 0 would book a holiday that costs
 * nothing and shows as nothing.
 *
 * @returns {{workingDays: number, days: string[]}} `days` are the chargeable dates
 */
function workingDaysFor(policy, { from, to, halfDayStart, halfDayEnd }) {
  const chargeable = datesInRange(from, to).filter((date) => isWorkingDay(policy, date));
  if (chargeable.length === 0) return { workingDays: 0, days: [] };

  let total = chargeable.length;
  if (chargeable.length === 1) {
    // One working day: any half-day flag makes it a half day. Both flags do not
    // make it zero.
    if (halfDayStart || halfDayEnd) total -= 0.5;
  } else {
    if (halfDayStart) total -= 0.5;
    if (halfDayEnd) total -= 0.5;
  }

  return { workingDays: roundDays(Math.max(0, total)), days: chargeable };
}

/**
 * The blackout window a request runs into, if any.
 *
 * Compared against CHARGEABLE days only, so a harvest blackout does not refuse a
 * request whose only overlap with it is a Sunday.
 */
function blackoutHit(policy, chargeableDays) {
  const windows = Array.isArray(policy?.blackoutWindows) ? policy.blackoutWindows : [];
  for (const window of windows) {
    if (typeof window?.from !== "string" || typeof window?.to !== "string") continue;
    const clash = chargeableDays.find((date) => date >= window.from && date <= window.to);
    if (clash) return { window, date: clash };
  }
  return null;
}

/** Do two inclusive date ranges touch at all? */
function rangesOverlap(a, b) {
  return a.from <= b.to && b.from <= a.to;
}

/** The date this leave year's carried-over days die on, or null when unset. */
function carryOverExpiryDate(policy, leaveYear) {
  const anchor = parseMonthDay(policy?.carryOverExpiresOn);
  if (!anchor) return null;

  const bounds = leaveYearBounds(policy, monthDayInYear(anchor, leaveYear));
  // The expiry anchor is an MM-DD, so it has to be placed in whichever calendar
  // year puts it INSIDE this leave year. For the ordinary 01-01 leave year that
  // is the leave year itself; for an April-to-March year, a 03-31 expiry lands in
  // the following calendar year.
  if (bounds && bounds.leaveYear === leaveYear) return monthDayInYear(anchor, leaveYear);
  return monthDayInYear(anchor, leaveYear + 1);
}

/** Requests that belong to a leave year, judged by the day the leave starts. */
function requestsInLeaveYear(requests, year) {
  return requests.filter((request) => request.from >= year.from && request.from <= year.to);
}

/**
 * The balance, computed from the whole history (§6.3, §8.3).
 *
 * Read the four counters as answers to four different questions:
 *
 *   - `entitlement` — what a full leave year at this contract is worth;
 *   - `accrued`     — what has been earned by `asOf`, plus any manual adjustment;
 *   - `taken`       — annual leave that is over and done with;
 *   - `booked`      — annual leave that is agreed or awaiting a decision but has
 *                     not finished yet.
 *
 * A request is counted where it ENDS, so a holiday in progress reads as `booked`
 * until its last day has passed. Splitting a straddling request across the two
 * counters would be more precise and much harder to reconcile against a payslip.
 *
 * `remaining` is then the definition in decision 2 above and nothing else.
 *
 * @param {object} options
 * @param {object} options.policy
 * @param {object|null} options.profile - null ⇒ no contract, so no entitlement
 * @param {Array} options.requests - this member's requests (any leave year)
 * @param {Array} options.adjustments - this member's adjustments (any leave year)
 * @param {string} options.asOf
 */
function computeBalance({ policy, profile, requests = [], adjustments = [], asOf }) {
  const year = leaveYearBounds(policy, asOf);
  if (!year) return null;

  const entitlement = entitlementFor(policy, profile);
  const mine = requestsInLeaveYear(requests, year).filter((request) => LIVE_STATUSES.includes(request.status));

  const consuming = mine.filter((request) => TYPE_RULES[request.type]?.consumesBalance);
  const sumDays = (rows) => roundDays(rows.reduce((total, row) => total + (Number(row.workingDays) || 0), 0));

  const taken = sumDays(consuming.filter((request) => request.status === "approved" && request.to <= asOf));
  const booked = sumDays(consuming.filter((request) => !(request.status === "approved" && request.to <= asOf)));

  const yearAdjustments = adjustments.filter((row) => Number(row.leaveYear) === year.leaveYear);
  const manual = roundDays(
    yearAdjustments.filter((row) => row.kind !== "carry_over_grant").reduce((total, row) => total + (Number(row.days) || 0), 0),
  );

  // Carry-over, and its expiry. The cap is applied to the TOTAL of the grants, so
  // two grants cannot add up past the policy's limit.
  const cap = Number(policy?.carryOverCapDays);
  const granted = roundDays(
    yearAdjustments.filter((row) => row.kind === "carry_over_grant").reduce((total, row) => total + (Number(row.days) || 0), 0),
  );
  const carriedOverGranted = Number.isFinite(cap) ? Math.min(granted, Math.max(0, cap)) : granted;

  const expiresOn = carryOverExpiryDate(policy, year.leaveYear);
  // Carry-over is spent FIRST, because it is the money that expires. So the part
  // of it that survives the deadline is exactly the part already spent by then.
  const spentByExpiry = expiresOn ? sumDays(consuming.filter((request) => request.to <= expiresOn)) : 0;
  const usedFromCarryOver = Math.min(carriedOverGranted, spentByExpiry);
  const expired = expiresOn !== null && asOf > expiresOn;

  const carriedOver = expired ? usedFromCarryOver : carriedOverGranted;
  const expiringSoon = expired ? 0 : roundDays(carriedOverGranted - usedFromCarryOver);

  const accrued = roundDays(accruedTo(policy, profile, year, asOf) + manual);

  const byType = LEAVE_TYPES.map((type) => ({
    type,
    taken: sumDays(mine.filter((request) => request.type === type && request.status === "approved" && request.to <= asOf)),
    booked: sumDays(mine.filter((request) => request.type === type && !(request.status === "approved" && request.to <= asOf))),
  }));

  return {
    leaveYear: year.leaveYear,
    from: year.from,
    to: year.to,
    entitlement,
    accrued,
    carriedOver,
    taken,
    booked,
    expiringSoon,
    carryOverExpiresOn: expiresOn,
    // Decision 2: the definition, not a second calculation.
    remaining: roundDays(accrued + carriedOver - taken - booked),
    byType,
  };
}

module.exports = {
  MONTHS_PER_LEAVE_YEAR,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  LIVE_STATUSES,
  TYPE_RULES,
  WEEKEND_DAYS,
  roundDays,
  parseMonthDay,
  monthDayInYear,
  addMonths,
  leaveYearBounds,
  monthSlices,
  inclusiveDays,
  entitlementFor,
  accruedTo,
  isWeekend,
  isPublicHoliday,
  isWorkingDay,
  datesInRange,
  workingDaysFor,
  blackoutHit,
  rangesOverlap,
  carryOverExpiryDate,
  requestsInLeaveYear,
  computeBalance,
};
