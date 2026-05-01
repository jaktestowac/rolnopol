import { beforeEach, describe, expect, it } from "vitest";

const webhookService = require("../../services/webhook.service");

const EMPTY_WEBHOOK_STORE = {
  version: 1,
  webhooks: [],
  counters: {
    lastWebhookId: 0,
  },
  updatedAt: null,
};

const EMPTY_DELIVERY_STORE = {
  version: 1,
  deliveries: [],
  counters: {
    lastDeliveryId: 0,
  },
  updatedAt: null,
};

describe("webhook.service", () => {
  beforeEach(async () => {
    await webhookService.db.replaceAll({ ...EMPTY_WEBHOOK_STORE });
    await webhookService.deliveryDb.replaceAll({ ...EMPTY_DELIVERY_STORE });
  });

  it("lists only webhook-compatible backend events", async () => {
    const result = await webhookService.listAvailableEvents();

    expect(result.total).toBeGreaterThan(0);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "field.created", payloadTemplate: expect.any(Object) }),
        expect.objectContaining({ type: "transaction.created" }),
      ]),
    );
    expect(result.items.find((item) => item.type === "animal.assigned")).toBeUndefined();
  });

  it("creates normalized webhooks and resolves matching active subscriptions", async () => {
    const created = await webhookService.createWebhook(1, {
      name: "  Field sync  ",
      url: "https://example.com/hooks/field-sync  ",
      eventTypes: ["field.created", "field.created", "transaction.created"],
      enabled: true,
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: 1,
        userId: 1,
        name: "Field sync",
        url: "https://example.com/hooks/field-sync",
        eventTypes: ["field.created", "transaction.created"],
        enabled: true,
      }),
    );

    const subscriptions = await webhookService.listActiveSubscriptionsForDelivery({
      userId: 1,
      eventType: "field.created",
    });

    expect(subscriptions).toEqual([
      expect.objectContaining({
        id: 1,
        userId: 1,
        url: "https://example.com/hooks/field-sync",
      }),
    ]);
  });

  it("records delivery attempts and updates webhook delivery timestamps", async () => {
    const webhook = await webhookService.createWebhook(1, {
      name: "Notifier",
      url: "https://example.com/webhooks/notify",
      eventTypes: ["field.created"],
    });

    const firstDelivery = await webhookService.recordDelivery({
      webhookId: webhook.id,
      userId: 1,
      eventType: "field.created",
      targetUrl: webhook.url,
      requestPayload: { type: "field.created" },
      responseStatusCode: 202,
      responseBody: JSON.stringify({ ok: true }),
      attempts: 1,
      success: true,
      correlationId: "corr-success",
      notificationId: "notif-success",
      durationMs: 22,
    });

    expect(firstDelivery).toEqual(
      expect.objectContaining({
        id: 1,
        webhookId: webhook.id,
        userId: 1,
        status: "delivered",
        response: expect.objectContaining({ statusCode: 202 }),
      }),
    );

    const secondDelivery = await webhookService.recordDelivery({
      webhookId: webhook.id,
      userId: 1,
      eventType: "field.created",
      targetUrl: webhook.url,
      requestPayload: { type: "field.created" },
      responseStatusCode: 500,
      responseBody: JSON.stringify({ error: "boom" }),
      attempts: 3,
      success: false,
      reason: "webhook_http_500",
      correlationId: "corr-failed",
      notificationId: "notif-failed",
      durationMs: 40,
    });

    expect(secondDelivery.status).toBe("failed");
    expect(secondDelivery.reason).toBe("webhook_http_500");

    const list = await webhookService.listDeliveries(1, { webhookId: webhook.id });
    expect(list.total).toBe(2);
    expect(list.items[0]).toEqual(expect.objectContaining({ id: 2, status: "failed" }));

    const webhooks = await webhookService.listWebhooks(1);
    expect(webhooks[0].lastDeliveredAt).toEqual(expect.any(String));
    expect(webhooks[0].lastFailureAt).toEqual(expect.any(String));
    expect(webhooks[0].lastTriggeredAt).toEqual(expect.any(String));
  });

  it("rejects unsupported event types and invalid URLs", async () => {
    await expect(
      webhookService.createWebhook(1, {
        name: "Bad events",
        url: "https://example.com/webhook",
        eventTypes: ["animal.assigned"],
      }),
    ).rejects.toThrow(/unsupported webhook event type/i);

    await expect(
      webhookService.createWebhook(1, {
        name: "Bad url",
        url: "ftp://example.com/webhook",
        eventTypes: ["field.created"],
      }),
    ).rejects.toThrow(/webhook url must use http or https/i);
  });
});
