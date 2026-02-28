import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";

const JSONDatabase = require("../../data/json-database");

const filePath = path.join(__dirname, "../../_tmp/json-db-concurrency.json");

describe("json-database concurrency", () => {
  beforeEach(async () => {
    JSONDatabase.clearSemaphores();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8");
  });

  afterEach(() => {
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
});
