import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const app = require("../api/index.js");
const dbManager = require("../data/database-manager");

const ACCESSORS = {
  users: () => dbManager.getUsersDatabase(),
  fields: () => dbManager.getFieldsDatabase(),
  staff: () => dbManager.getStaffDatabase(),
  animals: () => dbManager.getAnimalsDatabase(),
  assignments: () => dbManager.getAssignmentsDatabase(),
  financial: () => dbManager.getFinancialDatabase(),
  marketplace: () => dbManager.getMarketplaceDatabase(),
  featureFlags: () => dbManager.getFeatureFlagsDatabase(),
  chaosEngine: () => dbManager.getChaosEngineDatabase(),
  commodities: () => dbManager.getCommoditiesDatabase(),
  messages: () => dbManager.getMessagesDatabase(),
  blogs: () => dbManager.getBlogsDatabase(),
  posts: () => dbManager.getPostsDatabase(),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readAllDatabases() {
  const result = {};
  for (const [name, getDb] of Object.entries(ACCESSORS)) {
    const db = getDb();
    result[name] = clone(await db.getAll());
  }
  return result;
}

describe("Debug database restore API", () => {
  beforeAll(async () => {
    // Ensure deterministic baseline before running assertions.
    await request(app).post("/api/debug/database/restore-base").expect(200);
  });

  it("POST /api/debug/database/restore-base is available without admin auth", async () => {
    const res = await request(app).post("/api/debug/database/restore-base").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("baseStateVersion");
    expect(res.body.data).toHaveProperty("restored");
    expect(res.body.data.restored).toHaveProperty("users");
    expect(res.body.data.restored).toHaveProperty("marketplace");

    const restoredKeys = Object.keys(res.body.data.restored || {}).sort();
    expect(restoredKeys).toEqual([
      "animals",
      "assignments",
      "blogs",
      "chaosEngine",
      "commodities",
      "featureFlags",
      "fields",
      "financial",
      "marketplace",
      "messages",
      "posts",
      "staff",
      "users",
    ]);
  });

  it("restores all managed databases to immutable base snapshot", async () => {
    const baseline = await readAllDatabases();

    await ACCESSORS.users().replaceAll([]);
    await ACCESSORS.fields().replaceAll([]);
    await ACCESSORS.staff().replaceAll([]);
    await ACCESSORS.animals().replaceAll([]);
    await ACCESSORS.assignments().replaceAll([]);
    await ACCESSORS.financial().replaceAll({ accounts: [], counters: { lastAccountId: 0, lastTransactionId: 0 } });
    await ACCESSORS.marketplace().replaceAll({ offers: [], transactions: [], counters: { lastOfferId: 0, lastTransactionId: 0 } });
    await ACCESSORS.featureFlags().replaceAll({ flags: { temporaryFlag: true }, updatedAt: new Date().toISOString() });
    await ACCESSORS.chaosEngine().replaceAll({ mode: "level5", customConfig: { enabled: false }, updatedAt: new Date().toISOString() });
    await ACCESSORS.commodities().replaceAll({
      holdings: [{ userId: 1, symbol: "WHEAT", quantity: 1, totalInvested: 10 }],
      metadata: { version: 1, updatedAt: new Date().toISOString() },
    });
    await ACCESSORS.messages().replaceAll({
      messages: [{ id: 1, fromUserId: 1, toUserId: 2, content: "temp", createdAt: new Date().toISOString() }],
    });
    await ACCESSORS.blogs().replaceAll([
      {
        id: 99,
        userId: "temp",
        title: "temp",
        slug: "temp",
        visibility: "public",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
      },
    ]);
    await ACCESSORS.posts().replaceAll([
      {
        id: 99,
        userId: "temp",
        blogId: 99,
        title: "temp",
        slug: "temp",
        content: "temp",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
      },
    ]);

    await request(app).post("/api/debug/database/restore-base").expect(200);

    const restored = await readAllDatabases();
    expect(restored).toEqual(baseline);
  });

  it("is idempotent when called repeatedly", async () => {
    const stateAfterFirstRestore = await readAllDatabases();

    const first = await request(app).post("/api/debug/database/restore-base").expect(200);
    const second = await request(app).post("/api/debug/database/restore-base").expect(200);

    expect(second.body.success).toBe(true);
    expect(second.body.data.restored).toEqual(first.body.data.restored);

    const stateAfterSecondRestore = await readAllDatabases();
    expect(stateAfterSecondRestore).toEqual(stateAfterFirstRestore);
  });
});
