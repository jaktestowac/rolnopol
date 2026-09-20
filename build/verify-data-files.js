#!/usr/bin/env node
/**
 * Reports the state of every JSON store the app keeps: what it holds, how big it is, when it
 * was last written, and whether it can be read at all.
 *
 *   npm run data:check                    every store, one line each
 *   npm run data:check -- --quiet         only the problems and the summaries
 *   npm run data:check -- --json          the same data as JSON, for a script or CI
 *   npm run data:check -- --dir <path>    check one directory instead of all of them
 *
 * Scope comes from the app rather than from a list kept here:
 *
 *   - data/, plus every external service's own data/ (agri-academy, farm-stay), because the
 *     base state resets those alongside the main stores.
 *   - the stores the code actually opens, so one that has not been created yet is named
 *     rather than silently absent, and a JSON file no database opens is not counted as one.
 *   - data/database-base-state.json is inspected as the snapshot it is rather than as a
 *     store: it seeds 34 databases, and a resource missing from it makes every test's reset
 *     throw inside readBaseState(). It is also compared against the stores it resets, so a
 *     store that grew a section and a snapshot that did not are reported rather than left to
 *     surface as tests resetting to a shape the code no longer writes.
 *
 * Exits 1 when a store cannot be read, or when the base state could not seed a reset.
 */
const path = require("path");
const {
  verifyDataFiles,
  describeWriteLeftovers,
  isBroken,
  summarise,
  formatBytes,
  formatAge,
  formatContents,
  findStoreDirectories,
  declaredStores,
  reconcileStores,
  inspectBaseState,
  BASE_STATE_FILE,
} = require("./lib/verify-data-files");

const ROOT = path.resolve(__dirname, "..");

const RECOVERY_HINT = [
  "",
  "How to recover:",
  "  committed store   git checkout HEAD -- data/<file>.json",
  "  app-owned store   delete it; the next boot rebuilds it from its defaults",
  "  base state        git checkout HEAD -- data/database-base-state.json",
  "  leftover .tmp     safe to delete once no process is writing",
  "  .corrupt.bak      the unreadable content, kept for inspection",
].join("\n");

const relative = (target) => path.relative(ROOT, target).split(path.sep).join("/") || ".";

function statusMark(status) {
  return status === "ok" ? "✓" : "✗";
}

/** One directory of stores: the table, its totals, and any leftovers beside them. */
function reportDirectory(directory, options) {
  const { quiet, nowMs, log, warn, heading } = options;

  const results = verifyDataFiles(directory);
  const leftovers = describeWriteLeftovers(directory);
  const summary = summarise(results);
  const broken = results.filter(isBroken);

  log("");
  log(`${heading} — ${summary.files} ${summary.files === 1 ? "store" : "stores"} in ${relative(directory)}/`);
  log("");

  const shown = quiet ? broken : results;

  if (shown.length > 0) {
    const nameWidth = Math.max(4, ...shown.map((result) => result.file.length));
    const sizeWidth = Math.max(4, ...shown.map((result) => formatBytes(result.bytes).length));
    // Everything before the contents column, so a second line about the same file lines up
    // underneath it instead of floating.
    const contentsIndent = " ".repeat(2 + 1 + 2 + nameWidth + 2 + sizeWidth + 2 + 9 + 2);

    for (const result of shown) {
      const line = [
        `  ${statusMark(result.status)}`,
        result.file.padEnd(nameWidth),
        formatBytes(result.bytes).padStart(sizeWidth),
        formatAge(result.mtimeMs, nowMs).padStart(9),
        formatContents(result),
      ].join("  ");

      if (isBroken(result)) {
        warn(line);
        if (result.preview) {
          warn(`${contentsIndent}starts with: ${result.preview}`);
        }
      } else {
        log(line);
      }
    }

    log("");
  } else if (quiet) {
    log("  (nothing broken here)");
    log("");
  }

  const counts = Object.entries(summary.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`)
    .join(" · ");
  log(`  ${counts} · ${formatBytes(summary.bytes)} on disk · ${summary.records} records`);

  if (leftovers.length > 0) {
    log("");
    const leftoverWidth = Math.max(4, ...leftovers.map((leftover) => leftover.file.length));

    for (const leftover of leftovers) {
      warn(
        [
          "  !",
          leftover.file.padEnd(leftoverWidth),
          formatBytes(leftover.bytes).padStart(8),
          formatAge(leftover.mtimeMs, nowMs).padStart(9),
          leftover.kind === "interrupted-write" ? "left by an interrupted write" : "content kept from a repaired file",
        ].join("  "),
      );
    }
  }

  return { directory, results, leftovers, summary, broken };
}

/** The snapshot tests reset from, checked against what the restore service asks it for. */
function reportBaseState(options) {
  const { log, warn, root } = options;
  const baseState = inspectBaseState(root);

  if (!baseState.present) {
    log("");
    warn(`Base state — data/${BASE_STATE_FILE} is not there, so no test can reset the databases`);
    return baseState;
  }

  log("");
  log(`Base state — data/${BASE_STATE_FILE}`);
  log("");

  const created = baseState.createdAt ? String(baseState.createdAt).slice(0, 10) : "unknown date";

  log(
    `  ·  version ${baseState.version} · created ${created} · ${baseState.resources.length} databases · ` +
      `${baseState.records} records${baseState.readOnly ? " · read-only" : ""}`,
  );

  // Coverage: does it hold every resource the restore service puts back?
  if (baseState.missing.length === 0) {
    log(`  ✓  covers all ${baseState.expectedCount} databases the restore service resets`);
  } else {
    for (const resource of baseState.missing) {
      warn(`  ✗  no "${resource}" in the snapshot — readBaseState() throws, so every test reset fails`);
    }
  }

  // Freshness: does it still look like the stores it resets?
  const drift = baseState.drift || [];
  if (drift.length === 0) {
    log(`  ✓  up to date: the shape of all ${baseState.comparedCount} matches the stores on disk`);
  } else {
    for (const entry of drift) {
      const line = `${entry.resource} (${entry.file}): ${entry.detail}`;
      if (entry.severity === "broken") {
        warn(`  ✗  stale — ${line}`);
      } else {
        warn(`  !  shape differs — ${line}`);
      }
    }
    if (drift.every((entry) => entry.severity !== "broken")) {
      log("     (a store may add a key on its first write, so this is a prompt to look, not a failure)");
    }
  }

  if (baseState.unused && baseState.unused.length > 0) {
    log(`  !  ${baseState.unused.length} snapshot database(s) nothing restores: ${baseState.unused.join(", ")}`);
  }

  const notReset = baseState.notReset || [];
  if (notReset.length > 0) {
    log(`  ·  ${notReset.length} store(s) the reset does not cover: ${notReset.map((entry) => entry.file).join(", ")}`);
    log("     (those modules keep their own state between tests)");
  }

  return baseState;
}

/** Stores the code opens but that are not on disk, and files on disk that are not stores. */
function reportInventory(directories, options) {
  const { log, root } = options;
  const declared = declaredStores(root);
  const present = directories.flatMap((directory) => verifyDataFiles(directory).map((result) => result.file));
  const { notCreatedYet, notAStore } = reconcileStores(declared, present);

  log("");
  log(`Inventory — ${declared.size} stores named in code`);
  log("");

  if (notCreatedYet.length === 0) {
    log("  ✓  every store the code names exists on disk");
  } else {
    for (const entry of notCreatedYet) {
      log(`  ·  ${entry.file} not created yet — ${entry.declaredIn} writes it on first use`);
    }
  }

  if (notAStore.length > 0) {
    log(`  ·  ${notAStore.length} file(s) on disk that no module names: ${notAStore.join(", ")}`);
    log("     (orphaned content, or written by something outside this repo)");
  }

  return { declared: declared.size, notCreatedYet, notAStore };
}

function report(options = {}) {
  const {
    quiet = false,
    asJson = false,
    nowMs = Date.now(),
    directory = null,
    log = console.log,
    warn = console.warn,
    root = ROOT,
  } = options;

  const scoped = Boolean(directory);
  const directories = scoped ? [path.resolve(directory)] : findStoreDirectories(root);

  if (asJson) {
    const perDirectory = directories.map((target) => {
      const results = verifyDataFiles(target);
      return {
        directory: relative(target),
        summary: summarise(results),
        results,
        leftovers: describeWriteLeftovers(target),
      };
    });

    const payload = {
      directories: perDirectory,
      baseState: scoped ? null : inspectBaseState(root),
      inventory: scoped
        ? null
        : reconcileStores(
            declaredStores(root),
            perDirectory.flatMap((entry) => entry.results.map((result) => result.file)),
          ),
    };

    log(JSON.stringify(payload, null, 2));

    return {
      broken: perDirectory.flatMap((entry) => entry.results.filter(isBroken)),
      problems: payload.baseState?.problems || [],
      directories: perDirectory,
    };
  }

  const reports = directories.map((target, index) =>
    reportDirectory(target, {
      quiet,
      nowMs,
      log,
      warn,
      heading: scoped ? "Stores" : index === 0 ? "Main stores" : `External service · ${relative(path.dirname(target))}`,
    }),
  );

  const baseState = scoped ? { problems: [] } : reportBaseState({ log, warn, root });
  const inventory = scoped ? null : reportInventory(directories, { log, root });

  const broken = reports.flatMap((entry) => entry.broken);
  const problems = baseState.problems || [];
  const totals = reports.reduce(
    (accumulator, entry) => ({
      files: accumulator.files + entry.summary.files,
      bytes: accumulator.bytes + entry.summary.bytes,
      records: accumulator.records + entry.summary.records,
    }),
    { files: 0, bytes: 0, records: 0 },
  );

  log("");
  log(
    `Total — ${totals.files} stores across ${directories.length} ${directories.length === 1 ? "directory" : "directories"} · ` +
      `${formatBytes(totals.bytes)} · ${totals.records} records · ${broken.length} unreadable`,
  );

  return { broken, problems, reports, baseState, inventory, totals };
}

/** `--dir <path>` or `--dir=<path>`, for checking one directory, a copy, or a backup. */
function resolveDirectory(argv) {
  const inline = argv.find((argument) => argument.startsWith("--dir="));
  if (inline) {
    return path.resolve(inline.slice("--dir=".length));
  }

  const flagIndex = argv.indexOf("--dir");
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    return path.resolve(argv[flagIndex + 1]);
  }

  return null;
}

function main(argv = process.argv.slice(2)) {
  const quiet = argv.includes("--quiet");
  const asJson = argv.includes("--json");
  const directory = resolveDirectory(argv);

  const { broken, problems } = report({ quiet, asJson, directory });

  if (broken.length === 0 && problems.length === 0) {
    process.exit(0);
  }

  if (!asJson) {
    if (broken.length > 0) {
      console.error(`\n${broken.length} store(s) cannot be read: ${broken.map((result) => result.file).join(", ")}`);
    }
    for (const problem of problems) {
      console.error(`\n${problem}`);
    }
    console.error(RECOVERY_HINT);
  }

  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { main, report, resolveDirectory };
