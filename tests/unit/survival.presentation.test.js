/**
 * Rolnopol Survival — the retro shell and its fallbacks (PRD WP-33, WP-34, WP-35).
 *
 * There is no DOM test environment in this repo, so the page itself is checked
 * as source: the styles it declares and the controls it carries. That catches
 * the regressions that matter here — a palette rewritten, the reduced-motion
 * guard dropped, a screen removed — without pretending to be a browser test.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const assets = require("../../public/js/games/survival/assets.js");
const strings = require("../../public/js/games/survival/strings.js");

const CSS = fs.readFileSync(path.join(__dirname, "../../public/css/pages/survival.css"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "../../public/operator/survival.html"), "utf8");

/** A document just real enough for the icon-font probe. */
function stubDocument(reportedContent) {
  const created = [];

  return {
    body: { appendChild: () => {} },
    createElement() {
      const element = { className: "", style: {}, remove: () => {} };
      created.push(element);
      return element;
    },
    defaultView: {
      getComputedStyle: () => ({ getPropertyValue: () => reportedContent }),
    },
    created,
  };
}

describe("survival presentation — WP-33 the retro shell", () => {
  it("declares the palette from the concept document", () => {
    for (const token of ["--wp-bg", "--wp-panel", "--wp-text", "--wp-muted", "--wp-accent", "--wp-danger"]) {
      expect(CSS, token + " is missing").toContain(token);
    }
  });

  it("gives every terrain type its own colour", () => {
    for (const terrain of ["open", "forest", "mountain", "river", "swamp", "desert"]) {
      expect(CSS, terrain + " has no colour").toContain("--wp-" + terrain);
    }
  });

  it("sets a monospace face", () => {
    expect(CSS).toMatch(/font-family:\s*"Courier New"/);
  });

  it("draws the CRT scanlines", () => {
    expect(CSS).toContain("repeating-linear-gradient");
  });

  it("switches the scanlines off for anyone who asked for less motion", () => {
    const guard = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(guard).toContain("prefers-reduced-motion");
    expect(guard).toContain(".wp-page::after");
    expect(guard).toContain("display: none");
  });

  it("stills the hunter's pulse for them too", () => {
    expect(CSS).toContain("wp-chaser-pulse");

    const guards = CSS.split("@media (prefers-reduced-motion: reduce)").slice(1).join("");
    expect(guards).toContain("animation: none");
  });

  it("tells terrain apart by more than colour", () => {
    // Three greens sit next to each other in this palette, so every hex also
    // carries a glyph from the asset registry.
    expect(HTML).toContain("/js/games/survival/assets.js");
    expect(CSS).toContain(".wp-hex__glyph");
  });
});

describe("survival presentation — WP-34 when the icon font never arrives", () => {
  it("reports the font missing when nothing is drawn", () => {
    expect(assets.iconFontAvailable(stubDocument("none"))).toBe(false);
    expect(assets.iconFontAvailable(stubDocument(""))).toBe(false);
    expect(assets.iconFontAvailable(stubDocument("normal"))).toBe(false);
  });

  it("reports the font present when a glyph comes back", () => {
    expect(assets.iconFontAvailable(stubDocument('"\\f043"'))).toBe(true);
  });

  it("survives being handed nothing at all", () => {
    expect(assets.iconFontAvailable(null)).toBe(false);
    expect(assets.iconFontAvailable({})).toBe(false);
  });

  it("carries a text fallback on every single asset", () => {
    const missing = assets.KEYS.filter((key) => {
      const fallback = assets.FONT_AWESOME[key].fallback;
      return typeof fallback !== "string" || fallback.length === 0;
    });

    expect(missing).toEqual([]);
  });

  it("puts that fallback on screen when the page gives up on icons", () => {
    const rule = CSS.slice(CSS.indexOf(".wp-no-icons"));

    expect(rule).toContain(".wp-no-icons .wp-asset i");
    expect(rule).toContain(".wp-no-icons .wp-asset__text");
    expect(rule).toContain("position: static");
  });

  it("hides the fallback while the icons are working", () => {
    const hidden = CSS.slice(CSS.indexOf(".wp-asset__text"), CSS.indexOf(".wp-hex {"));
    expect(hidden).toContain("clip-path: inset(50%)");
  });
});

describe("survival presentation — WP-35 the screens", () => {
  it("carries a main menu with scenario cards and instructions", () => {
    expect(HTML).toContain('id="wpMenu"');
    expect(HTML).toContain('id="wpScenarios"');
    expect(HTML).toContain('id="wpInstructions"');
    expect(HTML).toContain('id="wpStart"');
  });

  it("carries a way back to the menu from a run", () => {
    expect(HTML).toContain('id="wpMenuBtn"');
  });

  it("asks before throwing a run away", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");

    expect(ui).toContain("prompt.abandon.title");
    expect(ui).toContain("abandonRun");
  });

  it("carries the release-3 controls", () => {
    expect(HTML).toContain('id="wpCheckMap"');
    expect(HTML).toContain('id="wpInvestigate"');
    expect(HTML).toContain('id="wpCarrying"');
    expect(HTML).toContain('id="wpScenarioName"');
  });

  it("carries the release-4 controls and panels", () => {
    expect(HTML).toContain('id="wpCamp"');
    expect(HTML).toContain('id="wpWeather"');
    expect(HTML).toContain('id="wpConditions"');
    expect(HTML).toContain('id="wpChoice"');
    expect(HTML).toContain('id="wpEndJournal"');
  });

  it("gives an event that asks a question no way out but answering", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");
    const modal = HTML.slice(HTML.indexOf('id="wpChoice"'), HTML.indexOf('id="wpMenu"'));

    // No close button in the markup, and the keyboard is dead while it is up.
    expect(modal).not.toContain("wpChoiceClose");
    expect(ui).toContain("if (!els.wpChoice.hidden) return;");
  });

  it("carries the controls the last release added", () => {
    expect(HTML).toContain('id="wpResume"');
    expect(HTML).toContain('id="wpDaily"');
    expect(HTML).toContain('id="wpDeadline"');
    expect(HTML).toContain('id="wpPursuit"');
  });

  it("carries the chronicle on the end screen (PRD 8.17)", () => {
    expect(HTML).toContain('id="wpEndMap"');
    expect(HTML).toContain('id="wpEndMoments"');
    expect(HTML).toContain('id="wpEndAchievements"');
    expect(HTML).toContain('id="wpCopyReport"');
  });

  it("carries the record screen (PRD 8.18)", () => {
    expect(HTML).toContain('id="wpProgress"');
    expect(HTML).toContain('id="wpProgressBody"');
    expect(HTML).toContain('id="wpProgressBtn"');
  });

  it("gives the route somewhere to be drawn, and the route colours to be drawn in", () => {
    expect(CSS).toContain(".wp-picture__cell--route");
    expect(CSS).toContain(".wp-picture__cell--start");
    expect(CSS).toContain(".wp-picture__cell--end");
    expect(CSS).toContain(".wp-picture__cell--unseen");
  });

  it("marks a locked expedition as locked rather than hiding it", () => {
    // Hiding a scenario answers no question. A card that says what it wants is
    // the reason to play again, which is the whole point of the ladder.
    expect(CSS).toContain(".wp-scenario--locked");
    expect(CSS).toContain(".wp-mark--locked");
  });

  it("keeps every module the page loads in the styles it needs", () => {
    expect(HTML).toContain("achievements.js");
    expect(HTML).toContain("chronicle.js");
  });

  it("draws only the hexes near the window", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");

    // The largest map is 16384 hexes and the window shows a few hundred.
    // Drawing the rest costs a megabyte of markup per click and buys nothing.
    expect(ui).toContain("visibleBounds");
    expect(ui).toMatch(/bounds\.(left|right|top|bottom)/);
  });

  it("builds the board as one string rather than thousands of elements", () => {
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");
    const renderer = ui.slice(ui.indexOf("function renderMap"), ui.indexOf("function describeTile"));

    expect(renderer).not.toContain("createElement");
    expect(renderer).toContain("innerHTML");
  });

  it("binds no listener straight to a function that expects an argument", () => {
    // A listener is called with the event. `showMenu` grew a first parameter —
    // the message to print on the menu — and the end screen was still handing
    // it over bare, so leaving a run printed "[object PointerEvent]".
    const ui = fs.readFileSync(path.join(__dirname, "../../public/js/games/survival/ui.js"), "utf8");
    const bound = [...ui.matchAll(/addEventListener\("\w+",\s*([A-Za-z_$][\w$]*)\)/g)].map((match) => match[1]);

    expect(bound.length, "nothing is bound bare any more, so this guard is asleep").toBeGreaterThan(0);

    const takesAnArgument = bound.filter((name) => {
      const declaration = ui.match(new RegExp("function\\s+" + name + "\\s*\\(([^)]*)\\)"));
      return declaration ? declaration[1].trim().length > 0 : false;
    });

    expect(takesAnArgument).toEqual([]);
  });

  it("ends a run with a way back to the menu, which is what the button does", () => {
    const endScreen = HTML.slice(HTML.indexOf('id="wpEndClose"'));

    expect(endScreen.slice(0, endScreen.indexOf(">"))).toContain("action.returnToMenu");
    expect(strings.has("action.returnToMenu")).toBe(true);
  });

  it("keeps a dialog inside the window it is in", () => {
    // The end screen grew a map, the moments and the marks on top of the
    // journal, and the box had no height cap at all. `.wp-modal` centres its
    // child, so the overflow hung off both ends with no way to reach either.
    const box = CSS.slice(CSS.indexOf(".wp-modal__box {"));
    const rule = box.slice(0, box.indexOf("}"));

    expect(rule).toMatch(/max-height:/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
    // Without a shared reset on this page the padding would sit outside the cap.
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  it("keeps the route picture from being the tallest thing on the end screen", () => {
    // Square cells: a 40-column picture stretched to a wide box is as tall as
    // the box is wide, which pushes the journal and the buttons out of reach.
    const picture = CSS.slice(CSS.indexOf(".wp-picture {"));
    expect(picture.slice(0, picture.indexOf("}"))).toMatch(/max-width:\s*min\(/);
  });

  it("gives the two screens that carry the most the wider box", () => {
    const endScreen = HTML.slice(HTML.indexOf('id="wpEnd"'), HTML.indexOf('id="wpEndTitle"'));
    const record = HTML.slice(HTML.indexOf('id="wpProgress"'), HTML.indexOf('id="wpProgressBody"'));

    expect(endScreen).toContain("wp-modal__box--wide");
    expect(record).toContain("wp-modal__box--wide");
  });

  it("stacks the screens so a dialog is never buried under the one that opened it", () => {
    // The scoreboard, the history and the instructions are all opened from the
    // main menu, which is a full-screen overlay. A dialog with a lower z-index
    // than the menu is a dialog nobody can see, and that is exactly what
    // happened to the scoreboard.
    function layerOf(selector) {
      const rule = CSS.slice(CSS.indexOf(selector + " {"));
      const match = rule.slice(0, rule.indexOf("}")).match(/z-index:\s*(\d+)/);
      return match ? Number(match[1]) : null;
    }

    const menu = layerOf(".wp-menu");
    const modal = layerOf(".wp-modal");
    const cheats = layerOf(".wp-cheats");

    expect(menu).toBeGreaterThan(0);
    expect(modal, "a dialog must sit above the menu").toBeGreaterThan(menu);
    expect(cheats, "the console opens over anything").toBeGreaterThan(modal);
  });

  it("puts the scoreboard on the main menu (PRD 8.11)", () => {
    expect(HTML).toContain('id="wpScoreboardBtn"');
    expect(HTML).toContain('id="wpScoreboard"');
    expect(HTML).toContain('id="wpScoreboardBody"');
    expect(strings.has("scoreboard.note")).toBe(true);
  });

  it("says on screen that cheated runs are not counted", () => {
    expect(strings.t("scoreboard.note").toLowerCase()).toContain("cheat");
  });

  it("loads every game module the page needs", () => {
    const files = ["markers.js", "scenarios.js", "events.js", "chaser.js", "snapshot.js", "cheats.js", "balance-bot.js", "ui.js"];
    for (const file of files) {
      expect(HTML, file + " is not loaded").toContain("/js/games/survival/" + file);
    }
  });
});
