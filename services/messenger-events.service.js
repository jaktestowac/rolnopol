const EventEmitter = require("events");

class MessengerEventsService {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  _normalizeUserIds(userIds) {
    if (!Array.isArray(userIds)) {
      return [];
    }

    const normalized = userIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    return [...new Set(normalized)];
  }

  emitRelationshipChanged(payload = {}) {
    const userIds = this._normalizeUserIds(payload.userIds);
    if (userIds.length === 0) {
      return;
    }

    this.emitter.emit("relationship_changed", {
      reason: payload.reason || "relationship_updated",
      userIds,
      actorUserId: Number(payload.actorUserId) || null,
      targetUserId: Number(payload.targetUserId) || null,
      occurredAt: new Date().toISOString(),
    });
  }

  onRelationshipChanged(listener) {
    this.emitter.on("relationship_changed", listener);
  }

  offRelationshipChanged(listener) {
    this.emitter.off("relationship_changed", listener);
  }

  emitMessagesRead(payload = {}) {
    const readByUserId = Number(payload.readByUserId);
    if (!Number.isInteger(readByUserId) || readByUserId <= 0) {
      return;
    }

    const withUserId = Number(payload.withUserId);
    if (!Number.isInteger(withUserId) || withUserId <= 0) {
      return;
    }

    this.emitter.emit("messages_read", {
      readByUserId,
      withUserId,
      occurredAt: new Date().toISOString(),
    });
  }

  onMessagesRead(listener) {
    this.emitter.on("messages_read", listener);
  }

  offMessagesRead(listener) {
    this.emitter.off("messages_read", listener);
  }
}

module.exports = new MessengerEventsService();
