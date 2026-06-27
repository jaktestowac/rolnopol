// Force a fast, self-contained dispatcher so enabling the center in a unit test
// does not hang on timers. Must be set before the module reads config.
process.env.NOTIFICATION_TICK_MS = "50";
process.env.MIN_PROCESSING_DELAY_MS = "0";
process.env.GLOBAL_PROCESSING_DELAY_MS = "0";
process.env.DEFAULT_PROCESSING_DELAY_MS = "0";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Tests for decoupling the notification-center module from the concrete
// services/webhook.service (refactor #4). The module must work whether a
// webhook service is injected or not — end-to-end delivery using the injected
// service is covered by tests/webhooks-notifications-cross-user.test.js.

describe("notification-center webhook service is injected, not hard-required (#4)", () => {
  let started = [];

  beforeEach(() => {
    vi.resetModules();
    started = [];
    process.env.NOTIFICATION_CENTER_ENABLED = "1"; // force enabled without a flags service
  });

  afterEach(async () => {
    for (const state of started) {
      try {
        await state.stop();
      } catch {
        /* ignore */
      }
    }
    delete process.env.NOTIFICATION_CENTER_ENABLED;
  });

  it("does not statically require the concrete webhook service", () => {
    const src = readFileSync(resolve(__dirname, "../../modules/notification-center/bootstrap.js"), "utf-8");
    expect(src).not.toMatch(/require\(["'][^"']*services\/webhook\.service/);
  });

  it("enables cleanly when NO webhook service is injected (safe no-op fallback)", async () => {
    const { initializeNotificationCenter } = require("../../modules/notification-center/bootstrap");

    const state = await initializeNotificationCenter({});
    started.push(state);

    expect(state.enabled).toBe(true);
    expect(state.degraded).toBe(false);
  });

  it("enables when a webhook service is injected", async () => {
    const { initializeNotificationCenter } = require("../../modules/notification-center/bootstrap");

    const webhookService = {
      listActiveSubscriptionsForDelivery: vi.fn().mockResolvedValue([]),
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    };

    const state = await initializeNotificationCenter({ webhookService });
    started.push(state);

    expect(state.enabled).toBe(true);
  });

  it("threads the injected webhook service through the module facade re-init", async () => {
    const notificationCenter = require("../../modules/notification-center");
    notificationCenter._resetForTests?.();

    const webhookService = {
      listActiveSubscriptionsForDelivery: vi.fn().mockResolvedValue([]),
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    };

    const state = await notificationCenter.initialize({ featureFlagsService: {}, webhookService });
    started.push(state);

    expect(state.enabled).toBe(true);
    notificationCenter._resetForTests?.();
  });
});
