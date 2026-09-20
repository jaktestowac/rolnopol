import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The read-through override layer: feature-flags.ini outranks
// data/feature-flags.json on every read, and writes that would contradict it are
// refused. The JSON store is faked here so these assertions are about the
// precedence rules only, not about disk behaviour.
const featureFlagsService = require("../../services/feature-flags.service");
const featureFlagIni = require("../../services/feature-flag-ini.service");

const { PREDEFINED_FEATURE_FLAGS, PINNED_FLAG_ERROR_CODE } = featureFlagsService;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rolnopol-flags-ini-"));
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

/** Activate feature-flags.ini for this test, bypassing the NODE_ENV=test skip. */
function useIni(content) {
  fileCounter += 1;
  const filePath = path.join(tmpDir, `flags-${fileCounter}.ini`);
  fs.writeFileSync(filePath, content, "utf8");
  return featureFlagIni.load({ filePath, allowInTests: true });
}

let originalDb;

beforeEach(() => {
  originalDb = featureFlagsService.db;
  featureFlagsService.db = fakeDb({ ...PREDEFINED_FEATURE_FLAGS, crewOfficeEnabled: false, messengerEnabled: false });
});

afterEach(() => {
  featureFlagsService.db = originalDb;
  // Leave the singleton inert so no other suite inherits an active file.
  featureFlagIni.load({ filePath: MISSING_INI, allowInTests: false });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getFeatureFlags with an enforcing feature-flags.ini", () => {
  it("returns the file value, not the stored value", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.crewOfficeEnabled).toBe(true);
    expect(data.storedFlags.crewOfficeEnabled).toBe(false);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
  });

  it("leaves flags the file does not mention alone", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.messengerEnabled).toBe(false);
    expect(data.flags.alertsEnabled).toBe(PREDEFINED_FEATURE_FLAGS.alertsEnabled);
  });

  it("can force a flag off as well as on", async () => {
    featureFlagsService.db = fakeDb({ ...PREDEFINED_FEATURE_FLAGS, alertsEnabled: true });
    useIni("[flags]\nalertsEnabled = false\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.alertsEnabled).toBe(false);
  });

  it("adds a flag the store has never seen", async () => {
    useIni("[flags]\nbrandNewFlagEnabled = true\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.brandNewFlagEnabled).toBe(true);
    expect(data.overrides.unknownKeys).toEqual(["brandNewFlagEnabled"]);
  });

  it("reports what the file is doing alongside the flags", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\nmessengerEnabled = true\n");

    const { overrides } = await featureFlagsService.getFeatureFlags();

    expect(overrides).toMatchObject({ source: "feature-flags.ini", active: true, enforcing: true, mode: "enforce", count: 2 });
    expect(overrides.keys.sort()).toEqual(["crewOfficeEnabled", "messengerEnabled"]);
  });

  it("does not override anything when the file is inactive", async () => {
    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.crewOfficeEnabled).toBe(false);
    expect(data.overrides.active).toBe(false);
    expect(data.overrides.keys).toEqual([]);
  });

  it("does not override on read in seed mode", async () => {
    useIni("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.crewOfficeEnabled).toBe(false);
    expect(data.overrides.active).toBe(true);
    expect(data.overrides.enforcing).toBe(false);
  });

  it("still self-heals missing predefined flags into the store", async () => {
    featureFlagsService.db = fakeDb({});
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(Object.keys(data.flags).length).toBeGreaterThanOrEqual(Object.keys(PREDEFINED_FEATURE_FLAGS).length);
    expect(data.flags.crewOfficeEnabled).toBe(true);
    // Self-healing persists defaults, not the file values — the file is a projection.
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(PREDEFINED_FEATURE_FLAGS.crewOfficeEnabled);
  });
});

describe("getFeaturesWithDescriptions with an enforcing feature-flags.ini", () => {
  it("marks the pinned flag and keeps its stored value visible", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeaturesWithDescriptions();

    expect(data.flags.crewOfficeEnabled).toMatchObject({
      value: true,
      storedValue: false,
      overriddenBy: "feature-flags.ini",
    });
    expect(data.flags.crewOfficeEnabled.description.length).toBeGreaterThan(0);
  });

  it("leaves unpinned flags in their original shape", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeaturesWithDescriptions();

    expect(data.flags.messengerEnabled.overriddenBy).toBeUndefined();
    expect(data.flags.messengerEnabled.storedValue).toBeUndefined();
    expect(data.flags.messengerEnabled.value).toBe(false);
  });

  it("exposes the override report the flags page renders", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeaturesWithDescriptions();

    expect(data.overrides).toMatchObject({ active: true, enforcing: true, keys: ["crewOfficeEnabled"] });
    expect(data.groups.crewOffice).toContain("crewOfficeEnabled");
  });
});

describe("writes against pinned flags", () => {
  it("rejects a PATCH that would change a pinned flag", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.updateFlags({ crewOfficeEnabled: false })).rejects.toMatchObject({
      code: PINNED_FLAG_ERROR_CODE,
      conflicts: [{ key: "crewOfficeEnabled", pinnedValue: true, requestedValue: false }],
    });
  });

  it("names the file and the flag in the error message", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.updateFlags({ crewOfficeEnabled: false })).rejects.toThrow(
      /feature-flags\.ini.*crewOfficeEnabled \(pinned to true\)/,
    );
  });

  it("does not write anything when a batch contains one pinned conflict", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.updateFlags({ messengerEnabled: true, crewOfficeEnabled: false })).rejects.toMatchObject({
      code: PINNED_FLAG_ERROR_CODE,
    });
    expect(featureFlagsService.db.peek().flags.messengerEnabled).toBe(false);
  });

  it("allows a write that repeats the pinned value, so idempotent bulk writes work", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.updateFlags({ crewOfficeEnabled: true, messengerEnabled: true });

    expect(data.flags.crewOfficeEnabled).toBe(true);
    expect(data.flags.messengerEnabled).toBe(true);
  });

  it("allows changes to flags the file does not pin", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.updateFlags({ messengerEnabled: true });

    expect(data.flags.messengerEnabled).toBe(true);
    expect(data.flags.crewOfficeEnabled).toBe(true);
  });

  it("rejects a PUT that would change a pinned flag", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.replaceAllFlags({ ...PREDEFINED_FEATURE_FLAGS, crewOfficeEnabled: false })).rejects.toMatchObject({
      code: PINNED_FLAG_ERROR_CODE,
    });
  });

  it("accepts a PUT that keeps the pinned value", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.replaceAllFlags({ ...PREDEFINED_FEATURE_FLAGS, crewOfficeEnabled: true });

    expect(data.flags.crewOfficeEnabled).toBe(true);
  });

  it("does not restrict writes in seed mode", async () => {
    useIni("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.updateFlags({ crewOfficeEnabled: false });

    expect(data.flags.crewOfficeEnabled).toBe(false);
  });

  it("does not restrict writes when the file is inactive", async () => {
    const data = await featureFlagsService.updateFlags({ crewOfficeEnabled: true });

    expect(data.flags.crewOfficeEnabled).toBe(true);
  });

  it("still rejects invalid payloads before looking at pinning", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    await expect(featureFlagsService.updateFlags({ crewOfficeEnabled: "true" })).rejects.toThrow(/Validation failed/);
  });
});

describe("resetFeatureFlags with an enforcing feature-flags.ini", () => {
  it("resets the store but keeps the pinned value in effect", async () => {
    featureFlagsService.db = fakeDb({ ...PREDEFINED_FEATURE_FLAGS, messengerEnabled: true });
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.resetFeatureFlags();

    expect(data.flags.messengerEnabled).toBe(PREDEFINED_FEATURE_FLAGS.messengerEnabled);
    expect(data.flags.crewOfficeEnabled).toBe(true);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(PREDEFINED_FEATURE_FLAGS.crewOfficeEnabled);
  });
});

describe("seedStoreFromIni", () => {
  it("writes the file values into the store and reports the changes", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const result = await featureFlagsService.seedStoreFromIni();

    expect(result.applied).toBe(true);
    expect(result.changed).toEqual([{ key: "crewOfficeEnabled", from: false, to: true }]);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
  });

  it("is idempotent — a second run reports no changes", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");
    await featureFlagsService.seedStoreFromIni();

    const second = await featureFlagsService.seedStoreFromIni();

    expect(second.applied).toBe(true);
    expect(second.changed).toEqual([]);
  });

  it("seeds in seed mode too", async () => {
    useIni("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    const result = await featureFlagsService.seedStoreFromIni();

    expect(result.changed).toEqual([{ key: "crewOfficeEnabled", from: false, to: true }]);
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(true);
  });

  it("does nothing in off mode", async () => {
    useIni("[settings]\nmode = off\n[flags]\ncrewOfficeEnabled = true\n");

    const result = await featureFlagsService.seedStoreFromIni();

    expect(result).toMatchObject({ applied: false, changed: [] });
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
  });

  it("does nothing when a real file is skipped because NODE_ENV=test", async () => {
    fileCounter += 1;
    const filePath = path.join(tmpDir, `flags-skip-${fileCounter}.ini`);
    fs.writeFileSync(filePath, "[flags]\ncrewOfficeEnabled = true\n", "utf8");
    featureFlagIni.load({ filePath, allowInTests: false });

    const result = await featureFlagsService.seedStoreFromIni();

    expect(result.applied).toBe(false);
    expect(result.report.exists).toBe(true);
    expect(result.report.skippedReason).toBe("test-environment");
    expect(featureFlagsService.db.peek().flags.crewOfficeEnabled).toBe(false);
  });

  it("records a first-time flag as coming from nothing", async () => {
    useIni("[flags]\nbrandNewFlagEnabled = true\n");

    const result = await featureFlagsService.seedStoreFromIni();

    expect(result.changed).toEqual([{ key: "brandNewFlagEnabled", from: null, to: true }]);
  });
});

describe("problem reporting for an invalid file", () => {
  it("adds an unknown flag name to the problem list but still applies it", async () => {
    useIni("[flags]\nnotARealFlagEnabled = true\n");

    const { overrides } = await featureFlagsService.getFeatureFlags();

    expect(overrides.hasProblems).toBe(true);
    expect(overrides.problems).toEqual([
      { kind: "unknown-flag", key: "notARealFlagEnabled", message: expect.stringContaining("not a known feature flag") },
    ]);
  });

  it("merges parser problems with unknown-flag problems", async () => {
    useIni("[flags]\nbroken line\nnotARealFlagEnabled = true\ncrewOfficeEnabled = maybe\n");

    const { overrides } = await featureFlagsService.getFeatureFlags();

    expect(overrides.problems.map((problem) => problem.kind).sort()).toEqual(["invalid-value", "syntax", "unknown-flag"]);
  });

  it("reports no problems for a clean file", async () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    const { overrides } = await featureFlagsService.getFeatureFlags();

    expect(overrides.hasProblems).toBe(false);
    expect(overrides.problems).toEqual([]);
  });

  it("catches a mis-cased flag name as an unknown flag", async () => {
    // Flag keys are case-sensitive, so this would otherwise pin a phantom flag.
    useIni("[flags]\ncrewofficeenabled = true\n");

    const { overrides, flags } = await featureFlagsService.getFeatureFlags();

    expect(overrides.problems[0]).toMatchObject({ kind: "unknown-flag", key: "crewofficeenabled" });
    expect(flags.crewOfficeEnabled).toBe(false);
  });

  it("passes structural problems from the file through to the API report", async () => {
    useIni("[profile:demo]\ncrewOfficeEnabled = true\n");

    const { overrides } = await featureFlagsService.getFeatureFlags();

    expect(overrides.problems.map((problem) => problem.kind)).toEqual(["unknown-section"]);
    expect(overrides.active).toBe(false);
  });

  it("still serves flags when a broken file yields no usable overrides", async () => {
    useIni("[flags]\nbroken line\ncrewOfficeEnabled = perhaps\n");

    const data = await featureFlagsService.getFeatureFlags();

    expect(data.flags.crewOfficeEnabled).toBe(false);
    expect(data.overrides.active).toBe(false);
    expect(data.overrides.hasProblems).toBe(true);
    expect(data.overrides.problems).toHaveLength(2);
  });

  it("surfaces the problems in the descriptions payload too", async () => {
    useIni("[flags]\nbroken line\ncrewOfficeEnabled = true\n");

    const data = await featureFlagsService.getFeaturesWithDescriptions();

    expect(data.overrides.hasProblems).toBe(true);
    expect(data.overrides.problems[0].kind).toBe("syntax");
  });
});

describe("applyIniOverrides", () => {
  it("overlays the file values on any flag map", () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    expect(featureFlagsService.applyIniOverrides({ crewOfficeEnabled: false, other: true })).toEqual({
      crewOfficeEnabled: true,
      other: true,
    });
  });

  it("tolerates junk input instead of throwing", () => {
    useIni("[flags]\ncrewOfficeEnabled = true\n");

    for (const input of [undefined, null, "nope", 42, []]) {
      expect(featureFlagsService.applyIniOverrides(input)).toEqual({ crewOfficeEnabled: true });
    }
  });

  it("is a pass-through copy when the file is inactive", () => {
    const input = { crewOfficeEnabled: false };
    const output = featureFlagsService.applyIniOverrides(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
