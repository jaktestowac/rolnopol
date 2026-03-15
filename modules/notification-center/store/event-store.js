const dbManager = require("../../../data/database-manager");
const { randomUUID } = require("crypto");

const DEFAULT_DATA = {
  events: [],
  metadata: {
    lastEventId: null,
    total: 0,
    lastUpdated: null,
  },
};

class EventStore {
  constructor() {
    this.db = dbManager.getCustomDatabase("notification-events", "events-store.json", DEFAULT_DATA);
  }

  async add(event, status = "received") {
    const item = {
      id: `evt-${randomUUID()}`,
      type: event.type,
      status,
      correlationId: event.correlationId,
      timestamp: event.timestamp,
      payload: event.payload,
      source: event.source,
      version: event.version || 1,
      timeline: [{ status, at: new Date().toISOString() }],
      error: null,
      relatedNotificationId: null,
    };

    await this.db.update((current) => {
      const next = current && typeof current === "object" ? { ...current } : { ...DEFAULT_DATA };
      next.events = Array.isArray(next.events) ? [...next.events, item] : [item];
      next.metadata = {
        ...(next.metadata || {}),
        lastEventId: item.id,
        total: next.events.length,
        lastUpdated: new Date().toISOString(),
      };
      return next;
    });

    return item;
  }

  async updateStatus(eventId, status, extras = {}) {
    await this.db.update((current) => {
      const next = current && typeof current === "object" ? { ...current } : { ...DEFAULT_DATA };
      const events = Array.isArray(next.events) ? [...next.events] : [];
      next.events = events.map((e) => {
        if (e.id !== eventId) return e;
        const currentTimeline = Array.isArray(e.timeline) ? e.timeline : [];
        const hasStatusChanged = e.status !== status;
        return {
          ...e,
          ...extras,
          status,
          timeline: hasStatusChanged ? [...currentTimeline, { status, at: new Date().toISOString() }] : currentTimeline,
        };
      });
      next.metadata = {
        ...(next.metadata || {}),
        total: next.events.length,
        lastUpdated: new Date().toISOString(),
      };
      return next;
    });
  }

  async stats() {
    const data = await this.db.getAll();
    const events = Array.isArray(data?.events) ? data.events : [];
    const counts = { total: events.length, received: 0, processing: 0, processed: 0, failed: 0 };

    for (const event of events) {
      if (Object.prototype.hasOwnProperty.call(counts, event.status)) {
        counts[event.status] += 1;
      }
    }

    return counts;
  }

  async list(filters = {}) {
    const events = await this.listAll(filters);
    const total = events.length;
    const offset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
    const limit = Number.isInteger(filters.limit) ? Math.min(Math.max(filters.limit, 1), 200) : 50;

    return {
      items: events.slice(offset, offset + limit),
      total,
      limit,
      offset,
    };
  }

  async listAll(filters = {}) {
    const data = await this.db.getAll();
    let events = Array.isArray(data?.events) ? [...data.events] : [];

    if (filters.type) {
      events = events.filter((event) => event.type === filters.type);
    }

    if (filters.status) {
      events = events.filter((event) => event.status === filters.status);
    }

    if (filters.correlationId) {
      events = events.filter((event) => event.correlationId === filters.correlationId);
    }

    events.sort((a, b) => {
      const aTs = new Date(a.timestamp || 0).getTime();
      const bTs = new Date(b.timestamp || 0).getTime();
      return bTs - aTs;
    });

    return events;
  }
}

module.exports = EventStore;
