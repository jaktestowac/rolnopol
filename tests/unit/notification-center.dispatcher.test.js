import { describe, it, expect, vi } from "vitest";

const NotificationDispatcher = require("../../modules/notification-center/core/notification-dispatcher");

const createEvent = (payload = {}) => ({
  type: "notification.test.triggered",
  timestamp: new Date().toISOString(),
  correlationId: "corr-force-fail",
  source: "test-suite",
  payload,
});

describe("notification-center dispatcher", () => {
  it("marks event as failed when payload.forceFail is enabled", async () => {
    const eventStore = {
      add: vi.fn().mockResolvedValue({ id: "evt-1" }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };

    const notificationStore = {
      add: vi.fn().mockResolvedValue({ id: "notif-1" }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateChannelStatus: vi.fn().mockResolvedValue(undefined),
    };

    const dispatcher = new NotificationDispatcher(
      {
        subscribe: vi.fn(() => () => {}),
      },
      {
        policyRouter: {
          resolve: vi.fn(() => ({
            id: "policy-1",
            priority: 1,
            channels: ["in-app"],
            template: () => ({ title: "t", message: "m" }),
          })),
        },
        eventStore,
        notificationStore,
        inAppDispatcher: {
          dispatch: vi.fn().mockResolvedValue({ success: true, deliveredAt: new Date().toISOString() }),
        },
        webhookDispatcher: {
          dispatch: vi.fn().mockResolvedValue({ success: true }),
        },
        sleep: vi.fn().mockResolvedValue(undefined),
      },
      {
        handlingDelayMs: 0,
      },
    );

    await dispatcher._handleEvent(
      createEvent({
        userId: 1,
        forceFail: true,
        forceFailReason: "qa-test",
      }),
    );

    expect(eventStore.add).toHaveBeenCalledTimes(1);
    expect(eventStore.updateStatus).toHaveBeenNthCalledWith(1, "evt-1", "processing");
    expect(eventStore.updateStatus).toHaveBeenNthCalledWith(
      2,
      "evt-1",
      "failed",
      expect.objectContaining({ error: "forced_fail:qa-test" }),
    );

    expect(notificationStore.add).not.toHaveBeenCalled();
    expect(dispatcher.getMetrics().events_failed).toBe(1);
  });
});
