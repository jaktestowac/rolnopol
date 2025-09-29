import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import fs from "fs/promises";

// CommonJS require for project modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbManager = require("../../data/database-manager");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ResourceService = require("../../services/resource.service");

const dataDir = path.join(__dirname, "../../data");
const fieldsFile = path.join(dataDir, "fields.json");

async function writeFields(data) {
  await fs.writeFile(fieldsFile, JSON.stringify(data, null, 2), "utf8");
}

describe("ResourceService with protected records", () => {
  beforeEach(async () => {
    // reset db instances to ensure fresh read
    dbManager.clearAll();
  });

  it("update/delete should fail on protected field", async () => {
    await writeFields([
      { id: 1, userId: 1, name: "ok" },
      { id: 2, userId: 1, name: "no", protected: true },
    ]);

    const service = new ResourceService("fields");

    // Update attempt
    await expect(
      service.update(1, 2, { name: "changed" }),
    ).rejects.toHaveProperty("code", "READ_ONLY");

    // Delete attempt
    await expect(service.delete(1, 2)).rejects.toHaveProperty(
      "code",
      "READ_ONLY",
    );

    // Non-protected update works
    const updated = await service.update(1, 1, { name: "ok2" });
    expect(updated.name).toBe("ok2");
  });
});
