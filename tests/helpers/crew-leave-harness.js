/**
 * A DOM + network stub for driving the holidays page controller in Node.
 *
 * Phase 7's exit criterion says "no console errors", which is about a browser — and
 * this repo has no browser driver and a rule against adding one (§10.2: no new
 * dependency, no build step). This harness is the closest automatable equivalent: it
 * drives the controller's REAL `init()` against a response captured from the live
 * server, so a renderer that throws on a shape the server actually produces fails a
 * test instead of blanking a page.
 *
 * Shared by `crew.leave-panels.test.js` (rendering and degradation) and
 * `crew.leave-policy-form.test.js` (configuring the policy), because both need the
 * same twenty-odd element ids and the same one-load discipline.
 *
 * What it does NOT cover: layout and CSS. Those are eyeballed.
 */
const path = require("path");

const CONTROLLER = path.join(__dirname, "..", "..", "public", "js", "pages", "crew-leave.js");
const CREW_API = path.join(__dirname, "..", "..", "public", "js", "pages", "crew-api.js");

/** Every element id `crew-leave.js` caches. Kept here so both suites agree. */
const ELEMENT_IDS = [
  "leaveStatus",
  "leaveSummary",
  "leavePolicyPanel",
  "leaveApprovals",
  "leaveCalendar",
  "leaveBalances",
  "leaveFrom",
  "leaveTo",
  "leavePrev",
  "leavePrevLabel",
  "leaveThisMonth",
  "leaveNext",
  "leaveNextLabel",
  "leaveQuarter",
  "leaveYear",
  "leaveReload",
  "leaveExportCsv",
  "leaveExportPdf",
  "leaveRequestToggle",
  "leaveRequestPanel",
  "leaveRequestForm",
  "leaveRequestCancel",
  "leaveRequestErrors",
  "leaveReqMember",
  "leaveReqType",
  "leaveReqFrom",
  "leaveReqTo",
  "leaveReqHalfStart",
  "leaveReqHalfEnd",
  "leaveReqReason",
  "leavePolicyToggle",
  "leavePolicyForm",
  "leavePolicyFormEl",
  "leavePolicyCancel",
  "leavePolicyErrors",
  "policyEntitlement",
  "policyAccrualMode",
  "policyLeaveYearStart",
  "policyCarryOverCap",
  "policyCarryOverExpires",
  "policyMinNotice",
  "policyPublicHolidays",
  "policyBlackouts",
  "leaveDayDetail",
  "crewTabs",
];

/** An element stub: ids, innerHTML, hidden, attributes and captured listeners. */
function makeElement(id) {
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    checked: false,
    hidden: true,
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    focus() {},
    reset() {},
    closest() {
      return null;
    },
  };
}

/**
 * Attributes the real markup sets, mirrored so the stub starts where a browser does.
 *
 * `aria-expanded="false"` is in `crew-leave.html` on both toggles. A stub that started
 * with no attribute at all would make an assertion about the initial state pass or fail
 * for the wrong reason.
 */
const INITIAL_ATTRIBUTES = {
  leaveRequestToggle: { "aria-expanded": "false" },
  leavePolicyToggle: { "aria-expanded": "false" },
};

function stubDom() {
  const elements = new Map();
  for (const id of ELEMENT_IDS) {
    const element = makeElement(id);
    Object.assign(element.attributes, INITIAL_ATTRIBUTES[id] || {});
    elements.set(id, element);
  }

  global.document = {
    // "loading" so requiring the controller does NOT auto-init: it defers to a
    // DOMContentLoaded listener that never fires here. The harness drives `init()`
    // itself, so exactly one load happens and the call log is meaningful.
    readyState: "loading",
    getElementById: (id) => {
      // Elements the controller creates at render time (the set-up button, the CSV
      // anchor) are made on demand, so a test can click them.
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: () => makeElement("created"),
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} },
  };
  return elements;
}

/** The real CrewApi, with only the network and the session guard replaced. */
function stubApi({ data, errors, run }) {
  const CrewApi = require(CREW_API);
  const calls = [];

  global.window = global.window || {};
  global.window.CrewApi = Object.assign({}, CrewApi, {
    requireSession: () => true,
    async run(operation, variables) {
      calls.push({ operation, variables });
      // `run` lets a test answer differently per operation — a policy save that is
      // refused, say — while everything else keeps returning the board.
      if (typeof run === "function") return run(operation, variables);
      return { ok: !errors, status: 200, data, errors };
    },
  });
  global.window.location = { pathname: "/crew-leave.html", search: "" };
  global.window.print = () => {};
  global.window.prompt = () => "because";
  return { calls, CrewApi };
}

/**
 * Stub everything, then drive the controller's real `init()` once.
 *
 * Awaits a macrotask so `init`'s fire-and-forget `load()` settles — that is the path
 * a browser takes, and driving it rather than calling `load()` directly is what makes
 * the "one round trip" assertion mean anything.
 *
 * @returns {Promise<{elements: Map, calls: Array, CrewApi: object, page: object}>}
 */
async function loadLeavePage(response) {
  const elements = stubDom();
  const stub = stubApi(response || {});

  // Fresh module each time: the controller holds the last board in a closure.
  delete require.cache[require.resolve(CONTROLLER)];
  const page = require(CONTROLLER);

  page.init();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { elements, calls: stub.calls, CrewApi: stub.CrewApi, page };
}

/** Fire a captured listener, awaiting whatever it returns. */
async function fire(element, event, payload) {
  if (!element || !element.listeners[event]) throw new Error(`no ${event} listener on #${element && element.id}`);
  return element.listeners[event](payload || { preventDefault() {} });
}

module.exports = { ELEMENT_IDS, loadLeavePage, fire, makeElement };
