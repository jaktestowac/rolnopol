/**
 * Crew roster page controller (PRD §10.1).
 *
 * Renders every owned staff member, with or without an employment profile — a
 * member with `profile: null` is listed on purpose (§17 Q1), because hiding
 * onboarding-in-progress people would make the module lie about who works here.
 *
 * `ENDED` members are hidden by default with an "include past crew" toggle, since
 * Crew Office can never delete anyone and ex-employees therefore accumulate
 * (§8.1.2, §17 Q9). There is deliberately NO delete or remove action anywhere on
 * this page.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewRosterPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const elements = {};
  let lastRoster = null;

  function cacheElements() {
    elements.status = document.getElementById("crewStatus");
    elements.summary = document.getElementById("crewSummary");
    elements.rows = document.getElementById("crewRows");
    elements.empty = document.getElementById("crewEmpty");
    elements.roleFilter = document.getElementById("crewRoleFilter");
    elements.statusFilter = document.getElementById("crewStatusFilter");
    elements.includePast = document.getElementById("crewIncludePast");
    elements.reload = document.getElementById("crewReload");

    elements.hireToggle = document.getElementById("crewHireToggle");
    elements.hirePanel = document.getElementById("crewHirePanel");
    elements.hireForm = document.getElementById("crewHireForm");
    elements.hireErrors = document.getElementById("crewHireErrors");
    elements.hireSubmit = document.getElementById("crewHireSubmit");
    elements.hireCancel = document.getElementById("crewHireCancel");
    elements.hireRole = document.getElementById("hireRole");
    elements.hireEmploymentType = document.getElementById("hireEmploymentType");
    elements.hireStartDate = document.getElementById("hireStartDate");
  }

  /** Build the CrewFilter input from the controls. */
  function currentFilter() {
    const filter = {};
    const role = elements.roleFilter ? elements.roleFilter.value : "";
    const status = elements.statusFilter ? elements.statusFilter.value : "";
    if (role) filter.role = role;
    if (status) filter.status = status;
    return Object.keys(filter).length > 0 ? filter : null;
  }

  /** Past crew is a CLIENT-side hide, so the counts still tell the whole truth. */
  function shouldShow(member) {
    if (elements.includePast && elements.includePast.checked) return true;
    return member.profile === null || member.profile.employmentStatus !== "ENDED";
  }

  function renderRow(member) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const profile = member.profile;

    const name = member.orphaned ? "<em>deleted staff record</em>" : escape(member.name) + " " + escape(member.surname);

    // A profile-less member is not an error state — it is an invitation.
    const roleCell = profile ? escape(CrewApi.labelForRole(profile.role)) : '<span class="crew-muted">no profile yet</span>';

    const statusCell = profile
      ? '<span class="crew-badge crew-badge--' +
        escape(profile.employmentStatus.toLowerCase()) +
        '">' +
        escape(CrewApi.labelForStatus(profile.employmentStatus)) +
        "</span>"
      : '<span class="crew-badge crew-badge--none">—</span>';

    const fteCell = profile ? escape(profile.fte) : "—";
    const tenureCell = profile ? escape(profile.tenureDays) + " d" : "—";
    const fieldsCell = member.assignedFieldIds.length > 0 ? escape(member.assignedFieldIds.join(", ")) : "—";

    return (
      '<tr data-staff-id="' +
      escape(member.staffId) +
      '"' +
      (member.orphaned ? ' class="crew-row--orphaned"' : "") +
      ">" +
      "<td>" +
      name +
      "</td>" +
      "<td>" +
      roleCell +
      "</td>" +
      "<td>" +
      statusCell +
      "</td>" +
      "<td>" +
      fteCell +
      "</td>" +
      "<td>" +
      tenureCell +
      "</td>" +
      "<td>" +
      fieldsCell +
      "</td>" +
      '<td><a class="crew-link" href="/crew-member.html?staffId=' +
      escape(member.staffId) +
      '">Open</a></td>' +
      "</tr>"
    );
  }

  function render(roster) {
    const CrewApi = window.CrewApi;
    const visible = roster.nodes.filter(shouldShow);

    if (elements.summary) {
      const hidden = roster.nodes.length - visible.length;
      elements.summary.textContent =
        visible.length +
        " of " +
        roster.totalCount +
        " crew" +
        (hidden > 0 ? " · " + hidden + " past crew hidden" : "") +
        (roster.hasMore ? " · more available" : "");
    }

    if (elements.rows) {
      elements.rows.innerHTML = visible.map(renderRow).join("");
    }
    if (elements.empty) {
      elements.empty.hidden = visible.length > 0;
    }
    CrewApi.setStatus(elements.status, "info", "");
  }

  async function load() {
    const CrewApi = window.CrewApi;
    CrewApi.setStatus(elements.status, "info", "Loading crew…");

    const result = await CrewApi.run(CrewApi.OPERATIONS.ROSTER, { filter: currentFilter(), first: 200 });

    if (!result.ok) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
      if (elements.rows) elements.rows.innerHTML = "";
      if (elements.empty) elements.empty.hidden = true;
      return;
    }

    // Drop the tabs whose pillar this build does not have (§10.1).
    if (result.data.crewInfo) CrewApi.renderModuleTabs(undefined, result.data.crewInfo.pillars);

    lastRoster = result.data.crew;
    render(lastRoster);
  }

  // --- hiring ---------------------------------------------------------------

  /** Populate the enum selects from the shared label maps, so nothing drifts. */
  function populateHireForm() {
    const CrewApi = window.CrewApi;
    if (elements.hireRole) {
      elements.hireRole.innerHTML = CrewApi.optionsHtml(CrewApi.ROLE_LABELS, { placeholder: "Choose a role…" });
    }
    if (elements.hireEmploymentType) {
      elements.hireEmploymentType.innerHTML = CrewApi.optionsHtml(CrewApi.EMPLOYMENT_TYPE_LABELS, { selected: "PERMANENT" });
    }
    // Default the start date to today — the overwhelmingly common case.
    if (elements.hireStartDate && !elements.hireStartDate.value) {
      elements.hireStartDate.value = CrewApi.todayIso();
    }
  }

  function toggleHirePanel(open) {
    if (!elements.hirePanel || !elements.hireToggle) return;
    const shouldOpen = open === undefined ? elements.hirePanel.hidden : open;
    elements.hirePanel.hidden = !shouldOpen;
    elements.hireToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    if (shouldOpen) {
      populateHireForm();
      const first = document.getElementById("hireName");
      if (first) first.focus();
    } else {
      window.CrewApi.clearFieldErrors(HIRE_FIELD_IDS);
      window.CrewApi.setStatus(elements.hireErrors, "error", "");
    }
  }

  // Field name → input id, so a server `fieldErrors` entry marks the right input.
  const HIRE_FIELD_IDS = {
    name: "hireName",
    surname: "hireSurname",
    age: "hireAge",
    role: "hireRole",
    employmentType: "hireEmploymentType",
    fte: "hireFte",
    contractedHoursPerWeek: "hireHours",
    startDate: "hireStartDate",
  };

  /**
   * The client-side rules, mirroring the server's own limits (§8.1.1).
   *
   * Mirrored rather than trusted-to-the-server because the server's refusal for a
   * BLANK required number is a variable-coercion error, which reads as "That
   * operation does not match the schema" — true, but about the wrong layer.
   */
  function hireRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "name", label: "First name", value: read("hireName"), required: true, maxLength: 100 },
      { field: "surname", label: "Surname", value: read("hireSurname"), required: true, maxLength: 100 },
      { field: "age", label: "Age", value: read("hireAge"), required: true, kind: "integer", min: 16, max: 120 },
      { field: "role", label: "Role", value: read("hireRole"), required: true },
      { field: "employmentType", label: "Employment type", value: read("hireEmploymentType"), required: true },
      { field: "fte", label: "FTE", value: read("hireFte"), required: true, kind: "number", min: 0.1, max: 1, step: 0.1 },
      {
        field: "contractedHoursPerWeek",
        label: "Contracted hours per week",
        value: read("hireHours"),
        kind: "integer",
        min: 1,
        max: 80,
      },
      { field: "startDate", label: "Start date", value: read("hireStartDate"), required: true, kind: "date" },
    ];
  }

  /** Read the form into the shape HireCrewMemberInput expects. Call AFTER validating. */
  function hireInput() {
    const CrewApi = window.CrewApi;
    const read = CrewApi.readValue;

    return {
      name: read("hireName"),
      surname: read("hireSurname"),
      // Numbers, not strings: `age` is Int! and `fte` is Float!. `numberOrNull` never
      // yields NaN, which is what used to reach the wire as `null` from a blank field.
      age: CrewApi.numberOrNull(read("hireAge")),
      role: read("hireRole"),
      employmentType: read("hireEmploymentType"),
      fte: CrewApi.numberOrNull(read("hireFte")),
      contractedHoursPerWeek: CrewApi.numberOrNull(read("hireHours")),
      startDate: read("hireStartDate"),
    };
  }

  async function submitHire(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;

    // Validate first, so a blank or out-of-range field is reported as a field problem
    // rather than as a schema error from the graph.
    const problems = CrewApi.validateInput(hireRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, HIRE_FIELD_IDS, elements.hireErrors);
      return;
    }

    const input = hireInput();
    elements.hireSubmit.disabled = true;
    CrewApi.clearFieldErrors(HIRE_FIELD_IDS);
    CrewApi.setStatus(elements.hireErrors, "error", "");

    const result = await CrewApi.run(CrewApi.OPERATIONS.HIRE, { input: input });
    elements.hireSubmit.disabled = false;

    if (!result.ok) {
      CrewApi.setStatus(elements.hireErrors, "error", CrewApi.describeErrors(result));
      return;
    }

    const outcome = result.data.hireCrewMember;

    // Nothing was written — the server's field errors mark the same inputs the
    // client-side rules would have, so a rejection looks the same either way.
    if (outcome.__typename === "HireValidationFailed") {
      CrewApi.applyFieldErrors(outcome.fieldErrors || [], HIRE_FIELD_IDS, elements.hireErrors);
      return;
    }

    // The staff record exists but the profile write failed. This is a SUCCESS-shaped
    // outcome, not an error (§8.1.1): nothing is rolled back, and the profile can be
    // completed on the member page. Saying "hire failed" here would be a lie that
    // leads someone to hire the same person twice.
    if (outcome.__typename === "CrewMemberHiredWithoutProfile") {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeUnion(outcome));
      toggleHirePanel(false);
      elements.hireForm.reset();
      await load();
      window.location.href = "/crew-member.html?staffId=" + encodeURIComponent(outcome.staffId);
      return;
    }

    CrewApi.setStatus(
      elements.status,
      "info",
      CrewApi.describeUnion(outcome) + " " + input.name + " " + input.surname + " is on the roster.",
    );
    toggleHirePanel(false);
    elements.hireForm.reset();
    await load();
  }

  function wire() {
    if (elements.reload) elements.reload.addEventListener("click", load);
    if (elements.roleFilter) elements.roleFilter.addEventListener("change", load);
    if (elements.statusFilter) elements.statusFilter.addEventListener("change", load);
    // The toggle only changes what is hidden, so it re-renders rather than re-fetches.
    if (elements.includePast) {
      elements.includePast.addEventListener("change", function () {
        if (lastRoster) render(lastRoster);
      });
    }

    if (elements.hireToggle) elements.hireToggle.addEventListener("click", () => toggleHirePanel());
    if (elements.hireCancel) elements.hireCancel.addEventListener("click", () => toggleHirePanel(false));
    if (elements.hireForm) elements.hireForm.addEventListener("submit", submitHire);
  }

  function init() {
    cacheElements();
    // The guard runs BEFORE the first fetch, so an expired session shows a login
    // prompt instead of an empty table (§9.1.4).
    if (!window.CrewApi.requireSession()) return;

    // The module tab strip, before any load — present even if the data fails.
    window.CrewApi.renderModuleTabs();
    wire();
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init, load };
});
