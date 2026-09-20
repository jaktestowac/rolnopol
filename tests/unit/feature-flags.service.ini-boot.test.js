import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The boot step wired into api/index.js: report what is wrong with
// feature-flags.ini, seed the store from it, and describe the overrides.
//
// The contract that matters most is the last one — this must NEVER throw. It runs
// inside initializeAllDatabases() before the ready flag flips, so an exception
// escaping here would leave every request answering 503.
const featureFlagsService = require("../../services/feature-flags.service");
const featureFlagIni = require("../../services/feature-flag-ini.service");

const { PREDEFINED_FEATURE_FLAGS } = featureFlagsService;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rolnopol-ini-boot-"));
const MISSING_INI = path.join(tmpDir, "no-such-file.ini");
let fileCounter = 0;

const clone = (value) => JSON.parse(JSON.stringify(value));

function fakeDb(initialFlags) {
  let data = { flags: clone(initialFlags), updatedAt: "2026-01-01T00:00:00.000Z" };
  return {
    getAll: async () => clone(data),
    replaceAll: async (next) => {
      data = clone(next);
      return clone(data);
    },
    update: async (updateFn) => {
      data = clone(updateFn(clone(data)));
      return clone(data);
    },
    peek: () => clone(data),
  };
}

function useIni(content) {
  fileCounter += 1;
  const filePath = path.join(tmpDir, `flags-${fileCounter}.ini`);
  fs.writeFileSync(filePath, content, "utf8");
  return featureFlagIni.load({ filePath, allowInTests: true });
}

/** Collects the injected log output so the boot messages can be asserted. */
function makeLoggers() {
  const warnings = [];
  const debugs = [];
  return {
    logWarning: (message, meta) => warnings.push({ message, meta }),
    logDebug: (message, meta) => debugs.push({ message, meta }),
    warnings,
    debugs,
    warningText: () => warnings.map((entry) => entry.message).join("\n"),
  };
}

let originalDb;
let loggers;

beforeEach(() => {
  originalDb = featureFlagsService.db;
  featureFlagsService.db = fakeDb({ ...PREDEFINED_FEATURE_FLAGS, crewOfficeEnabled: false });
  loggers = makeLoggers();
});

afterEach(() => {
  featureFlagsService.db = originalDb;
  featureFlagIni.load({ filePath: MISSING_INI, allowInTests: false });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyIniOverridesAtBoot: an active file", () => {
  it("seeds the store and reports what it overrode", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const result = await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(result.applied).toBe(true);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
    expect(loggers.warningText()).toContain("active (mode: enforce)");
    expect(loggers.warningText()).toContain("1 flag(s) overridden: crewOfficeEnabled");
  });

  it("logs each value it changed, naming a previously unset flag", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\nbrandNewFlagEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warningText()).toContain("crewOfficeEnabled: false -> true");
    expect(loggers.warningText()).toContain("brandNewFlagEnabled: (unset) -> true");
  });

  it("says the flags are pinned in enforce mode", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warningText()).toContain("these flags are pinned");
  });

  it("does not claim anything is pinned in seed mode", async () => {
    useIni("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warningText()).toContain("active (mode: seed)");
    expect(loggers.warningText()).not.toContain("pinned");
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
  });

  it("logs no value changes when the store already agrees with the file", async () => {
    featureFlagsService.db = fakeDb({ ...PREDEFINED_FEATURE_FLAGS, crewOfficeEnabled: true });
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warningText()).toContain("1 flag(s) overridden");
    expect(loggers.warningText()).not.toContain("->");
  });
});

describe("applyIniOverridesAtBoot: an inactive file stays quiet", () => {
  it("logs only a debug line when the file is missing", async () => {
    const result = await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(result.applied).toBe(false);
    expect(loggers.warnings).toEqual([]);
    expect(loggers.debugs).toHaveLength(1);
    expect(loggers.debugs[0].meta).toMatchObject({ exists: false, skippedReason: "file-not-found" });
  });

  it("logs only a debug line when the file is skipped because NODE_ENV=test", async () => {
    fileCounter += 1;
    const filePath = path.join(tmpDir, `skipped-${fileCounter}.ini`);
    fs.writeFileSync(filePath, "[flags]\ncrewOfficeEnabled = true\n", "utf8");
    featureFlagIni.load({ filePath, allowInTests: false });

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warnings).toEqual([]);
    expect(loggers.debugs[0].meta).toMatchObject({ exists: true, skippedReason: "test-environment" });
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
  });

  it("does not seed the store in off mode", async () => {
    useIni("[settings]\nmode = off\n[flags]\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
    expect(loggers.debugs[0].meta).toMatchObject({ mode: "off", skippedReason: "mode-off" });
  });
});

describe("applyIniOverridesAtBoot: an invalid file warns and boots", () => {
  it("leads with a summary that says the app is starting normally", async () => {
    useIni("[flags]\nbroken line\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warnings[0].message).toContain("1 problem(s) found");
    expect(loggers.warnings[0].message).toContain("the app is starting normally");
  });

  it("logs one line per problem", async () => {
    useIni("[flags]\nbroken line\nanother broken line\ncrewOfficeEnabled = maybe\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warnings[0].message).toContain("3 problem(s) found");
    expect(loggers.warningText()).toContain("Line 2");
    expect(loggers.warningText()).toContain("Line 3");
    expect(loggers.warningText()).toContain('Ignored "crewOfficeEnabled = maybe"');
  });

  it("still seeds the valid half of a partly broken file", async () => {
    useIni("[flags]\nbroken line\ncrewOfficeEnabled = true\n");

    const result = await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(result.applied).toBe(true);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
  });

  it("warns and applies nothing when the file is entirely unusable", async () => {
    useIni("[[[\nbroken\ncrewOfficeEnabled = maybe\n");

    const result = await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(result.applied).toBe(false);
    expect(loggers.warnings.length).toBeGreaterThan(0);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
  });

  it("logs no problem summary for a clean file", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(loggers.warningText()).not.toContain("problem(s) found");
  });
});

describe("applyIniOverridesAtBoot: it can never break the boot", () => {
  it("swallows a failure while seeding the store", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");
    const seedSpy = vi.spyOn(featureFlagsService, "seedStoreFromIni").mockRejectedValue(new Error("disk on fire"));

    const result = await featureFlagsService.applyIniOverridesAtBoot(loggers);

    expect(result.applied).toBe(false);
    expect(loggers.warningText()).toContain("could not be applied, continuing with the stored feature flags");
    expect(loggers.warnings.at(-1).meta).toMatchObject({ error: "disk on fire" });

    seedSpy.mockRestore();
  });

  it("swallows a failure while building the report", async () => {
    const reportSpy = vi.spyOn(featureFlagsService, "getIniOverrideReport").mockImplementation(() => {
      throw new Error("report exploded");
    });

    await expect(featureFlagsService.applyIniOverridesAtBoot(loggers)).resolves.toMatchObject({ applied: false });
    expect(loggers.warningText()).toContain("could not be applied");

    reportSpy.mockRestore();
  });

  it("survives a thrown non-Error value", async () => {
    const reportSpy = vi.spyOn(featureFlagsService, "getIniOverrideReport").mockImplementation(() => {
      throw "just a string";
    });

    await featureFlagsService.applyIniOverridesAtBoot(loggers);
    expect(loggers.warnings.at(-1).meta).toMatchObject({ error: "just a string" });

    reportSpy.mockRestore();
  });

  it("works when no loggers are supplied at all", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.applyIniOverridesAtBoot()).resolves.toMatchObject({ applied: true });
    await expect(featureFlagsService.applyIniOverridesAtBoot({})).resolves.toMatchObject({ applied: true });
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
  });

  it("works when the loggers are not functions", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.applyIniOverridesAtBoot({ logWarning: "not a function", logDebug: 42 })).resolves.toMatchObject({
      applied: true,
    });
  });
});
