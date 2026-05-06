const { logError, logInfo } = require("../../helpers/logger-api");
const { randomUUID } = require("crypto");
const { EventEmitter } = require("events");
const config = require("./config");
const EventPublisher = require("./ingress/event-publisher");
const { NotificationEventBus } = require("./ingress/event-bus");
const policies = require("./core/policies");
const PolicyRouter = require("./core/policy-router");
const NotificationDispatcher = require("./core/notification-dispatcher");
const EventStore = require("./store/event-store");
const NotificationStore = require("./store/notification-store");
const InAppDispatcher = require("./channels/in-app-dispatcher");
const WebhookDispatcher = require("./channels/webhook-dispatcher");
const webhookService = require("../../services/webhook.service");

const createNoopPublisher = () => ({
  isEnabled: () => false,
  publish: () => null,
});

const createRealtimeBridge = () => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(config.eventBus?.maxListeners || 100);

  return {
    emit(packet) {
      emitter.emit("realtime-update", packet);
    },
    subscribe(handler) {
      if (typeof handler !== "function") {
        return () => {};
      }

      emitter.on("realtime-update", handler);
      return () => emitter.off("realtime-update", handler);
    },
  };
};

const buildVisibleEventKey = (event = {}) => {
  const correlationId = typeof event?.correlationId === "string" ? event.correlationId.trim() : "";
  if (!correlationId) {
    return null;
  }

  return [correlationId, event?.type || "", event?.source || ""].join("::");
};

const mergeVisibleEvents = (persisted = [], enqueued = []) => {
  const persistedKeys = new Set(persisted.map((event) => buildVisibleEventKey(event)).filter(Boolean));

  const filteredEnqueued = enqueued.filter((event) => {
    if (event?.status !== "enqueued") {
      return true;
    }

    const key = buildVisibleEventKey(event);
    return !(key && persistedKeys.has(key));
  });

  return [...persisted, ...filteredEnqueued].sort((a, b) => {
    const aTs = new Date(a.timestamp || 0).getTime();
    const bTs = new Date(b.timestamp || 0).getTime();
    return bTs - aTs;
  });
};

async function shouldEnable(featureFlagsService) {
  const envValue = config.enabledFromEnv;
  if (typeof envValue === "string") {
    return envValue === "1" || envValue.toLowerCase() === "true";
  }

  try {
    const data = await featureFlagsService.getFeatureFlags();
    return data?.flags?.notificationCenterEnabled === true;
  } catch {
    return false;
  }
}

async function initializeNotificationCenter({ featureFlagsService } = {}) {
  const enabled = await shouldEnable(featureFlagsService);

  if (!enabled) {
    const eventStore = new EventStore();
    logInfo("Notification center initialized in no-op mode (disabled)");
    return {
      enabled: false,
      degraded: false,
      eventPublisher: createNoopPublisher(),
      listEvents: async (filters = {}) => {
        const result = await eventStore.list(filters);
        return {
          ...result,
          module: { enabled: false, degraded: false },
        };
      },
      triggerTestEvent: async (payload = {}) => {
        const safePayload = payload && typeof payload === "object" ? payload : {};
        const correlationId = String(safePayload.correlationId || randomUUID());
        const event = {
          type: "notification.test.triggered",
          timestamp: new Date().toISOString(),
          source: "notification-center-api",
          correlationId,
          payload: {
            userId: safePayload.userId || "test-user",
            ...safePayload,
          },
        };

        await eventStore.add(event, "processed");

        return {
          accepted: false,
          stored: true,
          correlationId,
          reason: "notification_center_disabled",
          event,
        };
      },
      getHealth: async () => {
        const eventStats = await eventStore.stats();
        return {
          status: "disabled",
          module: { enabled: false, degraded: false, version: "1.0.0" },
          events: eventStats,
          notifications: { total: 0, pending: 0, in_progress: 0, delivered: 0, failed: 0 },
          queue: { length: 0, avgProcessingTime: 0 },
        };
      },
      subscribeRealtime: () => () => {},
      subscribeEvents: () => () => {},
      stop: async () => {},
    };
  }

  try {
    const realtimeBridge = createRealtimeBridge();
    const eventBus = new NotificationEventBus({ enabled: true, ...config.eventBus });
    const eventPublisher = new EventPublisher(eventBus, { enabled: true, asyncMode: true, source: "rolnopol-app" });
    const policyRouter = new PolicyRouter(policies);
    const eventStore = new EventStore({
      onChange: (packet) => realtimeBridge.emit(packet),
    });
    const notificationStore = new NotificationStore({
      onChange: (packet) => realtimeBridge.emit(packet),
    });
    const inAppDispatcher = new InAppDispatcher(config.channels.inApp, { sleep: config.sleep });
    const webhookDispatcher = new WebhookDispatcher(config.channels.webhook, {
      sleep: config.sleep,
      resolveSubscriptions: ({ userId, eventType }) => webhookService.listActiveSubscriptionsForDelivery({ userId, eventType }),
      recordDelivery: (entry) => webhookService.recordDelivery(entry),
    });
    const dispatcher = new NotificationDispatcher(
      eventBus,
      {
        policyRouter,
        eventStore,
        notificationStore,
        inAppDispatcher,
        webhookDispatcher,
        sleep: config.sleep,
      },
      config.dispatcher,
    );
    dispatcher.start();

    logInfo("Notification center initialized and enabled");

    return {
      enabled: true,
      degraded: false,
      eventPublisher,
      dispatcher,
      eventStore,
      notificationStore,
      listEvents: async (filters = {}) => {
        const persisted = await eventStore.listAll(filters);
        const enqueued = dispatcher.getEnqueuedEvents(filters);
        const merged = mergeVisibleEvents(persisted, enqueued);

        const offset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
        const limit = Number.isInteger(filters.limit) ? Math.min(Math.max(filters.limit, 1), 200) : 50;

        return {
          items: merged.slice(offset, offset + limit),
          total: merged.length,
          limit,
          offset,
          module: { enabled: true, degraded: false },
        };
      },
      triggerTestEvent: async (payload = {}) => {
        const safePayload = payload && typeof payload === "object" ? payload : {};
        const correlationId = eventPublisher.publish({
          type: "notification.test.triggered",
          source: "notification-center-api",
          payload: {
            userId: safePayload.userId || "test-user",
            ...safePayload,
          },
        });

        return {
          accepted: Boolean(correlationId),
          correlationId,
          event: {
            type: "notification.test.triggered",
            source: "notification-center-api",
            payload: {
              userId: safePayload.userId || "test-user",
              ...safePayload,
            },
          },
        };
      },
      getHealth: async () => {
        const eventStats = await eventStore.stats();
        const notificationStats = await notificationStore.stats();
        const metrics = dispatcher.getMetrics();

        return {
          status: "healthy",
          module: {
            enabled: true,
            degraded: false,
            version: "1.0.0",
          },
          events: eventStats,
          notifications: notificationStats,
          queue: {
            length: dispatcher.getQueueLength(),
            avgProcessingTime: metrics.avgProcessingTimeMs,
          },
          metrics,
        };
      },
      subscribeRealtime: (handler) => realtimeBridge.subscribe(handler),
      subscribeEvents: (handler) => eventBus.subscribe(handler),
      stop: async () => {
        await dispatcher.stop();
      },
    };
  } catch (error) {
    logError("Notification center failed to initialize, switching to degraded mode", { error: error.message });
    const eventStore = new EventStore();
    return {
      enabled: false,
      degraded: true,
      eventPublisher: createNoopPublisher(),
      listEvents: async (filters = {}) => {
        const result = await eventStore.list(filters);
        return {
          ...result,
          module: { enabled: false, degraded: true },
        };
      },
      triggerTestEvent: async (payload = {}) => {
        const safePayload = payload && typeof payload === "object" ? payload : {};
        const correlationId = String(safePayload.correlationId || randomUUID());
        const event = {
          type: "notification.test.triggered",
          timestamp: new Date().toISOString(),
          source: "notification-center-api",
          correlationId,
          payload: {
            userId: safePayload.userId || "test-user",
            ...safePayload,
          },
        };

        await eventStore.add(event, "failed");

        return {
          accepted: false,
          stored: true,
          correlationId,
          reason: "notification_center_degraded",
          event,
        };
      },
      getHealth: async () => {
        const eventStats = await eventStore.stats();
        return {
          status: "degraded",
          module: { enabled: false, degraded: true, version: "1.0.0" },
          events: eventStats,
          error: error.message,
        };
      },
      subscribeRealtime: () => () => {},
      subscribeEvents: () => () => {},
      stop: async () => {},
    };
  }
}

module.exports = {
  initializeNotificationCenter,
  _mergeVisibleEvents: mergeVisibleEvents,
};
