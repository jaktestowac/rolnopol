/**
 * Crew member detail page controller (PRD §10.1).
 *
 * Tabs: Overview · Work · Holidays · Training · Tools. Overview, Work and Training
 * have pillars behind them; the remaining two render an honest "not built yet" panel
 * rather than an empty grid that looks like the person has no holidays and no tools.
 * Each one gets its query when its pillar lands.
 *
 * Work and Training load LAZILY, on first visit to their tab: a rollup, a shift list
 * and a certificate history are real work for the server, and someone opening a
 * member to check their phone number should not pay for them.
 *
 * The Training panel carries the one piece of cross-module UX in this page: when the
 * optional AgriAcademy link is unavailable it says so, in words, and says that the
 * farm's own training records are unaffected. That second half is the point — a
 * blank AgriAcademy column with no explanation reads as "this person's certificates
 * are missing", which would be alarming and false.
 *
 * Tabs are keyboard-navigable with arrow keys and carry the ARIA roles the rest of
 * the app uses (§10.2, accessibility parity).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewMemberPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const elements = {};
  let staffId = null;
  // The member as last read, so the edit form pre-fills from real values and can
  // send the version it was built from.
  let currentMember = null;

  function cacheElements() {
    elements.status = document.getElementById("crewMemberStatus");
    elements.title = document.getElementById("crewMemberTitle");
    elements.overview = document.getElementById("crewMemberOverview");
    elements.tabs = Array.prototype.slice.call(document.querySelectorAll("[data-crew-tab]"));
    elements.panels = Array.prototype.slice.call(document.querySelectorAll("[data-crew-panel]"));
    elements.work = document.getElementById("crewMemberWork");
    elements.leave = document.getElementById("crewMemberLeave");
    elements.training = document.getElementById("crewMemberTraining");

    elements.editToggle = document.getElementById("crewEditToggle");
    elements.editToggleLabel = document.getElementById("crewEditToggleLabel");
    elements.editPanel = document.getElementById("crewEditPanel");
    elements.editForm = document.getElementById("crewEditForm");
    elements.editErrors = document.getElementById("crewEditErrors");
    elements.editSubmit = document.getElementById("crewEditSubmit");
    elements.editCancel = document.getElementById("crewEditCancel");
    elements.editHeading = document.getElementById("crewEditHeading");
  }

  function selectTab(name) {
    elements.tabs.forEach(function (tab) {
      const isActive = tab.getAttribute("data-crew-tab") === name;
      tab.classList.toggle("crew-tab--active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    elements.panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-crew-panel") !== name;
    });

    if (name === "work") loadWork();
    if (name === "leave") loadLeave();
    if (name === "training") loadTraining();
  }

  /**
   * Hide the tabs whose pillar is not assembled (§10.1).
   *
   * Called once `crewInfo` has answered. Overview is always there — it reads the
   * staff record and the profile, and profiles is never absent (§5.2 rule 4). If the
   * tab currently shown disappears, the page falls back to Overview rather than
   * leaving every panel hidden.
   */
  const TAB_PILLARS = { overview: null, work: "work", leave: "leave", training: "training", tools: "tools" };

  function applyPillarTabs(pillars) {
    if (!Array.isArray(pillars)) return;

    let activeWasHidden = false;
    elements.tabs.forEach(function (tab) {
      const name = tab.getAttribute("data-crew-tab");
      const pillar = TAB_PILLARS[name];
      const show = !pillar || pillars.indexOf(pillar) !== -1;
      tab.hidden = !show;
      if (!show && tab.getAttribute("aria-selected") === "true") activeWasHidden = true;
    });

    if (activeWasHidden) selectTab("overview");
  }

  function wireTabs() {
    elements.tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        selectTab(tab.getAttribute("data-crew-tab"));
      });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = elements.tabs[(index + step + elements.tabs.length) % elements.tabs.length];
        next.focus();
        selectTab(next.getAttribute("data-crew-tab"));
      });
    });
  }

  function field(label, value) {
    const escape = window.CrewApi.escapeHtml;
    return (
      '<div class="crew-field"><dt>' +
      escape(label) +
      "</dt><dd>" +
      (value === null || value === undefined || value === "" ? "—" : value) +
      "</dd></div>"
    );
  }

  function renderOverview(member) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const profile = member.profile;

    if (elements.title) {
      elements.title.textContent = member.orphaned ? "Deleted staff record #" + member.staffId : member.name + " " + member.surname;
    }

    const identity = [
      field("Staff id", escape(member.staffId)),
      field("Name", member.orphaned ? "<em>staff record deleted</em>" : escape(member.name)),
      field("Surname", member.orphaned ? "<em>staff record deleted</em>" : escape(member.surname)),
      field("Age", member.age === null ? null : escape(member.age)),
      // Read-only by design: Crew Office displays assignments and never changes them.
      field("Assigned fields", member.assignedFieldIds.length ? escape(member.assignedFieldIds.join(", ")) : null),
    ].join("");

    const employment = profile
      ? [
          field("Role", escape(CrewApi.labelForRole(profile.role))),
          field("Employment type", escape(profile.employmentType)),
          field("FTE", escape(profile.fte)),
          field("Contracted hours / week", profile.contractedHoursPerWeek === null ? null : escape(profile.contractedHoursPerWeek)),
          field("Start date", escape(profile.startDate)),
          field("End date", profile.endDate === null ? null : escape(profile.endDate)),
          field("End reason", profile.endReason === null ? null : escape(profile.endReason)),
          field("Status", escape(CrewApi.labelForStatus(profile.employmentStatus))),
          field("Tenure", escape(profile.tenureDays) + " days"),
          field("Version", escape(profile.version)),
        ].join("")
      : '<p class="crew-muted">No employment profile yet. This is a supported state — the staff record exists and the profile can be added at any time.</p>';

    const orphanNotice = member.orphaned
      ? '<p class="crew-notice crew-notice--warning">This staff record was deleted from the staff page. The crew overlay survived, which is why the row still resolves.</p>'
      : "";

    elements.overview.innerHTML =
      orphanNotice +
      '<h3 class="crew-subhead">Identity <span class="crew-muted">(from the staff record — read-only here)</span></h3>' +
      '<dl class="crew-fields">' +
      identity +
      "</dl>" +
      '<h3 class="crew-subhead">Employment <span class="crew-muted">(the crew overlay)</span></h3>' +
      (profile ? '<dl class="crew-fields">' + employment + "</dl>" : employment);

    CrewApi.setStatus(elements.status, "info", "");
  }

  // --- editing the employment overlay ---------------------------------------

  // Field name → input id, so the server's fieldErrors mark the right inputs.
  const EDIT_FIELD_IDS = {
    role: "editRole",
    employmentType: "editEmploymentType",
    fte: "editFte",
    contractedHoursPerWeek: "editHours",
    startDate: "editStartDate",
    endDate: "editStartDate",
    notes: "editNotes",
  };

  /**
   * Pre-fill the form from the member's current profile.
   *
   * With no profile yet, the form becomes a CREATE form instead — `upsertCrewProfile`
   * handles both, because "this person needs a profile" and "this profile needs
   * correcting" are the same user action: save it.
   */
  function populateEditForm() {
    const CrewApi = window.CrewApi;
    const profile = currentMember && currentMember.profile;

    const setValue = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.value = value === null || value === undefined ? "" : value;
    };

    document.getElementById("editRole").innerHTML = CrewApi.optionsHtml(CrewApi.ROLE_LABELS, {
      selected: profile ? profile.role : undefined,
      placeholder: profile ? undefined : "Choose a role…",
    });
    document.getElementById("editEmploymentType").innerHTML = CrewApi.optionsHtml(CrewApi.EMPLOYMENT_TYPE_LABELS, {
      selected: profile ? profile.employmentType : "PERMANENT",
    });

    setValue("editFte", profile ? profile.fte : 1);
    setValue("editHours", profile ? profile.contractedHoursPerWeek : 40);
    setValue("editStartDate", profile ? profile.startDate : CrewApi.todayIso());
    setValue("editNotes", profile ? profile.notes : "");

    if (elements.editHeading) {
      elements.editHeading.textContent = profile ? "Edit employment" : "Add an employment profile";
    }
  }

  function toggleEditPanel(open) {
    if (!elements.editPanel || !elements.editToggle) return;
    const shouldOpen = open === undefined ? elements.editPanel.hidden : open;
    elements.editPanel.hidden = !shouldOpen;
    elements.editToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    if (shouldOpen) {
      populateEditForm();
      document.getElementById("editRole").focus();
    } else {
      window.CrewApi.clearFieldErrors(EDIT_FIELD_IDS);
      window.CrewApi.setStatus(elements.editErrors, "error", "");
    }
  }

  /** Client-side rules mirroring the server's profile validation. */
  function editRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "role", label: "Role", value: read("editRole"), required: true },
      { field: "employmentType", label: "Employment type", value: read("editEmploymentType"), required: true },
      { field: "fte", label: "FTE", value: read("editFte"), required: true, kind: "number", min: 0.1, max: 1, step: 0.1 },
      {
        field: "contractedHoursPerWeek",
        label: "Contracted hours per week",
        value: read("editHours"),
        kind: "integer",
        min: 1,
        max: 80,
      },
      { field: "startDate", label: "Start date", value: read("editStartDate"), required: true, kind: "date" },
      { field: "notes", label: "Notes", value: read("editNotes"), maxLength: 200 },
    ];
  }

  async function submitEdit(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;
    const read = CrewApi.readValue;

    // Checked here so a blank FTE says "FTE is required" rather than arriving as a
    // variable-coercion error the graph reports as a schema mismatch.
    const problems = CrewApi.validateInput(editRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, EDIT_FIELD_IDS, elements.editErrors);
      return;
    }

    const notes = read("editNotes");
    const input = {
      staffId: staffId,
      role: read("editRole"),
      employmentType: read("editEmploymentType"),
      fte: CrewApi.numberOrNull(read("editFte")),
      contractedHoursPerWeek: CrewApi.numberOrNull(read("editHours")),
      startDate: read("editStartDate"),
      notes: notes === "" ? null : notes,
    };

    // Only send a version when there IS a profile to conflict with — a create has
    // nothing to compare against.
    if (currentMember && currentMember.profile) {
      input.expectedVersion = currentMember.profile.version;
    }

    elements.editSubmit.disabled = true;
    CrewApi.clearFieldErrors(EDIT_FIELD_IDS);
    CrewApi.setStatus(elements.editErrors, "error", "");

    const result = await CrewApi.run(CrewApi.OPERATIONS.UPSERT_PROFILE, { input: input });
    elements.editSubmit.disabled = false;

    if (!result.ok) {
      CrewApi.setStatus(elements.editErrors, "error", CrewApi.describeErrors(result));
      return;
    }

    const outcome = result.data.upsertCrewProfile;

    if (outcome.__typename !== "CrewProfileUpserted") {
      // Validation, not-found and version conflict all land here, each with its own
      // sentence. A version conflict in particular must NOT look like a save.
      if (outcome.__typename === "ProfileValidationFailed") {
        CrewApi.applyFieldErrors(outcome.fieldErrors || [], EDIT_FIELD_IDS, elements.editErrors);
        return;
      }
      CrewApi.setStatus(elements.editErrors, "error", CrewApi.describeUnion(outcome));
      // Re-read so the form is rebuilt against the value that actually won.
      if (outcome.__typename === "VersionConflict") await load();
      return;
    }

    toggleEditPanel(false);
    CrewApi.setStatus(elements.status, "info", CrewApi.describeUnion(outcome));
    await load();
  }

  // --- work tab -------------------------------------------------------------

  let workLoaded = false;

  function renderShiftRow(shift) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const duty = shift.dutyType;

    return (
      "<tr>" +
      "<td>" +
      escape(shift.date) +
      "</td><td>" +
      (duty ? escape(duty.name) + ' <span class="crew-muted">' + escape(duty.startTime) + "–" + escape(duty.endTime) + "</span>" : "—") +
      '</td><td><span class="crew-badge crew-badge--' +
      escape(shift.status.toLowerCase()) +
      '">' +
      escape(CrewApi.labelForShiftStatus(shift.status)) +
      "</span></td><td>" +
      escape(shift.hours) +
      " h</td><td>" +
      (shift.cancelReason ? escape(shift.cancelReason) : "—") +
      "</td></tr>"
    );
  }

  function renderWorkLogRow(entry) {
    const escape = window.CrewApi.escapeHtml;
    // Superseded rows are SHOWN, greyed, with the reason — an append-only log is
    // only useful if the history is visible.
    return (
      '<tr class="' +
      (entry.effective ? "" : "crew-row--superseded") +
      '"><td>' +
      escape(entry.date) +
      "</td><td>" +
      escape(entry.activity) +
      "</td><td>" +
      escape(entry.hours) +
      " h</td><td>" +
      (entry.effective ? '<span class="crew-muted">counts</span>' : '<span class="crew-muted">superseded</span>') +
      "</td><td>" +
      (entry.amendedByReason ? escape(entry.amendedByReason) : "—") +
      "</td></tr>"
    );
  }

  function renderWork(work) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const rollup = work.weeklyRollup;

    const next = work.nextShift
      ? escape(work.nextShift.date) +
        " · " +
        (work.nextShift.dutyType ? escape(work.nextShift.dutyType.name) : "—") +
        " · " +
        escape(CrewApi.labelForShiftStatus(work.nextShift.status))
      : '<span class="crew-muted">nothing scheduled</span>';

    const byActivity =
      rollup.byActivity.length > 0
        ? rollup.byActivity.map((bucket) => escape(bucket.activity) + " " + escape(bucket.hours) + " h").join(" · ")
        : '<span class="crew-muted">no hours logged</span>';

    elements.work.innerHTML =
      '<h3 class="crew-subhead">This week <span class="crew-muted">(' +
      escape(rollup.from) +
      " – " +
      escape(rollup.to) +
      ")</span></h3>" +
      '<dl class="crew-fields">' +
      field("Hours logged", escape(rollup.hours) + " h") +
      field("Entries", escape(rollup.entries)) +
      field("By activity", byActivity) +
      field("Next shift", next) +
      "</dl>" +
      '<h3 class="crew-subhead">Shifts</h3>' +
      (work.shifts.length === 0
        ? '<p class="crew-muted">No shifts on the roster.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Date</th><th>Duty</th><th>Status</th><th>Hours</th><th>Cancelled because</th>" +
          "</tr></thead><tbody>" +
          work.shifts.map(renderShiftRow).join("") +
          "</tbody></table></div>") +
      '<h3 class="crew-subhead">Work log <span class="crew-muted">(corrections append — nothing is overwritten)</span></h3>' +
      (work.workLog.length === 0
        ? '<p class="crew-muted">Nothing logged yet.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Date</th><th>Activity</th><th>Hours</th><th>Counts?</th><th>Amended because</th>" +
          "</tr></thead><tbody>" +
          work.workLog.map(renderWorkLogRow).join("") +
          "</tbody></table></div>");
  }

  /** Fetched on first visit to the tab, then cached for the page's lifetime. */
  async function loadWork() {
    if (workLoaded || !staffId || !elements.work) return;
    const CrewApi = window.CrewApi;
    workLoaded = true;

    elements.work.innerHTML = '<p class="crew-muted">Loading work…</p>';
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_WORK, {
      staffId: staffId,
      weekStarting: CrewApi.mondayOf(CrewApi.todayIso()),
    });

    if (!result.ok || !result.data.crewMember) {
      workLoaded = false; // let a later visit retry
      elements.work.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "Work could not be loaded.") +
        "</p>";
      return;
    }

    const work = result.data.crewMember.work;
    if (!work) {
      // The pillar is not assembled — say so rather than showing an empty roster.
      elements.work.innerHTML = '<p class="crew-notice">The work pillar is not assembled in this build.</p>';
      return;
    }
    renderWork(work);
  }

  // --- holidays tab ---------------------------------------------------------

  let leaveLoaded = false;

  function renderLeaveRequestRow(request) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    // Rejected, cancelled and withdrawn rows are SHOWN, greyed. Nothing is deleted
    // (§6.6), and "why is Marek not off that week after all?" is only answerable if
    // the row and its reason are still visible.
    const spent = ["REQUESTED", "APPROVED"].indexOf(request.status) === -1;

    return (
      '<tr class="' +
      (spent ? "crew-row--superseded" : "") +
      '"><td>' +
      escape(request.from) +
      " – " +
      escape(request.to) +
      (request.halfDayStart || request.halfDayEnd ? ' <span class="crew-muted">(half day)</span>' : "") +
      "</td><td>" +
      escape(CrewApi.labelForLeaveType(request.type)) +
      "</td><td>" +
      escape(request.workingDays) +
      '</td><td><span class="crew-badge crew-badge--' +
      escape(String(request.status).toLowerCase()) +
      '">' +
      escape(CrewApi.labelForLeaveStatus(request.status)) +
      "</span></td><td>" +
      (request.reason ? escape(request.reason) : "—") +
      "</td></tr>"
    );
  }

  function renderLeave(leave) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const balance = leave.balance;
    const next = leave.nextBooked;

    // Only the types that were actually used, so the breakdown does not carry three
    // rows of zeroes for kinds of leave this person has never taken.
    const used = (balance.byType || []).filter((row) => row.taken > 0 || row.booked > 0);
    const byType =
      used.length === 0
        ? '<span class="crew-muted">nothing taken or booked</span>'
        : used
            .map(
              (row) =>
                escape(CrewApi.labelForLeaveType(row.type)) +
                " " +
                escape(row.taken) +
                " taken" +
                (row.booked > 0 ? ", " + escape(row.booked) + " booked" : ""),
            )
            .join(" · ");

    const expiring =
      balance.expiringSoon > 0
        ? escape(balance.expiringSoon) +
          " day(s) expiring" +
          (balance.carryOverExpiresOn ? " on " + escape(balance.carryOverExpiresOn) : "")
        : '<span class="crew-muted">nothing expiring</span>';

    elements.leave.innerHTML =
      '<h3 class="crew-subhead">Leave year ' +
      escape(balance.leaveYear) +
      ' <span class="crew-muted">(' +
      escape(balance.from) +
      " – " +
      escape(balance.to) +
      ")</span></h3>" +
      '<dl class="crew-fields">' +
      field("Entitlement", escape(balance.entitlement) + " days") +
      field("Accrued so far", escape(balance.accrued) + " days") +
      field("Carried over", escape(balance.carriedOver) + " days") +
      field("Taken", escape(balance.taken) + " days") +
      field("Booked", escape(balance.booked) + " days") +
      field(
        "Remaining",
        '<strong class="' +
          // Legally negative: days committed that have not accrued yet. Flagged
          // rather than hidden, with the reason, so it does not look like a bug.
          (balance.remaining < 0 ? "crew-negative" : "") +
          '">' +
          escape(balance.remaining) +
          " days</strong>" +
          (balance.remaining < 0 ? ' <span class="crew-muted">— more booked than accrued so far this year</span>' : ""),
      ) +
      field("Carry-over expiry", expiring) +
      field("By type", byType) +
      field("Next off", next ? escape(next.from) + " – " + escape(next.to) : '<span class="crew-muted">nothing booked</span>') +
      "</dl>" +
      '<h3 class="crew-subhead">Requests <span class="crew-muted">(decided requests are kept — nothing is deleted)</span></h3>' +
      (leave.requests.nodes.length === 0
        ? '<p class="crew-muted">No holiday requested yet.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Dates</th><th>Type</th><th>Days</th><th>Status</th><th>Note / decided because</th>" +
          "</tr></thead><tbody>" +
          leave.requests.nodes.map(renderLeaveRequestRow).join("") +
          "</tbody></table></div>") +
      '<p class="crew-hint crew-no-print">Request, approve and reject holidays on the ' +
      '<a class="crew-link" href="/crew-leave.html">team holidays page</a>.</p>';
  }

  /** Fetched on first visit to the tab, then cached for the page's lifetime. */
  async function loadLeave() {
    if (leaveLoaded || !staffId || !elements.leave) return;
    const CrewApi = window.CrewApi;
    leaveLoaded = true;

    elements.leave.innerHTML = '<p class="crew-muted">Loading holidays…</p>';
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_LEAVE, { staffId: staffId, asOf: CrewApi.todayIso() });

    // `leave` null-propagates with a LEAVE_POLICY_MISSING error when no policy exists
    // (§7.3), so a partial response is expected here rather than a failure — and it
    // has to be told apart from a genuine load error.
    const member = result.data && result.data.crewMember;
    if (!member) {
      leaveLoaded = false; // let a later visit retry
      elements.leave.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "Holidays could not be loaded.") +
        "</p>";
      return;
    }

    if (!member.leave || !member.leave.balance) {
      const policyMissing = (result.errors || []).some((error) => (error.extensions || {}).code === "LEAVE_POLICY_MISSING");
      elements.leave.innerHTML = policyMissing
        ? '<p class="crew-notice crew-notice--warning"><i class="fa-solid fa-triangle-exclamation"></i> ' +
          "No leave policy is configured yet, so this member's balance cannot be computed. " +
          'Set one from the <a class="crew-link" href="/crew-leave.html">team holidays page</a>.</p>'
        : '<p class="crew-notice">The holidays pillar is not assembled in this build.</p>';
      return;
    }
    renderLeave(member.leave);
  }

  // --- training tab ---------------------------------------------------------

  let trainingLoaded = false;

  /**
   * The AgriAcademy banner.
   *
   * Rendered from `CrewApi.academyNotice`, which returns null when there is nothing
   * worth saying — nothing linked, or the link is working. The panel below must show
   * the member's certificates either way: a broken external link is not a reason to
   * hide the farm's own training record, and this notice exists precisely so nobody
   * reads a missing academy column as missing certification.
   */
  function renderAcademyNotice(link) {
    const CrewApi = window.CrewApi;
    const notice = CrewApi.academyNotice(link);
    if (!notice) return "";

    return (
      '<p class="crew-notice crew-notice--' +
      CrewApi.escapeHtml(notice.tone) +
      '" data-academy-state="' +
      CrewApi.escapeHtml(notice.state) +
      '"><i class="fa-solid ' +
      (notice.tone === "warning" ? "fa-triangle-exclamation" : "fa-circle-info") +
      '"></i> ' +
      CrewApi.escapeHtml(notice.message) +
      "</p>"
    );
  }

  function renderCertificationRow(certification) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const course = certification.course || {};
    const status = certification.status;

    // The academy column says WHY it is empty per row, because "—" next to a
    // certificate is ambiguous between "not linked to an exam" and "the link is
    // down". The banner above explains the second case once; this keeps the row
    // itself honest.
    const academy = certification.course && certification.course.academyCertificate;
    const academyCell = academy
      ? escape(academy.examTitle || academy.certificateNo || "linked")
      : course.academyExamId
        ? '<span class="crew-muted">not available</span>'
        : '<span class="crew-muted">—</span>';

    const days =
      certification.daysUntilExpiry === null || certification.daysUntilExpiry === undefined
        ? '<span class="crew-muted">never expires</span>'
        : certification.daysUntilExpiry < 0
          ? escape(Math.abs(certification.daysUntilExpiry)) + " days ago"
          : "in " + escape(certification.daysUntilExpiry) + " days";

    return (
      '<tr class="' +
      (certification.superseded ? "crew-row--superseded" : "") +
      '"><td>' +
      escape(course.name || course.code || "—") +
      "</td><td>" +
      '<span class="crew-badge crew-badge--' +
      escape(String(status).toLowerCase()) +
      '">' +
      escape(CrewApi.labelForCertificationStatus(status)) +
      "</span>" +
      (certification.superseded ? ' <span class="crew-muted">superseded</span>' : "") +
      "</td><td>" +
      escape(certification.issuedOn) +
      "</td><td>" +
      (certification.expiresOn ? escape(certification.expiresOn) + ' <span class="crew-muted">(' + days + ")</span>" : days) +
      "</td><td>" +
      (certification.revokedReason ? escape(certification.revokedReason) : escape(certification.reference || "—")) +
      "</td><td>" +
      academyCell +
      "</td></tr>"
    );
  }

  function renderEnrollmentRow(enrollment) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const course = enrollment.course || {};

    return (
      "<tr><td>" +
      escape(course.name || course.code || "—") +
      '</td><td><span class="crew-badge crew-badge--' +
      escape(String(enrollment.status).toLowerCase()) +
      '">' +
      escape(CrewApi.labelForEnrollmentStatus(enrollment.status)) +
      "</span></td><td>" +
      escape(enrollment.scheduledFor || "—") +
      "</td><td>" +
      escape(enrollment.completedOn || "—") +
      "</td><td>" +
      (enrollment.score === null || enrollment.score === undefined ? "—" : escape(enrollment.score)) +
      "</td></tr>"
    );
  }

  function renderTraining(training, link) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    const gaps =
      training.complianceGaps.length === 0
        ? '<p class="crew-muted">No mandatory course outstanding.</p>'
        : '<ul class="crew-list">' +
          training.complianceGaps
            .map(
              (gap) =>
                "<li><strong>" +
                escape(gap.course.name || gap.course.code) +
                "</strong> — " +
                escape(CrewApi.labelForGapReason(gap.reason)) +
                (gap.role ? ' <span class="crew-muted">(mandatory for ' + escape(CrewApi.labelForRole(gap.role)) + ")</span>" : "") +
                "</li>",
            )
            .join("") +
          "</ul>";

    elements.training.innerHTML =
      renderAcademyNotice(link) +
      '<dl class="crew-fields">' +
      field(
        "Compliance",
        training.compliant
          ? '<span class="crew-badge crew-badge--valid">Up to date</span>'
          : '<span class="crew-badge crew-badge--expired">' + escape(training.complianceGaps.length) + " outstanding</span>",
      ) +
      "</dl>" +
      '<h3 class="crew-subhead">Outstanding mandatory courses</h3>' +
      gaps +
      '<h3 class="crew-subhead">Certificates <span class="crew-muted">(re-certifying keeps the old row — nothing is overwritten)</span></h3>' +
      (training.certifications.length === 0
        ? '<p class="crew-muted">No certificates recorded.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Course</th><th>Status</th><th>Issued</th><th>Expires</th><th>Reference / voided because</th><th>AgriAcademy</th>" +
          "</tr></thead><tbody>" +
          training.certifications.map(renderCertificationRow).join("") +
          "</tbody></table></div>") +
      '<h3 class="crew-subhead">Enrollments</h3>' +
      (training.enrollments.length === 0
        ? '<p class="crew-muted">Not booked on anything.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Course</th><th>Status</th><th>Scheduled</th><th>Completed</th><th>Score</th>" +
          "</tr></thead><tbody>" +
          training.enrollments.map(renderEnrollmentRow).join("") +
          "</tbody></table></div>");
  }

  /** Fetched on first visit to the tab, then cached for the page's lifetime. */
  async function loadTraining() {
    if (trainingLoaded || !staffId || !elements.training) return;
    const CrewApi = window.CrewApi;
    trainingLoaded = true;

    elements.training.innerHTML = '<p class="crew-muted">Loading training…</p>';
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_TRAINING, { staffId: staffId });

    if (!result.ok || !result.data || !result.data.crewMember) {
      trainingLoaded = false; // let a later visit retry
      elements.training.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "Training could not be loaded.") +
        "</p>";
      return;
    }

    const training = result.data.crewMember.training;
    if (!training) {
      // The pillar is not assembled — say so rather than showing an empty record,
      // which would read as "this person has no certificates".
      elements.training.innerHTML = '<p class="crew-notice">The training pillar is not assembled in this build.</p>';
      return;
    }
    renderTraining(training, result.data.academyLink);
  }

  async function load() {
    const CrewApi = window.CrewApi;

    if (!staffId) {
      CrewApi.setStatus(elements.status, "error", "No staffId in the URL. Open a crew member from the roster.");
      return;
    }

    CrewApi.setStatus(elements.status, "info", "Loading crew member…");
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER, { staffId: staffId });

    if (!result.ok) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
      return;
    }

    if (!result.data.crewMember) {
      // Unknown and not-owned are the same answer on purpose (§9) — so the page
      // must not speculate about which one it is.
      CrewApi.setStatus(elements.status, "error", "That crew member could not be found.");
      return;
    }

    currentMember = result.data.crewMember;
    renderOverview(currentMember);
    // Drop the tabs whose pillar this build does not have (§10.1).
    if (result.data.crewInfo) applyPillarTabs(result.data.crewInfo.pillars);

    if (elements.editToggleLabel) {
      elements.editToggleLabel.textContent = currentMember.profile ? "Edit employment" : "Add an employment profile";
    }
    // An orphaned overlay has no staff record to employ, so editing it makes no
    // sense — the row exists only to be reported and cleaned up.
    if (elements.editToggle) elements.editToggle.hidden = currentMember.orphaned;
  }

  function init() {
    cacheElements();
    if (!window.CrewApi.requireSession()) return;
    staffId = window.CrewApi.staffIdFromUrl();
    wireTabs();
    if (elements.editToggle) elements.editToggle.addEventListener("click", () => toggleEditPanel());
    if (elements.editCancel) elements.editCancel.addEventListener("click", () => toggleEditPanel(false));
    if (elements.editForm) elements.editForm.addEventListener("submit", submitEdit);
    selectTab("overview");
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init, load };
});
