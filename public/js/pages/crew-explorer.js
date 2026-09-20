/**
 * Crew Office — GraphQL explorer page controller (PRD §10.1, §10.3).
 *
 * Moved out of an inline `<script>` and into `public/js/pages/` so it matches every
 * other page controller in the repo — same shape, same load order, same ability to
 * be linted and required by a test.
 *
 * The example operations below deliberately come from `CrewApi.OPERATIONS`, the
 * same constants the other pages use. That means the explorer cannot demonstrate a
 * query the app does not actually issue, and the operation set stays enumerable.
 *
 * Beside that dropdown sits a second, differently-purposed list: `examples()`, a
 * LADDER of seven operations ordered easiest-first, one per concept — a bare field,
 * nesting, a variable, an input object, aliases, a fragment across pillars, and
 * finally a mutation whose result is a union. The dropdown answers "what does this
 * app ask for?"; the ladder answers "how do I ask for anything at all?", which is a
 * different question and the one a tester meeting GraphQL has. Each rung is a button
 * rather than another dropdown entry, because a ladder you can see the whole of is
 * the point — rung 7 has to be visibly further along than rung 1.
 *
 * Both lists are validated against the REAL assembled schema by `crew-pages.test.js`,
 * so an example that names a field the schema does not have fails a test rather than
 * teaching somebody a query that cannot run.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewExplorerPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const elements = {};

  /**
   * The seven-rung ladder, easiest first (§10.3).
   *
   * One concept per rung and nothing else new in it, so a rung that fails to run
   * points at one thing. Takes the operation map as an argument rather than reading
   * `window`, which is what lets a Node test validate every rung against the real
   * schema without a DOM.
   *
   * `today` is a parameter for the same reason: rung 6 asks for a balance `asOf` a
   * date, and a hard-coded one would quietly become a lesson about leave years.
   *
   * @param {object} OPERATIONS - CrewApi.OPERATIONS
   * @param {string} [today] - YYYY-MM-DD
   * @returns {Array<{level, label, hint, query, variables}>}
   */
  function examples(OPERATIONS, today) {
    const asOf = today || new Date().toISOString().slice(0, 10);

    return [
      {
        level: 1,
        label: "Crew size",
        hint: "The smallest useful query: one root field, one sub-field, no variables. GraphQL sends back exactly the shape you asked for.",
        query: `query CrewSize {
  crewInfo {
    crewSize
  }
}`,
        variables: {},
      },
      {
        level: 2,
        label: "Roster list",
        hint: "Nesting. `crew` is a connection — counters beside a list of nodes — and you name every field you want. Delete `surname` and run again: it stops coming back.",
        query: `query RosterNames {
  crew {
    totalCount
    hasMore
    nodes {
      staffId
      name
      surname
    }
  }
}`,
        variables: {},
      },
      {
        level: 3,
        label: "A variable",
        hint: "`$first` is declared by the operation and sent as JSON in the variables pane — never spliced into the query text. Change it to 2 and run again without touching the query.",
        query: `query FirstFew($first: Int) {
  crew(first: $first) {
    totalCount
    hasMore
    nodes {
      staffId
      name
      surname
    }
  }
}`,
        variables: { first: 3 },
      },
      {
        level: 4,
        label: "Filter + nested object",
        hint: "A whole input object (`CrewFilter`) as one variable, and a nested object field. Enum values travel as plain strings in JSON — try `MECHANIC`, or drop `status` entirely.",
        query: `query Drivers($filter: CrewFilter) {
  crew(filter: $filter) {
    totalCount
    nodes {
      staffId
      name
      surname
      profile {
        role
        employmentType
        fte
        employmentStatus
        tenureDays
      }
    }
  }
}`,
        variables: { filter: { role: "TRACTOR_DRIVER", status: "ACTIVE" } },
      },
      {
        level: 5,
        label: "Aliases",
        hint: "The same field twice in one request needs aliases, or the two answers would collide. Two slices of the roster plus the module info — one round trip, one consistent snapshot.",
        query: `query TwoSlices($drivers: CrewFilter, $agronomists: CrewFilter) {
  drivers: crew(filter: $drivers) {
    totalCount
    nodes { staffId name surname }
  }
  agronomists: crew(filter: $agronomists) {
    totalCount
    nodes { staffId name surname }
  }
  crewInfo {
    pillars
    serverTime
  }
}`,
        variables: { drivers: { role: "TRACTOR_DRIVER" }, agronomists: { role: "AGRONOMIST" } },
      },
      {
        level: 6,
        label: "Fragment across pillars",
        hint: "A named fragment reused on `CrewMember`, plus every pillar's contribution to one person in a single trip. Watch `extensions.storeReads` and `pillars` under the response. A null member means staffId 1 is not yours — run rung 2 and paste a real one; an id you do not own reads exactly like one that does not exist.",
        query: `query MemberEverything($staffId: ID!, $asOf: Date!) {
  crewMember(staffId: $staffId) {
    ...CrewCard
    work {
      nextShift { id date status hours dutyType { code name } }
    }
    leave {
      balance(asOf: $asOf) { entitlement taken booked remaining }
      nextBooked { id from to type status }
    }
    tools {
      onIssue { id dueBack tool { assetTag name } }
      overdue { id dueBack }
    }
    training {
      compliant
      complianceGaps { reason course { code name } }
    }
  }
}

fragment CrewCard on CrewMember {
  staffId
  name
  surname
  orphaned
  profile { role employmentStatus tenureDays }
}`,
        variables: { staffId: "1", asOf },
      },
      {
        level: 7,
        label: "Mutation + result union",
        hint: "A write, and the hardest shape to read: the result is a union, so you branch on `__typename` and select each member's own fields. A refusal comes back as HTTP 200 data — a named outcome, not an error.",
        // The app's own hire mutation, so the last rung is a real operation rather
        // than a teaching-only one.
        query: OPERATIONS.HIRE.trim(),
        variables: {
          input: {
            name: "Halina",
            surname: "Kowalska",
            age: 34,
            role: "TRACTOR_DRIVER",
            employmentType: "PERMANENT",
            fte: 1,
            contractedHoursPerWeek: 40,
            startDate: "2026-03-01",
          },
        },
      },
    ];
  }

  /** Label → { query, variables }, built from the shared operation constants. */
  function samples() {
    const OPERATIONS = window.CrewApi.OPERATIONS;
    return [
      { label: "Roster with profiles", query: OPERATIONS.ROSTER, variables: { first: 10 } },
      { label: "Module info", query: OPERATIONS.CREW_INFO, variables: {} },
      { label: "One member", query: OPERATIONS.MEMBER, variables: { staffId: "1" } },
      { label: "Orphaned overlays", query: OPERATIONS.ORPHANED_OVERLAYS, variables: {} },
      {
        label: "Hire someone",
        query: OPERATIONS.HIRE,
        variables: {
          input: {
            name: "Halina",
            surname: "Kowalska",
            age: 34,
            role: "TRACTOR_DRIVER",
            employmentType: "PERMANENT",
            fte: 1,
            contractedHoursPerWeek: 40,
            startDate: "2026-03-01",
          },
        },
      },
      {
        label: "End employment (not firing)",
        query: OPERATIONS.END_EMPLOYMENT,
        variables: { staffId: "1", lastDay: "2026-12-31", reason: "season over" },
      },
    ];
  }

  function cacheElements() {
    elements.query = document.getElementById("query");
    elements.variables = document.getElementById("variables");
    elements.response = document.getElementById("response");
    elements.extensions = document.getElementById("extensions");
    elements.status = document.getElementById("status");
    elements.sdl = document.getElementById("sdl");
    elements.samples = document.getElementById("samples");
    elements.runBtn = document.getElementById("runBtn");
    elements.sdlBtn = document.getElementById("sdlBtn");
    elements.exampleButtons = document.getElementById("exampleButtons");
    elements.exampleHint = document.getElementById("exampleHint");
  }

  /** Put an operation and its variables in the editor. */
  function fill(operation) {
    if (!operation) return;
    elements.query.value = operation.query.trim();
    elements.variables.value = JSON.stringify(operation.variables, null, 2);
  }

  function loadSample(index) {
    fill(samples()[index]);
  }

  function populateSamples() {
    samples().forEach(function (sample, index) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = sample.label;
      elements.samples.appendChild(option);
    });
  }

  /**
   * Load rung `index` of the ladder: fill the editor, say what it demonstrates, and
   * mark which rung you are on.
   *
   * The pressed rung is marked with `aria-pressed` rather than a class alone, because
   * "which example am I looking at?" is a question a screen reader has to be able to
   * answer too — the buttons are a toggle group, not seven unrelated actions.
   */
  function loadExample(index) {
    const ladder = examples(window.CrewApi.OPERATIONS, window.CrewApi.todayIso());
    const example = ladder[index];
    if (!example) return;

    fill(example);
    elements.exampleHint.textContent = example.hint;

    const buttons = elements.exampleButtons.querySelectorAll("button");
    buttons.forEach(function (button, position) {
      button.setAttribute("aria-pressed", position === index ? "true" : "false");
    });

    // The dropdown holds a DIFFERENT list, so leaving it showing a stale label would
    // claim the editor contains an operation it does not.
    elements.samples.value = "";
  }

  /** Render the ladder as one small button per rung, easiest first. */
  function renderExamples() {
    const escapeHtml = window.CrewApi.escapeHtml;
    const ladder = examples(window.CrewApi.OPERATIONS, window.CrewApi.todayIso());

    elements.exampleButtons.innerHTML = ladder
      .map(function (example, index) {
        return (
          '<button type="button" class="crew-btn crew-btn--small crew-btn--example" data-example="' +
          index +
          '" aria-pressed="false" title="' +
          escapeHtml(example.hint) +
          '"><span class="crew-example__level" aria-hidden="true">' +
          example.level +
          "</span>" +
          escapeHtml(example.label) +
          "</button>"
        );
      })
      .join("");

    // One listener on the group rather than seven: the buttons are re-rendered as a
    // block, and per-button listeners would have to be re-attached with them.
    elements.exampleButtons.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-example]");
      if (button) loadExample(Number(button.getAttribute("data-example")));
    });
  }

  async function run() {
    const CrewApi = window.CrewApi;

    let variables;
    try {
      variables = elements.variables.value.trim() === "" ? {} : JSON.parse(elements.variables.value);
    } catch (error) {
      CrewApi.setStatus(elements.status, "error", "Variables are not valid JSON: " + error.message);
      return;
    }

    CrewApi.setStatus(elements.status, "info", "Running…");
    elements.extensions.textContent = "";

    // The explorer is the one page that runs arbitrary text rather than a named
    // constant — that is its whole purpose — so it calls `run` with the editor's
    // contents directly.
    const result = await CrewApi.run(elements.query.value, variables);

    elements.response.textContent = JSON.stringify(
      { data: result.data, errors: result.errors, extensions: result.extensions },
      function (key, value) {
        return value === undefined ? undefined : value;
      },
      2,
    );

    // Worth surfacing because it IS the contract: 400 means nothing executed and
    // there is no `data` key at all; 200 with errors is partial success.
    let summary = "HTTP " + result.status;
    if (result.status === 400) summary += " — request error, nothing executed";
    else if (result.errors && result.data !== undefined) summary += " — partial success";
    CrewApi.setStatus(elements.status, result.status >= 400 ? "error" : "info", summary);

    if (result.extensions) {
      elements.extensions.textContent =
        "cost " +
        result.extensions.cost +
        " · depth " +
        result.extensions.depth +
        " · store reads " +
        result.extensions.storeReads +
        " · " +
        result.extensions.durationMs +
        "ms · pillars: " +
        (result.extensions.pillars || []).join(", ");
    }
  }

  async function loadSdl() {
    const CrewApi = window.CrewApi;
    CrewApi.setStatus(elements.status, "info", "Loading schema…");
    const sdl = await CrewApi.fetchSdl();
    if (sdl === null) {
      CrewApi.setStatus(elements.status, "error", "Could not load the schema.");
      return;
    }
    elements.sdl.textContent = sdl;
    CrewApi.setStatus(elements.status, "info", "Schema loaded.");
  }

  function init() {
    cacheElements();
    if (!window.CrewApi.requireSession()) return;

    // The module tab strip, before any load — present even if the data fails.
    window.CrewApi.renderModuleTabs();

    populateSamples();
    renderExamples();
    // Rung 1, not the roster query: an explorer that opens on the simplest possible
    // operation is one you can read before you run it.
    loadExample(0);

    elements.samples.addEventListener("change", function () {
      if (elements.samples.value === "") return;
      loadSample(Number(elements.samples.value));
      // The editor no longer holds a ladder rung, so no rung is current.
      elements.exampleHint.textContent = "";
      elements.exampleButtons.querySelectorAll("button").forEach(function (button) {
        button.setAttribute("aria-pressed", "false");
      });
    });
    elements.runBtn.addEventListener("click", run);
    elements.sdlBtn.addEventListener("click", loadSdl);

    // Ctrl/Cmd+Enter runs, the way every query console does.
    elements.query.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
    });
  }

  // Guarded so the module can be REQUIRED by a Node test — which is what lets
  // `crew-pages.test.js` validate all seven ladder rungs against the real schema.
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  return { init, run, loadSdl, examples, loadExample };
});
