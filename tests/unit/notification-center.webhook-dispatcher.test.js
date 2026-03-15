import { describe, it, expect, vi } from "vitest";

const WebhookDispatcher = require("../../modules/notification-center/channels/webhook-dispatcher");

const sampleNotification = {
  id: "notif-1",
  correlationId: "corr-1",
  userId: 1,
  title: "Hello",
  message: "World",
  metadata: {
    eventType: "transaction.created",
  },
};

describe("notification-center webhook dispatcher", () => {
  it("skips dispatch when webhook URL is missing", async () => {
    const dispatcher = new WebhookDispatcher({ url: null });
    const result = await dispatcher.dispatch(sampleNotification);

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: "webhook_url_missing",
      attempts: 0,
    });
  });

  it("retries with backoff and succeeds on later attempt", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const dispatcher = new WebhookDispatcher(
      {
        url: "http://example.test/hook",
        maxRetries: 3,
        baseBackoffMs: 10,
      },
      { sleep },
    );

    const postSpy = vi
      .spyOn(dispatcher, "_postJson")
      .mockRejectedValueOnce(new Error("first_fail"))
      .mockRejectedValueOnce(new Error("second_fail"))
      .mockResolvedValueOnce(undefined);

    const result = await dispatcher.dispatch(sampleNotification);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("returns failure reason after max retries are exhausted", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const dispatcher = new WebhookDispatcher(
      {
        url: "http://example.test/hook",
        maxRetries: 2,
        baseBackoffMs: 5,
      },
      { sleep },
    );

    vi.spyOn(dispatcher, "_postJson").mockRejectedValue(new Error("network_down"));
    const result = await dispatcher.dispatch(sampleNotification);

    expect(result).toMatchObject({
      success: false,
      attempts: 2,
      reason: "network_down",
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5);
  });
});
