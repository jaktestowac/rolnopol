import { describe, it, expect } from "vitest";

/**
 * Weather Live: the sliders over a streaming chart deck.
 *
 * Two things are under test and they are deliberately independent — the stream
 * (arriving, paused, reconnecting) and the window the charts show over the
 * readings it has delivered. Pausing does not move the window; scrubbing does
 * not stop the stream. Everything is asserted through what the page publishes:
 * `data-stream-state` on the toolbar, the deck's `data-window-*` mirror, and the
 * query string it writes.
 *
 * Frames come from the real weather-live service, so the fields the page reads
 * are the fields the SSE endpoint actually sends.
 */
const ChartKit = require("../../public/js/utils/chart-kit.js");
const ChartDeck = require("../../public/js/utils/chart-deck.js");
const WeatherLiveCharts = require("../../public/js/pages/weather-live-charts.js");
const WeatherLivePage = require("../../public/js/pages/weather-live.js");
const createWeatherLiveService = require("../../services/weather-live.service.js");
const { createDom } = require("../helpers/dom-shim.js");

const REGION = "PL-14";
const DATE = "2026-05-31";
const BASE_MS = Date.parse("2026-05-31T06:00:00.000Z");
const CADENCE_MS = 4000;

const service = createWeatherLiveService(REGION);

function conditionsFrame(tick) {
  return service.deriveConditions({
    region: REGION,
    date: DATE,
    tick,
    seed: "scrub-test",
    observedAt: new Date(BASE_MS + tick * CADENCE_MS).toISOString(),
  });
}

const PLAIN_IDS = [
  "weatherLiveToolbar",
  "weatherLiveConnDot",
  "weatherLiveConnLabel",
  "weatherLiveStatus",
  "weatherLiveCondition",
  "weatherLiveTemp",
  "weatherLiveMeta",
  "weatherLiveMetrics",
  "weatherLiveBase",
  "weatherLiveAlerts",
  "weatherLiveAlertsEmpty",
  "weatherLiveEventLog",
  "weatherLiveCharts",
  "weatherLiveChartsEmpty",
  "weatherLiveChartOptions",
  "weatherLiveScrubBar",
  "weatherLiveScrubReadout",
];

function elementSpecs() {
  return [
    ...PLAIN_IDS.map((id) => ({ id })),
    { id: "weatherLiveChartOptionsBtn", tagName: "button" },
    { id: "weatherLiveChartsResetBtn", tagName: "button" },
    { id: "weatherLiveChartsClearBtn", tagName: "button" },
    { id: "weatherLiveReconnectBtn", tagName: "button" },
    { id: "weatherLivePauseBtn", tagName: "button" },
    { id: "weatherLiveScrubLiveBtn", tagName: "button", disabled: true },
    { id: "weatherLiveRegionSelect", tagName: "select", value: REGION },
    { id: "weatherLiveIntervalSelect", tagName: "select", value: "4000" },
    { id: "weatherLiveScrub", tagName: "input", type: "range", value: "0", attributes: { min: "0", max: "0", step: "1" } },
    { id: "weatherLiveHistorySize", tagName: "input", type: "range", value: "30", attributes: { min: "10", max: "240", step: "5" } },
    { id: "weatherLiveChartColumns", tagName: "input", type: "range", value: "2", attributes: { min: "1", max: "3", step: "1" } },
    { id: "weatherLiveChartHeight", tagName: "input", type: "range", value: "160", attributes: { min: "100", max: "280", step: "20" } },
    { id: "readoutWindow", attributes: { "data-ck-readout": "window" } },
    { id: "readoutColumns", attributes: { "data-ck-readout": "columns" } },
    { id: "readoutHeight", attributes: { "data-ck-readout": "height" } },
  ];
}

/** Records the streams the page opens instead of connecting to anything. */
function fakeEventSource(streams) {
  return class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = new Map();
      streams.push(this);
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    emit(type, event) {
      (this.listeners.get(type) || []).forEach((handler) => handler(event || {}));
    }
    close() {
      this.readyState = 2;
    }
  };
}

function startPage({ url = "https://rolnopol.test/weather-live.html", stored = null } = {}) {
  const streams = [];
  const dom = createDom({
    url,
    elements: elementSpecs(),
    globals: { ChartKit, ChartDeck, EventSource: fakeEventSource(streams) },
  });

  if (stored) {
    dom.windowRef.localStorage.setItem("rolnopol.weatherLive.chartOptions", JSON.stringify(stored));
  }

  const charts = WeatherLiveCharts.create({ documentRef: dom.documentRef, windowRef: dom.windowRef });
  dom.windowRef.WeatherLiveCharts = charts;

  const page = WeatherLivePage.create({ documentRef: dom.documentRef, windowRef: dom.windowRef });
  page.init();

  let tick = 0;

  return {
    dom,
    charts,
    page,
    streams,
    stream() {
      return streams[streams.length - 1];
    },
    /** Deliver `count` conditions frames down the stream the page has open. */
    feed(count = 1) {
      for (let index = 0; index < count; index += 1) {
        this.stream().emit("conditions", { data: JSON.stringify(conditionsFrame(tick)) });
        tick += 1;
      }
    },
    frameAt(index) {
      return conditionsFrame(index);
    },
    mirror(name) {
      return dom.el("weatherLiveCharts").getAttribute(name);
    },
    streamState() {
      return dom.el("weatherLiveToolbar").getAttribute("data-stream-state");
    },
  };
}

describe("weather live — sliders in the query string", () => {
  it("writes a slider to the URL when it leaves its default and takes it out again when it returns", () => {
    const app = startPage();

    app.dom.dragRange("weatherLiveHistorySize", 60);
    expect(app.dom.params().get("history")).toBe("60");
    expect(app.dom.el("readoutWindow").textContent).toBe("60");

    app.dom.dragRange("weatherLiveChartColumns", 3);
    app.dom.dragRange("weatherLiveChartHeight", 220);
    expect(app.dom.params().get("columns")).toBe("3");
    expect(app.dom.params().get("height")).toBe("220");

    app.dom.dragRange("weatherLiveHistorySize", 30);
    expect(app.dom.params().has("history")).toBe(false);
    expect(app.dom.params().get("columns")).toBe("3");
  });

  it("leaves the URL alone while nothing has been moved", () => {
    const app = startPage();
    app.feed(20);

    expect(app.dom.replaced).toEqual([]);
    expect(app.dom.url()).toBe("https://rolnopol.test/weather-live.html");
  });

  it("restores the sliders from the URL, over the stored preference", () => {
    // Storage says 120 readings in one column; the link says 60 in three.
    const app = startPage({
      url: "https://rolnopol.test/weather-live.html?history=60&columns=3",
      stored: { window: 120, columns: 1, height: 220 },
    });

    expect(app.charts.getDeck().get("window")).toBe(60);
    expect(app.charts.getDeck().get("columns")).toBe(3);
    expect(app.dom.el("weatherLiveHistorySize").value).toBe("60");
    // Untouched by the URL, so the stored preference still stands.
    expect(app.charts.getDeck().get("height")).toBe(220);
  });

  it("corrects a URL that asks for more than the control allows", () => {
    const app = startPage({ url: "https://rolnopol.test/weather-live.html?history=9999" });

    expect(app.charts.getDeck().get("window")).toBe(240);
    expect(app.dom.params().get("history")).toBe("240");
  });
});

describe("weather live — scrubbing over the retained history", () => {
  it("keeps the URL saying how far behind live the chart is", () => {
    const app = startPage();
    app.feed(40);
    expect(app.dom.params().has("scrub")).toBe(false);

    app.dom.dragRange("weatherLiveScrub", 4); // 6 readings behind live
    expect(app.dom.params().get("scrub")).toBe("6");

    // Held while the stream keeps arriving: the same readings are further and
    // further behind the live edge, and the URL keeps up.
    app.feed(3);
    expect(app.mirror("data-window-offset")).toBe("9");
    expect(app.dom.params().get("scrub")).toBe("9");

    app.dom.el("weatherLiveScrubLiveBtn").emit("click");
    expect(app.dom.params().has("scrub")).toBe(false);
  });

  it("holds a deep-linked scrub until the readings it asks for exist", () => {
    const app = startPage({ url: "https://rolnopol.test/weather-live.html?scrub=8" });

    // Nothing has arrived: there is nothing to scrub over, so the request waits
    // instead of silently collapsing to "live".
    expect(app.dom.el("weatherLiveScrubBar").getAttribute("data-scrub-pending")).toBe("8");
    expect(app.mirror("data-window-follow")).toBe("live");

    app.feed(30);
    expect(app.charts.getPendingScrub()).toBe(8);
    expect(app.mirror("data-window-follow")).toBe("live");

    app.feed(8); // 38 readings, a 30-reading window: 8 back is now reachable
    expect(app.charts.getPendingScrub()).toBe(0);
    expect(app.dom.el("weatherLiveScrubBar").hasAttribute("data-scrub-pending")).toBe(false);
    expect(app.mirror("data-window-follow")).toBe("held");
    expect(app.mirror("data-window-offset")).toBe("8");
    expect(app.mirror("data-window-last-at")).toBe(app.frameAt(29).observedAt);
  });

  it("drops a pending deep link as soon as the user scrubs for themselves", () => {
    const app = startPage({ url: "https://rolnopol.test/weather-live.html?scrub=8" });
    app.feed(34);
    expect(app.charts.getPendingScrub()).toBe(8);

    app.dom.stepRange("weatherLiveScrub", -1);

    expect(app.charts.getPendingScrub()).toBe(0);
    expect(app.mirror("data-window-offset")).toBe("1");

    app.feed(10);
    expect(app.mirror("data-window-offset")).toBe("11");
  });
});

describe("weather live — pause, scrub, resume", () => {
  it("opens the stream with the region and cadence the controls report", () => {
    const app = startPage();

    expect(app.streams).toHaveLength(1);
    expect(app.stream().url).toBe("/api/v1/weather/live/stream?region=PL-14&intervalMs=4000");
    expect(app.streamState()).toBe("connecting");

    app.stream().emit("open");
    expect(app.streamState()).toBe("live");
  });

  it("holds the chart still while the live card keeps moving", () => {
    const app = startPage();
    app.feed(40);
    app.dom.dragRange("weatherLiveScrub", 0); // as far back as the history goes

    const heldLast = app.mirror("data-window-last-at");
    const heldReadout = app.dom.el("weatherLiveScrubReadout").textContent;
    expect(heldReadout).toContain("Held 10 readings back");

    app.feed(5);

    // The chart is showing the same ten-minute-old readings…
    expect(app.mirror("data-window-last-at")).toBe(heldLast);
    // …while the current-conditions card has moved on to the newest frame.
    expect(app.dom.el("weatherLiveTemp").textContent).toBe(Math.round(app.frameAt(44).temperatureC) + "°C");
    expect(app.mirror("data-reading-count")).toBe("45");
  });

  it("stops readings on pause and leaves the scrubbed window exactly where it was", () => {
    const app = startPage();
    app.stream().emit("open");
    app.feed(40);
    app.dom.dragRange("weatherLiveScrub", 6);
    const held = {
      offset: app.mirror("data-window-offset"),
      firstAt: app.mirror("data-window-first-at"),
      lastAt: app.mirror("data-window-last-at"),
    };

    app.dom.el("weatherLivePauseBtn").emit("click");

    expect(app.page.isPaused()).toBe(true);
    expect(app.streamState()).toBe("paused");
    expect(app.streams[0].readyState).toBe(2);
    expect(app.dom.el("weatherLivePauseBtn").getAttribute("aria-pressed")).toBe("true");
    expect(app.dom.el("weatherLivePauseBtn").innerHTML).toContain("Resume");
    // Paused means no new readings; it says nothing about the window.
    expect(app.mirror("data-reading-count")).toBe("40");
    expect(app.mirror("data-window-offset")).toBe(held.offset);

    app.dom.el("weatherLivePauseBtn").emit("click");

    expect(app.page.isPaused()).toBe(false);
    expect(app.streams).toHaveLength(2);
    expect(app.streamState()).toBe("connecting");
    // Resuming the stream does not drag the chart back to the live edge — the
    // window is the user's, and only they (or the button) may move it.
    expect(app.mirror("data-window-follow")).toBe("held");
    expect(app.mirror("data-window-first-at")).toBe(held.firstAt);
    expect(app.mirror("data-window-last-at")).toBe(held.lastAt);

    app.stream().emit("open");
    app.feed(2);
    expect(app.streamState()).toBe("live");
    expect(app.mirror("data-reading-count")).toBe("42");
    expect(app.mirror("data-window-last-at")).toBe(held.lastAt);

    app.dom.el("weatherLiveScrubLiveBtn").emit("click");
    expect(app.mirror("data-window-follow")).toBe("live");
    expect(app.mirror("data-window-last-at")).toBe(app.frameAt(41).observedAt);
  });

  it("reports a dropped stream without touching the window", () => {
    const app = startPage();
    app.feed(40);
    app.dom.dragRange("weatherLiveScrub", 2);

    app.stream().close();
    app.stream().emit("error");

    expect(app.streamState()).toBe("error");
    expect(app.mirror("data-window-follow")).toBe("held");
    expect(app.mirror("data-window-offset")).toBe("8");
  });

  it("starts the history over on a new region, which puts the window back on live", () => {
    const app = startPage();
    app.feed(40);
    app.dom.dragRange("weatherLiveScrub", 0);
    expect(app.dom.params().get("scrub")).toBe("10");

    app.dom.el("weatherLiveRegionSelect").value = "PL-22";
    app.dom.el("weatherLiveRegionSelect").emit("change");

    // A different region is a different series: the readings it collected are
    // gone, so there is nothing left to be held over.
    expect(app.mirror("data-reading-count")).toBe("0");
    expect(app.mirror("data-window-follow")).toBe("live");
    expect(app.dom.params().has("scrub")).toBe(false);
    expect(app.stream().url).toContain("region=PL-22");
  });
});
