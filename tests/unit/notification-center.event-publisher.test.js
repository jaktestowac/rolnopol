import { describe, it, expect, vi } from "vitest";

const EventPublisher = require("../../modules/notification-center/ingress/event-publisher");

describe("notification-center event publisher", () => {
  it("returns null when publisher is disabled", () => {
    const bus = { enabled: true, publish: vi.fn() };
    const publisher = new EventPublisher(bus, { enabled: false });

    expect(publisher.isEnabled()).toBe(false);
    expect(publisher.publish({ type: "x" })).toBeNull();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("publishes asynchronously and normalizes payload", async () => {
    const bus = { enabled: true, publish: vi.fn() };
    const publisher = new EventPublisher(bus, {
      enabled: true,
      asyncMode: true,
      source: "test-source",
    });

    const correlationId = publisher.publish({
      type: "field.created",
      payload: null,
      correlationId: "corr-123",
    });

    expect(correlationId).toBe("corr-123");
    expect(bus.publish).not.toHaveBeenCalled();

    await new Promise((resolve) => setImmediate(resolve));

    expect(bus.publish).toHaveBeenCalledTimes(1);
    const published = bus.publish.mock.calls[0][0];
    expect(published.type).toBe("field.created");
    expect(published.correlationId).toBe("corr-123");
    expect(published.source).toBe("test-source");
    expect(published.version).toBe(1);
    expect(published.payload).toEqual({});
    expect(typeof published.timestamp).toBe("string");
  });

  it("swallows downstream publish errors", async () => {
    const bus = {
      enabled: true,
      publish: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const publisher = new EventPublisher(bus, { enabled: true, asyncMode: true });

    expect(() => publisher.publish({ type: "animal.created", payload: {} })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });
});
