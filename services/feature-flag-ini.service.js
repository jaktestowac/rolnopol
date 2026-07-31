// Persistent feature-flag overrides read from `feature-flags.ini` in the repo root.
//
// The file is the highest authority for the flags it lists: it seeds the JSON
// store at boot AND is re-applied on every read, so a flag it pins cannot be
// changed from the admin UI or the API. Because it is not a database file it
// also survives `restoreAllDatabasesFromBaseState()`.
//
// Precedence:  PREDEFINED_FEATURE_FLAGS  ->  data/feature-flags.json  ->  feature-flags.ini
//
// Modes (`[settings] mode`):
//   enforce (default) — seed the store at boot AND override on every read; pinned writes are rejected
//   seed              — seed the store at boot only; the app owns the value afterwards
//   off               — the file is parsed for reporting but never applied
//
// Under NODE_ENV=test the file is skipped entirely so the test suite keeps full
// control of the flags. Tests that need the override path exercise it explicitly
// via `load({ filePath, allowInTests: true })` or a dedicated instance.

const fs = require("fs");
const path = require("path");
const { parseIni, getSection, parseBooleanValue, GLOBAL_SECTION } = require("../helpers/ini-parser");

const DEFAULT_INI_FILENAME = "feature-flags.ini";
const DEFAULT_INI_PATH = path.join(__dirname, "..", DEFAULT_INI_FILENAME);

const FLAGS_SECTION = "flags";
const SETTINGS_SECTION = "settings";
const KNOWN_SECTIONS = new Set([FLAGS_SECTION, SETTINGS_SECTION]);
const SETTING_MODE = "mode";
const SETTING_APPLY_IN_TESTS = "applyInTests";
const KNOWN_SETTINGS = new Set([SETTING_MODE, SETTING_APPLY_IN_TESTS]);
const NOT_A_BOOLEAN_MESSAGE = "Not a boolean (expected true/false, 1/0, on/off, yes/no)";

const MODE_ENFORCE = "enforce";
const MODE_SEED = "seed";
const MODE_OFF = "off";
const VALID_MODES = [MODE_ENFORCE, MODE_SEED, MODE_OFF];

const SKIP_REASON_TEST_ENV = "test-environment";
const SKIP_REASON_MISSING_FILE = "file-not-found";
const SKIP_REASON_MODE_OFF = "mode-off";
const SKIP_REASON_NO_FLAGS = "no-flags";
const SKIP_REASON_UNREADABLE = "file-unreadable";
const SKIP_REASON_LOAD_FAILED = "load-failed";

// Problem kinds reported for an invalid file. All of them are warnings: the app
// always boots, applying whatever the file got right.
const PROBLEM_SYNTAX = "syntax";
const PROBLEM_INVALID_VALUE = "invalid-value";
const PROBLEM_DUPLICATE = "duplicate";
const PROBLEM_UNREADABLE = "unreadable";
const PROBLEM_UNKNOWN_FLAG = "unknown-flag";
const PROBLEM_UNKNOWN_SECTION = "unknown-section";
const PROBLEM_UNKNOWN_SETTING = "unknown-setting";
const PROBLEM_MISPLACED_ENTRY = "misplaced-entry";

class FeatureFlagIniService {
  constructor(options = {}) {
    this.load(options);
  }

  /**
   * (Re)read the INI file from disk. Never throws.
   *
   * @param {Object} [options]
   * @param {string} [options.filePath] Absolute path to the INI file
   * @param {boolean} [options.allowInTests] Apply overrides even when NODE_ENV=test
   * @returns {Object} the resulting report (same shape as `getReport()`)
   */
  load(options = {}) {
    this.filePath =
      typeof options.filePath === "string" && options.filePath.length > 0
        ? options.filePath
        : process.env.FEATURE_FLAGS_INI_PATH || DEFAULT_INI_PATH;

    this.allowInTests =
      options.allowInTests === true || (options.allowInTests === undefined && process.env.FEATURE_FLAGS_INI_ALLOW_IN_TESTS === "true");

    this.overrides = Object.create(null);
    this.mode = MODE_ENFORCE;
    this.exists = false;
    this.invalidEntries = [];
    this.parseErrors = [];
    this.parseWarnings = [];
    this.unknownSections = [];
    this.unknownSettings = [];
    this.misplacedEntryCount = 0;
    this.skippedReason = null;
    this.readError = null;

    // A broken configuration file must never stop the app from starting, so any
    // unexpected failure in here degrades to "no overrides" plus a reported
    // problem rather than propagating out of the constructor / boot sequence.
    try {
      this._loadFromDisk();
    } catch (error) {
      this.overrides = Object.create(null);
      this.skippedReason = SKIP_REASON_LOAD_FAILED;
      this.readError = error instanceof Error ? error.message : String(error);
    }

    return this.getReport();
  }

  _loadFromDisk() {
    const isTestEnv = process.env.NODE_ENV === "test";

    let content = null;
    try {
      if (fs.existsSync(this.filePath)) {
        content = fs.readFileSync(this.filePath, "utf8");
        this.exists = true;
      }
    } catch (error) {
      this.exists = false;
      this.skippedReason = SKIP_REASON_UNREADABLE;
      this.readError = error instanceof Error ? error.message : String(error);
      return;
    }

    if (!this.exists) {
      this.skippedReason = SKIP_REASON_MISSING_FILE;
      return;
    }

    const parsed = parseIni(content);
    this.parseErrors = parsed.errors;
    this.parseWarnings = parsed.warnings;

    // A misspelled section or setting name would otherwise do nothing at all and
    // give no clue why, so both are collected and reported as warnings.
    this.unknownSections = Object.keys(parsed.sections).filter((name) => name !== GLOBAL_SECTION && !KNOWN_SECTIONS.has(name));
    this.misplacedEntryCount = Object.keys(getSection(parsed, GLOBAL_SECTION)).length;

    const settings = getSection(parsed, SETTINGS_SECTION);
    this.unknownSettings = Object.keys(settings).filter((key) => !KNOWN_SETTINGS.has(key));
    this.mode = this._resolveMode(settings[SETTING_MODE]);

    // `[settings] applyInTests` is the in-file counterpart of the constructor
    // option — either one is enough to opt a test run in. It can only ever turn
    // the file on, never off, so an explicit `false` leaves the caller's choice
    // untouched.
    if (Object.prototype.hasOwnProperty.call(settings, SETTING_APPLY_IN_TESTS)) {
      const applyInTests = parseBooleanValue(settings[SETTING_APPLY_IN_TESTS]);
      if (applyInTests === undefined) {
        this.invalidEntries.push({
          key: SETTING_APPLY_IN_TESTS,
          value: settings[SETTING_APPLY_IN_TESTS],
          message: NOT_A_BOOLEAN_MESSAGE,
        });
      } else if (applyInTests === true) {
        this.allowInTests = true;
      }
    }

    const flagsSection = getSection(parsed, FLAGS_SECTION);
    for (const [key, rawValue] of Object.entries(flagsSection)) {
      const value = parseBooleanValue(rawValue);
      if (value === undefined) {
        this.invalidEntries.push({ key, value: rawValue, message: NOT_A_BOOLEAN_MESSAGE });
        continue;
      }
      this.overrides[key] = value;
    }

    if (isTestEnv && !this.allowInTests) {
      this.skippedReason = SKIP_REASON_TEST_ENV;
    } else if (this.mode === MODE_OFF) {
      this.skippedReason = SKIP_REASON_MODE_OFF;
    } else if (Object.keys(this.overrides).length === 0) {
      this.skippedReason = SKIP_REASON_NO_FLAGS;
    }
  }

  _resolveMode(rawMode) {
    if (typeof rawMode !== "string") {
      return MODE_ENFORCE;
    }
    const normalized = rawMode.trim().toLowerCase();
    if (VALID_MODES.includes(normalized)) {
      return normalized;
    }
    if (normalized.length > 0) {
      this.invalidEntries.push({
        key: "mode",
        value: rawMode,
        message: `Unknown mode, falling back to "${MODE_ENFORCE}" (expected one of: ${VALID_MODES.join(", ")})`,
      });
    }
    return MODE_ENFORCE;
  }

  /** True when the file exists and its flags should be applied at all. */
  isActive() {
    return this.skippedReason === null && Object.keys(this.overrides).length > 0;
  }

  /** True when overrides win on every read and pinned writes must be rejected. */
  isEnforcing() {
    return this.isActive() && this.mode === MODE_ENFORCE;
  }

  /** True when the store should be seeded from the file at boot. */
  isSeeding() {
    return this.isActive() && (this.mode === MODE_ENFORCE || this.mode === MODE_SEED);
  }

  /** @returns {Object<string, boolean>} a copy of the effective overrides ({} when inactive) */
  getOverrides() {
    if (!this.isActive()) {
      return {};
    }
    return { ...this.overrides };
  }

  /** All flags declared in the file, regardless of whether they are applied. */
  getDeclaredOverrides() {
    return { ...this.overrides };
  }

  /** Overrides that must win on every read ({} unless the mode is `enforce`). */
  getEnforcedOverrides() {
    return this.isEnforcing() ? { ...this.overrides } : {};
  }

  /** Overrides to write into the JSON store at boot ({} when seeding is off). */
  getSeedOverrides() {
    return this.isSeeding() ? { ...this.overrides } : {};
  }

  /** True when `key` is pinned by an enforcing INI file. */
  isPinned(key) {
    return this.isEnforcing() && Object.prototype.hasOwnProperty.call(this.overrides, key);
  }

  /** The pinned value for `key`, or undefined when it is not pinned. */
  getPinnedValue(key) {
    return this.isPinned(key) ? this.overrides[key] : undefined;
  }

  /** Keys pinned by an enforcing INI file. */
  getPinnedKeys() {
    return this.isEnforcing() ? Object.keys(this.overrides) : [];
  }

  /**
   * Everything wrong with the file, as one flat list of warnings. Each entry is
   * `{ kind, message, line?, key? }` and reads as a single human sentence, so the
   * boot log and the Feature Flags page can render the same text.
   */
  getProblems() {
    const problems = [];

    if (this.readError) {
      problems.push({
        kind: PROBLEM_UNREADABLE,
        message: `Could not read the file: ${this.readError}`,
      });
    }

    for (const entry of this.parseErrors) {
      problems.push({ kind: PROBLEM_SYNTAX, line: entry.line, message: `Line ${entry.line}: ${entry.message}` });
    }

    for (const entry of this.parseWarnings) {
      problems.push({ kind: PROBLEM_DUPLICATE, line: entry.line, message: `Line ${entry.line}: ${entry.message}` });
    }

    for (const entry of this.invalidEntries) {
      problems.push({
        kind: PROBLEM_INVALID_VALUE,
        key: entry.key,
        message: `Ignored "${entry.key} = ${entry.value}": ${entry.message}`,
      });
    }

    for (const section of this.unknownSections) {
      problems.push({
        kind: PROBLEM_UNKNOWN_SECTION,
        section,
        message: `Section [${section}] is ignored — only [${FLAGS_SECTION}] and [${SETTINGS_SECTION}] are used`,
      });
    }

    for (const key of this.unknownSettings) {
      problems.push({
        kind: PROBLEM_UNKNOWN_SETTING,
        key,
        message: `Unknown setting "${key}" in [${SETTINGS_SECTION}] is ignored — expected one of: ${[...KNOWN_SETTINGS].join(", ")}`,
      });
    }

    if (this.misplacedEntryCount > 0) {
      problems.push({
        kind: PROBLEM_MISPLACED_ENTRY,
        message:
          `${this.misplacedEntryCount} entr${this.misplacedEntryCount === 1 ? "y" : "ies"} before the first section header ` +
          `${this.misplacedEntryCount === 1 ? "is" : "are"} ignored — put flags under [${FLAGS_SECTION}]`,
      });
    }

    return problems;
  }

  /** True when the file exists but is not entirely well formed. */
  hasProblems() {
    return this.getProblems().length > 0;
  }

  /**
   * Machine-readable description of what the file is doing right now. Safe to
   * send to the frontend — it contains no filesystem paths beyond the filename.
   */
  getReport() {
    const keys = Object.keys(this.overrides);
    const problems = this.getProblems();
    return {
      problems,
      hasProblems: problems.length > 0,
      source: DEFAULT_INI_FILENAME,
      exists: this.exists,
      active: this.isActive(),
      enforcing: this.isEnforcing(),
      mode: this.mode,
      skippedReason: this.skippedReason,
      count: this.isActive() ? keys.length : 0,
      keys: this.isActive() ? [...keys] : [],
      declaredKeys: [...keys],
      invalidEntries: this.invalidEntries.map((entry) => ({ ...entry })),
      parseErrors: this.parseErrors.map((entry) => ({ ...entry })),
      parseWarnings: this.parseWarnings.map((entry) => ({ ...entry })),
    };
  }

  /** Absolute path of the file this instance reads (useful in logs and tests). */
  getFilePath() {
    return this.filePath;
  }
}

const featureFlagIniService = new FeatureFlagIniService();

module.exports = featureFlagIniService;
module.exports.FeatureFlagIniService = FeatureFlagIniService;
module.exports.DEFAULT_INI_FILENAME = DEFAULT_INI_FILENAME;
module.exports.DEFAULT_INI_PATH = DEFAULT_INI_PATH;
module.exports.MODES = { MODE_ENFORCE, MODE_SEED, MODE_OFF };
module.exports.SKIP_REASONS = {
  SKIP_REASON_TEST_ENV,
  SKIP_REASON_MISSING_FILE,
  SKIP_REASON_MODE_OFF,
  SKIP_REASON_NO_FLAGS,
  SKIP_REASON_UNREADABLE,
  SKIP_REASON_LOAD_FAILED,
};
module.exports.PROBLEM_KINDS = {
  PROBLEM_SYNTAX,
  PROBLEM_INVALID_VALUE,
  PROBLEM_DUPLICATE,
  PROBLEM_UNREADABLE,
  PROBLEM_UNKNOWN_FLAG,
  PROBLEM_UNKNOWN_SECTION,
  PROBLEM_UNKNOWN_SETTING,
  PROBLEM_MISPLACED_ENTRY,
};
