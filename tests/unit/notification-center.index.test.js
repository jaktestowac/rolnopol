import { describe, it, expect, vi, beforeEach } from "vitest";

describe("notification-center index facade", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns default no-op publisher before initialization", async () => {
    const notificationCenter = require("../../modules/notification-center");

    expect(notificationCenter.isEnabled()).toBe(false);
    expect(notificationCenter.getEventPublisher().isEnabled()).toBe(false);
    expect(typeof notificationCenter.subscribeRealtime(() => {})).toBe("function");

    const health = await notificationCenter.getHealth();
    expect(health.status).toBe("disabled");
  });

  it("remains safe and disabled across initialize/stop calls", async () => {
    const notificationCenter = require("../../modules/notification-center");
    await notificationCenter.initialize({ featureFlagsService: {} });

    expect(notificationCenter.isEnabled()).toBe(false);
    expect(notificationCenter.getEventPublisher().isEnabled()).toBe(false);
    expect(notificationCenter.getEventPublisher().publish({ type: "x" })).toBeNull();

    const health = await notificationCenter.getHealth();
    expect(health.status).toBe("disabled");

    await notificationCenter.stop();

    // stop should remain idempotent even when the module is disabled/no-op
    await expect(notificationCenter.stop()).resolves.toBeUndefined();
  });

  it("refreshes state and publishes after the feature flag is enabled at runtime", async () => {
    const featureFlagsService = {
      getFeatureFlags: vi
        .fn()
        .mockResolvedValueOnce({ flags: { notificationCenterEnabled: false } })
        .mockResolvedValue({ flags: { notificationCenterEnabled: true } }),
    };

    const notificationCenter = require("../../modules/notification-center");
    await notificationCenter.initialize({ featureFlagsService });

    expect(notificationCenter.isEnabled()).toBe(false);

    const result = await notificationCenter.publish({
      type: "field.created",
      source: "resource.service",
      correlationId: "field-123",
      payload: {
        userId: 1,
        fieldId: 123,
        name: "Runtime flag field",
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.correlationId).toBe("field-123");
    expect(notificationCenter.isEnabled()).toBe(true);
    expect(featureFlagsService.getFeatureFlags.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
