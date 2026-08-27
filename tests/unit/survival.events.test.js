/**
 * Rolnopol Survival — the nightly roll (PRD WP-22, WP-23, WP-24).
 */
import { describe, it, expect, afterEach } from "vitest";

const game = require("../../public/js/games/survival/game.js");
const events = require("../../public/js/games/survival/events.js");
const config = require("../../public/js/games/survival/config.js");
const strings = require("../../public/js/games/survival/strings.js");
const scenarios = require("../../public/js/games/survival/scenarios.js");
const handmade = require("../../public/js/games/survival/handmade-maps.js");

const SHIPPED = ["storm", "bite", "fog", "berries", "shelter", "tracks"];
const CHOICE_EVENTS = ["wolves", "berries", "abandonedPack", "deadTraveller", "smoke"];

handmade.DEFINITIONS["evt-plain"] = { id: "evt-plain", rows: [".....", ".....", ".....", ".....", "....."], start: { col: 2, row: 2 } };
scenarios.SCENARIOS["evt-plain"] = {
  ...scenarios.getScenario("lost"),
  id: "evt-plain",
  map: { source: "handmade", id: "evt-plain" },
};

function newGame(options) {
  return game.createGame({ seed: 1, scenarioId: "evt-plain", difficulty: "normal", ...(options || {}) });
}

afterEach(() => {
  delete events.EVENTS["test-flood"];
});

describe("survival events — WP-22 the six shipped events", () => {
  it("still ships the original six", () => {
    for (const id of SHIPPED) {
      expect(events.get(id), id + " is gone").toBeTruthy();
      expect(strings.has(events.get(id).logKey), id + " has no text").toBe(true);
    }
  });

  it("fills all five categories from the concept, three deep at least (WP-56)", () => {
    expect(Object.keys(events.EVENTS).length).toBeGreaterThanOrEqual(18);

    for (const category of events.CATEGORIES) {
      expect(events.byCategory(category).length, category + " is thin").toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every event a category, a tone and a written line", () => {
    for (const event of Object.keys(events.EVENTS).map((id) => events.EVENTS[id])) {
      expect(events.CATEGORIES, event.id + " has a category nobody declared").toContain(event.category);
      expect(["good", "bad"], event.id + " has no tone").toContain(event.tone);
      expect(strings.has(event.logKey), event.id + " has no text").toBe(true);
    }
  });

  it("fires any of them by name, the way the console does", () => {
    for (const id of SHIPPED) {
      const state = newGame();
      const answer = game.triggerEvent(state, id);

      expect(answer.ok, id).toBe(true);
      expect(state.stats.eventsSeen).toBe(1);
      expect(state.log[state.log.length - 1].text.length).toBeGreaterThan(10);
    }
  });

  it("does nothing for a name nobody registered", () => {
    const state = newGame();
    expect(game.triggerEvent(state, "meteor").ok).toBe(false);
    expect(state.stats.eventsSeen).toBe(0);
  });

  it("applies the effects the PRD describes", () => {
    const storm = newGame();
    storm.player.water = 4;
    game.triggerEvent(storm, "storm");
    expect(storm.player.water).toBe(5);
    expect(storm.player.orientation).toBe(config.START.orientation - 2);
    expect(storm.player.fatigue).toBe(1);

    const bite = newGame();
    game.triggerEvent(bite, "bite");
    expect(bite.player.health).toBe(config.START.health - 1);

    const fog = newGame();
    game.triggerEvent(fog, "fog");
    expect(fog.player.orientation).toBe(config.START.orientation - 3);

    const tracks = newGame();
    game.triggerEvent(tracks, "tracks");
    expect(game.currentTile(tracks).hasTrail).toBe(true);
  });

  it("splits the pool into trouble and luck, and leaves neither empty", () => {
    const bad = events.list("bad").map((event) => event.id);
    const good = events.list("good").map((event) => event.id);

    expect(bad).toContain("storm");
    expect(good).toContain("berries");
    expect(bad.length).toBeGreaterThanOrEqual(3);
    expect(good.length).toBeGreaterThanOrEqual(3);
    expect(bad.filter((id) => good.includes(id))).toEqual([]);
  });

  it("keeps follow-ups out of the nightly draw (WP-59)", () => {
    expect(events.get("fever").scheduledOnly).toBe(true);
    expect(events.list().map((event) => event.id)).not.toContain("fever");
  });

  it("keeps terrain-bound events on their own ground (WP-58)", () => {
    const inSwamp = events.list("bad", "swamp").map((event) => event.id);
    const onOpen = events.list("bad", "open").map((event) => event.id);

    expect(inSwamp).toContain("swarm");
    expect(onOpen).not.toContain("swarm");
    expect(events.list("bad", "mountain").map((event) => event.id)).toContain("wolves");
    expect(events.list("bad", "open").map((event) => event.id)).not.toContain("wolves");
  });
});

describe("survival events — WP-23 how likely trouble is", () => {
  it("rises with difficulty", () => {
    const easy = newGame({ difficulty: "easy" });
    const normal = newGame({ difficulty: "normal" });
    const hard = newGame({ difficulty: "hard" });

    expect(game.eventChance(easy)).toBeCloseTo(config.DIFFICULTIES.easy.eventChance);
    expect(game.eventChance(normal)).toBeCloseTo(config.DIFFICULTIES.normal.eventChance);
    expect(game.eventChance(hard)).toBeCloseTo(config.DIFFICULTIES.hard.eventChance);
    expect(game.eventChance(hard)).toBeGreaterThan(game.eventChance(easy));
  });

  it("rises again once the player has lost their bearings", () => {
    const state = newGame();
    const before = game.eventChance(state);

    state.player.orientation = 2;

    expect(game.eventChance(state)).toBeCloseTo(before + config.EVENTS.lowOrientationBonus);
  });

  it("fires at roughly the declared rate over a hundred nights", () => {
    let fired = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const state = game.createGame({ seed, scenarioId: "evt-plain", difficulty: "normal" });
      const before = state.stats.eventsSeen;
      game.maybeTriggerEvent(state);
      if (state.stats.eventsSeen > before) fired += 1;
    }

    const declared = config.DIFFICULTIES.normal.eventChance * 100;
    expect(fired).toBeGreaterThan(declared - 15);
    expect(fired).toBeLessThan(declared + 15);
  });

  it("stays out of the way when a run asks for no events", () => {
    const state = newGame({ events: false });
    for (let day = 0; day < 20; day += 1) game.maybeTriggerEvent(state);
    expect(state.stats.eventsSeen).toBe(0);
  });
});

describe("survival events — WP-24 nothing escapes the clamp", () => {
  it("stops a generous event at a full canteen", () => {
    events.register({
      id: "test-flood",
      tone: "good",
      logKey: "event.storm.text",
      apply(effects) {
        effects.change("water", 5);
      },
    });

    const state = newGame();
    state.player.water = 7;

    game.triggerEvent(state, "test-flood");

    expect(state.player.water).toBe(config.RESOURCES.water.max);
  });

  it("stops a cruel one at zero", () => {
    events.register({
      id: "test-flood",
      tone: "bad",
      logKey: "event.bite.text",
      apply(effects) {
        effects.change("health", -50);
      },
    });

    const state = newGame();
    game.triggerEvent(state, "test-flood");

    expect(state.player.health).toBe(config.RESOURCES.health.min);
  });

  it("hands events no other way to reach the player", () => {
    let seen = null;
    events.register({
      id: "test-flood",
      tone: "good",
      logKey: "event.storm.text",
      apply(effects) {
        seen = Object.keys(effects).sort();
      },
    });

    game.triggerEvent(newGame(), "test-flood");

    // The exact set matters: anything new here is a new way into the player.
    expect(seen).toEqual(["addCondition", "change", "hasCondition", "log", "roll", "schedule", "tile"]);
  });
});

describe("survival events — WP-57 events that ask a question", () => {
  it("ships at least four of them, each with two ways to go", () => {
    expect(CHOICE_EVENTS.length).toBeGreaterThanOrEqual(4);

    for (const id of CHOICE_EVENTS) {
      const event = events.get(id);
      expect(event.choices.length, id + " does not offer a choice").toBe(2);
      for (const choice of event.choices) {
        expect(strings.has(choice.labelKey), id + "/" + choice.id + " has no label").toBe(true);
      }
    }
  });

  it("waits instead of applying anything", () => {
    const state = newGame();
    const before = { ...state.player };

    const answer = game.triggerEvent(state, "abandonedPack");

    expect(answer.pending).toBe(true);
    expect(state.pendingChoice.eventId).toBe("abandonedPack");
    expect(state.player.food).toBe(before.food);
  });

  it("stops the player doing anything else until it is answered", () => {
    const state = newGame();
    game.triggerEvent(state, "abandonedPack");

    expect(game.rest(state).reason).toBe("choice-pending");
    expect(game.checkMap(state).reason).toBe("choice-pending");
    expect(game.moveTo(state, state.player.q + 1, state.player.r).reason).toBe("choice-pending");
  });

  it("applies what the player picked", () => {
    const state = newGame();
    state.player.food = 0;
    game.triggerEvent(state, "abandonedPack");

    game.resolveChoice(state, "take");

    expect(state.player.food).toBe(4);
    expect(state.pendingChoice).toBeNull();
  });

  it("treats walking away as the cautious option, never as a free pass", () => {
    const state = newGame();
    state.player.food = 0;
    game.triggerEvent(state, "abandonedPack");

    const answer = game.resolveChoice(state);

    expect(answer.choiceId).toBe("leave");
    expect(state.player.food).toBe(0);
    expect(state.pendingChoice).toBeNull();
  });

  it("survives a round trip through JSON, because it stores ids and not functions", () => {
    const state = newGame();
    game.triggerEvent(state, "wolves");

    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.pendingChoice.choices.map((choice) => choice.id)).toEqual(["stand", "retreat"]);

    game.resolveChoice(copy, "retreat");
    expect(copy.pendingChoice).toBeNull();
  });
});

describe("survival events — WP-59 one event lining up the next", () => {
  it("turns an untreated bite into a fever two days later", () => {
    const state = newGame({ events: false, weather: "clear" });
    game.triggerEvent(state, "bite");

    expect(game.hasCondition(state, "bitten")).toBe(true);
    expect(state.scheduled[0]).toMatchObject({ eventId: "fever", requiresCondition: "bitten" });

    game.endDay(state);
    expect(game.hasCondition(state, "fever")).toBe(false);
    game.endDay(state);

    expect(game.hasCondition(state, "fever")).toBe(true);
  });

  it("drops the follow-up when the cause has been treated", () => {
    const state = newGame({ events: false, weather: "clear" });
    game.triggerEvent(state, "bite");
    game.clearConditions(state);

    game.endDay(state);
    game.endDay(state);

    expect(game.hasCondition(state, "fever")).toBe(false);
    expect(state.scheduled).toHaveLength(0);
  });

  it("carries the plan through a round trip of the state", () => {
    const state = newGame({ events: false, weather: "clear" });
    game.triggerEvent(state, "bite");

    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.scheduled).toHaveLength(1);
  });
});

describe("survival events — the nightly roll stays reproducible", () => {
  it("replays the same events from the same seed", () => {
    function play() {
      const state = game.createGame({ seed: 31337, scenarioId: "evt-plain", difficulty: "hard" });
      for (let day = 0; day < 8 && !state.gameOver; day += 1) game.endDay(state);
      return state.log.map((entry) => entry.key).join("|");
    }

    expect(play()).toBe(play());
  });

  it("carries its place in the stream inside plain state", () => {
    const state = newGame();
    const copy = JSON.parse(JSON.stringify(state));

    expect(typeof copy.rngState).toBe("number");
    expect(game.roll(copy)).toBe(game.roll(state));
  });
});
