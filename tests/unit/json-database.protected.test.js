import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs/promises";

// Use CommonJS require via dynamic import workaround for Vitest ESM
const JSONDatabase =
  (await import("../../../rolnopol-app-poc/data/json-database.js")).default ||
  (await import("../../../rolnopol-app-poc/data/json-database.js"));

// But our project uses CommonJS exports; provide a helper to require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSONDatabaseCJS = require("../../data/json-database");

const tmpFile = path.join(__dirname, "../../_tmp/protected-db.json");

async function resetFile(data) {
  await fs.mkdir(path.dirname(tmpFile), { recursive: true });
  await fs.writeFile(tmpFile, JSON.stringify(data ?? [], null, 2), "utf8");
}

describe("JSONDatabase protected flag", () => {
  it("prevents update/remove of protected records", async () => {
    await resetFile([
      { id: 1, name: "free" },
      { id: 2, name: "locked", protected: true },
    ]);

    const db = new JSONDatabaseCJS(tmpFile, []);
    await db.initialize();

    await expect(
      db.updateRecords(
        (r) => r.id === 2,
        (r) => ({ ...r, name: "changed" }),
      ),
    ).rejects.toHaveProperty("code", "READ_ONLY");

    await expect(db.remove((r) => r.id === 2)).rejects.toHaveProperty(
      "code",
      "READ_ONLY",
    );

    // Allowed: update non-protected
    await db.updateRecords(
      (r) => r.id === 1,
      (r) => ({ ...r, name: "ok" }),
    );
    const all = await db.getAll();
    expect(all.find((r) => r.id === 1).name).toBe("ok");
    expect(all.find((r) => r.id === 2).name).toBe("locked");
  });
});
