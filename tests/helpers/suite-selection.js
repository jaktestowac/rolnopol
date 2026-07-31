/**
 * Shared checks for the focused `<module>:test` scripts.
 *
 * Those scripts used to name every test file explicitly. They are now two lines
 * each — a vitest project plus a path filter:
 *
 *   vitest run --project unit <filter>
 *   vitest run --project integration --project property <filter>
 *
 * Far easier to read, and it fixes a bug the enumerations actually had: they went
 * stale. `academy:test` was missing SEVEN unit files, one of which
 * (`agri-academy.leaderboard.test.js`) had been failing for some time with nobody
 * noticing, because the only script that would have run it did not list it.
 *
 * A filter cannot go stale that way, but it can under-select: a test whose PATH
 * does not contain the filter is silently skipped. It would still run under
 * `npm test`, so it is not invisible — but §14.6 says a module regression is only
 * believed once reproduced through its focused script, and a test outside that
 * script quietly undermines the protocol.
 *
 * So these helpers re-establish the guarantee by a different route, turning the
 * naming convention from a habit into a checked property.
 */
const fs = require("fs");
const path = require("path");

const TESTS_DIR = path.join(__dirname, "..");

/** Every `*.test.js` under tests/, as forward-slashed paths relative to tests/. */
function testFiles(dir = TESTS_DIR, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...testFiles(path.join(dir, entry.name), relative));
    } else if (entry.name.endsWith(".test.js")) {
      found.push(relative);
    }
  }
  return found;
}

/**
 * Which test files a `vitest run … <filter>` would select.
 *
 * Vitest matches positional filters against the file path, so this is a substring
 * test on the same string vitest sees.
 */
function selectedBy(filter, files = testFiles()) {
  return files.filter((file) => file.toLowerCase().includes(filter.toLowerCase()));
}

/**
 * Test files that reach into a module's own source.
 *
 * A best-effort signal, and worth being honest about its limits: it catches a test
 * that requires the module directly, which is how the in-process modules (crew) are
 * exercised. A test that only dials a standalone service over HTTP requires nothing
 * module-specific and will not be found — for those, `strandedFrom` below is the
 * check that still bites.
 *
 * @param {RegExp} sourcePattern - matched against each file's contents
 */
function filesTouching(sourcePattern, files = testFiles()) {
  return files.filter((file) => sourcePattern.test(fs.readFileSync(path.join(TESTS_DIR, file), "utf8")));
}

/**
 * Files that match a filter but belong to no vitest project, so NEITHER stage runs
 * them.
 *
 * The projects are directory-shaped (see `vitest.config.ts`): `unit/` is the unit
 * project, `property/*.pbt.test.js` is property, and everything at the top level is
 * integration. A file in `tests/e2e/` would match a filter and be run by nothing.
 */
function strandedFrom(filter, files = testFiles()) {
  return selectedBy(filter, files).filter((file) => {
    if (file.startsWith("unit/")) return false;
    if (file.startsWith("property/") && file.endsWith(".pbt.test.js")) return false;
    if (!file.includes("/")) return false; // top level ⇒ integration
    return true;
  });
}

/**
 * The stages of a `<module>:test` script, split on `&&`.
 *
 * Asserted rather than assumed because the two-stage shape is the point: unit
 * first, so a broken pure function reports in seconds instead of after the whole
 * integration run. Collapsing to one `vitest run <filter>` would be shorter and
 * would lose that.
 */
function stagesOf(scriptName) {
  // eslint-disable-next-line global-require
  const script = require("../../package.json").scripts[scriptName];
  if (!script) throw new Error(`No such npm script: ${scriptName}`);
  return script.split("&&").map((stage) => stage.trim());
}

/**
 * Assert a module's focused script is well-formed and selects everything.
 *
 * Kept here rather than duplicated per module so a third module joining the pattern
 * is one small test file, not a copy of this reasoning.
 *
 * @param {object} options
 * @param {object} options.expect - vitest's expect, passed in so this stays a plain helper
 * @param {string} options.script - npm script name, e.g. "crew:test"
 * @param {string} options.filter - the path filter both stages pass to vitest
 * @param {RegExp} [options.sourcePattern] - how to spot a test of this module by content
 * @param {number} [options.minFiles] - sanity floor, so a broken walk cannot pass vacuously
 */
function assertSuiteSelection({ expect, script, filter, sourcePattern, minFiles = 1 }) {
  const files = testFiles();

  // Without this, a bug in the directory walk would turn every check below into a
  // green tick over an empty list.
  expect(files.length).toBeGreaterThan(50);
  expect(selectedBy(filter, files).length).toBeGreaterThanOrEqual(minFiles);

  if (sourcePattern) {
    const missed = filesTouching(sourcePattern, files).filter((file) => !selectedBy(filter, files).includes(file));
    // A failure names the file to rename: put the filter string in its path, or the
    // focused script will not run it.
    expect(missed).toEqual([]);
  }

  expect(strandedFrom(filter, files)).toEqual([]);

  const stages = stagesOf(script);
  expect(stages).toHaveLength(2);
  expect(stages[0]).toContain("--project unit");
  expect(stages[1]).toContain("--project integration");
  expect(stages[1]).toContain("--project property");
  for (const stage of stages) {
    expect(stage).toContain("NODE_ENV=test");
    expect(stage.endsWith(` ${filter}`)).toBe(true);
  }
}

module.exports = { TESTS_DIR, testFiles, selectedBy, filesTouching, strandedFrom, stagesOf, assertSuiteSelection };
