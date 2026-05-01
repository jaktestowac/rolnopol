// Ensure fast notification processing for this test file in case global setup is not applied.
process.env.MIN_PROCESSING_DELAY_MS = process.env.MIN_PROCESSING_DELAY_MS || "0";
process.env.PROCESSING_SPEED_FACTOR = process.env.PROCESSING_SPEED_FACTOR || "0.1";
process.env.GLOBAL_PROCESSING_DELAY_MS = process.env.GLOBAL_PROCESSING_DELAY_MS || "0";
process.env.NOTIFICATION_TICK_MS = process.env.NOTIFICATION_TICK_MS || "200";
process.env.NOTIFICATION_HANDLING_DELAY = process.env.NOTIFICATION_HANDLING_DELAY || "10";
process.env.BATCH_DELAY_MS = process.env.BATCH_DELAY_MS || "10";
process.env.DEFAULT_PROCESSING_DELAY_MS = process.env.DEFAULT_PROCESSING_DELAY_MS || "10";
process.env.RECEIVED_TO_PROCESSING_GLOBAL_DELAY_MS = process.env.RECEIVED_TO_PROCESSING_GLOBAL_DELAY_MS || "0";
process.env.WEBHOOK_SEND_DELAY = process.env.WEBHOOK_SEND_DELAY || "0";
process.env.WEBHOOK_TIMEOUT_MS = process.env.WEBHOOK_TIMEOUT_MS || "500";

import { describe, it, expect } from "vitest";
import http from "http";
import request from "supertest";

const app = require("../api/index.js");
const featureFlagsService = require("../services/feature-flags.service");

async function registerUser() {
  const user = {
    email: `cross-user-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
    displayedName: "Cross User Test",
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

async function pollForDelivery(session, predicate, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const intervalMs = options.intervalMs || 100;
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

describe("Webhooks & Notifications - cross-user data isolation", () => {
  it("webhook for user A does NOT receive events for user B and receives only A's events", async () => {
    const sessionA = await registerUser();
    const sessionB = await registerUser();

    await enableWebhookFeatures();

    const webhookServer = await withHttpWebhookServer(({ res }) => {
      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ accepted: true }));
    });

    try {
      // create webhook for user A
      const createWebhookRes = await request(app)
        .post("/api/v1/users/profile/webhooks")
        .set("token", sessionA.token)
        .send({
          name: "User A sink",
          url: webhookServer.url,
          eventTypes: ["field.created"],
        })
        .expect(201);

      const webhookId = createWebhookRes.body.data.webhook.id;

      // create a field as user B - this should NOT trigger user A's webhook
      const fieldBRes = await request(app)
        .post("/api/v1/fields")
        .set("token", sessionB.token)
        .send({ name: `B-field-${Date.now()}`, area: 5 })
        .expect(201);

      // give system a short moment to process if it would erroneously dispatch
      await new Promise((resolve) => setTimeout(resolve, 200));

      // webhook server should have received no events
      expect(webhookServer.events.length).toBe(0);

      // deliveries for user A should not contain entries for the webhook
      const deliveriesARes = await request(app).get("/api/v1/users/profile/webhooks/deliveries").set("token", sessionA.token).expect(200);
      const deliveriesA = deliveriesARes.body.data.items || [];
      expect(deliveriesA.find((d) => Number(d.webhookId) === webhookId)).toBeUndefined();

      // now create a field as user A - this should trigger the webhook
      const fieldARes = await request(app)
        .post("/api/v1/fields")
        .set("token", sessionA.token)
        .send({ name: `A-field-${Date.now()}`, area: 11 })
        .expect(201);

      // wait for delivery record for user A
      const delivery = await pollForDelivery(sessionA, (item) => Number(item.webhookId) === webhookId && item.status === "delivered", {
        query: { webhookId },
        timeoutMs: 20000,
      });

      expect(delivery).toBeTruthy();

      // webhook server must have at least one event and it must reference user A
      expect(webhookServer.events.length).toBeGreaterThan(0);
      const received = webhookServer.events[0];
      expect(received.headers["x-rolnopol-event"]).toBe("field.created");
      expect(received.body).toEqual(
        expect.objectContaining({
          type: "field.created",
          webhookId,
          payload: expect.objectContaining({ userId: sessionA.userId }),
        }),
      );

      // ensure payload does not accidentally include user B's id (check values, not substrings)
      const payload = received.body && received.body.payload;
      expect(payload.userId).toBe(sessionA.userId);

      const containsValue = (obj, val) => {
        if (obj === val) return true;
        if (obj && typeof obj === "object") {
          return Object.values(obj).some((v) => containsValue(v, val));
        }
        return false;
      };

      expect(containsValue(payload, sessionB.userId)).toBe(false);
    } finally {
      await webhookServer.close();
    }
  }, 15000);

  it("notifications events contain correct userId and do not leak other user's data", async () => {
    const session1 = await registerUser();
    const session2 = await registerUser();

    await enableWebhookFeatures();

    // create a field as session2
    const fieldBRes = await request(app)
      .post("/api/v1/fields")
      .set("token", session2.token)
      .send({ name: `Notif-B-field-${Date.now()}`, area: 7 })
      .expect(201);

    const fieldId = fieldBRes.body.id || fieldBRes.body.data?.id || fieldBRes.body?.data?.id || fieldBRes.body?.id;
    // resource create returns created object directly, often at body
    const createdId =
      fieldBRes.body.id ||
      fieldBRes.body?.id ||
      fieldBRes.body?.data?.id ||
      fieldBRes.body?.data?.id ||
      fieldBRes.body?.id ||
      fieldBRes.body?.id ||
      (fieldBRes.body && fieldBRes.body.id) ||
      (fieldBRes.body && fieldBRes.body.data && fieldBRes.body.data.id);
    // determine the id robustly
    const effectiveId =
      fieldBRes.body.id ||
      (fieldBRes.body?.data && fieldBRes.body.data.id) ||
      (fieldBRes.body && fieldBRes.body.id) ||
      fieldBRes.body?.id ||
      fieldBRes.body?.data?.id ||
      fieldBRes.body.id;

    const correlationId = `field-${effectiveId}`;

    // poll events endpoint until we see an event for this correlationId
    const deadline = Date.now() + 8000;
    let found = null;

    while (Date.now() < deadline) {
      const eventsRes = await request(app)
        .get(`/api/v1/notifications/events?correlationId=${encodeURIComponent(correlationId)}`)
        .expect(200);
      const items = eventsRes.body.data.items || [];
      if (items.length > 0) {
        found = items.find((e) => e.correlationId === correlationId);
        if (found) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(found).toBeTruthy();
    expect(found.payload).toBeTruthy();
    expect(found.payload.userId).toBe(session2.userId);
    // ensure other user's id is not present
    expect(String(JSON.stringify(found.payload))).not.toContain(String(session1.userId));
  }, 8000);
});
