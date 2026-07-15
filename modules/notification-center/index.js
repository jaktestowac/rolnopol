const { initializeNotificationCenter } = require("./bootstrap");

const NOOP_PUBLISHER = {
  isEnabled: () => false,
  publish: () => null,
};

const NOOP_SUBSCRIBE = () => () => {};

function _normalizeEvent(event = {}, defaults = {}) {
  const safeEvent = event && typeof event === "object" ? event : {};
  const fallbackSource =
    typeof defaults.source === "string" && defaults.source.trim().length > 0 ? defaults.source : "notification-center-api";

  return {
    ...safeEvent,
    type: typeof safeEvent.type === "string" ? safeEvent.type : "",
    source: typeof safeEvent.source === "string" && safeEvent.source.trim().length > 0 ? safeEvent.source : fallbackSource,
    payload: safeEvent.payload && typeof safeEvent.payload === "object" ? safeEvent.payload : {},
  };
}

let featureFlagsServiceRef = null;
let webhookServiceRef = null;
let refreshPromise = null;
const eventSubscriptions = [];

function _unbindEventSubscription(record) {
  if (!record) {
    return;
  }

  if (typeof record.unsubscribe === "function") {
    try {
      record.unsubscribe();
    } catch {
      // best-effort cleanup
    }
  }

  record.unsubscribe = null;
  record.boundState = null;
}

function _bindEventSubscription(record) {
  if (!record || typeof record.handler !== "function") {
    return;
  }

  const subscribe = moduleState?.subscribeEvents;
  if (typeof subscribe !== "function") {
    return;
  }

  if (record.boundState === moduleState && typeof record.unsubscribe === "function") {
    return;
  }

  _unbindEventSubscription(record);

  try {
    const unsubscribe = subscribe(record.handler);
    record.unsubscribe = typeof unsubscribe === "function" ? unsubscribe : NOOP_SUBSCRIBE();
    record.boundState = moduleState;
  } catch {
    record.unsubscribe = null;
    record.boundState = null;
  }
}

function _syncEventSubscriptions() {
  for (const record of eventSubscriptions) {
    _bindEventSubscription(record);
  }
}

function _clearEventSubscriptions() {
  for (const record of eventSubscriptions) {
    _unbindEventSubscription(record);
  }
}

let moduleState = {
  enabled: false,
  degraded: false,
  eventPublisher: NOOP_PUBLISHER,
  listEvents: async () => ({ items: [], total: 0, limit: 50, offset: 0, module: { enabled: false, degraded: false } }),
  triggerTestEvent: async (payload = {}) => ({
    accepted: false,
    correlationId: null,
    reason: "notification_center_disabled",
    event: {
      type: "notification.test.triggered",
      source: "notification-center-api",
      payload: payload && typeof payload === "object" ? payload : {},
    },
  }),
  getHealth: async () => ({ status: "disabled", module: { enabled: false, degraded: false, version: "1.0.0" } }),
  subscribeRealtime: () => () => {},
  subscribeEvents: NOOP_SUBSCRIBE,
  stop: async () => {},
};

async function initialize(options = {}) {
  featureFlagsServiceRef = options.featureFlagsService || featureFlagsServiceRef;
  webhookServiceRef = options.webhookService || webhookServiceRef;
  moduleState = await initializeNotificationCenter({ ...options, webhookService: webhookServiceRef });
  _syncEventSubscriptions();
  return moduleState;
}

async function _getCurrentFeatureFlagValue() {
  if (!featureFlagsServiceRef || typeof featureFlagsServiceRef.getFeatureFlags !== "function") {
    return moduleState.enabled === true;
  }

  try {
    const data = await featureFlagsServiceRef.getFeatureFlags();
    return data?.flags?.notificationCenterEnabled === true;
  } catch {
    return false;
  }
}

async function _refreshStateFromFeatureFlagIfNeeded() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const shouldBeEnabled = await _getCurrentFeatureFlagValue();
    const isEnabledNow = moduleState.enabled === true;

    if (shouldBeEnabled === isEnabledNow && moduleState.degraded !== true) {
      return;
    }

    await moduleState.stop();
    moduleState = await initializeNotificationCenter({ featureFlagsService: featureFlagsServiceRef, webhookService: webhookServiceRef });
    _syncEventSubscriptions();
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function getEventPublisher() {
  return moduleState?.eventPublisher || NOOP_PUBLISHER;
}

async function getHealth() {
  await _refreshStateFromFeatureFlagIfNeeded();
  return moduleState.getHealth();
}

async function getEvents(filters = {}) {
  await _refreshStateFromFeatureFlagIfNeeded();
  return moduleState.listEvents(filters);
}

async function triggerTestEvent(payload = {}) {
  await _refreshStateFromFeatureFlagIfNeeded();
  return moduleState.triggerTestEvent(payload);
}

async function publish(event = {}, options = {}) {
  await _refreshStateFromFeatureFlagIfNeeded();
  const normalizedEvent = _normalizeEvent(event, options);
  const eventPublisher = getEventPublisher();

  if (!normalizedEvent.type) {
    return {
      accepted: false,
      correlationId: null,
      reason: "invalid_event_type",
      event: normalizedEvent,
    };
  }

  if (!eventPublisher.isEnabled()) {
    return {
      accepted: false,
      correlationId: null,
      reason: "notification_center_disabled",
      event: normalizedEvent,
    };
  }

  const correlationId = eventPublisher.publish(normalizedEvent);

  return {
    accepted: Boolean(correlationId),
    correlationId,
    event: normalizedEvent,
  };
}

async function publishEvent(eventType = "", payload = {}) {
  return publish({
    type: eventType,
    source: "notification-center-api",
    payload: payload && typeof payload === "object" ? payload : {},
  });
}

function subscribeRealtime(handler) {
  const subscribe = moduleState?.subscribeRealtime;
  if (typeof subscribe !== "function") {
    return () => {};
  }

  return subscribe(handler);
}

function subscribeEvents(handler) {
  if (typeof handler !== "function") {
    return () => {};
  }

  const record = {
    handler,
    unsubscribe: null,
    boundState: null,
  };

  eventSubscriptions.push(record);
  _bindEventSubscription(record);

  return () => {
    const index = eventSubscriptions.indexOf(record);
    if (index >= 0) {
      eventSubscriptions.splice(index, 1);
    }

    _unbindEventSubscription(record);
  };
}

async function stop() {
  refreshPromise = null;
  _clearEventSubscriptions();
  await moduleState.stop();
}

function isEnabled() {
  return moduleState.enabled === true;
}

function _resetForTests() {
  featureFlagsServiceRef = null;
  webhookServiceRef = null;
  refreshPromise = null;
  _clearEventSubscriptions();
  moduleState = {
    enabled: false,
    degraded: false,
    eventPublisher: NOOP_PUBLISHER,
    listEvents: async () => ({ items: [], total: 0, limit: 50, offset: 0, module: { enabled: false, degraded: false } }),
    triggerTestEvent: async (payload = {}) => ({
      accepted: false,
      correlationId: null,
      reason: "notification_center_disabled",
      event: {
        type: "notification.test.triggered",
        source: "notification-center-api",
        payload: payload && typeof payload === "object" ? payload : {},
      },
    }),
    getHealth: async () => ({ status: "disabled", module: { enabled: false, degraded: false, version: "1.0.0" } }),
    subscribeRealtime: () => () => {},
    subscribeEvents: NOOP_SUBSCRIBE,
    stop: async () => {},
  };
}

module.exports = {
  initialize,
  getEventPublisher,
  getHealth,
  getEvents,
  triggerTestEvent,
  publish,
  publishEvent,
  subscribeRealtime,
  subscribeEvents,
  stop,
  isEnabled,
  _resetForTests,
};
