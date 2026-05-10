import { describe, expect, it } from "vitest";

const { CELEBRATION_EVENTS } = require("../../services/celebration-events.data");
const celebrationEventsService = require("../../services/celebration-events.service");

describe("Celebration events service", () => {
  it("exposes a separated list of themed events", () => {
    expect(Array.isArray(CELEBRATION_EVENTS)).toBe(true);
    expect(CELEBRATION_EVENTS.length).toBeGreaterThanOrEqual(8);
    expect(CELEBRATION_EVENTS[0]).toHaveProperty("name");
    expect(CELEBRATION_EVENTS[0]).toHaveProperty("startMonth");
    expect(CELEBRATION_EVENTS[0]).toHaveProperty("startDay");
  });

  it("matches a celebration event for the expected date", () => {
    const events = celebrationEventsService.getCelebrationEventsForDate("2026-04-23");

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].name).toBe("World Book Day");
    expect(events[0].themeKey).toBe("library-quest");
    expect(events[0].dateLabel).toBeTruthy();
  });

  it("matches Mother's Day on the second Sunday of May", () => {
    const events = celebrationEventsService.getCelebrationEventsForDate("2026-05-10");

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.id === "mothers-day-global")).toBe(true);
    expect(events[0].dateLabel).toBeTruthy();
  });
});
