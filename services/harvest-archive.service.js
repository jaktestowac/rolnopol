/**
 * Holiday Harvest Archive — Service layer.
 *
 * Checks celebration events for active harvest seasons and enriches
 * archive entries with theme metadata from CELEBRATION_EVENTS.
 */

const fs = require("fs");
const path = require("path");
const celebrationEventsService = require("./celebration-events.service");
const celebrationEvents = celebrationEventsService.default || celebrationEventsService;
const { getCelebrationEventsForDate, listCelebrationEvents, buildOccurrence, parseDate } = celebrationEvents;

/**
 * Resolve HARVEST_ARCHIVE_ENTRIES without stale module caching.
 *
 * Node's `require()` caches modules permanently. To pick up changes to
 * `data/harvest-archive.data.js` without restarting the app we:
 *   1. Track the file's last-known mtime.
 *   2. On each call, stat the file — if mtime changed, delete the
 *      cache entry and re-require.
 *   3. Return the fresh (or cached) array.
 */
let _cachedEntries = null;
let _cachedMtime = 0;
const _dataFile = path.resolve(__dirname, "../data/harvest-archive.data.js");

function getHarvestArchiveEntries() {
  try {
    const stat = fs.statSync(_dataFile);
    const mtimeMs = stat.mtimeMs;

    if (_cachedEntries === null || mtimeMs !== _cachedMtime) {
      // Bust Node's require cache so the next require() re-executes the module
      delete require.cache[require.resolve(_dataFile)];
      const mod = require(_dataFile);
      _cachedEntries = mod.HARVEST_ARCHIVE_ENTRIES || [];
      _cachedMtime = mtimeMs;
    }
  } catch (err) {
    // If the file can't be read, fall back to whatever we have
    if (_cachedEntries === null) {
      const mod = require(_dataFile);
      _cachedEntries = mod.HARVEST_ARCHIVE_ENTRIES || [];
    }
  }

  return _cachedEntries;
}

/** Event IDs that qualify as "harvest" seasons for the archive */
const HARVEST_EVENT_IDS = Object.freeze(["autumn-equinox", "winter-holidays", "workers-day", "international-yoga-day"]);

/**
 * Theme key → visual theme mapping for frontend consumption.
 *
 * Each theme defines:
 *   colors       – primary / secondary / bg / accent / surface / muted
 *   fonts        – header / body font families
 *   imagery      – keyword for background imagery / particle effects
 *   glow         – CSS box-shadow glow for accent elements { color, spread }
 *   particles    – particle overlay config { type, density, speed }
 *   borders      – card & panel border styles { style, width, radius }
 *   gradients    – named gradient presets for banners and headers
 *   textShadow   – text-shadow for headings { color, blur }
 *   cardBg       – entry card background { from, to } for linear-gradient
 *   iconFilter   – CSS filter for emoji/icons (e.g. "drop-shadow(...)")
 *   animation    – ambient animation hints for the page body
 *   soundscape   – optional ambient audio keyword (future use)
 */
const THEME_KEY_MAP = Object.freeze({
  "festival-grove": {
    colors: { primary: "#A0522D", secondary: "#FFD700", bg: "#1a0f05", accent: "#D4A76A", surface: "#2a1a0a", muted: "#8B6D4B" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "autumn-leaves",
    glow: { color: "rgba(255, 215, 0, 0.35)", spread: "0 0 20px" },
    particles: { type: "leaves", density: 12, speed: 1.2 },
    borders: { style: "solid", width: "1px", radius: "1rem" },
    gradients: {
      banner: "linear-gradient(135deg, #1a0f05 0%, #3d220e 50%, #1a0f05 100%)",
      header: "linear-gradient(90deg, transparent, rgba(255,215,0,0.08), transparent)",
    },
    textShadow: { color: "rgba(255, 215, 0, 0.25)", blur: "8px" },
    cardBg: { from: "rgba(42, 26, 10, 0.85)", to: "rgba(30, 18, 6, 0.92)" },
    iconFilter: "drop-shadow(0 0 6px rgba(255, 215, 0, 0.5))",
    animation: "harvest-sway",
    soundscape: "autumn-wind",
  },
  "winter-legend": {
    colors: { primary: "#2C3E50", secondary: "#ECF0F1", bg: "#0a0e1a", accent: "#88a7ff", surface: "#141c2e", muted: "#6b7fa3" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "winter-frost",
    glow: { color: "rgba(136, 167, 255, 0.3)", spread: "0 0 24px" },
    particles: { type: "snow", density: 20, speed: 0.8 },
    borders: { style: "solid", width: "1px", radius: "1rem" },
    gradients: {
      banner: "linear-gradient(135deg, #0a0e1a 0%, #162040 50%, #0a0e1a 100%)",
      header: "linear-gradient(90deg, transparent, rgba(136,167,255,0.06), transparent)",
    },
    textShadow: { color: "rgba(136, 167, 255, 0.3)", blur: "10px" },
    cardBg: { from: "rgba(20, 28, 46, 0.85)", to: "rgba(14, 18, 32, 0.92)" },
    iconFilter: "drop-shadow(0 0 8px rgba(136, 167, 255, 0.5))",
    animation: "harvest-frost-drift",
    soundscape: "winter-hush",
  },
  "quest-log": {
    colors: { primary: "#6B4226", secondary: "#D4A76A", bg: "#120c05", accent: "#C8963E", surface: "#1e1408", muted: "#7a6340" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "parchment",
    glow: { color: "rgba(200, 150, 62, 0.25)", spread: "0 0 16px" },
    particles: { type: "dust", density: 6, speed: 0.5 },
    borders: { style: "double", width: "3px", radius: "0.75rem" },
    gradients: {
      banner: "linear-gradient(135deg, #120c05 0%, #2a1c0a 50%, #120c05 100%)",
      header: "linear-gradient(90deg, transparent, rgba(200,150,62,0.06), transparent)",
    },
    textShadow: { color: "rgba(200, 150, 62, 0.2)", blur: "6px" },
    cardBg: { from: "rgba(30, 20, 8, 0.88)", to: "rgba(20, 14, 5, 0.94)" },
    iconFilter: "drop-shadow(0 0 4px rgba(200, 150, 62, 0.4))",
    animation: "harvest-parchment-fade",
    soundscape: "parchment-rustle",
  },
  "sunlit-quest": {
    colors: { primary: "#D4AC0D", secondary: "#F9E79F", bg: "#141005", accent: "#F4D03F", surface: "#221a08", muted: "#a08c4a" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "sunlit-field",
    glow: { color: "rgba(244, 208, 63, 0.35)", spread: "0 0 22px" },
    particles: { type: "pollen", density: 10, speed: 0.7 },
    borders: { style: "solid", width: "1px", radius: "1.25rem" },
    gradients: {
      banner: "linear-gradient(135deg, #141005 0%, #382e0a 50%, #141005 100%)",
      header: "linear-gradient(90deg, transparent, rgba(244,208,63,0.07), transparent)",
    },
    textShadow: { color: "rgba(244, 208, 63, 0.3)", blur: "10px" },
    cardBg: { from: "rgba(34, 26, 8, 0.85)", to: "rgba(22, 16, 4, 0.92)" },
    iconFilter: "drop-shadow(0 0 8px rgba(244, 208, 63, 0.5))",
    animation: "harvest-golden-shimmer",
    soundscape: "summer-cicadas",
  },
  "storybook-bloom": {
    colors: { primary: "#5B2C6F", secondary: "#D7BDE2", bg: "#0d0512", accent: "#AF7AC5", surface: "#1a0c24", muted: "#8e6a9e" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "storybook-bloom",
    glow: { color: "rgba(175, 122, 197, 0.3)", spread: "0 0 20px" },
    particles: { type: "petals", density: 8, speed: 0.9 },
    borders: { style: "solid", width: "1px", radius: "1rem" },
    gradients: {
      banner: "linear-gradient(135deg, #0d0512 0%, #241038 50%, #0d0512 100%)",
      header: "linear-gradient(90deg, transparent, rgba(175,122,197,0.06), transparent)",
    },
    textShadow: { color: "rgba(175, 122, 197, 0.25)", blur: "8px" },
    cardBg: { from: "rgba(26, 12, 36, 0.85)", to: "rgba(16, 6, 22, 0.92)" },
    iconFilter: "drop-shadow(0 0 6px rgba(175, 122, 197, 0.5))",
    animation: "harvest-petal-drift",
    soundscape: "enchanted-garden",
  },
  "library-quest": {
    colors: { primary: "#1B4F72", secondary: "#AED6F1", bg: "#050a12", accent: "#5DADE2", surface: "#0c1824", muted: "#5a8aa8" },
    fonts: { header: "Georgia, serif", body: "Arial, sans-serif" },
    imagery: "library-quest",
    glow: { color: "rgba(93, 173, 226, 0.25)", spread: "0 0 18px" },
    particles: { type: "sparkle", density: 5, speed: 0.4 },
    borders: { style: "solid", width: "1px", radius: "0.5rem" },
    gradients: {
      banner: "linear-gradient(135deg, #050a12 0%, #0e1e30 50%, #050a12 100%)",
      header: "linear-gradient(90deg, transparent, rgba(93,173,226,0.05), transparent)",
    },
    textShadow: { color: "rgba(93, 173, 226, 0.25)", blur: "8px" },
    cardBg: { from: "rgba(12, 24, 36, 0.88)", to: "rgba(6, 12, 20, 0.94)" },
    iconFilter: "drop-shadow(0 0 5px rgba(93, 173, 226, 0.4))",
    animation: "harvest-sparkle-drift",
    soundscape: "library-ambience",
  },
});

function resolveTheme(themeKey) {
  return THEME_KEY_MAP[themeKey] || THEME_KEY_MAP["quest-log"];
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getArchiveEventDefinitions() {
  const definitions = new Map();

  for (const entry of getHarvestArchiveEntries()) {
    const id = entry.id;
    const existing = definitions.get(id) || {
      id,
      name: entry.name || entry.season || id,
      themeKey: entry.themeKey,
      emoji: entry.emoji,
      bannerTitle: entry.bannerTitle,
      bannerSubtitle: entry.bannerSubtitle,
      description: entry.description,
      startMonth: entry.startMonth,
      startDay: entry.startDay,
      durationDays: entry.durationDays,
    };

    if (existing.themeKey == null && entry.themeKey != null) {
      existing.themeKey = entry.themeKey;
    }
    if (existing.emoji == null && entry.emoji != null) {
      existing.emoji = entry.emoji;
    }
    if (existing.bannerTitle == null && entry.bannerTitle != null) {
      existing.bannerTitle = entry.bannerTitle;
    }
    if (existing.bannerSubtitle == null && entry.bannerSubtitle != null) {
      existing.bannerSubtitle = entry.bannerSubtitle;
    }
    if (existing.description == null && entry.description != null) {
      existing.description = entry.description;
    }
    if (existing.startMonth == null && typeof entry.startMonth === "number") {
      existing.startMonth = entry.startMonth;
    }
    if (existing.startDay == null && typeof entry.startDay === "number") {
      existing.startDay = entry.startDay;
    }
    if (existing.durationDays == null && typeof entry.durationDays === "number") {
      existing.durationDays = entry.durationDays;
    }

    definitions.set(id, existing);
  }

  return definitions;
}

function isDateWithinOccurrence(date, occurrence) {
  const current = date.getTime();
  const start = Date.parse(`${occurrence.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${occurrence.endDate}T23:59:59.999Z`);
  return current >= start && current <= end;
}

function findCelebrationEvent(eventId) {
  const all = listCelebrationEvents();
  return all.find((ev) => ev.id === eventId) || null;
}

function isArchiveEventEligible(event) {
  if (HARVEST_EVENT_IDS.includes(event.id)) {
    return true;
  }

  const archiveDef = getArchiveEventDefinitions().get(event.id);
  return archiveDef != null && typeof archiveDef.startMonth === "number" && typeof archiveDef.startDay === "number";
}

function getActiveArchiveEventsForDate(dateStr) {
  const targetDate = parseDate(dateStr);
  const activeEvents = [];
  const celebrationIds = new Set(listCelebrationEvents().map((ev) => ev.id));

  for (const event of getArchiveEventDefinitions().values()) {
    if (celebrationIds.has(event.id)) {
      continue;
    }

    if (typeof event.startMonth !== "number" || typeof event.startDay !== "number") {
      continue;
    }

    const occurrence = buildOccurrence(event, targetDate.getUTCFullYear());
    if (!occurrence) {
      continue;
    }

    if (isDateWithinOccurrence(targetDate, occurrence)) {
      activeEvents.push({
        ...occurrence,
        seedDate: dateStr,
      });
    }
  }

  return activeEvents;
}

/**
 * Check if a harvest celebration event is currently active.
 * @param {string} [dateStr] — ISO date string (YYYY-MM-DD). Defaults to today.
 * @returns {Promise<{ active: boolean, event?: object }>}
 */
async function getArchiveMetadata(dateStr) {
  const targetDate = dateStr || getLocalDateString();
  const activeEvents = [...getCelebrationEventsForDate(targetDate), ...getActiveArchiveEventsForDate(targetDate)];
  const harvestEvent = activeEvents.find(isArchiveEventEligible);

  if (!harvestEvent) {
    return { active: false };
  }

  const celebrationData = findCelebrationEvent(harvestEvent.id) || getArchiveEventDefinitions().get(harvestEvent.id);
  const theme = resolveTheme(celebrationData?.themeKey);
  const eventName = harvestEvent.name || celebrationData?.name || harvestEvent.id;

  return {
    active: true,
    event: {
      id: harvestEvent.id,
      name: eventName,
      emoji: celebrationData?.emoji || "",
      bannerTitle: celebrationData?.bannerTitle || eventName,
      bannerSubtitle: celebrationData?.bannerSubtitle || "",
      theme,
    },
  };
}

/**
 * Get enriched archive entries for the currently active harvest event.
 * @param {string} [dateStr] — ISO date string (YYYY-MM-DD). Defaults to today.
 * @returns {Promise<{ active: boolean, event?: object, entries: object[] }>}
 */
async function getArchiveEntries(dateStr) {
  const metadata = await getArchiveMetadata(dateStr);

  if (!metadata.active) {
    return { active: false, entries: [] };
  }

  const eventId = metadata.event.id;
  const targetDate = dateStr || getLocalDateString();
  const [y] = targetDate.split("-").map(Number);

  const entries = getHarvestArchiveEntries()
    .filter((entry) => {
      if (entry.id !== eventId) return false;
      if (entry.year !== null && entry.year !== undefined && entry.year !== y) return false;
      return true;
    })
    .map((entry) => ({
      ...entry,
      theme: metadata.event.theme,
    }));

  return {
    active: true,
    event: metadata.event,
    entries,
  };
}

module.exports = {
  getArchiveMetadata,
  getArchiveEntries,
  HARVEST_EVENT_IDS,
};
