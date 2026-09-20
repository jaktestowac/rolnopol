import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

// Two guards against the way a broken data file used to take the whole app down.
//
// data/database-manager.js loaded the feature-flag defaults by require()-ing
// data/feature-flags.json — the live file. An empty or half-written file therefore threw a
// SyntaxError while the service was being constructed, so the app could not boot to repair
// the one file that was broken. Defaults now live in code.
const ROOT = path.join(__dirname, "..", "..");

const { PREDEFINED_FEATURE_FLAGS, FEATURE_FLAGS_DEFAULT_DATA } = require(path.join(ROOT, "data", "feature-flags.defaults.js"));
const featureFlagsService = require(path.join(ROOT, "services", "feature-flags.service.js"));
const {
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
} = require(path.join(ROOT, "build", "lib", "verify-data-files.js"));
const { report, resolveDirectory } = require(path.join(ROOT, "build", "verify-data-files.js"));

describe("data stores — defaults never come from the live file", () => {
  it("loads no data JSON at require time in the database manager", () => {
    // The regression, as source: a require() of a data file runs at module load and throws
    // on a broken file, before any recovery code can look at it.
    const source = fs.readFileSync(path.join(ROOT, "data", "database-manager.js"), "utf8");
    // Comments in that file explain why these requires are absent, so they have to go before
    // the scan or the explanation would fail the test it explains.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    const requires = [...code.matchAll(/require\(["'](\.\/[^"']+\.json)["']\)/g)].map((match) => match[1]);

    expect(requires, `database-manager.js requires ${requires.join(", ")}`).toEqual([]);
  });

  it("hands JSONDatabase a full set of flag defaults to restore from", () => {
    const databaseManager = require(path.join(ROOT, "data", "database-manager.js"));
    const db = databaseManager.getFeatureFlagsDatabase();

    expect(Object.keys(db.defaultData.flags).length).toBe(Object.keys(PREDEFINED_FEATURE_FLAGS).length);
    expect(db.defaultData.flags.survivalGameEnabled).toBe(PREDEFINED_FEATURE_FLAGS.survivalGameEnabled);
  });

  it("gives every flag default a boolean value", () => {
    for (const [flag, value] of Object.entries(PREDEFINED_FEATURE_FLAGS)) {
      expect(typeof value, flag).toBe("boolean");
    }

    expect(FEATURE_FLAGS_DEFAULT_DATA.flags).toEqual(PREDEFINED_FEATURE_FLAGS);
    expect(FEATURE_FLAGS_DEFAULT_DATA.updatedAt).toBeNull();
  });

  it("keeps the defaults module and the service's flag set in step", () => {
    // The service re-exports the same object, so a flag added in one place cannot go missing
    // from the file the app restores.
    expect(featureFlagsService.PREDEFINED_FEATURE_FLAGS).toEqual(PREDEFINED_FEATURE_FLAGS);
  });

  it("copies the defaults per database, so a caller cannot mutate the shipped values", () => {
    const databaseManager = require(path.join(ROOT, "data", "database-manager.js"));
    const db = databaseManager.getFeatureFlagsDatabase();

    expect(db.defaultData).not.toBe(FEATURE_FLAGS_DEFAULT_DATA);
    expect(db.defaultData.flags).not.toBe(PREDEFINED_FEATURE_FLAGS);
  });
});

describe("data stores — the integrity check", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-verify-data-"));
  });

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  const write = (name, content) => fsp.writeFile(path.join(tempRoot, name), content, "utf8");

  it("names an empty file, an unparseable one, and nothing else", async () => {
    await write("good.json", JSON.stringify({ ok: true }));
    await write("empty.json", "");
    await write("blank.json", "   \n  ");
    await write("half.json", '{"cut": tr');
    await write("notes.txt", "not a database");

    const results = verifyDataFiles(tempRoot);
    const byFile = Object.fromEntries(results.map((result) => [result.file, result.status]));

    expect(byFile).toEqual({
      "blank.json": "empty",
      "empty.json": "empty",
      "good.json": "ok",
      "half.json": "unparseable",
    });
    expect(results.filter(isBroken)).toHaveLength(3);
  });

  it("reports leftovers from an interrupted write or a repair", async () => {
    await write("store.json", JSON.stringify([]));
    await write("store.json.1234.1.tmp", "half a write");
    await write("store.json.corrupt.bak", "what went wrong");

    expect(findWriteLeftovers(tempRoot)).toEqual(["store.json.1234.1.tmp", "store.json.corrupt.bak"]);
    expect(verifyDataFiles(tempRoot).filter(isBroken)).toEqual([]);
  });

  it("says nothing about a directory that is not there", () => {
    expect(verifyDataFiles(path.join(tempRoot, "missing"))).toEqual([]);
    expect(findWriteLeftovers(path.join(tempRoot, "missing"))).toEqual([]);
  });

  it("finds every real data store readable", () => {
    // The check the npm script runs, against the repo's own data directory.
    const results = verifyDataFiles(path.join(ROOT, "data"));

    expect(results.length).toBeGreaterThan(20);
    expect(results.filter(isBroken).map((result) => `${result.file}: ${result.status}`)).toEqual([]);
  });
});

describe("data stores — what the report says about each store", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-report-data-"));
  });

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  const write = (name, content) => fsp.writeFile(path.join(tempRoot, name), content, "utf8");

  it("counts records in a list store and in the lists inside an object store", () => {
    expect(describeShape([1, 2, 3])).toMatchObject({ kind: "array", records: 3 });
    expect(describeShape({ offers: [1, 2], transactions: [3], counters: { last: 1 } })).toMatchObject({
      kind: "object",
      records: 3,
      keys: ["offers", "transactions", "counters"],
      nestedArrays: ["offers", "transactions"],
      counts: { offers: 2, transactions: 1 },
    });
    expect(describeShape("plain")).toMatchObject({ kind: "string", records: 0 });
    expect(describeShape(null)).toMatchObject({ kind: "null" });
  });

  it("names the lists and their lengths, because that is where the records are", () => {
    const contents = formatContents({
      status: "ok",
      shape: describeShape({ policies: [], requests: [{ id: 1 }], counters: {} }),
    });

    expect(contents).toBe("object {policies(0), requests(1), counters}");
  });

  it("trims a long key list rather than wrapping the line", () => {
    const shape = describeShape(Object.fromEntries("abcdefgh".split("").map((key) => [key, key])));

    expect(formatContents({ status: "ok", shape })).toBe("object {a, b, c, d, e, +3 more}");
  });

  it("says what is wrong in place of the contents, and quotes a broken file back", async () => {
    await write("empty.json", "");
    await write("half.json", '{"tokens": {"a": 1}, "cut');

    const [half, empty] = [
      verifyDataFiles(tempRoot).find((result) => result.file === "half.json"),
      verifyDataFiles(tempRoot).find((result) => result.file === "empty.json"),
    ];

    expect(formatContents(empty)).toBe("no content at all");
    expect(formatContents(half)).toMatch(/^not JSON: /);
    expect(half.preview).toBe('{"tokens": {"a": 1}, "cut');
  });

  it("collapses and truncates a long preview to one readable line", async () => {
    await write("long.json", `{\n  "a":\n  ${"x".repeat(200)}`);

    const result = verifyDataFiles(tempRoot).find((entry) => entry.file === "long.json");

    expect(result.preview).toHaveLength(61); // 60 characters plus the ellipsis
    expect(result.preview).not.toContain("\n");
    expect(result.preview.endsWith("…")).toBe(true);
  });

  it("totals the files, the bytes and the records", async () => {
    await write("a.json", JSON.stringify([1, 2, 3]));
    await write("b.json", JSON.stringify({ items: [1, 2] }));
    await write("broken.json", "");

    const summary = summarise(verifyDataFiles(tempRoot));

    expect(summary).toMatchObject({ files: 3, broken: 1, records: 5, byStatus: { ok: 2, empty: 1 } });
    expect(summary.bytes).toBeGreaterThan(0);
  });

  it("describes leftovers by what left them there", async () => {
    await write("store.json.4242.1.tmp", "half a write");
    await write("store.json.corrupt.bak", "what went wrong");

    expect(describeWriteLeftovers(tempRoot)).toEqual([
      expect.objectContaining({ file: "store.json.4242.1.tmp", bytes: 12, kind: "interrupted-write" }),
      expect.objectContaining({ file: "store.json.corrupt.bak", bytes: 15, kind: "kept-copy" }),
    ]);
  });

  it("formats sizes and ages the way a person reads them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");

    const now = 1_000_000_000_000;
    expect(formatAge(now - 5_000, now)).toBe("5s ago");
    expect(formatAge(now - 120_000, now)).toBe("2m ago");
    expect(formatAge(now - 7_200_000, now)).toBe("2h ago");
    expect(formatAge(now - 172_800_000, now)).toBe("2d ago");
    expect(formatAge(null, now)).toBe("unknown");
  });

  it("prints a line per store, then the totals", async () => {
    await write("animals.json", JSON.stringify([{ id: 1 }]));
    await write("feature-flags.json", "");

    const lines = [];
    const result = report({ directory: tempRoot, nowMs: Date.now(), log: (line) => lines.push(line), warn: (line) => lines.push(line) });

    const printed = lines.join("\n");
    expect(printed).toContain("Stores — 2 stores");
    expect(printed).toMatch(/✓\s+animals\.json\s+\d+ B\s+\d+s ago\s+array, 1 record/);
    expect(printed).toMatch(/✗\s+feature-flags\.json\s+0 B\s+\d+s ago\s+no content at all/);
    expect(printed).toContain("1 ok · 1 empty");
    expect(result.broken.map((entry) => entry.file)).toEqual(["feature-flags.json"]);
  });

  it("prints only the problems with --quiet", async () => {
    await write("animals.json", JSON.stringify([{ id: 1 }]));
    await write("feature-flags.json", "");

    const lines = [];
    report({ directory: tempRoot, quiet: true, log: (line) => lines.push(line), warn: (line) => lines.push(line) });

    const printed = lines.join("\n");
    expect(printed).toContain("feature-flags.json");
    expect(printed).not.toContain("animals.json");
    // The totals still cover every store, not just the ones printed.
    expect(printed).toContain("1 ok · 1 empty");
  });

  it("takes a directory from the command line, in either spelling", () => {
    // Without --dir the answer is null, which means "every directory the app keeps stores in"
    // rather than data/ alone.
    expect(resolveDirectory([])).toBeNull();
    expect(resolveDirectory(["--quiet"])).toBeNull();
    expect(resolveDirectory([`--dir=${tempRoot}`])).toBe(path.resolve(tempRoot));
    expect(resolveDirectory(["--dir", tempRoot])).toBe(path.resolve(tempRoot));
    expect(resolveDirectory(["--dir"])).toBeNull();
  });

  it("prints machine-readable output with --json", async () => {
    await write("animals.json", JSON.stringify([{ id: 1 }]));

    const lines = [];
    report({ directory: tempRoot, asJson: true, log: (line) => lines.push(line), warn: (line) => lines.push(line) });

    const payload = JSON.parse(lines.join("\n"));
    const [only] = payload.directories;

    expect(only.summary).toMatchObject({ files: 1, broken: 0, records: 1 });
    expect(only.results[0]).toMatchObject({ file: "animals.json", status: "ok" });
    expect(only.leftovers).toEqual([]);
    // A scoped run says nothing about the base state or the inventory of the whole app.
    expect(payload.baseState).toBeNull();
    expect(payload.inventory).toBeNull();
  });
});

describe("data stores — the check knows what the app expects", () => {
  // The scope used to be "the .json files sitting in data/", which missed two things the app
  // cares about: the stores the external services keep in their own data/ directories, and
  // database-base-state.json, which is not a store at all but the snapshot every test resets
  // from.
  it("covers data/ and every external service's own data directory", () => {
    const directories = findStoreDirectories(ROOT).map((directory) => path.relative(ROOT, directory).split(path.sep).join("/"));

    expect(directories[0]).toBe("data");
    expect(directories).toContain("external-services/farm-stay/inventory-service/data");
    expect(directories).toContain("external-services/agri-academy/exam-center-service/data");
    expect(directories.length).toBeGreaterThan(5);
  });

  it("skips node_modules when looking for data directories", () => {
    expect(findStoreDirectories(ROOT).some((directory) => directory.includes("node_modules"))).toBe(false);
  });

  it("finds the stores the code names, and says which module names each one", () => {
    const declared = declaredStores(ROOT);

    // Three different ways a store gets named, all of which have to be found.
    expect(declared.get("users.json")).toEqual({ declaredIn: "data/database-manager.js", via: "database" }); // getDatabase(...)
    expect(declared.get("inventory.json")).toMatchObject({
      declaredIn: "external-services/farm-stay/inventory-service/config.js", // path.join with a "data" segment
    });
    expect(declared.get("session-tokens.json")).toEqual({ declaredIn: "helpers/token.helpers.js", via: "path" }); // one literal path
    expect(declared.size).toBeGreaterThan(40);

    // How a store was found decides whether the test reset is expected to cover it: a
    // database yes, a read-only content file no.
    expect(declared.get("docs.json").via).toBe("path");
    expect(declared.get("crew-work.json").via).toBe("database");
  });

  it("names a store the app has not written yet instead of missing it", () => {
    const declared = declaredStores(ROOT);
    const present = findStoreDirectories(ROOT).flatMap((directory) => verifyDataFiles(directory).map((result) => result.file));
    const { notCreatedYet, notAStore } = reconcileStores(declared, present);

    // contacts.json is written the first time the contact form is used.
    expect(notCreatedYet.map((entry) => entry.file)).toContain("contacts.json");
    expect(notCreatedYet.find((entry) => entry.file === "contacts.json").declaredIn).toMatch(/contact/);

    // Every store that exists is accounted for, so this list stays short and meaningful.
    expect(notAStore.length).toBeLessThan(10);
  });

  it("reconciles a made-up pair of lists in both directions", () => {
    const declared = new Map([
      ["present.json", { declaredIn: "data/manager.js", via: "database" }],
      ["absent.json", { declaredIn: "services/thing.js", via: "database" }],
    ]);

    expect(reconcileStores(declared, ["present.json", "stranger.json"])).toEqual({
      notCreatedYet: [{ file: "absent.json", declaredIn: "services/thing.js", via: "database" }],
      notAStore: ["stranger.json"],
    });
  });
});

describe("data stores — the base state snapshot", () => {
  it("reads the resources the restore service resets, without opening a database", () => {
    const resources = restoredResources(ROOT);

    expect(resources).toContain("users");
    expect(resources).toContain("featureFlags");
    expect(resources).toContain("agriAcademyCertificates");
    expect(resources.length).toBeGreaterThan(30);
  });

  it("counts records inside one snapshot resource, whatever shape it has", () => {
    expect(countSnapshotRecords([1, 2, 3])).toBe(3);
    expect(countSnapshotRecords({ offers: [1, 2], counters: { last: 9 } })).toBe(2);
    expect(countSnapshotRecords(null)).toBe(0);
    expect(countSnapshotRecords("nope")).toBe(0);
  });

  it("reports the real snapshot as covering every resource the tests reset", () => {
    const baseState = inspectBaseState(ROOT);

    expect(baseState.present).toBe(true);
    expect(baseState.readOnly).toBe(true);
    expect(baseState.problems).toEqual([]);
    expect(baseState.missing).toEqual([]);
    expect(baseState.resources.length).toBe(baseState.expectedCount);
    expect(baseState.records).toBeGreaterThan(100);
  });

  it("fails when a resource the restore service resets is missing from the snapshot", async () => {
    // readBaseState() throws `Missing '<resource>' in base state snapshot` at restore time, so
    // the symptom is every test failing to reset. Saying it here is cheaper to read.
    const fakeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-base-state-"));

    try {
      await fsp.mkdir(path.join(fakeRoot, "data"), { recursive: true });
      await fsp.mkdir(path.join(fakeRoot, "services"), { recursive: true });
      await fsp.writeFile(
        path.join(fakeRoot, "services", "debug-database-restore.service.js"),
        [
          "const DATABASE_ACCESSORS = {",
          "  users: () => dbManager.getUsersDatabase(),",
          "  fields: () => dbManager.getFieldsDatabase(),",
          "};",
          "",
        ].join("\n"),
        "utf8",
      );
      await fsp.writeFile(
        path.join(fakeRoot, "data", BASE_STATE_FILE),
        JSON.stringify({ version: 2, readOnly: true, databases: { users: [{ id: 1 }] } }),
        "utf8",
      );

      const baseState = inspectBaseState(fakeRoot);

      expect(baseState.missing).toEqual(["fields"]);
      expect(baseState.problems).toHaveLength(1);
      expect(baseState.problems[0]).toContain('missing "fields"');
      expect(baseState.records).toBe(1);
    } finally {
      await fsp.rm(fakeRoot, { recursive: true, force: true });
    }
  });

  it("flags a snapshot database nothing restores, without failing on it", async () => {
    const fakeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-base-state-"));

    try {
      await fsp.mkdir(path.join(fakeRoot, "data"), { recursive: true });
      await fsp.mkdir(path.join(fakeRoot, "services"), { recursive: true });
      await fsp.writeFile(
        path.join(fakeRoot, "services", "debug-database-restore.service.js"),
        "const DATABASE_ACCESSORS = {\n  users: () => dbManager.getUsersDatabase(),\n};\n",
        "utf8",
      );
      await fsp.writeFile(
        path.join(fakeRoot, "data", BASE_STATE_FILE),
        JSON.stringify({ version: 1, databases: { users: [], leftovers: [] } }),
        "utf8",
      );

      const baseState = inspectBaseState(fakeRoot);

      expect(baseState.unused).toEqual(["leftovers"]);
      expect(baseState.problems).toEqual([]);
    } finally {
      await fsp.rm(fakeRoot, { recursive: true, force: true });
    }
  });

  it("says so when the snapshot itself cannot be read or has no databases", async () => {
    const fakeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-base-state-"));

    try {
      await fsp.mkdir(path.join(fakeRoot, "data"), { recursive: true });

      await fsp.writeFile(path.join(fakeRoot, "data", BASE_STATE_FILE), "{ half", "utf8");
      expect(inspectBaseState(fakeRoot).problems[0]).toMatch(/is not readable/);

      await fsp.writeFile(path.join(fakeRoot, "data", BASE_STATE_FILE), JSON.stringify({ version: 1 }), "utf8");
      expect(inspectBaseState(fakeRoot).problems[0]).toMatch(/no "databases" object/);

      await fsp.rm(path.join(fakeRoot, "data", BASE_STATE_FILE));
      expect(inspectBaseState(fakeRoot)).toEqual({ present: false, problems: [] });
    } finally {
      await fsp.rm(fakeRoot, { recursive: true, force: true });
    }
  });
});

describe("data stores — the report ties it together", () => {
  it("prints a section per directory, the base state, the inventory, and a total", () => {
    const lines = [];
    const result = report({ log: (line) => lines.push(line), warn: (line) => lines.push(line) });
    const printed = lines.join("\n");

    expect(printed).toContain("Main stores —");
    expect(printed).toContain("External service ·");
    expect(printed).toContain(`Base state — data/${BASE_STATE_FILE}`);
    expect(printed).toMatch(/covers all \d+ databases the restore service resets/);
    expect(printed).toContain("Inventory —");
    expect(printed).toMatch(/Total — \d+ stores across \d+ directories/);

    expect(result.broken).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.totals.files).toBeGreaterThan(40);
  });

  it("checks one directory only when given --dir, with no base state or inventory", async () => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-scoped-"));

    try {
      await fsp.writeFile(path.join(tempRoot, "store.json"), JSON.stringify([1, 2]), "utf8");

      const lines = [];
      const result = report({ directory: tempRoot, log: (line) => lines.push(line), warn: (line) => lines.push(line) });
      const printed = lines.join("\n");

      expect(printed).toContain("Stores — 1 store");
      expect(printed).not.toContain("Base state");
      expect(printed).not.toContain("Inventory");
      expect(result.problems).toEqual([]);
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("carries the base state and the inventory in the JSON output", () => {
    const lines = [];
    report({ asJson: true, log: (line) => lines.push(line), warn: (line) => lines.push(line) });

    const payload = JSON.parse(lines.join("\n"));

    expect(payload.directories[0].directory).toBe("data");
    expect(payload.directories.length).toBeGreaterThan(5);
    expect(payload.baseState).toMatchObject({ present: true, problems: [] });
    expect(payload.inventory.notCreatedYet.map((entry) => entry.file)).toContain("contacts.json");
  });
});

describe("data stores — is the base state still up to date", () => {
  /** A miniature repo: a restore table, a database manager, a snapshot, and two stores. */
  async function buildFakeRepo({ snapshot, tasks, extra = {} }) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "rolnopol-freshness-"));

    await fsp.mkdir(path.join(root, "data"), { recursive: true });
    await fsp.mkdir(path.join(root, "services"), { recursive: true });

    await fsp.writeFile(
      path.join(root, "data", "database-manager.js"),
      [
        "class DatabaseManager {",
        "  getUsersDatabase() {",
        '    return this.getDatabase("users", "users.json", []);',
        "  }",
        "",
        "  getTasksDatabase() {",
        '    return this.getDatabase("tasks", "tasks.json", {});',
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.writeFile(
      path.join(root, "services", "debug-database-restore.service.js"),
      [
        "const DATABASE_ACCESSORS = {",
        "  users: () => dbManager.getUsersDatabase(),",
        "  tasks: () => dbManager.getTasksDatabase(),",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.writeFile(path.join(root, "data", BASE_STATE_FILE), JSON.stringify(snapshot), "utf8");
    await fsp.writeFile(path.join(root, "data", "users.json"), JSON.stringify([{ id: 1 }]), "utf8");
    await fsp.writeFile(path.join(root, "data", "tasks.json"), JSON.stringify(tasks), "utf8");

    for (const [name, contents] of Object.entries(extra)) {
      await fsp.writeFile(path.join(root, "data", name), JSON.stringify(contents), "utf8");
    }

    return root;
  }

  const snapshotOf = (tasks) => ({ version: 1, readOnly: true, databases: { users: [], tasks } });

  it("resolves every restored resource to the file it actually is", () => {
    const managerFiles = databaseManagerFiles(ROOT);
    expect(managerFiles.getUsersDatabase).toBe("users.json");
    expect(managerFiles.getFeatureFlagsDatabase).toBe("feature-flags.json");

    const resourceFiles = restoredResourceFiles(ROOT);

    // Three kinds of accessor: a manager getter, an inline custom database, and an external
    // service whose file name lives in its own module.
    expect(resourceFiles.users).toBe("users.json");
    expect(resourceFiles.fdAchievements).toBe("fd-achievements.json");
    expect(resourceFiles.greenhouse).toBe("greenhouse.json");
    expect(resourceFiles.farmStayInventory).toBe("inventory.json");

    // Every one of them resolves, or the freshness comparison would quietly skip some.
    expect(Object.values(resourceFiles).filter(Boolean)).toHaveLength(Object.keys(resourceFiles).length);
  });

  it("reports the real snapshot as matching every store it resets", () => {
    const baseState = inspectBaseState(ROOT);

    expect(baseState.drift).toEqual([]);
    expect(baseState.comparedCount).toBe(baseState.expectedCount);
    expect(baseState.problems).toEqual([]);
  });

  it("describes a shape as its kind plus its keys", () => {
    expect(shapeSignature([1, 2])).toEqual({ kind: "array", keys: [] });
    expect(shapeSignature({ b: 1, a: 2 })).toEqual({ kind: "object", keys: ["a", "b"] });
    expect(shapeSignature(null)).toEqual({ kind: "null", keys: [] });
    expect(shapeSignature(7)).toEqual({ kind: "number", keys: [] });
  });

  it("says nothing when the snapshot and the stores agree", async () => {
    const tasks = { version: 1, tasks: [], counters: {} };
    const root = await buildFakeRepo({ snapshot: snapshotOf(tasks), tasks });

    try {
      const baseState = inspectBaseState(root);

      expect(baseState.drift).toEqual([]);
      expect(baseState.comparedCount).toBe(2);
      expect(baseState.problems).toEqual([]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("names the section a store grew and the snapshot did not, without failing", async () => {
    // The way this file actually goes stale: a store gains a section, the snapshot keeps
    // resetting tests to the old shape. A key can also appear on a store's first write, so
    // this is reported rather than treated as broken.
    const root = await buildFakeRepo({
      snapshot: snapshotOf({ version: 1, tasks: [] }),
      tasks: { version: 1, tasks: [], labels: [], counters: {} },
    });

    try {
      const baseState = inspectBaseState(root);

      expect(baseState.drift).toEqual([
        expect.objectContaining({
          resource: "tasks",
          file: "tasks.json",
          severity: "differs",
          onlyInLive: ["counters", "labels"],
          onlyInSnapshot: [],
        }),
      ]);
      expect(baseState.drift[0].detail).toContain("the store has counters, labels");
      expect(baseState.problems).toEqual([]); // reported, not fatal
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("names a key the snapshot still carries that the store has dropped", async () => {
    const root = await buildFakeRepo({
      snapshot: snapshotOf({ version: 1, tasks: [], retired: [] }),
      tasks: { version: 1, tasks: [] },
    });

    try {
      const [entry] = inspectBaseState(root).drift;

      expect(entry).toMatchObject({ resource: "tasks", severity: "differs", onlyInSnapshot: ["retired"], onlyInLive: [] });
      expect(entry.detail).toContain("the snapshot has retired");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the snapshot holds a different kind of thing than the store", async () => {
    // A list where an object belongs cannot come from a runtime write; the snapshot is stale.
    const root = await buildFakeRepo({
      snapshot: snapshotOf({ version: 1, tasks: [] }),
      tasks: [{ id: 1 }],
    });

    try {
      const baseState = inspectBaseState(root);

      expect(baseState.drift[0]).toMatchObject({ resource: "tasks", severity: "broken" });
      expect(baseState.drift[0].detail).toBe("snapshot holds object, the store holds array");
      expect(baseState.problems).toHaveLength(1);
      expect(baseState.problems[0]).toContain('is stale for "tasks"');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("skips a store it cannot read, leaving that to the store report", async () => {
    const root = await buildFakeRepo({ snapshot: snapshotOf({ version: 1 }), tasks: { version: 1 } });

    try {
      await fsp.writeFile(path.join(root, "data", "tasks.json"), "", "utf8");

      const { drift } = compareBaseStateToStores(root, { users: [], tasks: { version: 1 } });
      expect(drift).toEqual([]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("lists the databases the reset does not cover, and only databases", () => {
    const notReset = storesNotReset(ROOT, restoredResourceFiles(ROOT)).map((entry) => entry.file);

    // The crew pillars and survival keep their own state between tests.
    expect(notReset).toContain("crew-work.json");
    expect(notReset).toContain("survival-sessions.json");

    // Read-only content and files written outside a JSON database are not expected in the
    // snapshot, so they are not reported as gaps.
    expect(notReset).not.toContain("docs.json");
    expect(notReset).not.toContain("fields-map.json");
    expect(notReset).not.toContain("session-tokens.json");
    expect(notReset).not.toContain(BASE_STATE_FILE);
  });

  it("prints the coverage, the freshness and the gaps", () => {
    const lines = [];
    report({ log: (line) => lines.push(line), warn: (line) => lines.push(line) });
    const printed = lines.join("\n");

    expect(printed).toMatch(/version \d+ · created \d{4}-\d{2}-\d{2}/);
    expect(printed).toMatch(/covers all \d+ databases the restore service resets/);
    expect(printed).toMatch(/up to date: the shape of all \d+ matches the stores on disk/);
    expect(printed).toMatch(/store\(s\) the reset does not cover/);
  });
});
