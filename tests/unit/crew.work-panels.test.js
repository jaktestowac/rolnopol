import { describe, it, expect, beforeEach } from "vitest";

// Work board panels — exactly one open at a time.
//
// The bug: the three toolbar buttons each toggled their own panel independently, so
// clicking two of them left two stacked forms below the toolbar with no clue which
// button had produced what. They all occupy the same strip, so only one may be up.
//
// These are BEHAVIOURAL assertions driven through a DOM stub, not string matches on
// the source: the thing worth pinning is "opening one closes the others", and a regex
// over the controller could pass while the behaviour was broken.
const path = require("path");

const PANEL_IDS = {
  assign: "boardAssignPanel",
  log: "boardLogPanel",
  duty: "boardDutyPanel",
  shift: "boardShiftPanel",
};
const TOGGLE_IDS = { assign: "boardAssignToggle", log: "boardLogToggle", duty: "boardDutyToggle" };

let CrewWork;
let elements;

/** A DOM stub rich enough for the panel group: hidden flags and aria-expanded. */
function stubDom() {
  elements = new Map();
  const make = (id) => ({
    id,
    hidden: true,
    value: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    focus() {},
    addEventListener() {},
    scrollIntoView() {},
    reset() {},
    closest() {
      return null;
    },
    innerHTML: "",
    textContent: "",
  });

  global.document = {
    readyState: "complete",
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, make(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: make,
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} },
    cookie: "rolnopolLoginTime=1",
  };
  global.window = global;
  global.window.location = { pathname: "/crew-work.html", search: "" };
}

const open = (name) => document.getElementById(PANEL_IDS[name]).hidden === false;
const expanded = (name) => document.getElementById(TOGGLE_IDS[name]).attributes["aria-expanded"];
const openNames = () => Object.keys(PANEL_IDS).filter(open);

beforeEach(() => {
  stubDom();
  // Fresh module per test: the panel group reads `elements`, which init() caches.
  const modulePath = path.join(__dirname, "..", "..", "public", "js", "pages", "crew-work.js");
  const apiPath = path.join(__dirname, "..", "..", "public", "js", "pages", "crew-api.js");
  delete require.cache[require.resolve(modulePath)];
  delete require.cache[require.resolve(apiPath)];
  global.CrewApi = require(apiPath);
  global.window.CrewApi = global.CrewApi;
  // init() loads the board; an empty-but-valid payload keeps that path realistic
  // without the panel tests depending on any particular data.
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        crew: { totalCount: 0, nodes: [] },
        dutyTypes: [],
        shifts: [],
        workLog: [],
        workRollup: { from: null, to: null, hours: 0, entries: 0, byActivity: [] },
      },
      extensions: { cost: 1, depth: 1, storeReads: 1, durationMs: 1, pillars: ["profiles", "work"] },
    }),
  });
  CrewWork = require(modulePath);
  CrewWork.init();
});

describe("the panel group", () => {
  it("starts with nothing open", () => {
    expect(openNames()).toEqual([]);
  });

  it("opens one panel", () => {
    CrewWork.openPanel("assign");
    expect(openNames()).toEqual(["assign"]);
    expect(expanded("assign")).toBe("true");
  });

  it("closes the previous panel when another opens — the actual bug", () => {
    CrewWork.openPanel("assign");
    CrewWork.openPanel("log");
    expect(openNames()).toEqual(["log"]);
    // …and the button of the panel that closed stops claiming to be expanded.
    expect(expanded("assign")).toBe("false");
    expect(expanded("log")).toBe("true");
  });

  it("never leaves two open, whatever the order", () => {
    for (const first of CrewWork.PANEL_NAMES) {
      for (const second of CrewWork.PANEL_NAMES) {
        CrewWork.openPanel(first);
        CrewWork.openPanel(second);
        expect(openNames(), `${first} then ${second}`).toEqual([second]);
      }
    }
  });

  it("closes everything on closePanels", () => {
    CrewWork.openPanel("duty");
    CrewWork.closePanels();
    expect(openNames()).toEqual([]);
    for (const name of Object.keys(TOGGLE_IDS)) expect(expanded(name)).toBe("false");
  });

  it("treats a second click on the SAME button as a close", () => {
    CrewWork.togglePanelByName("assign");
    expect(openNames()).toEqual(["assign"]);
    CrewWork.togglePanelByName("assign");
    expect(openNames()).toEqual([]);
    expect(expanded("assign")).toBe("false");
  });

  it("switches straight between panels when a different button is clicked", () => {
    CrewWork.togglePanelByName("assign");
    CrewWork.togglePanelByName("duty");
    expect(openNames()).toEqual(["duty"]);
  });

  it("includes the shift detail in the group — 'only one panel' has to mean all of them", () => {
    CrewWork.openPanel("shift");
    expect(openNames()).toEqual(["shift"]);
    CrewWork.togglePanelByName("log");
    expect(openNames()).toEqual(["log"]);
  });

  it("reports which panel is open", () => {
    expect(CrewWork.isPanelOpen("log")).toBe(false);
    CrewWork.openPanel("log");
    expect(CrewWork.isPanelOpen("log")).toBe(true);
    expect(CrewWork.isPanelOpen("assign")).toBe(false);
  });

  it("tolerates an unknown panel name instead of throwing", () => {
    CrewWork.openPanel("assign");
    expect(() => CrewWork.openPanel("nonsense")).not.toThrow();
    // Everything closes, because nothing matched — no panel is left half-open.
    expect(openNames()).toEqual([]);
  });

  it("covers every panel the board has, so a new one cannot be left out of the group", () => {
    expect(CrewWork.PANEL_NAMES.slice().sort()).toEqual(Object.keys(PANEL_IDS).sort());
  });
});
