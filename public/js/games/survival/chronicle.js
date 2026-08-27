/**
 * Rolnopol Survival — the expedition as something you can tell (PRD 8.17, faza C).
 *
 * A finished run used to leave six numbers and a wall of journal text. Everything
 * needed for more than that was already there and unread: the route walked, the
 * ground it crossed, and a journal that already sorts its own lines by kind
 * (PRD 8.13). This module reads those and produces three things:
 *
 *   - a picture of the map with the route on it, small enough to sit on an end
 *     screen or in a history row;
 *   - the handful of journal lines that were actually the story;
 *   - a plain-text report, so an expedition can leave the browser.
 *
 * No DOM and no drawing. `picture()` returns a grid of plain objects and the
 * page decides how to paint them, which is the same seam the icons use (PRD
 * 11.1) and the reason all of this can be tested in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./strings.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.chronicle = factory(root.Survival.strings);
  }
})(typeof self !== "undefined" ? self : globalThis, function (strings) {
  "use strict";

  // How wide a picture may get before it starts sampling. Chosen to sit inside
  // a modal without scrolling; a 128 by 128 map lands on a 4 by 4 sample.
  const MAX_PICTURE_WIDTH = 40;

  // Journal kinds that carry the story. Movement, weather and ambience are what
  // the story happens between.
  const MOMENT_KINDS = ["good", "harm", "event"];
  const MOMENT_LIMIT = 8;

  // One character per terrain for the text report. Deliberately not the icon
  // set: this has to survive a paste into a chat window.
  const GLYPHS = {
    open: ".",
    forest: "f",
    desert: ",",
    mountain: "^",
    river: "~",
    swamp: "%",
  };

  /** The route as coordinates. Stored flat, so unpack it here and nowhere else. */
  function routeOf(source) {
    const flat = (source && (Array.isArray(source) ? source : source.route)) || [];
    const steps = [];

    for (let i = 0; i + 1 < flat.length; i += 2) steps.push({ q: flat[i], r: flat[i + 1] });
    return steps;
  }

  /**
   * The lines worth keeping (PRD 8.17).
   *
   * One entry per key: a fever that ticks for three nights is one thing that
   * happened, not three. The last of each is kept rather than the first,
   * because how a thing ended is usually the part worth reading.
   */
  function moments(state, limit) {
    const keep = new Map();

    for (const entry of (state && state.log) || []) {
      if (!MOMENT_KINDS.includes(entry.kind)) continue;
      keep.set(entry.key, { day: entry.day, key: entry.key, kind: entry.kind, text: entry.text });
    }

    const found = [...keep.values()].sort((a, b) => a.day - b.day);
    const cap = limit || MOMENT_LIMIT;

    // Over the cap, keep the ends: how it started and how it finished.
    if (found.length <= cap) return found;
    const head = Math.ceil(cap / 2);
    return found.slice(0, head).concat(found.slice(found.length - (cap - head)));
  }

  /** Moments without their text, small enough to sit in an expedition record. */
  function momentKeys(state, limit) {
    return moments(state, limit).map((moment) => ({ day: moment.day, key: moment.key, kind: moment.kind }));
  }

  function blankCell() {
    return { terrain: null, revealed: false, visited: false, route: false, start: false, end: false, feature: null };
  }

  function featureOf(tile) {
    if (tile.hasCabin) return "cabin";
    if (tile.hasWaterSource) return "spring";
    if (tile.hasFoodSource) return "forage";
    if (tile.hasTrail || tile.hasFord) return "trail";
    return null;
  }

  /**
   * The map as a grid of cells, with the route drawn on it.
   *
   * A big map is sampled rather than scrolled: one output cell stands for a
   * square block of hexes and takes the most interesting thing in it. That is a
   * lie about the geometry and an honest picture of the journey, which is the
   * right trade for something the size of a postage stamp. Rows are offset on
   * the real map and square here, so read it as a sketch, not a chart.
   *
   * `revealedOnly` keeps the fog: ground the player never saw stays blank.
   */
  function picture(state, options) {
    const settings = options || {};
    const map = state.map;
    const maxWidth = settings.maxWidth || MAX_PICTURE_WIDTH;
    const scale = Math.max(1, Math.ceil(map.width / maxWidth));
    const width = Math.ceil(map.width / scale);
    const height = Math.ceil(map.height / scale);
    const revealedOnly = settings.revealedOnly !== false;

    const cells = [];
    for (let i = 0; i < width * height; i += 1) cells.push(blankCell());

    const cellAt = (col, row) => cells[Math.floor(row / scale) * width + Math.floor(col / scale)];

    for (const tile of map.tiles) {
      if (revealedOnly && !tile.revealed) continue;

      const cell = cellAt(tile.col, tile.row);
      if (!cell) continue;

      cell.revealed = true;
      // Ground the player actually stood on speaks for its block; otherwise the
      // first revealed hex in it does.
      if (tile.visited || cell.terrain === null) cell.terrain = tile.type;
      if (tile.visited) cell.visited = true;
      if (!cell.feature) cell.feature = featureOf(tile);
    }

    const steps = routeOf(state);
    const byKey = map.byKey || {};

    steps.forEach((step, index) => {
      const tileIndex = byKey[step.q + "," + step.r];
      const tile = tileIndex === undefined ? null : map.tiles[tileIndex];
      if (!tile) return;

      const cell = cellAt(tile.col, tile.row);
      if (!cell) return;

      cell.route = true;
      cell.revealed = true;
      if (cell.terrain === null) cell.terrain = tile.type;
      if (index === 0) cell.start = true;
      if (index === steps.length - 1) cell.end = true;
    });

    return { width, height, scale, cells };
  }

  /**
   * The picture as text, one character a cell.
   *
   * Rows that are nothing but fog are dropped off the top and the bottom. On a
   * large map the part anybody walked is a small island in a lot of nothing,
   * and twenty blank lines is not a map, it is padding.
   */
  function pictureText(drawing) {
    const lines = [];

    for (let row = 0; row < drawing.height; row += 1) {
      let line = "";
      for (let col = 0; col < drawing.width; col += 1) {
        const cell = drawing.cells[row * drawing.width + col];
        if (cell.start) line += "S";
        else if (cell.end) line += "X";
        else if (cell.route) line += "o";
        else if (!cell.revealed) line += " ";
        else line += GLYPHS[cell.terrain] || ".";
      }
      lines.push(line.replace(/[ ]+$/, ""));
    }

    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();

    return lines.join("\n");
  }

  /**
   * The whole expedition as plain text (PRD 8.17).
   *
   * Text rather than an image on purpose: it pastes into anything, it carries
   * the seed so the map can be walked again, and it needs no canvas.
   */
  function report(state, meta) {
    const extra = meta || {};
    const outcome = strings.t(state.result === "won" ? "end.win.title" : "end.loss.title");

    const lines = [
      strings.t("game.title"),
      "",
      strings.t("hud.scenario") + ": " + strings.t("scenario." + state.scenarioId + ".name"),
      strings.t("chronicle.outcome") + ": " + outcome,
      strings.t("end.days") + ": " + state.day,
      strings.t("end.hexes") + ": " + state.stats.hexesTravelled,
      strings.t("chronicle.difficulty") + ": " + strings.t("difficulty." + state.difficulty),
      strings.t("chronicle.mapSize") + ": " + strings.t("mapSize." + state.mapSize),
      strings.t("end.seed") + ": " + state.seed,
    ];

    if (extra.date) lines.push(strings.t("chronicle.date") + ": " + extra.date);
    if (state.cheatsUsed) lines.push(strings.t("end.cheated"));

    lines.push("", strings.t("chronicle.map"), "", pictureText(picture(state, { maxWidth: 48 })), "");

    const story = moments(state);
    if (story.length) {
      lines.push(strings.t("chronicle.moments"));
      for (const moment of story) lines.push("  " + strings.t("hud.day") + " " + moment.day + ": " + moment.text);
      lines.push("");
    }

    if (Array.isArray(extra.achievements) && extra.achievements.length) {
      lines.push(strings.t("chronicle.achievements"));
      for (const id of extra.achievements) lines.push("  " + strings.t("achievement." + id + ".name"));
      lines.push("");
    }

    return lines.join("\n").trim() + "\n";
  }

  return {
    routeOf,
    moments,
    momentKeys,
    picture,
    pictureText,
    report,
    GLYPHS,
    MOMENT_KINDS,
    MOMENT_LIMIT,
    MAX_PICTURE_WIDTH,
  };
});
