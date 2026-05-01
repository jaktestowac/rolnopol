const dbManager = require("../data/database-manager");
const webhookEventCatalogService = require("./webhook-event-catalog.service");

const DEFAULT_WEBHOOK_STORE = {
  version: 1,
  webhooks: [],
  counters: {
    lastWebhookId: 0,
  },
  updatedAt: null,
};

const DEFAULT_DELIVERY_STORE = {
  version: 1,
  deliveries: [],
  counters: {
    lastDeliveryId: 0,
  },
  updatedAt: null,
};

const MAX_WEBHOOKS_PER_USER = 25;
const DEFAULT_WEBHOOK_NAME = "Webhook endpoint";
const MAX_NAME_LENGTH = 80;
const MAX_RESPONSE_BODY_LENGTH = 4000;

class WebhookService {
  constructor() {
    this.db = dbManager.getWebhooksDatabase();
    this.deliveryDb = dbManager.getWebhookDeliveriesDatabase();
    this.userDataInstance = null;
  }

  async listAvailableEvents() {
    const items = webhookEventCatalogService.listEvents();
    return {
      items,
      total: items.length,
    };
  }

  async listWebhooks(userId) {
    const user = await this._ensureActiveUser(userId);
    const store = await this._getWebhookStore();

    return store.webhooks
      .filter((record) => Number(record.userId) === Number(user.id))
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  async createWebhook(userId, input = {}) {
    const user = await this._ensureActiveUser(userId);
    const existing = await this.listWebhooks(user.id);

    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      throw new Error(`Validation failed: maximum of ${MAX_WEBHOOKS_PER_USER} active webhooks reached`);
    }

    const now = new Date().toISOString();
    const record = {
      userId: Number(user.id),
      name: this._sanitizeName(input.name),
      url: this._sanitizeUrl(input.url),
      eventTypes: this._normalizeEventTypes(input.eventTypes),
      enabled: this._normalizeEnabled(input.enabled, true),
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      lastDeliveredAt: null,
      lastFailureAt: null,
    };

    let created = null;
    await this.db.update((current) => {
      const normalized = this._normalizeWebhookStore(current);
      const nextWebhookId = (normalized.counters.lastWebhookId || 0) + 1;
      created = {
        id: nextWebhookId,
        ...record,
      };

      return {
        ...normalized,
        webhooks: [...normalized.webhooks, created],
        counters: {
          ...normalized.counters,
          lastWebhookId: nextWebhookId,
        },
        updatedAt: now,
      };
    });

    return created;
  }

  async updateWebhook(userId, webhookId, input = {}) {
    const user = await this._ensureActiveUser(userId);
    const numericWebhookId = this._normalizeWebhookId(webhookId);
    const existing = await this._getOwnedWebhook(user.id, numericWebhookId);
    const now = new Date().toISOString();

    let updated = null;
    await this.db.update((current) => {
      const normalized = this._normalizeWebhookStore(current);
      const webhooks = normalized.webhooks.map((record) => {
        if (Number(record.id) !== numericWebhookId || Number(record.userId) !== Number(user.id)) {
          return record;
        }

        updated = {
          ...record,
          name: Object.prototype.hasOwnProperty.call(input, "name") ? this._sanitizeName(input.name) : record.name,
          url: Object.prototype.hasOwnProperty.call(input, "url") ? this._sanitizeUrl(input.url) : record.url,
          eventTypes: Object.prototype.hasOwnProperty.call(input, "eventTypes")
            ? this._normalizeEventTypes(input.eventTypes)
            : record.eventTypes,
          enabled: Object.prototype.hasOwnProperty.call(input, "enabled")
            ? this._normalizeEnabled(input.enabled, record.enabled)
            : record.enabled,
          updatedAt: now,
        };

        return updated;
      });

      return {
        ...normalized,
        webhooks,
        updatedAt: now,
      };
    });

    return updated || existing;
  }

  async deleteWebhook(userId, webhookId) {
    const user = await this._ensureActiveUser(userId);
    const numericWebhookId = this._normalizeWebhookId(webhookId);
    await this._getOwnedWebhook(user.id, numericWebhookId);
    const now = new Date().toISOString();

    await this.db.update((current) => {
      const normalized = this._normalizeWebhookStore(current);
      return {
        ...normalized,
        webhooks: normalized.webhooks.filter(
          (record) => !(Number(record.id) === numericWebhookId && Number(record.userId) === Number(user.id)),
        ),
        updatedAt: now,
      };
    });

    return true;
  }

  async listDeliveries(userId, filters = {}) {
    const user = await this._ensureActiveUser(userId);
    const store = await this._getDeliveryStore();
    const webhookId = filters.webhookId != null ? this._normalizeWebhookId(filters.webhookId) : null;
    const eventType = typeof filters.eventType === "string" ? filters.eventType.trim() : "";
    const status = typeof filters.status === "string" ? filters.status.trim().toLowerCase() : "";
    const offset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
    const limit = Number.isInteger(filters.limit) ? Math.min(Math.max(filters.limit, 1), 200) : 50;

    let deliveries = store.deliveries.filter((record) => Number(record.userId) === Number(user.id));

    if (webhookId !== null) {
      deliveries = deliveries.filter((record) => Number(record.webhookId) === webhookId);
    }

    if (eventType) {
      deliveries = deliveries.filter((record) => record.eventType === eventType);
    }

    if (status) {
      deliveries = deliveries.filter((record) => record.status === status);
    }

    deliveries.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));

    return {
      items: deliveries.slice(offset, offset + limit),
      total: deliveries.length,
      limit,
      offset,
    };
  }

  async listActiveSubscriptionsForDelivery({ userId, eventType }) {
    if (userId == null || !eventType) {
      return [];
    }

    const store = await this._getWebhookStore();
    return store.webhooks
      .filter(
        (record) =>
          Number(record.userId) === Number(userId) &&
          record.enabled === true &&
          Array.isArray(record.eventTypes) &&
          record.eventTypes.includes(eventType),
      )
      .map((record) => ({
        id: Number(record.id),
        userId: Number(record.userId),
        name: record.name,
        url: record.url,
        eventTypes: [...record.eventTypes],
      }));
  }

  async recordDelivery(entry = {}) {
    const numericWebhookId = this._normalizeWebhookId(entry.webhookId);
    const now = new Date().toISOString();

    let created = null;
    await this.deliveryDb.update((current) => {
      const normalized = this._normalizeDeliveryStore(current);
      const nextDeliveryId = (normalized.counters.lastDeliveryId || 0) + 1;
      created = {
        id: nextDeliveryId,
        webhookId: numericWebhookId,
        userId: Number(entry.userId),
        eventType: typeof entry.eventType === "string" && entry.eventType.trim().length > 0 ? entry.eventType.trim() : "notification.event",
        status: this._normalizeDeliveryStatus(entry),
        attempts: Number.isInteger(entry.attempts) ? entry.attempts : Math.max(0, Number(entry.attempts) || 0),
        targetUrl: this._sanitizeOptionalUrl(entry.targetUrl || entry.url),
        requestPayload: entry.requestPayload && typeof entry.requestPayload === "object" ? entry.requestPayload : null,
        response: {
          statusCode: Number.isInteger(entry.responseStatusCode) ? entry.responseStatusCode : null,
          body: this._normalizeResponseBody(entry.responseBody),
          headers: this._normalizeHeaders(entry.responseHeaders),
        },
        reason: typeof entry.reason === "string" && entry.reason.trim().length > 0 ? entry.reason.trim() : null,
        correlationId: typeof entry.correlationId === "string" ? entry.correlationId : null,
        notificationId: typeof entry.notificationId === "string" ? entry.notificationId : null,
        durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : null,
        createdAt: now,
      };

      return {
        ...normalized,
        deliveries: [...normalized.deliveries, created],
        counters: {
          ...normalized.counters,
          lastDeliveryId: nextDeliveryId,
        },
        updatedAt: now,
      };
    });

    await this._touchWebhookState(created);
    return created;
  }

  async _touchWebhookState(delivery) {
    if (!delivery) {
      return;
    }

    await this.db.update((current) => {
      const normalized = this._normalizeWebhookStore(current);
      const webhooks = normalized.webhooks.map((record) => {
        if (Number(record.id) !== Number(delivery.webhookId) || Number(record.userId) !== Number(delivery.userId)) {
          return record;
        }

        return {
          ...record,
          lastTriggeredAt: delivery.createdAt,
          lastDeliveredAt: delivery.status === "delivered" ? delivery.createdAt : record.lastDeliveredAt,
          lastFailureAt: delivery.status === "failed" ? delivery.createdAt : record.lastFailureAt,
          updatedAt: delivery.createdAt,
        };
      });

      return {
        ...normalized,
        webhooks,
        updatedAt: delivery.createdAt,
      };
    });
  }

  async _getWebhookStore() {
    const current = await this.db.getAll();
    return this._normalizeWebhookStore(current);
  }

  async _getDeliveryStore() {
    const current = await this.deliveryDb.getAll();
    return this._normalizeDeliveryStore(current);
  }

  async _getOwnedWebhook(userId, webhookId) {
    const store = await this._getWebhookStore();
    const webhook = store.webhooks.find((record) => Number(record.id) === Number(webhookId) && Number(record.userId) === Number(userId));

    if (!webhook) {
      throw new Error("Webhook not found");
    }

    return webhook;
  }

  async _ensureActiveUser(userId) {
    if (!this.userDataInstance) {
      const UserDataSingleton = require("../data/user-data-singleton");
      this.userDataInstance = UserDataSingleton.getInstance();
    }

    const user = await this.userDataInstance.findUser(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (user.isActive !== true) {
      throw new Error("Account is deactivated");
    }

    return user;
  }

  _normalizeWebhookStore(current) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { ...DEFAULT_WEBHOOK_STORE };
    }

    return {
      version: Number(current.version) || DEFAULT_WEBHOOK_STORE.version,
      webhooks: Array.isArray(current.webhooks)
        ? current.webhooks
            .filter((record) => record && typeof record === "object")
            .map((record) => ({
              id: Number(record.id),
              userId: Number(record.userId),
              name: this._sanitizeName(record.name, { allowDefault: true }),
              url: this._sanitizeUrl(record.url),
              eventTypes: this._normalizeEventTypes(record.eventTypes),
              enabled: this._normalizeEnabled(record.enabled, true),
              createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
              updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
              lastTriggeredAt: typeof record.lastTriggeredAt === "string" ? record.lastTriggeredAt : null,
              lastDeliveredAt: typeof record.lastDeliveredAt === "string" ? record.lastDeliveredAt : null,
              lastFailureAt: typeof record.lastFailureAt === "string" ? record.lastFailureAt : null,
            }))
            .filter((record) => Number.isInteger(record.id) && record.id > 0 && Number.isInteger(record.userId) && record.userId > 0)
        : [],
      counters: {
        lastWebhookId: Number(current.counters?.lastWebhookId) || 0,
      },
      updatedAt: typeof current.updatedAt === "string" ? current.updatedAt : null,
    };
  }

  _normalizeDeliveryStore(current) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { ...DEFAULT_DELIVERY_STORE };
    }

    return {
      version: Number(current.version) || DEFAULT_DELIVERY_STORE.version,
      deliveries: Array.isArray(current.deliveries)
        ? current.deliveries
            .filter((record) => record && typeof record === "object")
            .map((record) => ({
              id: Number(record.id),
              webhookId: Number(record.webhookId),
              userId: Number(record.userId),
              eventType: typeof record.eventType === "string" ? record.eventType : "notification.event",
              status: typeof record.status === "string" ? record.status : "failed",
              attempts: Number(record.attempts) || 0,
              targetUrl: this._sanitizeOptionalUrl(record.targetUrl),
              requestPayload: record.requestPayload && typeof record.requestPayload === "object" ? record.requestPayload : null,
              response: {
                statusCode: Number.isInteger(record.response?.statusCode) ? record.response.statusCode : null,
                body: this._normalizeResponseBody(record.response?.body),
                headers: this._normalizeHeaders(record.response?.headers),
              },
              reason: typeof record.reason === "string" ? record.reason : null,
              correlationId: typeof record.correlationId === "string" ? record.correlationId : null,
              notificationId: typeof record.notificationId === "string" ? record.notificationId : null,
              durationMs: Number.isFinite(record.durationMs) ? Math.max(0, Math.round(record.durationMs)) : null,
              createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
            }))
            .filter(
              (record) =>
                Number.isInteger(record.id) &&
                record.id > 0 &&
                Number.isInteger(record.webhookId) &&
                record.webhookId > 0 &&
                Number.isInteger(record.userId) &&
                record.userId > 0,
            )
        : [],
      counters: {
        lastDeliveryId: Number(current.counters?.lastDeliveryId) || 0,
      },
      updatedAt: typeof current.updatedAt === "string" ? current.updatedAt : null,
    };
  }

  _sanitizeName(name, options = {}) {
    const allowDefault = options.allowDefault !== false;
    const normalized = typeof name === "string" ? name.trim() : "";

    if (!normalized) {
      if (allowDefault) {
        return DEFAULT_WEBHOOK_NAME;
      }
      throw new Error("Validation failed: webhook name is required");
    }

    if (normalized.length > MAX_NAME_LENGTH) {
      throw new Error(`Validation failed: webhook name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }

    return normalized;
  }

  _sanitizeUrl(url) {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("Validation failed: webhook url is required");
    }

    return this._sanitizeOptionalUrl(url);
  }

  _sanitizeOptionalUrl(url) {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("Validation failed: webhook url is required");
    }

    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error("Validation failed: webhook url must be a valid absolute URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Validation failed: webhook url must use http or https");
    }

    return parsed.toString();
  }

  _normalizeEventTypes(eventTypes) {
    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      throw new Error("Validation failed: at least one webhook event type is required");
    }

    const supportedEventTypes = new Set(webhookEventCatalogService.getSupportedEventTypes());
    const normalized = [];

    for (const eventType of eventTypes) {
      if (typeof eventType !== "string") {
        throw new Error("Validation failed: webhook event types must be strings");
      }

      const candidate = eventType.trim();
      if (!candidate) {
        continue;
      }

      if (!supportedEventTypes.has(candidate)) {
        throw new Error(`Validation failed: unsupported webhook event type \"${eventType}\"`);
      }

      if (!normalized.includes(candidate)) {
        normalized.push(candidate);
      }
    }

    if (normalized.length === 0) {
      throw new Error("Validation failed: at least one webhook event type is required");
    }

    return normalized;
  }

  _normalizeEnabled(value, fallback) {
    if (value == null) {
      return fallback === true;
    }

    if (typeof value !== "boolean") {
      throw new Error("Validation failed: enabled must be a boolean");
    }

    return value;
  }

  _normalizeWebhookId(webhookId) {
    const normalized = Number.parseInt(webhookId, 10);
    if (!Number.isInteger(normalized) || normalized <= 0) {
      throw new Error("Validation failed: invalid webhook id");
    }

    return normalized;
  }

  _normalizeDeliveryStatus(entry) {
    if (entry?.success === true) {
      return "delivered";
    }

    if (entry?.skipped === true) {
      return "skipped";
    }

    return "failed";
  }

  _normalizeResponseBody(value) {
    if (value == null) {
      return null;
    }

    if (typeof value === "string") {
      return value.length > MAX_RESPONSE_BODY_LENGTH ? `${value.slice(0, MAX_RESPONSE_BODY_LENGTH)}…` : value;
    }

    if (typeof value === "object") {
      const serialized = JSON.stringify(value);
      if (!serialized) {
        return null;
      }
      return serialized.length > MAX_RESPONSE_BODY_LENGTH ? `${serialized.slice(0, MAX_RESPONSE_BODY_LENGTH)}…` : serialized;
    }

    return String(value);
  }

  _normalizeHeaders(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => typeof key === "string" && key.trim().length > 0)
        .map(([key, headerValue]) => [key, Array.isArray(headerValue) ? headerValue.join(", ") : String(headerValue)]),
    );
  }
}

module.exports = new WebhookService();
