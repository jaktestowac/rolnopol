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
});
