import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

/**
 * The Weather Live page's automation surface: the controls are real range
 * inputs, the scrub bar exists, and the chart deck carries the hooks the
 * scrub-window tests assert against (tests/unit/weather-live-scrub.test.js
 * drives the same ids through a DOM shim).
 */
const app = require("../api/index.js");

async function getCurrentFlags() {
  const res = await request(app).get("/api/v1/feature-flags").expect(200);
  return res.body?.data?.flags || {};
}

describe("Weather Live page controls", () => {
  let originalFlags;
  let html;

  beforeAll(async () => {
    originalFlags = await getCurrentFlags();
    await request(app)
      .patch("/api/v1/feature-flags")
      .send({ flags: { weatherLiveStreamEnabled: true } })
      .expect(200);
    const res = await request(app).get("/weather-live.html").expect(200);
    html = res.text;
  });

  afterAll(async () => {
    if (originalFlags) {
      await request(app).put("/api/v1/feature-flags").send({ flags: originalFlags }).expect(200);
    }
  });

  /** The whole `<input>` tag for an id, however its attributes are wrapped. */
  function inputTag(id) {
    const match = new RegExp('<input[^>]*id="' + id + '"[^>]*>').exec(html);
    expect(match, "no <input> with id " + id).not.toBeNull();
    return match[0];
  }

  it("ships the deck controls as sliders rather than dropdowns", () => {
    ["weatherLiveHistorySize", "weatherLiveChartColumns", "weatherLiveChartHeight", "weatherLiveScrub"].forEach((id) => {
      // The dropdowns these replaced carried the same ids, so the tag matters.
      expect(html).not.toContain('<select id="' + id + '"');
      expect(inputTag(id)).toContain('type="range"');
    });

    // The bounds are the contract a keyboard step relies on.
    ['min="10"', 'max="240"', 'step="5"', 'value="30"', 'data-testid="history-window"'].forEach((attribute) => {
      expect(inputTag("weatherLiveHistorySize")).toContain(attribute);
    });
    ['min="1"', 'max="3"', 'step="1"', 'data-testid="chart-columns"'].forEach((attribute) => {
      expect(inputTag("weatherLiveChartColumns")).toContain(attribute);
    });
    ['min="100"', 'max="280"', 'step="20"', 'data-testid="chart-height"'].forEach((attribute) => {
      expect(inputTag("weatherLiveChartHeight")).toContain(attribute);
    });
    // Nothing to scrub until readings arrive; the deck raises `max` itself.
    ['max="0"', "disabled", 'data-testid="chart-scrub"'].forEach((attribute) => {
      expect(inputTag("weatherLiveScrub")).toContain(attribute);
    });
  });

  it("ships a readout for every slider, so the value is legible without measuring the thumb", () => {
    ["window", "columns", "height"].forEach((key) => {
      expect(html).toContain('data-ck-readout="' + key + '"');
    });
  });

  it("ships the scrub bar and the deck's state mirror host", () => {
    [
      "chart-scrub-bar",
      "chart-scrub",
      "chart-scrub-readout",
      "chart-scrub-live",
      "chart-deck",
      "stream-state",
      "stream-pause",
      "stream-reconnect",
      "stream-region",
    ].forEach((testId) => {
      expect(html).toContain('data-testid="' + testId + '"');
    });

    expect(html).toContain('id="weatherLiveScrubBar"');
    expect(html).toContain('data-stream-state="connecting"');
    expect(html).toContain("/css/chart-deck.css");
    expect(html).toContain("/js/utils/chart-deck.js");
    expect(html).toContain("/js/pages/weather-live-charts.js");
  });
});
