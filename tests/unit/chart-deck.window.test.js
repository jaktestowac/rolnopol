import { describe, it, expect } from "vitest";

/**
 * The ChartDeck scrub window: how much of the retained history a chart shows,
 * and where over that history the shown part sits.
 *
 * Every assertion here reads the state the deck publishes — `data-*` on its
 * root, the scrub control's own value/max, and the values it hands the renderer
 * — never the drawn SVG. A chart is only testable to the extent it says what it
 * is showing.
 */
const ChartKit = require("../../public/js/utils/chart-kit.js");
const ChartDeck = require("../../public/js/utils/chart-deck.js");
const { createDom } = require("../helpers/dom-shim.js");

const BASE_MS = Date.parse("2026-05-31T21:00:00.000Z");
const CADENCE_MS = 4000;

/** Reading n, four seconds after reading n-1 — a stand-in for a stream frame. */
function reading(index) {
  return { at: new Date(BASE_MS + index * CADENCE_MS).toISOString(), value: 10 + index };
}

const ELEMENTS = [
  { id: "deckRoot" },
  { id: "deckEmpty" },
  { id: "scrubBar" },
  { id: "scrubReadout" },
  { id: "scrubLiveBtn", tagName: "button", disabled: true },
  { id: "scrub", tagName: "input", type: "range", value: "0", attributes: { min: "0", max: "0", step: "1" } },
  { id: "historySize", tagName: "input", type: "range", value: "30", attributes: { min: "10", max: "240", step: "5" } },
  { id: "columns", tagName: "input", type: "range", value: "2", attributes: { min: "1", max: "3", step: "1" } },
  { id: "windowReadout", attributes: { "data-ck-readout": "window" } },
  { id: "columnsReadout", attributes: { "data-ck-readout": "columns" } },
];

function startDeck({ windowSize = 30 } = {}) {
  const rendered = [];
  const recordingKit = Object.assign({}, ChartKit, {
    render(spec, options) {
      rendered.push({ key: spec.key, values: spec.values.slice(), xLabels: (spec.xLabels || []).slice() });
      return ChartKit.render(spec, options);
    },
  });

  const dom = createDom({ elements: ELEMENTS, globals: { ChartKit: recordingKit } });
  const deck = ChartDeck.create({
    documentRef: dom.documentRef,
    windowRef: dom.windowRef,
    storageKey: "test.deck",
    rootId: "deckRoot",
    emptyId: "deckEmpty",
    scrubBarId: "scrubBar",
    scrubReadoutId: "scrubReadout",
    followBtnId: "scrubLiveBtn",
    controls: { window: "historySize", columns: "columns", scrub: "scrub" },
    defaults: { window: windowSize },
    countLabel: "readings",
    series: [{ key: "temp", label: "Temperature", unit: "°C", precision: 1, hue: 0, read: (row) => row.value }],
    rowStamp: (row) => row.at,
  });

  deck.init();

  return {
    dom,
    deck,
    rendered,
    feed(count, cap = 240) {
      for (let index = 0; index < count; index += 1) {
        deck.appendData(reading(deck.getData().length), cap);
      }
    },
    mirror(name) {
      return dom.el("deckRoot").getAttribute(name);
    },
    lastValues() {
      return rendered[rendered.length - 1].values;
    },
  };
}

describe("chart deck window — the geometry", () => {
  it("places the window on the live edge and counts backwards from it", () => {
    expect(ChartDeck.resolveWindow({ readingCount: 47, windowSize: 30, offset: 0 })).toMatchObject({
      span: 30,
      offset: 0,
      maxOffset: 17,
      position: 17,
      following: true,
      startIndex: 17,
      endIndex: 46,
    });

    expect(ChartDeck.resolveWindow({ readingCount: 47, windowSize: 30, offset: 12 })).toMatchObject({
      offset: 12,
      position: 5,
      following: false,
      startIndex: 5,
      endIndex: 34,
    });
  });

  it("cannot be asked to show readings the history does not reach", () => {
    // As far back as it goes, and no further.
    expect(ChartDeck.resolveWindow({ readingCount: 47, windowSize: 30, offset: 999 })).toMatchObject({
      offset: 17,
      position: 0,
      startIndex: 0,
      endIndex: 29,
    });

    // Fewer readings than the window: there is nothing to scrub over at all.
    expect(ChartDeck.resolveWindow({ readingCount: 5, windowSize: 30, offset: 3 })).toMatchObject({
      span: 5,
      offset: 0,
      maxOffset: 0,
      following: true,
    });

    expect(ChartDeck.resolveWindow({ readingCount: 0, windowSize: 30, offset: 0 })).toMatchObject({
      span: 0,
      startIndex: -1,
      endIndex: -1,
    });
  });
});

describe("chart deck window — the mirror", () => {
  it("publishes an empty deck as empty, with nothing to scrub", () => {
    const { mirror, dom } = startDeck();

    expect(mirror("data-reading-count")).toBe("0");
    expect(mirror("data-window-span")).toBe("0");
    expect(mirror("data-window-follow")).toBe("live");
    expect(dom.el("scrub").disabled).toBe(true);
    expect(dom.el("scrubReadout").textContent).toContain("waiting for the first reading");
  });

  it("publishes the window it draws, reading for reading", () => {
    const { feed, mirror, lastValues } = startDeck();
    feed(40);

    expect(mirror("data-reading-count")).toBe("40");
    expect(mirror("data-window-span")).toBe("30");
    expect(mirror("data-window-start")).toBe("10");
    expect(mirror("data-window-end")).toBe("39");
    expect(mirror("data-window-first-at")).toBe(reading(10).at);
    expect(mirror("data-window-last-at")).toBe(reading(39).at);
    // What the mirror says and what the renderer was handed are the same window.
    expect(lastValues()).toEqual(Array.from({ length: 30 }, (_, i) => reading(10 + i).value));
  });
});

describe("chart deck window — scrubbing a live stream", () => {
  it("holds the readings it is showing while new ones keep arriving", () => {
    const { dom, feed, mirror, lastValues } = startDeck();
    feed(40);

    dom.dragRange("scrub", 5); // 5 from the oldest window == 5 readings behind live
    dom.releaseRange("scrub");

    const firstAt = mirror("data-window-first-at");
    const lastAt = mirror("data-window-last-at");
    const held = lastValues();
    expect(mirror("data-window-follow")).toBe("held");
    expect(mirror("data-window-offset")).toBe("5");

    feed(5);

    // The stream moved; the chart did not.
    expect(mirror("data-reading-count")).toBe("45");
    expect(mirror("data-window-first-at")).toBe(firstAt);
    expect(mirror("data-window-last-at")).toBe(lastAt);
    expect(lastValues()).toEqual(held);
    // Same readings, five further behind the live edge than they were.
    expect(mirror("data-window-offset")).toBe("10");
    expect(mirror("data-window-position")).toBe("5");
  });

  it("grows the track under a thumb that has not moved", () => {
    const { dom, feed } = startDeck();
    feed(40);
    dom.dragRange("scrub", 4);

    expect(dom.el("scrub").getAttribute("max")).toBe("10");
    expect(dom.el("scrub").value).toBe("4");

    feed(20);

    // The retained history got longer, so there is more of it to scrub over —
    // but the thumb still points at the readings the user left it on.
    expect(dom.el("scrub").getAttribute("max")).toBe("30");
    expect(dom.el("scrub").value).toBe("4");
  });

  it("steps by keyboard onto exactly the window a drag would land on", () => {
    const dragged = startDeck();
    dragged.feed(40);
    dragged.dom.dragRange("scrub", 8);

    const stepped = startDeck();
    stepped.feed(40);
    // Live is the far right of the track; two arrow-key steps left is two
    // readings back — no pointer coordinates involved.
    stepped.dom.stepRange("scrub", -2);

    expect(stepped.deck.getWindowState()).toEqual(dragged.deck.getWindowState());
    expect(stepped.mirror("data-window-offset")).toBe("2");
    expect(stepped.lastValues()).toEqual(dragged.lastValues());
  });

  it("does not re-render when a drag ends on the value it already delivered", () => {
    const { dom, feed, rendered } = startDeck();
    feed(40);
    dom.dragRange("scrub", 6);
    const afterDrag = rendered.length;

    dom.releaseRange("scrub");

    expect(rendered.length).toBe(afterDrag);
  });

  it("resumes following once the scrub reaches the live edge again", () => {
    const { dom, feed, mirror } = startDeck();
    feed(40);
    dom.dragRange("scrub", 0);
    expect(mirror("data-window-follow")).toBe("held");
    expect(dom.el("scrubLiveBtn").disabled).toBe(false);

    dom.dragRange("scrub", Number(dom.el("scrub").getAttribute("max")));

    expect(mirror("data-window-follow")).toBe("live");
    expect(dom.el("scrubLiveBtn").disabled).toBe(true);

    feed(1);
    expect(mirror("data-window-last-at")).toBe(reading(40).at);
  });

  it("jumps back to live on the button, from wherever it was held", () => {
    const { dom, feed, mirror } = startDeck();
    feed(60);
    dom.dragRange("scrub", 3);
    expect(mirror("data-window-follow")).toBe("held");

    dom.el("scrubLiveBtn").emit("click");

    expect(mirror("data-window-follow")).toBe("live");
    expect(mirror("data-window-offset")).toBe("0");
    expect(mirror("data-window-last-at")).toBe(reading(59).at);
  });

  it("pushes a held window forward when the buffer drops the readings under it", () => {
    const { dom, feed, mirror } = startDeck({ windowSize: 10 });
    feed(20, 20); // a 20-reading buffer, full
    dom.dragRange("scrub", 0); // as far back as it goes
    expect(mirror("data-window-first-at")).toBe(reading(0).at);
    expect(mirror("data-window-position")).toBe("0");

    feed(4, 20);

    // Readings 0–3 have been evicted; the window cannot point at them, so it
    // sits on the oldest four that survive.
    expect(mirror("data-reading-count")).toBe("20");
    expect(mirror("data-window-position")).toBe("0");
    expect(mirror("data-window-first-at")).toBe(reading(4).at);
    expect(mirror("data-window-last-at")).toBe(reading(13).at);
  });
});

describe("chart deck window — the size slider", () => {
  it("keeps the right-hand edge of a held window where the user put it", () => {
    const { dom, feed, mirror } = startDeck();
    feed(60);
    dom.dragRange("scrub", 10); // 20 readings behind live
    const lastAt = mirror("data-window-last-at");

    dom.dragRange("historySize", 10);

    expect(mirror("data-window-size")).toBe("10");
    expect(mirror("data-window-span")).toBe("10");
    // Shorter window, same newest visible reading: it shrank from the left.
    expect(mirror("data-window-last-at")).toBe(lastAt);
    expect(dom.el("windowReadout").textContent).toBe("10");
  });

  it("re-renders on every step of a drag, not only on release", () => {
    const { dom, feed, rendered } = startDeck();
    feed(40);
    const before = rendered.length;

    dom.dragRange("historySize", 20);
    dom.dragRange("historySize", 15);
    expect(rendered.length).toBe(before + 2);

    // Release reports the value the last `input` already delivered; re-rendering
    // the same window again would be work for nothing.
    dom.releaseRange("historySize");
    expect(rendered.length).toBe(before + 2);
  });

  it("clamps a value asked for from outside the control to what the control allows", () => {
    const { deck, dom } = startDeck();

    expect(deck.set("window", 9999)).toBe(true);
    expect(deck.get("window")).toBe(240);
    expect(dom.el("historySize").value).toBe("240");

    expect(deck.set("columns", 9)).toBe(true);
    expect(deck.get("columns")).toBe(3);
    expect(dom.el("columnsReadout").textContent).toBe("3");

    expect(deck.set("window", "not a number")).toBe(false);
    expect(deck.set("nonsense", 1)).toBe(false);
    expect(deck.get("window")).toBe(240);
  });
});
