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
  personalApiKeys: () => dbManager.getPersonalApiKeysDatabase(),
  userAvatars: () => dbManager.getUserAvatarsDatabase(),
  twoFactorAuth: () => dbManager.getTwoFactorAuthDatabase(),
  webhooks: () => dbManager.getWebhooksDatabase(),
  webhookDeliveries: () => dbManager.getWebhookDeliveriesDatabase(),
  blogs: () => dbManager.getBlogsDatabase(),
  posts: () => dbManager.getPostsDatabase(),
  pets: () => dbManager.getPetsDatabase(),
  tasks: () => dbManager.getTasksDatabase(),
  notificationEvents: () => dbManager.getCustomDatabase("notification-events", "events-store.json", {
    events: [],
    metadata: { lastEventId: null, total: 0, lastUpdated: null },
  }),
  notificationStore: () => dbManager.getCustomDatabase("notification-notifications", "notifications-store.json", {
    notifications: [],
    metadata: { lastNotificationId: null, total: 0, lastUpdated: null },
  }),
  fdAchievements: () => dbManager.getCustomDatabase("fd-achievements", "fd-achievements.json", {
    version: 1,
    players: {},
    updatedAt: null,
  }),
  greenhouse: () => require("../external-services/greenhouse/greenhouse-server/db").db,
  tasklab: () => require("../external-services/tasklab/tasklab-server/db").db,
  farmStayInventory: () => require("../external-services/farm-stay/inventory-service/server/db").db,
  farmStayReservations: () => require("../external-services/farm-stay/reservation-service/server/db").db,
  farmStayReviews: () => require("../external-services/farm-stay/review-desk-service/server/db").db,
  agriAcademyAuthoring: () => require("../external-services/agri-academy/authoring-service/server/db").db,
  agriAcademyExamCenter: () => require("../external-services/agri-academy/exam-center-service/server/db").db,
  agriAcademyQuestionBank: () => require("../external-services/agri-academy/question-bank-service/server/db").db,
  agriAcademyCertificates: () => require("../external-services/agri-academy/certificate-issuer-service/server/db").db,
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
      "agriAcademyAuthoring",
      "agriAcademyCertificates",
      "agriAcademyExamCenter",
      "agriAcademyQuestionBank",
      "animals",
      "assignments",
      "blogs",
      "chaosEngine",
      "commodities",
      "farmStayInventory",
      "farmStayReservations",
      "farmStayReviews",
      "farmlogFavorites",
      "farmlogPostLikes",
      "fdAchievements",
      "featureFlags",
      "fields",
      "financial",
      "greenhouse",
      "marketplace",
      "messages",
      "notificationEvents",
      "notificationStore",
      "personalApiKeys",
      "pets",
      "posts",
      "staff",
      "tasklab",
      "tasks",
      "twoFactorAuth",
      "userAvatars",
      "users",
      "webhookDeliveries",
      "webhooks",
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
    await ACCESSORS.personalApiKeys().replaceAll({
      version: 1,
      keys: [{ id: 1, userId: 1, keyPreview: "temp", scopes: ["user-account"], createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    });
    await ACCESSORS.userAvatars().replaceAll({
      version: 1,
      avatars: [{ userId: 1, avatarDataUrl: "data:image/png;base64,temp", avatarUpdatedAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    });
    await ACCESSORS.webhooks().replaceAll({
      version: 1,
      webhooks: [
        {
          id: 1,
          userId: 1,
          name: "temp",
          url: "https://example.test/webhook",
          eventTypes: ["field.created"],
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastTriggeredAt: null,
          lastDeliveredAt: null,
          lastFailureAt: null,
        },
      ],
      counters: { lastWebhookId: 1 },
      updatedAt: new Date().toISOString(),
    });
    await ACCESSORS.webhookDeliveries().replaceAll({
      version: 1,
      deliveries: [
        {
          id: 1,
          webhookId: 1,
          userId: 1,
          eventType: "field.created",
          status: "failed",
          attempts: 1,
          targetUrl: "https://example.test/webhook",
          requestPayload: { hello: "world" },
          response: { statusCode: 500, body: "temp" },
          reason: "temp",
          correlationId: "temp-correlation",
          notificationId: "notif-temp",
          durationMs: 10,
          createdAt: new Date().toISOString(),
        },
      ],
      counters: { lastDeliveryId: 1 },
      updatedAt: new Date().toISOString(),
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
    await ACCESSORS.pets().replaceAll({ pets: [{ id: 1, userId: 1, name: "temp-pet" }] });
    await ACCESSORS.tasks().replaceAll({
      version: 1,
      tasks: [{ id: "task-1", userId: 1, title: "temp", description: "temp", statusId: "status-1" }],
      labels: [],
      statuses: [],
      counters: { lastTaskId: 1, lastLabelId: 0, lastStatusId: 0, lastChecklistItemId: 0 },
      updatedAt: new Date().toISOString(),
    });

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
