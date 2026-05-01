// Global test setup: speed up notification-center internals for test runs
// These defaults can be overridden by CI or developer environment variables.
process.env.MIN_PROCESSING_DELAY_MS = process.env.MIN_PROCESSING_DELAY_MS || "0";
process.env.PROCESSING_SPEED_FACTOR = process.env.PROCESSING_SPEED_FACTOR || "0.1";
process.env.GLOBAL_PROCESSING_DELAY_MS = process.env.GLOBAL_PROCESSING_DELAY_MS || "0";
process.env.NOTIFICATION_TICK_MS = process.env.NOTIFICATION_TICK_MS || "200";
process.env.NOTIFICATION_HANDLING_DELAY = process.env.NOTIFICATION_HANDLING_DELAY || "10";
process.env.BATCH_DELAY_MS = process.env.BATCH_DELAY_MS || "10";
process.env.DEFAULT_PROCESSING_DELAY_MS = process.env.DEFAULT_PROCESSING_DELAY_MS || "10";
process.env.RECEIVED_TO_PROCESSING_GLOBAL_DELAY_MS = process.env.RECEIVED_TO_PROCESSING_GLOBAL_DELAY_MS || "0";
process.env.WEBHOOK_SEND_DELAY = process.env.WEBHOOK_SEND_DELAY || "0";
process.env.WEBHOOK_TIMEOUT_MS = process.env.WEBHOOK_TIMEOUT_MS || "500";

module.exports = {};
