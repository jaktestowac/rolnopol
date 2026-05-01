import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import request from "supertest";

const app = require("../api/index.js");
const featureFlagsService = require("../services/feature-flags.service");

async function registerUser() {
  const user = {
    email: `webhook-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
    displayedName: "Webhook User",
    password: "testpass123",
  };

  const response = await request(app).post("/api/v1/register").send(user).expect(201);

  return {
    user,
    token: response.body.data.token,
    userId: response.body.data.user.id,
  };
}

async function enableWebhookFeatures() {
  await featureFlagsService.updateFlags({
    integrationsWebhooksEnabled: true,
    notificationCenterEnabled: true,
  });

  await request(app).get("/api/v1/notifications/health").expect(200);
}

async function pollForDelivery(session, predicate, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const intervalMs = options.intervalMs || 250;
  const deadline = Date.now() + timeoutMs;
  let lastItems = [];

  while (Date.now() < deadline) {
    const response = await request(app)
      .get("/api/v1/users/profile/webhooks/deliveries")
      .set("token", session.token)
      .query(options.query || {})
      .expect(200);

    lastItems = response.body.data.items;
    const match = lastItems.find(predicate);
    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for webhook delivery. Last seen items: ${JSON.stringify(lastItems, null, 2)}`);
}

async function withHttpWebhookServer(handler) {
  const events = [];
  const server = http.createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk.toString("utf8");
    });
    req.on("end", () => {
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = rawBody;
      }

      events.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body,
      });

      handler({ req, res, body, events });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}/webhook`,
    events,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe("Webhooks API", () => {
  let originalWebhookFlag = false;
  let originalNotificationFlag = false;

  beforeAll(async () => {
    const flags = await featureFlagsService.getFeatureFlags();
    originalWebhookFlag = flags?.flags?.integrationsWebhooksEnabled === true;
    originalNotificationFlag = flags?.flags?.notificationCenterEnabled === true;
  });

  afterAll(async () => {
    await featureFlagsService.updateFlags({
      integrationsWebhooksEnabled: originalWebhookFlag,
      notificationCenterEnabled: originalNotificationFlag,
    });
  });

  beforeEach(async () => {
    await featureFlagsService.updateFlags({
      integrationsWebhooksEnabled: true,
      notificationCenterEnabled: false,
    });
  });

  it("returns 404 when the webhooks feature flag is disabled", async () => {
    const session = await registerUser();
    await featureFlagsService.updateFlags({ integrationsWebhooksEnabled: false });

    const response = await request(app).get("/api/v1/users/profile/webhooks").set("token", session.token).expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("Webhooks not found");
  });

  it("lists backend-supported webhook events and supports webhook CRUD", async () => {
    const session = await registerUser();
    await enableWebhookFeatures();

    const eventsResponse = await request(app).get("/api/v1/users/profile/webhooks/events").set("token", session.token).expect(200);

    expect(eventsResponse.body.success).toBe(true);
    expect(eventsResponse.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "field.created", description: expect.any(String) }),
        expect.objectContaining({ type: "transaction.created" }),
      ]),
    );

    const createResponse = await request(app)
      .post("/api/v1/users/profile/webhooks")
      .set("token", session.token)
      .send({
        name: "Field sync",
        url: "https://example.com/hooks/fields",
        eventTypes: ["field.created", "transaction.created"],
      })
      .expect(201);

    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.data.webhook).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: "Field sync",
        url: "https://example.com/hooks/fields",
        eventTypes: ["field.created", "transaction.created"],
        enabled: true,
      }),
    );

    const webhookId = createResponse.body.data.webhook.id;

    const updateResponse = await request(app)
      .put(`/api/v1/users/profile/webhooks/${webhookId}`)
      .set("token", session.token)
      .send({
        name: "Field sync v2",
        enabled: false,
        eventTypes: ["transaction.created"],
      })
      .expect(200);

    expect(updateResponse.body.data.webhook).toEqual(
      expect.objectContaining({
        id: webhookId,
        name: "Field sync v2",
        enabled: false,
        eventTypes: ["transaction.created"],
      }),
    );

    const listResponse = await request(app).get("/api/v1/users/profile/webhooks").set("token", session.token).expect(200);

    expect(listResponse.body.data.items).toEqual([
      expect.objectContaining({
        id: webhookId,
        name: "Field sync v2",
      }),
    ]);

    await request(app).delete(`/api/v1/users/profile/webhooks/${webhookId}`).set("token", session.token).expect(200);

    const afterDeleteResponse = await request(app).get("/api/v1/users/profile/webhooks").set("token", session.token).expect(200);
    expect(afterDeleteResponse.body.data.items).toEqual([]);
  });

  it("delivers backend events to matching webhooks and logs successful responses", async () => {
    const session = await registerUser();
    await enableWebhookFeatures();

    const webhookServer = await withHttpWebhookServer(({ res }) => {
      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ accepted: true }));
    });

    try {
      const createWebhookResponse = await request(app)
        .post("/api/v1/users/profile/webhooks")
        .set("token", session.token)
        .send({
          name: "Field event sink",
          url: webhookServer.url,
          eventTypes: ["field.created"],
        })
        .expect(201);

      const webhookId = createWebhookResponse.body.data.webhook.id;

      await request(app)
        .post("/api/v1/fields")
        .set("token", session.token)
        .send({
          name: `Webhook Field ${Date.now()}`,
          area: 21,
          location: "North lot",
          cropType: "Wheat",
        })
        .expect(201);

      const delivery = await pollForDelivery(session, (item) => Number(item.webhookId) === webhookId && item.status === "delivered", {
        query: { webhookId },
      });

      expect(webhookServer.events.length).toBeGreaterThan(0);
      expect(webhookServer.events[0].headers["x-rolnopol-event"]).toBe("field.created");
      expect(webhookServer.events[0].body).toEqual(
        expect.objectContaining({
          type: "field.created",
          webhookId,
          payload: expect.objectContaining({
            userId: session.userId,
            notificationId: expect.any(String),
          }),
        }),
      );

      expect(delivery).toEqual(
        expect.objectContaining({
          webhookId,
          status: "delivered",
          targetUrl: webhookServer.url,
          response: expect.objectContaining({ statusCode: 202 }),
          requestPayload: expect.objectContaining({ type: "field.created" }),
        }),
      );
    } finally {
      await webhookServer.close();
    }
  }, 25000);

  it("logs failed webhook responses when the receiver returns an error", async () => {
    const session = await registerUser();
    await enableWebhookFeatures();

    const webhookServer = await withHttpWebhookServer(({ res }) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "simulated failure" }));
    });

    try {
      const createWebhookResponse = await request(app)
        .post("/api/v1/users/profile/webhooks")
        .set("token", session.token)
        .send({
          name: "Failing sink",
          url: webhookServer.url,
          eventTypes: ["field.created"],
        })
        .expect(201);

      const webhookId = createWebhookResponse.body.data.webhook.id;

      await request(app)
        .post("/api/v1/fields")
        .set("token", session.token)
        .send({
          name: `Webhook Failure Field ${Date.now()}`,
          area: 9,
          location: "South lot",
          cropType: "Corn",
        })
        .expect(201);

      const delivery = await pollForDelivery(session, (item) => Number(item.webhookId) === webhookId && item.status === "failed", {
        query: { webhookId },
      });

      expect(delivery).toEqual(
        expect.objectContaining({
          webhookId,
          status: "failed",
          targetUrl: webhookServer.url,
          reason: "webhook_http_500",
          response: expect.objectContaining({ statusCode: 500 }),
        }),
      );
      expect(String(delivery.response.body || "")).toContain("simulated failure");
    } finally {
      await webhookServer.close();
    }
  }, 25000);
});
