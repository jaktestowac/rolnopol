import { describe, expect, it, vi } from "vitest";

const TwoFactorAuthDatabase = require("../../data/two-factor-auth-database");

function createDatabaseWithMock(mockDb) {
  const database = new TwoFactorAuthDatabase();
  database.db = mockDb;
  return database;
}

describe("TwoFactorAuthDatabase", () => {
  it("reads legacy array data as two-factor auth keys", async () => {
    const database = createDatabaseWithMock({
      getAll: vi.fn(async () => [
        {
          userId: 7,
          enabled: true,
          secret: "SECRET",
          pendingSecret: null,
          enabledAt: "2026-05-01T21:32:57.787Z",
          setupGeneratedAt: "2026-05-01T21:31:57.787Z",
          updatedAt: "2026-05-01T21:32:57.787Z",
        },
      ]),
    });

    const record = await database.findByUserId(7);

    expect(record).toEqual(
      expect.objectContaining({
        userId: 7,
        enabled: true,
        secret: "SECRET",
      }),
    );
  });

  it("writes records into object-shaped keys store", async () => {
    let persisted = null;
    const database = createDatabaseWithMock({
      getAll: vi.fn(async () => persisted || { version: 1, keys: [], updatedAt: null }),
      update: vi.fn(async (updater) => {
        persisted = updater({ version: 1, keys: [], updatedAt: null });
        return persisted;
      }),
    });

    const saved = await database.setRecordForUser(9, {
      enabled: false,
      secret: null,
      pendingSecret: "PENDING",
      enabledAt: null,
      setupGeneratedAt: "2026-05-01T21:31:57.787Z",
    });

    expect(persisted).toMatchObject({
      version: 1,
      keys: [
        expect.objectContaining({
          userId: 9,
          enabled: false,
          pendingSecret: "PENDING",
        }),
      ],
    });
    expect(typeof persisted.updatedAt).toBe("string");
    expect(saved).toEqual(expect.objectContaining({ userId: 9, pendingSecret: "PENDING" }));
  });

  it("deletes records from object-shaped keys store", async () => {
    let store = {
      version: 1,
      keys: [
        { userId: 1, enabled: true, secret: "SECRET", pendingSecret: null, updatedAt: "2026-05-01T00:00:00.000Z" },
        { userId: 2, enabled: false, secret: null, pendingSecret: null, updatedAt: "2026-05-01T00:00:00.000Z" },
      ],
      updatedAt: "2026-05-01T00:00:00.000Z",
    };

    const database = createDatabaseWithMock({
      getAll: vi.fn(async () => store),
      update: vi.fn(async (updater) => {
        store = updater(store);
        return store;
      }),
    });

    const removed = await database.deleteRecordByUserId(1);

    expect(removed).toBe(true);
    expect(store.keys).toHaveLength(1);
    expect(store.keys[0].userId).toBe(2);
  });
});
