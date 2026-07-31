/**
 * Crew Office work board — shift assignment and time tracking (PRD §8.2, Phase 3C).
 *
 * Members down the side, days across the top, each cell holding that person's shifts
 * and the hours they logged. Range-driven rather than a fixed month view, because the
 * two filters a roster manager actually wants are "which person" and "which dates".
 *
 * The pure helpers below — `datesInRange`, `presetRange`, `buildCsv`, `csvCell`,
 * `indexBoard` — take no DOM and no network, and are exported so
 * `crew.work-export.test.js` can sweep their edge cases without a browser. That is
 * also why the boot at the bottom is guarded on `typeof document`: this file has to
 * be requireable from Node.
 *
 * Export is client-side by design: CSV is built from data already loaded, and PDF is
 * the browser's own print pipeline driven by the print rules in crew.css. No new REST
 * endpoint (goal G2 keeps REST to health only), no new dependency.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewWorkPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // A range wider than this is refused before it is rendered: one column per day
  // means a two-year range would build ~730 columns per member and lock the tab.
  const MAX_RANGE_DAYS = 120;

  // --- pure helpers ---------------------------------------------------------

  /** Add days to a YYYY-MM-DD date in UTC. Returns null if the input is malformed. */
  function addDays(dateString, days) {
    if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
    const date = new Date(dateString + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Every date from `from` to `to`, inclusive.
   *
   * Returns [] for a malformed or inverted range rather than looping — an inverted
   * range is a user typo, and a `while (cursor <= to)` on one would never terminate.
   */
  function datesInRange(from, to, options = {}) {
    const limit = options.limit === undefined ? MAX_RANGE_DAYS : options.limit;
    if (!addDays(from, 0) || !addDays(to, 0)) return [];
    if (from > to) return [];

    const dates = [];
    let cursor = from;
    while (cursor <= to) {
      dates.push(cursor);
      if (dates.length >= limit) break;
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  /**
   * The from/to pair for a preset, anchored on a given day.
   *
   * Weeks are Monday-based to match the server's `weeklyRollup` — a client that
   * disagreed about where a week starts would show a total that never matches the
   * one the graph reports.
   */
  function presetRange(preset, anchorDate) {
    const anchor = addDays(anchorDate, 0);
    if (!anchor) return null;

    if (preset === "week") {
      const date = new Date(anchor + "T00:00:00.000Z");
      const day = date.getUTCDay(); // 0 = Sunday
      const monday = addDays(anchor, day === 0 ? -6 : 1 - day);
      return { from: monday, to: addDays(monday, 6) };
    }

    if (preset === "month") {
      const date = new Date(anchor + "T00:00:00.000Z");
      const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    }

    return null;
  }

  /**
   * Quote one CSV field.
   *
   * Two separate jobs, and the second is a security one:
   *   - quote anything containing a comma, quote or newline, doubling inner quotes;
   *   - neutralise a leading `=`, `+`, `-` or `@` with a leading apostrophe, so a
   *     spreadsheet opening the file treats it as text rather than as a formula.
   *     An activity called `=cmd|...` would otherwise be executable content in Excel.
   */
  function csvCell(value) {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /** Rows (array of arrays) → CSV text with CRLF line endings, as the format wants. */
  function buildCsv(rows) {
    return (rows || []).map((row) => (row || []).map(csvCell).join(",")).join("\r\n");
  }

  /**
   * Index the board payload for O(1) cell lookup.
   *
   * Without this, rendering a 30-day range for 15 members would filter the shift and
   * log arrays 450 times each. Built once per load instead.
   */
  function indexBoard(data) {
    const shiftsByCell = new Map();
    const hoursByCell = new Map();
    const scheduledByCell = new Map();
    const key = (staffId, date) => String(staffId) + "|" + date;

    for (const shift of data.shifts || []) {
      const cellKey = key(shift.staffId, shift.date);
      const list = shiftsByCell.get(cellKey) || [];
      list.push(shift);
      shiftsByCell.set(cellKey, list);

      // Scheduled hours are tracked separately from logged hours, and a CANCELLED
      // shift contributes none: it is on the board for the audit trail, not as work
      // anybody is expected to do.
      if (shift.status !== "CANCELLED") {
        scheduledByCell.set(cellKey, (scheduledByCell.get(cellKey) || 0) + Number(shift.hours || 0));
      }
    }

    for (const entry of data.workLog || []) {
      // Superseded rows are in the payload on purpose (the log is append-only), but
      // only the effective ones may be summed — otherwise an amended day would show
      // both the wrong and the right figure added together.
      if (!entry.effective) continue;
      const cellKey = key(entry.staffId, entry.date);
      hoursByCell.set(cellKey, (hoursByCell.get(cellKey) || 0) + Number(entry.hours || 0));
    }

    return { shiftsByCell, hoursByCell, scheduledByCell, key };
  }

  /**
   * Every number the board prints, computed in one pass and returned as data.
   *
   * Extracted from the renderer for one reason: the totals were wrong in a way only
   * a person looking at the page could see — logged hours were summed while
   * SCHEDULED hours were ignored, so a roster full of shifts with nothing logged yet
   * showed a column of zeroes. Numbers that matter belong in a pure function with
   * tests, not inside a string-concatenating render loop.
   *
   * @returns {{ perCell: Map, perMember: Map, perDay: Map, grand: {scheduled, logged} }}
   */
  function computeBoardTotals(board, members, dates) {
    const { hoursByCell, scheduledByCell, key } = indexBoard(board);

    const perCell = new Map();
    const perMember = new Map();
    const perDay = new Map();
    let grandScheduled = 0;
    let grandLogged = 0;

    for (const date of dates) perDay.set(date, { scheduled: 0, logged: 0 });

    for (const member of members) {
      let memberScheduled = 0;
      let memberLogged = 0;

      for (const date of dates) {
        const cellKey = key(member.staffId, date);
        const scheduled = round2(scheduledByCell.get(cellKey) || 0);
        const logged = round2(hoursByCell.get(cellKey) || 0);

        perCell.set(cellKey, { scheduled: scheduled, logged: logged });
        memberScheduled += scheduled;
        memberLogged += logged;

        const day = perDay.get(date);
        day.scheduled = round2(day.scheduled + scheduled);
        day.logged = round2(day.logged + logged);
      }

      perMember.set(String(member.staffId), { scheduled: round2(memberScheduled), logged: round2(memberLogged) });
      grandScheduled += memberScheduled;
      grandLogged += memberLogged;
    }

    return { perCell, perMember, perDay, key, grand: { scheduled: round2(grandScheduled), logged: round2(grandLogged) } };
  }

  /**
   * Which members belong on the board.
   *
   * Orphaned members are included when they carry data in the range, so the board's
   * grand total reconciles with the server's rollup — hours somebody actually worked
   * must not vanish from the totals because their staff record was later deleted
   * (§12 rule 4). Orphans with nothing in range stay out; they are not crew.
   */
  function boardMembers(board, selectedStaffId, dates) {
    const nodes = (board && board.crew && board.crew.nodes) || [];
    if (selectedStaffId) return nodes.filter((member) => String(member.staffId) === String(selectedStaffId));

    const inRange = new Set();
    const within = (date) => dates.includes(date);
    // Read through the same null-safe path as `nodes`: a graph response can legally
    // carry `data: null` when a non-null root field fails, and reading `board.shifts`
    // off that threw.
    for (const shift of (board && board.shifts) || []) if (within(shift.date)) inRange.add(String(shift.staffId));
    for (const entry of (board && board.workLog) || []) if (entry.effective && within(entry.date)) inRange.add(String(entry.staffId));

    return nodes.filter((member) => !member.orphaned || inRange.has(String(member.staffId)));
  }

  /** "3 h", or an em dash for nothing — a bare "0" reads as data rather than absence. */
  function hoursLabel(value) {
    return value > 0 ? value + " h" : "—";
  }

  /** Round to two decimals, so a column of 0.25s does not print float noise. */
  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * The export table: one row per shift and one per work-log entry, with a `Type`
   * column. Flat rather than two files, because a roster manager reconciling
   * "planned versus actually worked" wants both in one sort.
   */
  function exportRows(data, members) {
    const nameOf = new Map(
      (members || []).map((member) => [
        String(member.staffId),
        member.orphaned ? "(deleted staff record)" : member.name + " " + member.surname,
      ]),
    );

    const rows = [["Type", "Date", "Staff id", "Crew member", "Duty / activity", "Status", "Hours", "Counts", "Note"]];

    for (const shift of data.shifts || []) {
      rows.push([
        "shift",
        shift.date,
        shift.staffId,
        nameOf.get(String(shift.staffId)) || "",
        shift.dutyType ? shift.dutyType.name : "",
        shift.status,
        shift.hours,
        "",
        shift.cancelReason ? "cancelled: " + shift.cancelReason : shift.note || "",
      ]);
    }

    for (const entry of data.workLog || []) {
      rows.push([
        "work_log",
        entry.date,
        entry.staffId,
        nameOf.get(String(entry.staffId)) || "",
        entry.activity,
        "",
        entry.hours,
        // The append-only log exports in full, with a column saying which rows count.
        entry.effective ? "yes" : "superseded",
        entry.amendedByReason ? "amended: " + entry.amendedByReason : entry.note || "",
      ]);
    }

    return rows;
  }

  // --- controller -----------------------------------------------------------

  const elements = {};
  let board = null;
  let selectedShiftId = null;

  function cacheElements() {
    const byId = (id) => document.getElementById(id);

    elements.member = byId("boardMember");
    elements.from = byId("boardFrom");
    elements.to = byId("boardTo");
    elements.thisWeek = byId("boardThisWeek");
    elements.thisMonth = byId("boardThisMonth");
    elements.reload = byId("boardReload");
    elements.summary = byId("boardSummary");
    elements.status = byId("boardStatus");
    elements.head = byId("boardHead");
    elements.body = byId("boardBody");
    elements.foot = byId("boardFoot");
    elements.empty = byId("boardEmpty");
    elements.exportCsv = byId("boardExportCsv");
    elements.exportPdf = byId("boardExportPdf");

    elements.assignToggle = byId("boardAssignToggle");
    elements.assignPanel = byId("boardAssignPanel");
    elements.assignForm = byId("boardAssignForm");
    elements.assignErrors = byId("boardAssignErrors");
    elements.assignSubmit = byId("boardAssignSubmit");
    elements.assignCancel = byId("boardAssignCancel");

    elements.logToggle = byId("boardLogToggle");
    elements.logPanel = byId("boardLogPanel");
    elements.logForm = byId("boardLogForm");
    elements.logErrors = byId("boardLogErrors");
    elements.logSubmit = byId("boardLogSubmit");
    elements.logCancel = byId("boardLogCancel");

    elements.dutyToggle = byId("boardDutyToggle");
    elements.dutyPanel = byId("boardDutyPanel");
    elements.dutyForm = byId("boardDutyForm");
    elements.dutyErrors = byId("boardDutyErrors");
    elements.dutySubmit = byId("boardDutySubmit");
    elements.dutyCancel = byId("boardDutyCancel");

    elements.shiftPanel = byId("boardShiftPanel");
    elements.shiftTitle = byId("boardShiftTitle");
    elements.shiftDetail = byId("boardShiftDetail");
    elements.shiftErrors = byId("boardShiftErrors");
    elements.confirmShift = byId("boardConfirmShift");
    elements.completeShift = byId("boardCompleteShift");
    elements.cancelShift = byId("boardCancelShift");
    elements.cancelReason = byId("boardCancelReason");
    elements.shiftClose = byId("boardShiftClose");
  }

  const value = (element) => (element && typeof element.value === "string" ? element.value.trim() : "");

  /**
   * The panels, as ONE exclusive group.
   *
   * They all occupy the same strip below the toolbar, so opening a second while the
   * first was still up left two stacked forms and no clue which button had done what.
   * Exactly one is open at a time now, and `openPanel` is the only way to open one —
   * an independent per-panel toggle is what allowed the stacking in the first place.
   *
   * `shift` is in the group even though it opens by clicking a chip rather than a
   * toolbar button: it is a panel in the same strip, and "only one panel" has to mean
   * all of them or it means nothing.
   */
  const PANEL_NAMES = ["assign", "log", "duty", "shift"];

  function panelParts(name) {
    if (name === "assign") return { panel: elements.assignPanel, toggle: elements.assignToggle };
    if (name === "log") return { panel: elements.logPanel, toggle: elements.logToggle };
    if (name === "duty") return { panel: elements.dutyPanel, toggle: elements.dutyToggle };
    if (name === "shift") return { panel: elements.shiftPanel, toggle: null };
    return { panel: null, toggle: null };
  }

  function isPanelOpen(name) {
    const { panel } = panelParts(name);
    return Boolean(panel) && panel.hidden === false;
  }

  /**
   * Show one panel and hide every other.
   *
   * @param {string|null} name - a PANEL_NAMES entry, or null to close them all
   */
  function openPanel(name) {
    for (const candidate of PANEL_NAMES) {
      const { panel, toggle } = panelParts(candidate);
      if (!panel) continue;
      const open = candidate === name;
      panel.hidden = !open;
      // The toggle's aria-expanded has to follow, or a screen reader keeps announcing
      // a form that is no longer on the page.
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    if (name !== "shift") selectedShiftId = null;
    return Boolean(name);
  }

  function closePanels() {
    openPanel(null);
  }

  /** Toolbar behaviour: clicking the open panel's own button closes it. */
  function togglePanelByName(name) {
    const open = isPanelOpen(name) ? null : name;
    if (open === "log") prefillLogFromSelection();
    return openPanel(open);
  }

  /**
   * Carry a selected shift into the log form.
   *
   * Exclusivity means opening "Log time" closes the shift detail, so the shift the
   * user was looking at would otherwise be lost. Pre-filling turns that from a
   * downside into the shortcut it should always have been.
   */
  function prefillLogFromSelection() {
    const shift = selectedShift();
    if (!shift) return;
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    };
    set("logStaffId", shift.staffId);
    set("logDate", shift.date);
    set("logShiftId", shift.id);
  }

  /** Fill the member and duty-type selects from the loaded board. */
  function populateSelects() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!board) return;

    const memberOptions = board.crew.nodes
      .filter((member) => !member.orphaned)
      .map((member) => '<option value="' + escape(member.staffId) + '">' + escape(member.name + " " + member.surname) + "</option>")
      .join("");

    // The filter keeps its "Everyone" option; the forms must pick exactly one person.
    const currentFilter = elements.member.value;
    elements.member.innerHTML = '<option value="">Everyone</option>' + memberOptions;
    elements.member.value = currentFilter;

    document.getElementById("assignStaffId").innerHTML = '<option value="">Choose…</option>' + memberOptions;
    document.getElementById("logStaffId").innerHTML = '<option value="">Choose…</option>' + memberOptions;

    const dutyOptions = board.dutyTypes
      .map(
        (duty) =>
          '<option value="' +
          escape(duty.id) +
          '">' +
          escape(duty.name) +
          " (" +
          escape(duty.startTime) +
          "–" +
          escape(duty.endTime) +
          ")</option>",
      )
      .join("");
    document.getElementById("assignDutyTypeId").innerHTML =
      board.dutyTypes.length === 0
        ? '<option value="">No duty types yet — define one first</option>'
        : '<option value="">Choose…</option>' + dutyOptions;

    document.getElementById("dutyRequiredRole").innerHTML = CrewApi.optionsHtml(CrewApi.ROLE_LABELS, {
      placeholder: "No role requirement",
    });

    const shiftOptions = board.shifts
      .filter((shift) => shift.status !== "CANCELLED")
      .map(
        (shift) =>
          '<option value="' +
          escape(shift.id) +
          '">' +
          escape(shift.date) +
          " · " +
          escape(shift.dutyType ? shift.dutyType.name : "shift " + shift.id) +
          "</option>",
      )
      .join("");
    document.getElementById("logShiftId").innerHTML = '<option value="">Standalone work</option>' + shiftOptions;
  }

  function renderBoard() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!board) return;
    const from = value(elements.from);
    const to = value(elements.to);
    const dates = datesInRange(from, to);

    if (dates.length === 0) {
      elements.head.innerHTML = "";
      elements.body.innerHTML = "";
      elements.foot.innerHTML = "";
      elements.empty.hidden = false;
      elements.empty.textContent =
        from && to && from > to ? "The From date is after the To date." : "Choose a date range to see the board.";
      return;
    }

    const selectedMember = elements.member.value;
    const members = boardMembers(board, selectedMember, dates);

    if (members.length === 0) {
      elements.head.innerHTML = "";
      elements.body.innerHTML = "";
      elements.foot.innerHTML = "";
      elements.empty.hidden = false;
      elements.empty.textContent = "No crew match this filter.";
      return;
    }
    elements.empty.hidden = true;

    const { shiftsByCell, key } = indexBoard(board);
    // Every number on the board comes from one pure pass — see computeBoardTotals.
    const totals = computeBoardTotals(board, members, dates);

    elements.head.innerHTML =
      "<tr><th scope='col'>Crew member</th>" +
      dates
        .map((date) => {
          // Day-of-week label, so a week is readable without counting columns.
          const weekday = new Date(date + "T00:00:00.000Z").toUTCString().slice(0, 3);
          return (
            "<th scope='col' class='crew-board__day'>" +
            escape(weekday) +
            "<br /><span class='crew-muted'>" +
            escape(date.slice(5)) +
            "</span></th>"
          );
        })
        .join("") +
      // Named, because "Total" alone left it ambiguous which of the two figures a
      // cell was showing.
      "<th scope='col'>Scheduled<br /><span class='crew-muted'>logged</span></th></tr>";

    elements.body.innerHTML = members
      .map((member) => {
        const cells = dates
          .map((date) => {
            const cellKey = key(member.staffId, date);
            const shifts = shiftsByCell.get(cellKey) || [];
            const cell = totals.perCell.get(cellKey) || { scheduled: 0, logged: 0 };

            const chips = shifts
              .map((shift) => {
                const duty = shift.dutyType;
                const colour = duty && duty.colour ? ' style="border-left-color:' + escape(duty.colour) + '"' : "";
                return (
                  '<button type="button" class="crew-chip crew-chip--' +
                  escape(shift.status.toLowerCase()) +
                  '" data-shift-id="' +
                  escape(shift.id) +
                  '"' +
                  colour +
                  ' title="' +
                  escape(
                    (duty ? duty.name : "Shift") + " · " + CrewApi.labelForShiftStatus(shift.status) + " · " + shift.hours + " h scheduled",
                  ) +
                  '">' +
                  escape(duty ? duty.code : "shift") +
                  ' <span class="crew-chip__hours">' +
                  escape(shift.hours) +
                  "h</span></button>"
                );
              })
              .join("");

            // Logged hours are the bold number; scheduled is already visible on the
            // chips, so it is only repeated here when there is no shift to carry it.
            const logged = cell.logged > 0 ? '<span class="crew-chip-hours">' + escape(cell.logged) + " h logged</span>" : "";
            const scheduledOnly =
              cell.logged === 0 && cell.scheduled === 0 && shifts.length > 0 ? '<span class="crew-muted">cancelled</span>' : "";

            return '<td class="crew-board__cell">' + chips + logged + scheduledOnly + "</td>";
          })
          .join("");

        const memberTotal = totals.perMember.get(String(member.staffId)) || { scheduled: 0, logged: 0 };
        const name = member.orphaned ? "<em>deleted staff record</em>" : escape(member.name + " " + member.surname);
        const role = member.profile
          ? '<br /><span class="crew-muted">' + escape(CrewApi.labelForRole(member.profile.role)) + "</span>"
          : "";

        return (
          '<tr><th scope="row" class="crew-board__member"><a class="crew-link" href="/crew-member.html?staffId=' +
          escape(member.staffId) +
          '">' +
          name +
          "</a>" +
          role +
          "</th>" +
          cells +
          '<td class="crew-board__total">' +
          escape(hoursLabel(memberTotal.scheduled)) +
          '<br /><span class="crew-muted">' +
          escape(hoursLabel(memberTotal.logged)) +
          "</span></td></tr>"
        );
      })
      .join("");

    // Two rows, both carrying their unit. The old single row printed bare numbers
    // for the days and "13.5 h" for the total, which read as a count per day.
    elements.foot.innerHTML =
      '<tr><th scope="row">Scheduled per day</th>' +
      dates.map((date) => '<td class="crew-board__total">' + escape(hoursLabel(totals.perDay.get(date).scheduled)) + "</td>").join("") +
      '<td class="crew-board__total">' +
      escape(hoursLabel(totals.grand.scheduled)) +
      "</td></tr>" +
      '<tr><th scope="row">Logged per day</th>' +
      dates.map((date) => '<td class="crew-board__total">' + escape(hoursLabel(totals.perDay.get(date).logged)) + "</td>").join("") +
      '<td class="crew-board__total">' +
      escape(hoursLabel(totals.grand.logged)) +
      "</td></tr>";

    const rollup = board.workRollup;
    elements.summary.textContent =
      members.length +
      " crew · " +
      dates.length +
      " day(s) · " +
      board.shifts.length +
      " shift(s) · " +
      totals.grand.scheduled +
      " h scheduled · " +
      totals.grand.logged +
      " h logged across " +
      rollup.entries +
      " entr" +
      (rollup.entries === 1 ? "y" : "ies") +
      (rollup.byActivity.length > 0
        ? " · " + rollup.byActivity.map((bucket) => bucket.activity + " " + bucket.hours + " h").join(", ")
        : "");
  }

  async function load() {
    const CrewApi = window.CrewApi;
    const from = value(elements.from);
    const to = value(elements.to);

    if (from && to && from > to) {
      CrewApi.setStatus(elements.status, "error", "The From date is after the To date.");
      renderBoard();
      return;
    }

    const requested = datesInRange(from, to, { limit: Infinity });
    if (requested.length > MAX_RANGE_DAYS) {
      // Said out loud rather than silently truncated: a board that quietly showed
      // the first 120 days of a year would look complete and be wrong.
      CrewApi.setStatus(
        elements.status,
        "error",
        "That range is " + requested.length + " days. Narrow it to " + MAX_RANGE_DAYS + " or fewer.",
      );
      return;
    }

    CrewApi.setStatus(elements.status, "info", "Loading the board…");
    const result = await CrewApi.run(CrewApi.OPERATIONS.WORK_BOARD, {
      from: from || null,
      to: to || null,
      staffId: elements.member.value || null,
    });

    if (!result.ok) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
      return;
    }

    if (!result.data) {
      // 200 with `data: null` happens when a non-null root field fails. There is
      // nothing to render, and the renderer used to discover that by throwing.
      CrewApi.setStatus(elements.status, "error", "Crew Office returned no data for this range.");
      return;
    }

    board = result.data;
    // Drop the tabs whose pillar this build does not have (§10.1).
    if (board.crewInfo) CrewApi.renderModuleTabs(undefined, board.crewInfo.pillars);

    populateSelects();
    renderBoard();
    CrewApi.setStatus(elements.status, "info", "");
  }

  // --- mutations ------------------------------------------------------------

  // Field name → input id per form, so a server `fieldErrors` entry marks the right
  // input. The graph's field names and the DOM ids differ, and guessing would leave
  // some errors invisible.
  const ASSIGN_FIELD_IDS = {
    staffId: "assignStaffId",
    dutyTypeId: "assignDutyTypeId",
    date: "assignDate",
    fieldId: "assignFieldId",
    note: "assignNote",
  };
  const LOG_FIELD_IDS = {
    staffId: "logStaffId",
    date: "logDate",
    hours: "logHours",
    activity: "logActivity",
    shiftId: "logShiftId",
    note: "logNote",
  };
  const DUTY_FIELD_IDS = {
    code: "dutyCode",
    name: "dutyName",
    startTime: "dutyStartTime",
    endTime: "dutyEndTime",
    requiredRole: "dutyRequiredRole",
    colour: "dutyColour",
  };

  /**
   * Client-side rules per form, mirroring the server's own limits.
   *
   * The reason these exist rather than leaning on the graph: a blank required number
   * arrives as `null` for a `Float!`, and the graph answers with a variable-coercion
   * error the client can only describe as "That operation does not match the schema".
   * Accurate about the layer, useless to the person filling in the form.
   */
  function assignRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "staffId", label: "Crew member", value: read("assignStaffId"), required: true },
      { field: "dutyTypeId", label: "Duty type", value: read("assignDutyTypeId"), required: true },
      { field: "date", label: "Date", value: read("assignDate"), required: true, kind: "date" },
      { field: "fieldId", label: "Field id", value: read("assignFieldId"), kind: "integer", min: 1 },
      { field: "note", label: "Note", value: read("assignNote"), maxLength: 200 },
    ];
  }

  function logRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "staffId", label: "Crew member", value: read("logStaffId"), required: true },
      { field: "date", label: "Date", value: read("logDate"), required: true, kind: "date" },
      // The field that started this: blank used to reach the graph as null.
      { field: "hours", label: "Hours", value: read("logHours"), required: true, kind: "number", min: 0.25, max: 24, step: 0.25 },
      { field: "activity", label: "Activity", value: read("logActivity"), required: true, maxLength: 60 },
      { field: "note", label: "Note", value: read("logNote"), maxLength: 200 },
    ];
  }

  function dutyRules() {
    const read = window.CrewApi.readValue;
    return [
      {
        field: "code",
        label: "Code",
        value: read("dutyCode"),
        required: true,
        maxLength: 40,
        pattern: /^[a-z][a-z0-9_]{1,39}$/,
        patternMessage: "Code must be lower_snake_case, 2–40 characters, starting with a letter.",
      },
      { field: "name", label: "Name", value: read("dutyName"), required: true, maxLength: 80 },
      { field: "startTime", label: "Start time", value: read("dutyStartTime"), required: true, kind: "time" },
      { field: "endTime", label: "End time", value: read("dutyEndTime"), required: true, kind: "time" },
      {
        field: "colour",
        label: "Colour",
        value: read("dutyColour"),
        pattern: /^#[0-9a-fA-F]{6}$/,
        patternMessage: "Colour must be a #rrggbb hex value.",
      },
    ];
  }

  /** Shared shape: disable, run, report, refresh. */
  async function submitMutation({ operation, variables, errorsElement, submitButton, onSuccess, successTypename, fieldIds }) {
    const CrewApi = window.CrewApi;
    if (submitButton) submitButton.disabled = true;
    if (fieldIds) CrewApi.clearFieldErrors(fieldIds);
    CrewApi.setStatus(errorsElement, "error", "");

    const result = await CrewApi.run(operation, variables);
    if (submitButton) submitButton.disabled = false;

    if (!result.ok) {
      CrewApi.setStatus(errorsElement, "error", CrewApi.describeErrors(result));
      return null;
    }

    const outcome = result.data[Object.keys(result.data)[0]];
    if (outcome.__typename !== successTypename) {
      // A field-level refusal marks the offending inputs, exactly as the client-side
      // rules do. Everything else — an overlap, a leave conflict, an illegal
      // transition — is a typed union member with its own sentence.
      if (fieldIds && outcome.__typename === "WorkValidationFailed") {
        CrewApi.applyFieldErrors(outcome.fieldErrors || [], fieldIds, errorsElement);
        return null;
      }
      CrewApi.setStatus(errorsElement, "error", CrewApi.describeUnion(outcome));
      return null;
    }

    CrewApi.setStatus(elements.status, "info", CrewApi.describeUnion(outcome));
    if (onSuccess) onSuccess(outcome);
    await load();
    return outcome;
  }

  async function submitAssign(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;

    const problems = CrewApi.validateInput(assignRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, ASSIGN_FIELD_IDS, elements.assignErrors);
      return;
    }

    const fieldId = CrewApi.readValue("assignFieldId");
    const note = CrewApi.readValue("assignNote");

    await submitMutation({
      operation: CrewApi.OPERATIONS.PLAN_SHIFT,
      variables: {
        input: {
          staffId: CrewApi.readValue("assignStaffId"),
          dutyTypeId: CrewApi.readValue("assignDutyTypeId"),
          date: CrewApi.readValue("assignDate"),
          fieldId: fieldId === "" ? null : fieldId,
          note: note === "" ? null : note,
        },
      },
      errorsElement: elements.assignErrors,
      submitButton: elements.assignSubmit,
      successTypename: "ShiftPlanned",
      fieldIds: ASSIGN_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.assignForm.reset();
      },
    });
  }

  async function submitLog(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;

    const problems = CrewApi.validateInput(logRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, LOG_FIELD_IDS, elements.logErrors);
      return;
    }

    const shiftId = CrewApi.readValue("logShiftId");
    const note = CrewApi.readValue("logNote");

    await submitMutation({
      operation: CrewApi.OPERATIONS.LOG_WORK,
      variables: {
        input: {
          staffId: CrewApi.readValue("logStaffId"),
          date: CrewApi.readValue("logDate"),
          // `hours` is Float!. numberOrNull never yields NaN, so a blank field can no
          // longer reach the wire as `null` and come back as a schema error.
          hours: CrewApi.numberOrNull(CrewApi.readValue("logHours")),
          activity: CrewApi.readValue("logActivity"),
          shiftId: shiftId === "" ? null : shiftId,
          note: note === "" ? null : note,
        },
      },
      errorsElement: elements.logErrors,
      submitButton: elements.logSubmit,
      successTypename: "WorkLogged",
      fieldIds: LOG_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.logForm.reset();
      },
    });
  }

  async function submitDuty(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;

    const problems = CrewApi.validateInput(dutyRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, DUTY_FIELD_IDS, elements.dutyErrors);
      return;
    }

    await submitMutation({
      operation: CrewApi.OPERATIONS.DEFINE_DUTY_TYPE,
      variables: {
        input: {
          code: CrewApi.readValue("dutyCode"),
          name: CrewApi.readValue("dutyName"),
          startTime: CrewApi.readValue("dutyStartTime"),
          endTime: CrewApi.readValue("dutyEndTime"),
          requiredRole: CrewApi.readValue("dutyRequiredRole") || null,
          colour: CrewApi.readValue("dutyColour") || null,
        },
      },
      errorsElement: elements.dutyErrors,
      submitButton: elements.dutySubmit,
      successTypename: "DutyTypeDefined",
      fieldIds: DUTY_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.dutyForm.reset();
      },
    });
  }

  // --- the selected shift ---------------------------------------------------

  function selectedShift() {
    if (!board || !selectedShiftId) return null;
    return board.shifts.find((shift) => shift.id === selectedShiftId) || null;
  }

  function renderShiftPanel() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const shift = selectedShift();

    if (!shift) {
      closePanels();
      return;
    }

    const member = board.crew.nodes.find((node) => node.staffId === shift.staffId);
    const entries = (board.workLog || []).filter((entry) => entry.shiftId === shift.id);

    elements.shiftTitle.textContent =
      (shift.dutyType ? shift.dutyType.name : "Shift " + shift.id) +
      " · " +
      shift.date +
      " · " +
      (member ? member.name + " " + member.surname : "");

    elements.shiftDetail.innerHTML =
      '<dl class="crew-fields">' +
      '<div class="crew-field"><dt>Status</dt><dd>' +
      escape(CrewApi.labelForShiftStatus(shift.status)) +
      "</dd></div>" +
      '<div class="crew-field"><dt>Scheduled hours</dt><dd>' +
      escape(shift.hours) +
      " h</dd></div>" +
      '<div class="crew-field"><dt>Field</dt><dd>' +
      (shift.fieldId ? escape(shift.fieldId) : "—") +
      "</dd></div>" +
      '<div class="crew-field"><dt>Note</dt><dd>' +
      (shift.note ? escape(shift.note) : "—") +
      "</dd></div>" +
      (shift.cancelReason ? '<div class="crew-field"><dt>Cancelled because</dt><dd>' + escape(shift.cancelReason) + "</dd></div>" : "") +
      "</dl>" +
      "<h3 class='crew-subhead'>Time logged against this shift</h3>" +
      (entries.length === 0
        ? '<p class="crew-muted">Nothing logged yet.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr><th>Activity</th><th>Hours</th><th>Counts?</th><th>Amend</th></tr></thead><tbody>' +
          entries
            .map(
              (entry) =>
                '<tr class="' +
                (entry.effective ? "" : "crew-row--superseded") +
                '"><td>' +
                escape(entry.activity) +
                "</td><td>" +
                escape(entry.hours) +
                " h</td><td>" +
                (entry.effective ? "counts" : "superseded") +
                "</td><td>" +
                (entry.effective
                  ? '<span class="crew-amend"><input class="crew-input crew-input--inline" type="number" min="0.25" max="24" step="0.25" data-amend-hours="' +
                    escape(entry.id) +
                    '" value="' +
                    escape(entry.hours) +
                    '" aria-label="Corrected hours" />' +
                    '<input class="crew-input crew-input--inline" type="text" maxlength="200" data-amend-reason="' +
                    escape(entry.id) +
                    '" placeholder="Reason" aria-label="Reason for the correction" />' +
                    '<button type="button" class="crew-btn" data-amend-entry="' +
                    escape(entry.id) +
                    '">Amend</button></span>'
                  : "—") +
                "</td></tr>",
            )
            .join("") +
          "</tbody></table></div>");

    // Only offer the moves the lifecycle actually allows, so the UI cannot invite an
    // IllegalShiftTransition.
    elements.confirmShift.hidden = shift.status !== "PLANNED";
    elements.completeShift.hidden = shift.status !== "CONFIRMED";
    const terminal = shift.status === "COMPLETED" || shift.status === "CANCELLED";
    elements.cancelShift.hidden = terminal;
    elements.cancelReason.hidden = terminal;

    // Through the group, so selecting a chip closes whichever form was open.
    openPanel("shift");
    window.CrewApi.setStatus(elements.shiftErrors, "error", "");
  }

  async function transitionSelected(operation, extra) {
    const shift = selectedShift();
    if (!shift) return;

    await submitMutation({
      operation: operation,
      // The version travels with the write, so a shift someone else moved first
      // loses rather than being silently overwritten.
      variables: Object.assign({ shiftId: shift.id, expectedVersion: shift.version }, extra || {}),
      errorsElement: elements.shiftErrors,
      submitButton: null,
      successTypename: "ShiftTransitioned",
      onSuccess: () => {
        if (elements.cancelReason) elements.cancelReason.value = "";
      },
    });
    renderShiftPanel();
  }

  async function amendEntry(entryId) {
    const CrewApi = window.CrewApi;
    const hoursInput = document.querySelector('[data-amend-hours="' + entryId + '"]');
    const reasonInput = document.querySelector('[data-amend-reason="' + entryId + '"]');
    const hours = hoursInput ? hoursInput.value : "";
    const reason = reasonInput ? reasonInput.value.trim() : "";

    // The same rules as the log form, plus the reason that makes the append-only log
    // auditable. Checked here so a blank correction is a sentence about the field
    // rather than a NonEmptyString coercion error from the graph.
    const problems = CrewApi.validateInput([
      { field: "hours", label: "Corrected hours", value: hours, required: true, kind: "number", min: 0.25, max: 24, step: 0.25 },
      { field: "reason", label: "Reason", value: reason, required: true, maxLength: 200 },
    ]);
    if (problems.length > 0) {
      CrewApi.setStatus(elements.shiftErrors, "error", problems.map((problem) => problem.message).join(" "));
      if (problems.some((problem) => problem.field === "reason") && reasonInput) reasonInput.focus();
      return;
    }

    await submitMutation({
      operation: CrewApi.OPERATIONS.AMEND_WORK_LOG,
      variables: { entryId: entryId, hours: CrewApi.numberOrNull(hours), reason: reason },
      errorsElement: elements.shiftErrors,
      submitButton: null,
      successTypename: "WorkLogAmended",
    });
    renderShiftPanel();
  }

  // --- export ---------------------------------------------------------------

  function currentExportRows() {
    if (!board) return [];
    const selectedMember = elements.member.value;
    const members = board.crew.nodes.filter((member) => (selectedMember ? member.staffId === selectedMember : true));
    return exportRows(board, members);
  }

  function downloadCsv() {
    const CrewApi = window.CrewApi;
    const rows = currentExportRows();
    if (rows.length <= 1) {
      CrewApi.setStatus(elements.status, "error", "Nothing to export for this range.");
      return;
    }

    // A BOM so Excel opens UTF-8 correctly — without it, a name with an accent
    // arrives mangled, which is the single most common complaint about CSV exports.
    const blob = new Blob(["﻿" + buildCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "crew-work-" + (value(elements.from) || "all") + "-to-" + (value(elements.to) || "all") + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    CrewApi.setStatus(elements.status, "info", "Exported " + (rows.length - 1) + " row(s).");
  }

  /** PDF via the browser's own print pipeline — see the print rules in crew.css. */
  function printBoard() {
    window.print();
  }

  // --- wiring ---------------------------------------------------------------

  function applyPreset(preset) {
    const range = presetRange(preset, window.CrewApi.todayIso());
    if (!range) return;
    elements.from.value = range.from;
    elements.to.value = range.to;
    load();
  }

  function wire() {
    elements.reload.addEventListener("click", load);
    elements.member.addEventListener("change", load);
    elements.from.addEventListener("change", load);
    elements.to.addEventListener("change", load);
    elements.thisWeek.addEventListener("click", () => applyPreset("week"));
    elements.thisMonth.addEventListener("click", () => applyPreset("month"));

    elements.assignToggle.addEventListener("click", () => togglePanelByName("assign"));
    elements.assignCancel.addEventListener("click", closePanels);
    elements.assignForm.addEventListener("submit", submitAssign);

    elements.logToggle.addEventListener("click", () => togglePanelByName("log"));
    elements.logCancel.addEventListener("click", closePanels);
    elements.logForm.addEventListener("submit", submitLog);

    elements.dutyToggle.addEventListener("click", () => togglePanelByName("duty"));
    elements.dutyCancel.addEventListener("click", closePanels);
    elements.dutyForm.addEventListener("submit", submitDuty);

    elements.exportCsv.addEventListener("click", downloadCsv);
    elements.exportPdf.addEventListener("click", printBoard);

    // Delegated, because the grid is re-rendered on every load.
    elements.body.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-shift-id]");
      if (!chip) return;
      selectedShiftId = chip.getAttribute("data-shift-id");
      // renderShiftPanel opens the shift panel through the group, which closes any
      // form that was up.
      renderShiftPanel();
      elements.shiftPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    elements.shiftDetail.addEventListener("click", (event) => {
      const button = event.target.closest("[data-amend-entry]");
      if (!button) return;
      amendEntry(button.getAttribute("data-amend-entry"));
    });

    elements.confirmShift.addEventListener("click", () => transitionSelected(window.CrewApi.OPERATIONS.CONFIRM_SHIFT));
    elements.completeShift.addEventListener("click", () => transitionSelected(window.CrewApi.OPERATIONS.COMPLETE_SHIFT));
    elements.cancelShift.addEventListener("click", () => {
      const reason = value(elements.cancelReason);
      transitionSelected(window.CrewApi.OPERATIONS.CANCEL_SHIFT, { reason: reason === "" ? null : reason });
    });
    elements.shiftClose.addEventListener("click", closePanels);

    // Escape closes whatever is open, which is what a panel over the board should do.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (PANEL_NAMES.some(isPanelOpen)) closePanels();
    });
  }

  function init() {
    cacheElements();
    if (!window.CrewApi.requireSession()) return;

    // The module tab strip, before any load — present even if the data fails.
    window.CrewApi.renderModuleTabs();

    // Default to this week, and default the two form dates to today.
    const week = presetRange("week", window.CrewApi.todayIso());
    elements.from.value = week.from;
    elements.to.value = week.to;
    document.getElementById("assignDate").value = window.CrewApi.todayIso();
    document.getElementById("logDate").value = window.CrewApi.todayIso();

    wire();
    load();
  }

  // Guarded so this file can be required from Node for its pure helpers.
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
    datesInRange,
    presetRange,
    csvCell,
    buildCsv,
    exportRows,
    indexBoard,
    computeBoardTotals,
    boardMembers,
    openPanel,
    closePanels,
    togglePanelByName,
    isPanelOpen,
    PANEL_NAMES,
    hoursLabel,
    addDays,
    round2,
    MAX_RANGE_DAYS,
  };
});
