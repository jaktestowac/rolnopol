/**
 * Integrity check for the JSON databases in data/.
 *
 * Writes go through a temp file and a rename (data/json-database.js), so a truncated or
 * half-written file should be impossible. This is the check that says so out loud: run it
 * after a test run, in CI, or when the app starts behaving as though a store went missing.
 *
 * It reports rather than repairs, because the fix depends on the file. Committed stores come
 * back with `git checkout HEAD -- data/<file>.json`, and anything the app owns is rebuilt
 * from its defaults on the next boot once the broken file is removed.
 */
const fs = require("fs");
const path = require("path");

/** Files that are not databases and are allowed to look like anything. */
const IGNORED = new Set(["package.json", "package-lock.json"]);

/** How much of a broken file to quote back, so the damage is recognisable. */
const PREVIEW_LENGTH = 60;

/** Describe the parsed contents, so the report says what each store actually holds. */
function describeShape(value) {
  if (Array.isArray(value)) {
    return { kind: "array", records: value.length, keys: [] };
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    // One level down: most stores wrap their records in a single key, and the length of that
    // list is the number worth seeing.
    const nestedArrays = keys.filter((key) => Array.isArray(value[key]));
    const counts = Object.fromEntries(nestedArrays.map((key) => [key, value[key].length]));
    const records = nestedArrays.reduce((total, key) => total + value[key].length, 0);

    return { kind: "object", keys, records, nestedArrays, counts };
  }

  return { kind: value === null ? "null" : typeof value, records: 0, keys: [] };
}

/** The first line of a file, collapsed, for quoting a broken one back to the reader. */
function previewOf(raw) {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_LENGTH ? `${collapsed.slice(0, PREVIEW_LENGTH)}…` : collapsed;
}

/**
 * @returns {{
 *   file: string,
 *   status: "ok" | "empty" | "unparseable" | "unreadable",
 *   bytes: number,
 *   mtimeMs: number | null,
 *   detail?: string,
 *   preview?: string,
 *   shape?: { kind: string, records: number, keys: string[], nestedArrays?: string[] },
 * }[]}
 */
function verifyDataFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || IGNORED.has(entry.name)) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    let raw;
    let mtimeMs = null;

    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      results.push({ file: entry.name, status: "unreadable", detail: error.message, bytes: 0, mtimeMs });
      continue;
    }

    if (raw.trim() === "") {
      results.push({ file: entry.name, status: "empty", bytes: raw.length, mtimeMs });
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      results.push({ file: entry.name, status: "ok", bytes: raw.length, mtimeMs, shape: describeShape(parsed) });
    } catch (error) {
      results.push({
        file: entry.name,
        status: "unparseable",
        detail: error.message,
        preview: previewOf(raw),
        bytes: raw.length,
        mtimeMs,
      });
    }
  }

  return results;
}

/** Leftover temp files mean a write was interrupted; the target itself is still intact. */
function findWriteLeftovers(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".tmp") || name.endsWith(".corrupt.bak"))
    .sort();
}

/** The same leftovers, with the size and age that say whether one is still being written. */
function describeWriteLeftovers(directory) {
  return findWriteLeftovers(directory).map((name) => {
    try {
      const stats = fs.statSync(path.join(directory, name));
      return { file: name, bytes: stats.size, mtimeMs: stats.mtimeMs, kind: name.endsWith(".tmp") ? "interrupted-write" : "kept-copy" };
    } catch {
      return { file: name, bytes: 0, mtimeMs: null, kind: name.endsWith(".tmp") ? "interrupted-write" : "kept-copy" };
    }
  });
}

// ---------------------------------------------------------------------------
// what the app expects to be there
// ---------------------------------------------------------------------------

/** Directories that hold JSON stores: data/, plus every external service's own data/. */
function findStoreDirectories(root) {
  const directories = [];
  const dataDir = path.join(root, "data");
  if (fs.existsSync(dataDir)) {
    directories.push(dataDir);
  }

  const externalRoot = path.join(root, "external-services");
  if (!fs.existsSync(externalRoot)) {
    return directories;
  }

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;

      const child = path.join(directory, entry.name);
      if (entry.name === "data") {
        directories.push(child);
        continue;
      }
      walk(child);
    }
  };

  walk(externalRoot);
  return directories;
}

/**
 * The stores the code opens, found by scanning the modules that construct one. A store that
 * is declared but absent has simply not been written yet; a file on disk that no module opens
 * is static content, or is written by something other than a JSON database.
 */
function declaredStores(
  root,
  searchDirs = ["data", "services", "modules", "controllers", "helpers", "routes", "api", "external-services"],
) {
  const declared = new Map();

  const remember = (name, filePath, via) => {
    const declaredIn = path.relative(root, filePath).split(path.sep).join("/");

    // "database" wins over "path": a file both opened as a database and named in a path is a
    // database, and only databases are expected to be reset between tests.
    const existing = declared.get(name);
    if (!existing) {
      declared.set(name, { declaredIn, via });
    } else if (existing.via === "path" && via === "database") {
      declared.set(name, { declaredIn, via });
    }
  };

  const collectFrom = (filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const opensDatabase = /JSONDatabase|getCustomDatabase\(|getDatabase\(/.test(source);

    const via = opensDatabase ? "database" : "path";

    // A file that opens a database: every .json name in it is a store.
    if (opensDatabase) {
      for (const match of source.matchAll(/["']([a-z0-9][a-z0-9._-]*\.json)["']/gi)) {
        remember(match[1], filePath, "database");
      }
    }

    // A path built into a data directory is a store too, even when the module that names it
    // opens nothing itself. The external services keep their file names in a config module.
    for (const call of source.matchAll(/path\.(?:join|resolve)\(([^)]*)\)/g)) {
      if (!/["']data["']/.test(call[1])) continue;

      for (const match of call[1].matchAll(/["']([a-z0-9][a-z0-9._-]*\.json)["']/gi)) {
        remember(match[1], filePath, via);
      }
    }

    // And a path written as one literal, which path.join never sees as segments.
    for (const match of source.matchAll(/["'](?:[^"']*\/)?data\/([a-z0-9][a-z0-9._-]*\.json)["']/gi)) {
      remember(match[1], filePath, via);
    }
  };

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name.endsWith(".js")) {
        collectFrom(child);
      }
    }
  };

  for (const dir of searchDirs) {
    const absolute = path.join(root, dir);
    if (fs.existsSync(absolute)) {
      walk(absolute);
    }
  }

  return declared;
}

/** Declared but not on disk, and on disk but not declared. Neither is a failure by itself. */
function reconcileStores(declared, presentFiles) {
  const present = new Set(presentFiles);

  return {
    notCreatedYet: [...declared.entries()]
      .filter(([name]) => !present.has(name))
      .map(([name, entry]) => ({ file: name, declaredIn: entry.declaredIn, via: entry.via }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    notAStore: presentFiles.filter((name) => !declared.has(name)).sort(),
  };
}

// ---------------------------------------------------------------------------
// the base state snapshot
// ---------------------------------------------------------------------------

const BASE_STATE_FILE = "database-base-state.json";
const RESTORE_SERVICE = path.join("services", "debug-database-restore.service.js");

/**
 * The resources `restoreAllDatabasesFromBaseState` puts back, read from the accessor table
 * rather than by calling it: the accessors open databases and load external services, which
 * is far more than a check should do.
 */
function restoredResources(root) {
  const servicePath = path.join(root, RESTORE_SERVICE);
  if (!fs.existsSync(servicePath)) {
    return [];
  }

  const source = fs.readFileSync(servicePath, "utf8");
  const table = source.match(/const DATABASE_ACCESSORS\s*=\s*\{([\s\S]*?)\n\};/);
  if (!table) {
    return [];
  }

  return [...table[1].matchAll(/^\s{2}(\w+):\s*\(\)\s*=>/gm)].map((match) => match[1]);
}

/** Records inside one resource of the snapshot, which is a store's whole contents. */
function countSnapshotRecords(resource) {
  if (Array.isArray(resource)) return resource.length;
  if (resource === null || typeof resource !== "object") return 0;

  return Object.values(resource).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
}

/** Every `getXDatabase()` in the database manager, mapped to the file it opens. */
function databaseManagerFiles(root) {
  const managerPath = path.join(root, "data", "database-manager.js");
  if (!fs.existsSync(managerPath)) {
    return {};
  }

  const source = fs.readFileSync(managerPath, "utf8");
  const files = {};

  for (const getter of source.matchAll(/(get\w+Database)\(\)\s*\{([\s\S]*?)\n {2}\}/g)) {
    const file = getter[2].match(/get(?:Custom)?Database\(\s*["'][^"']+["']\s*,\s*["']([^"']+\.json)["']/);
    if (file) {
      files[getter[1]] = file[1];
    }
  }

  return files;
}

/** The data file behind an external service's `db` module, named in its own config. */
function externalServiceFile(root, requirePath) {
  const candidates = [`${requirePath}.js`, path.join(requirePath, "index.js")];

  for (const candidate of candidates) {
    const absolute = path.resolve(path.join(root, "services"), candidate);
    if (!fs.existsSync(absolute)) continue;

    const source = fs.readFileSync(absolute, "utf8");
    for (const call of source.matchAll(/path\.(?:join|resolve)\(([^)]*)\)/g)) {
      const match = call[1].match(/["']([a-z0-9][a-z0-9._-]*\.json)["']/i);
      if (match && /["']data["']/.test(call[1])) {
        return match[1];
      }
    }

    // The file name may live in a config module the db module requires.
    const configRequire = source.match(/require\(["'](\.[^"']*config)["']\)/);
    if (configRequire) {
      const configPath = path.resolve(path.dirname(absolute), `${configRequire[1]}.js`);
      if (fs.existsSync(configPath)) {
        const configSource = fs.readFileSync(configPath, "utf8");
        for (const call of configSource.matchAll(/path\.(?:join|resolve)\(([^)]*)\)/g)) {
          const match = call[1].match(/["']([a-z0-9][a-z0-9._-]*\.json)["']/i);
          if (match && /["']data["']/.test(call[1])) {
            return match[1];
          }
        }
      }
    }
  }

  return null;
}

/**
 * Which file each resource in the restore table actually is. Read statically: calling the
 * accessors would open every database and load every external service.
 */
function restoredResourceFiles(root) {
  const servicePath = path.join(root, RESTORE_SERVICE);
  if (!fs.existsSync(servicePath)) {
    return {};
  }

  const source = fs.readFileSync(servicePath, "utf8");
  const table = source.match(/const DATABASE_ACCESSORS\s*=\s*\{([\s\S]*?)\n\};/);
  if (!table) {
    return {};
  }

  const managerFiles = databaseManagerFiles(root);
  const resources = {};

  for (const line of table[1].split("\n")) {
    const key = line.match(/^\s{2}(\w+):/);
    if (!key) continue;

    const custom = line.match(/getCustomDatabase\(\s*["'][^"']+["']\s*,\s*["']([^"']+\.json)["']/);
    const getter = line.match(/dbManager\.(get\w+Database)\(\)/);
    const external = line.match(/require\(["']([^"']+)["']\)/);

    resources[key[1]] =
      (custom && custom[1]) || (getter && managerFiles[getter[1]]) || (external && externalServiceFile(root, external[1])) || null;
  }

  return resources;
}

/** The store's shape as a comparable value: a key list for an object, or its kind. */
function shapeSignature(value) {
  if (Array.isArray(value)) return { kind: "array", keys: [] };
  if (value !== null && typeof value === "object") return { kind: "object", keys: Object.keys(value).sort() };
  return { kind: value === null ? "null" : typeof value, keys: [] };
}

/**
 * Whether the snapshot still looks like the stores it resets.
 *
 * A store that gains a section and a snapshot that does not is the way this file goes stale:
 * tests reset to a shape the code no longer writes. A kind mismatch (a list where an object
 * belongs) cannot happen by accident and is treated as broken; differing keys are reported
 * without failing, because a store may add a key on first write.
 */
function compareBaseStateToStores(root, snapshotDatabases) {
  const resourceFiles = restoredResourceFiles(root);
  const directories = findStoreDirectories(root);
  const drift = [];

  for (const [resource, file] of Object.entries(resourceFiles)) {
    if (!file || !(resource in snapshotDatabases)) continue;

    const location = directories.map((directory) => path.join(directory, file)).find((candidate) => fs.existsSync(candidate));
    if (!location) continue;

    let live;
    try {
      live = JSON.parse(fs.readFileSync(location, "utf8"));
    } catch {
      continue; // The store itself is broken, which the store report already says.
    }

    const snapshotShape = shapeSignature(snapshotDatabases[resource]);
    const liveShape = shapeSignature(live);

    if (snapshotShape.kind !== liveShape.kind) {
      drift.push({
        resource,
        file,
        severity: "broken",
        detail: `snapshot holds ${snapshotShape.kind}, the store holds ${liveShape.kind}`,
      });
      continue;
    }

    const onlyInLive = liveShape.keys.filter((key) => !snapshotShape.keys.includes(key));
    const onlyInSnapshot = snapshotShape.keys.filter((key) => !liveShape.keys.includes(key));

    if (onlyInLive.length > 0 || onlyInSnapshot.length > 0) {
      drift.push({
        resource,
        file,
        severity: "differs",
        onlyInLive,
        onlyInSnapshot,
        detail: [
          onlyInLive.length > 0 ? `the store has ${onlyInLive.join(", ")}` : null,
          onlyInSnapshot.length > 0 ? `the snapshot has ${onlyInSnapshot.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
      });
    }
  }

  return { resourceFiles, drift };
}

/**
 * Stores the reset does not cover. Only databases count: read-only content (docs, the map)
 * and files written outside a JSON database are not expected in the snapshot.
 */
function storesNotReset(root, resourceFiles) {
  const covered = new Set(Object.values(resourceFiles).filter(Boolean));
  const declared = declaredStores(root);
  const notReset = [];

  for (const directory of findStoreDirectories(root)) {
    for (const result of verifyDataFiles(directory)) {
      if (result.file === BASE_STATE_FILE || covered.has(result.file)) continue;

      const entry = declared.get(result.file);
      if (!entry || entry.via !== "database") continue;

      notReset.push({ file: result.file, declaredIn: entry.declaredIn });
    }
  }

  return notReset.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The snapshot every test resets from. It is not a store, and checking it as one says
 * "0 records" about a file that seeds 34 databases. A resource missing from it makes
 * `readBaseState()` throw, which surfaces as every test failing to reset rather than as
 * anything about this file, so it is worth failing the check here instead.
 */
function inspectBaseState(root) {
  const filePath = path.join(root, "data", BASE_STATE_FILE);

  if (!fs.existsSync(filePath)) {
    return { present: false, problems: [] };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { present: true, problems: [`${BASE_STATE_FILE} is not readable: ${error.message}`] };
  }

  if (!snapshot || typeof snapshot !== "object" || !snapshot.databases || typeof snapshot.databases !== "object") {
    return { present: true, problems: [`${BASE_STATE_FILE} has no "databases" object, so no test can reset from it`] };
  }

  const resources = Object.keys(snapshot.databases);
  const expected = restoredResources(root);
  const missing = expected.filter((resource) => !resources.includes(resource));
  const unused = resources.filter((resource) => expected.length > 0 && !expected.includes(resource));
  const { resourceFiles, drift } = compareBaseStateToStores(root, snapshot.databases);
  const notReset = storesNotReset(root, resourceFiles);

  return {
    present: true,
    version: snapshot.version ?? null,
    createdAt: snapshot.createdAt ?? null,
    readOnly: snapshot.readOnly === true,
    resources,
    records: resources.reduce((total, resource) => total + countSnapshotRecords(snapshot.databases[resource]), 0),
    expectedCount: expected.length,
    comparedCount: Object.values(resourceFiles).filter(Boolean).length,
    missing,
    unused,
    drift,
    notReset,
    problems: [
      ...missing.map(
        (resource) => `${BASE_STATE_FILE} is missing "${resource}", which the restore service resets — every test reset would throw`,
      ),
      ...drift
        .filter((entry) => entry.severity === "broken")
        .map((entry) => `${BASE_STATE_FILE} is stale for "${entry.resource}" (${entry.file}): ${entry.detail}`),
    ],
  };
}

const isBroken = (result) => result.status !== "ok";

/** Counts per status plus the totals, for the summary line. */
function summarise(results) {
  const byStatus = { ok: 0, empty: 0, unparseable: 0, unreadable: 0 };

  for (const result of results) {
    byStatus[result.status] = (byStatus[result.status] || 0) + 1;
  }

  return {
    files: results.length,
    broken: results.filter(isBroken).length,
    bytes: results.reduce((total, result) => total + result.bytes, 0),
    records: results.reduce((total, result) => total + (result.shape?.records || 0), 0),
    byStatus,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "12s ago" reads better than a timestamp when you are looking for what a test just wrote. */
function formatAge(mtimeMs, nowMs) {
  if (!Number.isFinite(mtimeMs)) return "unknown";

  const seconds = Math.max(0, Math.round((nowMs - mtimeMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** One line per store: what it holds, how big it is, when it was last written. */
function formatContents(result) {
  if (result.status === "empty") return "no content at all";
  if (result.status === "unreadable") return result.detail || "could not be read";
  if (result.status === "unparseable") return `not JSON: ${result.detail}`;

  const shape = result.shape;
  if (shape.kind === "array") {
    return `array, ${shape.records} ${shape.records === 1 ? "record" : "records"}`;
  }
  if (shape.kind === "object") {
    // A key holding a list is annotated with how long that list is, because for most stores
    // that number is the answer to "is my data still in there".
    const labelled = shape.keys.map((key) => (shape.counts?.[key] === undefined ? key : `${key}(${shape.counts[key]})`));
    const keys = labelled.length > 5 ? `${labelled.slice(0, 5).join(", ")}, +${labelled.length - 5} more` : labelled.join(", ");

    return `object {${keys}}`;
  }

  return `${shape.kind} value`;
}

module.exports = {
  verifyDataFiles,
  findWriteLeftovers,
  describeWriteLeftovers,
  isBroken,
  summarise,
  describeShape,
  formatBytes,
  formatAge,
  formatContents,
  findStoreDirectories,
  declaredStores,
  reconcileStores,
  restoredResources,
  restoredResourceFiles,
  databaseManagerFiles,
  compareBaseStateToStores,
  storesNotReset,
  shapeSignature,
  countSnapshotRecords,
  inspectBaseState,
  BASE_STATE_FILE,
};
