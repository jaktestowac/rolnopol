import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
const fs = require("fs");
const path = require("path");

// Crew Office frontend contract — Phase 2B.
//
// Three things are asserted, and the third is the one that earns its keep:
//
//   1. every crew page uses the app's shell (nav + footer includes, the standard
//      script list, `initNavigation`), so it cannot drift into a bespoke page;
//   2. the nav link is flag-gated AND logged-in-only, which is unusual and
//      therefore easy to regress (§9.1);
//   3. **every operation the pages can issue validates against the real assembled
//      schema.** `crew-api.js` is the only place a query may be written, so this
//      turns a typo'd field into a failing test rather than a broken page in a
//      browser — the check PRD Phase 7 asks for, cheap enough to have now.
const { app, getFlags, setCrewEnabled, restoreFlags, tokenFor } = require("./helpers/crew-harness");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PAGES = [
  { file: "crew.html", controller: "crew.js" },
  { file: "crew-member.html", controller: "crew-member.js" },
  { file: "crew-work.html", controller: "crew-work.js" },
  { file: "crew-leave.html", controller: "crew-leave.js" },
  { file: "crew-tools.html", controller: "crew-tools.js" },
  { file: "crew-explorer.html", controller: "crew-explorer.js" },
];

const readPage = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
const readScript = (file) => fs.readFileSync(path.join(PUBLIC_DIR, "js", "pages", file), "utf8");

describe("Crew Office pages — the app shell", () => {
  let originalFlags;
  let token;

  beforeAll(async () => {
    originalFlags = await getFlags();
    token = tokenFor(1);
    await setCrewEnabled(true);
  });

  afterAll(async () => {
    await restoreFlags(originalFlags);
  });

  it.each(PAGES)("$file carries the navbar and footer includes", async ({ file }) => {
    const html = readPage(file);
    expect(html).toContain('<div id="header-component"></div>');
    expect(html).toContain('<div id="footer-component"></div>');
  });

  it.each(PAGES)("$file loads the standard script set and its own controller", async ({ file, controller }) => {
    const html = readPage(file);
    // The shared plumbing every page in this app depends on.
    for (const src of [
      "/js/core/app.js",
      "/js/services/auth-service.js",
      "/js/services/feature-flags-service.js",
      "/js/components.js",
      "/js/api.js",
      "/js/utils/init-navigation.js",
    ]) {
      expect(html, `${file} is missing ${src}`).toContain(src);
    }
    expect(html).toContain("/js/pages/crew-api.js");
    expect(html).toContain(`/js/pages/${controller}`);
    // One nav key for all crew pages, so they all highlight the single Crew link.
    expect(html).toMatch(/initNavigation\("crew"\)/);
  });

  it.each(PAGES)("$file is served with the flag on and a session, and is scoped to .crew-page", async ({ file }) => {
    const res = await request(app).get(`/${file}`).set("Cookie", `rolnopolToken=${token}`).expect(200);
    expect(res.text).toContain('class="crew-page');
    expect(res.text).toContain("/css/pages/crew.css");
  });

  it("no crew page loads a stylesheet or script of another module", () => {
    // The scoped-stylesheet rule (§10.2): crew.css and nothing else page-specific.
    for (const { file } of PAGES) {
      const html = readPage(file);
      const pageStyles = [...html.matchAll(/href="\/css\/pages\/([^"]+)"/g)].map((match) => match[1]);
      expect(pageStyles).toEqual(["crew.css"]);
    }
  });

  it("adds no new CDN beyond the Font Awesome the whole app already uses", () => {
    for (const { file } of PAGES) {
      const html = readPage(file);
      const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
      for (const url of external) {
        expect(url, `${file} pulls in ${url}`).toMatch(/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome/);
      }
    }
  });

  it("declares no inline page script — controllers live in js/pages/ like every other page", () => {
    for (const { file } of PAGES) {
      const html = readPage(file);
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1].trim());
      // The only inline script permitted is the initNavigation bootstrap.
      for (const body of inline) {
        expect(body, `${file} has an inline script`).toMatch(/^initNavigation\("crew"\);$/);
      }
    }
  });
});

describe("Crew Office role assignment (Phase 3B)", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");

  describe("hiring", () => {
    const html = readPage("crew.html");
    const controller = readScript("crew.js");

    it("offers a hire action on the roster, as §10.1 requires", () => {
      expect(html).toContain('id="crewHireToggle"');
      expect(html).toMatch(/Hire crew member/);
      expect(html).toContain('id="crewHireForm"');
    });

    it("collects a role, and every other field HireCrewMemberInput requires", () => {
      // Role is the field everything else joins on, so its absence would make the
      // whole hire useless — hence a named assertion rather than a loop alone.
      expect(html).toContain('id="hireRole"');
      for (const id of ["hireName", "hireSurname", "hireAge", "hireEmploymentType", "hireFte", "hireStartDate"]) {
        expect(html, `hire form is missing ${id}`).toContain(`id="${id}"`);
      }
    });

    it("validates before sending, so a blank field is a field error and not a schema error", () => {
      // The regression: a blank required number reached the graph as `null` for a
      // `Float!`, and the client could only report "That operation does not match the
      // schema". Every form now checks its own rules first.
      expect(controller).toMatch(/validateInput\(hireRules\(\)\)/);
      expect(controller).toMatch(/applyFieldErrors\(problems, HIRE_FIELD_IDS/);
    });

    it("declares a rule for every field HireCrewMemberInput requires", () => {
      const rules = controller.slice(controller.indexOf("function hireRules"), controller.indexOf("function hireInput"));
      for (const field of ["name", "surname", "age", "role", "employmentType", "fte", "startDate"]) {
        expect(rules, `no rule for ${field}`).toContain('field: "' + field + '"');
      }
      // Age is Int! and FTE is Float! with a documented range — mirrored here so the
      // message names the field instead of the transport.
      expect(rules).toMatch(/kind: "integer", min: 16, max: 120/);
      expect(rules).toMatch(/kind: "number", min: 0\.1, max: 1, step: 0\.1/);
    });

    it("never lets NaN reach the wire", () => {
      // `Number("")` is NaN and `JSON.stringify(NaN)` is `null` — the exact path that
      // produced the schema error. `numberOrNull` cannot return NaN.
      const input = controller.slice(controller.indexOf("function hireInput"), controller.indexOf("async function submitHire"));
      expect(input).toMatch(/numberOrNull\(/);
      expect(input).not.toMatch(/Number\(read\(/);
    });

    it("marks the same inputs for a server-side rejection as for a client-side one", () => {
      expect(controller).toMatch(/applyFieldErrors\(outcome\.fieldErrors \|\| \[\], HIRE_FIELD_IDS/);
    });

    it("handles all three hire outcomes, and treats partial success as success", () => {
      // §8.1.1: a staff record with no profile is NOT a failed hire. Reporting it as
      // one leads someone to hire the same person twice.
      expect(controller).toContain("HireValidationFailed");
      expect(controller).toContain("CrewMemberHiredWithoutProfile");
      // …and it routes to the member page so the profile can be completed.
      expect(controller).toMatch(/crew-member\.html\?staffId=/);
    });

    it("never sends a userId — the server stamps the caller's own (§9)", () => {
      const hireInput = controller.slice(controller.indexOf("function hireInput"), controller.indexOf("async function submitHire"));
      expect(hireInput).not.toMatch(/userId/);
    });
  });

  describe("changing a role", () => {
    const html = readPage("crew-member.html");
    const controller = readScript("crew-member.js");

    it("offers an edit affordance with a role selector", () => {
      expect(html).toContain('id="crewEditToggle"');
      expect(html).toContain('id="crewEditForm"');
      expect(html).toContain('id="editRole"');
      expect(html).toContain('id="editEmploymentType"');
    });

    it("does NOT offer name, surname or age — those are the staff module's (§17 Q8)", () => {
      // The whole point of the overlay: base identity is set once at hire and then
      // owned elsewhere. An input for it here would imply a write path that does
      // not exist.
      const form = html.slice(html.indexOf('id="crewEditForm"'), html.indexOf("</form>"));
      for (const forbidden of ['name="name"', 'name="surname"', 'name="age"']) {
        expect(form, `edit form exposes ${forbidden}`).not.toContain(forbidden);
      }
    });

    it("sends expectedVersion so a concurrent edit loses instead of clobbering", () => {
      expect(controller).toMatch(/input\.expectedVersion = currentMember\.profile\.version/);
    });

    it("omits expectedVersion when there is no profile yet — a create has nothing to conflict with", () => {
      expect(controller).toMatch(/if \(currentMember && currentMember\.profile\) \{/);
    });

    it("handles every upsert outcome, and re-reads after a version conflict", () => {
      expect(controller).toContain("CrewProfileUpserted");
      expect(controller).toContain("VersionConflict");
      expect(controller).toMatch(/VersionConflict"\) await load\(\)/);
    });

    it("doubles as an ADD form when the member has no profile", () => {
      // `upsertCrewProfile` covers both, because "needs a profile" and "needs
      // correcting" are the same user action.
      expect(controller).toMatch(/Add an employment profile/);
    });

    it("hides the editor for an orphaned overlay — there is no one left to employ", () => {
      expect(controller).toMatch(/editToggle\.hidden = currentMember\.orphaned/);
    });
  });

  describe("the enum labels are a single source", () => {
    it("covers every CrewRole the schema declares", () => {
      // The drift this prevents: a role added to the SDL that never appears in a
      // form, so nobody can be hired into it.
      const { assembleCrewSchema } = require("../services/crew/registry");
      const { schema } = assembleCrewSchema();
      const schemaRoles = schema
        .getType("CrewRole")
        .getValues()
        .map((value) => value.name);
      expect(Object.keys(CrewApi.ROLE_LABELS).sort()).toEqual(schemaRoles.slice().sort());
    });

    it("covers every EmploymentType the schema declares", () => {
      const { assembleCrewSchema } = require("../services/crew/registry");
      const { schema } = assembleCrewSchema();
      const schemaTypes = schema
        .getType("EmploymentType")
        .getValues()
        .map((value) => value.name);
      expect(Object.keys(CrewApi.EMPLOYMENT_TYPE_LABELS).sort()).toEqual(schemaTypes.slice().sort());
    });

    it("keeps the roster's static filter options in step with the label map", () => {
      // The filter's options are hand-written HTML so they survive without JS. This
      // is what stops them drifting from the generated form options.
      const html = readPage("crew.html");
      const filterBlock = html.slice(html.indexOf('id="crewRoleFilter"'), html.indexOf("</select>", html.indexOf('id="crewRoleFilter"')));
      const filterValues = [...filterBlock.matchAll(/value="([A-Z_]+)"/g)].map((match) => match[1]);
      expect(filterValues.sort()).toEqual(Object.keys(CrewApi.ROLE_LABELS).sort());
    });

    it("builds options from the map, marking the selected one", () => {
      const markup = CrewApi.optionsHtml(CrewApi.ROLE_LABELS, { selected: "MECHANIC", placeholder: "Choose…" });
      expect(markup).toContain('<option value="">Choose…</option>');
      expect(markup).toContain('<option value="MECHANIC" selected>Mechanic</option>');
      expect(markup).toContain('<option value="MANAGER">Manager</option>');
    });

    it("escapes what it interpolates", () => {
      const markup = CrewApi.optionsHtml({ "A<B": 'x"y' });
      expect(markup).toContain("A&lt;B");
      expect(markup).toContain("x&quot;y");
    });
  });
});

describe("Crew Office work board (Phase 3C)", () => {
  const html = readPage("crew-work.html");
  const controller = readScript("crew-work.js");

  it("assigns shifts, tracks time, and can define the duty type a shift needs", () => {
    // Without a duty type there is nothing to assign, so the page can create one.
    for (const id of ["boardAssignForm", "assignStaffId", "assignDutyTypeId", "assignDate"]) {
      expect(html, `missing ${id}`).toContain(`id="${id}"`);
    }
    for (const id of ["boardLogForm", "logStaffId", "logDate", "logHours", "logActivity", "logShiftId"]) {
      expect(html, `missing ${id}`).toContain(`id="${id}"`);
    }
    for (const id of ["boardDutyForm", "dutyCode", "dutyStartTime", "dutyEndTime"]) {
      expect(html, `missing ${id}`).toContain(`id="${id}"`);
    }
  });

  it("filters by crew member AND date range, the two filters Phase 3C asks for", () => {
    expect(html).toContain('id="boardMember"');
    expect(html).toContain('id="boardFrom"');
    expect(html).toContain('id="boardTo"');
    expect(html).toContain('id="boardThisWeek"');
    expect(html).toContain('id="boardThisMonth"');
  });

  it("renders a calendar grid rather than a flat list", () => {
    expect(html).toContain('id="boardHead"');
    expect(html).toContain('id="boardBody"');
    expect(html).toContain('id="boardFoot"');
    expect(html).toContain("crew-board");
  });

  it("offers both exports", () => {
    expect(html).toContain('id="boardExportCsv"');
    expect(html).toContain('id="boardExportPdf"');
  });

  it("loads the whole board in ONE round trip", () => {
    // Crew + duty types + shifts + work log + rollup in a single query — the reason
    // the module is graph-shaped (§1). Five sequential fetches would defeat it.
    const CrewApi = require("../public/js/pages/crew-api.js");
    const board = CrewApi.OPERATIONS.WORK_BOARD;
    for (const field of ["crew", "dutyTypes", "shifts(", "workLog(", "workRollup("]) {
      expect(board, `WORK_BOARD is missing ${field}`).toContain(field);
    }
    expect(controller).toMatch(/OPERATIONS\.WORK_BOARD/);
  });

  it("adds no REST endpoint for export — CSV is built client-side and PDF is the print pipeline", () => {
    // Goal G2 keeps REST to health only, so an export endpoint would break the
    // contract. The Blob download and window.print() are the whole mechanism.
    expect(controller).toMatch(/new Blob\(/);
    expect(controller).toMatch(/window\.print\(\)/);
    expect(controller).not.toMatch(/\/api\/v1\/crew\/export/);
  });

  it("writes a UTF-8 BOM so a spreadsheet does not mangle accented names", () => {
    expect(controller).toMatch(/﻿/);
  });

  it("hides the controls and prints landscape, so the PDF is the board and not the chrome", () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "pages", "crew.css"), "utf8");
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/crew-no-print/);
    expect(css).toMatch(/size: landscape/);
    // Status shading has to survive into the PDF rather than printing white.
    expect(css).toMatch(/print-color-adjust: exact/);
    expect(html).toContain("crew-no-print");
  });

  it("only offers the lifecycle moves the shift's status allows", () => {
    // A UI that offered "Complete" on a PLANNED shift would invite an
    // IllegalShiftTransition the server then has to refuse.
    expect(controller).toMatch(/confirmShift\.hidden = shift\.status !== "PLANNED"/);
    expect(controller).toMatch(/completeShift\.hidden = shift\.status !== "CONFIRMED"/);
    expect(controller).toMatch(/terminal = shift\.status === "COMPLETED" \|\| shift\.status === "CANCELLED"/);
  });

  it("sends the shift version with every transition", () => {
    expect(controller).toMatch(/expectedVersion: shift\.version/);
  });

  it("insists on hours AND a reason before appending a correction", () => {
    // Both are validated on the client, so a blank reason is "Reason is required."
    // rather than a NonEmptyString coercion error from the graph.
    const amend = controller.slice(controller.indexOf("async function amendEntry"));
    expect(amend).toMatch(/validateInput\(\[/);
    expect(amend).toContain('field: "reason"');
    expect(amend).toContain('field: "hours"');
    expect(amend).toMatch(/numberOrNull\(hours\)/);
  });

  it("validates each board form against rules that mirror the server's", () => {
    for (const rules of ["assignRules", "logRules", "dutyRules"]) {
      expect(controller, `${rules} is missing`).toContain("function " + rules + "(");
      expect(controller).toMatch(new RegExp("validateInput\\(" + rules + "\\(\\)\\)"));
    }
    // The field that prompted this: hours, with the server's own bounds and step.
    const logRules = controller.slice(controller.indexOf("function logRules"), controller.indexOf("function dutyRules"));
    expect(logRules).toMatch(/field: "hours"[\s\S]*required: true[\s\S]*step: 0\.25/);
  });

  it("routes server field errors onto the offending inputs", () => {
    expect(controller).toMatch(/fieldIds: ASSIGN_FIELD_IDS/);
    expect(controller).toMatch(/fieldIds: LOG_FIELD_IDS/);
    expect(controller).toMatch(/fieldIds: DUTY_FIELD_IDS/);
    expect(controller).toMatch(/outcome\.__typename === "WorkValidationFailed"/);
  });

  it("shows both SCHEDULED and LOGGED hours, each with its unit", () => {
    // The board used to total logged hours only, so a roster full of shifts with
    // nothing logged yet printed a column of zeroes — and the per-day footer printed
    // bare numbers next to a grand total labelled "h".
    expect(controller).toMatch(/computeBoardTotals\(/);
    expect(controller).toMatch(/Scheduled per day/);
    expect(controller).toMatch(/Logged per day/);
    expect(controller).toMatch(/hoursLabel\(/);
  });

  it("refuses an over-long range out loud instead of truncating it silently", () => {
    // A board that quietly showed the first 120 days of a year would look complete
    // and be wrong.
    expect(controller).toMatch(/MAX_RANGE_DAYS/);
    expect(controller).toMatch(/Narrow it to/);
  });

  it("sums only effective work-log rows into a cell", () => {
    expect(controller).toMatch(/if \(!entry\.effective\) continue;/);
  });

  it("is requireable from Node, so its pure helpers are unit-testable", () => {
    // The boot must be guarded, or requiring the file outside a browser throws on
    // `document`.
    expect(controller).toMatch(/typeof document !== "undefined"/);
    const CrewWorkPage = require("../public/js/pages/crew-work.js");
    for (const name of ["datesInRange", "presetRange", "csvCell", "buildCsv", "exportRows", "indexBoard"]) {
      expect(typeof CrewWorkPage[name], `${name} is not exported`).toBe("function");
    }
  });
});

describe("Crew Office module tabs", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");
  const TAB_PAGES = ["crew.html", "crew-work.html", "crew-leave.html", "crew-tools.html", "crew-explorer.html"];

  it.each(TAB_PAGES)("%s carries the tab strip container", (file) => {
    const html = readPage(file);
    expect(html).toContain('id="crewTabs"');
    // Labelled, because a nav landmark with no name is one of several on the page.
    expect(html).toMatch(/aria-label="Crew Office views"/);
  });

  it.each(TAB_PAGES)("%s renders the strip before it loads anything", (file) => {
    // Rendered up front so navigation survives a failed load — a page that only got
    // its tabs after a successful fetch would trap the user on a broken view.
    const controller = readScript(file.replace(".html", ".js"));
    expect(controller).toMatch(/renderModuleTabs\(\)/);
    // `function init(` with the bracket, not `function init` — the loose marker also
    // matched `function initialsFor` in the holidays controller and sliced from the
    // wrong place, comparing indexes in a chunk that was not `init` at all.
    const init = controller.slice(controller.indexOf("function init("));
    expect(init.indexOf("renderModuleTabs")).toBeLessThan(init.indexOf("load()") === -1 ? Infinity : init.indexOf("load()"));
  });

  it("lists every crew view, roster and work board included", () => {
    expect(CrewApi.MODULE_TABS.map((tab) => tab.href)).toEqual([
      "/crew.html",
      "/crew-work.html",
      "/crew-leave.html",
      "/crew-tools.html",
      "/crew-explorer.html",
    ]);
  });

  it("marks exactly one tab current, derived from the path", () => {
    // Derived rather than passed in per page: an argument that drifted would highlight
    // the wrong tab while looking perfectly fine.
    for (const tab of CrewApi.MODULE_TABS) {
      const active = CrewApi.moduleTabs(tab.href).filter((candidate) => candidate.active);
      expect(
        active.map((candidate) => candidate.href),
        tab.href,
      ).toEqual([tab.href]);
    }
  });

  it("treats the /crew redirect target as the roster", () => {
    expect(
      CrewApi.moduleTabs("/crew")
        .filter((tab) => tab.active)
        .map((tab) => tab.label),
    ).toEqual(["Roster"]);
  });

  it("ignores a query string when deciding which tab is current", () => {
    expect(
      CrewApi.moduleTabs("/crew-work.html?from=2026-08-03")
        .filter((tab) => tab.active)
        .map((tab) => tab.label),
    ).toEqual(["Work board"]);
  });

  it("marks nothing current on a page outside the strip", () => {
    // crew-member.html is a detail view with its own in-page tabs; stacking a second
    // row of tabs above those would leave two meaning different things.
    expect(CrewApi.moduleTabs("/crew-member.html").filter((tab) => tab.active)).toEqual([]);
    expect(readPage("crew-member.html")).not.toContain('id="crewTabs"');
  });

  it("uses links, so a view stays deep-linkable and openable in a new tab", () => {
    const source = readScript("crew-api.js");
    const render = source.slice(source.indexOf("function renderModuleTabs"));
    expect(render).toMatch(/<a class="crew-tab crew-tab--link/);
    expect(render).toMatch(/aria-current="page"/);
  });

  it("drops the ad-hoc cross-links the strip replaced", () => {
    expect(readPage("crew.html")).not.toContain("Open the work board");
    expect(readPage("crew-work.html")).not.toContain("Back to the roster");
  });

  it("keeps the strip out of the printed board", () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "pages", "crew.css"), "utf8");
    const printBlocks = css.split("@media print").slice(1).join("");
    expect(printBlocks).toContain("#crewTabs");
  });
});

describe("Crew Office work board — one panel at a time", () => {
  const controller = readScript("crew-work.js");

  it("routes every open through the exclusive group", () => {
    // The bug: three independent toggles let two forms stack below the toolbar.
    // Behaviour is asserted in crew.work-panels.test.js; this pins the structure that
    // makes it impossible to regress by adding another independent toggle.
    expect(controller).toMatch(/const PANEL_NAMES = \["assign", "log", "duty", "shift"\]/);
    expect(controller).toMatch(/function openPanel\(name\)/);
    expect(controller).not.toMatch(/function togglePanel\(panel, toggle, open\)/);
  });

  it("carries a selected shift into the log form, since opening it closes the detail", () => {
    expect(controller).toMatch(/function prefillLogFromSelection/);
    expect(controller).toMatch(/if \(open === "log"\) prefillLogFromSelection\(\)/);
  });

  it("closes the open panel on Escape", () => {
    expect(controller).toMatch(/event\.key !== "Escape"/);
  });

  it("refuses to render from a null payload instead of throwing", () => {
    // A 200 with `data: null` is legal when a non-null root field fails.
    expect(controller).toMatch(/if \(!result\.data\)/);
    expect(controller).toMatch(/returned no data for this range/);
  });
});

describe("Crew Office pages — the session guard (§9.1.4)", () => {
  it("every controller calls requireSession before its first fetch", () => {
    for (const { controller } of PAGES) {
      const source = readScript(controller);
      expect(source, `${controller} does not guard`).toMatch(/requireSession\(\)/);
      // The guard has to run in init, not somewhere incidental.
      expect(source).toMatch(/if \(!window\.CrewApi\.requireSession\(\)\) return;/);
    }
  });

  it("the guard redirects to login with a returnUrl", () => {
    const source = readScript("crew-api.js");
    expect(source).toMatch(/\/login\.html\?returnUrl=/);
    expect(source).toMatch(/encodeURIComponent/);
  });

  it("treats a mid-session 401 or 403 exactly like never having been logged in", () => {
    // §9.1.4: an expired session must produce the same login prompt, not a
    // half-rendered page full of error toasts.
    const source = readScript("crew-api.js");
    const runBody = source.slice(source.indexOf("async function run("));
    expect(runBody).toMatch(/status === 401 \|\| res\.status === 403/);
    expect(runBody).toMatch(/redirectToLogin\(\)/);
  });

  it("states plainly that the client-side check is UX and not the barrier", () => {
    const source = readScript("crew-api.js");
    expect(source).toMatch(/never a barrier|never security/i);
  });
});

describe("Crew Office nav link", () => {
  const componentsSource = fs.readFileSync(path.join(PUBLIC_DIR, "js", "components.js"), "utf8");
  const navigationSource = fs.readFileSync(path.join(PUBLIC_DIR, "js", "components", "navigation.js"), "utf8");

  it("is flag-gated on crewOfficeEnabled in both nav renderers", () => {
    expect(componentsSource).toMatch(/isEnabled\("crewOfficeEnabled", false\)/);
    expect(componentsSource).toMatch(/const crewLink = crewOfficeEnabled/);
    expect(navigationSource).toMatch(/isEnabled\("crewOfficeEnabled", false\)/);
    expect(navigationSource).toMatch(/const crewLink = flagState\?\.crewOfficeEnabled/);
  });

  it("points at /crew.html and is labelled Crew", () => {
    expect(componentsSource).toContain('href="/crew.html"');
    expect(componentsSource).toContain('data-testid="nav-crew"');
    expect(navigationSource).toContain('href="/crew.html"');
  });

  it("appears ONLY in the logged-in nav — an anonymous visitor is not told the module exists", () => {
    // The whole point of §9.1: to someone who could never use Crew Office, it is
    // indistinguishable from disabled. A link in the anonymous nav would leak it.
    const anonymousBlock = componentsSource.slice(componentsSource.indexOf("// Not logged in navigation"));
    expect(anonymousBlock).not.toContain("${crewLink}");

    // Slice from the method DEFINITION, not from its first mention — the call site
    // appears earlier in the file, and slicing there would swallow the
    // authenticated renderer and pass for the wrong reason.
    const definitionAt = navigationSource.indexOf("_renderUnauthenticatedNav(flagState = {})");
    expect(definitionAt).toBeGreaterThan(-1);
    const unauthenticatedBlock = navigationSource.slice(definitionAt);
    expect(unauthenticatedBlock).not.toContain("${crewLink}");
    // …and the authenticated renderer definitely does have it.
    const authenticatedAt = navigationSource.indexOf("_renderAuthenticatedNav(");
    expect(navigationSource.slice(authenticatedAt, definitionAt)).toContain("${crewLink}");
  });

  it("highlights the Crew link for every crew page", () => {
    expect(componentsSource).toMatch(/explicitPage === "crew" && linkPath === "\/crew\.html"/);
  });
});

describe("Crew Office page operations validate against the real schema", () => {
  const { parse, validate, specifiedRules } = require("graphql");
  const { assembleCrewSchema } = require("../services/crew/registry");
  const CrewApi = require("../public/js/pages/crew-api.js");

  const { schema } = assembleCrewSchema();
  const names = Object.keys(CrewApi.OPERATIONS);

  it("declares an operation set at all", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it.each(names)("%s parses and validates", (name) => {
    const source = CrewApi.OPERATIONS[name];
    const document = parse(source); // throws on a syntax error
    const errors = validate(schema, document, specifiedRules);
    expect(errors.map((error) => error.message)).toEqual([]);
  });

  it("gives every operation a name, so `operationName` and logs are usable", () => {
    for (const name of names) {
      expect(CrewApi.OPERATIONS[name], name).toMatch(/^\s*(query|mutation)\s+\w+/);
    }
  });

  it("never interpolates values into query text — every argument is a variable", () => {
    for (const name of names) {
      const source = CrewApi.OPERATIONS[name];
      // A `${` inside an operation string would mean a value was spliced in.
      expect(source, name).not.toContain("${");
    }
  });

  it("selects __typename on every union-returning mutation, so a client can branch exhaustively", () => {
    // Derived from the schema rather than a hand-kept list: a mutation whose result
    // is a union and which forgot `__typename` would return an object the page cannot
    // tell apart from any other outcome. An earlier version named three operations
    // explicitly and would not have noticed the six leave mutations Phase 7 added.
    const { isUnionType, getNamedType } = require("graphql");
    const mutationFields = schema.getMutationType().getFields();

    for (const name of names) {
      const source = CrewApi.OPERATIONS[name];
      if (!/^\s*mutation\s/.test(source)) continue;

      const returnsUnion = Object.keys(mutationFields).some(
        (field) => source.includes(field + "(") && isUnionType(getNamedType(mutationFields[field].type)),
      );
      if (!returnsUnion) continue;
      expect(source, `${name} returns a union but does not select __typename`).toContain("__typename");
    }
  });

  it("issues no operation that deletes, fires or reassigns anyone (§12.2)", () => {
    for (const name of names) {
      expect(CrewApi.OPERATIONS[name], name).not.toMatch(/delete|remove|fire|terminate|assignToField/i);
    }
  });

  it("maps every crew error code the pages might meet to a human sentence", () => {
    const { CREW_ERROR_CODES } = require("../services/crew/errors");
    // Codes a page can actually receive. UNAUTHENTICATED is handled by redirect
    // rather than by a message, and ORPHANED_OVERLAY surfaces as a field.
    const handled = Object.values(CREW_ERROR_CODES).filter(
      (code) => code !== "UNAUTHENTICATED" && code !== "ORPHANED_OVERLAY" && code !== "LEAVE_POLICY_MISSING",
    );
    for (const code of handled) {
      expect(CrewApi.ERROR_MESSAGES[code], `no message for ${code}`).toBeTruthy();
    }
  });
});

describe("Crew Office GraphQL explorer — the example ladder", () => {
  const { parse, validate, specifiedRules } = require("graphql");
  const { assembleCrewSchema } = require("../services/crew/registry");
  const { createLimitRules } = require("../services/graphql/limits");
  const CrewApi = require("../public/js/pages/crew-api.js");
  const CrewExplorerPage = require("../public/js/pages/crew-explorer.js");

  const { schema } = assembleCrewSchema();
  // The ladder as the page builds it, with a fixed date so a rung that depends on
  // "today" is still deterministic here.
  const ladder = CrewExplorerPage.examples(CrewApi.OPERATIONS, "2026-07-31");
  const html = readPage("crew-explorer.html");

  it("offers seven rungs, numbered in ascending difficulty", () => {
    expect(ladder).toHaveLength(7);
    expect(ladder.map((rung) => rung.level)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it.each(ladder.map((rung) => [rung.level + ". " + rung.label, rung]))(
    "%s parses and validates against the real schema",
    (_name, rung) => {
      // The point of the whole ladder: an example that names a field the assembled
      // schema does not have would teach somebody a query that cannot run. This turns
      // that into a failing test instead.
      const document = parse(rung.query);
      const errors = validate(schema, document, [...specifiedRules, ...createLimitRules()]);
      expect(errors.map((error) => error.message)).toEqual([]);
    },
  );

  it("gives every rung a name, a label and a sentence saying what it demonstrates", () => {
    for (const rung of ladder) {
      expect(rung.query, `rung ${rung.level}`).toMatch(/^\s*(query|mutation)\s+\w+/);
      expect(rung.label, `rung ${rung.level}`).toBeTruthy();
      expect(rung.hint, `rung ${rung.level}`).toBeTruthy();
    }
  });

  it("keeps rung 1 genuinely simple and rung 7 genuinely not", () => {
    // A ladder whose rungs are all the same size is a list. The first rung is one
    // field with no variables; the last is a write that has to branch on a union.
    expect(Object.keys(ladder[0].variables)).toEqual([]);
    expect(ladder[0].query.split("\n").length).toBeLessThan(8);
    expect(ladder[6].query).toMatch(/^\s*mutation\s/);
    expect(ladder[6].query).toContain("__typename");
  });

  it("introduces one concept per rung, in order", () => {
    expect(ladder[2].query, "rung 3 introduces a variable").toMatch(/\(\$\w+:/);
    expect(ladder[3].variables.filter, "rung 4 sends an input object").toBeTypeOf("object");
    expect(ladder[4].query, "rung 5 uses aliases").toMatch(/\w+:\s*crew\(/);
    expect(ladder[5].query, "rung 6 defines a fragment").toMatch(/fragment\s+\w+\s+on\s+CrewMember/);
  });

  it("interpolates nothing into query text — every value travels in the variables pane", () => {
    for (const rung of ladder) {
      expect(rung.query, `rung ${rung.level}`).not.toContain("${");
    }
  });

  it("issues no operation that deletes, fires or reassigns anyone (§12.2)", () => {
    for (const rung of ladder) {
      expect(rung.query, `rung ${rung.level}`).not.toMatch(/delete|remove|fire|terminate|assignToField/i);
    }
  });

  it("renders the rungs as buttons the page actually has a home for", () => {
    const controller = readScript("crew-explorer.js");
    for (const id of ["exampleButtons", "exampleHint"]) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
      expect(controller, `controller never reads #${id}`).toContain(id);
    }
    // Built from the list, not hand-written in the HTML — otherwise a rung could
    // exist as a button with no query behind it.
    expect(html).not.toContain("crew-btn--example");
    expect(controller).toContain("crew-btn--example");
  });

  it("keeps the app's own operation list beside the ladder rather than replacing it", () => {
    // The two lists answer different questions (see the file header), so losing one
    // to the other is a regression.
    expect(html).toContain('id="samples"');
    expect(readScript("crew-explorer.js")).toMatch(/OPERATIONS\.ROSTER/);
  });
});

describe("Crew Office holidays page (Phase 7)", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");
  const html = readPage("crew-leave.html");
  const controller = readScript("crew-leave.js");

  it("replaced the placeholder with the three views §10.1 asks for", () => {
    // Team calendar + pending-approval queue + per-person balance breakdown. The page
    // used to be an honest "arrives with the frontend phase" notice; this is the
    // assertion that it no longer is.
    expect(html).not.toMatch(/arrives with|not been wired/i);
    for (const id of ["leaveCalendar", "leaveApprovals", "leaveBalances", "leavePolicyPanel"]) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
    }
  });

  it("carries every element the controller caches, so a renamed id fails here", () => {
    // The controller reads ids by hand; a typo would leave a silently dead button
    // rather than an error. Extracting the ids from the controller and checking each
    // one is REACHABLE is what keeps the two in step.
    //
    // Reachable means one of two things, and the second is why this is not a plain
    // `html.includes`: an id may be authored in the markup, OR rendered by the
    // controller itself. `leavePolicySetup` is the latter — it lives inside the
    // "no policy configured" notice, which only exists once that state is reached.
    const cached = [...new Set([...controller.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]))];
    expect(cached.length).toBeGreaterThan(15);

    for (const id of cached) {
      const reachable = html.includes(`id="${id}"`) || controller.includes(`id="${id}"`);
      expect(reachable, `controller caches #${id} but nothing authors or renders it`).toBe(true);
    }
  });

  it("fetches the whole board in ONE operation", () => {
    // Three views of the same data. Three requests would be three chances to render a
    // page whose halves disagree about who is off.
    expect(controller).toMatch(/OPERATIONS\.LEAVE_BOARD/);
    const board = CrewApi.OPERATIONS.LEAVE_BOARD;
    for (const field of ["leaveCalendar", "pendingLeaveApprovals", "leavePolicy", "balance"]) {
      expect(board, `LEAVE_BOARD does not select ${field}`).toContain(field);
    }
  });

  it("sends the version each row was drawn from on every decision", () => {
    // Two people working the queue at once must get a version conflict rather than one
    // silently overwriting the other.
    expect(html || controller).toBeTruthy();
    expect(controller).toContain("data-leave-version");
    expect(controller).toMatch(/expectedVersion: Number\(expectedVersion\)/);
  });

  it("treats a booking with a warning as a success, and a refusal as a form error", () => {
    // §8.3: `LeaveBookedWithWarning` BOOKS. A controller that lumped it in with the
    // refusals would be the planted-bug shape — the office told nothing happened when
    // the leave is in fact booked.
    expect(controller).toMatch(/LeaveBookedWithWarning/);
    const submit = controller.slice(controller.indexOf("async function submitRequest"), controller.indexOf("// --- decisions"));
    expect(submit).toMatch(/booked\s*=\s*member\.__typename === "LeaveBooked" \|\| member\.__typename === "LeaveBookedWithWarning"/);
    // And a refusal lands on the form's own error line, so the typed dates survive.
    expect(submit).toMatch(/if \(!booked\)/);
    expect(submit).toMatch(/setStatus\(elements\.requestErrors, "error"/);
  });

  it("validates the form before sending, so a blank field names the field", () => {
    expect(controller).toMatch(/validateInput\(\[/);
    expect(controller).toMatch(/applyFieldErrors\(errors, REQUEST_FIELD_IDS/);
  });

  it("explains itself when there is no policy or no pillar, rather than showing zeroes", () => {
    // "Not configured" and "no days left" are different statements, and an empty
    // calendar would claim nobody is on holiday.
    expect(controller).toMatch(/No leave policy is configured/);
    expect(controller).toMatch(/not assembled in this build/);
  });

  it("uses the app's toast component for outcomes", () => {
    expect(controller).toMatch(/CrewApi\.toast\(/);
    expect(html).toContain("/js/components/notification.js");
  });
});

describe("Crew Office tool registry — the action gate (§8.5)", () => {
  const CrewToolsPage = require("../public/js/pages/crew-tools.js");
  const { toolActions, stateSummary } = CrewToolsPage;
  const html = readPage("crew-tools.html");
  const controller = readScript("crew-tools.js");

  const tool = (status, extra) => ({ status, ...extra });
  const HOLDER = {
    currentHolder: { staffId: "3", name: "Jan", surname: "Kowalski" },
    currentIssuance: { dueBack: "2026-08-04", daysUntilDueBack: 4 },
  };

  // The matrix the tools pillar itself enforces, transcribed from its refusals:
  // ToolUnavailable (issue), ToolNotOnIssue (return), ToolNotServiceable (service),
  // ToolStillOnIssue / ToolAlreadyRetired (retire). A page that offered a button
  // outside this table would be offering a click whose only outcome is a refusal.
  const MATRIX = [
    { status: "AVAILABLE", issue: true, return: false, service: true, retire: true },
    { status: "ON_ISSUE", issue: false, return: true, service: false, retire: false },
    { status: "IN_SERVICE", issue: false, return: false, service: true, retire: true },
    { status: "RETIRED", issue: false, return: false, service: false, retire: false },
  ];

  it.each(MATRIX)("$status allows exactly the actions the pillar would accept", (row) => {
    const actions = toolActions(tool(row.status, row.status === "ON_ISSUE" ? HOLDER : {}));
    for (const key of ["issue", "return", "service", "retire"]) {
      expect(actions[key].enabled, `${row.status} → ${key}`).toBe(row[key]);
    }
  });

  it("gives every blocked action a reason, and never a bare false", () => {
    // The whole point of the change: four grey buttons and no explanation is
    // indistinguishable from a broken page.
    for (const row of MATRIX) {
      const actions = toolActions(tool(row.status, HOLDER));
      for (const key of ["issue", "return", "service", "retire"]) {
        if (actions[key].enabled) continue;
        expect(actions[key].reason, `${row.status} → ${key} has no reason`).toBeTruthy();
        expect(actions[key].reason.length, `${row.status} → ${key} reason is a stub`).toBeGreaterThan(20);
      }
    }
  });

  it("names the holder in the reasons that are about them", () => {
    const actions = toolActions(tool("ON_ISSUE", HOLDER));
    for (const key of ["issue", "service", "retire"]) {
      expect(actions[key].reason, `${key} does not name the holder`).toContain("Jan Kowalski");
    }
  });

  it("names the retirement date rather than saying only 'retired'", () => {
    const actions = toolActions(tool("RETIRED", { retiredOn: "2026-05-02" }));
    for (const key of ["issue", "return", "service", "retire"]) {
      expect(actions[key].reason, key).toContain("2026-05-02");
    }
  });

  it("treats a required certification as a caution on an ALLOWED action, not as a block", () => {
    // The client cannot evaluate the gate — only the server can, and it fails closed.
    // Blocking here would be the page second-guessing it and hiding a legal action.
    const actions = toolActions(tool("AVAILABLE", { requiresCertification: "chainsaw" }));
    expect(actions.issue.enabled).toBe(true);
    expect(actions.issue.caution).toContain("chainsaw");
  });

  it("blocks everything, with a usable sentence, when no tool is selected", () => {
    const actions = toolActions(null);
    for (const key of ["issue", "return", "service", "retire"]) {
      expect(actions[key].enabled, key).toBe(false);
      expect(actions[key].reason, key).toMatch(/Pick a tool/);
    }
  });

  it("says where the tool is AND what follows from it", () => {
    for (const row of MATRIX) {
      const summary = stateSummary(tool(row.status, HOLDER));
      expect(summary.status, row.status).toBeTruthy();
      expect(summary.detail, `${row.status} has no detail`).toBeTruthy();
      // A state name alone tells you where you are, not what to do.
      expect(summary.next, `${row.status} has no next step`).toBeTruthy();
    }
    expect(stateSummary(null)).toBeNull();
    expect(stateSummary(tool("IN_SERVICE")).next).toMatch(/record a service/i);
    expect(stateSummary(tool("RETIRED")).next).toMatch(/terminal/i);
  });

  it("marks a blocked button with aria-disabled rather than disabled, so it can still explain itself", () => {
    // `disabled` takes the control out of the tab order and kills its tooltip in
    // several browsers — which is how "the button does nothing" happens.
    expect(controller).toMatch(/setAttribute\("aria-disabled"/);
    expect(controller).toMatch(/crew-btn--blocked/);
    // Pressing one reports the reason instead of doing nothing at all.
    expect(controller).toMatch(/function blocked\(/);
    for (const key of ["issue", "return", "service", "retire"]) {
      expect(controller, `${key} is not guarded`).toContain(`blocked("${key}")`);
    }
  });

  it("shows the reasons on the page, not only in a tooltip", () => {
    expect(html).toContain('id="toolsActionNotes"');
    expect(controller).toMatch(/function renderActionNotes/);
  });

  it("carries a state strip the controller fills from stateSummary", () => {
    expect(html).toContain('id="toolsDetailState"');
    expect(controller).toMatch(/function renderStateBanner/);
  });
});

describe("Crew Office tool registry — state icons and the lifecycle modal", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");
  const CrewToolsPage = require("../public/js/pages/crew-tools.js");
  const { TOOL_FLOW_STATES, TOOL_FLOW_TRANSITIONS, toolActions } = CrewToolsPage;
  const html = readPage("crew-tools.html");
  const controller = readScript("crew-tools.js");

  it("has an icon for every tool status and every service status", () => {
    // Derived from the label maps, so a status added to the schema and labelled here
    // cannot go iconless.
    for (const status of Object.keys(CrewApi.TOOL_STATUS_LABELS)) {
      expect(CrewApi.iconForToolStatus(status), status).toMatch(/^fa-/);
    }
    for (const status of Object.keys(CrewApi.SERVICE_STATUS_LABELS)) {
      expect(CrewApi.iconForServiceStatus(status), status).toMatch(/^fa-/);
    }
    // An unknown value still renders something rather than `undefined`.
    expect(CrewApi.iconForToolStatus("WHATEVER")).toBe("fa-circle-question");
  });

  it("keeps the word beside the icon, because Font Awesome is a CDN that can fail", () => {
    // The badge helper takes an icon but always emits the label too.
    expect(controller).toMatch(/function badge\(kind, label, icon\)/);
    expect(controller).toMatch(/icon \?.*aria-hidden="true".*: ""/s);
  });

  it("documents a lifecycle whose states are the ones the gate actually knows about", () => {
    const documented = TOOL_FLOW_STATES.map((state) => state.status).sort();
    expect(documented).toEqual(Object.keys(CrewApi.TOOL_STATUS_LABELS).sort());
  });

  it("documents only transitions the action gate would allow", () => {
    // The diagram is data so this check can exist: a documented "Retire" out of
    // ON_ISSUE would be a lie the modal tells while the button refuses.
    const actionKey = { Issue: "issue", Retire: "retire", "Record a service": "service" };
    for (const transition of TOOL_FLOW_TRANSITIONS) {
      if (!transition.from) continue;
      const key = actionKey[transition.action] || (transition.action.startsWith("Return") ? "return" : null);
      if (!key) continue;
      expect(toolActions({ status: transition.from })[key].enabled, `${transition.from} → ${transition.action}`).toBe(true);
    }
  });

  it("reaches every state from the transitions it documents", () => {
    const reachable = new Set(TOOL_FLOW_TRANSITIONS.map((transition) => transition.to));
    for (const state of TOOL_FLOW_STATES) {
      expect(reachable.has(state.status), `${state.status} is documented but unreachable`).toBe(true);
    }
  });

  it("opens the lifecycle from the toolbar and from the open tool", () => {
    expect(html).toContain('id="toolsFlowOpen"');
    expect(html).toContain('id="toolsDetailFlow"');
    expect(html).toContain('id="toolsFlowModal"');
    // Rendered from the data, never hand-written in the page.
    expect(html).toContain('id="toolsFlowBody"');
    expect(html).not.toContain("tools-flow__states");
    expect(controller).toMatch(/function renderFlow/);
  });

  it("is a real dialog: labelled, modal, closable and focus-returning", () => {
    expect(html).toMatch(/id="toolsFlowModal"[^>]*role="dialog"/);
    expect(html).toMatch(/id="toolsFlowModal"[^>]*aria-modal="true"/);
    expect(html).toMatch(/id="toolsFlowModal"[^>]*aria-labelledby="toolsFlowTitle"/);
    expect(html).toContain('id="toolsFlowClose"');
    // Focus goes back where it came from, or a keyboard user is stranded.
    expect(controller).toMatch(/flowOpener/);
    // Escape closes the modal FIRST, so one press does not also close the panel under it.
    expect(controller).toMatch(/if \(isFlowOpen\(\)\) {\s*closeFlow\(\);\s*return;/);
  });

  it("marks the current tool's state in the diagram for a screen reader too", () => {
    // Rendered without a DOM, which is why `flowHtml` returns a string.
    global.window = global.window || {};
    global.window.CrewApi = CrewApi;

    const markup = CrewToolsPage.flowHtml("IN_SERVICE");
    expect(markup).toMatch(/tools-flow__state--in_service tools-flow__state--current" aria-current="step"/);
    // Exactly one state is the current one.
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    // Opened from the toolbar, nothing is highlighted.
    expect(CrewToolsPage.flowHtml(null)).not.toContain('aria-current="step"');
  });

  it("draws every state and every transition, with its icon", () => {
    global.window = global.window || {};
    global.window.CrewApi = CrewApi;

    const markup = CrewToolsPage.flowHtml(null);
    for (const state of TOOL_FLOW_STATES) {
      expect(markup, state.status).toContain(CrewApi.labelForToolStatus(state.status));
      expect(markup, state.status).toContain(CrewApi.iconForToolStatus(state.status));
    }
    for (const transition of TOOL_FLOW_TRANSITIONS) {
      expect(markup, transition.action).toContain(transition.action);
      expect(markup, transition.note).toContain(transition.note);
    }
    // The two rules that explain most of the surprises on this page.
    expect(markup).toMatch(/Status is never stored/);
    expect(markup).toMatch(/nothing here deletes/i);
  });

  it("shows AND hides the modal from the `hidden` attribute the rest of the module uses", () => {
    // The regression this pins: styles.css declares `.modal` twice and the LAST one is
    // `display: none`, so removing `hidden` revealed nothing — the click worked and
    // the dialog stayed invisible. Both directions have to be stated explicitly.
    expect(html).toMatch(/id="toolsFlowModal"[^>]*\bhidden\b/);
    expect(html).toMatch(/id="toolsFlowModal"[^>]*class="[^"]*\bcrew-modal\b/);

    const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "pages", "crew.css"), "utf8");
    expect(css, "no rule hides a hidden crew modal").toMatch(/\.crew-page \.crew-modal\[hidden\]\s*{\s*display:\s*none/);
    expect(css, "no rule SHOWS a crew modal once hidden is removed").toMatch(
      /\.crew-page \.crew-modal:not\(\[hidden\]\)\s*{\s*display:\s*flex/,
    );
  });
});

describe("Crew Office tool registry — register templates and the icon picker", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");
  const CrewToolsPage = require("../public/js/pages/crew-tools.js");
  const { TOOL_TEMPLATES, nextAssetTag, describeTemplate } = CrewToolsPage;
  const html = readPage("crew-tools.html");
  const controller = readScript("crew-tools.js");
  const { TOOL_ICONS } = require("../services/crew/pillars/tools/ledger");
  const { validateToolInput } = require("../services/crew/pillars/tools/service");

  it("offers ten templates, each with its own key and label", () => {
    expect(TOOL_TEMPLATES).toHaveLength(10);
    expect(new Set(TOOL_TEMPLATES.map((template) => template.key)).size).toBe(10);
    expect(new Set(TOOL_TEMPLATES.map((template) => template.label)).size).toBe(10);
  });

  it.each(TOOL_TEMPLATES.map((template) => [template.label, template]))(
    "the %s template passes the SERVER's own validation",
    (_label, template) => {
      // The point of the check: a template that fills the form with something the
      // registry would refuse turns a one-click shortcut into a one-click rejection.
      const errors = validateToolInput(
        {
          assetTag: nextAssetTag(template.tagPrefix, []),
          name: template.name,
          category: template.category,
          icon: template.icon,
          requiresCertification: template.requiresCertification,
          serviceIntervalDays: template.serviceIntervalDays,
          storageLocation: template.storageLocation,
        },
        { today: "2026-07-31" },
      );
      expect(errors).toEqual([]);
    },
  );

  it("fills the fields nobody thinks about, not just the name", () => {
    // Certification and service interval are the two that matter months later and the
    // two a hurried person leaves blank.
    expect(TOOL_TEMPLATES.filter((template) => template.requiresCertification).length).toBeGreaterThanOrEqual(4);
    expect(TOOL_TEMPLATES.filter((template) => template.serviceIntervalDays).length).toBeGreaterThanOrEqual(8);
    // …and at least one deliberately has NO interval, because "never due anything" is
    // a real answer people forget exists.
    expect(TOOL_TEMPLATES.some((template) => template.serviceIntervalDays === null)).toBe(true);
    for (const template of TOOL_TEMPLATES) {
      expect(template.storageLocation, template.key).toBeTruthy();
      expect(template.icon, template.key).toBeTruthy();
    }
  });

  it("says what a template is about to do before it is pressed", () => {
    global.window = global.window || {};
    global.window.CrewApi = CrewApi;

    const chainsaw = TOOL_TEMPLATES.find((template) => template.key === "chainsaw");
    const description = describeTemplate(chainsaw);
    expect(description).toContain("Powered hand tool");
    expect(description).toContain("service every 180 days");
    expect(description).toContain("chainsaw certification");
    // The reassurance that makes a template safe to try.
    expect(description).toMatch(/editable/i);

    const spade = TOOL_TEMPLATES.find((template) => template.serviceIntervalDays === null);
    expect(describeTemplate(spade)).toContain("no service schedule");
  });

  it("numbers the asset tag from the registry rather than from a count", () => {
    // A gap in the numbering must not hand back a tag that is already taken — the
    // server would refuse it after the form was filled in.
    expect(nextAssetTag("CHS", [])).toBe("CHS-001");
    expect(nextAssetTag("CHS", [{ assetTag: "CHS-001" }, { assetTag: "CHS-003" }])).toBe("CHS-004");
    // Other prefixes and unrelated tags are ignored, and case does not matter.
    expect(nextAssetTag("CHS", [{ assetTag: "chs-009" }, { assetTag: "TRC-014" }, { assetTag: "CHS" }])).toBe("CHS-010");
  });

  it("renders the templates from the list, so a button cannot exist without one", () => {
    expect(html).toContain('id="toolsTemplates"');
    expect(html).not.toContain("data-template=");
    expect(controller).toMatch(/function renderTemplates/);
    expect(controller).toMatch(/function applyTemplate/);
  });

  it("applies EVERY field a template names, blanks included", () => {
    // A half-applied template leaves the previous one's values behind — picking "Hand
    // tool" after "Chainsaw" would keep a certification the spade does not need.
    const apply = controller.slice(controller.indexOf("function applyTemplate"), controller.indexOf("function renderIconPicker"));
    for (const id of [
      "toolAssetTag",
      "toolName",
      "toolCategory",
      "toolRequiresCertification",
      "toolServiceInterval",
      "toolLastServiced",
      "toolStorageLocation",
    ]) {
      expect(apply, `applyTemplate never sets ${id}`).toContain(id);
    }
    expect(apply).toMatch(/selectIcon\(template\.icon\)/);
  });

  // --- the icon picker ------------------------------------------------------

  it("offers a glyph for every icon the schema accepts, and no others", () => {
    // The two lists live on opposite sides of the wire; this is what keeps a value the
    // server will store from arriving at a page that cannot draw it.
    const fromSchema = TOOL_ICONS.map((icon) => icon.toUpperCase()).sort();
    const fromPage = CrewApi.TOOL_ICON_CHOICES.map((choice) => choice.value).sort();
    expect(fromPage).toEqual(fromSchema);
  });

  it("gives every choice a Font Awesome class and a human label", () => {
    for (const choice of CrewApi.TOOL_ICON_CHOICES) {
      expect(choice.icon, choice.value).toMatch(/^fa-[a-z0-9-]+$/);
      expect(choice.label, choice.value).toBeTruthy();
    }
    // Unique glyphs: two choices drawing the same picture is a picker with a lie in it.
    expect(new Set(CrewApi.TOOL_ICON_CHOICES.map((choice) => choice.icon)).size).toBe(CrewApi.TOOL_ICON_CHOICES.length);
  });

  it("never draws a chosen icon with a category's fallback glyph", () => {
    // A chosen icon that renders identically to "no icon chosen" is a choice the table
    // cannot show. `CHAINSAW` was `fa-gears`, which is exactly what an un-iconed
    // MACHINERY tool already falls back to.
    const fallbacks = new Set(Object.values(CrewApi.TOOL_CATEGORY_ICONS));
    const collisions = CrewApi.TOOL_ICON_CHOICES.filter((choice) => fallbacks.has(choice.icon)).map((choice) => choice.value);
    // The ones that intentionally ARE a category glyph — picking "Tractor" for a
    // vehicle is not a collision, it is the same statement made deliberately.
    expect(collisions.sort()).toEqual(["HELMET", "PLUG", "RULER", "SCREWDRIVER", "TOOLBOX", "TRACTOR"]);
  });

  it("falls back to the category's glyph when no icon was chosen", () => {
    for (const category of Object.keys(CrewApi.TOOL_CATEGORY_LABELS)) {
      expect(CrewApi.iconForToolCategory(category), category).toMatch(/^fa-/);
    }
    expect(CrewApi.iconForTool({ category: "VEHICLE", icon: null })).toBe(CrewApi.iconForToolCategory("VEHICLE"));
    expect(CrewApi.iconForTool({ category: "VEHICLE", icon: "TRACTOR" })).toBe("fa-tractor");
    // An unknown stored value cannot produce a broken class.
    expect(CrewApi.iconForTool({ category: "PPE", icon: "NONSENSE" })).toBe(CrewApi.iconForToolCategory("PPE"));
    expect(CrewApi.iconForTool(null)).toMatch(/^fa-/);
  });

  it("keeps the picker's state in the form, so a reset clears it", () => {
    // A variable would survive `form.reset()` and give the next tool the last one's
    // icon.
    expect(html).toContain('id="toolIcon"');
    expect(html).toMatch(/id="toolIcon"[^>]*type="hidden"/);
    expect(html).toContain('id="toolsIconPicker"');
    expect(controller).toMatch(/function resetRegisterForm/);
    expect(controller).toMatch(/selectIcon\(""\)/);
  });

  it("labels every icon button, so the picker survives Font Awesome not loading", () => {
    // Eighteen unlabelled squares would be unusable — and unreadable to a screen
    // reader — the moment the CDN fails.
    expect(controller).toMatch(/tools-icon__label/);
    expect(controller).toMatch(/aria-pressed="false"/);
  });

  it("sends the icon with the registration, and null when none was picked", () => {
    const submit = controller.slice(controller.indexOf("async function submitRegister"), controller.indexOf("function resetRegisterForm"));
    expect(submit).toMatch(/icon: blankToNull\("toolIcon"\)/);
  });

  it("asks for the icon in both tool queries and draws it in the table", () => {
    for (const name of ["TOOL_BOARD", "TOOL_DETAIL"]) {
      expect(CrewApi.OPERATIONS[name], `${name} does not select icon`).toMatch(/\n\s+icon\n/);
    }
    expect(controller).toMatch(/CrewApi\.iconForTool\(tool\)/);
  });
});

describe("Crew Office tabs render only for enabled pillars (Phase 7, §10.1)", () => {
  const CrewApi = require("../public/js/pages/crew-api.js");

  it("passes the assembled pillar list to the strip on every page that has one", () => {
    // A page that rendered the strip and never told it which pillars exist would show
    // a tab for a switched-off pillar forever.
    for (const controller of ["crew.js", "crew-work.js", "crew-leave.js", "crew-tools.js"]) {
      expect(readScript(controller), `${controller} never passes pillars to renderModuleTabs`).toMatch(
        /renderModuleTabs\(undefined, [^)]*pillars\)/,
      );
    }
  });

  it("asks for the pillar list in the query each of those pages already makes", () => {
    // Not a second round trip for one array.
    for (const name of ["ROSTER", "WORK_BOARD", "LEAVE_BOARD", "MEMBER"]) {
      expect(CrewApi.OPERATIONS[name], `${name} does not select crewInfo.pillars`).toMatch(/crewInfo\s*{\s*pillars/);
    }
  });

  it("hides the detail page's in-page tabs for absent pillars, and falls back to Overview", () => {
    const controller = readScript("crew-member.js");
    expect(controller).toMatch(/function applyPillarTabs/);
    // Overview has no pillar — profiles is never absent (§5.2 rule 4).
    expect(controller).toMatch(/overview: null/);
    // If the tab being shown disappears, the page must not end up with every panel
    // hidden.
    expect(controller).toMatch(/activeWasHidden.*selectTab\("overview"\)/s);
  });
});
