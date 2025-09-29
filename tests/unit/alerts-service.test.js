import { describe, it, expect } from "vitest";

const alertsService = require("../../services/alerts.service")("test-region");

describe("AlertsService", () => {
  it("generates deterministic alerts for a given date", () => {
    const d = "2025-09-09";
    const a1 = alertsService.generateAlertsForDate(d);
    const a2 = alertsService.generateAlertsForDate(d);
    expect(a1).toStrictEqual(a2);
  });

  it("returns history of 7 days and upcoming next day", () => {
    const d = "2025-09-09";
    const history = alertsService.getHistory(d, 7);
    const upcoming = alertsService.getUpcoming(d);
    expect(history.length).toBe(7);
    expect(upcoming).toHaveProperty("date");
    // All history dates should be < seed date
    const seed = new Date(d);
    for (const day of history) {
      expect(new Date(day.date) < seed).toBe(true);
      expect(Array.isArray(day.alerts)).toBe(true);
    }
    // Upcoming should be seed+1 day
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    expect(upcoming.date).toBe(next.toISOString().slice(0, 10));
  });

  it("throws on invalid date", () => {
    expect(() => alertsService.generateAlertsForDate("bad-date")).toThrow();
  });
});
