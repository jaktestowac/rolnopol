import { describe, it, expect } from "vitest";

const { EVENT_TYPES, MVP_EVENT_CATALOG } = require("../../modules/notification-center/core/contracts");
const policies = require("../../modules/notification-center/core/policies");
const {
  PAYLOAD_TEMPLATES,
  EVENT_TYPE_METADATA,
  getAllEventTypes,
  getPayloadTemplate,
  getEventMetadata,
} = require("../../modules/notification-center/core/event-payload-templates");

const declaredTypes = Object.values(EVENT_TYPES);

describe("notification-center event catalog", () => {
  it("declares a policy for every event type", () => {
    const missing = declaredTypes.filter((eventType) => !policies[eventType]);
    expect(missing).toEqual([]);
  });

  it("declares a payload template for every event type", () => {
    // getAllEventTypes() gates both POST /api/v1/notifications/trigger and the
    // webhook subscription catalog, so a missing template silently hides an event.
    const missing = declaredTypes.filter((eventType) => !PAYLOAD_TEMPLATES[eventType]);
    expect(missing).toEqual([]);
  });

  it("declares display metadata for every event type", () => {
    const missing = declaredTypes.filter((eventType) => !EVENT_TYPE_METADATA[eventType]);
    expect(missing).toEqual([]);
  });

  it("has no templates, metadata, or policies for undeclared event types", () => {
    expect(getAllEventTypes().filter((eventType) => !declaredTypes.includes(eventType))).toEqual([]);
    expect(Object.keys(EVENT_TYPE_METADATA).filter((eventType) => !declaredTypes.includes(eventType))).toEqual([]);
    expect(Object.keys(policies).filter((eventType) => !declaredTypes.includes(eventType))).toEqual([]);
  });

  it("keeps the MVP catalog in sync with the declared event types", () => {
    expect([...MVP_EVENT_CATALOG].sort()).toEqual([...declaredTypes].sort());
  });

  it("renders a policy title and message for every event type", () => {
    for (const eventType of declaredTypes) {
      const event = {
        type: eventType,
        timestamp: new Date().toISOString(),
        correlationId: `corr-${eventType}`,
        payload: getPayloadTemplate(eventType, {}),
      };
      const rendered = policies[eventType].template(event);
      expect(rendered.title, eventType).toBeTruthy();
      expect(rendered.message, eventType).toBeTruthy();
      expect(rendered.message, eventType).not.toContain("undefined");
    }
  });

  it("produces an object payload for every template", () => {
    for (const eventType of declaredTypes) {
      const payload = getPayloadTemplate(eventType, {});
      expect(payload, eventType).toBeTypeOf("object");
      expect(payload, eventType).not.toBeNull();
      expect(Object.keys(payload).length, eventType).toBeGreaterThan(0);
    }
  });

  it("lets overrides win over template defaults", () => {
    for (const eventType of declaredTypes) {
      const payload = getPayloadTemplate(eventType, { correlationMarker: "override-check" });
      expect(payload.correlationMarker, eventType).toBe("override-check");
    }
  });

  it("gives every event type a priority consistent between policy and metadata", () => {
    for (const eventType of declaredTypes) {
      expect(getEventMetadata(eventType).priority, eventType).toBe(policies[eventType].priority);
    }
  });
});
