const { randomUUID } = require("crypto");

class EventPublisher {
  constructor(eventBus, config = {}) {
    this.eventBus = eventBus;
    this.enabled = config.enabled !== false;
    this.asyncMode = config.asyncMode !== false;
    this.source = config.source || "rolnopol-app";
  }

  isEnabled() {
    return this.enabled === true && this.eventBus && this.eventBus.enabled !== false;
  }

  publish(event) {
    if (!this.isEnabled()) {
      return null;
    }

    const normalized = {
      ...event,
      timestamp: event?.timestamp || new Date().toISOString(),
      correlationId: event?.correlationId || randomUUID(),
      version: Number.isFinite(event?.version) ? event.version : 1,
      source: event?.source || this.source,
      payload: event?.payload && typeof event.payload === "object" ? event.payload : {},
    };

    const run = () => {
      try {
        this.eventBus.publish(normalized);
      } catch (_) {
        // fire-and-forget: never throw to business flow
      }
    };

    if (this.asyncMode) {
      setImmediate(run);
    } else {
      run();
    }

    return normalized.correlationId;
  }
}

module.exports = EventPublisher;
