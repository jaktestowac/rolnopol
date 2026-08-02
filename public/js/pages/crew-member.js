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
    elements.tools = document.getElementById("crewMemberTools");
    elements.documents = document.getElementById("crewMemberDocuments");
    elements.previewModal = document.getElementById("documentPreviewModal");
    elements.previewTitle = document.getElementById("documentPreviewTitle");
    elements.previewMeta = document.getElementById("documentPreviewMeta");
    elements.previewBody = document.getElementById("documentPreviewBody");
    elements.previewClose = document.getElementById("documentPreviewClose");

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
    if (name === "tools") loadTools();
    if (name === "documents") loadDocuments();
  }

  /**
   * Hide the tabs whose pillar is not assembled (§10.1).
   *
   * Called once `crewInfo` has answered. Overview is always there — it reads the
   * staff record and the profile, and profiles is never absent (§5.2 rule 4). If the
   * tab currently shown disappears, the page falls back to Overview rather than
   * leaving every panel hidden.
   */
  const TAB_PILLARS = { overview: null, work: "work", leave: "leave", training: "training", tools: "tools", documents: "documents" };

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

  // ── Tools ───────────────────────────────────────────────────────────────────

  let toolsLoaded = false;

  /** `-3` → "3 days overdue", `0` → "due today", `2` → "due in 2 days". */
  function describeDueBack(issuance) {
    const days = Number(issuance.daysUntilDueBack);
    if (issuance.dueBack === null || issuance.dueBack === undefined || !Number.isFinite(days)) {
      return '<span class="crew-muted">no date</span>';
    }
    if (days < 0) return '<span class="crew-badge crew-badge--expired">' + Math.abs(days) + " day(s) overdue</span>";
    if (days === 0) return '<span class="crew-badge crew-badge--pending">due today</span>';
    return '<span class="crew-muted">in ' + days + " day(s)</span>";
  }

  function renderIssuedToolRow(issuance) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const tool = issuance.tool || {};
    // The service state matters here and not only on the registry page: a tool that
    // is out AND due a service is the row somebody has to act on.
    const service =
      tool.serviceStatus && tool.serviceStatus !== "OK"
        ? ' <span class="crew-badge crew-badge--pending">' + escape(CrewApi.labelForServiceStatus(tool.serviceStatus)) + "</span>"
        : "";

    return (
      '<tr data-issuance-id="' +
      escape(issuance.id) +
      '"' +
      (issuance.isOverdueBack ? ' class="crew-row--flagged"' : "") +
      ">" +
      "<td><strong>" +
      escape(tool.assetTag || "—") +
      "</strong> " +
      escape(tool.name || "") +
      service +
      "</td>" +
      "<td>" +
      escape(CrewApi.labelForToolCategory(tool.category)) +
      "</td>" +
      "<td>" +
      escape(issuance.issuedAt || "—") +
      "</td>" +
      "<td>" +
      escape(issuance.dueBack || "—") +
      " " +
      describeDueBack(issuance) +
      "</td>" +
      "<td>" +
      escape(tool.storageLocation || "—") +
      "</td>" +
      "<td>" +
      (issuance.note ? escape(issuance.note) : "—") +
      "</td>" +
      "</tr>"
    );
  }

  function renderToolHistoryRow(issuance) {
    const escape = window.CrewApi.escapeHtml;
    const tool = issuance.tool || {};
    const condition = issuance.conditionOnReturn ? escape(issuance.conditionOnReturn) : '<span class="crew-muted">—</span>';
    return (
      "<tr><td><strong>" +
      escape(tool.assetTag || "—") +
      "</strong> " +
      escape(tool.name || "") +
      "</td><td>" +
      escape(issuance.issuedAt || "—") +
      "</td><td>" +
      // An issuance with no `returnedAt` in the history list is one still out — the
      // history is every issuance, not only the closed ones.
      (issuance.returnedAt ? escape(issuance.returnedAt) : '<span class="crew-muted">still out</span>') +
      "</td><td>" +
      condition +
      "</td><td>" +
      (issuance.returnedLate ? '<span class="crew-badge crew-badge--expired">late</span>' : '<span class="crew-muted">on time</span>') +
      "</td></tr>"
    );
  }

  function renderTools(tools) {
    const escape = window.CrewApi.escapeHtml;

    // Overdue is a SUBSET of onIssue, and the two answer different questions ("what
    // have they got?" and "what is late?"). So it is a notice plus flagged rows,
    // rather than a second table repeating the first.
    const overdueNotice =
      tools.overdue.length === 0
        ? ""
        : '<p class="crew-notice crew-notice--warning" data-testid="tools-overdue">' +
          "<strong>" +
          tools.overdue.length +
          " tool(s) overdue:</strong> " +
          tools.overdue
            .map(function (issuance) {
              const tool = issuance.tool || {};
              return (
                escape((tool.assetTag || "") + " " + (tool.name || "")).trim() +
                " (" +
                Math.abs(Number(issuance.daysUntilDueBack) || 0) +
                "d)"
              );
            })
            .join(", ") +
          "</p>";

    elements.tools.innerHTML =
      overdueNotice +
      '<dl class="crew-fields">' +
      field("Out now", escape(tools.onIssue.length)) +
      field("Overdue", tools.overdue.length === 0 ? '<span class="crew-muted">none</span>' : escape(tools.overdue.length)) +
      "</dl>" +
      '<h3 class="crew-subhead">Out now</h3>' +
      (tools.onIssue.length === 0
        ? '<p class="crew-muted">Nothing issued to this member.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table" data-testid="tools-on-issue"><thead><tr>' +
          "<th>Tool</th><th>Category</th><th>Issued</th><th>Due back</th><th>Kept at</th><th>Note</th>" +
          "</tr></thead><tbody>" +
          tools.onIssue.map(renderIssuedToolRow).join("") +
          "</tbody></table></div>") +
      '<h3 class="crew-subhead">History <span class="crew-muted">(the ledger is append-only — a return stamps the row it closes)</span></h3>' +
      (tools.history.length === 0
        ? '<p class="crew-muted">Nothing issued to this member yet.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table" data-testid="tools-history"><thead><tr>' +
          "<th>Tool</th><th>Issued</th><th>Returned</th><th>Condition</th><th>Timing</th>" +
          "</tr></thead><tbody>" +
          tools.history.map(renderToolHistoryRow).join("") +
          "</tbody></table></div>") +
      '<p class="crew-hint">Issuing and returning happen on the <a href="/crew-tools.html">tools board</a>, where the certification gate and the registry live.</p>';
  }

  /** Fetched on first visit to the tab, then cached for the page's lifetime. */
  async function loadTools() {
    if (toolsLoaded || !staffId || !elements.tools) return;
    const CrewApi = window.CrewApi;
    toolsLoaded = true;

    elements.tools.innerHTML = '<p class="crew-muted">Loading tools…</p>';
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_TOOLS, { staffId: staffId });

    if (!result.ok || !result.data || !result.data.crewMember) {
      toolsLoaded = false; // let a later visit retry
      elements.tools.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "Tools could not be loaded.") +
        "</p>";
      return;
    }

    const tools = result.data.crewMember.tools;
    if (!tools) {
      // The pillar is not assembled — say so rather than showing an empty table,
      // which would read as "this person has no tools out".
      elements.tools.innerHTML = '<p class="crew-notice">The tools pillar is not assembled in this build.</p>';
      return;
    }
    renderTools(tools);
  }

  // ── Documents (#100) ────────────────────────────────────────────────────────

  let documentsLoaded = false;
  // The folder the table was last rendered from, so a preview can resolve an id.
  let currentFolder = null;
  // Whatever had focus when the preview dialog was opened.
  let previewOpener = null;

  const DOCUMENT_STATUS_BADGE = { AVAILABLE: "valid", PENDING: "pending", REJECTED: "expired", MISSING: "missing" };

  /**
   * What a failed document action means, in words a reader can act on.
   *
   * The server sends its own sentence in `error`, and that one wins — it is closer
   * to what actually happened. This map is the fallback, and it exists because the
   * alternative shape of this code is a bare status number in the UI, or worse, the
   * browser navigating to the raw JSON of a 500 because the action was a plain link.
   *
   * `0` is not an HTTP status: it is how `fetch` rejecting is reported below.
   */
  const DOCUMENT_FAILURE_TEXT = {
    0: "Crew Office could not be reached. Check your connection and try again.",
    401: "Your session has expired.",
    403: "Your session has expired.",
    404: "That document is no longer available.",
    409: "This document is still being scanned — try again in a moment.",
    410: "The scan refused this document, so it cannot be opened.",
    500: "This document's contents are missing on the server. The record is intact; the file itself is gone.",
  };

  function describeDocumentFailure(status, body) {
    if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    return DOCUMENT_FAILURE_TEXT[status] || "That document could not be opened (" + status + ").";
  }

  /** Read a failed response's JSON without letting a non-JSON body throw. */
  async function failureBodyOf(res) {
    try {
      return await res.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Report a document action that failed, and re-read the folder.
   *
   * The refresh is the useful half: the row that just failed is almost always a row
   * whose status has moved on — the scan finished, or the bytes went missing — and
   * re-reading turns the table into an explanation instead of leaving a button that
   * will fail the same way next time.
   */
  async function reportDocumentFailure(message) {
    // Refresh FIRST, then write the message. The refresh re-renders the panel — and
    // the status line lives inside it, so a message written beforehand is wiped by
    // the very re-render that was supposed to explain it.
    await refreshDocuments();
    const status = window.document.getElementById("documentActionStatus");
    if (status) window.CrewApi.setStatus(status, "error", message);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(2) + " MB";
  }

  function renderDocumentRow(document) {
    const escape = window.CrewApi.escapeHtml;
    const badge = DOCUMENT_STATUS_BADGE[document.status] || "pending";
    // A PENDING or REJECTED document has no link at all rather than a dead one:
    // the download route would answer 409 or 410, and a link that reliably fails
    // is worse than no link.
    //
    // Preview is offered only when the SERVER said the type is previewable — the
    // page never decides that for itself, or it would be a second copy of the
    // allow-list, drifting.
    const preview =
      document.status === "AVAILABLE" && document.previewable
        ? '<button type="button" class="crew-btn crew-btn--small" data-preview-document="' +
          escape(document.id) +
          '" data-testid="document-preview">Preview</button> '
        : "";
    // Download is a BUTTON, not an <a download>. A link hands the response to the
    // browser, so a 500 becomes either a downloaded blob of JSON or a page of raw
    // error text — the page never finds out and cannot say anything useful. The
    // button fetches, checks, and reports.
    const unavailable =
      document.status === "PENDING"
        ? "scanning…"
        : document.status === "MISSING"
          ? "contents missing"
          : escape(document.scanDetail || "refused");
    const action =
      document.status === "AVAILABLE"
        ? preview +
          '<button type="button" class="crew-btn crew-btn--small" data-download-document="' +
          escape(document.id) +
          '" data-testid="document-download">Download</button>'
        : '<span class="crew-muted">' + unavailable + "</span>";

    return (
      '<tr data-document-id="' +
      escape(document.id) +
      '" data-status="' +
      escape(document.status) +
      '" data-testid="document-row">' +
      "<td>" +
      escape(document.filename) +
      "</td>" +
      "<td>" +
      escape(document.kind) +
      "</td>" +
      "<td>" +
      escape(formatBytes(document.sizeBytes)) +
      "</td>" +
      '<td><span class="crew-badge crew-badge--' +
      badge +
      '">' +
      escape(document.status) +
      "</span></td>" +
      "<td>" +
      escape(
        String(document.uploadedAt || "")
          .slice(0, 19)
          .replace("T", " "),
      ) +
      "</td>" +
      "<td>" +
      action +
      "</td>" +
      "</tr>"
    );
  }

  function renderDocuments(folder, outcome) {
    const escape = window.CrewApi.escapeHtml;
    // Kept so the preview can look a document up by id without re-querying — the
    // rows the table was built from are exactly the rows a preview can open.
    currentFolder = folder;

    // Both halves of a partial success, always. A page that only listed what was
    // accepted would leave a user certain they had uploaded five files.
    const rejectedMarkup =
      outcome && outcome.rejected && outcome.rejected.length
        ? '<div class="crew-notice crew-notice--warning" data-testid="document-rejections">' +
          "<strong>" +
          outcome.rejected.length +
          ' file(s) were not accepted:</strong><ul class="crew-list">' +
          outcome.rejected.map((row) => "<li><strong>" + escape(row.filename) + "</strong> — " + escape(row.reason) + "</li>").join("") +
          "</ul></div>"
        : "";

    const acceptedMarkup =
      outcome && outcome.accepted && outcome.accepted.length
        ? '<p class="crew-notice crew-notice--ok" data-testid="document-accepted">' +
          outcome.accepted.length +
          " file(s) filed. They stay <strong>PENDING</strong> until the scan finishes." +
          "</p>"
        : "";

    elements.documents.innerHTML =
      '<form id="documentUploadForm" class="crew-form" enctype="multipart/form-data">' +
      '<h3 class="crew-subhead">Attach a document</h3>' +
      '<div class="crew-field">' +
      '<label class="crew-label" for="documentKind">Kind</label>' +
      '<select id="documentKind" class="crew-select">' +
      ["CONTRACT", "CERTIFICATE", "LICENCE", "IDENTITY", "OTHER"].map((k) => '<option value="' + k + '">' + k + "</option>").join("") +
      "</select>" +
      "</div>" +
      '<div class="crew-field">' +
      '<label class="crew-label" for="documentFiles">Files</label>' +
      '<input id="documentFiles" class="crew-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" data-testid="document-files" />' +
      '<p class="crew-hint">Up to 5 files, 1 MB each. PDF, PNG, JPG, TXT or CSV.</p>' +
      "</div>" +
      '<div class="crew-form-actions">' +
      '<button id="documentUploadSubmit" class="crew-btn crew-btn--primary" type="submit"><i class="fa-solid fa-upload"></i> Upload</button>' +
      "</div>" +
      '<p id="documentUploadStatus" class="crew-status" role="status" aria-live="polite"></p>' +
      "</form>" +
      acceptedMarkup +
      rejectedMarkup +
      '<p id="documentActionStatus" class="crew-status" role="status" aria-live="polite"></p>' +
      '<h3 class="crew-subhead">Personnel file <span class="crew-muted">(' +
      folder.totalCount +
      " document(s), " +
      escape(formatBytes(folder.totalBytes)) +
      ")</span></h3>" +
      (folder.items.length === 0
        ? '<p class="crew-muted">Nothing filed yet.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table" data-testid="document-table"><thead><tr>' +
          "<th>File</th><th>Kind</th><th>Size</th><th>Status</th><th>Uploaded</th><th></th>" +
          "</tr></thead><tbody>" +
          folder.items.map(renderDocumentRow).join("") +
          "</tbody></table></div>");

    wireDocumentForm();
  }

  function wireDocumentForm() {
    const form = document.getElementById("documentUploadForm");
    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        await submitDocuments();
      });
    }

    // Delegated, so the Preview buttons keep working across every re-render of the
    // table without being re-attached row by row.
    const panel = elements.documents;
    if (panel && !panel.dataset.previewWired) {
      panel.dataset.previewWired = "true";
      panel.addEventListener("click", function (event) {
        const preview = event.target.closest("[data-preview-document]");
        if (preview) {
          event.preventDefault();
          openDocumentPreview(preview.getAttribute("data-preview-document"));
          return;
        }
        const download = event.target.closest("[data-download-document]");
        if (download) {
          event.preventDefault();
          downloadDocument(download.getAttribute("data-download-document"), download);
        }
      });
    }
  }

  /**
   * Fetch a document and hand it to the browser as a save, reporting any failure.
   *
   * Doing this by hand rather than with `<a download>` costs a few lines and buys
   * the only thing that matters here: the page sees the status. A link cannot —
   * a 500 leaves the browser showing raw JSON and the app none the wiser.
   *
   * The object URL is revoked in a `finally`, because a blob that is never revoked
   * keeps the whole file in memory for the life of the tab.
   */
  async function downloadDocument(documentId, trigger) {
    const item = (currentFolder && currentFolder.items ? currentFolder.items : []).find(function (row) {
      return String(row.id) === String(documentId);
    });
    if (!item) return;

    if (trigger) trigger.disabled = true;
    let url = null;
    try {
      const res = await fetch(item.downloadPath, { credentials: "same-origin" });
      if (!res.ok) {
        await reportDocumentFailure(describeDocumentFailure(res.status, await failureBodyOf(res)));
        return;
      }
      url = URL.createObjectURL(await res.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      // The server sent a Content-Disposition filename, but a blob URL does not
      // carry it — so the name comes from the record the row was drawn from.
      anchor.download = item.filename;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      const status = window.document.getElementById("documentActionStatus");
      if (status) window.CrewApi.setStatus(status, "success", "Downloaded " + item.filename + ".");
    } catch (error) {
      await reportDocumentFailure(describeDocumentFailure(0, null));
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (trigger) trigger.disabled = false;
    }
  }

  /**
   * Wire the preview dialog once, at init.
   *
   * Separate from `wireDocumentForm` because the dialog is not part of the panel:
   * it is declared in the page, it outlives every re-render, and it therefore needs
   * wiring exactly once rather than each time the table is rebuilt.
   */
  function wireDocumentPreview() {
    const modal = elements.previewModal;
    if (!modal) return;

    if (elements.previewClose) elements.previewClose.addEventListener("click", closeDocumentPreview);

    // Clicking the backdrop — the dialog element itself, not its content box.
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeDocumentPreview();
    });

    document.addEventListener("keydown", function (event) {
      if (!isPreviewOpen()) return;
      if (event.key === "Escape") {
        closeDocumentPreview();
        return;
      }
      if (event.key === "Tab") trapPreviewFocus(event);
    });
  }

  function isPreviewOpen() {
    return Boolean(elements.previewModal) && elements.previewModal.hidden === false;
  }

  /**
   * Keep Tab inside the dialog while it is open.
   *
   * `aria-modal="true"` CLAIMS the rest of the page is inert; without a trap that
   * claim is a lie, and a keyboard user tabs out of the dialog into a table they
   * cannot see and cannot get back from. The elements are re-read on every Tab
   * rather than cached, because the body's contents change with the document type.
   */
  function trapPreviewFocus(event) {
    const focusable = elements.previewModal.querySelectorAll(
      'a[href], button:not([disabled]), iframe, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !elements.previewModal.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ── Preview ─────────────────────────────────────────────────────────────────
  //
  // Three renderers, because "preview" means something different per type and a
  // single <iframe> for all of them would be the lazy answer: an image in a frame
  // loses its sizing, and a text file in a frame cannot be read by the page (or by
  // a test) without reaching across a document boundary for no reason.
  //
  //   image/*      <img>, straightforwardly
  //   application/pdf  <iframe>, because the PDF viewer IS a browser feature and
  //                    there is no way to render one otherwise. `sandbox` is left
  //                    off deliberately — Chrome's viewer needs same-origin to
  //                    load, and the response carries its own CSP instead.
  //   text/*       fetched and inserted as escaped text, so the bytes are visible
  //                to the page and a test can assert on them directly.

  function previewFrameFor(document) {
    const escape = window.CrewApi.escapeHtml;
    const type = String(document.contentType || "");
    const src = escape(document.previewPath);

    if (type.indexOf("image/") === 0) {
      return '<img class="crew-preview__image" src="' + src + '" alt="' + escape(document.filename) + '" data-testid="preview-image" />';
    }
    if (type === "application/pdf") {
      return (
        '<iframe class="crew-preview__frame" src="' +
        src +
        '" title="' +
        escape(document.filename) +
        '" data-testid="preview-frame"></iframe>'
      );
    }
    return '<pre class="crew-preview__text" data-testid="preview-text">Loading…</pre>';
  }

  async function fillTextPreview(document) {
    const target = window.document.querySelector('[data-testid="preview-text"]');
    if (!target) return;
    try {
      const res = await fetch(document.previewPath, { credentials: "same-origin" });
      if (!res.ok) {
        showPreviewProblem(describeDocumentFailure(res.status, await failureBodyOf(res)));
        refreshDocuments();
        return;
      }
      // `textContent`, never innerHTML. The bytes are whatever somebody uploaded,
      // and the whole reason text/* is previewable is that it is treated as text
      // at every step — including this one.
      target.textContent = await res.text();
    } catch (error) {
      showPreviewProblem(describeDocumentFailure(0, null));
    }
  }

  async function openDocumentPreview(documentId) {
    const modal = elements.previewModal;
    const body = elements.previewBody;
    const item = (currentFolder && currentFolder.items ? currentFolder.items : []).find(function (row) {
      return String(row.id) === String(documentId);
    });
    if (!modal || !body || !item || !item.previewPath) return;

    // Remembered before anything is focused, so closing can put the caret back on
    // the Preview button that opened this — a keyboard user dropped at the top of
    // the document has no idea what they just closed.
    previewOpener = document.activeElement;

    if (elements.previewTitle) elements.previewTitle.textContent = item.filename;
    if (elements.previewMeta) {
      elements.previewMeta.textContent = item.contentType + " · " + formatBytes(item.sizeBytes);
    }
    body.innerHTML = '<p class="crew-muted crew-preview__notice" data-testid="preview-loading">Opening…</p>';
    modal.hidden = false;
    modal.setAttribute("data-document-id", String(item.id));
    if (elements.previewClose) elements.previewClose.focus();

    // Ask BEFORE rendering. An <img> whose src 404s shows a broken-image glyph and
    // says nothing; an <iframe> renders the error JSON as if it were the document.
    // A HEAD costs one round trip and no body, and gives the dialog something true
    // to say instead.
    let probe;
    try {
      probe = await fetch(item.previewPath, { method: "HEAD", credentials: "same-origin" });
    } catch (error) {
      showPreviewProblem(describeDocumentFailure(0, null));
      return;
    }
    if (!probe.ok) {
      // No body on a HEAD, so the status carries the whole message here.
      showPreviewProblem(describeDocumentFailure(probe.status, null));
      // The row that offered this preview is out of date — say so in the table too.
      refreshDocuments();
      return;
    }
    // Still the document the dialog was opened for? A slow probe and a fast Close
    // would otherwise paint a preview into a dialog the reader has already dismissed.
    if (modal.hidden || modal.getAttribute("data-document-id") !== String(item.id)) return;

    body.innerHTML = previewFrameFor(item);

    // The backstop for a file that disappears between the probe and the render.
    // Wired here rather than as an `onerror` attribute: attribute JS is a string
    // the CSP-minded reader has to audit, and this is a listener.
    const image = body.querySelector('[data-testid="preview-image"]');
    if (image) {
      image.addEventListener("error", function () {
        showPreviewProblem("This image could not be loaded.");
      });
    }

    if (String(item.contentType || "").indexOf("text/") === 0) fillTextPreview(item);
  }

  /** Replace the dialog's contents with a readable explanation. */
  function showPreviewProblem(message) {
    if (!elements.previewBody) return;
    elements.previewBody.innerHTML = '<p class="crew-notice crew-notice--warning crew-preview__notice" data-testid="preview-problem"></p>';
    // textContent, so a server message can never be markup.
    elements.previewBody.querySelector('[data-testid="preview-problem"]').textContent = message;
  }

  function closeDocumentPreview() {
    const modal = elements.previewModal;
    if (!modal || modal.hidden) return;

    modal.hidden = true;
    modal.removeAttribute("data-document-id");
    // Emptied, not just hidden: an <iframe> left in the DOM keeps the document
    // loaded and the request alive, and a closed preview should stop holding
    // somebody's contract open.
    if (elements.previewBody) elements.previewBody.innerHTML = "";

    if (previewOpener && typeof previewOpener.focus === "function") previewOpener.focus();
    previewOpener = null;
  }

  async function submitDocuments() {
    const CrewApi = window.CrewApi;
    const input = document.getElementById("documentFiles");
    const kind = document.getElementById("documentKind");
    const status = document.getElementById("documentUploadStatus");
    const submit = document.getElementById("documentUploadSubmit");
    const chosen = input && input.files ? Array.prototype.slice.call(input.files) : [];

    if (chosen.length === 0) {
      CrewApi.setStatus(status, "error", "Choose at least one file.");
      return;
    }

    submit.disabled = true;
    CrewApi.setStatus(status, "info", "Uploading " + chosen.length + " file(s)…");

    // The variables carry `null` at each file position; `CrewApi.upload` builds the
    // `map` that fills them. Keeping the placeholders here rather than inside the
    // helper is what makes the spec visible at the call site.
    const result = await CrewApi.upload(
      CrewApi.OPERATIONS.UPLOAD_DOCUMENTS,
      { input: { staffId: staffId, kind: kind.value, files: chosen.map(() => null) } },
      chosen.map((file, index) => ({ path: "variables.input.files." + index, file: file })),
    );

    submit.disabled = false;

    if (!result.ok || !result.data || !result.data.uploadCrewDocuments) {
      CrewApi.setStatus(status, "error", CrewApi.describeErrors(result) || "The upload failed.");
      return;
    }

    const outcome = result.data.uploadCrewDocuments;
    input.value = "";
    renderDocuments(outcome.folder, outcome);
    CrewApi.setStatus(
      document.getElementById("documentUploadStatus"),
      outcome.rejected.length ? "warning" : "success",
      outcome.accepted.length + " filed, " + outcome.rejected.length + " refused.",
    );
  }

  /**
   * Re-read the folder after something went wrong with a document.
   *
   * Separate from `loadDocuments` only because that one is guarded to run once per
   * page; a failure is exactly when the table is most likely to be out of date.
   */
  async function refreshDocuments() {
    if (!staffId || !elements.documents) return;
    const CrewApi = window.CrewApi;
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_DOCUMENTS, { staffId: staffId });
    if (!result.ok || !result.data || !result.data.crewMember || !result.data.crewMember.documents) return;
    renderDocuments(result.data.crewMember.documents, null);
  }

  /** Fetched on first visit to the tab; re-rendered in place after every upload. */
  async function loadDocuments() {
    if (documentsLoaded || !staffId || !elements.documents) return;
    const CrewApi = window.CrewApi;
    documentsLoaded = true;

    elements.documents.innerHTML = '<p class="crew-muted">Loading documents…</p>';
    const result = await CrewApi.run(CrewApi.OPERATIONS.MEMBER_DOCUMENTS, { staffId: staffId });

    if (!result.ok || !result.data || !result.data.crewMember) {
      documentsLoaded = false; // let a later visit retry
      elements.documents.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "Documents could not be loaded.") +
        "</p>";
      return;
    }

    const folder = result.data.crewMember.documents;
    if (!folder) {
      elements.documents.innerHTML = '<p class="crew-notice">The documents pillar is not assembled in this build.</p>';
      return;
    }
    renderDocuments(folder, null);
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
    // The dialog lives in the page, not in a panel, so it is wired once here rather
    // than every time the documents table is rebuilt.
    wireDocumentPreview();
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
