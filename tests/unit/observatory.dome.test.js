import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * The Observatory sky dome, driven through its own interactions and read back
 * through the state mirror it publishes — never through pixels. That is the
 * whole point of the feature: a canvas you can assert against.
 *
 * The project has no DOM test environment (jsdom/happy-dom), so the page runs
 * against a minimal hand-rolled shim covering only what it touches — the same
 * approach tests/unit/porky-chat-shared-history.test.js takes. `getContext`
 * deliberately answers null, which short-circuits every drawing call: the test
 * is about the state the page reports, not the strokes it makes.
 */
const observatoryPage = require("../../public/js/pages/observatory.js");
const observatoryService = require("../../services/observatory.service.js");

const {
  ObservatoryPage,
  clampViewport,
  projectAltAzToDome,
  projectDomeToCanvas,
  timeScaleFromSliderPosition,
  sliderPositionFromTimeScale,
} = observatoryPage;

const CANVAS_SIZE = 820;
const CANVAS_RADIUS = CANVAS_SIZE / 2 - 42;

const ELEMENT_IDS = [
  "observatoryShell",
  "observatoryTimeBadge",
  "observatoryLiveBadge",
  "observatoryCanvas",
  "observatoryCanvasHost",
  "observatoryDomeMirror",
  "observatoryViewportReadout",
  "observatoryZoomInBtn",
  "observatoryZoomOutBtn",
  "observatoryResetViewBtn",
  "observatoryHint",
  "observatoryLabelsToggle",
  "observatoryConstellationsToggle",
  "observatoryMagnitudeRange",
  "observatoryMagnitudeValue",
  "observatoryObjectTypeFilter",
  "observatoryConstellationFilter",
  "observatorySearchInput",
  "observatoryClearFiltersBtn",
  "observatoryTimeScaleRange",
  "observatoryTimeScaleValue",
  "observatorySyncNowBtn",
  "observatoryPresetSelect",
  "observatoryGeolocateBtn",
  "observatoryLatitudeInput",
  "observatoryLongitudeInput",
  "observatoryLocationSummary",
  "observatoryObjectName",
  "observatoryObjectBadge",
  "observatoryObjectSummary",
  "observatoryObjectMeta",
  "observatoryVisibleCount",
  "observatoryVisibleList",
  "observatoryConstellationList",
  "observatoryConstellationCount",
  "observatoryConstellationSummary",
];

function makeElement(tagName, id = "") {
  const element = {
    tagName,
    id,
    value: "",
    textContent: "",
    className: "",
    checked: true,
    disabled: false,
    children: [],
    attributes: new Map(),
    listeners: new Map(),
    classList: {
      classes: new Set(),
      toggle(name, force) {
        const next = force === undefined ? !this.classes.has(name) : force === true;
        if (next) this.classes.add(name);
        else this.classes.delete(name);
      },
      contains(name) {
        return this.classes.has(name);
      },
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      // A real <select> adopts its first option when it has no value — the
      // detail that makes rebuilding an option list destructive.
      if (this.tagName === "select" && this.value === "" && child.tagName === "option") {
        this.value = child.value;
      }
      return child;
    },
    remove() {
      const index = this.parent?.children.indexOf(this) ?? -1;
      if (index >= 0) this.parent.children.splice(index, 1);
      this.parent = null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    // Enough of closest() for the delegated list handlers: "tag[attribute]".
    closest(selector) {
      const parsed = /^([a-z]+)\[([\w-]+)\]$/.exec(selector);
      if (!parsed) return null;
      const [, tagName, attribute] = parsed;
      let node = this;
      while (node) {
        if (node.tagName === tagName && node.attributes.has(attribute)) return node;
        node = node.parent;
      }
      return null;
    },
    emit(type, event = {}) {
      (this.listeners.get(type) || []).forEach((handler) => handler({ preventDefault() {}, ...event }));
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    // Null context: the page skips every draw call, which is exactly the part
    // this test has no opinion about.
    getContext() {
      return null;
    },
  };

  Object.defineProperty(element, "innerHTML", {
    get() {
      return "";
    },
    set() {
      element.children.length = 0;
      // Emptying a <select> drops its selection. Modelling that is the whole
      // reason this shim can catch a rebuilt dropdown losing the user's choice.
      if (element.tagName === "select") {
        element.value = "";
      }
    },
  });

  return element;
}

function makeDom(search = "") {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement("div", id)]));
  elements.get("observatoryCanvas").tagName = "canvas";
  ["observatoryPresetSelect", "observatoryObjectTypeFilter", "observatoryConstellationFilter"].forEach((id) => {
    elements.get(id).tagName = "select";
  });
  const body = makeElement("body");

  const documentRef = {
    body,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tagName) => makeElement(tagName),
  };

  const windowRef = {
    location: { search },
    devicePixelRatio: 1,
    addEventListener() {},
  };

  return { documentRef, windowRef, elements };
}

/** Records the stream URLs the page asks for instead of opening a connection. */
function installFakeEventSource() {
  const opened = [];
  const previous = globalThis.EventSource;

  globalThis.EventSource = class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      opened.push(url);
    }
    addEventListener() {}
    close() {
      this.readyState = 2;
    }
  };

  return {
    opened,
    restore() {
      if (previous === undefined) delete globalThis.EventSource;
      else globalThis.EventSource = previous;
    },
  };
}

const OBSERVER_WARSAW = { id: "warsaw", label: "Warsaw, Poland", latitudeDeg: 52.2297, longitudeDeg: 21.0122 };

/** A snapshot in the shape the SSE stream pushes, built from the real service. */
function buildSnapshot(overrides = {}) {
  const snapshot = observatoryService.getSnapshot({
    timestamp: "2026-05-31T21:00:00.000Z",
    latitudeDeg: OBSERVER_WARSAW.latitudeDeg,
    longitudeDeg: OBSERVER_WARSAW.longitudeDeg,
    magnitudeLimit: 4.2,
  });

  return { ...snapshot, ...overrides };
}

function startPage(search = "") {
  const dom = makeDom(search);
  const page = new ObservatoryPage({
    documentRef: dom.documentRef,
    windowRef: dom.windowRef,
    nowProvider: () => new Date("2026-05-31T21:00:00.000Z"),
  });
  page.init();
  return { page, ...dom };
}

function mirrorNodes(elements) {
  return elements.get("observatoryDomeMirror").children;
}

function hostAttribute(elements, name) {
  return elements.get("observatoryCanvasHost").getAttribute(name);
}

function constellationRows(elements) {
  return elements
    .get("observatoryConstellationList")
    .children.map((item) => item.children[0])
    .filter(Boolean);
}

function clickRow(elements, button) {
  elements.get("observatoryConstellationList").emit("click", { target: button });
}

/**
 * A point on a constellation line that is not also a point on a star — so a
 * click there can only be a hit on the figure.
 */
function findLineTarget(page) {
  for (const figure of page.constellationFigures) {
    for (const [from, to] of figure.segments) {
      if (from.inView !== true || to.inView !== true) continue;
      const midX = (from.canvasX + to.canvasX) / 2;
      const midY = (from.canvasY + to.canvasY) / 2;
      const nearAnyObject = page.visibleObjects.some((object) => Math.hypot(object.canvasX - midX, object.canvasY - midY) <= 20);
      if (!nearAnyObject && Math.hypot(to.canvasX - from.canvasX, to.canvasY - from.canvasY) > 80) {
        return { figure, x: midX, y: midY };
      }
    }
  }
  return null;
}

describe("observatory sky dome — viewport geometry", () => {
  it("clamps zoom to the supported range and pins the aperture centre inside the dome", () => {
    expect(clampViewport({ zoom: 0.2, panX: 0, panY: 0 }).zoom).toBe(1);
    expect(clampViewport({ zoom: 99, panX: 0, panY: 0 }).zoom).toBe(8);

    // A pan target outside the unit disc is pulled back onto its rim, so the
    // centre of the view can never leave the sky.
    const dragged = clampViewport({ zoom: 2, panX: 4, panY: 4 });
    expect(Math.hypot(dragged.panX, dragged.panY)).toBeCloseTo(1, 4);
  });

  it("agrees with GET /observatory/viewport object for object", () => {
    const query = {
      timestamp: "2026-05-31T21:00:00.000Z",
      latitudeDeg: OBSERVER_WARSAW.latitudeDeg,
      longitudeDeg: OBSERVER_WARSAW.longitudeDeg,
      magnitudeLimit: 4.2,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      zoom: 2.5,
      panX: 0.3,
      panY: -0.2,
    };
    const server = observatoryService.getViewport(query);
    const canvas = { centerX: CANVAS_SIZE / 2, centerY: CANVAS_SIZE / 2, radius: CANVAS_RADIUS };
    const viewport = { zoom: server.viewport.zoom, panX: server.viewport.panX, panY: server.viewport.panY };

    expect(server.dome.objects.length).toBeGreaterThan(10);
    server.dome.objects.forEach((object) => {
      const dome = projectAltAzToDome(object.altitudeDeg, object.azimuthDeg);
      const point = projectDomeToCanvas(dome, viewport, canvas);

      expect(dome.x).toBeCloseTo(object.domeX, 3);
      expect(dome.y).toBeCloseTo(object.domeY, 3);
      // Within half a pixel: the endpoint publishes alt/az rounded to two
      // decimals, so re-projecting from what it published cannot be exact.
      expect(point.x).toBeCloseTo(object.canvasX, 0);
      expect(point.y).toBeCloseTo(object.canvasY, 0);
    });
  });

  it("maps the time-flow slider onto a continuous ramp with the old endpoints intact", () => {
    expect(timeScaleFromSliderPosition(0)).toBe(0);
    expect(timeScaleFromSliderPosition(1)).toBe(1);
    expect(timeScaleFromSliderPosition(100)).toBe(3600);
    expect(sliderPositionFromTimeScale(0)).toBe(0);
    expect(sliderPositionFromTimeScale(1)).toBe(1);
    expect(sliderPositionFromTimeScale(3600)).toBe(100);

    const ramp = Array.from({ length: 101 }, (_, position) => timeScaleFromSliderPosition(position));
    expect(ramp.every((value, index) => index === 0 || value >= ramp[index - 1])).toBe(true);
    // Continuous, not five presets: the old select's four speeds could not
    // produce a value like ×7.
    expect(new Set(ramp).size).toBeGreaterThan(40);
  });
});

describe("observatory sky dome — state mirror", () => {
  let stream;

  beforeEach(() => {
    stream = installFakeEventSource();
  });

  afterEach(() => {
    stream.restore();
  });

  it("publishes the whole dome, flagging which objects the aperture is showing", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    const domeCount = Number(hostAttribute(elements, "data-dome-count"));
    expect(domeCount).toBeGreaterThan(10);
    expect(hostAttribute(elements, "data-in-view-count")).toBe(String(domeCount));
    expect(hostAttribute(elements, "data-zoom")).toBe("1.00");
    expect(hostAttribute(elements, "data-center-altitude")).toBe("90.00");
    expect(hostAttribute(elements, "data-center-azimuth")).toBe("0.00");
    expect(hostAttribute(elements, "data-magnitude-limit")).toBe("4.2");
    expect(mirrorNodes(elements)).toHaveLength(domeCount);

    const moon = mirrorNodes(elements).find((node) => node.getAttribute("data-object-id") === "moon");
    expect(moon.getAttribute("data-object-type")).toBe("moon");
    expect(moon.getAttribute("data-in-view")).toBe("true");
    expect(Number(moon.getAttribute("data-altitude"))).toBeGreaterThan(0);

    // Zooming in keeps the full dome in the mirror and only moves objects out of
    // view — an out-of-view object is a fact about the viewport, not missing data.
    page.setViewport({ zoom: 4, panX: 0, panY: 0 });

    expect(hostAttribute(elements, "data-zoom")).toBe("4.00");
    expect(hostAttribute(elements, "data-dome-count")).toBe(String(domeCount));
    expect(mirrorNodes(elements)).toHaveLength(domeCount);
    const inViewCount = Number(hostAttribute(elements, "data-in-view-count"));
    expect(inViewCount).toBeLessThan(domeCount);
    expect(mirrorNodes(elements).filter((node) => node.getAttribute("data-in-view") === "true")).toHaveLength(inViewCount);
  });

  it("reports the aperture centre in alt/az as the view is panned", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    page.setViewport({ zoom: 1, panX: 0, panY: -0.5 });
    expect(hostAttribute(elements, "data-center-azimuth")).toBe("0.00");
    expect(hostAttribute(elements, "data-center-altitude")).toBe("45.00");

    page.setViewport({ zoom: 1, panX: 1, panY: 0 });
    expect(hostAttribute(elements, "data-center-azimuth")).toBe("90.00");
    expect(hostAttribute(elements, "data-center-altitude")).toBe("0.00");

    page.resetView();
    expect(hostAttribute(elements, "data-pan-x")).toBe("0.0000");
    expect(hostAttribute(elements, "data-pan-y")).toBe("0.0000");
    expect(hostAttribute(elements, "data-zoom")).toBe("1.00");
  });

  it("pans on drag and does not turn the drag into an object selection", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());
    const canvas = elements.get("observatoryCanvas");
    const selectedBefore = hostAttribute(elements, "data-selected-object");

    canvas.emit("pointerdown", { pointerId: 1, clientX: 410, clientY: 410 });
    canvas.emit("pointermove", { pointerId: 1, clientX: 310, clientY: 410 });
    canvas.emit("pointerup", { pointerId: 1, clientX: 310, clientY: 410 });

    // Dragging the sky 100px left swings the aperture centre the other way.
    expect(Number(hostAttribute(elements, "data-pan-x"))).toBeCloseTo(100 / CANVAS_RADIUS, 3);
    expect(Number(hostAttribute(elements, "data-pan-y"))).toBeCloseTo(0, 6);

    canvas.emit("click", { clientX: 310, clientY: 410 });
    expect(hostAttribute(elements, "data-selected-object")).toBe(selectedBefore);
  });

  it("zooms on the wheel about the pointer and keeps that point where it was", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    // A dome point 100px right of centre, at zoom 1, is at dome x = 100/radius.
    const anchorDomeX = 100 / CANVAS_RADIUS;
    elements.get("observatoryCanvas").emit("wheel", { deltaY: -120, clientX: 510, clientY: 410 });

    const zoom = Number(hostAttribute(elements, "data-zoom"));
    const panX = Number(hostAttribute(elements, "data-pan-x"));
    expect(zoom).toBeGreaterThan(1);
    // Still under the cursor: pan + offset/(radius*zoom) === the original point.
    expect(panX + 100 / (CANVAS_RADIUS * zoom)).toBeCloseTo(anchorDomeX, 4);
  });

  it("offers a keyboard path to everything the mouse can do", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());
    const canvas = elements.get("observatoryCanvas");

    canvas.emit("keydown", { key: "ArrowRight" });
    expect(Number(hostAttribute(elements, "data-pan-x"))).toBeCloseTo(0.05, 6);

    canvas.emit("keydown", { key: "ArrowUp", shiftKey: true });
    expect(Number(hostAttribute(elements, "data-pan-y"))).toBeCloseTo(-0.2, 6);

    canvas.emit("keydown", { key: "+" });
    expect(Number(hostAttribute(elements, "data-zoom"))).toBeGreaterThan(1);

    canvas.emit("keydown", { key: "0" });
    expect(hostAttribute(elements, "data-zoom")).toBe("1.00");
    expect(hostAttribute(elements, "data-pan-x")).toBe("0.0000");
    expect(hostAttribute(elements, "data-pan-y")).toBe("0.0000");
  });

  it("drops every source of motion under ?animate=0", () => {
    const { page, documentRef, elements } = startPage("?animate=0&timestamp=2026-05-31T21:00:00.000Z");
    page.applySnapshot(buildSnapshot());

    expect(page.animate).toBe(false);
    expect(hostAttribute(elements, "data-animate")).toBe("0");
    expect(hostAttribute(elements, "data-time-scale")).toBe("0");
    expect(hostAttribute(elements, "data-timestamp")).toBe("2026-05-31T21:00:00.000Z");
    expect(documentRef.body.classList.contains("is-frozen")).toBe(true);
    expect(elements.get("observatoryTimeScaleRange").disabled).toBe(true);
    expect(elements.get("observatoryLiveBadge").textContent).toBe("Frozen");
    // A locale string is one more thing that differs between a laptop and CI.
    expect(elements.get("observatoryTimeBadge").textContent).toBe("2026-05-31T21:00:00.000Z");
  });

  it("restores the viewport named in the query string", () => {
    const { page, elements } = startPage("?zoom=3&panX=0.25&panY=-0.1&magnitudeLimit=2.5");
    page.applySnapshot(buildSnapshot({ sky: { ...buildSnapshot().sky, magnitudeLimit: 2.5 } }));

    expect(hostAttribute(elements, "data-zoom")).toBe("3.00");
    expect(hostAttribute(elements, "data-pan-x")).toBe("0.2500");
    expect(hostAttribute(elements, "data-pan-y")).toBe("-0.1000");
    expect(hostAttribute(elements, "data-magnitude-limit")).toBe("2.5");
    expect(page.getViewportState().zoom).toBe(3);
  });
});

describe("observatory constellations", () => {
  let stream;

  beforeEach(() => {
    stream = installFakeEventSource();
  });

  afterEach(() => {
    stream.restore();
  });

  it("selects a figure when the click lands on one of its lines, and clears it on a second click", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    const target = findLineTarget(page);
    expect(target, "no constellation line was clear of every star").not.toBeNull();
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");

    const canvas = elements.get("observatoryCanvas");
    canvas.emit("click", { clientX: target.x, clientY: target.y });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe(target.figure.name);

    // Clicking the highlighted figure again is how you put it down.
    canvas.emit("click", { clientX: target.x, clientY: target.y });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");
  });

  it("ignores clicks on empty sky and on figures whose lines are hidden", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());
    const canvas = elements.get("observatoryCanvas");
    const target = findLineTarget(page);

    // Outside the dome entirely.
    canvas.emit("click", { clientX: 4, clientY: 4 });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");

    // Lines off: there is nothing drawn there to have clicked.
    page.state.showConstellations = false;
    page.render();
    canvas.emit("click", { clientX: target.x, clientY: target.y });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");

    page.state.showConstellations = true;
    page.render();
    canvas.emit("click", { clientX: target.x, clientY: target.y });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe(target.figure.name);
  });

  it("lights up the figure a selected star belongs to", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    const figure = page.constellationFigures.find((candidate) => candidate.starCount >= 3);
    const star = figure.stars.find((candidate) => candidate.inView);
    elements.get("observatoryCanvas").emit("click", { clientX: star.canvasX, clientY: star.canvasY });

    expect(hostAttribute(elements, "data-selected-object")).toBe(star.id);
    expect(hostAttribute(elements, "data-selected-constellation")).toBe(figure.name);
  });

  it("offers the same selection as a list, without any pixel arithmetic", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    const rows = constellationRows(elements);
    expect(rows.length).toBeGreaterThan(10);
    expect(hostAttribute(elements, "data-constellation-count")).toBe(String(rows.length));
    expect(rows.every((row) => row.getAttribute("data-selected") === "false")).toBe(true);

    const row = rows.find((candidate) => candidate.getAttribute("data-constellation-name") === "Ursa Major") || rows[0];
    const name = row.getAttribute("data-constellation-name");
    clickRow(elements, row);

    expect(hostAttribute(elements, "data-selected-constellation")).toBe(name);
    const selectedRow = constellationRows(elements).find((candidate) => candidate.getAttribute("data-constellation-name") === name);
    expect(selectedRow.getAttribute("data-selected")).toBe("true");
    expect(selectedRow.getAttribute("aria-pressed")).toBe("true");
    expect(Number(selectedRow.getAttribute("data-star-count"))).toBeGreaterThanOrEqual(2);
    expect(elements.get("observatoryConstellationSummary").textContent).toContain(name);

    // Escape on the dome is the keyboard way out.
    elements.get("observatoryCanvas").emit("keydown", { key: "Escape" });
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");
  });

  it("drops a highlight when the figure it names stops being drawn", () => {
    const { page, elements } = startPage();
    page.applySnapshot(buildSnapshot());

    const name = page.constellationFigures[0].name;
    page.selectConstellation(name);
    expect(hostAttribute(elements, "data-selected-constellation")).toBe(name);

    // Planets only: no stars, so no figures, so nothing left to highlight.
    page.state.filters.objectType = "planet";
    page.render();

    expect(hostAttribute(elements, "data-constellation-count")).toBe("0");
    expect(hostAttribute(elements, "data-selected-constellation")).toBe("");
    expect(elements.get("observatoryConstellationList").children).toHaveLength(1);
  });

  it("groups the same figures the viewport endpoint does", () => {
    const { page } = startPage();
    page.applySnapshot(buildSnapshot());

    const server = observatoryService.getViewport({
      timestamp: "2026-05-31T21:00:00.000Z",
      latitudeDeg: OBSERVER_WARSAW.latitudeDeg,
      longitudeDeg: OBSERVER_WARSAW.longitudeDeg,
      magnitudeLimit: 4.2,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
    });

    const clientNames = page.constellationFigures.map((figure) => figure.name).sort();
    const serverNames = server.dome.constellations.map((figure) => figure.name).sort();
    expect(clientNames).toEqual(serverNames);
    expect(clientNames.length).toBeGreaterThan(15);

    server.dome.constellations.forEach((serverFigure) => {
      const clientFigure = page.constellationFigures.find((candidate) => candidate.name === serverFigure.name);
      expect(clientFigure.starCount, serverFigure.name).toBe(serverFigure.starCount);
      expect(clientFigure.segmentCount, serverFigure.name).toBe(serverFigure.segmentCount);
      expect(clientFigure.brightestStar.id, serverFigure.name).toBe(serverFigure.brightestObjectId);
      expect(clientFigure.centerX, serverFigure.name).toBeCloseTo(serverFigure.centerCanvasX, 1);
      expect(clientFigure.centerY, serverFigure.name).toBeCloseTo(serverFigure.centerCanvasY, 1);
    });
  });

  it("treats a line between two constellations as an asterism belonging to neither", () => {
    // The Summer Triangle joins Vega, Deneb and Altair across three
    // constellations; it is drawn, but it is not a figure you can select.
    const figures = observatoryPage.buildConstellationFigures(
      [
        { id: "vega", type: "star", constellation: "Lyra", magnitude: 0.03, canvasX: 100, canvasY: 100, inView: true },
        { id: "deneb", type: "star", constellation: "Cygnus", magnitude: 1.25, canvasX: 200, canvasY: 80, inView: true },
        { id: "sadr", type: "star", constellation: "Cygnus", magnitude: 2.23, canvasX: 220, canvasY: 140, inView: true },
      ],
      [
        { fromId: "vega", toId: "deneb" },
        { fromId: "deneb", toId: "sadr" },
      ],
    );

    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ name: "Cygnus", starCount: 2, segmentCount: 1 });
    expect(figures[0].brightestStar.id).toBe("deneb");
  });
});

describe("observatory observer location", () => {
  let stream;

  beforeEach(() => {
    stream = installFakeEventSource();
  });

  afterEach(() => {
    stream.restore();
  });

  it("keeps custom coordinates selected instead of snapping back to the matching preset", () => {
    const { page, elements } = startPage();
    const presetSelect = elements.get("observatoryPresetSelect");

    // The default coordinates ARE Warsaw's, which is exactly the case that used
    // to break: the backend reverse-matched them and the dropdown jumped back.
    presetSelect.value = "custom";
    presetSelect.emit("change");

    expect(page.location.id).toBe("custom");
    expect(presetSelect.value).toBe("custom");
    expect(stream.opened.at(-1)).toContain("presetId=custom");

    // Snapshots that insist these coordinates are "Warsaw" must not move the
    // control the user just set — and neither must the option list they carry,
    // which arrives on every tick.
    const optionsBefore = presetSelect.children;
    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));
    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));
    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));

    expect(presetSelect.children).toHaveLength(optionsBefore.length);
    expect(page.location.id).toBe("custom");
    expect(presetSelect.value).toBe("custom");
    expect(elements.get("observatoryLatitudeInput").value).toBe("52.2297");
    expect(elements.get("observatoryLongitudeInput").value).toBe("21.0122");
  });

  it("holds manually typed coordinates across incoming snapshots", () => {
    const { page, elements } = startPage();
    const latitudeInput = elements.get("observatoryLatitudeInput");

    latitudeInput.value = "10";
    elements.get("observatoryLongitudeInput").value = "15";
    latitudeInput.emit("change");

    expect(page.location).toMatchObject({ id: "custom", latitudeDeg: 10, longitudeDeg: 15 });

    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));
    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));

    expect(latitudeInput.value).toBe("10.0000");
    expect(elements.get("observatoryLongitudeInput").value).toBe("15.0000");
    expect(hostAttribute(elements, "data-observer-latitude")).toBe("10.0000");
  });

  it("takes the backend's name for a spot without taking its coordinates", () => {
    const { page, elements } = startPage();
    const presetSelect = elements.get("observatoryPresetSelect");

    presetSelect.value = "tokyo";
    presetSelect.emit("change");
    expect(page.location).toMatchObject({ id: "tokyo", latitudeDeg: 35.6762, longitudeDeg: 139.6503 });

    // Same spot, different label — a relabel is the one thing a snapshot may do.
    page.applySnapshot(buildSnapshot({ observer: { id: "tokyo", label: "Tokyo HQ", latitudeDeg: 35.6762, longitudeDeg: 139.6503 } }));
    expect(elements.get("observatoryLocationSummary").textContent).toContain("Tokyo HQ");
    expect(page.location).toMatchObject({ latitudeDeg: 35.6762, longitudeDeg: 139.6503 });

    // A snapshot naming a different spot is a stale answer, and is ignored.
    page.applySnapshot(buildSnapshot({ observer: { ...OBSERVER_WARSAW } }));
    expect(page.location).toMatchObject({ id: "tokyo", latitudeDeg: 35.6762, longitudeDeg: 139.6503 });
    expect(elements.get("observatoryLatitudeInput").value).toBe("35.6762");
  });
});
