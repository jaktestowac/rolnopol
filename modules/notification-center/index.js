const { initializeNotificationCenter } = require("./bootstrap");

const NOOP_PUBLISHER = {
  isEnabled: () => false,
  publish: () => null,
};

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
let refreshPromise = null;

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
  stop: async () => {},
};

async function initialize(options = {}) {
  featureFlagsServiceRef = options.featureFlagsService || featureFlagsServiceRef;
  moduleState = await initializeNotificationCenter(options);
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
    moduleState = await initializeNotificationCenter({ featureFlagsService: featureFlagsServiceRef });
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

async function stop() {
  refreshPromise = null;
  await moduleState.stop();
}

function isEnabled() {
  return moduleState.enabled === true;
}

function _resetForTests() {
  featureFlagsServiceRef = null;
  refreshPromise = null;
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
  stop,
  isEnabled,
  _resetForTests,
};
