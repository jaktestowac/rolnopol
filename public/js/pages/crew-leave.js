/**
 * Crew Office — holidays page controller (PRD §10.1, §10.3).
 *
 * Three views of one query: the pending-approval queue, the team calendar, and the
 * per-person balance breakdown. Fetching them together is the point — they are three
 * readings of the same data, and three requests would be three chances to draw a page
 * whose halves disagree about who is off.
 *
 * Four decisions worth knowing about:
 *
 *   1. **Every mutation sends the version its row was drawn from.** Two people
 *      working the approval queue at the same moment get a `VersionConflict` and a
 *      reload prompt, rather than one of them silently overwriting the other.
 *
 *   2. **A warning is reported as a SUCCESS.** `LeaveBookedWithWarning` books the
 *      leave (§8.3); the toast says "requested" first and the advice second. Leading
 *      with the warning would read as a refusal, which is precisely the bug the PRD
 *      calls out.
 *
 *   3. **A refusal is not an error.** Insufficient balance, an overlap, a blackout
 *      and short notice all arrive as HTTP 200 with a union member. They are answers,
 *      so they are shown on the form's own error line, not as a page-level failure.
 *
 *   4. **The page degrades rather than emptying.** No leave pillar assembled, or no
 *      policy configured, produces an explanation. An empty calendar would claim
 *      nobody is on holiday, which is a different and possibly false statement.
 *
 * Wrapped UMD-style so the pure helpers can be required by a Node test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewHolidaysPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const PILLAR = "leave";
  const elements = {};

  /** The last board as loaded, so a mutation can find the version it must send. */
  let board = null;

  function cacheElements() {
    elements.status = document.getElementById("leaveStatus");
    elements.summary = document.getElementById("leaveSummary");
    elements.policy = document.getElementById("leavePolicyPanel");
    elements.approvals = document.getElementById("leaveApprovals");
    elements.calendar = document.getElementById("leaveCalendar");
    elements.balances = document.getElementById("leaveBalances");

    elements.from = document.getElementById("leaveFrom");
    elements.to = document.getElementById("leaveTo");
    elements.prev = document.getElementById("leavePrev");
    elements.prevLabel = document.getElementById("leavePrevLabel");
    elements.thisMonth = document.getElementById("leaveThisMonth");
    elements.next = document.getElementById("leaveNext");
    elements.nextLabel = document.getElementById("leaveNextLabel");
    elements.quarter = document.getElementById("leaveQuarter");
    elements.year = document.getElementById("leaveYear");
    elements.reload = document.getElementById("leaveReload");
    elements.exportCsv = document.getElementById("leaveExportCsv");
    elements.exportPdf = document.getElementById("leaveExportPdf");

    elements.requestToggle = document.getElementById("leaveRequestToggle");
    elements.requestPanel = document.getElementById("leaveRequestPanel");
    elements.requestForm = document.getElementById("leaveRequestForm");
    elements.requestCancel = document.getElementById("leaveRequestCancel");
    elements.requestErrors = document.getElementById("leaveRequestErrors");
    elements.reqMember = document.getElementById("leaveReqMember");
    elements.reqType = document.getElementById("leaveReqType");
    elements.reqFrom = document.getElementById("leaveReqFrom");
    elements.reqTo = document.getElementById("leaveReqTo");
    elements.reqHalfStart = document.getElementById("leaveReqHalfStart");
    elements.reqHalfEnd = document.getElementById("leaveReqHalfEnd");
    elements.reqReason = document.getElementById("leaveReqReason");

    elements.policyToggle = document.getElementById("leavePolicyToggle");
    elements.policyPanel = document.getElementById("leavePolicyForm");
    elements.policyForm = document.getElementById("leavePolicyFormEl");
    elements.policyCancel = document.getElementById("leavePolicyCancel");
    elements.policyErrors = document.getElementById("leavePolicyErrors");
    elements.policyAccrualMode = document.getElementById("policyAccrualMode");
  }

  /** Form field name → input id, for the shared field-error renderer. */
  const REQUEST_FIELD_IDS = {
    staffId: "leaveReqMember",
    type: "leaveReqType",
    from: "leaveReqFrom",
    to: "leaveReqTo",
    reason: "leaveReqReason",
  };

  /**
   * Policy field name → input id.
   *
   * The keys are the SERVER's field names, so `fieldErrors` from `setLeavePolicy`
   * mark the right input without a second mapping to keep in step.
   */
  const POLICY_FIELD_IDS = {
    annualEntitlementDaysFullTime: "policyEntitlement",
    accrualMode: "policyAccrualMode",
    leaveYearStart: "policyLeaveYearStart",
    carryOverCapDays: "policyCarryOverCap",
    carryOverExpiresOn: "policyCarryOverExpires",
    minNoticeDays: "policyMinNotice",
    publicHolidays: "policyPublicHolidays",
    blackoutWindows: "policyBlackouts",
  };

  /** What the server falls back to, mirrored so a first-time form is not blank. */
  const POLICY_DEFAULTS = {
    annualEntitlementDaysFullTime: 26,
    accrualMode: "MONTHLY",
    carryOverCapDays: 5,
    carryOverExpiresOn: "03-31",
    leaveYearStart: "01-01",
    minNoticeDays: 3,
    publicHolidays: [],
    blackoutWindows: [],
  };

  const ACCRUAL_MODE_LABELS = {
    MONTHLY: "Monthly — a twelfth per month, earned day by day",
    UPFRONT: "Upfront — the whole allowance when the leave year opens",
  };

  const MONTH_DAY_PATTERN = /^\d{2}-\d{2}$/;
  const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  // --- policy parsing (pure) ------------------------------------------------

  /**
   * A textarea of dates → a sorted, de-duplicated array.
   *
   * Tolerates newlines, commas and semicolons because people paste holiday lists from
   * anywhere. Returns the bad entries separately rather than dropping them: silently
   * ignoring a typo'd date would mean somebody's holiday is charged as a working day
   * and nobody is told why.
   *
   * @returns {{dates: string[], invalid: string[]}}
   */
  function parseDateList(text) {
    const parts = String(text || "")
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const dates = [];
    const invalid = [];
    for (const part of parts) {
      // A round trip is what rejects 30 February, which the pattern happily allows.
      const real = ISO_DATE_PATTERN.test(part) && new Date(part + "T00:00:00.000Z").toISOString().slice(0, 10) === part;
      if (real) {
        if (dates.indexOf(part) === -1) dates.push(part);
      } else {
        invalid.push(part);
      }
    }
    return { dates: dates.sort(), invalid };
  }

  /**
   * A textarea of `from,to,reason` lines → blackout windows.
   *
   * The reason may itself contain commas, so only the first two fields are taken as
   * dates and everything after is the reason. A line with a backwards range is
   * reported rather than saved — the server would refuse it anyway, and refusing here
   * names the line.
   *
   * @returns {{windows: Array<{from, to, reason}>, invalid: string[]}}
   */
  function parseBlackoutWindows(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const windows = [];
    const invalid = [];
    for (const line of lines) {
      const parts = line.split(",").map((part) => part.trim());
      const [from, to] = parts;
      const reason = parts.slice(2).join(", ").trim();

      if (!ISO_DATE_PATTERN.test(from || "") || !ISO_DATE_PATTERN.test(to || "") || from > to) {
        invalid.push(line);
        continue;
      }
      windows.push({ from, to, reason: reason || null });
    }
    return { windows, invalid };
  }

  /** Blackout windows → the textarea text they came from, for a round trip. */
  function formatBlackoutWindows(windows) {
    return (windows || []).map((window) => [window.from, window.to, window.reason].filter(Boolean).join(",")).join("\n");
  }

  /**
   * The values a policy form should open with.
   *
   * A missing policy yields the server's own defaults rather than an empty form: the
   * point of this panel is to get somebody from "no policy" to "a working policy" in
   * one save, and a blank form makes them invent eight numbers.
   */
  function policyFormValues(policy) {
    const source = policy || POLICY_DEFAULTS;
    return {
      annualEntitlementDaysFullTime: source.annualEntitlementDaysFullTime,
      accrualMode: source.accrualMode || POLICY_DEFAULTS.accrualMode,
      carryOverCapDays: source.carryOverCapDays,
      carryOverExpiresOn: source.carryOverExpiresOn || "",
      leaveYearStart: source.leaveYearStart || POLICY_DEFAULTS.leaveYearStart,
      minNoticeDays: source.minNoticeDays,
      publicHolidays: (source.publicHolidays || []).join("\n"),
      blackoutWindows: formatBlackoutWindows(source.blackoutWindows),
      // Absent for a first save, so the server creates rather than version-checking.
      expectedVersion: policy ? policy.version : null,
    };
  }

  // --- date range -----------------------------------------------------------

  /** First and last day of the month containing `date`, as YYYY-MM-DD. */
  function monthRange(dateString, monthsAhead) {
    const date = new Date(dateString + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + (monthsAhead || 0);
    const first = new Date(Date.UTC(year, month, 1));
    // Day 0 of the next month is the last day of this one — the calendar's own answer
    // to how long February is this year.
    const last = new Date(Date.UTC(year, month + 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }

  /** How many calendar months a range touches. A single day spans one. */
  function monthsSpan(range) {
    if (!range || !range.from || !range.to) return 1;
    const from = { year: Number(range.from.slice(0, 4)), month: Number(range.from.slice(5, 7)) };
    const to = { year: Number(range.to.slice(0, 4)), month: Number(range.to.slice(5, 7)) };
    return Math.max(1, (to.year - from.year) * 12 + (to.month - from.month) + 1);
  }

  /**
   * Move a range by whole months, keeping however many months it covers.
   *
   * Paging a quarter stays a quarter. It also SNAPS to month boundaries, which is a
   * deliberate trade: a custom 10th–20th range becomes the whole month once you press
   * next, because pressing a month arrow means you have started browsing by month and
   * a range that drifted by 30 days at a time would never line up with a grid again.
   */
  function shiftMonths(range, delta) {
    const span = monthsSpan(range);
    const year = Number(range.from.slice(0, 4));
    const month = Number(range.from.slice(5, 7));

    const first = new Date(Date.UTC(year, month - 1 + delta, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + span, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }

  /**
   * `count` whole months, starting at the month containing `dateString`.
   *
   * The server caps a calendar range at 400 days, so a whole year (12) is the largest
   * useful count — asking for more would be refused with a validation error.
   */
  function monthsFrom(dateString, count) {
    // A LENGTH check is not enough: "nonsense" is eight characters, so it used to get
    // through and then throw on `toISOString`. The shape is what matters.
    if (typeof dateString !== "string" || !/^\d{4}-\d{2}/.test(dateString)) return null;
    const year = Number(dateString.slice(0, 4));
    const month = Number(dateString.slice(5, 7));
    if (month < 1 || month > 12) return null;
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month - 1 + Math.max(1, count), 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }

  function currentRange() {
    const CrewApi = window.CrewApi;
    const from = elements.from && elements.from.value;
    const to = elements.to && elements.to.value;
    if (from && to && from <= to) return { from: from, to: to };
    // Anything unusable falls back to this month rather than sending a broken range
    // and rendering the server's validation error as if the page were broken.
    return monthRange(CrewApi.todayIso(), 0);
  }

  function setRange(range) {
    if (!range) return;
    if (elements.from) elements.from.value = range.from;
    if (elements.to) elements.to.value = range.to;
    labelNavButtons(range);
  }

  /**
   * Name the month each arrow leads to.
   *
   * "Previous"/"Next" is enough to be clickable, but a calendar people are browsing
   * should say where a click goes — otherwise finding last March means pressing back
   * and re-reading the grid each time. Falls back to the plain word if the range is
   * unusable, so the button is never left blank.
   */
  function labelNavButtons(range) {
    const label = (target, delta, fallback) => {
      if (!target) return;
      const shifted = range && range.from ? shiftMonths(range, delta) : null;
      if (!shifted) {
        target.textContent = fallback;
        return;
      }
      const month = Number(shifted.from.slice(5, 7));
      const year = shifted.from.slice(0, 4);
      // Short month name plus the year only when it differs, so paging inside one
      // year stays terse and crossing a boundary is obvious.
      const sameYear = range.from.slice(0, 4) === year;
      target.textContent = MONTH_LABELS[month - 1].slice(0, 3) + (sameYear ? "" : " " + year);
    };

    label(elements.prevLabel, -1, "Previous");
    label(elements.nextLabel, 1, "Next");
  }

  // --- rendering ------------------------------------------------------------

  function renderPolicy(policy) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    if (!policy) {
      // A balance cannot be computed without a policy (§7.3), so say that rather
      // than showing zeroes — "not configured" and "no days left" are different
      // statements and only one of them is true.
      //
      // And offer the fix HERE. An earlier version pointed at the GraphQL explorer
      // and a mutation name, which is a true sentence and a useless one: it tells
      // somebody running a farm to go and write a query.
      elements.policy.innerHTML =
        '<p class="crew-notice crew-notice--warning"><i class="fa-solid fa-triangle-exclamation"></i> ' +
        "No leave policy is configured yet, so balances cannot be computed. " +
        "A policy applies to your whole crew — entitlement, accrual, carry-over and the farm's holidays." +
        '</p><p class="crew-form-actions crew-no-print">' +
        '<button id="leavePolicySetup" class="crew-btn crew-btn--primary" type="button">' +
        '<i class="fa-solid fa-sliders"></i> Set up the leave policy</button></p>';

      const setup = document.getElementById("leavePolicySetup");
      if (setup) setup.addEventListener("click", () => togglePolicyPanel(true));
      return;
    }

    const blackouts =
      (policy.blackoutWindows || []).length === 0
        ? '<span class="crew-muted">none</span>'
        : policy.blackoutWindows
            .map((window) => escape(window.from) + " – " + escape(window.to) + (window.reason ? " (" + escape(window.reason) + ")" : ""))
            .join(" · ");

    elements.policy.innerHTML =
      '<dl class="crew-fields">' +
      fieldHtml("Entitlement", escape(policy.annualEntitlementDaysFullTime) + " days at full time") +
      fieldHtml("Accrual", escape(String(policy.accrualMode || "").toLowerCase())) +
      fieldHtml("Leave year starts", escape(policy.leaveYearStart)) +
      fieldHtml(
        "Carry-over",
        escape(policy.carryOverCapDays) + " days" + (policy.carryOverExpiresOn ? ", expiring " + escape(policy.carryOverExpiresOn) : ""),
      ) +
      fieldHtml("Minimum notice", escape(policy.minNoticeDays) + " days") +
      fieldHtml("Blackout periods", blackouts) +
      fieldHtml("Public holidays", escape((policy.publicHolidays || []).length) + " recorded") +
      "</dl>";
  }

  function fieldHtml(label, value) {
    const escape = window.CrewApi.escapeHtml;
    return (
      '<div class="crew-field"><dt>' +
      escape(label) +
      "</dt><dd>" +
      (value === null || value === undefined || value === "" ? "—" : value) +
      "</dd></div>"
    );
  }

  /** The name for a staff id, from the board's own crew list. */
  function nameFor(staffId) {
    const node = ((board && board.crew && board.crew.nodes) || []).find((row) => row.staffId === String(staffId));
    if (!node) return "Staff " + staffId;
    return [node.name, node.surname].filter(Boolean).join(" ") || "Staff " + staffId;
  }

  function renderApprovals(pending) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    if (!pending || pending.length === 0) {
      elements.approvals.innerHTML = '<p class="crew-muted">Nothing is waiting for a decision.</p>';
      return;
    }

    elements.approvals.innerHTML =
      '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
      '<th>Crew member</th><th>Type</th><th>Dates</th><th>Days</th><th>Note</th><th class="crew-no-print">Decision</th>' +
      "</tr></thead><tbody>" +
      pending
        .map(
          (request) =>
            "<tr><td>" +
            escape(nameFor(request.staffId)) +
            "</td><td>" +
            escape(CrewApi.labelForLeaveType(request.type)) +
            "</td><td>" +
            escape(request.from) +
            " – " +
            escape(request.to) +
            (request.halfDayStart || request.halfDayEnd ? ' <span class="crew-muted">(half day)</span>' : "") +
            "</td><td>" +
            escape(request.workingDays) +
            "</td><td>" +
            (request.reason ? escape(request.reason) : "—") +
            '</td><td class="crew-no-print"><div class="crew-row-actions">' +
            // The version travels on the button, so the decision is conditional on
            // the row the person actually looked at.
            '<button class="crew-btn crew-btn--small crew-btn--primary" data-leave-approve="' +
            escape(request.id) +
            '" data-leave-version="' +
            escape(request.version) +
            '"><i class="fa-solid fa-check"></i> Approve</button>' +
            '<button class="crew-btn crew-btn--small" data-leave-reject="' +
            escape(request.id) +
            '" data-leave-version="' +
            escape(request.version) +
            '"><i class="fa-solid fa-xmark"></i> Reject</button>' +
            "</div></td></tr>",
        )
        .join("") +
      "</tbody></table></div>";
  }

  // --- the calendar ---------------------------------------------------------
  //
  // A month GRID per month in the range, not a row per day.
  //
  // The first version was a day-per-row table, which is 31 rows to read one month and
  // 365 to read a year — technically complete and useless at a glance. A grid is the
  // shape people already know a calendar in: seven columns, five or six rows, and
  // "who is off in the last week of August" is one saccade instead of a scroll.
  //
  // Three consequences, each handled below:
  //
  //   1. a grid needs leading and trailing blanks, and a decision about which day the
  //      week starts on — Monday, because a farm week is talked about as "week
  //      beginning Monday" and that is what `work-time.js` already assumes;
  //   2. a cell is small, so it carries INITIALS and a count, not names. The names are
  //      one click away rather than always on screen;
  //   3. a range can span many months, so each month is a `<details>` that collapses.

  const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MONTH_LABELS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  /** How many initials a cell shows before collapsing the rest into "+n". */
  const CELL_CHIP_LIMIT = 3;

  /**
   * The calendar months a range touches, in order.
   *
   * Driven off the DAYS the server returned rather than off the from/to strings, so a
   * month with no data cannot appear as an empty grid and a partial first month
   * renders only the days it has.
   *
   * @param {Array} days - `leaveCalendar` entries
   * @returns {Array<{key: string, year: number, month: number, label: string, days: Array}>}
   */
  function monthsInCalendar(days) {
    const byMonth = new Map();
    for (const day of days || []) {
      if (typeof day.date !== "string" || day.date.length < 7) continue;
      const key = day.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(day);
    }

    return [...byMonth.keys()].sort().map((key) => {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(5, 7));
      return { key, year, month, label: MONTH_LABELS[month - 1] + " " + year, days: byMonth.get(key) };
    });
  }

  /**
   * A month's days laid out as weeks of seven, Monday first.
   *
   * Blanks are `null` — both the leading ones before the 1st and any day the range did
   * not include, so a range starting mid-month renders a grid with a gap rather than
   * shifting every date into the wrong column. Getting that wrong would put a Tuesday
   * under the Friday heading, which is worse than showing nothing.
   *
   * @returns {Array<Array<object|null>>}
   */
  function monthGrid(month) {
    const byDate = new Map((month.days || []).map((day) => [day.date, day]));
    const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();

    // JavaScript's getUTCDay is Sunday-0; shift so Monday is 0.
    const firstWeekday = (new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay() + 6) % 7;

    const cells = [];
    for (let blank = 0; blank < firstWeekday; blank += 1) cells.push(null);
    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
      const date = month.key + "-" + String(dayOfMonth).padStart(2, "0");
      cells.push(byDate.get(date) || null);
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    return weeks;
  }

  /**
   * Initials for a chip. "Halina Kowalska" → "HK".
   *
   * Falls back to the staff id, because a cell must never render blank: an unnamed
   * absence is still somebody being away, and an empty chip looks like a bug.
   */
  function initialsFor(absence) {
    const letters = [absence.name, absence.surname]
      .filter(Boolean)
      .map((part) => String(part).trim().charAt(0).toUpperCase())
      .join("");
    return letters || "#" + absence.staffId;
  }

  /**
   * Should this month open on load?
   *
   * Months with somebody off, and the month containing today. A year-long range would
   * otherwise open twelve grids, and a page that opens on twelve grids has the same
   * problem the day-per-row table had.
   */
  function monthOpensExpanded(month, today) {
    if (month.key === String(today).slice(0, 7)) return true;
    return (month.days || []).some((day) => (day.absences || []).length > 0);
  }

  function renderCalendar(days) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    if (!days || days.length === 0) {
      elements.calendar.innerHTML = '<p class="crew-muted">No days in that range.</p>';
      return;
    }

    const today = CrewApi.todayIso();
    const months = monthsInCalendar(days);

    elements.calendar.innerHTML =
      months.map((month) => renderMonth(month, today)).join("") +
      // One detail panel for the whole calendar, filled when a day is chosen. A panel
      // per month would move the grids around as it opened and closed.
      '<div id="leaveDayDetail" class="crew-day-detail" hidden></div>';
  }

  function renderMonth(month, today) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    const offDays = month.days.filter((day) => (day.absences || []).length > 0).length;
    const people = new Set();
    for (const day of month.days) for (const absence of day.absences || []) people.add(absence.staffId);

    const summary =
      offDays === 0
        ? '<span class="crew-muted">nobody off</span>'
        : escape(people.size) + " off across " + escape(offDays) + " day" + (offDays === 1 ? "" : "s");

    return (
      '<details class="crew-month"' +
      (monthOpensExpanded(month, today) ? " open" : "") +
      '><summary class="crew-month__summary"><span class="crew-month__name">' +
      escape(month.label) +
      '</span> <span class="crew-month__count">' +
      summary +
      "</span></summary>" +
      '<table class="crew-cal"><thead><tr>' +
      WEEKDAY_LABELS.map(
        (label) => '<th scope="col"><abbr title="' + escape(label) + '">' + escape(label.slice(0, 1)) + "</abbr></th>",
      ).join("") +
      "</tr></thead><tbody>" +
      monthGrid(month)
        .map((week) => "<tr>" + week.map((day) => renderDayCell(day, today)).join("") + "</tr>")
        .join("") +
      "</tbody></table></details>"
    );
  }

  function renderDayCell(day, today) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    // A blank is a real cell so the grid keeps its shape, but it is not a button and
    // carries no date.
    if (!day) return '<td class="crew-cal__cell crew-cal__cell--blank"></td>';

    const absences = day.absences || [];
    const classes = ["crew-cal__cell"];
    if (day.weekend) classes.push("crew-cal__cell--weekend");
    if (day.publicHoliday) classes.push("crew-cal__cell--holiday");
    if (day.blackoutReason) classes.push("crew-cal__cell--blackout");
    if (day.date === today) classes.push("crew-cal__cell--today");
    if (absences.length > 0) classes.push("crew-cal__cell--busy");

    const shown = absences.slice(0, CELL_CHIP_LIMIT);
    const overflow = absences.length - shown.length;

    const chips =
      shown
        .map(
          (absence) =>
            '<span class="crew-cal__chip crew-cal__chip--' +
            escape(String(absence.status).toLowerCase()) +
            (absence.halfDay ? " crew-cal__chip--half" : "") +
            '" title="' +
            escape(
              [absence.name, absence.surname].filter(Boolean).join(" ") +
                " — " +
                CrewApi.labelForLeaveType(absence.type) +
                (absence.halfDay ? ", half day" : "") +
                ", " +
                CrewApi.labelForLeaveStatus(absence.status).toLowerCase(),
            ) +
            '">' +
            escape(initialsFor(absence)) +
            "</span>",
        )
        .join("") + (overflow > 0 ? '<span class="crew-cal__chip crew-cal__chip--more">+' + escape(overflow) + "</span>" : "");

    // A whole-cell label, because the chips are initials and a screen reader would
    // otherwise read "H K" and stop.
    const label =
      day.date +
      (day.publicHoliday ? ", public holiday" : "") +
      (day.blackoutReason ? ", blackout: " + day.blackoutReason : "") +
      (absences.length === 0 ? ", nobody off" : ", " + absences.length + " off");

    return (
      '<td class="' +
      classes.join(" ") +
      '"><button type="button" class="crew-cal__day" data-leave-day="' +
      escape(day.date) +
      '" aria-label="' +
      escape(label) +
      '"><span class="crew-cal__date">' +
      escape(Number(day.date.slice(8, 10))) +
      "</span>" +
      '<span class="crew-cal__chips">' +
      chips +
      "</span></button></td>"
    );
  }

  /**
   * Show one day's absences in full.
   *
   * The grid trades detail for density on purpose; this is where the detail went. It
   * is a panel below the grids rather than an expanding row, so opening it does not
   * reflow the month somebody is reading.
   */
  function showDayDetail(date) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const panel = document.getElementById("leaveDayDetail");
    if (!panel) return;

    const day = ((board && board.leaveCalendar) || []).find((entry) => entry.date === date);
    if (!day) {
      panel.hidden = true;
      return;
    }

    const flags = [];
    if (day.weekend) flags.push('<span class="crew-muted">weekend</span>');
    if (day.publicHoliday) flags.push('<span class="crew-badge crew-badge--holiday">Public holiday</span>');
    if (day.blackoutReason) flags.push('<span class="crew-badge crew-badge--blackout">' + escape(day.blackoutReason) + "</span>");

    const absences = day.absences || [];
    panel.hidden = false;
    panel.innerHTML =
      '<div class="crew-day-detail__head"><h3 class="crew-subhead">' +
      escape(day.date) +
      "</h3> " +
      flags.join(" ") +
      // Text, not just an icon, for the same reason the month arrows carry a label:
      // Font Awesome is a CDN dependency and a button with no other content vanishes
      // when it fails to arrive.
      '<button type="button" class="crew-btn crew-btn--small" data-leave-day-close="1">' +
      '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Close</button></div>' +
      (absences.length === 0
        ? '<p class="crew-muted">Nobody is off on this day.</p>'
        : '<ul class="crew-list">' +
          absences
            .map(
              (absence) =>
                '<li><a class="crew-link" href="/crew-member.html?staffId=' +
                escape(absence.staffId) +
                '">' +
                escape([absence.name, absence.surname].filter(Boolean).join(" ") || "Staff " + absence.staffId) +
                "</a> — " +
                escape(CrewApi.labelForLeaveType(absence.type)) +
                (absence.halfDay ? ", half day" : "") +
                ' <span class="crew-badge crew-badge--' +
                escape(String(absence.status).toLowerCase()) +
                '">' +
                escape(CrewApi.labelForLeaveStatus(absence.status)) +
                "</span></li>",
            )
            .join("") +
          "</ul>");
  }

  /** One listener for the whole calendar, so re-rendering never orphans handlers. */
  function wireCalendar() {
    if (!elements.calendar) return;
    elements.calendar.addEventListener("click", function (event) {
      const target = event.target && event.target.closest ? event.target.closest("[data-leave-day],[data-leave-day-close]") : null;
      if (!target) return;

      if (target.getAttribute("data-leave-day-close")) {
        const panel = document.getElementById("leaveDayDetail");
        if (panel) panel.hidden = true;
        return;
      }
      showDayDetail(target.getAttribute("data-leave-day"));
    });
  }

  function renderBalances(crew) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const nodes = (crew && crew.nodes) || [];

    if (nodes.length === 0) {
      elements.balances.innerHTML = '<p class="crew-muted">Nobody on the roster yet.</p>';
      return;
    }

    // A member with no leave field has no policy behind them; one with no profile has
    // no contract to accrue against. Both are shown with a reason rather than a zero.
    elements.balances.innerHTML =
      '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
      "<th>Crew member</th><th>Role</th><th>Entitlement</th><th>Accrued</th><th>Carried over</th><th>Taken</th><th>Booked</th><th>Remaining</th><th>Next off</th>" +
      "</tr></thead><tbody>" +
      nodes
        .map((node) => {
          const name = [node.name, node.surname].filter(Boolean).join(" ") || "Staff " + node.staffId;
          const balance = node.leave && node.leave.balance;
          const next = node.leave && node.leave.nextBooked;

          if (!balance) {
            return (
              '<tr><td><a class="crew-link" href="/crew-member.html?staffId=' +
              escape(node.staffId) +
              '">' +
              escape(name) +
              '</a></td><td colspan="8"><span class="crew-muted">' +
              (node.profile ? "no balance available" : "no employment profile, so nothing accrues yet") +
              "</span></td></tr>"
            );
          }

          const expiring =
            balance.expiringSoon > 0
              ? ' <span class="crew-badge crew-badge--expiring_soon">' +
                escape(balance.expiringSoon) +
                " expiring" +
                (balance.carryOverExpiresOn ? " " + escape(balance.carryOverExpiresOn) : "") +
                "</span>"
              : "";

          return (
            '<tr><td><a class="crew-link" href="/crew-member.html?staffId=' +
            escape(node.staffId) +
            '">' +
            escape(name) +
            "</a>" +
            (node.orphaned ? ' <span class="crew-badge crew-badge--none">orphaned</span>' : "") +
            "</td><td>" +
            escape(node.profile ? CrewApi.labelForRole(node.profile.role) : "—") +
            "</td><td>" +
            escape(balance.entitlement) +
            "</td><td>" +
            escape(balance.accrued) +
            "</td><td>" +
            escape(balance.carriedOver) +
            expiring +
            "</td><td>" +
            escape(balance.taken) +
            "</td><td>" +
            escape(balance.booked) +
            '</td><td><strong class="' +
            // A negative remaining is legal — days committed but not yet accrued —
            // and is flagged rather than hidden, because it is worth noticing.
            (balance.remaining < 0 ? "crew-negative" : "") +
            '">' +
            escape(balance.remaining) +
            "</strong></td><td>" +
            (next ? escape(next.from) + " – " + escape(next.to) : '<span class="crew-muted">—</span>') +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
  }

  function renderSummary(data, range) {
    const CrewApi = window.CrewApi;
    const pending = (data.pendingLeaveApprovals || []).length;
    const offDays = (data.leaveCalendar || []).filter((day) => (day.absences || []).length > 0).length;

    CrewApi.setStatus(elements.summary, "info", "");
    elements.summary.textContent =
      range.from +
      " – " +
      range.to +
      " · " +
      pending +
      " awaiting a decision · " +
      offDays +
      " day(s) with somebody off · " +
      ((data.crew && data.crew.totalCount) || 0) +
      " on the roster";
  }

  // --- the request form -----------------------------------------------------

  function populateRequestForm(crew) {
    const CrewApi = window.CrewApi;
    const nodes = (crew && crew.nodes) || [];

    if (elements.reqMember) {
      elements.reqMember.innerHTML =
        '<option value="">Choose…</option>' +
        nodes
          .filter((node) => !node.orphaned)
          .map(
            (node) =>
              '<option value="' +
              CrewApi.escapeHtml(node.staffId) +
              '">' +
              CrewApi.escapeHtml([node.name, node.surname].filter(Boolean).join(" ") || "Staff " + node.staffId) +
              "</option>",
          )
          .join("");
    }
    if (elements.reqType && !elements.reqType.innerHTML) {
      elements.reqType.innerHTML = CrewApi.optionsHtml(CrewApi.LEAVE_TYPE_LABELS, { selected: "ANNUAL" });
    }
  }

  function toggleRequestPanel(show) {
    const CrewApi = window.CrewApi;
    if (!elements.requestPanel || !elements.requestToggle) return;

    const next = show === undefined ? elements.requestPanel.hidden : show;
    elements.requestPanel.hidden = !next;
    elements.requestToggle.setAttribute("aria-expanded", next ? "true" : "false");
    if (!next) {
      CrewApi.clearFieldErrors(REQUEST_FIELD_IDS);
      CrewApi.setStatus(elements.requestErrors, "info", "");
      return;
    }
    // Only one panel may be up: they share this strip, and two stacked forms leave no
    // clue which button produced what.
    if (elements.policyPanel && !elements.policyPanel.hidden) togglePolicyPanel(false);
    if (elements.reqMember && typeof elements.reqMember.focus === "function") elements.reqMember.focus();
  }

  async function submitRequest(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    const CrewApi = window.CrewApi;

    const staffId = CrewApi.readValue("leaveReqMember");
    const from = CrewApi.readValue("leaveReqFrom");
    const to = CrewApi.readValue("leaveReqTo");

    // Validated here first, so a blank required field is reported as a form problem
    // naming the field rather than escaping to the server as a schema error.
    const errors = CrewApi.validateInput([
      { field: "staffId", label: "Crew member", value: staffId, required: true },
      { field: "from", label: "From", value: from, required: true, kind: "date" },
      { field: "to", label: "To", value: to, required: true, kind: "date" },
    ]);
    if (errors.length === 0 && from > to) {
      errors.push({ field: "to", message: "To must be on or after From." });
    }
    if (errors.length > 0) {
      CrewApi.applyFieldErrors(errors, REQUEST_FIELD_IDS, elements.requestErrors);
      return;
    }
    CrewApi.clearFieldErrors(REQUEST_FIELD_IDS);

    const input = {
      staffId: staffId,
      type: CrewApi.readValue("leaveReqType") || "ANNUAL",
      from: from,
      to: to,
      halfDayStart: Boolean(elements.reqHalfStart && elements.reqHalfStart.checked),
      halfDayEnd: Boolean(elements.reqHalfEnd && elements.reqHalfEnd.checked),
    };
    const reason = CrewApi.readValue("leaveReqReason");
    if (reason) input.reason = reason;

    CrewApi.setStatus(elements.requestErrors, "info", "Requesting…");
    const result = await CrewApi.run(CrewApi.OPERATIONS.REQUEST_LEAVE, { input: input });

    // An unknown member or a malformed input arrives as an ERROR with a code (§8.3
    // keeps the union at six members), so both shapes have to be handled.
    if (!result.ok) {
      const fieldErrors = ((result.errors || [])[0] || {}).extensions;
      if (fieldErrors && fieldErrors.fieldErrors) {
        CrewApi.applyFieldErrors(fieldErrors.fieldErrors, REQUEST_FIELD_IDS, elements.requestErrors);
        return;
      }
      CrewApi.setStatus(elements.requestErrors, "error", CrewApi.describeErrors(result));
      return;
    }

    const member = result.data.requestLeave;
    const booked = member.__typename === "LeaveBooked" || member.__typename === "LeaveBookedWithWarning";

    if (!booked) {
      // A refusal is an answer, not a failure — shown on the form so the person can
      // change the dates without losing what they typed.
      CrewApi.setStatus(elements.requestErrors, "error", CrewApi.describeUnion(member));
      return;
    }

    // Decision 2: a warning rides along with a success. "Requested" comes first.
    CrewApi.toast(CrewApi.describeUnion(member), member.__typename === "LeaveBookedWithWarning" ? "warning" : "success", elements.status);
    toggleRequestPanel(false);
    if (elements.requestForm && typeof elements.requestForm.reset === "function") elements.requestForm.reset();
    await load();
  }

  // --- the policy form ------------------------------------------------------

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value === null || value === undefined ? "" : String(value);
  }

  /** Fill the form from the policy as last loaded, or from the defaults. */
  function fillPolicyForm() {
    const CrewApi = window.CrewApi;
    const values = policyFormValues(board && board.leavePolicy);

    if (elements.policyAccrualMode) {
      elements.policyAccrualMode.innerHTML = CrewApi.optionsHtml(ACCRUAL_MODE_LABELS, { selected: values.accrualMode });
    }
    setValue("policyEntitlement", values.annualEntitlementDaysFullTime);
    setValue("policyLeaveYearStart", values.leaveYearStart);
    setValue("policyCarryOverCap", values.carryOverCapDays);
    setValue("policyCarryOverExpires", values.carryOverExpiresOn);
    setValue("policyMinNotice", values.minNoticeDays);
    setValue("policyPublicHolidays", values.publicHolidays);
    setValue("policyBlackouts", values.blackoutWindows);
  }

  function togglePolicyPanel(show) {
    const CrewApi = window.CrewApi;
    if (!elements.policyPanel || !elements.policyToggle) return;

    const next = show === undefined ? elements.policyPanel.hidden : show;
    elements.policyPanel.hidden = !next;
    elements.policyToggle.setAttribute("aria-expanded", next ? "true" : "false");

    if (!next) {
      CrewApi.clearFieldErrors(POLICY_FIELD_IDS);
      CrewApi.setStatus(elements.policyErrors, "info", "");
      return;
    }
    // The other panel shares this strip, so only one may be up — otherwise there are
    // two stacked forms with no clue which button produced what.
    toggleRequestPanel(false);
    fillPolicyForm();
    const first = document.getElementById("policyEntitlement");
    if (first && typeof first.focus === "function") first.focus();
  }

  /**
   * Read the form into a `LeavePolicyInput`.
   *
   * @returns {{input: object, errors: Array}} errors is empty when the input is usable
   */
  function policyInput() {
    const CrewApi = window.CrewApi;

    const entitlement = CrewApi.numberOrNull(CrewApi.readValue("policyEntitlement"));
    const cap = CrewApi.numberOrNull(CrewApi.readValue("policyCarryOverCap"));
    const notice = CrewApi.numberOrNull(CrewApi.readValue("policyMinNotice"));
    const leaveYearStart = CrewApi.readValue("policyLeaveYearStart");
    const carryOverExpiresOn = CrewApi.readValue("policyCarryOverExpires");

    // Checked here first so a blank or malformed field names itself, rather than
    // reaching the graph as a coercion error about a scalar the user never saw.
    const errors = CrewApi.validateInput([
      {
        field: "annualEntitlementDaysFullTime",
        label: "Annual entitlement",
        value: CrewApi.readValue("policyEntitlement"),
        required: true,
        kind: "number",
        min: 0,
        max: 60,
        step: 0.5,
      },
      {
        field: "carryOverCapDays",
        label: "Carry-over cap",
        value: CrewApi.readValue("policyCarryOverCap"),
        kind: "number",
        min: 0,
        max: 30,
        step: 0.5,
      },
      { field: "minNoticeDays", label: "Minimum notice", value: CrewApi.readValue("policyMinNotice"), kind: "integer", min: 0, max: 90 },
    ]);

    // The leave year must be MM-DD with a day of 01–28: every one of the twelve month
    // slices has to exist in February too, which is the server's rule as well.
    if (!MONTH_DAY_PATTERN.test(leaveYearStart) || Number(leaveYearStart.slice(3)) < 1 || Number(leaveYearStart.slice(3)) > 28) {
      errors.push({ field: "leaveYearStart", message: "Leave year start must be MM-DD with a day between 01 and 28." });
    }
    if (carryOverExpiresOn && !MONTH_DAY_PATTERN.test(carryOverExpiresOn)) {
      errors.push({ field: "carryOverExpiresOn", message: "Carry-over expiry must be MM-DD, or blank for never." });
    }

    const holidays = parseDateList(CrewApi.readValue("policyPublicHolidays"));
    if (holidays.invalid.length > 0) {
      errors.push({ field: "publicHolidays", message: "Not a date: " + holidays.invalid.join(", ") + ". Use YYYY-MM-DD." });
    }

    const blackouts = parseBlackoutWindows(CrewApi.readValue("policyBlackouts"));
    if (blackouts.invalid.length > 0) {
      errors.push({ field: "blackoutWindows", message: "Could not read: " + blackouts.invalid.join(" / ") + ". Use from,to,reason." });
    }

    const input = {
      annualEntitlementDaysFullTime: entitlement,
      accrualMode: CrewApi.readValue("policyAccrualMode") || POLICY_DEFAULTS.accrualMode,
      leaveYearStart: leaveYearStart,
      carryOverCapDays: cap === null ? 0 : cap,
      // Explicitly null rather than omitted: a policy with no expiry keeps carried-over
      // days for the whole leave year, and that is a choice somebody can make here.
      carryOverExpiresOn: carryOverExpiresOn || null,
      minNoticeDays: notice === null ? 0 : notice,
      publicHolidays: holidays.dates,
      blackoutWindows: blackouts.windows,
    };

    const version = policyFormValues(board && board.leavePolicy).expectedVersion;
    if (version !== null && version !== undefined) input.expectedVersion = version;

    return { input, errors };
  }

  async function submitPolicy(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    const CrewApi = window.CrewApi;

    const { input, errors } = policyInput();
    if (errors.length > 0) {
      CrewApi.applyFieldErrors(errors, POLICY_FIELD_IDS, elements.policyErrors);
      return;
    }
    CrewApi.clearFieldErrors(POLICY_FIELD_IDS);
    CrewApi.setStatus(elements.policyErrors, "info", "Saving…");

    const result = await CrewApi.run(CrewApi.OPERATIONS.SET_LEAVE_POLICY, { input: input });
    if (!result.ok) {
      CrewApi.setStatus(elements.policyErrors, "error", CrewApi.describeErrors(result));
      return;
    }

    const member = result.data.setLeavePolicy;
    if (member.__typename === "LeaveValidationFailed") {
      // The same inputs marked for a server rejection as for a client-side one.
      CrewApi.applyFieldErrors(member.fieldErrors || [], POLICY_FIELD_IDS, elements.policyErrors);
      return;
    }
    if (member.__typename !== "LeavePolicySet") {
      // A version conflict means somebody else saved first. Not retried: re-sending
      // this form would overwrite a policy the user has not seen.
      CrewApi.setStatus(elements.policyErrors, "error", CrewApi.describeUnion(member) + " Reload to see the current policy.");
      return;
    }

    CrewApi.toast("Leave policy saved. Balances are computed from it immediately.", "success", elements.status);
    togglePolicyPanel(false);
    await load();
  }

  // --- decisions ------------------------------------------------------------

  /**
   * Approve, reject or cancel, always with the version the row was drawn from.
   *
   * A `VersionConflict` is reported as "reload and try again" rather than retried
   * automatically: the row changed under the person, and re-sending the same decision
   * against the new version would apply a judgement made on stale information.
   */
  async function decide(operation, requestId, expectedVersion, reason) {
    const CrewApi = window.CrewApi;
    const variables = { requestId: requestId, expectedVersion: Number(expectedVersion) };
    if (reason !== undefined) variables.reason = reason;

    CrewApi.setStatus(elements.status, "info", "Saving…");
    const result = await CrewApi.run(operation, variables);

    if (!result.ok) {
      CrewApi.toast(CrewApi.describeErrors(result), "error", elements.status);
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
      return;
    }

    const member = result.data.approveLeave || result.data.rejectLeave || result.data.cancelLeave;
    const decided = member.__typename === "LeaveRequestDecided";
    CrewApi.toast(CrewApi.describeUnion(member), decided ? "success" : "error", elements.status);
    CrewApi.setStatus(elements.status, "info", "");
    await load();
  }

  /** One listener for the whole queue, so re-rendering it never orphans handlers. */
  function wireApprovalQueue() {
    if (!elements.approvals) return;
    elements.approvals.addEventListener("click", function (event) {
      const target = event.target && event.target.closest ? event.target.closest("[data-leave-approve],[data-leave-reject]") : null;
      if (!target) return;

      const CrewApi = window.CrewApi;
      const version = target.getAttribute("data-leave-version");
      const approveId = target.getAttribute("data-leave-approve");
      if (approveId) {
        decide(CrewApi.OPERATIONS.APPROVE_LEAVE, approveId, version);
        return;
      }

      const rejectId = target.getAttribute("data-leave-reject");
      if (!rejectId) return;
      // A rejection needs a reason — the server requires one, because "no" with no
      // way to respond to it is not a decision somebody can act on.
      const reason = window.prompt("Why is this being rejected?");
      if (reason === null) return;
      if (!reason.trim()) {
        CrewApi.toast("A rejection needs a reason.", "error", elements.status);
        return;
      }
      decide(CrewApi.OPERATIONS.REJECT_LEAVE, rejectId, version, reason.trim());
    });
  }

  // --- export ---------------------------------------------------------------

  /**
   * The balance table as CSV, built from data already loaded.
   *
   * Client-side on purpose (§10.1): no new REST endpoint, no new dependency. The
   * quoting is the only fiddly part — a name containing a comma has to survive.
   */
  function balancesCsv(crew) {
    const header = ["Staff id", "Name", "Role", "Entitlement", "Accrued", "Carried over", "Taken", "Booked", "Remaining"];
    const quote = (value) => '"' + String(value === null || value === undefined ? "" : value).replace(/"/g, '""') + '"';

    const rows = ((crew && crew.nodes) || []).map((node) => {
      const balance = (node.leave && node.leave.balance) || {};
      return [
        node.staffId,
        [node.name, node.surname].filter(Boolean).join(" "),
        node.profile ? node.profile.role : "",
        balance.entitlement,
        balance.accrued,
        balance.carriedOver,
        balance.taken,
        balance.booked,
        balance.remaining,
      ].map(quote);
    });

    return [header.map(quote).join(","), ...rows.map((row) => row.join(","))].join("\r\n");
  }

  function downloadCsv() {
    const CrewApi = window.CrewApi;
    if (!board) {
      CrewApi.toast("Nothing loaded to export yet.", "info", elements.status);
      return;
    }
    const csv = balancesCsv(board.crew);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "crew-leave-balances.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // --- load -----------------------------------------------------------------

  async function load() {
    const CrewApi = window.CrewApi;
    const range = currentRange();
    setRange(range);

    CrewApi.setStatus(elements.status, "info", "Loading holidays…");
    const result = await CrewApi.run(CrewApi.OPERATIONS.LEAVE_BOARD, {
      from: range.from,
      to: range.to,
      asOf: CrewApi.todayIso(),
    });

    // `leave` fields null-propagate when no policy exists (§7.3), so a partial
    // response with a LEAVE_POLICY_MISSING error is expected rather than a failure.
    // The page renders what it did get and explains the rest.
    const data = result.data;
    if (!data || !data.crewInfo) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result) || "Holidays could not be loaded.");
      return;
    }

    // Drop tabs for pillars this build does not have (§10.1).
    CrewApi.renderModuleTabs(undefined, data.crewInfo.pillars);

    if (data.crewInfo.pillars.indexOf(PILLAR) === -1) {
      CrewApi.setStatus(elements.status, "info", "");
      elements.policy.innerHTML =
        '<p class="crew-notice">The <strong>holidays</strong> pillar is not assembled in this build, so there is nothing to show. ' +
        "The rest of Crew Office is unaffected.</p>";
      elements.approvals.innerHTML = "";
      elements.calendar.innerHTML = "";
      elements.balances.innerHTML = "";
      return;
    }

    board = data;
    renderPolicy(data.leavePolicy);
    renderApprovals(data.pendingLeaveApprovals);
    renderCalendar(data.leaveCalendar);
    renderBalances(data.crew);
    populateRequestForm(data.crew);
    renderSummary(data, range);

    // A policy-missing error is the one error worth surfacing quietly alongside a
    // rendered page; anything else is reported outright.
    const codes = (result.errors || []).map((error) => (error.extensions || {}).code);
    if (codes.length > 0 && codes.every((code) => code === "LEAVE_POLICY_MISSING")) {
      CrewApi.setStatus(elements.status, "info", "");
    } else if (result.errors && result.errors.length > 0) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
    } else {
      CrewApi.setStatus(elements.status, "info", "");
    }
  }

  function wire() {
    const CrewApi = window.CrewApi;

    if (elements.reload) elements.reload.addEventListener("click", () => load());

    /** Set the range and reload — every navigation button is one of these. */
    const goTo = (range) => {
      if (!range) return;
      setRange(range);
      load();
    };

    if (elements.prev) elements.prev.addEventListener("click", () => goTo(shiftMonths(currentRange(), -1)));
    if (elements.next) elements.next.addEventListener("click", () => goTo(shiftMonths(currentRange(), 1)));
    if (elements.thisMonth) elements.thisMonth.addEventListener("click", () => goTo(monthRange(CrewApi.todayIso(), 0)));
    if (elements.quarter) elements.quarter.addEventListener("click", () => goTo(monthsFrom(currentRange().from, 3)));
    if (elements.year) elements.year.addEventListener("click", () => goTo(monthsFrom(currentRange().from.slice(0, 4) + "-01-01", 12)));
    for (const input of [elements.from, elements.to]) {
      if (input) input.addEventListener("change", () => load());
    }

    if (elements.requestToggle) elements.requestToggle.addEventListener("click", () => toggleRequestPanel());
    if (elements.requestCancel) elements.requestCancel.addEventListener("click", () => toggleRequestPanel(false));
    if (elements.requestForm) elements.requestForm.addEventListener("submit", submitRequest);

    if (elements.policyToggle) elements.policyToggle.addEventListener("click", () => togglePolicyPanel());
    if (elements.policyCancel) elements.policyCancel.addEventListener("click", () => togglePolicyPanel(false));
    if (elements.policyForm) elements.policyForm.addEventListener("submit", submitPolicy);
    if (elements.exportCsv) elements.exportCsv.addEventListener("click", downloadCsv);
    if (elements.exportPdf) elements.exportPdf.addEventListener("click", () => window.print());

    wireApprovalQueue();
    wireCalendar();
  }

  function init() {
    cacheElements();
    if (!window.CrewApi.requireSession()) return;

    // The strip goes up before any data arrives, so a slow query does not leave the
    // page looking chromeless. It is re-rendered with the pillar list once known.
    window.CrewApi.renderModuleTabs();
    setRange(monthRange(window.CrewApi.todayIso(), 0));
    wire();
    load();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  return {
    init,
    load,
    monthRange,
    balancesCsv,
    parseDateList,
    parseBlackoutWindows,
    formatBlackoutWindows,
    policyFormValues,
    POLICY_DEFAULTS,
    // Calendar internals, exported so the grid arithmetic is swept as pure functions.
    monthsSpan,
    shiftMonths,
    monthsFrom,
    monthsInCalendar,
    monthGrid,
    initialsFor,
    monthOpensExpanded,
    showDayDetail,
    WEEKDAY_LABELS,
    CELL_CHIP_LIMIT,
  };
});
