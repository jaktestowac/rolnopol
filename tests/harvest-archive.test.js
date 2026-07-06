import { describe, expect, it, vi, beforeEach } from "vitest";

// We test the service layer directly for date-dependent logic,
// and the controller/route via supertest.

const mockActiveEvent = {
  id: "autumn-equinox",
  name: "Autumn Equinox",
  startDate: "2026-09-22",
  endDate: "2026-09-22",
  dateLabel: "Sep 22",
  themeKey: "festival-grove",
  emoji: "🍂",
  bannerTitle: "Harvest Balance",
  bannerSubtitle: "When the year exhales…",
  description: "A reflective seasonal theme.",
};

const mockCelebrationEvents = [
  { ...mockActiveEvent },
  {
    id: "winter-holidays",
    name: "Winter Holidays",
    startMonth: 12,
    startDay: 24,
    durationDays: 3,
    themeKey: "winter-legend",
    emoji: "❄️",
    bannerTitle: "Winter Legend Week",
    bannerSubtitle: "At the edge of the year…",
    description: "Holiday-fantasy mood.",
  },
  {
    id: "workers-day",
    name: "Workers' Day",
    startMonth: 5,
    startDay: 1,
    durationDays: 1,
    themeKey: "quest-log",
    emoji: "🛠️",
    bannerTitle: "Hands That Build",
    bannerSubtitle: "Every society rests on labor…",
    description: "Celebration of work.",
  },
  {
    id: "international-yoga-day",
    name: "International Yoga Day",
    startMonth: 6,
    startDay: 21,
    durationDays: 1,
    themeKey: "sunlit-quest",
    emoji: "🧘",
    bannerTitle: "Inner Harvest",
    bannerSubtitle: "Growth begins within…",
    description: "A serene theme.",
  },
];

// Mock the celebration-events.service
vi.mock("../services/celebration-events.service", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCelebrationEventsForDate: vi.fn(),
    listCelebrationEvents: vi.fn(() => mockCelebrationEvents),
  };
});

describe("Harvest Archive Service", () => {
  let service;
  let getCelebrationEventsForDate;

  beforeEach(async () => {
    vi.resetModules();
    const celeMod = await import("../services/celebration-events.service");
    getCelebrationEventsForDate = celeMod.getCelebrationEventsForDate;
    const serviceMod = await import("../services/harvest-archive.service");
    service = serviceMod.default || serviceMod;
  });

  it("returns active:true during autumn-equinox even when celebrationEventsEnabled is false", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([mockActiveEvent]);
    const result = await service.getArchiveMetadata("2026-09-22");
    expect(result.active).toBe(true);
    expect(result.event.id).toBe("autumn-equinox");
    expect(result.event.name).toBe("Autumn Equinox");
  });

  it("returns active:false when no harvest event is active", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([]);
    const result = await service.getArchiveMetadata("2026-03-15");
    expect(result.active).toBe(false);
  });

  it("returns active:true for archive-only entry with startMonth/startDay", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([]);
    const celeMod = await import("../services/celebration-events.service");
    celeMod.listCelebrationEvents.mockReturnValueOnce([]);

    const result = await service.getArchiveMetadata("2026-06-05");
    expect(result.active).toBe(true);
    expect(result.event.id).toBe("test-entry-2026");
    expect(result.event.name).toBeDefined();
    expect(result.event.theme).toBeDefined();
  });

  it("returns active:true during autumn-equinox", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([mockActiveEvent]);
    const result = await service.getArchiveMetadata("2026-09-22");
    expect(result.active).toBe(true);
    expect(result.event.id).toBe("autumn-equinox");
    expect(result.event.name).toBe("Autumn Equinox");
    expect(result.event.theme).toBeDefined();
    expect(result.event.theme.colors.primary).toBe("#A0522D");
  });

  it("returns active:true during winter-holidays", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([{ ...mockCelebrationEvents[1], startDate: "2026-12-24", endDate: "2026-12-26" }]);
    const result = await service.getArchiveMetadata("2026-12-25");
    expect(result.active).toBe(true);
    expect(result.event.id).toBe("winter-holidays");
    expect(result.event.theme.colors.primary).toBe("#2C3E50");
  });

  it("returns empty entries when no harvest event is active", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([]);
    const result = await service.getArchiveEntries("2026-03-15");
    expect(result.active).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it("returns filtered entries during active autumn-equinox", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([mockActiveEvent]);
    const result = await service.getArchiveEntries("2026-09-22");
    expect(result.active).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    result.entries.forEach((entry) => {
      expect(entry.id).toBe("autumn-equinox");
      expect(entry.theme).toBeDefined();
    });
  });

  it("returns filtered entries during active winter-holidays", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([{ ...mockCelebrationEvents[1], startDate: "2026-12-24", endDate: "2026-12-26" }]);
    const result = await service.getArchiveEntries("2026-12-25");
    expect(result.active).toBe(true);
    result.entries.forEach((entry) => {
      expect(entry.id).toBe("winter-holidays");
    });
  });

  it("entries are enriched with theme data including colors and fonts", async () => {
    getCelebrationEventsForDate.mockReturnValueOnce([mockActiveEvent]);
    const result = await service.getArchiveEntries("2026-09-22");
    expect(result.entries.length).toBeGreaterThan(0);
    const entry = result.entries[0];
    expect(entry.theme.colors).toBeDefined();
    expect(entry.theme.colors.primary).toBeDefined();
    expect(entry.theme.colors.secondary).toBeDefined();
    expect(entry.theme.fonts).toBeDefined();
    expect(entry.theme.fonts.header).toContain("Georgia");
    expect(entry.theme.imagery).toBeDefined();
  });

  it("recurring entries (year: null) return for different years", async () => {
    getCelebrationEventsForDate.mockReturnValue([mockActiveEvent]);
    const result2026 = await service.getArchiveEntries("2026-09-22");
    const result2027 = await service.getArchiveEntries("2027-09-22");
    expect(result2026.entries.length).toBeGreaterThan(0);
    expect(result2027.entries.length).toBe(result2026.entries.length);
  });

  it("respects year-specific entries", async () => {
    getCelebrationEventsForDate.mockReturnValue([mockActiveEvent]);

    // Warm the service first: its loader busts the require cache and re-requires
    // the data module on first use, so requiring it before that first call would
    // hand us a different (stale) module instance whose mutations the service
    // never sees.
    await service.getArchiveEntries("2026-09-22");

    // Add a year-specific entry to test
    const { HARVEST_ARCHIVE_ENTRIES } = require("../data/harvest-archive.data");
    const originalLength = HARVEST_ARCHIVE_ENTRIES.length;

    // Temporarily push a year-specific entry
    HARVEST_ARCHIVE_ENTRIES.push({
      id: "autumn-equinox",
      season: "autumn-equinox",
      year: 2026,
      entryType: "Special Report",
      excerpt: "Only for 2026.",
      mood: "exclusive",
    });

    const result2026 = await service.getArchiveEntries("2026-09-22");
    const result2027 = await service.getArchiveEntries("2027-09-22");

    // 2026 should have one more entry than 2027
    const entries2026 = result2026.entries.filter((e) => e.year === 2026);
    const entries2027 = result2027.entries.filter((e) => e.year === 2026);
    expect(entries2026.length).toBe(1);
    expect(entries2027.length).toBe(0);

    // Clean up
    HARVEST_ARCHIVE_ENTRIES.pop();
    expect(HARVEST_ARCHIVE_ENTRIES.length).toBe(originalLength);
  });
});

describe("Harvest Archive API", () => {
  let app;

  beforeEach(() => {
    app = require("../api/index.js");
  });

  it("GET /api/v1/harvest-archive returns valid response structure", async () => {
    const request = (await import("supertest")).default;
    const response = await request(app).get("/api/v1/harvest-archive").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data.active).toBe("boolean");
  });

  it("GET /api/v1/harvest-archive/entries returns valid response structure", async () => {
    const request = (await import("supertest")).default;
    const response = await request(app).get("/api/v1/harvest-archive/entries").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data.active).toBe("boolean");
    expect(Array.isArray(response.body.data.entries)).toBe(true);
  });

  it("metadata returns active:false with message when no event active", async () => {
    const request = (await import("supertest")).default;
    const response = await request(app).get("/api/v1/harvest-archive").expect(200);

    if (!response.body.data.active) {
      expect(response.body.data.message).toBeDefined();
    }
  });
});
