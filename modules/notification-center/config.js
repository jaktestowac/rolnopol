const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback = 1) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const speedFactor = Math.max(0.1, toFloat(process.env.PROCESSING_SPEED_FACTOR, 1));
const globalDelay = Math.max(0, toInt(process.env.GLOBAL_PROCESSING_DELAY_MS, 0));

const applyDelayFactor = (base) => Math.max(0, Math.round((globalDelay + Math.max(0, base)) * speedFactor));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

module.exports = {
  enabledFromEnv: process.env.NOTIFICATION_CENTER_ENABLED,
  processingSpeedFactor: speedFactor,
  globalProcessingDelayMs: globalDelay,
  eventBus: {
    processingDelayMs: applyDelayFactor(toInt(process.env.EVENT_PROCESSING_DELAY, 0)),
    maxListeners: 100,
  },
  dispatcher: {
    handlingDelayMs: applyDelayFactor(toInt(process.env.NOTIFICATION_HANDLING_DELAY, 1000)),
    batchDelayMs: applyDelayFactor(toInt(process.env.BATCH_DELAY_MS, 500)),
    batchSize: Math.max(1, toInt(process.env.NOTIFICATION_BATCH_SIZE, 5)),
    tickMs: Math.max(100, toInt(process.env.NOTIFICATION_TICK_MS, 5000)),
    defaultProcessingDelayMs: Math.max(1500, applyDelayFactor(toInt(process.env.DEFAULT_PROCESSING_DELAY_MS, 1000))),
    receivedToProcessingGlobalDelayMs: Math.max(0, applyDelayFactor(toInt(process.env.RECEIVED_TO_PROCESSING_GLOBAL_DELAY_MS, 250))),
  },
  channels: {
    inApp: {
      storeDelayMs: applyDelayFactor(toInt(process.env.INAPP_STORE_DELAY, 0)),
    },
    webhook: {
      sendDelayMs: applyDelayFactor(toInt(process.env.WEBHOOK_SEND_DELAY, 0)),
      timeoutMs: Math.max(500, toInt(process.env.WEBHOOK_TIMEOUT_MS, 3000)),
      maxRetries: Math.max(1, toInt(process.env.WEBHOOK_MAX_RETRIES, 3)),
      baseBackoffMs: Math.max(50, toInt(process.env.WEBHOOK_BACKOFF_MS, 250)),
      url: process.env.NOTIFICATION_WEBHOOK_URL || null,
    },
  },
  sleep,
};
