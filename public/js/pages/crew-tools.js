/**
 * Crew Office tool registry — issue, return, service and retire (PRD §8.5, §10.1).
 *
 * One table of tools, and one thing to understand about it: **the holder column is
 * not a stored field.** `status` and `currentHolder` are computed server-side from
 * the append-only issuance ledger on every read (§8.5), so this page cannot show a
 * holder that disagrees with the ledger — it has no second source to disagree with.
 * That is why there is no local mutation of a row after an action; every action
 * reloads, and the reload is the truth.
 *
 * The pure helpers below — `summarise`, `serviceNote`, `dueBackNote`, `holderName`,
 * `defaultDueBack`, `toolActions`, `stateSummary`, `flowHtml` — take no DOM and no
 * network, and are exported so a Node test can sweep their edge cases without a
 * browser. That is also why the boot at the bottom is guarded on `typeof document`:
 * this file has to be requireable from Node.
 *
 * **Which actions are possible is a function of the tool's state**, and `toolActions`
 * is the one place that decides it. Every action it blocks carries the sentence
 * explaining why, because the four buttons used to go quietly grey and leave the user
 * to infer the state machine from which ones still worked. A blocked button is marked
 * with `aria-disabled` rather than `disabled` so it keeps its place in the tab order
 * and can be pressed for that explanation; the same reasons are listed under the
 * buttons, where a tooltip would be unreachable on a touch screen. The full lifecycle
 * — `TOOL_FLOW_STATES` and `TOOL_FLOW_TRANSITIONS` — is one click away in a modal,
 * highlighting the state the open tool is actually in.
 *
 * **The one piece of cross-module UX here is the certification gate.** Issuing a tool
 * that requires a certification is refused unless the member holds a live one, and
 * refused *just as hard* when the check cannot be run at all (§8.5 — fail-closed). So
 * the issue form asks the server's own gate as soon as a member is picked and says so
 * before the button is pressed. It is the same function that will decide the mutation,
 * which is the only reason the preview can be trusted; it is a courtesy, never the
 * enforcement.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrewToolsPage = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  /** How far ahead the issue form defaults the due-back date. */
  const DEFAULT_LOAN_DAYS = 7;

  // --- pure helpers ---------------------------------------------------------

  /** Add days to a YYYY-MM-DD date in UTC. Returns null if the input is malformed. */
  function addDays(dateString, days) {
    if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
    const date = new Date(dateString + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /** The date the issue form starts on. */
  function defaultDueBack(today) {
    return addDays(today, DEFAULT_LOAN_DAYS) || today;
  }

  /**
   * The counts the summary line reports.
   *
   * `serviceAttention` deliberately lumps `DUE_SOON` and `OVERDUE` together, because
   * the summary's job is "how much needs doing", and splitting it there would make the
   * sentence longer without making it more actionable — the table's own column has the
   * distinction. Retired tools are counted separately and never inside `available`:
   * a registry that reported 40 available when 12 were scrap would be worse than
   * useless for a stocktake.
   */
  function summarise(tools, overdueReturns) {
    const counts = { total: 0, available: 0, onIssue: 0, inService: 0, retired: 0, serviceAttention: 0, serviceOverdue: 0 };

    for (const tool of tools || []) {
      counts.total += 1;
      if (tool.status === "AVAILABLE") counts.available += 1;
      if (tool.status === "ON_ISSUE") counts.onIssue += 1;
      if (tool.status === "IN_SERVICE") counts.inService += 1;
      if (tool.status === "RETIRED") counts.retired += 1;

      // A retired tool's service clock is meaningless — it is never going out again —
      // so counting it would inflate the number somebody is meant to act on.
      if (tool.status === "RETIRED") continue;
      if (tool.serviceStatus === "OVERDUE") {
        counts.serviceOverdue += 1;
        counts.serviceAttention += 1;
      } else if (tool.serviceStatus === "DUE_SOON") {
        counts.serviceAttention += 1;
      }
    }

    counts.overdueReturns = (overdueReturns || []).length;
    return counts;
  }

  /** The summary sentence. Separate from `summarise` so the counts stay assertable. */
  function summaryText(counts) {
    const parts = [counts.total + " tool" + (counts.total === 1 ? "" : "s"), counts.available + " available", counts.onIssue + " on issue"];
    if (counts.inService > 0) parts.push(counts.inService + " in for service");
    if (counts.retired > 0) parts.push(counts.retired + " retired");
    if (counts.serviceAttention > 0) {
      parts.push(
        counts.serviceAttention + " needing a service" + (counts.serviceOverdue > 0 ? " (" + counts.serviceOverdue + " overdue)" : ""),
      );
    }
    if (counts.overdueReturns > 0) parts.push(counts.overdueReturns + " overdue back");
    return parts.join(" · ");
  }

  /**
   * How to phrase a tool's service position.
   *
   * The `null` due date is the case worth care: a tool with a service interval and no
   * service history reads as OVERDUE on the server (fail-safe — "we do not know" must
   * not render as "fine"), and this has to say WHY, or the table shows a red cell with
   * no date and looks broken.
   */
  function serviceNote(tool) {
    if (!tool) return { tone: "ok", text: "—" };
    if (!tool.serviceIntervalDays) return { tone: "ok", text: "not scheduled" };

    if (!tool.lastServicedOn) {
      return { tone: "overdue", text: "never serviced" };
    }

    const days = tool.daysUntilService;
    if (days === null || days === undefined) return { tone: "overdue", text: "due date unknown" };
    if (days < 0) return { tone: "overdue", text: Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s") + " overdue" };
    if (days === 0) return { tone: "due_soon", text: "due today" };
    return { tone: tool.serviceStatus === "DUE_SOON" ? "due_soon" : "ok", text: "in " + days + " day" + (days === 1 ? "" : "s") };
  }

  /**
   * How to phrase an open issuance's due-back position.
   *
   * "Due today" is not late — the tool is out for the day and comes back at the end of
   * it. That matches the server's rule exactly (§8.5 decision 3), and a client that
   * called it late would flag every same-day loan.
   */
  function dueBackNote(issuance) {
    if (!issuance) return { tone: "ok", text: "—" };
    const days = issuance.daysUntilDueBack;
    if (days === null || days === undefined) return { tone: "ok", text: issuance.dueBack || "—" };
    if (days < 0) return { tone: "overdue", text: Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s") + " overdue" };
    if (days === 0) return { tone: "due_soon", text: "due today" };
    return { tone: "ok", text: "in " + days + " day" + (days === 1 ? "" : "s") };
  }

  /**
   * A member's name for display.
   *
   * An orphan — a staff record deleted from under the ledger (§12 rule 4) — is named
   * as such rather than left blank: somebody still has that tool, and a blank cell
   * reads as "nobody", which is the opposite of the truth.
   */
  function holderName(member) {
    if (!member) return null;
    if (member.orphaned) return "(deleted staff record)";
    return [member.name, member.surname].filter(Boolean).join(" ") || "staff " + member.staffId;
  }

  // --- registering: templates and asset tags --------------------------------

  /**
   * Ten tools a farm actually owns, as one-click starting points (§10.1).
   *
   * The register form has seven fields and only two of them are obvious, so the blank
   * form is the slowest thing on this page — and the fields people leave alone are
   * exactly the ones that matter later: a chainsaw with no `requiresCertification` can
   * be handed to anybody, and a tool with no service interval is never due anything.
   * A template fills all seven with a defensible answer, and every field stays
   * editable afterwards.
   *
   * Each carries a `tagPrefix` rather than a finished asset tag: the tag is unique per
   * owner, so a fixed one would collide the second time somebody registered the same
   * kind of tool. `nextAssetTag` numbers it from the registry that is already loaded.
   *
   * `lastServicedOn` is deliberately NOT set. A tool with an interval and no service
   * history reads as OVERDUE, which is the honest answer for kit whose last service
   * nobody can name — and the register form says so beside the field.
   */
  const TOOL_TEMPLATES = [
    {
      key: "chainsaw",
      label: "Chainsaw",
      tagPrefix: "CHS",
      name: "Chainsaw",
      category: "POWERED_HAND_TOOL",
      icon: "CHAINSAW",
      requiresCertification: "chainsaw",
      serviceIntervalDays: 180,
      storageLocation: "Workshop A",
    },
    {
      key: "tractor",
      label: "Tractor",
      tagPrefix: "TRC",
      name: "Tractor",
      category: "VEHICLE",
      icon: "TRACTOR",
      requiresCertification: "tractor_operation",
      serviceIntervalDays: 90,
      storageLocation: "Machine shed",
    },
    {
      key: "telehandler",
      label: "Telehandler",
      tagPrefix: "TLH",
      name: "Telehandler",
      category: "MACHINERY",
      icon: "TRUCK",
      requiresCertification: "telehandler",
      serviceIntervalDays: 90,
      storageLocation: "Machine shed",
    },
    {
      key: "trailer",
      label: "Trailer",
      tagPrefix: "TRL",
      name: "Tipping trailer",
      category: "VEHICLE",
      icon: "TRAILER",
      requiresCertification: null,
      serviceIntervalDays: 365,
      storageLocation: "Yard",
    },
    {
      key: "drill",
      label: "Cordless drill",
      tagPrefix: "DRL",
      name: "Cordless drill 18V",
      category: "POWERED_HAND_TOOL",
      icon: "BATTERY",
      requiresCertification: null,
      serviceIntervalDays: 365,
      storageLocation: "Workshop A",
    },
    {
      key: "hand_tool",
      label: "Hand tool",
      tagPrefix: "HND",
      name: "Digging spade",
      category: "HAND_TOOL",
      icon: "SEEDLING",
      requiresCertification: null,
      // No interval at all: "never due anything" is a real answer, and the one people
      // forget is available.
      serviceIntervalDays: null,
      storageLocation: "Tool store",
    },
    {
      key: "sprayer",
      label: "Sprayer",
      tagPrefix: "SPR",
      name: "Knapsack sprayer",
      category: "MACHINERY",
      icon: "SPRAYER",
      requiresCertification: "pesticide_handling",
      serviceIntervalDays: 180,
      storageLocation: "Chemical store",
    },
    {
      key: "harness",
      label: "Fall harness",
      tagPrefix: "PPE",
      name: "Fall-arrest harness",
      category: "PPE",
      icon: "VEST",
      requiresCertification: "working_at_height",
      serviceIntervalDays: 365,
      storageLocation: "Tool store",
    },
    {
      key: "generator",
      label: "Generator",
      tagPrefix: "GEN",
      name: "Petrol generator",
      category: "MACHINERY",
      icon: "PLUG",
      requiresCertification: null,
      serviceIntervalDays: 180,
      storageLocation: "Machine shed",
    },
    {
      key: "scales",
      label: "Livestock scales",
      tagPrefix: "MSR",
      name: "Livestock weigh scales",
      category: "MEASURING",
      icon: "SCALE",
      requiresCertification: null,
      serviceIntervalDays: 365,
      storageLocation: "Stock handling",
    },
  ];

  /**
   * The next free asset tag for a prefix — `CHS-001`, then `CHS-002`.
   *
   * Numbered from the tools ALREADY on screen rather than from a count, so a registry
   * holding CHS-001 and CHS-003 suggests CHS-004 and not CHS-003 again. A duplicate
   * tag is the most likely way a templated registration fails, and it fails at the
   * server with a field error after the form has been filled in — worth avoiding.
   *
   * The suggestion is only a suggestion: the field stays editable, and the server is
   * still the thing that decides, since another tab may have taken the tag meanwhile.
   */
  function nextAssetTag(prefix, tools) {
    const head = String(prefix || "TL").toUpperCase();
    const pattern = new RegExp("^" + head.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&") + "-(\\d+)$");

    let highest = 0;
    for (const tool of tools || []) {
      const match = pattern.exec(String(tool.assetTag || "").toUpperCase());
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    return head + "-" + String(highest + 1).padStart(3, "0");
  }

  // --- what a tool can have done to it, and why not -------------------------

  /**
   * The four actions, gated on the tool's own state (§8.5).
   *
   * This is the page's single source of truth for "can I?", and every sentence in it
   * mirrors a refusal the SERVER would actually produce — `ToolUnavailable`,
   * `ToolNotOnIssue`, `ToolNotServiceable`, `ToolStillOnIssue`, `ToolAlreadyRetired`.
   * That is the contract worth keeping: a button this function blocks must be one the
   * mutation would refuse, and a button it allows must be one the mutation would at
   * least attempt. `crew-pages.test.js` checks the matrix against the pillar's own
   * rules rather than against a copy of this list.
   *
   * Two deliberate shapes.
   *
   *   1. **Every blocked action carries a REASON, not just a false.** The old page
   *      disabled the buttons and said nothing, so four controls silently stopped
   *      working and the user had to infer the state machine from which ones were
   *      grey. A refusal that cannot explain itself is indistinguishable from a bug.
   *   2. **`caution` is not a block.** A tool that requires a certification can still
   *      be issued — to somebody who holds one — so the note travels beside an ENABLED
   *      action. Turning it into a block here would be the client second-guessing a
   *      gate that only the server can evaluate (§8.5, fail-closed).
   *
   * @param {object|null} tool - a Tool as the graph returns it
   * @returns {{issue: object, return: object, service: object, retire: object}}
   */
  function toolActions(tool) {
    if (!tool) {
      const nothingSelected = { enabled: false, reason: "Pick a tool from the registry first." };
      return {
        issue: { ...nothingSelected },
        service: { ...nothingSelected },
        retire: { ...nothingSelected },
        return: { ...nothingSelected },
      };
    }

    const status = tool.status;
    const holder = holderName(tool.currentHolder);
    const withWhom = holder ? "out with " + holder : "out with somebody";
    const retiredWhen = tool.retiredOn ? " on " + tool.retiredOn : "";
    const allow = (caution) => (caution ? { enabled: true, reason: "", caution } : { enabled: true, reason: "" });
    const block = (reason) => ({ enabled: false, reason });

    const actions = {
      // Mirrors ToolUnavailable: only an AVAILABLE tool goes out, and the server
      // re-checks under the write lock, so two people cannot both succeed.
      issue:
        status === "AVAILABLE"
          ? allow(
              tool.requiresCertification
                ? "Needs the " +
                    tool.requiresCertification +
                    " certification. A member without a live one is refused — and so is anyone, if the check itself cannot be run."
                : null,
            )
          : status === "ON_ISSUE"
            ? block("Already " + withWhom + ". Take it back before it can go out again.")
            : status === "IN_SERVICE"
              ? block("Off the run until a service is recorded. Record one and it goes back on the shelf.")
              : block("Retired" + retiredWhen + ". A retired tool never goes out again."),

      // Mirrors ToolNotOnIssue: there has to be an OPEN ledger row to close.
      return:
        status === "ON_ISSUE"
          ? allow()
          : status === "AVAILABLE"
            ? block("Nobody has it out — it is on the shelf.")
            : status === "IN_SERVICE"
              ? block("Nobody has it out — it is waiting for a service.")
              : block("Nobody has it out — it was retired" + retiredWhen + "."),

      // Mirrors ToolNotServiceable, which refuses exactly two states. IN_SERVICE is
      // the state a service is FOR, so it is allowed — that is the way out of it.
      service:
        status === "ON_ISSUE"
          ? block("It is " + withWhom + ". A tool has to come back before a service can be recorded on it.")
          : status === "RETIRED"
            ? block("Retired" + retiredWhen + ". A retired tool is never serviced — it is not going out again.")
            : allow(),

      // Mirrors ToolStillOnIssue and ToolAlreadyRetired.
      retire:
        status === "RETIRED"
          ? block("Already retired" + retiredWhen + ". Retirement is not repeatable and not reversible.")
          : status === "ON_ISSUE"
            ? block("It is " + withWhom + ". It has to come back first — or be returned as lost, which retires it.")
            : allow(),
    };

    return actions;
  }

  /**
   * The one-line state banner above the action buttons: where the tool is, and the
   * move that follows from it.
   *
   * The `next` sentence is the part that earns this: a state name alone tells you
   * where you are, not what to do, and "In service" reads as a problem until somebody
   * tells you that recording a service is the way out of it.
   */
  function stateSummary(tool) {
    if (!tool) return null;
    const holder = holderName(tool.currentHolder);
    const due = tool.currentIssuance ? dueBackNote(tool.currentIssuance) : null;

    if (tool.status === "ON_ISSUE") {
      return {
        status: tool.status,
        tone: due && due.tone === "overdue" ? "overdue" : "ok",
        detail:
          (holder ? "Out with " + holder : "Out with somebody") +
          (tool.currentIssuance ? ", due back " + tool.currentIssuance.dueBack + " (" + due.text + ")" : "") +
          ".",
        next: "Next: record the return. A lost tool is returned as lost, which retires it.",
      };
    }
    if (tool.status === "IN_SERVICE") {
      return {
        status: tool.status,
        tone: "due_soon",
        detail: "Off the run — it came back damaged or needing a service.",
        next: "Next: record a service, which puts it back on the shelf. Or retire it.",
      };
    }
    if (tool.status === "RETIRED") {
      return {
        status: tool.status,
        tone: "overdue",
        detail: "Retired" + (tool.retiredOn ? " on " + tool.retiredOn : "") + (tool.retiredReason ? " — " + tool.retiredReason : "") + ".",
        // Terminal, and the row is kept rather than deleted — worth saying, because
        // "retired" reads like "gone" and the ledger below is still there.
        next: "Terminal: nothing more can be done. The row, its ledger and its service history are all kept.",
      };
    }

    const service = serviceNote(tool);
    return {
      status: "AVAILABLE",
      tone: service.tone,
      detail: "On the shelf" + (tool.storageLocation ? " in " + tool.storageLocation : "") + ". Service: " + service.text + ".",
      next:
        service.tone === "overdue"
          ? "Next: record a service. It can still be issued, but it is past due."
          : "Next: issue it to a crew member, record a service, or retire it.",
    };
  }

  // --- the flow, as data ----------------------------------------------------

  /**
   * The tool lifecycle, written down once and rendered into the help modal.
   *
   * Data rather than prose in the HTML for two reasons: the modal can highlight the
   * state the tool you are looking at is actually in, and a test can assert that the
   * documented transitions are the ones `toolActions` enforces. A diagram that drifts
   * from the code is worse than no diagram.
   */
  const TOOL_FLOW_STATES = [
    { status: "AVAILABLE", summary: "On the shelf and issuable. Where a tool starts and where a service returns it to." },
    { status: "ON_ISSUE", summary: "Somebody is holding it. Never stored — derived from the open row in the issuance ledger." },
    { status: "IN_SERVICE", summary: "Off the run. Reached by a damaged or needs-service return; left by recording a service." },
    { status: "RETIRED", summary: "Terminal. The row, its ledger and its service history stay — nothing is ever deleted." },
  ];

  const TOOL_FLOW_TRANSITIONS = [
    {
      from: null,
      action: "Register a tool",
      to: "AVAILABLE",
      note: "A tool with a service interval but no service history starts OVERDUE, not OK.",
    },
    {
      from: "AVAILABLE",
      action: "Issue",
      to: "ON_ISSUE",
      note: "Gated on certification and fails closed: refused without a live one, and refused if the check cannot be run at all.",
    },
    { from: "ON_ISSUE", action: "Return · Good", to: "AVAILABLE", note: "Back on the shelf." },
    {
      from: "ON_ISSUE",
      action: "Return · Damaged or Needs service",
      to: "IN_SERVICE",
      note: "It cannot go out again until a service is recorded.",
    },
    { from: "ON_ISSUE", action: "Return · Lost", to: "RETIRED", note: "The retirement reason names the issuance it was lost on." },
    {
      from: "IN_SERVICE",
      action: "Record a service",
      to: "AVAILABLE",
      note: "Backdating is kept in the history but never moves the service clock backwards.",
    },
    { from: "AVAILABLE", action: "Record a service", to: "AVAILABLE", note: "Resets the clock on a tool that never left the shelf." },
    { from: "AVAILABLE", action: "Retire", to: "RETIRED", note: "Needs a reason — it is the only record of why. Irreversible." },
    { from: "IN_SERVICE", action: "Retire", to: "RETIRED", note: "The way out for a tool not worth repairing." },
  ];

  /** Rows for the export table: one per tool, flat, with the derived columns resolved. */
  function exportRows(tools) {
    const rows = [
      [
        "Asset tag",
        "Name",
        "Category",
        "Status",
        "Holder",
        "Due back",
        "Service status",
        "Last serviced",
        "Next due",
        "Requires",
        "Location",
      ],
    ];
    for (const tool of tools || []) {
      rows.push([
        tool.assetTag,
        tool.name,
        tool.category,
        tool.status,
        holderName(tool.currentHolder) || "",
        (tool.currentIssuance && tool.currentIssuance.dueBack) || "",
        tool.serviceStatus,
        tool.lastServicedOn || "",
        tool.nextServiceDue || "",
        tool.requiresCertification || "",
        tool.storageLocation || "",
      ]);
    }
    return rows;
  }

  // --- controller -----------------------------------------------------------

  const elements = {};
  let board = null;
  let detail = null;
  /**
   * The tool the action panels are about.
   *
   * Unlike the work board's `selectedShiftId`, this deliberately SURVIVES a panel
   * change: the issue, return and service forms are all about the selected tool, so
   * opening one from the detail panel must not forget which tool it is for. It is
   * cleared only by closing the detail panel outright.
   */
  let selectedToolId = null;

  function cacheElements() {
    const byId = (id) => document.getElementById(id);

    elements.status = byId("toolsStatus");
    elements.summary = byId("toolsSummary");
    elements.filterStatus = byId("toolsFilterStatus");
    elements.filterCategory = byId("toolsFilterCategory");
    elements.filterService = byId("toolsFilterService");
    elements.filterRetired = byId("toolsFilterRetired");
    elements.reload = byId("toolsReload");
    elements.print = byId("toolsPrint");

    elements.overdue = byId("toolsOverdue");
    elements.body = byId("toolsBody");
    elements.empty = byId("toolsEmpty");
    elements.table = byId("toolsTable");

    elements.registerToggle = byId("toolsRegisterToggle");
    elements.registerPanel = byId("toolsRegisterPanel");
    elements.registerForm = byId("toolsRegisterForm");
    elements.registerErrors = byId("toolsRegisterErrors");
    elements.registerSubmit = byId("toolsRegisterSubmit");
    elements.registerCancel = byId("toolsRegisterCancel");
    elements.registerTemplates = byId("toolsTemplates");
    elements.iconPicker = byId("toolsIconPicker");
    elements.iconValue = byId("toolIcon");

    elements.issuePanel = byId("toolsIssuePanel");
    elements.issueForm = byId("toolsIssueForm");
    elements.issueErrors = byId("toolsIssueErrors");
    elements.issueSubmit = byId("toolsIssueSubmit");
    elements.issueCancel = byId("toolsIssueCancel");
    elements.issueTool = byId("toolsIssueTool");
    elements.issueStaffId = byId("issueStaffId");
    elements.issueGate = byId("toolsIssueGate");

    elements.returnPanel = byId("toolsReturnPanel");
    elements.returnForm = byId("toolsReturnForm");
    elements.returnErrors = byId("toolsReturnErrors");
    elements.returnSubmit = byId("toolsReturnSubmit");
    elements.returnCancel = byId("toolsReturnCancel");
    elements.returnTool = byId("toolsReturnTool");

    elements.servicePanel = byId("toolsServicePanel");
    elements.serviceForm = byId("toolsServiceForm");
    elements.serviceErrors = byId("toolsServiceErrors");
    elements.serviceSubmit = byId("toolsServiceSubmit");
    elements.serviceCancel = byId("toolsServiceCancel");
    elements.serviceTool = byId("toolsServiceTool");

    elements.detailPanel = byId("toolsDetailPanel");
    elements.detailTitle = byId("toolsDetailTitle");
    elements.detailBody = byId("toolsDetailBody");
    elements.detailErrors = byId("toolsDetailErrors");
    elements.detailIssue = byId("toolsDetailIssue");
    elements.detailReturn = byId("toolsDetailReturn");
    elements.detailService = byId("toolsDetailService");
    elements.detailRetire = byId("toolsDetailRetire");
    elements.detailRetireReason = byId("toolsRetireReason");
    elements.detailClose = byId("toolsDetailClose");
    elements.detailState = byId("toolsDetailState");
    elements.detailActionNotes = byId("toolsActionNotes");
    elements.detailFlow = byId("toolsDetailFlow");

    elements.flowOpen = byId("toolsFlowOpen");
    elements.flowModal = byId("toolsFlowModal");
    elements.flowBody = byId("toolsFlowBody");
    elements.flowClose = byId("toolsFlowClose");
    elements.flowDone = byId("toolsFlowDone");
  }

  const value = (element) => (element && typeof element.value === "string" ? element.value.trim() : "");

  /**
   * The panels, as ONE exclusive group — the same rule as the work board.
   *
   * They occupy the same strip, so two open at once leaves stacked forms with no clue
   * which button produced what. `openPanel` is the only way to open one.
   */
  const PANEL_NAMES = ["register", "issue", "return", "service", "detail"];

  function panelParts(name) {
    if (name === "register") return { panel: elements.registerPanel, toggle: elements.registerToggle };
    if (name === "issue") return { panel: elements.issuePanel, toggle: null };
    if (name === "return") return { panel: elements.returnPanel, toggle: null };
    if (name === "service") return { panel: elements.servicePanel, toggle: null };
    if (name === "detail") return { panel: elements.detailPanel, toggle: null };
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
      // aria-expanded has to follow, or a screen reader keeps announcing a form that
      // is no longer on the page.
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    return Boolean(name);
  }

  function closePanels() {
    openPanel(null);
    // Only a full close forgets the tool. Moving between the detail panel and one of
    // its action forms must not.
    selectedToolId = null;
  }

  /** Toolbar behaviour: clicking the open panel's own button closes it. */
  function togglePanelByName(name) {
    return openPanel(isPanelOpen(name) ? null : name);
  }

  /** The selected tool, from the detail fetch if we have it, else from the board. */
  function selectedTool() {
    if (!selectedToolId) return null;
    if (detail && String(detail.id) === String(selectedToolId)) return detail;
    return ((board && board.tools) || []).find((tool) => String(tool.id) === String(selectedToolId)) || null;
  }

  // --- rendering ------------------------------------------------------------

  /**
   * A state badge: colour, icon and word.
   *
   * The word is never dropped in favour of the icon. Font Awesome is a CDN
   * dependency and can fail to arrive, and a status column that then renders empty
   * would be worse than the plain text it replaced.
   */
  function badge(kind, label, icon) {
    const CrewApi = window.CrewApi;
    return (
      '<span class="crew-badge crew-badge--' +
      CrewApi.escapeHtml(String(kind).toLowerCase()) +
      '">' +
      (icon ? '<i class="fa-solid ' + CrewApi.escapeHtml(icon) + '" aria-hidden="true"></i> ' : "") +
      CrewApi.escapeHtml(label) +
      "</span>"
    );
  }

  // --- the register form: templates and the icon picker ----------------------

  /** Render the ten templates as one small button each. */
  function renderTemplates() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!elements.registerTemplates) return;

    elements.registerTemplates.innerHTML = TOOL_TEMPLATES.map(
      (template) =>
        '<button type="button" class="crew-btn crew-btn--small tools-template" data-template="' +
        escape(template.key) +
        '" title="' +
        escape(describeTemplate(template)) +
        '"><i class="fa-solid ' +
        escape(CrewApi.iconForToolIcon(template.icon) || CrewApi.iconForToolCategory(template.category)) +
        '" aria-hidden="true"></i> ' +
        escape(template.label) +
        "</button>",
    ).join("");

    // Delegated: the row is rendered as a block, so per-button listeners would have to
    // be reattached with it.
    elements.registerTemplates.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-template]");
      if (button) applyTemplate(button.getAttribute("data-template"));
    });
  }

  /** The tooltip on a template button: what it is about to fill in. */
  function describeTemplate(template) {
    const CrewApi = window.CrewApi;
    const parts = [CrewApi.labelForToolCategory(template.category)];
    parts.push(template.serviceIntervalDays ? "service every " + template.serviceIntervalDays + " days" : "no service schedule");
    if (template.requiresCertification) parts.push("requires the " + template.requiresCertification + " certification");
    return template.label + " — " + parts.join(", ") + ". Every field stays editable.";
  }

  /**
   * Fill the register form from a template.
   *
   * Fills EVERY field it knows about, including the blanks: a half-applied template
   * would leave whatever the previous one put there, so picking "Hand tool" after
   * "Chainsaw" would silently keep the chainsaw certification and the tool could not
   * be issued to anybody.
   */
  function applyTemplate(key) {
    const CrewApi = window.CrewApi;
    const template = TOOL_TEMPLATES.find((candidate) => candidate.key === key);
    if (!template) return;

    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.value = value === null || value === undefined ? "" : String(value);
    };

    set("toolAssetTag", nextAssetTag(template.tagPrefix, (board && board.tools) || []));
    set("toolName", template.name);
    set("toolCategory", template.category);
    set("toolRequiresCertification", template.requiresCertification);
    set("toolServiceInterval", template.serviceIntervalDays);
    set("toolLastServiced", "");
    set("toolStorageLocation", template.storageLocation);
    selectIcon(template.icon);

    CrewApi.clearFieldErrors(REGISTER_FIELD_IDS);
    CrewApi.setStatus(elements.registerErrors, "info", describeTemplate(template));

    for (const button of elements.registerTemplates.querySelectorAll("button[data-template]")) {
      button.setAttribute("aria-pressed", button.getAttribute("data-template") === key ? "true" : "false");
    }
  }

  /**
   * The icon picker: one button per choice, plus "None".
   *
   * Buttons in a radio group rather than a `<select>`, because the whole point is
   * seeing the glyphs side by side — a dropdown of eighteen icon NAMES would be a
   * worse version of the category field the form already has.
   *
   * The chosen value lives in a hidden input rather than in a variable, so the form's
   * state is all in the form: `form.reset()` clears it with everything else, which is
   * what stops the next registration inheriting the last one's icon.
   */
  function renderIconPicker() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!elements.iconPicker) return;

    const button = (value, label, icon) =>
      '<button type="button" class="crew-btn tools-icon" data-icon="' +
      escape(value) +
      '" aria-pressed="false" title="' +
      escape(label) +
      '"><i class="fa-solid ' +
      escape(icon) +
      '" aria-hidden="true"></i><span class="tools-icon__label">' +
      escape(label) +
      "</span></button>";

    elements.iconPicker.innerHTML =
      // "None" is a real choice and comes first: a tool with no icon falls back to its
      // category, which is a perfectly good answer and has to be reachable again after
      // a template has set one.
      button("", "Category default", CrewApi.iconForToolCategory(null)) +
      CrewApi.TOOL_ICON_CHOICES.map((choice) => button(choice.value, choice.label, choice.icon)).join("");

    elements.iconPicker.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-icon]");
      if (target) selectIcon(target.getAttribute("data-icon"));
    });

    selectIcon("");
  }

  /** Mark one icon as chosen and record it where the submit will read it. */
  function selectIcon(value) {
    const chosen = value || "";
    if (elements.iconValue) elements.iconValue.value = chosen;
    if (!elements.iconPicker) return;

    for (const button of elements.iconPicker.querySelectorAll("button[data-icon]")) {
      button.setAttribute("aria-pressed", button.getAttribute("data-icon") === chosen ? "true" : "false");
    }
  }

  /** The tool-status badge, with its icon. Used by the table, the detail and the modal. */
  function statusBadge(status) {
    const CrewApi = window.CrewApi;
    return badge(status, CrewApi.labelForToolStatus(status), CrewApi.iconForToolStatus(status));
  }

  function serviceBadge(status) {
    const CrewApi = window.CrewApi;
    return badge(status, CrewApi.labelForServiceStatus(status), CrewApi.iconForServiceStatus(status));
  }

  function renderOverdue() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const rows = (board && board.overdueReturns) || [];

    if (rows.length === 0) {
      // Hidden rather than shown empty: a permanent "0 overdue" banner is noise, and
      // noise is what stops people noticing the banner when it does say something.
      elements.overdue.hidden = true;
      elements.overdue.innerHTML = "";
      return;
    }

    elements.overdue.hidden = false;
    elements.overdue.innerHTML =
      '<h2 class="crew-subhead"><i class="fa-solid fa-triangle-exclamation"></i> Overdue back (' +
      rows.length +
      ")</h2>" +
      '<ul class="crew-list">' +
      rows
        .map((issuance) => {
          const tool = issuance.tool || {};
          const note = dueBackNote(issuance);
          return (
            "<li><strong>" +
            escape(tool.assetTag || "—") +
            "</strong> " +
            escape(tool.name || "") +
            " — " +
            escape(holderName(issuance.member) || "staff " + issuance.staffId) +
            ', due back <span class="crew-tone--overdue">' +
            escape(issuance.dueBack) +
            " (" +
            escape(note.text) +
            ")</span></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  function renderRow(tool) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    const service = serviceNote(tool);
    const holder = holderName(tool.currentHolder);
    const due = tool.currentIssuance ? dueBackNote(tool.currentIssuance) : null;

    return (
      '<tr class="' +
      (tool.status === "RETIRED" ? "crew-row--superseded" : "") +
      '" data-tool-id="' +
      escape(tool.id) +
      '" tabindex="0">' +
      '<th scope="row"><a class="crew-link" href="#" data-tool-id="' +
      escape(tool.id) +
      '">' +
      escape(tool.assetTag) +
      "</a></th>" +
      "<td>" +
      // The tool's own glyph, in the column a person scans down. The name stays beside
      // it: the icon narrows the search, it does not replace the label.
      '<i class="fa-solid ' +
      escape(CrewApi.iconForTool(tool)) +
      ' tools-row__icon" aria-hidden="true"></i> ' +
      escape(tool.name) +
      (tool.requiresCertification
        ? '<br /><span class="crew-muted"><i class="fa-solid fa-certificate"></i> needs ' + escape(tool.requiresCertification) + "</span>"
        : "") +
      "</td>" +
      "<td>" +
      escape(CrewApi.labelForToolCategory(tool.category)) +
      "</td>" +
      "<td>" +
      statusBadge(tool.status) +
      (tool.retiredReason ? '<br /><span class="crew-muted">' + escape(tool.retiredReason) + "</span>" : "") +
      "</td>" +
      "<td>" +
      (holder ? escape(holder) : '<span class="crew-muted">—</span>') +
      "</td>" +
      "<td>" +
      (due ? '<span class="crew-tone--' + escape(due.tone) + '">' + escape(due.text) + "</span>" : '<span class="crew-muted">—</span>') +
      "</td>" +
      "<td>" +
      serviceBadge(tool.serviceStatus) +
      '<br /><span class="crew-muted crew-tone--' +
      escape(service.tone) +
      '">' +
      escape(service.text) +
      "</span></td>" +
      "<td>" +
      (tool.storageLocation ? escape(tool.storageLocation) : '<span class="crew-muted">—</span>') +
      "</td>" +
      "</tr>"
    );
  }

  function renderBoard() {
    const CrewApi = window.CrewApi;
    if (!board) return;

    const tools = board.tools || [];
    renderOverdue();

    elements.body.innerHTML = tools.map(renderRow).join("");
    elements.empty.hidden = tools.length > 0;
    elements.table.hidden = tools.length === 0;

    elements.summary.textContent = summaryText(summarise(tools, board.overdueReturns));
    void CrewApi;
  }

  /** Fill the issue form's member select from the loaded board. */
  function populateSelects() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!board || !elements.issueStaffId) return;

    // Orphans are excluded: nothing new may be issued to a deleted staff record
    // (§12 rule 4), and the server would refuse it anyway.
    elements.issueStaffId.innerHTML =
      '<option value="">Choose a crew member…</option>' +
      ((board.crew && board.crew.nodes) || [])
        .filter((member) => !member.orphaned)
        .map((member) => '<option value="' + escape(member.staffId) + '">' + escape(member.name + " " + member.surname) + "</option>")
        .join("");
  }

  function filters() {
    return {
      status: value(elements.filterStatus) || null,
      category: value(elements.filterCategory) || null,
      serviceStatus: value(elements.filterService) || null,
      includeRetired: Boolean(elements.filterRetired && elements.filterRetired.checked),
    };
  }

  async function load() {
    const CrewApi = window.CrewApi;
    CrewApi.setStatus(elements.status, "info", "Loading the registry…");

    const result = await CrewApi.run(CrewApi.OPERATIONS.TOOL_BOARD, { filter: filters() });

    if (!result.ok) {
      CrewApi.setStatus(elements.status, "error", CrewApi.describeErrors(result));
      return;
    }

    if (!result.data) {
      // 200 with `data: null` happens when a non-null root field fails. There is
      // nothing to render.
      CrewApi.setStatus(elements.status, "error", "Crew Office returned no data for the tool registry.");
      return;
    }

    board = result.data;
    // Drop the tabs whose pillar this build does not have (§10.1).
    if (board.crewInfo) CrewApi.renderModuleTabs(undefined, board.crewInfo.pillars);

    populateSelects();
    renderBoard();
    // A panel that was open is about a tool whose row has just been re-rendered, so
    // refresh what it shows rather than leaving stale numbers on screen.
    if (selectedToolId && isPanelOpen("detail")) await openDetail(selectedToolId);
    CrewApi.setStatus(elements.status, "info", "");
  }

  // --- the selected tool ----------------------------------------------------

  function renderDetail() {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    const tool = detail;
    if (!tool) return;

    const service = serviceNote(tool);
    const holder = holderName(tool.currentHolder);
    const ledger = tool.issuanceHistory || [];
    const services = tool.serviceHistory || [];

    // innerHTML rather than textContent so the title can carry the tool's glyph. Both
    // interpolated values are escaped, and the icon class comes from the closed
    // `ToolIcon` list — never from the tool's own text.
    elements.detailTitle.innerHTML =
      '<i class="fa-solid ' +
      escape(CrewApi.iconForTool(tool)) +
      '" aria-hidden="true"></i> ' +
      escape(tool.assetTag) +
      " — " +
      escape(tool.name);

    const facts =
      '<dl class="crew-fields">' +
      "<div><dt>Status</dt><dd>" +
      statusBadge(tool.status) +
      (holder ? " — " + escape(holder) : "") +
      "</dd></div>" +
      "<div><dt>Category</dt><dd>" +
      escape(CrewApi.labelForToolCategory(tool.category)) +
      (tool.icon
        ? ' <span class="crew-muted">· ' + escape(CrewApi.labelForToolIcon(tool.icon)) + " icon</span>"
        : ' <span class="crew-muted">· no icon chosen</span>') +
      "</dd></div>" +
      "<div><dt>Service</dt><dd>" +
      serviceBadge(tool.serviceStatus) +
      ' <span class="crew-muted crew-tone--' +
      escape(service.tone) +
      '">' +
      escape(service.text) +
      "</span>" +
      (tool.nextServiceDue ? '<br /><span class="crew-muted">next due ' + escape(tool.nextServiceDue) + "</span>" : "") +
      "</dd></div>" +
      "<div><dt>Requires</dt><dd>" +
      (tool.requiresCertification
        ? escape(tool.requiresCertification) +
          ' <span class="crew-muted">certification — issuing is refused without a live one, and refused if it cannot be checked</span>'
        : '<span class="crew-muted">no certification</span>') +
      "</dd></div>" +
      "<div><dt>Location</dt><dd>" +
      (tool.storageLocation ? escape(tool.storageLocation) : '<span class="crew-muted">—</span>') +
      "</dd></div>" +
      (tool.retiredOn
        ? "<div><dt>Retired</dt><dd>" + escape(tool.retiredOn) + " — " + escape(tool.retiredReason || "no reason recorded") + "</dd></div>"
        : "") +
      "</dl>";

    const ledgerTable =
      ledger.length === 0
        ? '<p class="crew-muted">Never issued.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Issued</th><th>To</th><th>Due back</th><th>Returned</th><th>Condition</th><th>Note</th>" +
          "</tr></thead><tbody>" +
          // Newest first for reading, though the ledger itself is append-ordered.
          ledger
            .slice()
            .reverse()
            .map((row) => {
              const open = !row.returnedAt;
              const note = open ? dueBackNote(row) : null;
              return (
                '<tr class="' +
                (open ? "crew-row--open" : "") +
                '"><td>' +
                escape(String(row.issuedAt).slice(0, 10)) +
                "</td><td>" +
                escape(holderName(row.member) || "staff " + row.staffId) +
                "</td><td>" +
                escape(row.dueBack) +
                (note ? ' <span class="crew-tone--' + escape(note.tone) + '">(' + escape(note.text) + ")</span>" : "") +
                "</td><td>" +
                (row.returnedAt
                  ? escape(String(row.returnedAt).slice(0, 10)) + (row.returnedLate ? ' <span class="crew-tone--overdue">late</span>' : "")
                  : '<span class="crew-muted">still out</span>') +
                "</td><td>" +
                escape(CrewApi.labelForReturnCondition(row.conditionOnReturn)) +
                "</td><td>" +
                escape(row.note || "—") +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table></div>";

    const serviceTable =
      services.length === 0
        ? '<p class="crew-muted">No service recorded.</p>'
        : '<div class="crew-table-wrap"><table class="crew-table"><thead><tr>' +
          "<th>Serviced</th><th>By</th><th>Note</th>" +
          "</tr></thead><tbody>" +
          services
            .map(
              (record) =>
                "<tr><td>" +
                escape(record.servicedOn) +
                "</td><td>" +
                escape(record.performedBy || "—") +
                "</td><td>" +
                escape(record.note || "—") +
                "</td></tr>",
            )
            .join("") +
          "</tbody></table></div>";

    elements.detailBody.innerHTML =
      facts +
      '<h3 class="crew-subhead">Issuance ledger <span class="crew-muted"></span></h3>' +
      ledgerTable +
      '<h3 class="crew-subhead">Service history</h3>' +
      serviceTable;

    renderStateBanner(tool);
    applyActions(tool);
  }

  /** The state strip above the actions: icon, state, where the tool is, what follows. */
  function renderStateBanner(tool) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!elements.detailState) return;

    const summary = stateSummary(tool);
    if (!summary) {
      elements.detailState.hidden = true;
      elements.detailState.innerHTML = "";
      return;
    }

    elements.detailState.hidden = false;
    elements.detailState.className = "tools-state tools-state--" + String(summary.status).toLowerCase();
    elements.detailState.innerHTML =
      '<i class="fa-solid ' +
      escape(CrewApi.iconForToolStatus(summary.status)) +
      ' tools-state__icon" aria-hidden="true"></i>' +
      '<span class="tools-state__text"><strong>' +
      escape(CrewApi.labelForToolStatus(summary.status)) +
      "</strong> — " +
      escape(summary.detail) +
      '<br /><span class="crew-muted">' +
      escape(summary.next) +
      "</span></span>";
  }

  /**
   * Put the gate on the four action buttons.
   *
   * A blocked button is marked with `aria-disabled` and NOT with `disabled`, which is
   * the whole UX change: a `disabled` control cannot be focused, cannot be hovered for
   * a tooltip in several browsers, and is skipped by a screen reader's tab order — so
   * the user is left with a grey button and no way to find out why. Marked this way it
   * stays reachable, announces itself as unavailable, carries the reason as its
   * tooltip, and — when pressed anyway — says the reason out loud in the error line
   * instead of doing nothing.
   *
   * The reason text comes from `toolActions`, so it is the same sentence the server
   * would have answered with.
   */
  function applyActions(tool) {
    const actions = toolActions(tool);
    const pairs = [
      [elements.detailIssue, actions.issue, "Issue"],
      [elements.detailReturn, actions.return, "Return"],
      [elements.detailService, actions.service, "Record a service"],
      [elements.detailRetire, actions.retire, "Retire"],
    ];

    for (const [button, action] of pairs) {
      if (!button) continue;
      button.setAttribute("aria-disabled", action.enabled ? "false" : "true");
      button.classList.toggle("crew-btn--blocked", !action.enabled);
      // The tooltip is a convenience; the click path below is what guarantees the
      // reason is reachable, including for anybody who never sees a tooltip.
      if (action.enabled) button.removeAttribute("title");
      else button.setAttribute("title", action.reason);
    }

    // The retirement reason is a plain input, so `disabled` is right for it: there is
    // nothing to explain by focusing it, and a typed-in reason that can never be
    // submitted is a small trap of its own.
    if (elements.detailRetireReason) elements.detailRetireReason.disabled = !actions.retire.enabled;

    // With no tool there is nothing to explain — four copies of "pick a tool first"
    // under an error message is noise, not help.
    renderActionNotes(tool ? actions : null);
  }

  /**
   * The list under the buttons: every blocked action with its reason, plus any caution
   * attached to an allowed one.
   *
   * Visible rather than hover-only, and deliberately so — this is the thing the page
   * was missing. Four dimmed buttons with the explanation hidden behind a tooltip is
   * the same dead end as four dimmed buttons with no explanation at all, for anyone on
   * a touch screen or a keyboard.
   */
  function renderActionNotes(actions) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;
    if (!elements.detailActionNotes) return;

    const labels = { issue: "Issue", return: "Return", service: "Record a service", retire: "Retire" };
    const notes = [];

    for (const key of actions ? ["issue", "return", "service", "retire"] : []) {
      const action = actions[key];
      if (!action.enabled) {
        notes.push(
          '<li class="tools-note tools-note--blocked"><i class="fa-solid fa-ban" aria-hidden="true"></i> <strong>' +
            escape(labels[key]) +
            "</strong> — " +
            escape(action.reason) +
            "</li>",
        );
      } else if (action.caution) {
        notes.push(
          '<li class="tools-note tools-note--caution"><i class="fa-solid fa-certificate" aria-hidden="true"></i> <strong>' +
            escape(labels[key]) +
            "</strong> — " +
            escape(action.caution) +
            "</li>",
        );
      }
    }

    elements.detailActionNotes.hidden = notes.length === 0;
    elements.detailActionNotes.innerHTML = notes.join("");
  }

  /**
   * Guard an action button press.
   *
   * Returns true when the press should be ignored — having first SAID why, which is
   * the point: the button is reachable precisely so that pressing it can answer the
   * question a grey button leaves hanging.
   */
  function blocked(key) {
    const action = toolActions(selectedTool())[key];
    if (action.enabled) return false;
    window.CrewApi.setStatus(elements.detailErrors, "error", action.reason);
    return true;
  }

  /** Fetch and show one tool's detail. */
  async function openDetail(toolId) {
    const CrewApi = window.CrewApi;
    selectedToolId = toolId;
    openPanel("detail");
    CrewApi.setStatus(elements.detailErrors, "error", "");

    const result = await CrewApi.run(CrewApi.OPERATIONS.TOOL_DETAIL, { id: toolId });
    if (!result.ok || !result.data || !result.data.tool) {
      elements.detailBody.innerHTML =
        '<p class="crew-notice crew-notice--warning">' +
        CrewApi.escapeHtml(CrewApi.describeErrors(result) || "That tool could not be loaded.") +
        "</p>";
      // The detail did not load, so leaving the PREVIOUS tool's state above an error
      // message would be the worst of both. Fall back to the row the table already
      // has — which is what `blocked()` and the submit handlers fall back to, so the
      // buttons and the guard cannot end up disagreeing.
      detail = null;
      const known = selectedTool();
      renderStateBanner(known);
      applyActions(known);
      return;
    }

    detail = result.data.tool;
    renderDetail();
  }

  // --- mutations ------------------------------------------------------------

  const REGISTER_FIELD_IDS = {
    assetTag: "toolAssetTag",
    name: "toolName",
    category: "toolCategory",
    // The picker, not the hidden input behind it: a field error has to mark something
    // the user can see.
    icon: "toolsIconPicker",
    requiresCertification: "toolRequiresCertification",
    serviceIntervalDays: "toolServiceInterval",
    lastServicedOn: "toolLastServiced",
    storageLocation: "toolStorageLocation",
  };
  const ISSUE_FIELD_IDS = { staffId: "issueStaffId", dueBack: "issueDueBack", note: "issueNote" };
  const RETURN_FIELD_IDS = { condition: "returnCondition", note: "returnNote" };
  const SERVICE_FIELD_IDS = { servicedOn: "servicePerformedOn", performedBy: "servicePerformedBy", note: "serviceNote" };

  /**
   * Client-side rules, mirroring the server's own limits.
   *
   * Same reason as the work board's: a blank required field otherwise reaches the
   * graph as `null` for a non-null variable and comes back as a schema error, which is
   * a true sentence about the wrong layer.
   */
  function registerRules() {
    const read = window.CrewApi.readValue;
    return [
      {
        field: "assetTag",
        label: "Asset tag",
        value: read("toolAssetTag"),
        required: true,
        maxLength: 24,
        pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]{1,23}$/,
        patternMessage: "Asset tag must be 2–24 characters of letters, digits, dot, slash, dash or underscore.",
      },
      { field: "name", label: "Name", value: read("toolName"), required: true, maxLength: 120 },
      {
        field: "requiresCertification",
        label: "Requires certification",
        value: read("toolRequiresCertification"),
        maxLength: 40,
        pattern: /^[a-z][a-z0-9_]{1,39}$/,
        patternMessage: "A course code is lower_snake_case, 2–40 characters, starting with a letter.",
      },
      {
        field: "serviceIntervalDays",
        label: "Service interval (days)",
        value: read("toolServiceInterval"),
        kind: "integer",
        min: 1,
        max: 3650,
      },
      { field: "lastServicedOn", label: "Last serviced", value: read("toolLastServiced"), kind: "date" },
      { field: "storageLocation", label: "Storage location", value: read("toolStorageLocation"), maxLength: 120 },
    ];
  }

  function issueRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "staffId", label: "Crew member", value: read("issueStaffId"), required: true },
      // Required on the server too, and deliberately: an issuance with no due date can
      // never show up in the overdue list (§8.5).
      { field: "dueBack", label: "Due back", value: read("issueDueBack"), required: true, kind: "date" },
      { field: "note", label: "Note", value: read("issueNote"), maxLength: 200 },
    ];
  }

  function returnRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "condition", label: "Condition", value: read("returnCondition"), required: true },
      { field: "note", label: "Note", value: read("returnNote"), maxLength: 200 },
    ];
  }

  function serviceRules() {
    const read = window.CrewApi.readValue;
    return [
      { field: "servicedOn", label: "Serviced on", value: read("servicePerformedOn"), kind: "date" },
      { field: "performedBy", label: "Performed by", value: read("servicePerformedBy"), maxLength: 120 },
      { field: "note", label: "Note", value: read("serviceNote"), maxLength: 200 },
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
      // A field-level refusal marks the offending inputs. Everything else — a tool
      // already out, a missing certification, a check that could not be run — is a
      // typed union member with its own sentence, and `describeUnion` words the
      // fail-closed ones as refusals.
      if (fieldIds && outcome.__typename === "ToolValidationFailed") {
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

  async function submitRegister(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;

    const problems = CrewApi.validateInput(registerRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, REGISTER_FIELD_IDS, elements.registerErrors);
      return;
    }

    const blankToNull = (id) => {
      const raw = CrewApi.readValue(id);
      return raw === "" ? null : raw;
    };

    await submitMutation({
      operation: CrewApi.OPERATIONS.REGISTER_TOOL,
      variables: {
        input: {
          assetTag: CrewApi.readValue("toolAssetTag"),
          name: CrewApi.readValue("toolName"),
          category: blankToNull("toolCategory"),
          // Null means "no icon chosen", which is a real answer: the tool falls back
          // to its category's glyph rather than being given an arbitrary one.
          icon: blankToNull("toolIcon"),
          requiresCertification: blankToNull("toolRequiresCertification"),
          serviceIntervalDays: CrewApi.numberOrNull(CrewApi.readValue("toolServiceInterval")),
          lastServicedOn: blankToNull("toolLastServiced"),
          storageLocation: blankToNull("toolStorageLocation"),
        },
      },
      errorsElement: elements.registerErrors,
      submitButton: elements.registerSubmit,
      successTypename: "ToolRegistered",
      fieldIds: REGISTER_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        resetRegisterForm();
      },
    });
  }

  /**
   * Clear the register form, including the two controls that are not inputs.
   *
   * `form.reset()` restores the hidden icon field but knows nothing about which
   * BUTTONS are marked pressed, so without this the next registration opens with the
   * last one's template and icon still highlighted while the form behind them is
   * blank — a form claiming to be something it is not.
   */
  function resetRegisterForm() {
    if (elements.registerForm) elements.registerForm.reset();
    selectIcon("");
    if (elements.registerTemplates) {
      for (const button of elements.registerTemplates.querySelectorAll("button[data-template]")) {
        button.setAttribute("aria-pressed", "false");
      }
    }
    window.CrewApi.clearFieldErrors(REGISTER_FIELD_IDS);
    window.CrewApi.setStatus(elements.registerErrors, "info", "");
  }

  async function submitIssue(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) {
      CrewApi.setStatus(elements.issueErrors, "error", "Pick a tool from the registry first.");
      return;
    }

    const problems = CrewApi.validateInput(issueRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, ISSUE_FIELD_IDS, elements.issueErrors);
      return;
    }

    const note = CrewApi.readValue("issueNote");
    await submitMutation({
      operation: CrewApi.OPERATIONS.ISSUE_TOOL,
      variables: {
        input: {
          toolId: tool.id,
          staffId: CrewApi.readValue("issueStaffId"),
          dueBack: CrewApi.readValue("issueDueBack"),
          note: note === "" ? null : note,
        },
      },
      errorsElement: elements.issueErrors,
      submitButton: elements.issueSubmit,
      successTypename: "ToolIssued",
      fieldIds: ISSUE_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.issueForm.reset();
      },
    });
  }

  async function submitReturn(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) {
      CrewApi.setStatus(elements.returnErrors, "error", "Pick a tool from the registry first.");
      return;
    }

    const problems = CrewApi.validateInput(returnRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, RETURN_FIELD_IDS, elements.returnErrors);
      return;
    }

    const note = CrewApi.readValue("returnNote");
    await submitMutation({
      operation: CrewApi.OPERATIONS.RETURN_TOOL,
      variables: {
        input: { toolId: tool.id, condition: CrewApi.readValue("returnCondition"), note: note === "" ? null : note },
      },
      errorsElement: elements.returnErrors,
      submitButton: elements.returnSubmit,
      successTypename: "ToolReturned",
      fieldIds: RETURN_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.returnForm.reset();
      },
    });
  }

  async function submitService(event) {
    if (event) event.preventDefault();
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) {
      CrewApi.setStatus(elements.serviceErrors, "error", "Pick a tool from the registry first.");
      return;
    }

    const problems = CrewApi.validateInput(serviceRules());
    if (problems.length > 0) {
      CrewApi.applyFieldErrors(problems, SERVICE_FIELD_IDS, elements.serviceErrors);
      return;
    }

    const blankToNull = (id) => {
      const raw = CrewApi.readValue(id);
      return raw === "" ? null : raw;
    };

    await submitMutation({
      operation: CrewApi.OPERATIONS.RECORD_SERVICE,
      variables: {
        input: {
          toolId: tool.id,
          servicedOn: blankToNull("servicePerformedOn"),
          performedBy: blankToNull("servicePerformedBy"),
          note: blankToNull("serviceNote"),
          // The version this form was built from, so a service recorded against a tool
          // somebody else has already changed is refused rather than applied blind.
          expectedVersion: tool.version === undefined ? null : tool.version,
        },
      },
      errorsElement: elements.serviceErrors,
      submitButton: elements.serviceSubmit,
      successTypename: "ServiceRecorded",
      fieldIds: SERVICE_FIELD_IDS,
      onSuccess: () => {
        closePanels();
        elements.serviceForm.reset();
      },
    });
  }

  async function retireSelected() {
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) return;
    // The button is reachable even when the state forbids retirement, so this is both
    // the guard and the explanation.
    if (blocked("retire")) return;

    const reason = value(elements.detailRetireReason);
    if (reason === "") {
      // Terminal and irreversible, so the reason is the only record of why. The server
      // refuses a blank one too; saying it here names the field.
      CrewApi.setStatus(elements.detailErrors, "error", "Retiring a tool needs a reason — it is the only record of why.");
      return;
    }

    await submitMutation({
      operation: CrewApi.OPERATIONS.RETIRE_TOOL,
      variables: { toolId: tool.id, reason: reason, expectedVersion: tool.version === undefined ? null : tool.version },
      errorsElement: elements.detailErrors,
      submitButton: elements.detailRetire,
      successTypename: "ToolRetired",
      onSuccess: () => {
        elements.detailRetireReason.value = "";
        closePanels();
      },
    });
  }

  // --- the certification gate preview ---------------------------------------

  /**
   * Ask the server's own gate whether this member may take this tool (§8.5).
   *
   * Runs on member change, before anything is written. Three things it must get right:
   *
   *   - a tool that needs no certification says nothing at all. A green "permitted"
   *     badge on a shovel trains people to ignore the badge;
   *   - `permitted: false` with an `unavailableReason` is the FAIL-CLOSED case — the
   *     check could not be run — and it is worded as a refusal, not as a warning;
   *   - a failure of this preview itself never enables anything. The button stays
   *     usable and the mutation decides; this is a courtesy, not the enforcement.
   */
  async function previewGate() {
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    const staffId = value(elements.issueStaffId);

    if (!elements.issueGate) return null;
    elements.issueGate.hidden = true;
    elements.issueGate.innerHTML = "";

    if (!tool || !staffId) return null;
    // Nothing to check, so nothing to say.
    if (!tool.requiresCertification) return null;

    const result = await CrewApi.run(CrewApi.OPERATIONS.TOOL_CERTIFICATION_CHECK, { staffId: staffId, toolId: tool.id });
    const check =
      result.ok && result.data && result.data.crewMember && result.data.crewMember.tools
        ? result.data.crewMember.tools.certificationCheck
        : null;

    if (!check) {
      // The preview failed. Say only that — claiming a refusal we did not get would be
      // as wrong as claiming a pass.
      elements.issueGate.hidden = false;
      elements.issueGate.className = "crew-notice crew-notice--warning";
      elements.issueGate.textContent =
        "The certification check could not be previewed. Issuing will still be checked on the server, and refused if it cannot be.";
      return null;
    }

    elements.issueGate.hidden = false;
    if (check.permitted) {
      elements.issueGate.className = "crew-notice crew-notice--info";
      elements.issueGate.textContent =
        "Certified for " + check.requiredCertification + " (" + CrewApi.labelForCertificationStatus(check.certificationStatus) + ").";
    } else {
      elements.issueGate.className = "crew-notice crew-notice--warning";
      elements.issueGate.textContent = check.message || "This member cannot take this tool.";
    }
    return check;
  }

  // --- the flow modal -------------------------------------------------------

  /** Where focus was before the modal opened, so closing can put it back. */
  let flowOpener = null;

  /**
   * The lifecycle as markup: the four states, then every transition between them.
   *
   * `current` highlights the state the tool you were looking at is in, which is what
   * makes this a help panel about YOUR tool rather than a generic diagram. Opened from
   * the toolbar there is no current state, and nothing is highlighted.
   *
   * Returns a STRING rather than writing to the DOM, so the modal's contents can be
   * rendered and asserted from Node like the rest of this file's helpers.
   *
   * @param {string|null} current - a tool status, or null
   * @returns {string}
   */
  function flowHtml(current) {
    const CrewApi = window.CrewApi;
    const escape = CrewApi.escapeHtml;

    const states = TOOL_FLOW_STATES.map((state) => {
      const active = state.status === current;
      return (
        '<li class="tools-flow__state tools-flow__state--' +
        escape(String(state.status).toLowerCase()) +
        (active ? " tools-flow__state--current" : "") +
        '"' +
        // `aria-current` and not colour alone: "the one you are in" has to survive
        // being read out rather than looked at.
        (active ? ' aria-current="step"' : "") +
        '><i class="fa-solid ' +
        escape(CrewApi.iconForToolStatus(state.status)) +
        '" aria-hidden="true"></i> <strong>' +
        escape(CrewApi.labelForToolStatus(state.status)) +
        "</strong>" +
        (active ? ' <span class="tools-flow__here">this tool</span>' : "") +
        '<span class="crew-muted">' +
        escape(state.summary) +
        "</span></li>"
      );
    }).join("");

    const rows = TOOL_FLOW_TRANSITIONS.map((transition) => {
      const fromCurrent = transition.from === current;
      return (
        '<tr class="' +
        (fromCurrent ? "tools-flow__row--current" : "") +
        '"><td>' +
        (transition.from ? statusBadge(transition.from) : '<span class="crew-muted">not registered yet</span>') +
        '</td><td class="tools-flow__action"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ' +
        escape(transition.action) +
        "</td><td>" +
        statusBadge(transition.to) +
        '</td><td class="crew-muted">' +
        escape(transition.note) +
        "</td></tr>"
      );
    }).join("");

    return (
      '<ul class="tools-flow__states">' +
      states +
      "</ul>" +
      '<div class="crew-table-wrap"><table class="crew-table tools-flow__table"><thead><tr>' +
      '<th scope="col">From</th><th scope="col">Action</th><th scope="col">To</th><th scope="col">Worth knowing</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      // The two rules that explain most surprises on this page, and neither is
      // visible from the buttons alone.
      '<p class="crew-notice tools-flow__footnote">' +
      "<strong>Status is never stored.</strong> Who holds a tool is computed from the append-only issuance ledger on every read, so the " +
      "registry cannot show a holder the ledger disagrees with. And nothing here deletes: a retired tool keeps its row, its ledger and " +
      "its service history." +
      "</p>"
    );
  }

  function renderFlow(current) {
    if (!elements.flowBody) return;
    elements.flowBody.innerHTML = flowHtml(current);
  }

  /** Open the flow modal, optionally highlighting a state. */
  function openFlow(current) {
    if (!elements.flowModal) return;
    flowOpener = document.activeElement;
    renderFlow(current || null);
    elements.flowModal.hidden = false;
    if (elements.flowClose) elements.flowClose.focus();
  }

  function closeFlow() {
    if (!elements.flowModal) return;
    elements.flowModal.hidden = true;
    // Focus goes back where it came from, or a keyboard user is dropped at the top of
    // the document with no idea what they just closed.
    if (flowOpener && typeof flowOpener.focus === "function") flowOpener.focus();
    flowOpener = null;
  }

  function isFlowOpen() {
    return Boolean(elements.flowModal) && elements.flowModal.hidden === false;
  }

  // --- opening the action panels --------------------------------------------

  function openIssueForm() {
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) return;
    if (blocked("issue")) return;

    openPanel("issue");
    elements.issueTool.textContent = tool.assetTag + " — " + tool.name;
    document.getElementById("issueDueBack").value = defaultDueBack(CrewApi.todayIso());
    CrewApi.setStatus(elements.issueErrors, "error", "");
    if (elements.issueGate) {
      elements.issueGate.hidden = true;
      elements.issueGate.innerHTML = "";
    }
  }

  function openReturnForm() {
    const tool = selectedTool();
    if (!tool) return;
    if (blocked("return")) return;
    openPanel("return");
    elements.returnTool.textContent =
      tool.assetTag + " — " + tool.name + (tool.currentHolder ? ", out with " + holderName(tool.currentHolder) : "");
    window.CrewApi.setStatus(elements.returnErrors, "error", "");
  }

  function openServiceForm() {
    const CrewApi = window.CrewApi;
    const tool = selectedTool();
    if (!tool) return;
    if (blocked("service")) return;
    openPanel("service");
    elements.serviceTool.textContent = tool.assetTag + " — " + tool.name;
    document.getElementById("servicePerformedOn").value = CrewApi.todayIso();
    CrewApi.setStatus(elements.serviceErrors, "error", "");
  }

  function wire() {
    for (const element of [elements.filterStatus, elements.filterCategory, elements.filterService, elements.filterRetired]) {
      if (element) element.addEventListener("change", load);
    }
    elements.reload.addEventListener("click", load);
    if (elements.print) elements.print.addEventListener("click", () => window.print());

    elements.registerToggle.addEventListener("click", () => togglePanelByName("register"));
    elements.registerCancel.addEventListener("click", () => {
      closePanels();
      // Cancel means cancel: leaving a half-filled template behind would greet the
      // next person with somebody else's chainsaw.
      resetRegisterForm();
    });
    elements.registerForm.addEventListener("submit", submitRegister);

    elements.issueForm.addEventListener("submit", submitIssue);
    // Back to the tool rather than closing everything: the user came from there, and
    // "Cancel" on a form about a tool should not lose the tool.
    elements.issueCancel.addEventListener("click", () => openDetail(selectedToolId));
    elements.issueStaffId.addEventListener("change", previewGate);

    elements.returnForm.addEventListener("submit", submitReturn);
    elements.returnCancel.addEventListener("click", () => openDetail(selectedToolId));

    elements.serviceForm.addEventListener("submit", submitService);
    elements.serviceCancel.addEventListener("click", () => openDetail(selectedToolId));

    elements.detailIssue.addEventListener("click", openIssueForm);
    elements.detailReturn.addEventListener("click", openReturnForm);
    elements.detailService.addEventListener("click", openServiceForm);
    elements.detailRetire.addEventListener("click", retireSelected);
    elements.detailClose.addEventListener("click", closePanels);

    // The flow help: from the toolbar with nothing highlighted, and from the open tool
    // with its own state marked.
    if (elements.flowOpen) elements.flowOpen.addEventListener("click", () => openFlow(null));
    if (elements.detailFlow) {
      elements.detailFlow.addEventListener("click", () => {
        const tool = selectedTool();
        openFlow(tool ? tool.status : null);
      });
    }
    if (elements.flowClose) elements.flowClose.addEventListener("click", closeFlow);
    if (elements.flowDone) elements.flowDone.addEventListener("click", closeFlow);
    if (elements.flowModal) {
      // Clicking the backdrop — the modal element itself, not its content — closes it,
      // the way every other dialog in the app behaves.
      elements.flowModal.addEventListener("click", (event) => {
        if (event.target === elements.flowModal) closeFlow();
      });
    }

    // Delegated, because the table is re-rendered on every load.
    elements.body.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-tool-id]");
      if (!trigger) return;
      event.preventDefault();
      openDetail(trigger.getAttribute("data-tool-id"));
      elements.detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    // Keyboard parity: a row is focusable, so Enter has to open it too.
    elements.body.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const row = event.target.closest("[data-tool-id]");
      if (!row) return;
      event.preventDefault();
      openDetail(row.getAttribute("data-tool-id"));
    });

    // Escape closes whatever is open, which is what a panel over the table should do.
    // The modal goes FIRST and alone: it sits on top, so one Escape must not also
    // close the panel underneath it and leave the user two steps back.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (isFlowOpen()) {
        closeFlow();
        return;
      }
      if (PANEL_NAMES.some(isPanelOpen)) closePanels();
    });
  }

  function init() {
    cacheElements();
    if (!window.CrewApi.requireSession()) return;

    // The module tab strip, before any load — present even if the data fails.
    window.CrewApi.renderModuleTabs();

    // Both are static lists, so they are rendered once rather than per load.
    renderTemplates();
    renderIconPicker();

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
    openDetail,
    openPanel,
    closePanels,
    togglePanelByName,
    isPanelOpen,
    previewGate,
    openFlow,
    closeFlow,
    isFlowOpen,
    flowHtml,
    toolActions,
    stateSummary,
    TOOL_FLOW_STATES,
    TOOL_FLOW_TRANSITIONS,
    TOOL_TEMPLATES,
    nextAssetTag,
    describeTemplate,
    applyTemplate,
    selectIcon,
    PANEL_NAMES,
    summarise,
    summaryText,
    serviceNote,
    dueBackNote,
    holderName,
    exportRows,
    defaultDueBack,
    addDays,
    DEFAULT_LOAN_DAYS,
  };
});
