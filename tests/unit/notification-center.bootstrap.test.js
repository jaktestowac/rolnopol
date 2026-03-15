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
});
