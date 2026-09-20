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

describe("notification-center dispatcher — throttling", () => {
  /** A dispatcher whose stores and policy are visible to the test. */
  function makeDispatcher(policy) {
    const eventStore = {
      add: vi.fn(async (event) => ({ id: `evt-${event.correlationId}` })),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    const notificationStore = {
      add: vi.fn().mockResolvedValue({ id: "notif-1" }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateChannelStatus: vi.fn().mockResolvedValue(undefined),
    };

    const dispatcher = new NotificationDispatcher(
      { subscribe: vi.fn(() => () => {}) },
      {
        policyRouter: { resolve: vi.fn(() => policy) },
        eventStore,
        notificationStore,
        inAppDispatcher: { dispatch: vi.fn().mockResolvedValue({ success: true, deliveredAt: "now" }) },
        webhookDispatcher: { dispatch: vi.fn().mockResolvedValue({ success: true }) },
        sleep: vi.fn().mockResolvedValue(undefined),
      },
      { handlingDelayMs: 0, defaultProcessingDelayMs: 0, receivedToProcessingGlobalDelayMs: 0 },
    );

    return { dispatcher, eventStore, notificationStore };
  }

  const event = (correlationId) => ({
    type: "crew.tool.issued",
    timestamp: new Date().toISOString(),
    correlationId,
    source: "crew-office",
    payload: { userId: 1 },
  });

  const POLICY = {
    id: "policy.crew.tool.issued",
    priority: "low",
    channels: ["in-app"],
    dedupe: { seconds: 60 },
    rateLimit: { max: 2, windowSeconds: 300 },
    processingDelayMs: 0,
    template: () => ({ title: "Tool Issued", message: "m" }),
  };

  it("records a duplicate as suppressed and creates NO notification", async () => {
    const { dispatcher, eventStore, notificationStore } = makeDispatcher(POLICY);

    await dispatcher._handleEvent(event("trip-1"));
    expect(notificationStore.add).toHaveBeenCalledTimes(1);

    await dispatcher._handleEvent(event("trip-1"));
    expect(notificationStore.add).toHaveBeenCalledTimes(1); // still one

    const suppressed = eventStore.updateStatus.mock.calls.find((call) => call[1] === "suppressed");
    expect(suppressed).toBeTruthy();
    expect(suppressed[2].note).toBe("duplicate");
    expect(suppressed[2].error).toContain("dedupe window");
  });

  it("keeps a suppressed event on the timeline rather than dropping it", async () => {
    // The event is still stored before the policy is even resolved, so a
    // suppressed event is visible with a reason instead of vanishing.
    const { dispatcher, eventStore } = makeDispatcher(POLICY);

    await dispatcher._handleEvent(event("trip-1"));
    await dispatcher._handleEvent(event("trip-1"));

    expect(eventStore.add).toHaveBeenCalledTimes(2);
  });

  it("records a rate-limited event as suppressed", async () => {
    const { dispatcher, eventStore, notificationStore } = makeDispatcher(POLICY);

    await dispatcher._handleEvent(event("trip-1"));
    await dispatcher._handleEvent(event("trip-2"));
    await dispatcher._handleEvent(event("trip-3")); // over max: 2

    expect(notificationStore.add).toHaveBeenCalledTimes(2);
    const suppressed = eventStore.updateStatus.mock.calls.find((call) => call[1] === "suppressed");
    expect(suppressed[2].note).toBe("rate_limited");
  });

  it("counts suppression in the metrics", async () => {
    const { dispatcher } = makeDispatcher(POLICY);

    await dispatcher._handleEvent(event("trip-1"));
    await dispatcher._handleEvent(event("trip-1"));

    const metrics = dispatcher.getMetrics ? dispatcher.getMetrics() : dispatcher.metrics;
    expect(metrics.events_suppressed).toBe(1);
  });

  it("leaves a policy with no windows completely unthrottled", async () => {
    // Most policies in the module carry dedupe: { seconds: 0 }, which must keep
    // meaning "deliver every time".
    const { dispatcher, notificationStore } = makeDispatcher({
      ...POLICY,
      dedupe: { seconds: 0 },
      rateLimit: { max: 0, windowSeconds: 0 },
    });

    for (let i = 0; i < 5; i += 1) {
      await dispatcher._handleEvent(event("same-id"));
    }
    expect(notificationStore.add).toHaveBeenCalledTimes(5);
  });
});
