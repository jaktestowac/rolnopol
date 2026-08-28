import { describe, it, expect } from "vitest";

// The bizarre-alert catalogue (services/special-alerts.data.js).
//
// Pure data, and therefore easy to assume is fine. It is not quite: the catalogue
// deliberately uses a WIDER vocabulary than the generator that draws from it —
// `severity: "apocalyptic"` and `category: "unearthly"` exist nowhere in
// `alerts.service`'s own `severities`/`categories` lists — and each of those extra
// values only renders because `public/alerts.html` and `alerts.css` happen to know
// about it. That agreement spans three files that never import each other, so a
// test is the only thing holding it together: add a severity here with no case in
// `sevClass` and the badge silently renders as `sev-unknown`.
const fs = require("fs");
const path = require("path");

const { SPECIAL_ALERTS } = require("../../services/special-alerts.data");
const createAlertsService = require("../../services/alerts.service");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const ALERTS_PAGE = fs.readFileSync(path.join(PUBLIC_DIR, "alerts.html"), "utf8");
const ALERTS_CSS = fs.readFileSync(path.join(PUBLIC_DIR, "css", "pages", "alerts.css"), "utf8");

// The generator's own vocabulary, read off an instance rather than copied.
const service = createAlertsService("test-region");
const GENERATOR_SEVERITIES = service.severities;
const GENERATOR_CATEGORIES = service.categories;

const severitiesUsed = [...new Set(SPECIAL_ALERTS.map((alert) => alert.severity))].sort();
const categoriesUsed = [...new Set(SPECIAL_ALERTS.map((alert) => alert.category))].sort();

/** Severities `sevClass` in alerts.html has an explicit case for. */
const severitiesHandledByPage = [...ALERTS_PAGE.matchAll(/case "([a-z]+)":\s*\n\s*return "sev-\1";/g)].map((match) => match[1]);

describe("special alerts — catalogue shape", () => {
  it("is a non-empty frozen-by-convention array of plain objects", () => {
    expect(Array.isArray(SPECIAL_ALERTS)).toBe(true);
    expect(SPECIAL_ALERTS.length).toBeGreaterThan(0);

    for (const alert of SPECIAL_ALERTS) {
      expect(typeof alert).toBe("object");
      expect(alert).not.toBeNull();
    }
  });

  it("gives every entry the four fields the generator copies onto an alert", () => {
    for (const alert of SPECIAL_ALERTS) {
      expect(typeof alert.category).toBe("string");
      expect(typeof alert.title).toBe("string");
      expect(typeof alert.message).toBe("string");
      expect(typeof alert.severity).toBe("string");
    }
  });

  it("leaves no field blank — an empty title renders an empty card", () => {
    for (const alert of SPECIAL_ALERTS) {
      expect(alert.category.trim()).not.toBe("");
      expect(alert.title.trim()).not.toBe("");
      expect(alert.message.trim()).not.toBe("");
      expect(alert.severity.trim()).not.toBe("");
    }
  });

  it("carries no field the generator would silently drop", () => {
    // `_pick` copies exactly category, severity, title and message. A fifth field
    // added here would look configured and do nothing.
    for (const alert of SPECIAL_ALERTS) {
      expect(Object.keys(alert).sort()).toEqual(["category", "message", "severity", "title"]);
    }
  });

  it("has unique titles, so a duplicate cannot masquerade as two different alerts", () => {
    const titles = SPECIAL_ALERTS.map((alert) => alert.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("uses lower-case single-word categories and severities", () => {
    for (const alert of SPECIAL_ALERTS) {
      expect(alert.category).toMatch(/^[a-z]+$/);
      expect(alert.severity).toMatch(/^[a-z]+$/);
    }
  });

  it("keeps every message a single line — the card has no markup escape", () => {
    for (const alert of SPECIAL_ALERTS) {
      expect(alert.message).not.toMatch(/[\r\n]/);
    }
  });

  it("does not smuggle markup into a title or message", () => {
    // `alertCard` interpolates both straight into a template string with no
    // escaping, so a tag or an entity here would be live markup on the page.
    // Bare angle brackets are fine and deliberate — one message is styled as a
    // corrupted machine log — so this looks for tag-shaped text, not for `>`.
    const tagLike = /<[/!]?[a-zA-Z]/;
    const entityLike = /&[a-zA-Z#][a-zA-Z0-9]*;/;

    for (const alert of SPECIAL_ALERTS) {
      for (const text of [alert.title, alert.message]) {
        expect(text).not.toMatch(tagLike);
        expect(text).not.toMatch(entityLike);
      }
    }
  });

  it("contains nothing that would break out of the card's template string", () => {
    for (const alert of SPECIAL_ALERTS) {
      for (const text of [alert.title, alert.message]) {
        expect(text).not.toContain("`");
        expect(text).not.toContain("${");
      }
    }
  });
});

describe("special alerts — the vocabulary is deliberately wider than the generator's", () => {
  it("uses severities the generator's own list does not contain", () => {
    // Documenting the intent, not a bug: `apocalyptic` is the catalogue's whole
    // point, and the page has a dedicated style for it.
    const beyond = severitiesUsed.filter((severity) => !GENERATOR_SEVERITIES.includes(severity));

    expect(beyond).toEqual(["apocalyptic"]);
  });

  it("uses categories the generator's own list does not contain", () => {
    const beyond = categoriesUsed.filter((category) => !GENERATOR_CATEGORIES.includes(category));

    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond).toContain("unearthly");
  });

  it("still draws most of its categories from the generator's set", () => {
    const shared = categoriesUsed.filter((category) => GENERATOR_CATEGORIES.includes(category));

    expect(shared.length).toBeGreaterThan(severitiesUsed.length);
  });
});

describe("special alerts — every severity used actually renders", () => {
  it("has an explicit sevClass case in alerts.html for each severity", () => {
    for (const severity of severitiesUsed) {
      expect(severitiesHandledByPage).toContain(severity);
    }
  });

  it("has a .sev-<severity> rule in alerts.css for each severity", () => {
    for (const severity of severitiesUsed) {
      expect(ALERTS_CSS).toContain(`.sev-${severity}`);
    }
  });

  it("also covers the generator's four severities, so an ordinary alert is never unstyled", () => {
    for (const severity of GENERATOR_SEVERITIES) {
      expect(severitiesHandledByPage).toContain(severity);
      expect(ALERTS_CSS).toContain(`.sev-${severity}`);
    }
  });

  it("found the page's severity switch at all — a rename must fail loudly, not vacuously", () => {
    expect(severitiesHandledByPage.length).toBeGreaterThanOrEqual(5);
  });
});

describe("special alerts — the region placeholder", () => {
  it("carries no 'PL-MA' placeholder, so the generator's substitution is a no-op today", () => {
    // `alerts.service` runs `message.replace("PL-MA", region)` on every special
    // alert. Nothing in the catalogue contains that token, so the call changes
    // nothing. Pinned rather than removed: if a message is written WITH the
    // placeholder later, this test is what says the substitution starts mattering.
    const withPlaceholder = SPECIAL_ALERTS.filter((alert) => alert.message.includes("PL-MA"));

    expect(withPlaceholder).toEqual([]);
  });

  it("hard-codes no other region token that would leak past the substitution", () => {
    // Only "PL-MA" is substituted, so any other PL-xx literal would stay wrong for
    // every farm outside that region.
    for (const alert of SPECIAL_ALERTS) {
      const regionTokens = alert.message.match(/\bPL-[A-Z0-9]{2}\b/g) || [];
      for (const token of regionTokens) {
        expect(token).toBe("PL-MA");
      }
    }
  });
});

describe("special alerts — the catalogue is varied enough to be worth having", () => {
  it("spreads across many categories rather than clustering in one", () => {
    expect(categoriesUsed.length).toBeGreaterThanOrEqual(5);
  });

  it("uses more than one severity", () => {
    expect(severitiesUsed.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every message enough text to read as an alert, and a bounded amount", () => {
    for (const alert of SPECIAL_ALERTS) {
      expect(alert.message.length).toBeGreaterThan(40);
      expect(alert.message.length).toBeLessThan(1000);
      expect(alert.title.length).toBeLessThan(120);
    }
  });
});
