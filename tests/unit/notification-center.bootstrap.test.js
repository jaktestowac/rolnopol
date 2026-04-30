import { describe, it, expect, vi, beforeEach } from "vitest";

describe("notification-center bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.NOTIFICATION_CENTER_ENABLED;
  });

  it("initializes in disabled mode when feature flag is false", async () => {
    const { initializeNotificationCenter } = require("../../modules/notification-center/bootstrap");

    const state = await initializeNotificationCenter({
      featureFlagsService: {
        getFeatureFlags: vi.fn().mockResolvedValue({ flags: { notificationCenterEnabled: false } }),
      },
    });

    expect(state.enabled).toBe(false);
    expect(state.degraded).toBe(false);
    expect(state.eventPublisher.isEnabled()).toBe(false);

    const health = await state.getHealth();
    expect(health.status).toBe("disabled");
    expect(health.module.enabled).toBe(false);
  });

  it("initializes in disabled mode when feature flags service throws", async () => {
    const { initializeNotificationCenter } = require("../../modules/notification-center/bootstrap");

    const state = await initializeNotificationCenter({
      featureFlagsService: {
        getFeatureFlags: vi.fn().mockRejectedValue(new Error("db_unavailable")),
      },
    });

    expect(state.enabled).toBe(false);
    expect(state.degraded).toBe(false);

    const health = await state.getHealth();
    expect(health.status).toBe("disabled");
  });

  it("deduplicates queued placeholder events when a persisted copy already exists", async () => {
    const { _mergeVisibleEvents } = require("../../modules/notification-center/bootstrap");

    const persistedEvent = {
      id: "evt-1",
      type: "notification.test.triggered",
      status: "received",
      correlationId: "corr-1",
      source: "notification-center-api",
      timestamp: "2026-04-30T16:30:00.000Z",
    };

    const enqueuedPlaceholder = {
      id: "enq-1",
      type: "notification.test.triggered",
      status: "enqueued",
      correlationId: "corr-1",
      source: "notification-center-api",
      timestamp: "2026-04-30T16:30:00.000Z",
    };

    const merged = _mergeVisibleEvents([persistedEvent], [enqueuedPlaceholder]);

    expect(merged).toEqual([persistedEvent]);
  });
});
