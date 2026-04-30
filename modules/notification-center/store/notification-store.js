const dbManager = require("../../../data/database-manager");
const { randomUUID } = require("crypto");

const createRealtimePacket = (action, record, extra = {}) => ({
  entity: "notification",
  action,
  record,
  occurredAt: new Date().toISOString(),
  ...extra,
});

const DEFAULT_DATA = {
  notifications: [],
  metadata: {
    lastNotificationId: null,
    total: 0,
    lastUpdated: null,
  },
};

class NotificationStore {
  constructor(options = {}) {
    this.db = dbManager.getCustomDatabase("notification-notifications", "notifications-store.json", DEFAULT_DATA);
    this.onChange = typeof options.onChange === "function" ? options.onChange : null;
  }

  _emitChange(packet) {
    if (typeof this.onChange !== "function") {
      return;
    }

    this.onChange(packet);
  }

  async add(notification) {
    const item = {
      id: notification.id || `notif-${randomUUID()}`,
      correlationId: notification.correlationId,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      status: notification.status || "pending",
      channels: Array.isArray(notification.channels) ? notification.channels : [],
      createdAt: notification.createdAt || new Date().toISOString(),
      sentAt: notification.sentAt || null,
      expiresAt: notification.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: notification.metadata || {},
      timeline: [{ status: notification.status || "pending", at: new Date().toISOString() }],
    };

    await this.db.update((current) => {
      const next = current && typeof current === "object" ? { ...current } : { ...DEFAULT_DATA };
      next.notifications = Array.isArray(next.notifications) ? [...next.notifications, item] : [item];
      next.metadata = {
        ...(next.metadata || {}),
        lastNotificationId: item.id,
        total: next.notifications.length,
        lastUpdated: new Date().toISOString(),
      };
      return next;
    });

    this._emitChange(createRealtimePacket("created", item));

    return item;
  }

  async updateStatus(notificationId, status, extras = {}) {
    let updatedItem = null;

    await this.db.update((current) => {
      const next = current && typeof current === "object" ? { ...current } : { ...DEFAULT_DATA };
      const notifications = Array.isArray(next.notifications) ? [...next.notifications] : [];

      next.notifications = notifications.map((n) => {
        if (n.id !== notificationId) return n;
        updatedItem = {
          ...n,
          ...extras,
          status,
          timeline: [...(n.timeline || []), { status, at: new Date().toISOString() }],
        };
        return updatedItem;
      });
      next.metadata = {
        ...(next.metadata || {}),
        total: next.notifications.length,
        lastUpdated: new Date().toISOString(),
      };
      return next;
    });

    if (updatedItem) {
      this._emitChange(createRealtimePacket("updated", updatedItem));
    }
  }

  async updateChannelStatus(notificationId, channelName, status, extras = {}) {
    let updatedItem = null;

    await this.db.update((current) => {
      const next = current && typeof current === "object" ? { ...current } : { ...DEFAULT_DATA };
      const notifications = Array.isArray(next.notifications) ? [...next.notifications] : [];
      next.notifications = notifications.map((n) => {
        if (n.id !== notificationId) return n;
        const channels = Array.isArray(n.channels) ? [...n.channels] : [];
        const idx = channels.findIndex((c) => c.name === channelName);
        const channel = {
          ...(idx >= 0 ? channels[idx] : { name: channelName }),
          ...extras,
          status,
        };
        if (idx >= 0) {
          channels[idx] = channel;
        } else {
          channels.push(channel);
        }

        updatedItem = {
          ...n,
          channels,
          timeline: [...(n.timeline || []), { status: `channel:${channelName}:${status}`, at: new Date().toISOString() }],
        };
        return updatedItem;
      });

      next.metadata = {
        ...(next.metadata || {}),
        total: next.notifications.length,
        lastUpdated: new Date().toISOString(),
      };

      return next;
    });

    if (updatedItem) {
      this._emitChange(
        createRealtimePacket("channel_updated", updatedItem, {
          channel: channelName,
          channelStatus: status,
        }),
      );
    }
  }

  async stats() {
    const data = await this.db.getAll();
    const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
    const counts = { total: notifications.length, pending: 0, in_progress: 0, delivered: 0, failed: 0 };
    for (const notification of notifications) {
      if (Object.prototype.hasOwnProperty.call(counts, notification.status)) {
        counts[notification.status] += 1;
      }
    }
    return counts;
  }
}

module.exports = NotificationStore;
