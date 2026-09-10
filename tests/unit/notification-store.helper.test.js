import { describe, it, expect, vi, afterEach } from "vitest";

// The read-side wrapper over the notification store (helpers/notification-store.js).
//
// One function, and every one of its lines is a defence against a shape the store
// might hold: a missing `notifications` array, an entry with no `createdAt`, a
// `createdAt` that does not parse. Each of those becomes a thrown TypeError or a
// silently-dropped notification if the guard goes, and the caller is a polling
// endpoint, so the symptom would be a notification bell that quietly stops ringing.
//
// The underlying database is reached through `dbManager`, which caches instances by
// name — so the test spies on the SAME instance the helper will build, and no
// notification is ever written. That matters: `notifications-store.json` is not part
// of `database-base-state.json`, so a write here would outlive the test.
const dbManager = require("../../data/database-manager");
const { getRecentNotifications } = require("../../helpers/notification-store");

const DEFAULT_DATA = { notifications: [], metadata: {} };
const storeDb = dbManager.getCustomDatabase("notification-notifications", "notifications-store.json", DEFAULT_DATA);

/** Make the store appear to hold exactly `data`, without touching disk. */
const withStoreData = (data) => vi.spyOn(storeDb, "getAll").mockResolvedValue(data);

const at = (iso, overrides = {}) => ({ id: `notif-${iso}`, createdAt: iso, ...overrides });
const ms = (iso) => new Date(iso).getTime();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notification-store helper — filtering by `since`", () => {
  const notifications = [at("2026-08-01T00:00:00.000Z"), at("2026-08-15T12:00:00.000Z"), at("2026-08-27T09:30:00.000Z")];

  it("returns everything at or after the cutoff", async () => {
    withStoreData({ notifications });

    const result = await getRecentNotifications({ since: ms("2026-08-15T00:00:00.000Z") });

    expect(result.map((row) => row.createdAt)).toEqual(["2026-08-15T12:00:00.000Z", "2026-08-27T09:30:00.000Z"]);
  });

  it("includes an entry created exactly at the cutoff — the boundary is inclusive", async () => {
    const exact = "2026-08-15T12:00:00.000Z";
    withStoreData({ notifications });

    const result = await getRecentNotifications({ since: ms(exact) });

    expect(result.map((row) => row.createdAt)).toContain(exact);
  });

  it("returns everything for a cutoff of zero", async () => {
    withStoreData({ notifications });

    expect(await getRecentNotifications({ since: 0 })).toHaveLength(3);
  });

  it("returns nothing for a cutoff in the future", async () => {
    withStoreData({ notifications });

    expect(await getRecentNotifications({ since: ms("2030-01-01T00:00:00.000Z") })).toEqual([]);
  });

  it("preserves the store's order rather than re-sorting", async () => {
    const shuffled = [at("2026-08-27T00:00:00.000Z"), at("2026-08-01T00:00:00.000Z"), at("2026-08-15T00:00:00.000Z")];
    withStoreData({ notifications: shuffled });

    const result = await getRecentNotifications({ since: 0 });

    expect(result.map((row) => row.createdAt)).toEqual(shuffled.map((row) => row.createdAt));
  });

  it("returns the store's own objects, not copies", async () => {
    withStoreData({ notifications });

    const [first] = await getRecentNotifications({ since: 0 });

    expect(first).toBe(notifications[0]);
  });
});

describe("notification-store helper — entries the store might hold", () => {
  it("treats an entry with no createdAt as timestamp zero, so it survives only a zero cutoff", async () => {
    const undated = { id: "notif-undated" };
    withStoreData({ notifications: [undated] });

    expect(await getRecentNotifications({ since: 0 })).toEqual([undated]);
    expect(await getRecentNotifications({ since: 1 })).toEqual([]);
  });

  it("drops an entry whose createdAt does not parse rather than throwing", async () => {
    withStoreData({ notifications: [{ id: "bad", createdAt: "not-a-date" }, at("2026-08-27T00:00:00.000Z")] });

    const result = await getRecentNotifications({ since: 1 });

    // NaN >= since is false, so the unparseable row is excluded, not fatal.
    expect(result.map((row) => row.id)).toEqual(["notif-2026-08-27T00:00:00.000Z"]);
  });

  it("accepts a numeric createdAt as well as an ISO string", async () => {
    const epochMs = ms("2026-08-27T00:00:00.000Z");
    withStoreData({ notifications: [{ id: "numeric", createdAt: epochMs }] });

    expect(await getRecentNotifications({ since: epochMs })).toHaveLength(1);
    expect(await getRecentNotifications({ since: epochMs + 1 })).toHaveLength(0);
  });

  it("keeps every field of a matching entry", async () => {
    const rich = at("2026-08-27T00:00:00.000Z", {
      userId: 4,
      title: "Field ready",
      channels: ["in-app"],
      metadata: { fieldId: 9 },
    });
    withStoreData({ notifications: [rich] });

    expect(await getRecentNotifications({ since: 0 })).toEqual([rich]);
  });
});

describe("notification-store helper — shapes the store might come back as", () => {
  it("returns an empty array when the store holds no notifications key", async () => {
    withStoreData({ metadata: {} });

    expect(await getRecentNotifications({ since: 0 })).toEqual([]);
  });

  it("returns an empty array when notifications is not an array", async () => {
    for (const notifications of [null, undefined, "none", 42, { 0: "a" }]) {
      withStoreData({ notifications });
      expect(await getRecentNotifications({ since: 0 })).toEqual([]);
    }
  });

  it("returns an empty array when the store resolves to null or undefined", async () => {
    for (const data of [null, undefined]) {
      withStoreData(data);
      expect(await getRecentNotifications({ since: 0 })).toEqual([]);
    }
  });

  it("returns an empty array for an empty store", async () => {
    withStoreData(DEFAULT_DATA);

    expect(await getRecentNotifications({ since: 0 })).toEqual([]);
  });
});

describe("notification-store helper — it reads and never writes", () => {
  it("reads the store exactly once per call", async () => {
    const spy = withStoreData({ notifications: [] });

    await getRecentNotifications({ since: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never calls update — this is the read side", async () => {
    withStoreData({ notifications: [at("2026-08-27T00:00:00.000Z")] });
    const update = vi.spyOn(storeDb, "update");

    await getRecentNotifications({ since: 0 });

    expect(update).not.toHaveBeenCalled();
  });

  it("reaches the same cached database instance the notification centre uses", async () => {
    // If dbManager ever stopped caching by name, the helper would open a second
    // handle on the same file — and this test's spy would stop being observed,
    // which is exactly the signal wanted.
    const again = dbManager.getCustomDatabase("notification-notifications", "notifications-store.json", DEFAULT_DATA);

    expect(again).toBe(storeDb);
  });
});
