/**
 * Rolnopol Survival — visual asset registry (PRD 6.13, 11.1, WP-46, WP-47).
 *
 * Game code asks for `resource.water`, never for `fa-droplet`. The registry is
 * the only place that knows whether a key is an icon font, a picture or a slice
 * of a sprite sheet, which is what makes "swap the icons for artwork later" a
 * one-object change instead of a hunt through templates.
 *
 * Three rules hold this together:
 *   1. Size comes from CSS, never from the asset. A 64x64 png drops into the
 *      slot an icon used to hold without moving the layout.
 *   2. Every key carries a text fallback, so a blocked CDN or a missing file
 *      still leaves a readable panel (WP-34).
 *   3. The key list is closed. Asking for a key that is not registered throws
 *      in strict mode rather than quietly drawing nothing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./strings.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.assets = factory(root.Survival.strings);
  }
})(typeof self !== "undefined" ? self : globalThis, function (strings) {
  "use strict";

  function icon(value, labelKey, fallback) {
    return { kind: "icon", value, labelKey, fallback };
  }

  /**
   * The shipped set. Thirty-one keys: five resources, seven terrain types, three
   * special locations, four expedition markers, five event categories, six actions and
   * the player.
   */
  const FONT_AWESOME = {
    "resource.health": icon("fa-heart-pulse", "resource.health", "HP"),
    "resource.water": icon("fa-droplet", "resource.water", "WTR"),
    "resource.food": icon("fa-drumstick-bite", "resource.food", "FOOD"),
    "resource.fatigue": icon("fa-bed", "resource.fatigue", "FTG"),
    "resource.orientation": icon("fa-compass", "resource.orientation", "BRG"),

    "terrain.open": icon("fa-square", "terrain.open", "."),
    "terrain.forest": icon("fa-tree", "terrain.forest", "F"),
    "terrain.desert": icon("fa-sun", "terrain.desert", "D"),
    "terrain.mountain": icon("fa-mountain", "terrain.mountain", "M"),
    "terrain.river": icon("fa-water", "terrain.river", "R"),
    "terrain.swamp": icon("fa-bugs", "terrain.swamp", "S"),
    "terrain.trail": icon("fa-shoe-prints", "terrain.trail", "T"),

    "marker.cabin": icon("fa-house", "terrain.cabin", "C"),
    "marker.waterSource": icon("fa-faucet-drip", "terrain.waterSource", "W"),
    "marker.foodSource": icon("fa-seedling", "terrain.foodSource", "G"),

    // One per category rather than per event (koncepcja 9.1). Six icons for
    // twenty-four events left most of them unmarked; five cover all of them and
    // every one added later.
    "eventCategory.weather": icon("fa-cloud-bolt", "eventCategory.weather", "WTHR"),
    "eventCategory.animals": icon("fa-paw", "eventCategory.animals", "ANML"),
    "eventCategory.personal": icon("fa-heart-crack", "eventCategory.personal", "SELF"),
    "eventCategory.discovery": icon("fa-box-open", "eventCategory.discovery", "FIND"),
    "eventCategory.tracks": icon("fa-shoe-prints", "eventCategory.tracks", "TRKS"),

    "action.move": icon("fa-person-walking", "log.move", "MOVE"),
    "action.rest": icon("fa-campground", "action.rest", "REST"),
    "action.searchWater": icon("fa-magnifying-glass-location", "action.searchWater", "SRCH"),
    "action.searchFood": icon("fa-wheat-awn", "action.searchFood", "FRGE"),
    "action.checkMap": icon("fa-map", "hud.terrain", "MAP"),
    "action.investigate": icon("fa-magnifying-glass", "action.investigate", "LOOK"),

    "marker.unknown": icon("fa-circle-question", "hud.marker", "?"),
    "marker.target": icon("fa-person-circle-check", "scenario.search.name", "!"),
    "marker.lead": icon("fa-person-circle-question", "scenario.search.name", "-"),

    "marker.chaser": icon("fa-person-running", "hud.pursuit", "!!"),

    "marker.player": icon("fa-person", "game.title", "@"),
  };

  const KEYS = Object.keys(FONT_AWESOME);

  const themes = { fontawesome: FONT_AWESOME };
  let activeTheme = "fontawesome";
  let strict = true;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  /** The asset for a key in the active theme, falling back to the base set. */
  function resolve(key) {
    const theme = themes[activeTheme] || FONT_AWESOME;
    const asset = theme[key] || FONT_AWESOME[key];

    if (!asset) {
      if (strict) throw new Error("Unknown survival asset key: " + key);
      return null;
    }
    return asset;
  }

  /**
   * Markup for one asset. Always wrapped in a fixed-size span so that swapping
   * an icon for a picture cannot shift the layout.
   */
  function render(key, options) {
    const asset = resolve(key);
    if (!asset) return "";

    const extraClass = (options && options.className) || "";
    const label = label_(key);
    const wrapperClass = ("wp-asset " + extraClass).trim();
    const title = options && options.title === false ? "" : ' title="' + escapeHtml(label) + '"';
    let inner;

    if (asset.kind === "icon") {
      inner = '<i class="fa-solid ' + escapeHtml(asset.value) + '" aria-hidden="true"></i>';
    } else if (asset.kind === "image") {
      inner = '<img class="wp-asset__img" src="' + escapeHtml(asset.value) + '" alt="" />';
    } else if (asset.kind === "sprite") {
      const s = asset.value;
      inner =
        '<span class="wp-asset__sprite" style="background-image:url(' +
        escapeHtml(s.sheet) +
        ");background-position:-" +
        Number(s.x) +
        "px -" +
        Number(s.y) +
        "px;width:" +
        Number(s.w) +
        "px;height:" +
        Number(s.h) +
        'px"></span>';
    } else {
      inner = '<span class="wp-asset__fallback">' + escapeHtml(asset.fallback) + "</span>";
    }

    return (
      '<span class="' +
      wrapperClass +
      '" data-asset="' +
      escapeHtml(key) +
      '"' +
      title +
      ">" +
      inner +
      '<span class="wp-asset__text">' +
      escapeHtml(asset.fallback) +
      "</span></span>"
    );
  }

  function label_(key) {
    const asset = resolve(key);
    if (!asset) return "";
    return strings.t(asset.labelKey);
  }

  /**
   * Is the icon font actually there? (WP-34)
   *
   * Font Awesome comes from a CDN, and a blocked CDN leaves `<i>` elements that
   * draw nothing at all — a panel of blank squares rather than a readable one.
   * When this returns false the page switches to the text fallbacks every asset
   * already carries.
   *
   * @param {Document} documentRef  injected so this is testable without a DOM
   */
  function iconFontAvailable(documentRef) {
    const doc = documentRef;
    if (!doc || typeof doc.createElement !== "function") return false;

    const probe = doc.createElement("i");
    probe.className = "fa-solid fa-droplet";
    probe.style.position = "absolute";
    probe.style.left = "-9999px";
    doc.body.appendChild(probe);

    let available = false;
    try {
      const view = doc.defaultView || (typeof window !== "undefined" ? window : null);
      const style = view && view.getComputedStyle ? view.getComputedStyle(probe, ":before") : null;
      const content = style ? style.getPropertyValue("content") : "";
      available = !!content && content !== "none" && content !== "normal" && content !== '""';
    } catch (error) {
      available = false;
    }

    probe.remove();
    return available;
  }

  /** Register a whole set. Partial sets fall back to the shipped icons. */
  function registerTheme(name, table) {
    themes[name] = table;
    return name;
  }

  function useTheme(name) {
    if (!themes[name]) throw new Error("Unknown survival asset theme: " + name);
    activeTheme = name;
    return name;
  }

  return {
    KEYS,
    FONT_AWESOME,
    render,
    label: label_,
    resolve,
    registerTheme,
    useTheme,
    iconFontAvailable,
    activeTheme: () => activeTheme,
    setStrict(value) {
      strict = !!value;
    },
    escapeHtml,
  };
});
