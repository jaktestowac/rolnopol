import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";

const JSONDatabase = require("../../data/json-database");

const filePath = path.join(__dirname, "../../_tmp/json-db-concurrency.json");

describe("json-database concurrency", () => {
  let originalDebounceMs;

  beforeEach(async () => {
    originalDebounceMs = process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    process.env.JSON_DB_WRITE_DEBOUNCE_MS = "0";
    JSONDatabase.clearSemaphores();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8");
  });

  afterEach(() => {
    if (originalDebounceMs == null) {
      delete process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    } else {
      process.env.JSON_DB_WRITE_DEBOUNCE_MS = originalDebounceMs;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    JSONDatabase.clearSemaphores();
  });

  it("releases semaphore when persist fails", async () => {
    const db = new JSONDatabase(filePath, []);
    await db.initialize();

    const writeSpy = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);

    await expect(db.add({ name: "first" })).rejects.toThrow("Failed to persist database");

    expect(JSONDatabase.getSemaphoreStats().globalWriteSemaphore.count).toBe(0);

    await expect(db.add({ name: "second" })).resolves.toMatchObject({ name: "second" });
    writeSpy.mockRestore();
  });

  it("serializes concurrent add operations without data loss", async () => {
    const db = new JSONDatabase(filePath, []);
    await db.initialize();

    await Promise.all(Array.from({ length: 10 }, (_, i) => db.add({ name: `item-${i + 1}` })));

    const all = await db.getAll();
    expect(all).toHaveLength(10);
    expect(new Set(all.map((item) => item.id)).size).toBe(10);
  });

  it("coalesces burst writes into a single flush within debounce window", async () => {
    process.env.JSON_DB_WRITE_DEBOUNCE_MS = "1000";
    vi.useFakeTimers();

    const db = new JSONDatabase(filePath, []);
    await db.initialize();

    const writeSpy = vi.spyOn(fs, "writeFile");

    const pendingAdds = Promise.all([db.add({ name: "a" }), db.add({ name: "b" }), db.add({ name: "c" })]);

    await vi.advanceTimersByTimeAsync(1000);
    await pendingAdds;

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const all = await db.getAll();
    expect(all).toHaveLength(3);
  });
});
