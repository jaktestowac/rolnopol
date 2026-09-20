import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// services/feature-flag-ini.service.js owns "how the file is read": modes, the
// NODE_ENV=test skip, boolean coercion and the report the rest of the app logs
// and renders. The read-through/pinning behaviour on top of it is covered in
// feature-flags.service.ini.test.js.
const iniModule = require("../../services/feature-flag-ini.service");
const { FeatureFlagIniService, MODES, SKIP_REASONS, DEFAULT_INI_FILENAME } = iniModule;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rolnopol-ini-"));
let fileCounter = 0;

function writeIni(content) {
  fileCounter += 1;
  const filePath = path.join(tmpDir, `flags-${fileCounter}.ini`);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

/** A service instance that ignores the NODE_ENV=test skip, as production would. */
function activeService(content) {
  return new FeatureFlagIniService({ filePath: writeIni(content), allowInTests: true });
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("feature-flag-ini.service: NODE_ENV=test skip", () => {
  beforeEach(() => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("skips a perfectly good file in the test environment", () => {
    const service = new FeatureFlagIniService({ filePath: writeIni("[flags]\ncrewOfficeEnabled = true\n") });
    const report = service.getReport();

    expect(report.exists).toBe(true);
    expect(report.active).toBe(false);
    expect(report.enforcing).toBe(false);
    expect(report.skippedReason).toBe(SKIP_REASONS.SKIP_REASON_TEST_ENV);
    expect(service.getOverrides()).toEqual({});
    expect(service.getEnforcedOverrides()).toEqual({});
    expect(service.getSeedOverrides()).toEqual({});
    expect(service.isPinned("crewOfficeEnabled")).toBe(false);
  });

  it("still parses and reports the declared flags while skipping them", () => {
    const service = new FeatureFlagIniService({ filePath: writeIni("[flags]\ncrewOfficeEnabled = true\n") });

    expect(service.getReport().declaredKeys).toEqual(["crewOfficeEnabled"]);
    expect(service.getReport().keys).toEqual([]);
    expect(service.getDeclaredOverrides()).toEqual({ crewOfficeEnabled: true });
  });

  it("applies the file when a test opts in via the constructor", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    expect(service.getReport().active).toBe(true);
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
  });

  it("applies the file when it opts itself in via [settings] applyInTests", () => {
    const service = new FeatureFlagIniService({
      filePath: writeIni("[settings]\napplyInTests = true\n[flags]\ncrewOfficeEnabled = true\n"),
    });

    expect(service.getReport().active).toBe(true);
    expect(service.isPinned("crewOfficeEnabled")).toBe(true);
  });

  it("applies the file when FEATURE_FLAGS_INI_ALLOW_IN_TESTS=true", () => {
    const filePath = writeIni("[flags]\ncrewOfficeEnabled = true\n");
    process.env.FEATURE_FLAGS_INI_ALLOW_IN_TESTS = "true";
    try {
      expect(new FeatureFlagIniService({ filePath }).getReport().active).toBe(true);
    } finally {
      delete process.env.FEATURE_FLAGS_INI_ALLOW_IN_TESTS;
    }
  });

  it("the shared singleton is inert in the test environment", () => {
    expect(iniModule.getOverrides()).toEqual({});
    expect(iniModule.isEnforcing()).toBe(false);
    expect(iniModule.getPinnedKeys()).toEqual([]);
  });
});

describe("feature-flag-ini.service: missing and unreadable files", () => {
  it("is inactive and silent when the file does not exist", () => {
    const service = new FeatureFlagIniService({ filePath: path.join(tmpDir, "definitely-not-here.ini"), allowInTests: true });
    const report = service.getReport();

    expect(report.exists).toBe(false);
    expect(report.active).toBe(false);
    expect(report.skippedReason).toBe(SKIP_REASONS.SKIP_REASON_MISSING_FILE);
    expect(report.parseErrors).toEqual([]);
    expect(report.count).toBe(0);
  });

  it("is inactive when the path is a directory rather than a file", () => {
    const service = new FeatureFlagIniService({ filePath: tmpDir, allowInTests: true });

    expect(service.isActive()).toBe(false);
    expect(service.getOverrides()).toEqual({});
  });

  it("is inactive when the file has no [flags] section", () => {
    const service = activeService("[settings]\nmode = enforce\n");

    expect(service.getReport().skippedReason).toBe(SKIP_REASONS.SKIP_REASON_NO_FLAGS);
    expect(service.isActive()).toBe(false);
  });

  it("is inactive when every declared flag is unparseable", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = maybe\n");

    expect(service.isActive()).toBe(false);
    expect(service.getReport().invalidEntries).toEqual([
      { key: "crewOfficeEnabled", value: "maybe", message: expect.stringContaining("Not a boolean") },
    ]);
  });
});

describe("feature-flag-ini.service: modes", () => {
  it("enforces and seeds by default", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    expect(service.getReport().mode).toBe(MODES.MODE_ENFORCE);
    expect(service.isEnforcing()).toBe(true);
    expect(service.isSeeding()).toBe(true);
  });

  it("seeds but does not enforce in seed mode", () => {
    const service = activeService("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    expect(service.isSeeding()).toBe(true);
    expect(service.isEnforcing()).toBe(false);
    expect(service.getSeedOverrides()).toEqual({ crewOfficeEnabled: true });
    expect(service.getEnforcedOverrides()).toEqual({});
    expect(service.isPinned("crewOfficeEnabled")).toBe(false);
  });

  it("does nothing at all in off mode", () => {
    const service = activeService("[settings]\nmode = off\n[flags]\ncrewOfficeEnabled = true\n");

    expect(service.isActive()).toBe(false);
    expect(service.isSeeding()).toBe(false);
    expect(service.isEnforcing()).toBe(false);
    expect(service.getReport().skippedReason).toBe(SKIP_REASONS.SKIP_REASON_MODE_OFF);
    expect(service.getReport().declaredKeys).toEqual(["crewOfficeEnabled"]);
  });

  it("accepts a mode in any casing", () => {
    expect(activeService("[settings]\nmode =  SeeD \n[flags]\na = true\n").getReport().mode).toBe(MODES.MODE_SEED);
  });

  it("falls back to enforce and reports an unknown mode", () => {
    const service = activeService("[settings]\nmode = whatever\n[flags]\na = true\n");

    expect(service.getReport().mode).toBe(MODES.MODE_ENFORCE);
    expect(service.getReport().invalidEntries[0]).toMatchObject({ key: "mode", value: "whatever" });
  });
});

describe("feature-flag-ini.service: flag coercion", () => {
  it("coerces every documented boolean spelling", () => {
    const service = activeService(
      ["[flags]", "a = true", "b = FALSE", "c = 1", "d = 0", "e = on", "f = off", "g = yes", "h = No"].join("\n"),
    );

    expect(service.getOverrides()).toEqual({ a: true, b: false, c: true, d: false, e: true, f: false, g: true, h: false });
  });

  it("keeps the good flags and reports only the bad ones", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\nmessengerEnabled = perhaps\nfarmStayEnabled = 0\n");

    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true, farmStayEnabled: false });
    expect(service.getReport().invalidEntries.map((entry) => entry.key)).toEqual(["messengerEnabled"]);
    expect(service.isPinned("messengerEnabled")).toBe(false);
  });

  it("surfaces parse errors and warnings in the report without dropping valid flags", () => {
    const service = activeService("[flags]\ngarbage line\ncrewOfficeEnabled = true\ncrewOfficeEnabled = false\n");
    const report = service.getReport();

    expect(report.parseErrors).toHaveLength(1);
    expect(report.parseWarnings).toHaveLength(1);
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: false });
  });

  it("ignores flags declared outside the [flags] section", () => {
    const service = activeService("crewOfficeEnabled = true\n[settings]\nmessengerEnabled = true\n[flags]\nfarmStayEnabled = true\n");

    expect(service.getOverrides()).toEqual({ farmStayEnabled: true });
  });

  it("never lets a hostile file pollute the prototype", () => {
    const service = activeService("[flags]\n__proto__ = true\nconstructor = true\ncrewOfficeEnabled = true\n");

    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
    expect({}.crewOfficeEnabled).toBeUndefined();
    expect(service.getReport().parseErrors).toHaveLength(2);
  });

  it("hands out copies so callers cannot mutate the loaded configuration", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    const overrides = service.getOverrides();
    overrides.crewOfficeEnabled = false;
    overrides.injected = true;

    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
    expect(service.getPinnedValue("crewOfficeEnabled")).toBe(true);
  });
});

describe("feature-flag-ini.service: an invalid file warns but never breaks", () => {
  it("reports a syntax error as a problem and still applies the good flags", () => {
    const service = activeService("[flags]\nthis line is broken\ncrewOfficeEnabled = true\n");
    const report = service.getReport();

    expect(report.hasProblems).toBe(true);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ kind: "syntax", line: 2 });
    expect(report.problems[0].message).toContain("Line 2");
    expect(report.active).toBe(true);
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
  });

  it("reports a non-boolean value as a problem naming the ignored entry", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = perhaps\nfarmStayEnabled = true\n");
    const report = service.getReport();

    expect(report.problems).toEqual([
      { kind: "invalid-value", key: "crewOfficeEnabled", message: expect.stringContaining('Ignored "crewOfficeEnabled = perhaps"') },
    ]);
    expect(service.getOverrides()).toEqual({ farmStayEnabled: true });
  });

  it("reports a duplicate key as a problem", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\ncrewOfficeEnabled = false\n");

    expect(service.getReport().problems[0]).toMatchObject({ kind: "duplicate", line: 3 });
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: false });
  });

  it("reports an unusable mode as a problem and keeps enforcing", () => {
    const service = activeService("[settings]\nmode = nonsense\n[flags]\ncrewOfficeEnabled = true\n");
    const report = service.getReport();

    expect(report.problems.some((problem) => problem.key === "mode")).toBe(true);
    expect(report.mode).toBe(MODES.MODE_ENFORCE);
    expect(report.active).toBe(true);
  });

  it("collects every problem in a thoroughly broken file without throwing", () => {
    const service = activeService(
      ["[flags", "= nothing", "crewOfficeEnabled = perhaps", "__proto__ = true", "farmStayEnabled = true", "junk"].join("\n"),
    );
    const report = service.getReport();

    expect(report.problems.length).toBeGreaterThanOrEqual(4);
    expect(report.hasProblems).toBe(true);
    expect(report.problems.every((problem) => typeof problem.message === "string" && problem.message.length > 0)).toBe(true);
  });

  it("reports no problems for a clean file", () => {
    const service = activeService("[settings]\nmode = enforce\n[flags]\ncrewOfficeEnabled = true\n");

    expect(service.getReport().hasProblems).toBe(false);
    expect(service.getReport().problems).toEqual([]);
    expect(service.hasProblems()).toBe(false);
  });

  it("reports no problems for a missing file", () => {
    const service = new FeatureFlagIniService({ filePath: path.join(tmpDir, "absent.ini"), allowInTests: true });

    expect(service.getReport().hasProblems).toBe(false);
  });

  it("reports an unreadable file as a problem instead of throwing", () => {
    const service = new FeatureFlagIniService({ filePath: tmpDir, allowInTests: true });
    const report = service.getReport();

    expect(report.hasProblems).toBe(true);
    expect(report.problems[0].kind).toBe("unreadable");
    expect(report.active).toBe(false);
  });

  it("survives a file that is entirely garbage", () => {
    const service = activeService(" binarygarbage\n[[[\n]]]\n====\n");

    expect(service.isActive()).toBe(false);
    expect(service.getOverrides()).toEqual({});
    expect(service.getReport().hasProblems).toBe(true);
  });

  it("degrades to no overrides when parsing blows up unexpectedly", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");
    // Simulate an unforeseen failure inside the load path.
    const filePath = service.getFilePath();
    const originalLoadFromDisk = service._loadFromDisk;
    service._loadFromDisk = () => {
      throw new Error("boom");
    };

    const report = service.load({ filePath, allowInTests: true });

    expect(report.active).toBe(false);
    expect(report.skippedReason).toBe(SKIP_REASONS.SKIP_REASON_LOAD_FAILED);
    expect(report.problems[0].message).toContain("boom");
    expect(service.getOverrides()).toEqual({});

    service._loadFromDisk = originalLoadFromDisk;
  });
});

describe("feature-flag-ini.service: silent mistakes are reported", () => {
  it("warns about a misspelled section instead of doing nothing", () => {
    const service = activeService("[flag]\ncrewOfficeEnabled = true\n");
    const report = service.getReport();

    expect(service.isActive()).toBe(false);
    expect(report.problems).toEqual([
      { kind: "unknown-section", section: "flag", message: expect.stringContaining("Section [flag] is ignored") },
    ]);
  });

  it("warns about flags written before any section header", () => {
    const service = activeService("crewOfficeEnabled = true\nfarmStayEnabled = true\n");
    const report = service.getReport();

    expect(service.getOverrides()).toEqual({});
    expect(report.problems).toEqual([{ kind: "misplaced-entry", message: expect.stringContaining("2 entries before the first section") }]);
  });

  it("uses the singular form for a single misplaced entry", () => {
    const report = activeService("crewOfficeEnabled = true\n[flags]\nfarmStayEnabled = true\n").getReport();

    expect(report.problems[0].message).toContain("1 entry before the first section header is ignored");
  });

  it("warns about an unknown key in [settings]", () => {
    const report = activeService("[settings]\nmodee = seed\n[flags]\ncrewOfficeEnabled = true\n").getReport();

    expect(report.problems).toEqual([
      { kind: "unknown-setting", key: "modee", message: expect.stringContaining('Unknown setting "modee"') },
    ]);
    expect(report.mode).toBe(MODES.MODE_ENFORCE);
  });

  it("treats a mis-cased setting name as unknown rather than guessing", () => {
    const report = activeService("[settings]\nMode = seed\n[flags]\na = true\n").getReport();

    expect(report.problems[0]).toMatchObject({ kind: "unknown-setting", key: "Mode" });
    expect(report.mode).toBe(MODES.MODE_ENFORCE);
  });

  it("warns about a non-boolean applyInTests instead of ignoring it", () => {
    const report = activeService("[settings]\napplyInTests = maybe\n[flags]\na = true\n").getReport();

    expect(report.problems).toEqual([
      { kind: "invalid-value", key: "applyInTests", message: expect.stringContaining('Ignored "applyInTests = maybe"') },
    ]);
  });

  it("accepts the known sections and settings without complaint", () => {
    const report = activeService("[settings]\nmode = seed\napplyInTests = true\n[flags]\na = true\n").getReport();

    expect(report.problems).toEqual([]);
  });

  it("accepts a mis-cased section name, matching the parser's lookup", () => {
    const service = activeService("[FLAGS]\ncrewOfficeEnabled = true\n[Settings]\nmode = seed\n");

    expect(service.getReport().problems).toEqual([]);
    expect(service.getReport().mode).toBe(MODES.MODE_SEED);
    expect(service.getDeclaredOverrides()).toEqual({ crewOfficeEnabled: true });
  });
});

describe("feature-flag-ini.service: applyInTests can only opt in, never out", () => {
  it("does not re-skip the file when applyInTests is false but the caller opted in", () => {
    const service = new FeatureFlagIniService({
      filePath: writeIni("[settings]\napplyInTests = false\n[flags]\ncrewOfficeEnabled = true\n"),
      allowInTests: true,
    });

    expect(service.isActive()).toBe(true);
  });

  it("leaves the file skipped when applyInTests is false and nobody opted in", () => {
    const service = new FeatureFlagIniService({
      filePath: writeIni("[settings]\napplyInTests = false\n[flags]\ncrewOfficeEnabled = true\n"),
    });

    expect(service.getReport().skippedReason).toBe(SKIP_REASONS.SKIP_REASON_TEST_ENV);
  });

  it("lets an explicit allowInTests:false win over the environment variable", () => {
    const filePath = writeIni("[flags]\ncrewOfficeEnabled = true\n");
    process.env.FEATURE_FLAGS_INI_ALLOW_IN_TESTS = "true";
    try {
      expect(new FeatureFlagIniService({ filePath, allowInTests: false }).isActive()).toBe(false);
    } finally {
      delete process.env.FEATURE_FLAGS_INI_ALLOW_IN_TESTS;
    }
  });
});

describe("feature-flag-ini.service: pinning lookups", () => {
  it("returns false — not undefined — for a flag pinned to false", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = false\n");

    expect(service.isPinned("crewOfficeEnabled")).toBe(true);
    expect(service.getPinnedValue("crewOfficeEnabled")).toBe(false);
  });

  it("returns undefined for a flag the file does not mention", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    expect(service.isPinned("messengerEnabled")).toBe(false);
    expect(service.getPinnedValue("messengerEnabled")).toBeUndefined();
  });

  it("never reports inherited object properties as pinned", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(service.isPinned(key)).toBe(false);
      expect(service.getPinnedValue(key)).toBeUndefined();
    }
  });

  it("pins nothing at all in seed mode", () => {
    const service = activeService("[settings]\nmode = seed\n[flags]\ncrewOfficeEnabled = true\n");

    expect(service.isPinned("crewOfficeEnabled")).toBe(false);
    expect(service.getPinnedValue("crewOfficeEnabled")).toBeUndefined();
    expect(service.getPinnedKeys()).toEqual([]);
  });
});

describe("feature-flag-ini.service: callers cannot mutate loaded state", () => {
  it("hands out copies from every accessor", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");

    service.getDeclaredOverrides().crewOfficeEnabled = false;
    service.getEnforcedOverrides().crewOfficeEnabled = false;
    service.getSeedOverrides().crewOfficeEnabled = false;
    service.getPinnedKeys().push("injected");

    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
    expect(service.getPinnedKeys()).toEqual(["crewOfficeEnabled"]);
  });

  it("hands out a report that cannot be edited from the outside", () => {
    const service = activeService("[flags]\nbroken line\ncrewOfficeEnabled = true\n");

    const report = service.getReport();
    report.keys.push("injected");
    report.problems.push({ kind: "fake", message: "fake" });
    report.parseErrors.length = 0;
    report.invalidEntries.push({ key: "fake" });

    const fresh = service.getReport();
    expect(fresh.keys).toEqual(["crewOfficeEnabled"]);
    expect(fresh.problems).toHaveLength(1);
    expect(fresh.parseErrors).toHaveLength(1);
    expect(fresh.invalidEntries).toEqual([]);
  });
});

describe("feature-flag-ini.service: real files on disk", () => {
  it("reads a CRLF file with a BOM, as a Windows editor would write it", () => {
    fileCounter += 1;
    const filePath = path.join(tmpDir, `crlf-${fileCounter}.ini`);
    fs.writeFileSync(filePath, "﻿[settings]\r\nmode = seed\r\n\r\n[flags]\r\ncrewOfficeEnabled = true\r\n", "utf8");

    const service = new FeatureFlagIniService({ filePath, allowInTests: true });

    expect(service.getReport().problems).toEqual([]);
    expect(service.getReport().mode).toBe(MODES.MODE_SEED);
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
  });

  it("treats a completely empty file as a clean no-op", () => {
    const service = activeService("");
    const report = service.getReport();

    expect(report.exists).toBe(true);
    expect(report.hasProblems).toBe(false);
    expect(report.skippedReason).toBe(SKIP_REASONS.SKIP_REASON_NO_FLAGS);
    expect(service.isActive()).toBe(false);
  });

  it("treats a comments-only file as a clean no-op", () => {
    const service = activeService("; nothing enabled yet\n# still nothing\n");

    expect(service.getReport().hasProblems).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it("treats an empty [flags] section as a clean no-op", () => {
    const service = activeService("[settings]\nmode = enforce\n[flags]\n");

    expect(service.getReport().hasProblems).toBe(false);
    expect(service.getReport().skippedReason).toBe(SKIP_REASONS.SKIP_REASON_NO_FLAGS);
  });

  it("reads a flag whose value is only a comment as invalid, not as enabled", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = ; TODO decide\n");

    expect(service.getOverrides()).toEqual({});
    expect(service.getReport().problems[0]).toMatchObject({ kind: "invalid-value", key: "crewOfficeEnabled" });
  });
});

describe("feature-flag-ini.service: load() path resolution", () => {
  it("falls back to the default path when load() is called with no options", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");
    expect(service.getFilePath()).toContain(tmpDir);

    service.load();

    expect(service.getFilePath()).toBe(iniModule.DEFAULT_INI_PATH);
  });

  it("prefers an explicit path over FEATURE_FLAGS_INI_PATH", () => {
    const explicit = writeIni("[flags]\ncrewOfficeEnabled = true\n");
    process.env.FEATURE_FLAGS_INI_PATH = writeIni("[flags]\nfarmStayEnabled = true\n");
    try {
      const service = new FeatureFlagIniService({ filePath: explicit, allowInTests: true });

      expect(service.getFilePath()).toBe(explicit);
      expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
    } finally {
      delete process.env.FEATURE_FLAGS_INI_PATH;
    }
  });

  it("ignores an empty-string path and uses the default", () => {
    const service = new FeatureFlagIniService({ filePath: "", allowInTests: true });

    expect(service.getFilePath()).toBe(iniModule.DEFAULT_INI_PATH);
  });
});

describe("feature-flag-ini.service: report shape", () => {
  it("describes an active file", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\nfarmStayEnabled = false\n");

    expect(service.getReport()).toMatchObject({
      source: DEFAULT_INI_FILENAME,
      exists: true,
      active: true,
      enforcing: true,
      mode: MODES.MODE_ENFORCE,
      skippedReason: null,
      count: 2,
    });
    expect(service.getReport().keys.sort()).toEqual(["crewOfficeEnabled", "farmStayEnabled"]);
    expect(service.getPinnedKeys().sort()).toEqual(["crewOfficeEnabled", "farmStayEnabled"]);
  });

  it("reports a filename, never a filesystem path", () => {
    const service = activeService("[flags]\na = true\n");

    expect(service.getReport().source).toBe(DEFAULT_INI_FILENAME);
    expect(JSON.stringify(service.getReport())).not.toContain(tmpDir.replace(/\\/g, "\\\\"));
    expect(service.getFilePath()).toContain(tmpDir);
  });
});

describe("feature-flag-ini.service: reload", () => {
  it("picks up file changes on load() and returns the fresh report", () => {
    const filePath = writeIni("[flags]\ncrewOfficeEnabled = true\n");
    const service = new FeatureFlagIniService({ filePath, allowInTests: true });
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });

    fs.writeFileSync(filePath, "[flags]\ncrewOfficeEnabled = false\nfarmStayEnabled = true\n", "utf8");
    const report = service.load({ filePath, allowInTests: true });

    expect(report.count).toBe(2);
    expect(service.getOverrides()).toEqual({ crewOfficeEnabled: false, farmStayEnabled: true });
  });

  it("clears previous state when reloaded against a missing file", () => {
    const service = activeService("[flags]\ncrewOfficeEnabled = true\n");
    service.load({ filePath: path.join(tmpDir, "gone.ini"), allowInTests: true });

    expect(service.getOverrides()).toEqual({});
    expect(service.getReport().declaredKeys).toEqual([]);
    expect(service.getReport().invalidEntries).toEqual([]);
    expect(service.getReport().parseErrors).toEqual([]);
  });

  it("reads the path from FEATURE_FLAGS_INI_PATH when none is given", () => {
    const filePath = writeIni("[flags]\ncrewOfficeEnabled = true\n");
    process.env.FEATURE_FLAGS_INI_PATH = filePath;
    try {
      const service = new FeatureFlagIniService({ allowInTests: true });
      expect(service.getFilePath()).toBe(filePath);
      expect(service.getOverrides()).toEqual({ crewOfficeEnabled: true });
    } finally {
      delete process.env.FEATURE_FLAGS_INI_PATH;
    }
  });
});

describe("feature-flag-ini.service: the shipped example file", () => {
  it("parses cleanly with every flag commented out", () => {
    const examplePath = path.join(__dirname, "..", "..", "feature-flags.example.ini");
    const service = new FeatureFlagIniService({ filePath: examplePath, allowInTests: true });
    const report = service.getReport();

    expect(report.exists).toBe(true);
    expect(report.parseErrors).toEqual([]);
    expect(report.invalidEntries).toEqual([]);
    expect(report.mode).toBe(MODES.MODE_ENFORCE);
    // Nothing is enabled out of the box: copying the example must be a no-op.
    expect(report.declaredKeys).toEqual([]);
    expect(report.active).toBe(false);
  });
});
