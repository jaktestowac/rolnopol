const policies = require("../modules/notification-center/core/policies");
const {
  getAllEventTypes,
  getEventMetadata,
  getPayloadTemplate,
  PAYLOAD_TEMPLATES,
} = require("../modules/notification-center/core/event-payload-templates");

class WebhookEventCatalogService {
  listEvents() {
    return getAllEventTypes()
      .filter((eventType) => Array.isArray(policies[eventType]?.channels) && policies[eventType].channels.includes("webhook"))
      .map((eventType) => ({
        type: eventType,
        label: PAYLOAD_TEMPLATES[eventType]?.label || eventType,
        description: PAYLOAD_TEMPLATES[eventType]?.description || "",
        priority: policies[eventType]?.priority || getEventMetadata(eventType)?.priority || "normal",
        processingDelayMs: policies[eventType]?.processingDelayMs || null,
        payloadTemplate: getPayloadTemplate(eventType, {}),
      }))
      .sort((left, right) => left.type.localeCompare(right.type));
  }

  getSupportedEventTypes() {
    return this.listEvents().map((item) => item.type);
  }

  isSupported(eventType) {
    return this.getSupportedEventTypes().includes(String(eventType || ""));
  }
}

module.exports = new WebhookEventCatalogService();
