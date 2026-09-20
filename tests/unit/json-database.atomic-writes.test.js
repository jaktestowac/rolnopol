import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";

// The safety net around the JSON stores in data/.
//
// A truncated store is the failure this file exists for: `fs.writeFile` opens the target
// with O_TRUNC, so between the open and the write the file on disk is 0 bytes. A process
// that dies in that window, or a second process writing the same path (the in-process
// semaphore cannot see one), leaves the file empty for good. It happened to
// data/feature-flags.json during a parallel test run, and the app then would not boot at all
// because the defaults were loaded by require()-ing that same file.
//
// Writes now land on a temp file and are renamed over the target, which is atomic: a reader
// sees the old file or the new one, never nothing.
const JSONDatabase = require("../../data/json-database");

describe("json-database atomic writes", () => {
  let tempRoot;
  let filePath;
  let originalDebounceMs;

  beforeEach(async () => {
    originalDebounceMs = process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    process.env.JSON_DB_WRITE_DEBOUNCE_MS = "0";
    JSONDatabase.clearSemaphores();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rolnopol-atomic-writes-"));
    filePath = path.join(tempRoot, "store.json");
  });

  afterEach(async () => {
    if (originalDebounceMs == null) {
      delete process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    } else {
      process.env.JSON_DB_WRITE_DEBOUNCE_MS = originalDebounceMs;
    }
    vi.restoreAllMocks();
    JSONDatabase.clearSemaphores();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const read = () => fs.readFile(filePath, "utf8");
  const listDir = () => fs.readdir(tempRoot);

  it("refuses to write nothing, whatever it is handed", async () => {
    await fs.writeFile(filePath, JSON.stringify([{ keep: true }]), "utf8");

    for (const content of ["", "   \n", null, undefined, 42, {}]) {
      await expect(JSONDatabase.writeFileWithRetry(filePath, content)).rejects.toThrow(/Refusing to write empty content/);
    }

    // The file that was already there is untouched.
    expect(JSON.parse(await read())).toEqual([{ keep: true }]);
  });

  it("leaves no temp file behind on a successful write", async () => {
    await JSONDatabase.writeFileWithRetry(filePath, JSON.stringify({ ok: true }));

    expect(JSON.parse(await read())).toEqual({ ok: true });
    expect(await listDir()).toEqual(["store.json"]);
  });

  it("never truncates the target: the old content survives a failing write", async () => {
    await fs.writeFile(filePath, JSON.stringify({ generation: 1 }), "utf8");

    // Every rename fails, which is the worst case for a write. The target must be untouched
    // rather than emptied, and no temp file may be left lying around.
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("nope"), { code: "EPERM" }));

    await expect(JSONDatabase.writeFileWithRetry(filePath, JSON.stringify({ generation: 2 }), { attempts: 2 })).rejects.toThrow("nope");

    renameSpy.mockRestore();

    expect(JSON.parse(await read())).toEqual({ generation: 1 });
    expect(await listDir()).toEqual(["store.json"]);
  });

  it("keeps the file parseable through a burst of concurrent writes", async () => {
    await fs.writeFile(filePath, JSON.stringify({ generation: 0 }), "utf8");

    const payloads = Array.from({ length: 25 }, (unused, index) => JSON.stringify({ generation: index + 1 }, null, 2));

    // Interleaved with reads, so a truncation window would be caught rather than assumed away.
    const reads = [];
    const writes = payloads.map(async (payload) => {
      await JSONDatabase.writeFileWithRetry(filePath, payload);
      reads.push(await read());
    });

    await Promise.all(writes);

    for (const snapshot of [...reads, await read()]) {
      expect(snapshot.trim()).not.toBe("");
      expect(() => JSON.parse(snapshot)).not.toThrow();
    }

    expect(await listDir()).toEqual(["store.json"]);
  });

  it("persists through the database and stays valid", async () => {
    const db = new JSONDatabase(filePath, []);
    await db.initialize();

    await db.add({ name: "first" });
    await db.add({ name: "second" });

    expect(JSON.parse(await read())).toHaveLength(2);
    expect(await listDir()).toEqual(["store.json"]);
  });
});

describe("json-database recovery from a broken file", () => {
  let tempRoot;
  let filePath;

  beforeEach(async () => {
    process.env.JSON_DB_WRITE_DEBOUNCE_MS = "0";
    JSONDatabase.clearSemaphores();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rolnopol-recovery-"));
    filePath = path.join(tempRoot, "store.json");
  });

  afterEach(async () => {
    delete process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    JSONDatabase.clearSemaphores();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("restores defaults when the file on disk is empty", async () => {
    await fs.writeFile(filePath, "", "utf8");

    const db = new JSONDatabase(filePath, [{ seeded: true }]);
    await db.initialize();

    expect(await db.getAll()).toEqual([{ seeded: true }]);
    expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual([{ seeded: true }]);

    // Nothing to preserve from an empty file, so no copy is kept.
    expect(await fs.readdir(tempRoot)).toEqual(["store.json"]);
  });

  it("restores defaults when the file is not JSON, and keeps the unreadable content", async () => {
    await fs.writeFile(filePath, '{"half-written": tr', "utf8");

    const db = new JSONDatabase(filePath, { records: [] });
    await db.initialize();

    expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({ records: [] });

    // The bad content is evidence, so restoring defaults over it does not lose it.
    expect(await fs.readFile(`${filePath}.corrupt.bak`, "utf8")).toBe('{"half-written": tr');
  });
});
