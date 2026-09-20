/**
 * Rolnopol Survival — what a player has to show for it (PRD 8.18, faza D).
 *
 * A single-player game with no ranking has one honest source of replay value:
 * the player's own record. These are the marks against it.
 *
 * Three rules hold this list together.
 *
 * 1. Every test reads the flat description a finished run produces
 *    (`game.describeRun`) and nothing else. No achievement may reach into the
 *    live state, so none of them can change the run that earns it.
 *
 * 2. Every test is over facts the game already tracks. Inventing a counter to
 *    justify an achievement is how a list like this turns into busywork; where
 *    a counter was genuinely missing (trail hexes, camps, cabins, wounds) it
 *    was added to `state.stats` first and used by the game itself.
 *
 * 3. A run that used the cheat console earns nothing. Same reasoning as the
 *    scoreboard (PRD 6.24): the server takes results on trust, and the cheat
 *    mark is what keeps trust and bookkeeping apart.
 *
 * The server shares this file, so the ids it will accept and the ids the
 * browser can award are the same list by construction.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Survival = root.Survival || {};
    root.Survival.achievements = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Map sizes that count as a long haul, by the order they appear in the menu.
  const BIG_MAPS = ["large", "vast", "immense", "colossal", "endless"];

  const ACHIEVEMENTS = [
    {
      id: "firstExpedition",
      nameKey: "achievement.firstExpedition.name",
      descriptionKey: "achievement.firstExpedition.description",
      test: (run) => run.finished,
    },
    {
      id: "wayOut",
      nameKey: "achievement.wayOut.name",
      descriptionKey: "achievement.wayOut.description",
      test: (run) => run.won,
    },
    {
      id: "tenDays",
      nameKey: "achievement.tenDays.name",
      descriptionKey: "achievement.tenDays.description",
      test: (run) => run.finished && run.days >= 10,
    },
    {
      id: "swift",
      nameKey: "achievement.swift.name",
      descriptionKey: "achievement.swift.description",
      test: (run) => run.won && run.days <= 5,
    },
    {
      id: "parched",
      nameKey: "achievement.parched.name",
      descriptionKey: "achievement.parched.description",
      test: (run) => run.won && run.water === 0,
    },
    {
      id: "unscathed",
      nameKey: "achievement.unscathed.name",
      descriptionKey: "achievement.unscathed.description",
      test: (run) => run.won && run.health === 10 && run.forcedMarches === 0,
    },
    {
      // A third of the way home on a road is a route that was planned, not one
      // that happened (PRD 8.10).
      id: "roadWise",
      nameKey: "achievement.roadWise.name",
      descriptionKey: "achievement.roadWise.description",
      test: (run) => run.won && run.hexesTravelled >= 12 && run.trailHexes * 3 >= run.hexesTravelled,
    },
    {
      id: "walkItOff",
      nameKey: "achievement.walkItOff.name",
      descriptionKey: "achievement.walkItOff.description",
      test: (run) => run.won && run.woundsTaken >= 1 && run.cabinsUsed === 0,
    },
    {
      // Straight to the right sign, no false leads checked on the way.
      id: "straightToIt",
      nameKey: "achievement.straightToIt.name",
      descriptionKey: "achievement.straightToIt.description",
      test: (run) => run.won && (run.scenarioId === "search" || run.scenarioId === "rescue") && run.markersInspected === 1,
    },
    {
      id: "stretcherBearer",
      nameKey: "achievement.stretcherBearer.name",
      descriptionKey: "achievement.stretcherBearer.description",
      test: (run) => run.won && run.carriedSurvivor,
    },
    {
      id: "outran",
      nameKey: "achievement.outran.name",
      descriptionKey: "achievement.outran.description",
      test: (run) => run.won && run.scenarioId === "chase",
    },
    {
      id: "longHaul",
      nameKey: "achievement.longHaul.name",
      descriptionKey: "achievement.longHaul.description",
      test: (run) => run.won && BIG_MAPS.includes(run.mapSize),
    },
  ];

  const BY_ID = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

  function list() {
    return ACHIEVEMENTS.map((achievement) => ({
      id: achievement.id,
      nameKey: achievement.nameKey,
      descriptionKey: achievement.descriptionKey,
    }));
  }

  function ids() {
    return ACHIEVEMENTS.map((achievement) => achievement.id);
  }

  function isKnown(id) {
    return BY_ID.has(id);
  }

  /**
   * Which marks this run earned. Order follows the list above, so the end
   * screen reads the same way every time.
   */
  function evaluate(run) {
    if (!run || run.cheatsUsed) return [];
    return ACHIEVEMENTS.filter((achievement) => {
      try {
        return achievement.test(run) === true;
      } catch (error) {
        return false;
      }
    }).map((achievement) => achievement.id);
  }

  /** Keep the ids this build knows, drop repeats, keep the declared order. */
  function sanitize(candidates) {
    const wanted = new Set(Array.isArray(candidates) ? candidates : []);
    return ids().filter((id) => wanted.has(id));
  }

  return { ACHIEVEMENTS, BIG_MAPS, list, ids, isKnown, evaluate, sanitize };
});
