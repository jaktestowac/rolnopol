import { describe, it, expect } from "vitest";

const createWeatherLiveService = require("../../services/weather-live.service");

const baseConditions = (overrides = {}) => ({
  region: "PL-14",
  date: "2026-08-13",
  tick: 0,
  observedAt: "2026-08-13T10:00:00.000Z",
  condition: "Sunny",
  temperatureC: 18,
  feelsLikeC: 18,
  windKmh: 10,
  gustKmh: 14,
  precipitationMmH: 0,
  humidityPct: 60,
  pressureHpa: 1012,
  cloudCoverPct: 20,
  ...overrides,
});

describe("WeatherLiveService", () => {
  const service = createWeatherLiveService("PL-14");

  it("normalizes unknown regions back to the default", () => {
    expect(service.normalizeRegion("PL-14")).toBe("PL-14");
    expect(service.normalizeRegion("does-not-exist")).toBe("PL-14");
  });

  it("derives deterministic conditions for the same inputs", () => {
    const a = service.deriveConditions({ region: "PL-14", date: "2026-08-13", tick: 3, seed: "s", observedAt: "t" });
    const b = service.deriveConditions({ region: "PL-14", date: "2026-08-13", tick: 3, seed: "s", observedAt: "t" });
    expect(a).toEqual(b);
  });

  it("with variance 0 anchors conditions exactly to the base daily average", () => {
    const date = "2026-08-13";
    const region = "PL-14";
    const base = service.getBaseDay(date, region);
    const conditions = service.deriveConditions({ region, date, tick: 0, variance: 0, observedAt: "t" });

    const expectedTempAvg = Math.round(((base.temperatureMinC + base.temperatureMaxC) / 2) * 10) / 10;
    expect(conditions.temperatureC).toBe(expectedTempAvg);
    expect(conditions.windKmh).toBe(base.windKmh);
    expect(conditions.humidityPct).toBe(base.humidityPct);
    expect(conditions.pressureHpa).toBe(base.pressureHpa);
    expect(conditions.gustKmh).toBe(base.windKmh); // no jitter added on top of wind
    expect(conditions.base.temperatureMinC).toBe(base.temperatureMinC);
    expect(conditions.base.temperatureMaxC).toBe(base.temperatureMaxC);
  });

  it("with variance 0 produces identical frames across ticks", () => {
    const first = service.deriveConditions({ region: "PL-14", date: "2026-08-13", tick: 0, variance: 0, observedAt: "t" });
    const later = service.deriveConditions({ region: "PL-14", date: "2026-08-13", tick: 9, variance: 0, observedAt: "t" });
    expect(later.temperatureC).toBe(first.temperatureC);
    expect(later.windKmh).toBe(first.windKmh);
    expect(later.precipitationMmH).toBe(first.precipitationMmH);
  });

  it("emits no alerts for calm conditions", () => {
    expect(service.evaluateAlerts(baseConditions())).toEqual([]);
  });

  it("flags severe high wind and warning strong wind at the right boundaries", () => {
    const strong = service.evaluateAlerts(baseConditions({ windKmh: 40, gustKmh: 44 }));
    expect(strong.map((a) => a.key)).toContain("strong-wind");
    expect(strong.find((a) => a.key === "strong-wind").severity).toBe("warning");

    const high = service.evaluateAlerts(baseConditions({ windKmh: 52, gustKmh: 60 }));
    expect(high.map((a) => a.key)).toContain("high-wind");
    expect(high.find((a) => a.key === "high-wind").severity).toBe("severe");

    const gusts = service.evaluateAlerts(baseConditions({ windKmh: 40, gustKmh: 95 }));
    expect(gusts.map((a) => a.key)).toContain("damaging-gusts");
  });

  it("flags storm/heavy rain from precipitation rate", () => {
    const storm = service.evaluateAlerts(baseConditions({ precipitationMmH: 7 }));
    expect(storm.map((a) => a.key)).toContain("storm");

    const heavy = service.evaluateAlerts(baseConditions({ precipitationMmH: 3 }));
    expect(heavy.map((a) => a.key)).toContain("heavy-rain");
  });

  it("flags heat and cold extremes", () => {
    expect(service.evaluateAlerts(baseConditions({ temperatureC: 33 })).map((a) => a.key)).toContain("heat");
    expect(service.evaluateAlerts(baseConditions({ temperatureC: 37 })).map((a) => a.key)).toContain("extreme-heat");
    expect(service.evaluateAlerts(baseConditions({ temperatureC: -9 })).map((a) => a.key)).toContain("hard-freeze");
    expect(service.evaluateAlerts(baseConditions({ temperatureC: -16 })).map((a) => a.key)).toContain("extreme-cold");
  });

  it("generateFrame returns conditions plus their alerts together", () => {
    const frame = service.generateFrame({ region: "PL-14", date: "2026-08-13", tick: 0, variance: 0, observedAt: "t" });
    expect(frame.conditions).toBeTruthy();
    expect(Array.isArray(frame.alerts)).toBe(true);
    expect(frame.alerts).toEqual(service.evaluateAlerts(frame.conditions));
  });
});
