const { EventEmitter } = require("events");

const EVENT_NAME = "notification:event";

class NotificationEventBus extends EventEmitter {
  constructor(config = {}) {
    super();
    this.enabled = config.enabled !== false;
    this.processingDelayMs = config.processingDelayMs || 0;
    this.setMaxListeners(config.maxListeners || 100);
  }

  _isValid(event) {
    return Boolean(
      event &&
      typeof event.type === "string" &&
      event.type.length > 0 &&
      typeof event.timestamp === "string" &&
      typeof event.correlationId === "string" &&
      event.payload &&
      typeof event.payload === "object",
    );
  }

  publish(event) {
    if (!this.enabled) {
      return { accepted: false, reason: "disabled" };
    }
    if (!this._isValid(event)) {
      return { accepted: false, reason: "invalid_event" };
    }

    if (this.processingDelayMs > 0) {
      setTimeout(() => this.emit(EVENT_NAME, event), this.processingDelayMs);
    } else {
      this.emit(EVENT_NAME, event);
    }

    return { accepted: true };
  }

  subscribe(handler) {
    this.on(EVENT_NAME, handler);
    return () => this.off(EVENT_NAME, handler);
  }
}

module.exports = {
  NotificationEventBus,
  EVENT_NAME,
};
