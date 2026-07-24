import webhookEventCatalog from "../../services/webhook-event-catalog.service.js";
import { describe, it, expect } from "vitest";

const policies = require("../../modules/notification-center/core/policies");

describe("webhook-event-catalog.service", () => {
  it("lists only events routed to the webhook channel", () => {
    const events = webhookEventCatalog.listEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(policies[event.type].channels).toContain("webhook");
      expect(event).toHaveProperty("label");
      expect(event).toHaveProperty("priority");
      expect(event).toHaveProperty("payloadTemplate");
    }
  });

  it("returns the events sorted by type", () => {
    const types = webhookEventCatalog.listEvents().map((e) => e.type);
    const sorted = [...types].sort((a, b) => a.localeCompare(b));
    expect(types).toEqual(sorted);
  });

  it("getSupportedEventTypes matches the listed event types", () => {
    const listed = webhookEventCatalog.listEvents().map((e) => e.type);
    expect(webhookEventCatalog.getSupportedEventTypes()).toEqual(listed);
  });

  it("isSupported reflects membership in the supported set", () => {
    const supported = webhookEventCatalog.getSupportedEventTypes();
    expect(webhookEventCatalog.isSupported(supported[0])).toBe(true);
    expect(webhookEventCatalog.isSupported("definitely.not.an.event")).toBe(false);
    expect(webhookEventCatalog.isSupported(null)).toBe(false);
    expect(webhookEventCatalog.isSupported(undefined)).toBe(false);
  });
});
