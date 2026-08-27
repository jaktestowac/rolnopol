/**
 * Rolnopol Survival — the how-to-play guide (PRD 8.12).
 *
 * The tests that matter here are not "does it render" but "does it still tell
 * the truth". The guide is built from the game's own tables, and these check
 * that it stayed that way: a balance change has to move the guide with it, and
 * a number typed into the prose by hand would slip past every one of them.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const guide = require("../../public/js/games/survival/guide.js");
const config = require("../../public/js/games/survival/config.js");
const strings = require("../../public/js/games/survival/strings.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");

const HTML = fs.readFileSync(path.join(__dirname, "../../public/operator/survival.html"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "../../public/css/pages/survival.css"), "utf8");

/** Text with the markup stripped, which is what a reader actually sees. */
function readable() {
  return guide
    .render()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("survival guide — the sections the PRD asks for", () => {
  it("has all six", () => {
    expect(guide.SECTIONS.map((section) => section.id)).toEqual(["goal", "controls", "resources", "events", "scenarios", "tips"]);
  });

  it("gives every one a heading from the dictionary", () => {
    for (const section of guide.SECTIONS) {
      expect(strings.has(section.titleKey), section.id + " has no title").toBe(true);
    }
  });

  it("renders every one into the page", () => {
    const html = guide.render();

    for (const section of guide.SECTIONS) {
      expect(html, section.id + " is missing").toContain('data-guide="' + section.id + '"');
    }
  });
});

describe("survival guide — it reads the game rather than repeating it", () => {
  it("prints the terrain costs the game actually charges", () => {
    const html = guide.render();

    for (const type of config.TERRAIN_TYPES) {
      const label = strings.t("terrain." + type);
      const row = html.slice(html.indexOf(label));

      expect(row, type + " has no cost beside it").toContain("<td>" + config.TERRAIN[type].cost + "</td>");
    }
  });

  it("names the wounds that change how you move, and only those (PRD 8.16)", () => {
    const html = guide.render();

    for (const id of Object.keys(config.CONDITIONS)) {
      const name = strings.t("condition." + id + ".name");
      const listed = html.includes("<dt>" + name + "</dt>");

      expect(listed, name + " is listed as hobbling when it is not, or the other way round").toBe(config.conditionChangesMovement(id));
    }
  });

  it("says what each of those wounds actually does", () => {
    const html = guide.render();

    // A sprain costs a point and makes rough ground rougher, so both have to be
    // on the page. Reading the table is what keeps this true after a rebalance.
    expect(html).toContain(strings.t("condition.effect.movement"));
    expect(html).toContain(strings.t("condition.effect.rough"));
    expect(html).toContain(strings.t("condition.effect.vision"));
  });

  it("prints the resource ranges the config declares", () => {
    const html = guide.render();

    for (const resource of ["health", "water", "food", "fatigue", "orientation"]) {
      const range = config.RESOURCES[resource];
      expect(html, resource + " has the wrong range").toContain(range.min + "-" + range.max);
    }
  });

  it("quotes the day's movement and the penalties from the config", () => {
    const text = readable();

    expect(text).toContain(String(config.MOVEMENT.base));
    expect(text).toContain(String(config.END_OF_DAY.noWaterDamage));
  });

  it("lists every scenario the game ships, with its own description", () => {
    const text = readable();

    for (const id of scenarios.listScenarios()) {
      const scenario = scenarios.getScenario(id);
      expect(text, id + " is missing from the guide").toContain(strings.t(scenario.nameKey));
    }
  });

  it("fills the day limit into the description that needs one", () => {
    const text = readable();
    const deadline = scenarios.getScenario("deadline");

    expect(text).toContain(String(deadline.dayLimit));
    expect(text, "an unfilled placeholder reached the page").not.toContain("{days}");
  });

  it("leaves no placeholder unfilled anywhere", () => {
    expect(guide.render()).not.toMatch(/\{\w+\}/);
  });

  it("names the keys the page actually binds", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");
    const text = readable();

    // Every letter the guide teaches has to be a letter the game listens for.
    for (const key of ["e", "w", "f", "m", "r", "c"]) {
      expect(text, "the guide does not mention " + key.toUpperCase()).toContain(key.toUpperCase());
      expect(ui, "the page does not bind " + key).toContain('key === "' + key + '"');
    }
  });

  it("illustrates the events section with the marks the journal actually uses", () => {
    const events = require("../../public/js/games/survival/events.js");
    const html = guide.render();

    for (const category of events.CATEGORIES) {
      expect(html, category + " is missing from the guide").toContain("eventCategory." + category);
    }
  });

  it("shows no icon the player never meets in the game", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");
    const html = guide.render();
    const shown = [...html.matchAll(/data-asset="([^"]+)"/g)].map((match) => match[1]);

    // Every asset the guide puts on screen has to be one the page draws too,
    // otherwise the guide is teaching a symbol that appears nowhere.
    for (const key of new Set(shown)) {
      const family = key.split(".")[0];
      expect(ui, key + " is drawn nowhere in the game").toContain(family);
    }
  });

  it("takes its icons from the registry, not from class names typed here", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/guide.js"), "utf8");

    expect(source).not.toMatch(/\bfa-[a-z]/);
    expect(source).toContain("assets.render");
  });
});

describe("survival guide — how it looks", () => {
  it("draws its sample hexes with the map's own styles", () => {
    expect(guide.render()).toContain("wp-hex--sample");
    // The map lays hexes out absolutely; a sample has to sit in the text.
    const rule = CSS.slice(CSS.indexOf(".wp-hex--sample"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("position: static");
  });

  it("gets a wider box and a scroll of its own", () => {
    expect(HTML).toContain("wp-modal__box--wide");
    expect(HTML).toContain('id="wpGuide"');
    expect(CSS).toContain(".wp-guide {");
    expect(CSS.slice(CSS.indexOf(".wp-guide {"))).toContain("overflow-y: auto");
  });

  it("stays readable on a narrow screen", () => {
    const narrow = CSS.slice(CSS.indexOf("@media (max-width: 640px)"));

    expect(narrow).toContain(".wp-guide__keys");
    expect(narrow).toContain("grid-template-columns: 1fr");
  });

  it("no longer ships the two-paragraph version it replaced", () => {
    expect(HTML).not.toContain('data-string="menu.instructions.body"');
  });
});
