/**
 * Rolnopol Survival — the how-to-play guide (PRD 8.12).
 *
 * The guide is generated from the game's own data: terrain costs come from the
 * config, the scenario list from the scenario registry, the icons from the asset
 * registry, the words from the dictionary. Nothing here restates a number that
 * lives somewhere else.
 *
 * That is the whole point. A guide written by hand tells the truth on the day it
 * is written and lies quietly after the next balance change — and this game has
 * had a balance change in every release so far.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./config.js"),
      require("./strings.js"),
      require("./assets.js"),
      require("./scenarios.js"),
      require("./events.js"),
    );
  } else {
    root.Survival = root.Survival || {};
    root.Survival.guide = factory(
      root.Survival.config,
      root.Survival.strings,
      root.Survival.assets,
      root.Survival.scenarios,
      root.Survival.events,
    );
  }
})(typeof self !== "undefined" ? self : globalThis, function (config, strings, assets, scenarios, events) {
  "use strict";

  const escape = assets.escapeHtml;

  function paragraph(key, params) {
    return '<p class="wp-guide__text">' + escape(strings.t(key, params)) + "</p>";
  }

  /**
   * The wounds that change how you move (PRD 8.16).
   *
   * Read off `config.CONDITIONS`, like the terrain costs above it: a wound that
   * gains an effect cannot quietly stop explaining itself, and one that loses
   * its effects drops off this list on its own.
   */
  function woundEffects(id) {
    const rules = config.CONDITIONS[id] || {};
    const parts = [];

    if (rules.movement) parts.push(strings.t("condition.effect.movement"));
    if (rules.roughSurcharge) parts.push(strings.t("condition.effect.rough"));
    if (rules.vision) parts.push(strings.t("condition.effect.vision"));
    if (rules.forcedMarchHealth) parts.push(strings.t("condition.effect.forcedMarch"));

    return parts;
  }

  function woundList() {
    const hobbling = Object.keys(config.CONDITIONS).filter((id) => config.conditionChangesMovement(id));
    if (hobbling.length === 0) return "";

    return (
      paragraph("guide.events.wounds") +
      '<dl class="wp-guide__list">' +
      hobbling
        .map((id) => "<dt>" + escape(strings.t("condition." + id + ".name")) + "</dt><dd>" + escape(woundEffects(id).join(", ")) + "</dd>")
        .join("") +
      "</dl>"
    );
  }

  /** A hex drawn the way the map draws it, sitting in the flow of the text. */
  function sampleHex(assetKey, terrain, caption) {
    return (
      '<figure class="wp-guide__hex">' +
      '<span class="wp-hex wp-hex--sample wp-hex--' +
      escape(terrain) +
      '"><span class="wp-hex__glyph">' +
      assets.render(assetKey, { title: false }) +
      "</span></span>" +
      "<figcaption>" +
      escape(caption) +
      "</figcaption></figure>"
    );
  }

  function figures(items) {
    return '<div class="wp-guide__figures">' + items.join("") + "</div>";
  }

  // ── the sections ───────────────────────────────────────────────────────────

  const SECTIONS = [
    {
      id: "goal",
      titleKey: "guide.goal.title",
      render() {
        return (
          paragraph("guide.goal.body") +
          figures([
            sampleHex("marker.player", "open", strings.t("guide.goal.you")),
            sampleHex("terrain.trail", "open", strings.t("terrain.trail")),
            sampleHex("marker.cabin", "open", strings.t("terrain.cabin")),
          ]) +
          paragraph("guide.goal.day", { movement: config.MOVEMENT.base })
        );
      },
    },

    {
      id: "controls",
      titleKey: "guide.controls.title",
      render() {
        const keys = [
          ["1-6", "guide.controls.walk"],
          ["E", "action.investigate"],
          ["W", "action.searchWater"],
          ["F", "action.searchFood"],
          ["M", "action.checkMap"],
          ["R", "action.rest"],
          ["C", "action.camp"],
          ["Space", "action.endDay"],
        ];

        return (
          paragraph("guide.controls.body") +
          '<ul class="wp-guide__keys">' +
          keys
            .map(([key, labelKey]) => "<li><kbd>" + escape(key) + "</kbd><span>" + escape(strings.t(labelKey)) + "</span></li>")
            .join("") +
          "</ul>"
        );
      },
    },

    {
      id: "resources",
      titleKey: "guide.resources.title",
      render() {
        const rows = ["health", "water", "food", "fatigue", "orientation"].map(
          (resource) =>
            "<tr><td>" +
            assets.render("resource." + resource, { title: false }) +
            " " +
            escape(strings.t("resource." + resource)) +
            "</td><td>" +
            config.RESOURCES[resource].min +
            "-" +
            config.RESOURCES[resource].max +
            "</td><td>" +
            escape(strings.t("guide.resources." + resource)) +
            "</td></tr>",
        );

        return (
          paragraph("guide.resources.body", {
            noWater: config.END_OF_DAY.noWaterDamage,
            noFood: config.END_OF_DAY.noFoodDamage,
          }) +
          '<table class="wp-guide__table"><tbody>' +
          rows.join("") +
          "</tbody></table>" +
          paragraph("guide.resources.terrain") +
          '<table class="wp-guide__table"><tbody>' +
          config.TERRAIN_TYPES.map(
            (type) =>
              "<tr><td>" +
              assets.render("terrain." + type, { title: false }) +
              " " +
              escape(strings.t("terrain." + type)) +
              "</td><td>" +
              config.TERRAIN[type].cost +
              "</td></tr>",
          ).join("") +
          "<tr><td>" +
          assets.render("terrain.trail", { title: false }) +
          " " +
          escape(strings.t("terrain.trail")) +
          "</td><td>1</td></tr>" +
          "</tbody></table>"
        );
      },
    },

    {
      id: "events",
      titleKey: "guide.events.title",
      render() {
        // The five categories, with the marks the journal puts beside them, and
        // the count of what is in each read off the registry.
        return (
          paragraph("guide.events.body") +
          '<ul class="wp-guide__keys">' +
          events.CATEGORIES.map(
            (category) =>
              "<li>" +
              assets.render("eventCategory." + category, { title: false }) +
              "<span>" +
              escape(strings.t("eventCategory." + category)) +
              "</span></li>",
          ).join("") +
          "</ul>" +
          paragraph("guide.events.choices") +
          paragraph("guide.events.conditions") +
          woundList()
        );
      },
    },

    {
      id: "scenarios",
      titleKey: "guide.scenarios.title",
      render() {
        return (
          paragraph("guide.scenarios.body") +
          '<dl class="wp-guide__list">' +
          scenarios
            .listScenarios()
            .map((id) => {
              const scenario = scenarios.getScenario(id);
              return (
                "<dt>" +
                escape(strings.t(scenario.nameKey)) +
                "</dt><dd>" +
                escape(strings.t(scenario.descriptionKey, { days: scenario.dayLimit })) +
                "</dd>"
              );
            })
            .join("") +
          "</dl>"
        );
      },
    },

    {
      id: "tips",
      titleKey: "guide.tips.title",
      render() {
        const tips = [
          "guide.tips.trails",
          "guide.tips.landmarks",
          "guide.tips.searchOnce",
          "guide.tips.cabin",
          "guide.tips.forcedMarch",
          "guide.tips.seed",
        ];

        return '<ul class="wp-guide__tips">' + tips.map((key) => "<li>" + escape(strings.t(key)) + "</li>").join("") + "</ul>";
      },
    },
  ];

  /** The whole guide as markup, ready for the modal. */
  function render() {
    return SECTIONS.map(
      (section) =>
        '<section class="wp-guide__section" data-guide="' +
        escape(section.id) +
        '"><h3 class="wp-guide__heading">' +
        escape(strings.t(section.titleKey)) +
        "</h3>" +
        section.render() +
        "</section>",
    ).join("");
  }

  return { SECTIONS, render };
});
