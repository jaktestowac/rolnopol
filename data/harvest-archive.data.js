/**
 * Holiday Harvest Archive — Seasonal lore entries.
 *
 * Each entry is tied to a celebration event via `id`.
 * `year: null` means the entry appears every year during that event.
 * Set `year` to a specific number to limit the entry to that year only.
 */

const HARVEST_ARCHIVE_ENTRIES = [
  {
    id: "autumn-equinox",
    season: "autumn-equinox",
    year: null,
    entryType: "Harvest Report",
    excerpt:
      "October 15th brought an unusual abundance. Yield: 147 pumpkins. Notable: one gourd glowed faintly at midnight, then went dark. The scarecrow was found facing the wrong direction. No tracks.",
    mood: "nostalgic",
  },
  {
    id: "autumn-equinox",
    season: "autumn-equinox",
    year: null,
    entryType: "Field Legend",
    excerpt:
      "Old Mirek swore the western field whispered during the equinox. Said the wheat rows spelled out coordinates. We found nothing but crows. The crows, however, were unusually quiet.",
    mood: "mysterious",
  },
  {
    id: "winter-holidays",
    season: "winter-holidays",
    year: null,
    entryType: "Memory Log",
    excerpt:
      "December 21st: The greenhouse lights flickered in morse code. Decoded: 'STILL GROWING.' The heater was off. Outside, snow covered every field. Inside, a single tomato vine had new fruit.",
    mood: "reflective",
  },
  {
    id: "winter-holidays",
    season: "winter-holidays",
    year: null,
    entryType: "Cabin Journal",
    excerpt:
      "The solstice fire burned blue for three minutes. Nobody spoke. The barn cats gathered in a perfect circle. When the flame returned to orange, every animal looked toward the north field simultaneously.",
    mood: "cozy",
  },
  {
    id: "workers-day",
    season: "workers-day",
    year: null,
    entryType: "Seed Catalog",
    excerpt:
      "New hybrid: starlight tomato. Grows only during meteor showers. Requires soil turned by hand at dawn. Yield: exactly seven fruits per plant. Each one tastes like a different summer memory.",
    mood: "hopeful",
  },
  {
    id: "international-yoga-day",
    season: "international-yoga-day",
    year: null,
    entryType: "Growth Notes",
    excerpt:
      "Corn reached 8 feet. Some stalks hummed in the wind — a low C-sharp. The meditation garden produced its first lotus. It opened at 5:47 AM to the sound of exactly one rooster, though we keep none.",
    mood: "serene",
  },
  {
    id: "test-entry-2026",
    season: "test-entry-2026",
    year: null,
    startMonth: 6,
    startDay: 5,
    durationDays: 1,
    entryType: "Growth Notes 123",
    excerpt:
      "Corn reached 8 feet. Some stalks hummed in the wind — a low C-sharp. The meditation garden produced its first lotus. It opened at 5:47 AM to the sound of exactly one rooster, though we keep none.",
    mood: "serene",
    themeKey: "festival-grove",
  },
];

module.exports = {
  HARVEST_ARCHIVE_ENTRIES,
};
