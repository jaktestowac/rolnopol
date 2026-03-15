const { randomUUID } = require("crypto");
const { logInfo, logError } = require("../../../helpers/logger-api");

class NotificationDispatcher {
  constructor(eventBus, deps, config = {}) {
    this.eventBus = eventBus;
    this.policyRouter = deps.policyRouter;
    this.eventStore = deps.eventStore;
    this.notificationStore = deps.notificationStore;
    this.inAppDispatcher = deps.inAppDispatcher;
    this.webhookDispatcher = deps.webhookDispatcher;
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    this.queue = [];
    this.queueSequence = 0;
    this.processing = false;
    this.started = false;
    this.tickMs = config.tickMs || 5000;
    this.batchSize = config.batchSize || 10;
    this.handlingDelayMs = config.handlingDelayMs || 1000;
    this.batchDelayMs = config.batchDelayMs || 0;
    this.defaultProcessingDelayMs = config.defaultProcessingDelayMs || 1500;
    this.receivedToProcessingGlobalDelayMs = config.receivedToProcessingGlobalDelayMs || 0;
    this.maxQueueSize = config.maxQueueSize || 10000;
    this.unsubscribe = null;
    this.intervalId = null;
    this.metrics = {
      events_received: 0,
      events_processed: 0,
      events_failed: 0,
      notifications_delivered: 0,
      notifications_failed: 0,
      avgProcessingTimeMs: 0,
      processingSamples: 0,
    };
  }

  start() {
    if (this.started) return;
    this.started = true;

    this.unsubscribe = this.eventBus.subscribe((event) => {
      this.metrics.events_received += 1;
      const queueItem = {
        queueId: `enq-${++this.queueSequence}`,
        enqueuedAt: new Date().toISOString(),
        event,
      };

      if (this.queue.length >= this.maxQueueSize) {
        this.queue.shift();
      }
      this.queue.push(queueItem);
    });

    this.intervalId = setInterval(() => {
      this._processQueue().catch((error) => {
        logError("NotificationDispatcher queue tick failed", { error: error.message });
      });
    }, this.tickMs);

    logInfo("NotificationDispatcher started", { tickMs: this.tickMs, batchSize: this.batchSize });
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    await this._processQueue();
  }

  async _processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    try {
      const batch = this.queue.splice(0, this.batchSize);
      for (const queueItem of batch) {
        await this._handleEvent(queueItem);
      }
      if (this.batchDelayMs > 0) {
        await this.sleep(this.batchDelayMs);
      }
    } finally {
      this.processing = false;
    }
  }

  async _handleEvent(queueItem) {
    const normalizedQueueItem =
      queueItem && queueItem.event
        ? queueItem
        : {
            queueId: `enq-${++this.queueSequence}`,
            enqueuedAt: new Date().toISOString(),
            event: queueItem,
          };

    const event = normalizedQueueItem.event;
    const startedAt = Date.now();
    const storedEvent = await this.eventStore.add(event, "received");

    try {
      // Resolve policy early to get per-event-type delay
      const policy = this.policyRouter.resolve(event);
      const eventTypeDelay = policy?.processingDelayMs ?? null;
      const processingDelay = eventTypeDelay !== null ? Math.max(1500, eventTypeDelay) : this.defaultProcessingDelayMs;
      const receivedToProcessingDelay = processingDelay + this.receivedToProcessingGlobalDelayMs;

      // Keep event in "received" state for a visible, configurable amount of time.
      if (receivedToProcessingDelay > 0) {
        await this.sleep(receivedToProcessingDelay);
      }

      await this.eventStore.updateStatus(storedEvent.id, "processing");

      // Optional post-transition handling delay (kept for backward compatibility).
      if (this.handlingDelayMs > 0) {
        await this.sleep(this.handlingDelayMs);
      }

      if (this._shouldForceFail(event)) {
        throw new Error(this._getForcedFailReason(event));
      }

      if (!policy) {
        await this.eventStore.updateStatus(storedEvent.id, "processed", {
          note: "policy_not_found",
        });
        this.metrics.events_processed += 1;
        this._trackProcessingTime(startedAt);
        return;
      }

      const notification = this._createNotification(event, policy);
      const storedNotification = await this.notificationStore.add({ ...notification, status: "pending" });

      await this.eventStore.updateStatus(storedEvent.id, "processing", { relatedNotificationId: storedNotification.id });
      await this.notificationStore.updateStatus(storedNotification.id, "in_progress", { startedAt: new Date().toISOString() });

      const channelResults = await this._dispatchToChannels(storedNotification);
      const allDelivered = channelResults.every((x) => x.status === "delivered" || x.status === "skipped");

      const finalStatus = allDelivered ? "delivered" : "failed";
      await this.notificationStore.updateStatus(storedNotification.id, finalStatus, {
        sentAt: new Date().toISOString(),
      });

      await this.eventStore.updateStatus(storedEvent.id, allDelivered ? "processed" : "failed", {
        relatedNotificationId: storedNotification.id,
      });

      if (allDelivered) {
        this.metrics.notifications_delivered += 1;
      } else {
        this.metrics.notifications_failed += 1;
      }

      this.metrics.events_processed += 1;
      this._trackProcessingTime(startedAt);
    } catch (error) {
      this.metrics.events_failed += 1;
      await this.eventStore.updateStatus(storedEvent.id, "failed", { error: error.message });
      this._trackProcessingTime(startedAt);
      logError("NotificationDispatcher failed to handle event", { eventType: event.type, error: error.message });
    }
  }

  _shouldForceFail(event) {
    const value = event?.payload?.forceFail;

    if (value === true) return true;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "fail";
    }

    return false;
  }

  _getForcedFailReason(event) {
    const reason = event?.payload?.forceFailReason;
    if (typeof reason === "string" && reason.trim().length > 0) {
      return `forced_fail:${reason.trim()}`;
    }
    return "forced_fail:payload.forceFail";
  }

  _createNotification(event, policy) {
    const rendered = policy.template(event);
    const userId = event.payload?.userId || event.payload?.toUserId || event.payload?.buyerId || event.payload?.staffId;

    return {
      id: `notif-${randomUUID()}`,
      correlationId: event.correlationId,
      userId,
      title: rendered.title,
      message: rendered.message,
      channels: policy.channels.map((name) => ({ name, status: "queued" })),
      createdAt: new Date().toISOString(),
      sentAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        eventType: event.type,
        policyApplied: policy.id,
        priority: policy.priority,
      },
    };
  }

  async _dispatchToChannels(notification) {
    const results = [];
    for (const channel of notification.channels) {
      if (channel.name === "in-app") {
        const result = await this.inAppDispatcher.dispatch(notification);
        await this.notificationStore.updateChannelStatus(notification.id, "in-app", result.success ? "delivered" : "failed", {
          deliveredAt: result.deliveredAt || null,
          reason: result.reason || null,
        });
        results.push({ channel: "in-app", status: result.success ? "delivered" : "failed" });
        continue;
      }

      if (channel.name === "webhook") {
        const result = await this.webhookDispatcher.dispatch(notification);
        const status = result.success ? "delivered" : result.skipped ? "skipped" : "failed";
        await this.notificationStore.updateChannelStatus(notification.id, "webhook", status, {
          attempts: result.attempts || 0,
          reason: result.reason || null,
        });
        results.push({ channel: "webhook", status });
      }
    }
    return results;
  }

  _trackProcessingTime(startedAtMs) {
    const duration = Date.now() - startedAtMs;
    this.metrics.processingSamples += 1;
    const n = this.metrics.processingSamples;
    this.metrics.avgProcessingTimeMs = Math.round((this.metrics.avgProcessingTimeMs * (n - 1) + duration) / n);
  }

  getQueueLength() {
    return this.queue.length;
  }

  getEnqueuedEvents(filters = {}) {
    const normalizedStatusFilter = typeof filters.status === "string" ? filters.status.trim().toLowerCase() : undefined;

    if (normalizedStatusFilter && normalizedStatusFilter !== "enqueued") {
      return [];
    }

    let items = this.queue.map((queueItem) => ({
      id: queueItem.queueId,
      type: queueItem.event?.type,
      status: "enqueued",
      correlationId: queueItem.event?.correlationId,
      timestamp: queueItem.event?.timestamp,
      payload: queueItem.event?.payload,
      source: queueItem.event?.source,
      version: queueItem.event?.version || 1,
      timeline: [{ status: "enqueued", at: queueItem.enqueuedAt }],
      error: null,
      relatedNotificationId: null,
      note: "in_memory_queue",
    }));

    if (filters.type) {
      items = items.filter((event) => event.type === filters.type);
    }

    if (filters.correlationId) {
      items = items.filter((event) => event.correlationId === filters.correlationId);
    }

    items.sort((a, b) => {
      const aTs = new Date(a.timestamp || 0).getTime();
      const bTs = new Date(b.timestamp || 0).getTime();
      return bTs - aTs;
    });

    return items;
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = NotificationDispatcher;
