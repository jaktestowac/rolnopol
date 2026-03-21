import { describe, test, expect } from "vitest";
import fc from "fast-check";
const JSONDatabase = require("../../data/json-database");

describe("JSONDatabase property-based tests", () => {
  test("isRecordProtected returns true only when record.protected===true", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const expected = Boolean(input && typeof input === "object" && input.protected === true);
        expect(JSONDatabase.isRecordProtected(input)).toBe(expected);
      }),
    );
  });

  test("resolveWriteDebounceMs returns known values and is non-negative integer", () => {
    const originalEnv = process.env.JSON_DB_WRITE_DEBOUNCE_MS;
    try {
      // default for users.json and financial.json
      delete process.env.JSON_DB_WRITE_DEBOUNCE_MS;
      expect(JSONDatabase.resolveWriteDebounceMs("users.json")).toBe(1000);
      expect(JSONDatabase.resolveWriteDebounceMs("financial.json")).toBe(1000);
      expect(JSONDatabase.resolveWriteDebounceMs("other.json")).toBe(15);

      fc.assert(
        fc.property(fc.integer({ min: -1000, max: 1000 }), (value) => {
          process.env.JSON_DB_WRITE_DEBOUNCE_MS = String(value);
          const result = JSONDatabase.resolveWriteDebounceMs("anything.json");
          expect(result).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result)).toBe(true);
        }),
      );

      // non-numeric guard
      process.env.JSON_DB_WRITE_DEBOUNCE_MS = "abc";
      expect(JSONDatabase.resolveWriteDebounceMs("anything.json")).toBe(15);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.JSON_DB_WRITE_DEBOUNCE_MS;
      } else {
        process.env.JSON_DB_WRITE_DEBOUNCE_MS = originalEnv;
      }
    }
  });

  test("getAll returns a defensive copy and replaceAll reflects new data", async () => {
    const fs = require("fs/promises");
    const path = require("path");
    const tmpFile = path.join(__dirname, "tmp-jsondb-pbt-test.json");

    try {
      await fs.writeFile(tmpFile, JSON.stringify([]), "utf8");
      const db = new JSONDatabase(tmpFile, []);
      await db.initialize();

      const initial = await db.getAll();
      expect(initial).toEqual([]);

      initial.push({ id: 999, foo: "bar" });
      const afterFirstMutation = await db.getAll();
      expect(afterFirstMutation).toEqual([]);

      const newData = [{ id: 1, name: "x" }];
      await db.replaceAll(newData);
      const got = await db.getAll();
      expect(got).toEqual([{ id: 1, name: "x" }]);

      got.push({ id: 2, name: "y" });
      const second = await db.getAll();
      expect(second).toEqual([{ id: 1, name: "x" }]);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});
