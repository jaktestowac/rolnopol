import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("fs");
const service = require("../../services/debug-database-restore.service.js");

describe("debug-database-restore.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when base snapshot shape is invalid", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("{}");

    await expect(service.restoreAllDatabasesFromBaseState()).rejects.toThrow("Invalid base state snapshot format");
  });

  it("throws when required database key is missing in snapshot", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        version: 1,
        databases: {
          // users key intentionally missing
          fields: [],
          staff: [],
          animals: [],
          assignments: [],
          financial: { accounts: [], counters: { lastAccountId: 0, lastTransactionId: 0 } },
          marketplace: { offers: [], transactions: [], counters: { lastOfferId: 0, lastTransactionId: 0 } },
          featureFlags: { flags: {}, updatedAt: null },
          chaosEngine: { mode: "off", customConfig: {}, updatedAt: null },
          commodities: { holdings: [], metadata: { version: 1, updatedAt: null } },
          messages: { messages: [] },
        },
      }),
    );

    await expect(service.restoreAllDatabasesFromBaseState()).rejects.toThrow("Missing 'users' in base state snapshot");
  });
});
