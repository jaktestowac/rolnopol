/**
 * Rolnopol Survival — asset registry and dictionary (PRD WP-46, WP-47, WP-48).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const assets = require("../../public/js/games/survival/assets.js");
const strings = require("../../public/js/games/survival/strings.js");

const GAME_DIR = path.join(__dirname, "../../public/js/games/survival");

function readGameFile(name) {
  return fs.readFileSync(path.join(GAME_DIR, name), "utf8");
}

function gameFiles() {
  return fs.readdirSync(GAME_DIR).filter((file) => file.endsWith(".js"));
}

afterEach(() => {
  assets.useTheme("fontawesome");
  assets.setStrict(true);
});

describe("survival assets — WP-46 semantic keys", () => {
  it("registers the thirty-one keys the game needs", () => {
    expect(assets.KEYS).toHaveLength(31);
  });

  it("has an icon for every event, by way of its category", () => {
    const events = require("../../public/js/games/survival/events.js");

    for (const category of events.CATEGORIES) {
      expect(assets.KEYS, category + " has no icon").toContain("eventCategory." + category);
    }

    const orphans = Object.keys(events.EVENTS).filter((id) => !assets.KEYS.includes("eventCategory." + events.EVENTS[id].category));
    expect(orphans).toEqual([]);
  });

  it("draws every icon at the same size, whatever text surrounds it", () => {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(path.join(__dirname, "../../public/css/pages/survival.css"), "utf8");
    const slot = css.slice(css.indexOf(".wp-asset {"), css.indexOf("}", css.indexOf(".wp-asset {")));

    // Without this the icon font inherits the surrounding font-size, which made
    // the same icon 16px on the map and 11px under a sample hex in the guide.
    expect(slot).toMatch(/font-size:\s*\d+px/);
  });

  it("renders an icon with its text fallback beside it", () => {
    const markup = assets.render("resource.water");

    expect(markup).toContain("fa-droplet");
    expect(markup).toContain('data-asset="resource.water"');
    expect(markup).toContain("WTR");
  });

  it("throws on an unregistered key rather than drawing nothing", () => {
    expect(() => assets.render("resource.morale")).toThrow(/Unknown survival asset key/);
  });

  it("keeps icon classes out of the rest of the game code", () => {
    const offenders = gameFiles()
      .filter((file) => file !== "assets.js")
      .filter((file) => /\bfa-[a-z]/.test(readGameFile(file)));

    expect(offenders).toEqual([]);
  });
});

describe("survival assets — WP-47 swapping the set for artwork", () => {
  it("takes pictures in place of icons without touching game code", () => {
    assets.registerTheme("test-artwork", {
      "resource.water": { kind: "image", value: "/images/survival/water.png", labelKey: "resource.water", fallback: "WTR" },
      "resource.food": { kind: "image", value: "/images/survival/food.png", labelKey: "resource.food", fallback: "FOOD" },
      "terrain.swamp": { kind: "image", value: "/images/survival/swamp.png", labelKey: "terrain.swamp", fallback: "S" },
    });
    assets.useTheme("test-artwork");

    expect(assets.render("resource.water")).toContain('<img class="wp-asset__img" src="/images/survival/water.png"');
    expect(assets.render("terrain.swamp")).toContain("swamp.png");

    // Keys the partial set does not cover keep the shipped icon.
    expect(assets.render("resource.health")).toContain("fa-heart-pulse");
  });

  it("supports sprite sheets through the same call", () => {
    assets.registerTheme("test-sprite", {
      "marker.player": {
        kind: "sprite",
        value: { sheet: "/images/survival/sheet.png", x: 32, y: 64, w: 16, h: 16 },
        labelKey: "game.title",
        fallback: "@",
      },
    });
    assets.useTheme("test-sprite");

    const markup = assets.render("marker.player");
    expect(markup).toContain("background-position:-32px -64px");
    expect(markup).toContain("width:16px");
  });

  it("refuses an unknown theme", () => {
    expect(() => assets.useTheme("nope")).toThrow(/Unknown survival asset theme/);
  });
});

describe("survival strings — WP-48 one dictionary", () => {
  it("fills placeholders", () => {
    expect(strings.t("log.move", { terrain: "forest" })).toBe("You move onto forest.");
  });

  it("resolves every literal key the game and the UI ask for", () => {
    const missing = [];

    for (const file of ["game.js", "ui.js"]) {
      const source = readGameFile(file);
      const pattern = /strings\.t\(\s*"([^"]+)"/g;
      let match = pattern.exec(source);

      while (match) {
        // Keys built at runtime ("terrain." + tile.type) end at the dot and are
        // covered by the terrain test below instead.
        if (!match[1].endsWith(".") && !strings.has(match[1])) missing.push(file + ": " + match[1]);
        match = pattern.exec(source);
      }
    }

    expect(missing).toEqual([]);
  });

  it("names every difficulty and every expedition status", () => {
    const config = require("../../public/js/games/survival/config.js");

    const missingDifficulty = Object.keys(config.DIFFICULTIES).filter((name) => !strings.has("difficulty." + name));
    expect(missingDifficulty).toEqual([]);

    const statuses = ["in_progress", "won", "lost", "abandoned"];
    expect(statuses.filter((status) => !strings.has("history.status." + status))).toEqual([]);
  });

  it("names every terrain type the config knows", () => {
    const config = require("../../public/js/games/survival/config.js");
    const missing = config.TERRAIN_TYPES.filter((type) => !strings.has("terrain." + type));
    expect(missing).toEqual([]);
  });

  it("resolves every literal key the game writes into the journal", () => {
    const source = readGameFile("game.js");
    const pattern = /addLog\(state,\s*"([^"]+)"/g;
    const missing = [];
    let match = pattern.exec(source);

    while (match) {
      // Families built at runtime end at the dot; the test below covers them.
      if (!match[1].endsWith(".") && !strings.has(match[1])) missing.push(match[1]);
      match = pattern.exec(source);
    }

    expect(missing).toEqual([]);
  });

  it("names every outcome of a search, for both resources", () => {
    const missing = [];

    for (const family of ["log.searchFound", "log.searchFailed", "log.searchExhausted"]) {
      for (const kind of ["water", "food"]) {
        if (!strings.has(family + "." + kind)) missing.push(family + "." + kind);
      }
    }

    expect(missing).toEqual([]);
  });

  it("resolves every label the asset registry points at", () => {
    const missing = assets.KEYS.filter((key) => !strings.has(assets.FONT_AWESOME[key].labelKey));
    expect(missing).toEqual([]);
  });
});
