import { describe, it, expect } from "vitest";
const path = require("path");

// A freshly booted agri-academy ecosystem is meant to be takeable end to end: the
// authoring service seeds published exams + owning units, and the question bank
// seeds a matching pool for each exam. Nothing asserts the two independently-owned
// seeds actually agree — a renamed pool, an exam pointing at a missing unit, an
// invalid cert template, or a pool too small to satisfy an exam's questionCount
// would only surface as a runtime failure in the live ecosystem. This locks the
// cross-seed contract.
const ROOT = path.join(__dirname, "..", "..", "external-services", "agri-academy");

const authoringSeed = require(path.join(ROOT, "authoring-service", "server", "seed.js")).buildSeed();
const questionBankSeed = require(path.join(ROOT, "question-bank-service", "server", "seed.js")).buildSeed();
const { isValidTemplate } = require(path.join(ROOT, "shared", "cert-templates.js"));
const { ICON_KEYS, sanitizeBranding } = require(path.join(ROOT, "authoring-service", "unit-presets.js"));

const exams = Object.values(authoringSeed.exams);
const units = authoringSeed.units;

describe("agri-academy seed consistency — exam ⇄ pool alignment", () => {
  it("every seeded published exam has a question-bank pool and vice versa", () => {
    const examIds = Object.keys(authoringSeed.exams).sort();
    const poolIds = Object.keys(questionBankSeed.pools).sort();
    expect(poolIds).toEqual(examIds);
  });

  it("each exam's pool holds at least its questionCount questions (drawable)", () => {
    for (const exam of exams) {
      const pool = questionBankSeed.pools[exam.id] || [];
      expect(pool.length, `pool ${exam.id} too small for questionCount ${exam.questionCount}`).toBeGreaterThanOrEqual(exam.questionCount);
    }
  });
});

describe("agri-academy seed consistency — exam metadata", () => {
  it("every exam is owned by a seeded unit", () => {
    for (const exam of exams) {
      expect(units[exam.ownerUnitId], `exam ${exam.id} owner ${exam.ownerUnitId} is not a seeded unit`).toBeTruthy();
    }
  });

  it("every exam uses a valid certificate template", () => {
    for (const exam of exams) {
      expect(isValidTemplate(exam.certTemplate), `exam ${exam.id} has invalid template ${exam.certTemplate}`).toBe(true);
    }
  });

  it("pricing is coherent: free ⇒ 0, paid ⇒ positive price", () => {
    for (const exam of exams) {
      const { mode, priceRol } = exam.pricing;
      expect(["free", "paid"], `exam ${exam.id} unknown pricing mode ${mode}`).toContain(mode);
      if (mode === "free") {
        expect(priceRol, `free exam ${exam.id} must be 0 ROL`).toBe(0);
      } else {
        expect(priceRol, `paid exam ${exam.id} must cost > 0`).toBeGreaterThan(0);
      }
    }
  });

  it("numeric exam fields are within sane bounds", () => {
    for (const exam of exams) {
      expect(exam.questionCount, `exam ${exam.id} questionCount`).toBeGreaterThan(0);
      expect(exam.durationSec, `exam ${exam.id} durationSec`).toBeGreaterThan(0);
      expect(exam.accessWindowDays, `exam ${exam.id} accessWindowDays`).toBeGreaterThan(0);
      expect(exam.attemptsAllowed, `exam ${exam.id} attemptsAllowed`).toBeGreaterThan(0);
      expect(exam.passPct, `exam ${exam.id} passPct low`).toBeGreaterThanOrEqual(0);
      expect(exam.passPct, `exam ${exam.id} passPct high`).toBeLessThanOrEqual(100);
      expect(exam.status, `exam ${exam.id} should be published`).toBe("published");
    }
  });
});

describe("agri-academy seed consistency — units", () => {
  it("seeds the built-in demo unit as active", () => {
    expect(units["unit-demo"]).toBeTruthy();
    expect(units["unit-demo"].status).toBe("active");
  });

  it("every unit's branding satisfies the shared branding rules", () => {
    for (const unit of Object.values(units)) {
      expect(ICON_KEYS, `unit ${unit.unitId} icon ${unit.icon} not predefined`).toContain(unit.icon);
      const result = sanitizeBranding({ tags: unit.tags, color: unit.color, icon: unit.icon });
      expect(result.error, `unit ${unit.unitId} branding rejected: ${result.error}`).toBeUndefined();
      expect(result.value.color).toBe(unit.color.toLowerCase());
      expect(result.value.icon).toBe(unit.icon);
    }
  });

  it("every unit has an owner and a payout target", () => {
    for (const unit of Object.values(units)) {
      expect(unit.ownerUserId, `unit ${unit.unitId} missing owner`).toBeTruthy();
      expect(unit.payoutUserId, `unit ${unit.unitId} missing payout target`).toBeTruthy();
    }
  });
});
