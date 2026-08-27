/**
 * Rolnopol Survival — the day's events (PRD 9, WP-22 to WP-24, WP-56 to WP-59).
 *
 * An event never touches `player.water` itself. It gets an `effects` handle and
 * goes through `change()`, which clamps to the resource's range and is the only
 * reason a storm cannot push a canteen past full (PRD 6.5). That is a structural
 * guarantee, not a convention someone has to remember.
 *
 * Four things an event may declare beyond its effect:
 *   tone      "bad" or "good" — which pool the night's roll draws from
 *   category  weather | animals | personal | discovery | tracks (koncepcja 9.1)
 *   terrain   the ground it can happen on; absent means anywhere (WP-58)
 *   choices   two ways it can go, decided by the player rather than the dice
 *
 * Events are a registry so the console can fire any of them by name (WP-22) and
 * a test can add one without editing this file.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.events = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const EVENTS = {};
  const CATEGORIES = ["weather", "animals", "personal", "discovery", "tracks"];

  /**
   * @param {object} definition
   * @param {string} definition.id
   * @param {"good"|"bad"} definition.tone
   * @param {string} definition.category
   * @param {string[]} [definition.terrain]  restricts the event to this ground
   * @param {string} definition.logKey
   * @param {(effects: object) => void} [definition.apply]
   * @param {Array} [definition.choices]     each: { id, labelKey, cautious?, apply }
   */
  function register(definition) {
    EVENTS[definition.id] = definition;
    return definition.id;
  }

  // ── weather ────────────────────────────────────────────────────────────────

  register({
    id: "storm",
    tone: "bad",
    category: "weather",
    logKey: "event.storm.text",
    apply(effects) {
      effects.change("water", 1);
      effects.change("orientation", -2);
      effects.change("fatigue", 1);
    },
  });

  register({
    id: "fog",
    tone: "bad",
    category: "weather",
    logKey: "event.fog.text",
    apply(effects) {
      effects.change("orientation", -3);
    },
  });

  register({
    id: "coldSnap",
    tone: "bad",
    category: "weather",
    logKey: "event.coldSnap.text",
    apply(effects) {
      effects.change("fatigue", 2);
      effects.change("food", -1);
    },
  });

  register({
    id: "clearNight",
    tone: "good",
    category: "weather",
    logKey: "event.clearNight.text",
    apply(effects) {
      effects.change("orientation", 2);
    },
  });

  // ── animals ────────────────────────────────────────────────────────────────

  register({
    id: "bite",
    tone: "bad",
    category: "animals",
    logKey: "event.bite.text",
    apply(effects) {
      effects.change("health", -1);
      effects.addCondition("bitten");
      // Left untreated, a bite is the start of something worse (WP-59).
      effects.schedule("fever", 2, { requiresCondition: "bitten" });
    },
  });

  register({
    id: "wolves",
    tone: "bad",
    category: "animals",
    terrain: ["forest", "mountain"],
    logKey: "event.wolves.text",
    choices: [
      {
        id: "stand",
        labelKey: "event.wolves.stand",
        apply(effects) {
          if (effects.roll() < 0.4) {
            effects.change("health", -2);
            effects.addCondition("bitten");
            effects.log("event.wolves.standBad");
          } else {
            effects.change("fatigue", 1);
            effects.log("event.wolves.standGood");
          }
        },
      },
      {
        id: "retreat",
        labelKey: "event.wolves.retreat",
        cautious: true,
        apply(effects) {
          effects.change("fatigue", 2);
          effects.change("orientation", -2);
          effects.log("event.wolves.retreatDone");
        },
      },
    ],
  });

  register({
    id: "fish",
    tone: "good",
    category: "animals",
    terrain: ["river"],
    logKey: "event.fish.text",
    apply(effects) {
      effects.change("food", 3);
    },
  });

  register({
    id: "swarm",
    tone: "bad",
    category: "animals",
    terrain: ["swamp", "forest"],
    logKey: "event.swarm.text",
    apply(effects) {
      effects.change("fatigue", 2);
      effects.change("health", -1);
    },
  });

  // ── personal ───────────────────────────────────────────────────────────────

  register({
    id: "sprain",
    tone: "bad",
    category: "personal",
    logKey: "event.sprain.text",
    apply(effects) {
      effects.addCondition("sprain");
    },
  });

  register({
    id: "badWater",
    tone: "bad",
    category: "personal",
    logKey: "event.badWater.text",
    apply(effects) {
      effects.addCondition("dysentery");
    },
  });

  register({
    id: "secondWind",
    tone: "good",
    category: "personal",
    logKey: "event.secondWind.text",
    apply(effects) {
      effects.change("fatigue", -3);
    },
  });

  register({
    id: "resolve",
    tone: "good",
    category: "personal",
    logKey: "event.resolve.text",
    apply(effects) {
      effects.change("orientation", 1);
      effects.change("health", 1);
    },
  });

  // ── discoveries ────────────────────────────────────────────────────────────

  register({
    id: "berries",
    tone: "good",
    category: "discovery",
    logKey: "event.berries.text",
    choices: [
      {
        id: "eat",
        labelKey: "event.berries.eat",
        apply(effects) {
          effects.change("food", 3);
          if (effects.roll() < 0.25) {
            effects.change("health", -1);
            effects.addCondition("dysentery");
            effects.log("event.berries.bad");
          } else {
            effects.log("event.berries.good");
          }
        },
      },
      {
        id: "pocket",
        labelKey: "event.berries.pocket",
        cautious: true,
        apply(effects) {
          effects.change("food", 1);
          effects.log("event.berries.pocketed");
        },
      },
    ],
  });

  register({
    id: "shelter",
    tone: "good",
    category: "discovery",
    logKey: "event.shelter.text",
    apply(effects) {
      effects.change("fatigue", -2);
      effects.change("food", 2);
    },
  });

  register({
    id: "abandonedPack",
    tone: "good",
    category: "discovery",
    logKey: "event.abandonedPack.text",
    choices: [
      {
        id: "take",
        labelKey: "event.abandonedPack.take",
        apply(effects) {
          effects.change("food", 4);
          effects.change("water", 2);
          effects.change("fatigue", 1);
          effects.log("event.abandonedPack.taken");
        },
      },
      {
        id: "leave",
        labelKey: "event.abandonedPack.leave",
        cautious: true,
        apply(effects) {
          effects.change("orientation", 1);
          effects.log("event.abandonedPack.left");
        },
      },
    ],
  });

  register({
    id: "deadTraveller",
    tone: "bad",
    category: "discovery",
    logKey: "event.deadTraveller.text",
    choices: [
      {
        id: "search",
        labelKey: "event.deadTraveller.search",
        apply(effects) {
          effects.change("food", 2);
          if (effects.roll() < 0.35) {
            effects.addCondition("dysentery");
            effects.log("event.deadTraveller.searchBad");
          } else {
            effects.change("orientation", 2);
            effects.log("event.deadTraveller.searchGood");
          }
        },
      },
      {
        id: "walkOn",
        labelKey: "event.deadTraveller.walkOn",
        cautious: true,
        apply(effects) {
          effects.change("fatigue", 1);
          effects.log("event.deadTraveller.walkedOn");
        },
      },
    ],
  });

  // ── tracks and signals ─────────────────────────────────────────────────────

  register({
    id: "tracks",
    tone: "good",
    category: "tracks",
    logKey: "event.tracks.text",
    apply(effects) {
      effects.change("orientation", 1);
      const tile = effects.tile();
      if (tile) tile.hasTrail = true;
    },
  });

  register({
    id: "oldBlaze",
    tone: "good",
    category: "tracks",
    logKey: "event.oldBlaze.text",
    apply(effects) {
      effects.change("orientation", 2);
    },
  });

  register({
    id: "smoke",
    tone: "good",
    category: "tracks",
    logKey: "event.smoke.text",
    choices: [
      {
        id: "follow",
        labelKey: "event.smoke.follow",
        apply(effects) {
          effects.change("fatigue", 2);
          if (effects.roll() < 0.5) {
            effects.change("food", 3);
            effects.change("orientation", 2);
            effects.log("event.smoke.followGood");
          } else {
            effects.change("orientation", -2);
            effects.log("event.smoke.followBad");
          }
        },
      },
      {
        id: "hold",
        labelKey: "event.smoke.hold",
        cautious: true,
        apply(effects) {
          effects.log("event.smoke.held");
        },
      },
    ],
  });

  register({
    id: "lostHours",
    tone: "bad",
    category: "tracks",
    logKey: "event.lostHours.text",
    apply(effects) {
      effects.change("orientation", -2);
      effects.change("fatigue", 1);
    },
  });

  // ── the dry flats (WP-65) ──────────────────────────────────────────────────
  // Desert is only worth putting on the map if it has something to say.

  register({
    id: "mirage",
    tone: "bad",
    category: "personal",
    terrain: ["desert"],
    logKey: "event.mirage.text",
    apply(effects) {
      effects.change("orientation", -2);
      effects.change("fatigue", 1);
    },
  });

  register({
    id: "dustStorm",
    tone: "bad",
    category: "weather",
    terrain: ["desert"],
    logKey: "event.dustStorm.text",
    apply(effects) {
      effects.change("orientation", -3);
      effects.change("water", -1);
    },
  });

  register({
    id: "dryWash",
    tone: "good",
    category: "discovery",
    terrain: ["desert"],
    logKey: "event.dryWash.text",
    apply(effects) {
      effects.change("water", 3);
    },
  });

  // ── scheduled follow-ups (never drawn by the nightly roll) ─────────────────

  register({
    id: "fever",
    tone: "bad",
    category: "personal",
    scheduledOnly: true,
    logKey: "event.fever.text",
    apply(effects) {
      effects.addCondition("fever");
    },
  });

  function get(id) {
    return EVENTS[id] || null;
  }

  /**
   * The pool a nightly roll may draw from.
   * Follow-ups are excluded, and terrain-bound events only appear on their own
   * ground (WP-58).
   */
  function list(tone, terrain) {
    return Object.keys(EVENTS)
      .map((id) => EVENTS[id])
      .filter((event) => !event.scheduledOnly)
      .filter((event) => (tone ? event.tone === tone : true))
      .filter((event) => (terrain && event.terrain ? event.terrain.includes(terrain) : true));
  }

  function byCategory(category) {
    return Object.keys(EVENTS)
      .map((id) => EVENTS[id])
      .filter((event) => event.category === category);
  }

  return { EVENTS, CATEGORIES, register, get, list, byCategory };
});
