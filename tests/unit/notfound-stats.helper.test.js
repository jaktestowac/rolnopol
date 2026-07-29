import { describe, it, expect } from "vitest";

const notFoundStats = require("../../helpers/notfound-stats");

describe("notfound-stats helper", () => {
  it("tracks html 404 hits per path and in total", () => {
    const before = notFoundStats.getStats().html.total;
    notFoundStats.incrementHtml("/ghost");
    notFoundStats.incrementHtml("/ghost");
    const stats = notFoundStats.getStats();
    expect(stats.html.paths["/ghost"]).toBe(2);
    expect(stats.html.total).toBe(before + 2);
    expect(stats.timeHits.html["/ghost"]).toHaveLength(2);
  });

  it("tracks api 404 hits separately", () => {
    notFoundStats.incrementApi("/api/ghost");
    const stats = notFoundStats.getStats();
    expect(stats.api.paths["/api/ghost"]).toBe(1);
  });

  it("shouldServeCustom404 requires both the phrase and a 10-hit threshold", () => {
    const url = "/secret-treasure-map";
    expect(notFoundStats.shouldServeCustom404(url, "treasure")).toBe(false);
    for (let i = 0; i < 10; i += 1) {
      notFoundStats.incrementHtml(url);
    }
    expect(notFoundStats.shouldServeCustom404(url, "treasure")).toBe(true);
    // Phrase not present in the URL => false even past the threshold.
    expect(notFoundStats.shouldServeCustom404(url, "nomatch")).toBe(false);
  });

  it("returns false for missing url or phrase", () => {
    expect(notFoundStats.shouldServeCustom404("", "x")).toBe(false);
    expect(notFoundStats.shouldServeCustom404("/x", "")).toBe(false);
  });

  it("shouldServeCustom404ForTimeFrame counts only recent hits", () => {
    const url = "/timed-easter-egg";
    for (let i = 0; i < 10; i += 1) {
      notFoundStats.incrementHtml(url);
    }
    expect(notFoundStats.shouldServeCustom404ForTimeFrame(url, "easter", 10000)).toBe(true);
    // A zero-length window excludes every stored hit.
    expect(notFoundStats.shouldServeCustom404ForTimeFrame(url, "easter", -1)).toBe(false);
    // Unknown url => false.
    expect(notFoundStats.shouldServeCustom404ForTimeFrame("/never-seen", "easter")).toBe(false);
  });
});
