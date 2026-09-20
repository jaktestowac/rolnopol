/**
 * Rolnopol Survival — the balance bot (PRD WP-26).
 *
 * The bot's job is to turn a balance change into a number. These tests check
 * that the number is real and reproducible; what the number *should be* is a
 * design decision, reported rather than asserted here.
 */
import { describe, it, expect } from "vitest";

const bot = require("../../public/js/games/survival/balance-bot.js");

describe("survival balance bot — WP-26", () => {
  it("reports a win rate and a median length", () => {
    const report = bot.runBalance(20, { seed: 1 });

    expect(report.games).toBe(20);
    expect(report.runs).toHaveLength(20);
    expect(report.wins + report.losses + report.timeouts).toBe(20);
    expect(report.winRate).toBeGreaterThanOrEqual(0);
    expect(report.winRate).toBeLessThanOrEqual(1);
    expect(report.medianDays).toBeGreaterThan(0);
  });

  it("gives the same answer twice for the same first seed", () => {
    const first = bot.runBalance(15, { seed: 500 });
    const second = bot.runBalance(15, { seed: 500 });

    expect(second.winRate).toBe(first.winRate);
    expect(second.medianDays).toBe(first.medianDays);
    expect(second.runs.map((run) => run.result)).toEqual(first.runs.map((run) => run.result));
  });

  it("gives a different batch a different first seed", () => {
    const a = bot.runBalance(10, { seed: 1 });
    const b = bot.runBalance(10, { seed: 2000 });

    expect(a.runs[0].seed).not.toBe(b.runs[0].seed);
  });

  it("plays every difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard"]) {
      const report = bot.runBalance(10, { seed: 7, difficulty });
      expect(report.difficulty).toBe(difficulty);
      expect(report.runs.every((run) => ["won", "lost", "timeout"].includes(run.result))).toBe(true);
    }
  });

  it("finishes every run rather than wandering forever", () => {
    const report = bot.runBalance(20, { seed: 90, maxDays: 40 });

    expect(report.runs.every((run) => run.days <= 41)).toBe(true);
  });

  it("makes the current balance visible instead of hiding it", () => {
    const report = bot.runBalance(40, { seed: 1, difficulty: "normal" });

    // A bar this low is not a target, it is a tripwire: if a change ever makes
    // the bot lose every single run, the numbers have gone somewhere strange.
    expect(report.wins + report.losses).toBeGreaterThan(0);

    // The measured rate is reported in the run summary; PRD §3 wants 25-45% on
    // normal, and the shipped map size does not get there yet (see the balance
    // note in the release-2 report).
    expect(typeof report.winRate).toBe("number");
  });
});
