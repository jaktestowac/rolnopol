/**
 * Rolnopol Survival — the cheat console (PRD 8.8).
 *
 * Opens on the tilde key. Everything in it is a registry entry, so adding a
 * button later is one object here rather than a change to the panel.
 *
 * Two rules the console holds to:
 *
 * 1. Every cheat goes through the same functions the game uses. A cheat can
 *    set water to full, but it cannot set water to twelve — `change()` clamps
 *    it like it clamps a thunderstorm (PRD 6.5). The console is a shortcut
 *    through the game, not a way around it.
 *
 * 2. Using one marks the run. The backend takes the client at its word
 *    (PRD 10.4), which is a reasonable trade for a single-player game — but it
 *    is a different thing to help a run launder a false result. A cheated
 *    expedition says so on the end screen, in the history, and in the record.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./config.js"), require("./game.js"), require("./events.js"));
  } else {
    root.Survival = root.Survival || {};
    root.Survival.cheats = factory(root.Survival.config, root.Survival.game, root.Survival.events);
  }
})(typeof self !== "undefined" ? self : globalThis, function (config, game, events) {
  "use strict";

  const CHEATS = {};

  /**
   * @param {object} definition
   * @param {string} definition.id
   * @param {"action"|"value"|"choice"} definition.kind
   * @param {string} definition.labelKey    button or field label
   * @param {string} definition.tooltipKey  what it does, shown on hover
   * @param {(state: object, value: *) => void} definition.apply
   * @param {(state: object) => *} [definition.read]     current value, for fields
   * @param {(state: object) => Array} [definition.options]  for a choice
   */
  function register(definition) {
    CHEATS[definition.id] = definition;
    return definition.id;
  }

  // ── the whole map at once ──────────────────────────────────────────────────

  register({
    id: "revealMap",
    kind: "action",
    labelKey: "cheat.revealMap",
    tooltipKey: "cheat.revealMap.tip",
    apply(state) {
      for (const tile of state.map.tiles) tile.revealed = true;
    },
  });

  register({
    id: "fillStores",
    kind: "action",
    labelKey: "cheat.fillStores",
    tooltipKey: "cheat.fillStores.tip",
    apply(state) {
      for (const resource of ["health", "water", "food"]) {
        game.change(state, resource, config.RESOURCES[resource].max);
      }
      game.change(state, "fatigue", -config.RESOURCES.fatigue.max);
    },
  });

  register({
    id: "heal",
    kind: "action",
    labelKey: "cheat.heal",
    tooltipKey: "cheat.heal.tip",
    apply(state) {
      game.clearConditions(state);
    },
  });

  register({
    id: "refillMovement",
    kind: "action",
    labelKey: "cheat.refillMovement",
    tooltipKey: "cheat.refillMovement.tip",
    apply(state) {
      state.movementLeft = config.movementPointsFor(state.player);
    },
  });

  register({
    id: "skipDay",
    kind: "action",
    labelKey: "cheat.skipDay",
    tooltipKey: "cheat.skipDay.tip",
    apply(state) {
      game.endDay(state);
    },
  });

  register({
    id: "winNow",
    kind: "action",
    labelKey: "cheat.winNow",
    tooltipKey: "cheat.winNow.tip",
    apply(state) {
      state.gameOver = true;
      state.result = "won";
      game.addLog(state, "cheat.log.win");
    },
  });

  register({
    id: "loseNow",
    kind: "action",
    labelKey: "cheat.loseNow",
    tooltipKey: "cheat.loseNow.tip",
    apply(state) {
      state.gameOver = true;
      state.result = "lost";
      state.player.alive = false;
      game.addLog(state, "cheat.log.lose");
    },
  });

  // ── pick something and make it happen ──────────────────────────────────────

  register({
    id: "fireEvent",
    kind: "choice",
    labelKey: "cheat.fireEvent",
    tooltipKey: "cheat.fireEvent.tip",
    options() {
      return Object.keys(events.EVENTS).sort();
    },
    apply(state, value) {
      game.triggerEvent(state, value);
    },
  });

  register({
    id: "setWeather",
    kind: "choice",
    labelKey: "cheat.setWeather",
    tooltipKey: "cheat.setWeather.tip",
    options() {
      return Object.keys(config.WEATHER);
    },
    read(state) {
      return state.weather;
    },
    apply(state, value) {
      if (!config.WEATHER[value]) return;
      state.forcedWeather = value;
      game.rollWeather(state);
    },
  });

  // ── dials ──────────────────────────────────────────────────────────────────

  for (const resource of ["health", "water", "food", "fatigue", "orientation"]) {
    register({
      id: "set-" + resource,
      kind: "value",
      labelKey: "resource." + resource,
      tooltipKey: "cheat.setResource.tip",
      min: config.RESOURCES[resource].min,
      max: config.RESOURCES[resource].max,
      read(state) {
        return state.player[resource];
      },
      apply(state, value) {
        // Through the game's own setter, so the range still holds.
        game.change(state, resource, Number(value) - state.player[resource]);
      },
    });
  }

  register({
    id: "set-movement",
    kind: "value",
    labelKey: "hud.movement",
    tooltipKey: "cheat.setMovement.tip",
    min: 0,
    max: 20,
    read(state) {
      return state.movementLeft;
    },
    apply(state, value) {
      state.movementLeft = Math.max(0, Math.min(20, Math.trunc(Number(value))));
    },
  });

  function list() {
    return Object.keys(CHEATS).map((id) => CHEATS[id]);
  }

  function get(id) {
    return CHEATS[id] || null;
  }

  /**
   * Run a cheat and mark the run.
   * The mark is the point: everything else here is a convenience.
   */
  function apply(state, id, value) {
    const cheat = get(id);
    if (!cheat || !state) return { ok: false, reason: "unknown-cheat" };

    cheat.apply(state, value);
    state.cheatsUsed = true;

    return { ok: true, id };
  }

  return { CHEATS, register, list, get, apply };
});
