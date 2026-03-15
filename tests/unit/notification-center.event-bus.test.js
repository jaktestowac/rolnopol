import { describe, it, expect, vi } from "vitest";

const { NotificationEventBus } = require("../../modules/notification-center/ingress/event-bus");

const createValidEvent = () => ({
  type: "transaction.created",
  timestamp: new Date().toISOString(),
  correlationId: "corr-1",
  payload: { userId: 1 },
});

describe("notification-center event bus", () => {
  it("returns disabled when bus is turned off", () => {
    const bus = new NotificationEventBus({ enabled: false });
    const result = bus.publish(createValidEvent());

    expect(result).toEqual({ accepted: false, reason: "disabled" });
  });

  it("rejects invalid event payload", () => {
    const bus = new NotificationEventBus({ enabled: true });
    const result = bus.publish({ type: "x" });

    expect(result).toEqual({ accepted: false, reason: "invalid_event" });
  });

  it("publishes valid event immediately when no delay is configured", () => {
    const bus = new NotificationEventBus({ enabled: true });
    const listener = vi.fn();
    bus.subscribe(listener);

    const event = createValidEvent();
    const result = bus.publish(event);

    expect(result).toEqual({ accepted: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("supports delayed publishing and unsubscribe", async () => {
    vi.useFakeTimers();
    const bus = new NotificationEventBus({ enabled: true, processingDelayMs: 50 });
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    bus.publish(createValidEvent());
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.publish(createValidEvent());
    await vi.advanceTimersByTimeAsync(50);

    expect(listener).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
