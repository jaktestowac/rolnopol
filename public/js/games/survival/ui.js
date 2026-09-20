/**
 * Rolnopol Survival — the browser layer (PRD 11, WP-14, WP-15, WP-17).
 *
 * This is the only file allowed to touch the DOM. It reads game state and draws
 * it; it never decides a rule. Every string comes from the dictionary and every
 * icon from the asset registry, so this file contains no English and no
 * `fa-` class of its own.
 */
(function (root) {
  "use strict";

  const S = root.Survival;
  const { config, hex, game, strings, assets, apiClient, balanceBot, scenarios, snapshot, cheats, guide, events } = S;
  const { chronicle, achievements } = S;

  const HEX_WIDTH = 54;
  const HEX_HEIGHT = 62;
  const ROW_STEP = HEX_HEIGHT * 0.75;

  const els = {};
  let state = null;
  let sessionId = null;
  let recorded = false;
  let pendingConfirm = null;

  // The map is larger than the window onto it, so the page carries its own
  // scroll position. Transform rather than scrollbars: dragging is the point.
  const pan = { x: 0, y: 0 };

  /**
   * What the backend last said about this player (PRD 8.18).
   *
   * Null means nobody has asked yet, or the ask failed. Both are treated as
   * "everything is open": the menu never locks a player out because the network
   * was down, and the server refuses a locked scenario anyway (WP-99).
   */
  let progress = null;
  let dragging = null;
  let mapRedrawQueued = false;
  let chosenScenario = "lost";

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      "wpBanner",
      "wpSeed",
      "wpDay",
      "wpMove",
      "wpHealth",
      "wpWater",
      "wpFood",
      "wpFatigue",
      "wpOrientation",
      "wpHealthIcon",
      "wpWaterIcon",
      "wpFoodIcon",
      "wpFatigueIcon",
      "wpOrientationIcon",
      "wpMap",
      "wpViewport",
      "wpHexInfo",
      "wpJournal",
      "wpEndDay",
      "wpForce",
      "wpRest",
      "wpSearchWater",
      "wpSearchFood",
      "wpDifficulty",
      "wpMapSize",
      "wpCheckMap",
      "wpInvestigate",
      "wpCamp",
      "wpWeather",
      "wpConditions",
      "wpChoice",
      "wpChoiceTitle",
      "wpChoiceBody",
      "wpChoiceActions",
      "wpEndJournal",
      "wpDeadline",
      "wpDaysLeft",
      "wpPursuit",
      "wpPursuitState",
      "wpResume",
      "wpDaily",
      "wpScoreboardBtn",
      "wpScoreboard",
      "wpScoreboardBody",
      "wpScoreboardClose",
      "wpCheats",
      "wpCheatsBody",
      "wpCheatsFold",
      "wpCheatActions",
      "wpCheatDials",
      "wpEndCheated",
      "wpCarrying",
      "wpScenarioName",
      "wpMenu",
      "wpMenuBtn",
      "wpScenarios",
      "wpStart",
      "wpInstructions",
      "wpInstructionsBtn",
      "wpInstructionsClose",
      "wpGuide",
      "wpHistory",
      "wpHistoryModal",
      "wpHistoryList",
      "wpHistoryClose",
      "wpConfirm",
      "wpConfirmTitle",
      "wpConfirmBody",
      "wpConfirmOk",
      "wpConfirmCancel",
      "wpEnd",
      "wpEndTitle",
      "wpEndStats",
      "wpEndSeed",
      "wpCopySeed",
      "wpEndClose",
      "wpEndRecorded",
      "wpEndMap",
      "wpEndMoments",
      "wpEndMomentsList",
      "wpEndAchievements",
      "wpEndAchievementsList",
      "wpCopyReport",
      "wpProgressBtn",
      "wpProgress",
      "wpProgressBody",
      "wpProgressClose",
      "wpMenuNotice",
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  // ── static labels ──────────────────────────────────────────────────────────

  function paintStaticLabels() {
    document.title = strings.t("game.title");
    document.querySelectorAll("[data-string]").forEach((node) => {
      node.textContent = strings.t(node.getAttribute("data-string"));
    });
    els.wpDifficulty.innerHTML = Object.keys(config.DIFFICULTIES)
      .map(
        (name) =>
          '<option value="' +
          assets.escapeHtml(name) +
          '"' +
          (name === config.DEFAULT_DIFFICULTY ? " selected" : "") +
          ">" +
          assets.escapeHtml(strings.t("difficulty." + name)) +
          "</option>",
      )
      .join("");

    els.wpMapSize.innerHTML = Object.keys(config.MAP_SIZES)
      .map(
        (name) =>
          '<option value="' +
          assets.escapeHtml(name) +
          '"' +
          (name === config.DEFAULT_MAP_SIZE ? " selected" : "") +
          ">" +
          assets.escapeHtml(strings.t("mapSize." + name)) +
          "</option>",
      )
      .join("");

    els.wpHealthIcon.innerHTML = assets.render("resource.health");
    els.wpWaterIcon.innerHTML = assets.render("resource.water");
    els.wpFoodIcon.innerHTML = assets.render("resource.food");
    els.wpFatigueIcon.innerHTML = assets.render("resource.fatigue");
    els.wpOrientationIcon.innerHTML = assets.render("resource.orientation");
  }

  // ── map ────────────────────────────────────────────────────────────────────

  function assetKeyFor(tile) {
    if (tile.marker === "npc") return tile.markerInspected ? "marker.target" : "marker.unknown";
    if (tile.marker) return "marker.unknown";
    if (tile.hasCabin) return "marker.cabin";
    if (tile.hasFoodSource) return "marker.foodSource";
    if (tile.hasWaterSource) return "marker.waterSource";
    if (tile.hasTrail) return "terrain.trail";
    return "terrain." + tile.type;
  }

  // ── cheat console (PRD 8.8) ────────────────────────────────────────────────

  function cheatButton(cheat) {
    return (
      '<button class="wp-btn" type="button" data-cheat="' +
      assets.escapeHtml(cheat.id) +
      '" title="' +
      assets.escapeHtml(strings.t(cheat.tooltipKey)) +
      '">' +
      assets.escapeHtml(strings.t(cheat.labelKey)) +
      "</button>"
    );
  }

  function cheatField(cheat) {
    const current = state && cheat.read ? cheat.read(state) : "";
    const label = "<span>" + assets.escapeHtml(strings.t(cheat.labelKey)) + "</span>";
    const title = ' title="' + assets.escapeHtml(strings.t(cheat.tooltipKey)) + '"';

    if (cheat.kind === "choice") {
      const options = (cheat.options ? cheat.options(state) : [])
        .map(
          (option) =>
            '<option value="' +
            assets.escapeHtml(option) +
            '"' +
            (option === current ? " selected" : "") +
            ">" +
            assets.escapeHtml(option) +
            "</option>",
        )
        .join("");

      return (
        '<label class="wp-cheat-field wp-cheat-field--wide"' +
        title +
        ">" +
        label +
        '<select data-cheat="' +
        assets.escapeHtml(cheat.id) +
        '">' +
        options +
        "</select></label>"
      );
    }

    return (
      '<label class="wp-cheat-field"' +
      title +
      ">" +
      label +
      '<input type="number" data-cheat="' +
      assets.escapeHtml(cheat.id) +
      '" min="' +
      Number(cheat.min) +
      '" max="' +
      Number(cheat.max) +
      '" value="' +
      assets.escapeHtml(String(current)) +
      '" /></label>'
    );
  }

  /**
   * Redraw the console from the registry, so a cheat added there shows up here
   * without anything being wired by hand (PRD 8.8).
   */
  function renderCheats() {
    if (els.wpCheats.hidden) return;

    const all = cheats.list();
    els.wpCheatActions.innerHTML = all
      .filter((cheat) => cheat.kind === "action")
      .map(cheatButton)
      .join("");
    els.wpCheatDials.innerHTML = all
      .filter((cheat) => cheat.kind !== "action")
      .map(cheatField)
      .join("");
  }

  function runCheat(id, value) {
    if (!state) return;

    const cheat = cheats.get(id);
    const wasClean = !state.cheatsUsed;
    cheats.apply(state, id, value);
    if (cheat) game.addLog(state, "cheat.log.used", { name: strings.t(cheat.labelKey) });

    // The mark reaches the record at once, not at the next end of day. A run
    // that is cheated and then abandoned has to carry it too (PRD 6.20).
    if (wasClean && state.cheatsUsed) void saveRun();

    render();
    renderCheats();
  }

  function toggleCheats() {
    els.wpCheats.hidden = !els.wpCheats.hidden;
    renderCheats();
  }

  // ── menu (WP-35) ───────────────────────────────────────────────────────────

  /** What a scenario still wants from the player, in words (PRD 8.18). */
  function unlockText(requires) {
    if (!requires) return "";
    if (requires.finished && requires.wins) {
      return strings.t("progress.unlock.both", { count: requires.finished, wins: requires.wins });
    }
    if (requires.wins) return strings.t("progress.unlock.wins", { count: requires.wins });
    return strings.t("progress.unlock.finished", { count: requires.finished });
  }

  /** Is this one open? Unknown progress means yes: see the note on `progress`. */
  function isUnlocked(id) {
    if (!progress || !Array.isArray(progress.scenarios)) return true;
    const row = progress.scenarios.find((entry) => entry.id === id);
    return !row || row.unlocked;
  }

  function renderScenarioCards() {
    els.wpScenarios.innerHTML = scenarios
      .listScenarios()
      .map((id) => {
        const scenario = scenarios.getScenario(id);
        const open = isUnlocked(id);
        const needed = open ? "" : unlockText(scenarios.requirementFor(id));

        return (
          '<button class="wp-scenario' +
          (open ? "" : " wp-scenario--locked") +
          '" type="button" role="radio" data-scenario="' +
          assets.escapeHtml(id) +
          '" aria-checked="' +
          (id === chosenScenario) +
          '"' +
          (open ? "" : ' aria-disabled="true"') +
          '><span class="wp-scenario__name">' +
          assets.escapeHtml(strings.t(scenario.nameKey)) +
          "</span>" +
          (open
            ? '<span class="wp-scenario__text">' +
              assets.escapeHtml(strings.t(scenario.descriptionKey, { days: scenario.dayLimit })) +
              "</span>"
            : '<span class="wp-scenario__text wp-scenario__text--locked">' +
              assets.escapeHtml(strings.t("progress.locked")) +
              ": " +
              assets.escapeHtml(needed) +
              "</span>") +
          "</button>"
        );
      })
      .join("");
  }

  function selectScenario(id) {
    // The card says what it wants; clicking it is not the place to repeat that.
    if (!isUnlocked(id)) return;
    chosenScenario = id;
    renderScenarioCards();
  }

  /**
   * Say something on the menu screen.
   *
   * Not `showBanner`: the banner lives on the game screen, underneath a
   * full-screen menu overlay, so a message put there while the menu is up is a
   * message nobody reads.
   */
  function menuNotice(text) {
    // Only a string is a message. `showMenu` is bound to buttons and exposed on
    // `SurvivalUi`, so anything else that reaches here — an event object, a
    // stray argument — means nothing was meant to be said.
    const message = typeof text === "string" ? text : "";

    els.wpMenuNotice.textContent = message;
    els.wpMenuNotice.hidden = !message;
  }

  function showMenu(notice) {
    els.wpMenu.hidden = false;
    els.wpEnd.hidden = true;
    els.wpHistoryModal.hidden = true;
    els.wpScoreboard.hidden = true;
    els.wpProgress.hidden = true;
    closeConfirm();
    renderScenarioCards();
    menuNotice(notice);

    els.wpResume.hidden = true;
    void findResumable().then((session) => {
      if (!session) return;
      els.wpResume.hidden = false;
      els.wpResume.dataset.session = session.id;
    });

    void refreshProgress();
  }

  /**
   * Pull the record and repaint the cards (PRD 8.18).
   *
   * A locked scenario left selected from an earlier session falls back to Lost,
   * which is the one that is never locked.
   */
  async function refreshProgress() {
    const answer = await apiClient.getProgress();
    progress = answer.ok && answer.data ? answer.data.progress : null;

    if (!isUnlocked(chosenScenario)) chosenScenario = "lost";
    renderScenarioCards();
  }

  /**
   * Leaving a run mid-way is the same thing as starting another one: the record
   * closes as abandoned rather than sitting open forever (PRD 6.12).
   */
  function returnToMenu() {
    if (!state || state.gameOver) {
      showMenu();
      return;
    }

    askConfirm(strings.t("prompt.abandon.title"), strings.t("prompt.abandon.body"), () => {
      void abandonRun();
      showMenu();
    });
  }

  // ── panning (the map is a window, not a poster) ────────────────────────────

  function hexPixel(tile) {
    return {
      x: tile.col * HEX_WIDTH + (tile.row % 2 ? HEX_WIDTH / 2 : 0),
      y: tile.row * ROW_STEP,
    };
  }

  function setTransform() {
    els.wpMap.style.transform = "translate(" + Math.round(pan.x) + "px, " + Math.round(pan.y) + "px)";
  }

  /**
   * Move the window, then redraw what is now behind it.
   *
   * Only the hexes near the window are in the DOM (see renderMap), so panning
   * has to bring the newly exposed ones in. The redraw is coalesced into one
   * frame, otherwise a drag would rebuild the board on every mouse move.
   */
  function applyPan() {
    setTransform();

    if (mapRedrawQueued) return;
    mapRedrawQueued = true;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    schedule(() => {
      mapRedrawQueued = false;
      if (state) renderMap();
    });
  }

  /** Put a tile in the middle of the window, clamped to the map's own edges. */
  function centreOn(tile) {
    if (!tile) return;
    const view = els.wpViewport.getBoundingClientRect();
    const spot = hexPixel(tile);

    pan.x = view.width / 2 - spot.x - HEX_WIDTH / 2;
    pan.y = view.height / 2 - spot.y - HEX_HEIGHT / 2;
    clampPan();
    applyPan();
  }

  /**
   * Keep at least a corner of the map on screen. Without this a stray drag
   * leaves the player staring at empty background with no way back.
   */
  function clampPan() {
    const view = els.wpViewport.getBoundingClientRect();
    const mapWidth = state.map.width * HEX_WIDTH + HEX_WIDTH / 2;
    const mapHeight = (state.map.height - 1) * ROW_STEP + HEX_HEIGHT;
    const margin = HEX_WIDTH * 2;

    pan.x = Math.min(view.width - margin, Math.max(margin - mapWidth, pan.x));
    pan.y = Math.min(view.height - margin, Math.max(margin - mapHeight, pan.y));
  }

  /** Pan only as far as needed to bring the player back into view. */
  function keepPlayerVisible() {
    const tile = game.currentTile(state);
    if (!tile) return;

    const view = els.wpViewport.getBoundingClientRect();
    const spot = hexPixel(tile);
    const margin = HEX_WIDTH * 1.5;
    const x = spot.x + pan.x;
    const y = spot.y + pan.y;

    if (x < margin) pan.x += margin - x;
    else if (x > view.width - margin - HEX_WIDTH) pan.x -= x - (view.width - margin - HEX_WIDTH);

    if (y < margin) pan.y += margin - y;
    else if (y > view.height - margin - HEX_HEIGHT) pan.y -= y - (view.height - margin - HEX_HEIGHT);

    clampPan();
    applyPan();
  }

  /**
   * The markup for one hex. Kept apart from the loop so the loop stays a loop.
   */
  function hexMarkup(tile, marks) {
    const id = hex.key(tile.q, tile.r);
    const isPlayer = tile.q === state.player.q && tile.r === state.player.r;
    const isReachable = marks.reachable.has(id);
    const classes = ["wp-hex", "wp-hex--" + tile.type];

    if (!tile.revealed) classes.push("wp-hex--hidden");
    if (tile.hasTrail) classes.push("wp-hex--trail");
    if (tile.visited) classes.push("wp-hex--visited");
    if (tile.marker) classes.push("wp-hex--marker");
    if (isReachable) classes.push("wp-hex--reachable");
    if (marks.forcedKey === id) classes.push("wp-hex--forced");
    if (marks.hunterKey === id) classes.push("wp-hex--chaser");
    if (isPlayer) classes.push("wp-hex--player");

    // Ground nobody has seen shows nothing at all — not its terrain, not its
    // cost, and not what is standing on it (WP-28).
    let inner = "";
    if (tile.revealed) {
      // Player first, then the hunter, then whatever the ground holds.
      const glyph = isPlayer ? "marker.player" : marks.hunterKey === id ? "marker.chaser" : assetKeyFor(tile);

      inner =
        '<span class="wp-hex__glyph">' +
        assets.render(glyph, { title: false }) +
        "</span>" +
        (isReachable ? '<span class="wp-hex__cost">' + config.movementCost(tile, state.player) + "</span>" : "");
    }

    return (
      '<div class="' +
      classes.join(" ") +
      '" style="left:' +
      (tile.col * HEX_WIDTH + (tile.row % 2 ? HEX_WIDTH / 2 : 0)) +
      "px;top:" +
      tile.row * ROW_STEP +
      'px" data-q="' +
      tile.q +
      '" data-r="' +
      tile.r +
      '">' +
      inner +
      "</div>"
    );
  }

  /**
   * Draw the map as one string rather than four thousand elements.
   *
   * The board is redrawn after every action, and the largest map is 64 by 64.
   * Building each hex with `createElement` and its own `innerHTML` meant 4096
   * element creations and 4096 parses per click; one assignment is a single
   * parse. It matters only at the big sizes, and at the big sizes it matters a
   * lot.
   */
  /**
   * The slice of the map the window is looking at, in tile terms.
   *
   * The largest map is 128 by 128, which is 16384 hexes, and the window shows
   * perhaps a hundred of them. Drawing the rest costs a megabyte of markup per
   * click and buys nothing. The margin keeps a ring of hexes ready just outside
   * the frame so a drag never shows bare background.
   */
  function visibleBounds() {
    const view = els.wpViewport.getBoundingClientRect();
    const margin = HEX_WIDTH * 3;

    return {
      left: -pan.x - margin,
      right: -pan.x + view.width + margin,
      top: -pan.y - margin,
      bottom: -pan.y + view.height + margin,
    };
  }

  function renderMap() {
    const map = state.map;
    const bounds = visibleBounds();
    const forced = game.forcedMarchTarget(state);
    const marks = {
      reachable: new Set(
        game
          .affordableNeighbours(state)
          .filter((tile) => tile.revealed)
          .map((tile) => hex.key(tile.q, tile.r)),
      ),
      forcedKey: forced ? hex.key(forced.q, forced.r) : null,
      hunterKey: game.chaserVisible(state) ? hex.key(state.chaser.q, state.chaser.r) : null,
    };

    els.wpMap.style.width = map.width * HEX_WIDTH + HEX_WIDTH / 2 + "px";
    els.wpMap.style.height = (map.height - 1) * ROW_STEP + HEX_HEIGHT + "px";

    const drawn = [];
    for (const tile of map.tiles) {
      const spot = hexPixel(tile);
      if (spot.x + HEX_WIDTH < bounds.left || spot.x > bounds.right) continue;
      if (spot.y + HEX_HEIGHT < bounds.top || spot.y > bounds.bottom) continue;
      drawn.push(hexMarkup(tile, marks));
    }

    els.wpMap.innerHTML = drawn.join("");
    setTransform();
  }

  function describeTile(tile) {
    if (!tile || !tile.revealed) return strings.t("hud.hexInfo");

    const features = [];
    if (tile.hasTrail) features.push(strings.t("terrain.trail"));
    if (tile.hasFord) features.push(strings.t("terrain.ford"));
    if (tile.hasCabin) features.push(strings.t("terrain.cabin"));
    if (tile.hasWaterSource) features.push(strings.t("terrain.waterSource"));
    if (tile.hasFoodSource) features.push(strings.t("terrain.foodSource"));
    if (tile.marker && !tile.markerInspected) features.push(strings.t("hud.marker"));

    return (
      strings.t("hud.terrain") +
      ": " +
      strings.t("terrain." + tile.type) +
      " · " +
      strings.t("hud.cost") +
      ": " +
      config.movementCost(tile, state.player) +
      " · " +
      strings.t("hud.features") +
      ": " +
      (features.length ? features.join(", ") : strings.t("hud.none"))
    );
  }

  // ── panels ─────────────────────────────────────────────────────────────────

  /**
   * What a wound costs you, in words (PRD 8.16).
   *
   * Read off the same table the rules read, so a wound that gains an effect
   * cannot quietly stop explaining itself.
   */
  function conditionEffectText(id) {
    const rules = config.CONDITIONS[id] || {};
    const parts = [];

    if (rules.movement) parts.push(strings.t("condition.effect.movement"));
    if (rules.roughSurcharge) parts.push(strings.t("condition.effect.rough"));
    if (rules.vision) parts.push(strings.t("condition.effect.vision"));
    if (rules.forcedMarchHealth) parts.push(strings.t("condition.effect.forcedMarch"));

    return parts.join(", ");
  }

  function renderStats() {
    const player = state.player;

    els.wpDay.textContent = String(state.day);
    els.wpMove.textContent = String(state.movementLeft);
    els.wpSeed.textContent = String(state.seed);
    els.wpHealth.textContent = String(player.health);
    els.wpWater.textContent = String(player.water);
    els.wpFood.textContent = String(player.food);
    els.wpFatigue.textContent = String(player.fatigue);
    els.wpOrientation.textContent = String(player.orientation);

    // The one warning worth shouting about: water is what kills first.
    els.wpWater.parentElement.classList.toggle("wp-stat--danger", player.water <= 1);
    els.wpHealth.parentElement.classList.toggle("wp-stat--danger", player.health <= 3);

    els.wpForce.hidden = !game.forcedMarchTarget(state);
    els.wpEndDay.disabled = state.gameOver;

    // Searching costs movement and each tile gives up its water once (WP-19).
    const tile = game.currentTile(state);
    const tooLate = state.gameOver || state.movementLeft < config.SEARCH.cost;
    els.wpSearchWater.disabled = tooLate || !tile || tile.searchedWater;
    els.wpSearchFood.disabled = tooLate || !tile || tile.searchedFood;
    // The context action only exists while there is something to look at, and it
    // says what that something is rather than "interact".
    const lookAt = game.investigateTarget(state);
    els.wpInvestigate.hidden = !lookAt;
    if (lookAt) {
      els.wpInvestigate.innerHTML =
        assets.render("action.investigate", { title: false }) +
        "<span>" +
        assets.escapeHtml(strings.t("action.investigate." + lookAt)) +
        "</span>";
      els.wpInvestigate.disabled = state.gameOver || state.movementLeft < config.INVESTIGATE.cost;
    }

    els.wpCheckMap.disabled = state.gameOver || state.movementLeft < config.CHECK_MAP.cost;
    els.wpRest.disabled = state.gameOver;
    els.wpCamp.disabled = state.gameOver || !game.canMakeCamp(state);
    els.wpWeather.textContent = strings.t("weather." + state.weather + ".name");

    // Wounds and illnesses, with what is left of each clock (WP-60).
    els.wpConditions.innerHTML = state.player.conditions
      .map(
        (condition) =>
          '<li class="wp-condition' +
          (config.conditionChangesMovement(condition.id) ? " wp-condition--hobbling" : "") +
          '" title="' +
          assets.escapeHtml(conditionEffectText(condition.id)) +
          '"><span>' +
          assets.escapeHtml(strings.t("condition." + condition.id + ".name")) +
          '</span><span class="wp-condition__days">' +
          condition.days +
          "</span></li>",
      )
      .join("");

    // Two scenario-specific readouts, hidden when the scenario has no use for
    // them (WP-66, WP-68).
    const scenario = scenarios.getScenario(state.scenarioId);
    els.wpDeadline.hidden = !scenario.dayLimit;
    if (scenario.dayLimit) els.wpDaysLeft.textContent = String(Math.max(0, scenario.dayLimit - state.day + 1));

    const pursuit = game.chaserVisible(state) ? "sighted" : game.chaserProximity(state);
    els.wpPursuit.hidden = !pursuit;
    if (pursuit) els.wpPursuitState.textContent = strings.t("hud.pursuit." + pursuit);

    els.wpCarrying.hidden = !state.player.carryingNpc;
    els.wpScenarioName.textContent = strings.t(scenarios.getScenario(state.scenarioId).nameKey);
  }

  /**
   * The registry has an icon for every event, and until now nothing drew any of
   * them: the journal was plain text and the icons existed only in the guide.
   * An event line carries its own mark now, which is also what makes the guide's
   * illustrations true.
   */
  function journalIcon(entry) {
    const match = /^event\.(\w+)\./.exec(entry.key || "");
    if (!match) return "";

    const event = events.get(match[1]);
    if (!event) return "";

    return '<span class="wp-journal__icon">' + assets.render("eventCategory." + event.category, { title: false }) + "</span>";
  }

  /** One line of the journal, styled by what sort of line it is (PRD 8.13). */
  function journalEntry(entry) {
    return (
      '<li class="wp-journal__entry wp-journal__entry--' +
      assets.escapeHtml(entry.kind || "system") +
      '"><span class="wp-journal__day">' +
      assets.escapeHtml(strings.t("hud.day") + " " + entry.day) +
      "</span>" +
      journalIcon(entry) +
      '<span class="wp-journal__text">' +
      assets.escapeHtml(entry.text) +
      "</span></li>"
    );
  }

  function renderJournal() {
    els.wpJournal.innerHTML = game.visibleLog(state).map(journalEntry).join("");
  }

  function render() {
    renderStats();
    renderMap();
    renderJournal();
    keepPlayerVisible();
    renderPendingChoice();
    if (state.gameOver) showEndScreen();
  }

  // ── dialogs ────────────────────────────────────────────────────────────────

  function askConfirm(title, body, onConfirm) {
    pendingConfirm = onConfirm;
    els.wpConfirmTitle.textContent = title;
    els.wpConfirmBody.textContent = body;
    els.wpConfirm.hidden = false;
    els.wpConfirmOk.focus();
  }

  function closeConfirm() {
    pendingConfirm = null;
    els.wpConfirm.hidden = true;
  }

  function showBanner(text) {
    els.wpBanner.textContent = text;
    els.wpBanner.hidden = !text;
  }

  /**
   * A map picture as markup (PRD 8.17).
   *
   * `chronicle.picture` decides what every cell is; this only paints it, which
   * is why the sampling and the route tracing are testable without a browser.
   */
  function pictureMarkup(drawing, modifier) {
    const cells = drawing.cells
      .map((cell) => {
        const classes = ["wp-picture__cell"];
        if (!cell.revealed) classes.push("wp-picture__cell--unseen");
        else classes.push("wp-picture__cell--" + (cell.terrain || "open"));
        if (cell.feature) classes.push("wp-picture__cell--" + cell.feature);
        if (cell.route) classes.push("wp-picture__cell--route");
        if (cell.start) classes.push("wp-picture__cell--start");
        if (cell.end) classes.push("wp-picture__cell--end");
        return '<span class="' + classes.join(" ") + '"></span>';
      })
      .join("");

    return (
      '<div class="wp-picture' +
      (modifier ? " wp-picture--" + modifier : "") +
      '" style="grid-template-columns: repeat(' +
      drawing.width +
      ', 1fr)">' +
      cells +
      "</div>"
    );
  }

  function momentsMarkup(moments) {
    return moments
      .map(
        (moment) =>
          '<li class="wp-moment wp-journal__entry--' +
          assets.escapeHtml(moment.kind || "event") +
          '"><span class="wp-moment__day">' +
          assets.escapeHtml(strings.t("hud.day") + " " + moment.day) +
          "</span>" +
          assets.escapeHtml(moment.text || strings.t(moment.key)) +
          "</li>",
      )
      .join("");
  }

  function achievementsMarkup(ids) {
    return ids
      .map(
        (id) =>
          '<li class="wp-mark"><strong>' +
          assets.escapeHtml(strings.t("achievement." + id + ".name")) +
          "</strong><span>" +
          assets.escapeHtml(strings.t("achievement." + id + ".description")) +
          "</span></li>",
      )
      .join("");
  }

  function showEndScreen() {
    const summary = game.summary(state);
    const rows = [
      ["end.days", summary.days],
      ["end.hexes", summary.hexesTravelled],
      ["end.forcedMarches", summary.forcedMarches],
      ["end.health", summary.health],
      ["end.water", summary.water],
      ["end.food", summary.food],
    ];

    els.wpEndTitle.textContent = strings.t(state.result === "won" ? "end.win.title" : "end.loss.title");
    els.wpEndStats.innerHTML = rows
      .map(
        ([key, value]) =>
          '<div class="wp-end__row"><span>' +
          assets.escapeHtml(strings.t(key)) +
          "</span><strong>" +
          assets.escapeHtml(String(value)) +
          "</strong></div>",
      )
      .join("");
    els.wpEndSeed.textContent = String(state.seed);
    els.wpEndRecorded.textContent = strings.t(recorded ? "end.recorded" : "end.notRecorded");
    els.wpEndCheated.hidden = !state.cheatsUsed;

    // The route, the story and the marks (PRD 8.17, 8.18). All three come out
    // of the run that just ended; none of them needed a rule change to exist.
    els.wpEndMap.innerHTML = pictureMarkup(chronicle.picture(state, { maxWidth: 40 }));

    const story = chronicle.moments(state);
    els.wpEndMoments.hidden = story.length === 0;
    els.wpEndMomentsList.innerHTML = momentsMarkup(story);

    const earned = achievements.evaluate(game.describeRun(state));
    els.wpEndAchievements.hidden = earned.length === 0;
    els.wpEndAchievementsList.innerHTML = achievementsMarkup(earned);
    els.wpCopyReport.textContent = strings.t("action.copyReport");

    // The whole journal, not the eight lines the side panel had room for (WP-55).
    let currentDay = null;
    els.wpEndJournal.innerHTML = state.log
      .map((entry) => {
        const heading =
          entry.day === currentDay ? "" : '<h4 class="wp-end__day">' + assets.escapeHtml(strings.t("hud.day") + " " + entry.day) + "</h4>";
        currentDay = entry.day;
        return (
          heading +
          '<p class="wp-end__line wp-journal__entry--' +
          assets.escapeHtml(entry.kind || "system") +
          '">' +
          assets.escapeHtml(entry.text) +
          "</p>"
        );
      })
      .join("");

    els.wpEnd.hidden = false;
  }

  // ── actions ────────────────────────────────────────────────────────────────

  function afterAction() {
    render();
    if (state.gameOver) void reportResult();
  }

  function attemptMove(q, r) {
    if (state.gameOver) return;

    const target = game.tileAt(state, q, r);
    if (!target || !hex.areNeighbors(state.player, target)) {
      game.moveTo(state, q, r);
      render();
      return;
    }

    const cost = config.movementCost(target, state.player);
    const total = config.movementPointsFor(state.player);

    // A move that eats more than half the day is easy to trigger by accident
    // while reading a hex, so it asks first (PRD 13).
    if (cost <= state.movementLeft && cost > total / 2) {
      askConfirm(
        strings.t("prompt.longMove.title"),
        strings.t("prompt.longMove.body", { terrain: game.terrainName(target), cost, total }),
        () => {
          game.moveTo(state, q, r);
          afterAction();
        },
      );
      return;
    }

    game.moveTo(state, q, r);
    afterAction();
  }

  function attemptForcedMarch() {
    const target = game.forcedMarchTarget(state);
    if (!target) return;

    askConfirm(
      strings.t("prompt.forcedMarch.title"),
      strings.t("prompt.forcedMarch.body", {
        terrain: game.terrainName(target),
        health: config.FORCED_MARCH.healthCost,
        fatigue: config.FORCED_MARCH.fatigueCost,
      }),
      () => {
        game.forcedMarch(state);
        afterAction();
      },
    );
  }

  function endDay() {
    game.endDay(state);
    afterAction();
    void saveRun();
  }

  function rest() {
    game.rest(state);
    afterAction();
  }

  function searchWater() {
    game.searchWater(state);
    afterAction();
  }

  function searchFood() {
    game.searchFood(state);
    afterAction();
  }

  function checkMap() {
    game.checkMap(state);
    afterAction();
  }

  function investigate() {
    game.investigate(state);
    afterAction();
  }

  function makeCamp() {
    game.makeCamp(state);
    afterAction();
  }

  /**
   * An event that asks a question (WP-57). The window has no way out other than
   * answering: closing it would be a free pass, so the cautious option is the
   * one that stands in for walking away, and it is on the buttons.
   */
  function renderPendingChoice() {
    if (!state.pendingChoice) {
      els.wpChoice.hidden = true;
      return;
    }

    // The event's own line is already the last thing in the journal, so the
    // window repeats it as its title rather than inventing a second wording.
    const last = state.log[state.log.length - 1];
    els.wpChoiceTitle.textContent = last ? last.text : "";
    els.wpChoiceBody.textContent = strings.t("prompt.choice.body");
    els.wpChoiceActions.innerHTML = state.pendingChoice.choices
      .map(
        (choice, index) =>
          '<button class="wp-btn' +
          (index === 0 ? " wp-btn--accent" : "") +
          '" type="button" data-choice="' +
          assets.escapeHtml(choice.id) +
          '">' +
          assets.escapeHtml(strings.t(choice.labelKey)) +
          "</button>",
      )
      .join("");
    els.wpChoice.hidden = false;
  }

  function moveInDirection(index) {
    const direction = hex.DIRECTIONS[index];
    if (!direction) return;
    attemptMove(state.player.q + direction.q, state.player.r + direction.r);
  }

  // ── scoreboard (PRD 8.11) ──────────────────────────────────────────────────

  function scoreboardRow(entry) {
    return (
      '<tr class="wp-scoreboard__row' +
      (entry.you ? " wp-scoreboard__row--you" : "") +
      '"><td>' +
      entry.rank +
      "</td><td>" +
      assets.escapeHtml(entry.name) +
      "</td><td>" +
      entry.wins +
      "</td><td>" +
      entry.losses +
      "</td></tr>"
    );
  }

  async function openScoreboard() {
    els.wpScoreboard.hidden = false;
    els.wpScoreboardBody.textContent = "…";

    const answer = await apiClient.getScoreboard();
    if (!answer.ok) {
      els.wpScoreboardBody.textContent = strings.t("scoreboard.unavailable");
      return;
    }

    const entries = (answer.data && answer.data.entries) || [];
    if (entries.length === 0) {
      els.wpScoreboardBody.innerHTML = '<p class="wp-history__empty">' + assets.escapeHtml(strings.t("scoreboard.empty")) + "</p>";
      return;
    }

    els.wpScoreboardBody.innerHTML =
      '<table class="wp-scoreboard__table"><thead><tr><th>' +
      assets.escapeHtml(strings.t("scoreboard.rank")) +
      "</th><th>" +
      assets.escapeHtml(strings.t("scoreboard.player")) +
      "</th><th>" +
      assets.escapeHtml(strings.t("scoreboard.wins")) +
      "</th><th>" +
      assets.escapeHtml(strings.t("scoreboard.losses")) +
      "</th></tr></thead><tbody>" +
      entries.map(scoreboardRow).join("") +
      "</tbody></table>";
  }

  // ── the record (PRD 8.18) ──────────────────────────────────────────────────

  function recordRow(row) {
    return (
      "<tr><td>" +
      assets.escapeHtml(strings.t("scenario." + row.scenarioId + ".name")) +
      "</td><td>" +
      assets.escapeHtml(strings.t("mapSize." + row.mapSize)) +
      "</td><td>" +
      row.attempts +
      "</td><td>" +
      row.wins +
      "</td><td>" +
      (row.bestDays === null ? "-" : row.bestDays) +
      "</td><td>" +
      row.longestSurvived +
      "</td></tr>"
    );
  }

  function recordsMarkup(rows) {
    if (!rows.length) return '<p class="wp-history__empty">' + assets.escapeHtml(strings.t("progress.records.empty")) + "</p>";

    const heads = ["scenario", "mapSize", "attempts", "wins", "best", "longest"]
      .map((key) => "<th>" + assets.escapeHtml(strings.t("progress.records." + key)) + "</th>")
      .join("");

    return (
      '<table class="wp-scoreboard__table"><thead><tr>' + heads + "</tr></thead><tbody>" + rows.map(recordRow).join("") + "</tbody></table>"
    );
  }

  function streakMarkup(streak) {
    if (!streak || streak.longest === 0) {
      return '<p class="wp-history__empty">' + assets.escapeHtml(strings.t("progress.streak.none")) + "</p>";
    }

    return (
      '<div class="wp-record__pair"><span>' +
      assets.escapeHtml(strings.t("progress.streak.current")) +
      "</span><strong>" +
      assets.escapeHtml(strings.t("progress.streak.days", { days: streak.current })) +
      '</strong></div><div class="wp-record__pair"><span>' +
      assets.escapeHtml(strings.t("progress.streak.longest")) +
      "</span><strong>" +
      assets.escapeHtml(strings.t("progress.streak.days", { days: streak.longest })) +
      '</strong></div><p class="wp-record__note">' +
      assets.escapeHtml(strings.t(streak.playedToday ? "progress.streak.today" : "progress.streak.notToday")) +
      "</p>"
    );
  }

  function marksMarkup(rows) {
    const earned = rows.filter((row) => row.earned).length;

    return (
      '<p class="wp-record__note">' +
      assets.escapeHtml(strings.t("progress.achievements.count", { earned, total: rows.length })) +
      '</p><ul class="wp-marks">' +
      rows
        .map(
          (row) =>
            '<li class="wp-mark' +
            (row.earned ? "" : " wp-mark--locked") +
            '"><strong>' +
            assets.escapeHtml(strings.t("achievement." + row.id + ".name")) +
            "</strong><span>" +
            assets.escapeHtml(strings.t("achievement." + row.id + ".description")) +
            "</span></li>",
        )
        .join("") +
      "</ul>"
    );
  }

  function progressMarkup(data) {
    return (
      '<section class="wp-record__section"><h3>' +
      assets.escapeHtml(strings.t("progress.records")) +
      "</h3>" +
      recordsMarkup(data.records || []) +
      '</section><section class="wp-record__section"><h3>' +
      assets.escapeHtml(strings.t("progress.streak")) +
      "</h3>" +
      streakMarkup(data.streak) +
      '</section><section class="wp-record__section"><h3>' +
      assets.escapeHtml(strings.t("progress.achievements")) +
      "</h3>" +
      marksMarkup(data.achievements || []) +
      "</section>"
    );
  }

  async function openProgress() {
    els.wpProgress.hidden = false;
    els.wpProgressBody.textContent = "\u2026";

    const answer = await apiClient.getProgress();
    if (!answer.ok || !answer.data) {
      els.wpProgressBody.textContent = strings.t("progress.unavailable");
      return;
    }

    progress = answer.data.progress;
    els.wpProgressBody.innerHTML = progressMarkup(progress);
    renderScenarioCards();
  }

  // ── history (WP-27, WP-49) ─────────────────────────────────────────────────

  // The rows the history modal is currently showing, so a details click has
  // something to draw without asking the backend twice.
  let historySessions = [];

  function formatDate(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }

  function historyRow(session) {
    return (
      '<div class="wp-history__row">' +
      '<span class="wp-history__date">' +
      assets.escapeHtml(formatDate(session.startedAt)) +
      "</span>" +
      '<span class="wp-history__status wp-history__status--' +
      assets.escapeHtml(session.status) +
      '">' +
      assets.escapeHtml(strings.t("history.status." + session.status)) +
      "</span>" +
      (session.cheatsUsed ? '<span class="wp-history__status wp-history__status--lost">!</span>' : "") +
      '<span class="wp-history__days">' +
      assets.escapeHtml(String((session.result && session.result.days) || "-")) +
      " " +
      assets.escapeHtml(strings.t("history.days")) +
      "</span>" +
      '<code class="wp-history__seed">' +
      assets.escapeHtml(String(session.seed)) +
      "</code>" +
      '<button class="wp-btn wp-btn--small" type="button" data-details="' +
      assets.escapeHtml(String(session.id)) +
      '">' +
      assets.escapeHtml(strings.t("action.details")) +
      "</button>" +
      '<button class="wp-btn wp-btn--small" type="button" data-seed="' +
      assets.escapeHtml(String(session.seed)) +
      '" data-difficulty="' +
      assets.escapeHtml(String(session.difficulty)) +
      '" data-scenario="' +
      assets.escapeHtml(String(session.scenarioId)) +
      '" data-mapsize="' +
      assets.escapeHtml(String(session.mapSize || config.DEFAULT_MAP_SIZE)) +
      '">' +
      assets.escapeHtml(strings.t("action.replay")) +
      "</button>" +
      '<div class="wp-history__details" data-details-for="' +
      assets.escapeHtml(String(session.id)) +
      '" hidden></div>' +
      "</div>"
    );
  }

  /**
   * Redraw a past expedition (PRD 8.17).
   *
   * The map is not in the record and never was (PRD 6.12): it is rebuilt from
   * the seed, which is exactly what the seed is for. Only the hexes on the
   * stored route are uncovered, so opening a past run does not hand the player
   * a map of a seed they might want to walk again.
   */
  function pastPicture(session) {
    const replay = game.createGame({
      seed: session.seed,
      scenarioId: session.scenarioId,
      difficulty: session.difficulty,
      mapSize: session.mapSize || config.DEFAULT_MAP_SIZE,
      events: false,
    });

    for (const tile of replay.map.tiles) {
      tile.revealed = false;
      tile.visited = false;
    }

    replay.route = Array.isArray(session.route) ? session.route : [];
    for (const step of chronicle.routeOf(replay)) {
      const tile = game.tileAt(replay, step.q, step.r);
      if (!tile) continue;
      tile.revealed = true;
      tile.visited = true;
    }

    return chronicle.picture(replay, { maxWidth: 32 });
  }

  /** Fill in one history row on demand. Rebuilding a big map is not free. */
  function showPastDetails(recordId, node) {
    // Named `recordId`, not `sessionId`: the module already has a `sessionId`
    // that means the run in progress, and these two are never the same thing.
    const session = historySessions.find((entry) => entry.id === recordId);
    if (!session) return;

    node.hidden = !node.hidden;
    if (node.hidden || node.dataset.drawn === "1") return;

    const story = (session.moments || []).map((moment) => ({ ...moment, text: strings.t(moment.key) }));
    const marks = (session.achievements || []).filter((id) => achievements.isKnown(id));

    node.innerHTML =
      (Array.isArray(session.route) && session.route.length
        ? pictureMarkup(pastPicture(session), "small")
        : '<p class="wp-history__empty">' + assets.escapeHtml(strings.t("history.noRoute")) + "</p>") +
      (story.length ? '<ul class="wp-moments">' + momentsMarkup(story) + "</ul>" : "") +
      (marks.length ? '<ul class="wp-marks">' + achievementsMarkup(marks) + "</ul>" : "");
    node.dataset.drawn = "1";
  }

  async function openHistory() {
    els.wpHistoryModal.hidden = false;
    els.wpHistoryList.textContent = "…";

    const answer = await apiClient.listSessions();
    if (!answer.ok) {
      els.wpHistoryList.textContent = strings.t("history.unavailable");
      return;
    }

    const sessions = (answer.data && answer.data.sessions) || [];
    historySessions = sessions;
    els.wpHistoryList.innerHTML = sessions.length
      ? sessions.map(historyRow).join("")
      : '<p class="wp-history__empty">' + assets.escapeHtml(strings.t("history.empty")) + "</p>";
  }

  // ── backend ────────────────────────────────────────────────────────────────

  /**
   * Park the run (WP-69). Once a day, at the point the day turns over: often
   * enough that nothing worth keeping is lost, rare enough not to talk to the
   * backend after every step.
   */
  async function saveRun() {
    if (!sessionId || !state || state.gameOver) return;
    await apiClient.saveSnapshot(sessionId, snapshot.capture(state));
  }

  /** Is there a run waiting to be picked up? Drives the menu button. */
  async function findResumable() {
    const answer = await apiClient.listSessions();
    if (!answer.ok) return null;

    const sessions = (answer.data && answer.data.sessions) || [];
    return sessions.find((session) => session.status === "in_progress" && session.hasSnapshot) || null;
  }

  async function resumeRun(id) {
    const answer = await apiClient.getSession(id);
    if (!answer.ok) return;

    const saved = answer.data && answer.data.session && answer.data.session.snapshot;
    const restored = snapshot.restore(saved);

    // A save this build cannot read is not an error the player should meet as a
    // broken screen: the menu is still there.
    if (!restored) return;

    sessionId = id;
    recorded = false;
    state = restored;
    els.wpMenu.hidden = true;
    els.wpEnd.hidden = true;
    showBanner("");
    render();
    centreOn(game.currentTile(state));
  }

  /** Close an unfinished run on the backend when the player walks away from it. */
  async function abandonRun() {
    if (!sessionId || recorded || !state) return;
    const answer = await apiClient.closeSession(sessionId, "abandoned", game.summary(state));
    recorded = !!answer.ok;
    sessionId = null;
  }

  async function reportResult() {
    if (!sessionId || recorded) return;

    const answer = await apiClient.closeSession(sessionId, state.result || "abandoned", game.summary(state), {
      moments: chronicle.momentKeys(state),
      route: state.route,
      achievements: achievements.evaluate(game.describeRun(state)),
    });
    recorded = !!answer.ok;
    if (!answer.ok) showBanner(strings.t("banner.notRecorded"));
    if (!els.wpEnd.hidden) showEndScreen();
  }

  /**
   * Start a run. The seed comes from the server so the expedition is replayable
   * from its record; when the backend is unreachable the game still starts, on a
   * clock-derived seed, and says that nothing will be written down (WP-45).
   */
  async function startGame(options) {
    const wanted = options || {};
    const difficulty = wanted.difficulty || els.wpDifficulty.value || config.DEFAULT_DIFFICULTY;
    const mapSize = wanted.mapSize || els.wpMapSize.value || config.DEFAULT_MAP_SIZE;
    const scenarioId = wanted.scenarioId || chosenScenario;

    els.wpEnd.hidden = true;
    els.wpHistoryModal.hidden = true;
    els.wpMenu.hidden = true;
    closeConfirm();
    showBanner("");
    sessionId = null;
    recorded = false;

    const answer = await apiClient.startSession({
      scenarioId,
      difficulty,
      mapSize,
      seed: wanted.seed,
      daily: wanted.daily === true,
    });
    let seed;

    if (answer.ok && answer.data && answer.data.session) {
      sessionId = answer.data.session.id;
      seed = answer.data.session.seed;
    } else {
      if (answer.unauthorized) return;

      // A refusal is not an outage. The backend answering "no" — a locked
      // scenario, a seed it will not take — has to send the player back to the
      // menu with the reason, not drop them into an unrecorded run (PRD 8.18).
      if (!answer.offline) {
        showMenu(answer.error || strings.t("progress.unlock.refused"));
        return;
      }

      // The clock, not the platform RNG: game code stays seed-driven (WP-16).
      seed = wanted.seed || Date.now() % 2147483646;
      showBanner(strings.t("banner.offline"));
    }

    const played = answer.ok && answer.data && answer.data.session ? answer.data.session : { scenarioId, difficulty, mapSize };

    chosenScenario = played.scenarioId;
    els.wpDifficulty.value = played.difficulty;
    els.wpMapSize.value = played.mapSize || config.DEFAULT_MAP_SIZE;
    state = game.createGame({
      seed,
      scenarioId: played.scenarioId,
      difficulty: played.difficulty,
      mapSize: played.mapSize,
    });
    render();
    centreOn(game.currentTile(state));
  }

  // ── wiring ─────────────────────────────────────────────────────────────────

  function bindEvents() {
    els.wpMap.addEventListener("click", (event) => {
      const node = event.target.closest(".wp-hex");
      if (!node) return;
      attemptMove(Number(node.dataset.q), Number(node.dataset.r));
    });

    els.wpMap.addEventListener("mouseover", (event) => {
      const node = event.target.closest(".wp-hex");
      if (!node) return;
      els.wpHexInfo.textContent = describeTile(game.tileAt(state, Number(node.dataset.q), Number(node.dataset.r)));
    });

    els.wpMap.addEventListener("mouseleave", () => {
      els.wpHexInfo.textContent = strings.t("hud.hexInfo");
    });

    // Right-drag moves the map. The left button stays free for walking, which
    // is the only reason a map this size is usable at all.
    els.wpViewport.addEventListener("contextmenu", (event) => event.preventDefault());

    els.wpViewport.addEventListener("mousedown", (event) => {
      if (event.button !== 2) return;
      dragging = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      els.wpViewport.classList.add("wp-viewport--panning");
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging || !state) return;
      pan.x = dragging.panX + (event.clientX - dragging.x);
      pan.y = dragging.panY + (event.clientY - dragging.y);
      clampPan();
      applyPan();
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = null;
      els.wpViewport.classList.remove("wp-viewport--panning");
    });

    els.wpEndDay.addEventListener("click", endDay);
    els.wpForce.addEventListener("click", attemptForcedMarch);
    els.wpRest.addEventListener("click", rest);
    els.wpCheckMap.addEventListener("click", checkMap);
    els.wpInvestigate.addEventListener("click", investigate);
    els.wpCamp.addEventListener("click", makeCamp);

    els.wpCheatActions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-cheat]");
      if (button) runCheat(button.dataset.cheat);
    });

    els.wpCheatDials.addEventListener("change", (event) => {
      const field = event.target.closest("[data-cheat]");
      if (field) runCheat(field.dataset.cheat, field.value);
    });

    els.wpCheatsFold.addEventListener("click", () => {
      const folded = !els.wpCheatsBody.hidden;
      els.wpCheatsBody.hidden = folded;
      els.wpCheatsFold.textContent = folded ? "+" : "\u2013";
      els.wpCheatsFold.setAttribute("aria-expanded", String(!folded));
    });

    els.wpChoiceActions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-choice]");
      if (!button) return;
      game.resolveChoice(state, button.dataset.choice);
      afterAction();
    });
    els.wpMenuBtn.addEventListener("click", returnToMenu);

    els.wpScenarios.addEventListener("click", (event) => {
      const card = event.target.closest("button[data-scenario]");
      if (card) selectScenario(card.dataset.scenario);
    });

    els.wpStart.addEventListener("click", () => void startGame());
    els.wpDaily.addEventListener("click", () => void startGame({ daily: true }));
    els.wpResume.addEventListener("click", () => {
      const id = els.wpResume.dataset.session;
      if (id) void resumeRun(id);
    });
    els.wpInstructionsBtn.addEventListener("click", () => {
      // Built on open rather than at start-up: it reads the game's own tables,
      // and the cheat console can change some of them mid-session.
      els.wpGuide.innerHTML = guide.render();
      els.wpInstructions.hidden = false;
    });
    els.wpInstructionsClose.addEventListener("click", () => {
      els.wpInstructions.hidden = true;
    });
    els.wpSearchWater.addEventListener("click", searchWater);
    els.wpSearchFood.addEventListener("click", searchFood);
    // Wrapped, not passed straight through: a listener is called with the
    // event, and showMenu's first parameter is the notice to print.
    els.wpEndClose.addEventListener("click", () => showMenu());

    els.wpHistory.addEventListener("click", () => void openHistory());
    els.wpProgressBtn.addEventListener("click", () => void openProgress());
    els.wpProgressClose.addEventListener("click", () => {
      els.wpProgress.hidden = true;
    });

    els.wpCopyReport.addEventListener("click", async () => {
      const text = chronicle.report(state, { achievements: achievements.evaluate(game.describeRun(state)) });
      try {
        await navigator.clipboard.writeText(text);
        els.wpCopyReport.textContent = strings.t("action.reportCopied");
      } catch (error) {
        // No clipboard, no lost report: it goes on screen to be selected by hand.
        els.wpEndMoments.hidden = false;
        els.wpEndMomentsList.innerHTML = '<li><pre class="wp-report">' + assets.escapeHtml(text) + "</pre></li>";
      }
    });
    els.wpScoreboardBtn.addEventListener("click", () => void openScoreboard());
    els.wpScoreboardClose.addEventListener("click", () => {
      els.wpScoreboard.hidden = true;
    });
    els.wpHistoryClose.addEventListener("click", () => {
      els.wpHistoryModal.hidden = true;
    });

    els.wpHistoryList.addEventListener("click", (event) => {
      const opener = event.target.closest("button[data-details]");
      if (!opener) return;

      const panel = els.wpHistoryList.querySelector('[data-details-for="' + opener.dataset.details + '"]');
      if (panel) showPastDetails(opener.dataset.details, panel);
    });

    // Replaying a seed starts the same map at the same difficulty (WP-49).
    els.wpHistoryList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-seed]");
      if (!button) return;
      void startGame({
        seed: Number(button.dataset.seed),
        difficulty: button.dataset.difficulty,
        scenarioId: button.dataset.scenario,
        mapSize: button.dataset.mapsize,
      });
    });

    els.wpConfirmOk.addEventListener("click", () => {
      const action = pendingConfirm;
      closeConfirm();
      if (action) action();
    });
    els.wpConfirmCancel.addEventListener("click", closeConfirm);

    els.wpCopySeed.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(state.seed));
        els.wpCopySeed.textContent = strings.t("action.seedCopied");
      } catch (error) {
        els.wpCopySeed.textContent = String(state.seed);
      }
    });

    document.addEventListener("keydown", (event) => {
      // The console is not part of the game, so it opens over anything —
      // including the menu — and typing into one of its fields never counts as
      // a keyboard command.
      if (event.key === "~" || event.key === "`") {
        toggleCheats();
        event.preventDefault();
        return;
      }
      if (event.target && event.target.closest && event.target.closest("#wpCheats")) return;

      if (!state || state.gameOver) return;
      if (!els.wpConfirm.hidden || !els.wpMenu.hidden || !els.wpInstructions.hidden) return;
      if (!els.wpChoice.hidden) return;

      const key = event.key.toLowerCase();

      if (event.key >= "1" && event.key <= "6") {
        moveInDirection(Number(event.key) - 1);
        event.preventDefault();
      } else if (event.code === "Space") {
        endDay();
        event.preventDefault();
      } else if (key === "r") {
        rest();
        event.preventDefault();
      } else if (key === "w") {
        searchWater();
        event.preventDefault();
      } else if (key === "f") {
        searchFood();
        event.preventDefault();
      } else if (key === "m") {
        checkMap();
        event.preventDefault();
      } else if (key === "e") {
        investigate();
        event.preventDefault();
      } else if (key === "c") {
        makeCamp();
        event.preventDefault();
      }
    });
  }

  function init() {
    if (!apiClient.requireSession()) return;

    cacheElements();
    paintStaticLabels();
    bindEvents();
    els.wpHexInfo.textContent = strings.t("hud.hexInfo");

    // A blocked CDN would otherwise leave a panel of blank squares (WP-34).
    if (!assets.iconFontAvailable(document)) document.body.classList.add("wp-no-icons");

    showMenu();
  }

  document.addEventListener("DOMContentLoaded", init);

  // Exposed for manual poking in the console; the page itself never uses it.
  // Exposed for poking from the console: firing a named event (WP-22) and
  // running the balance bot (WP-26) are both meant to be one line away.
  root.SurvivalUi = {
    getState: () => state,
    render,
    startGame,
    endDay,
    rest,
    searchWater,
    searchFood,
    triggerEvent(id) {
      const answer = game.triggerEvent(state, id);
      render();
      return answer;
    },
    runBalance: (games, options) => balanceBot.runBalance(games, options),
    showMenu,
    openScoreboard,
    toggleCheats,
    runCheat,
    saveRun,
    resumeRun,
    checkMap,
    investigate,
    makeCamp,
    centreOnPlayer: () => centreOn(game.currentTile(state)),
  };
})(typeof self !== "undefined" ? self : globalThis);
