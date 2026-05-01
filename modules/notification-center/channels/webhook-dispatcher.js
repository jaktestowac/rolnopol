const http = require("http");
const https = require("https");

class WebhookDispatcher {
  constructor(config = {}, helpers = {}) {
    this.sendDelayMs = config.sendDelayMs || 0;
    this.timeoutMs = config.timeoutMs || 3000;
    this.maxRetries = config.maxRetries || 3;
    this.baseBackoffMs = config.baseBackoffMs || 250;
    this.defaultUrl = config.url || null;
    this.sleep = helpers.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.resolveSubscriptions = typeof helpers.resolveSubscriptions === "function" ? helpers.resolveSubscriptions : null;
    this.recordDelivery = typeof helpers.recordDelivery === "function" ? helpers.recordDelivery : async () => null;
  }

  async dispatch(notification, webhookUrl = null) {
    const targetUrl = webhookUrl || this.defaultUrl;
    if (targetUrl) {
      return this._dispatchSingleTarget(notification, {
        id: null,
        userId: notification?.userId ?? null,
        url: targetUrl,
      });
    }

    const userId = notification?.userId;
    const eventType = notification?.metadata?.eventType || "notification.event";

    if (userId == null || userId === "") {
      return {
        success: false,
        channel: "webhook",
        skipped: true,
        reason: "webhook_user_missing",
        attempts: 0,
        deliveries: [],
      };
    }

    if (!this.resolveSubscriptions) {
      return {
        success: false,
        channel: "webhook",
        skipped: true,
        reason: "webhook_url_missing",
        attempts: 0,
        deliveries: [],
      };
    }

    const subscriptions = await this.resolveSubscriptions({
      notification,
      userId,
      eventType,
    });

    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return {
        success: false,
        channel: "webhook",
        skipped: true,
        reason: "webhook_subscription_missing",
        attempts: 0,
        deliveries: [],
      };
    }

    const deliveries = [];
    for (const subscription of subscriptions) {
      deliveries.push(await this._dispatchSingleTarget(notification, subscription));
    }

    const attempts = deliveries.reduce((sum, delivery) => sum + (delivery.attempts || 0), 0);
    const successfulDeliveries = deliveries.filter((delivery) => delivery.success === true);
    const failedDeliveries = deliveries.filter((delivery) => delivery.success !== true && delivery.skipped !== true);
    const skippedDeliveries = deliveries.filter((delivery) => delivery.skipped === true);

    return {
      success: failedDeliveries.length === 0 && successfulDeliveries.length > 0,
      channel: "webhook",
      attempts,
      deliveredAt: successfulDeliveries[0]?.deliveredAt || null,
      deliveredCount: successfulDeliveries.length,
      failedCount: failedDeliveries.length,
      skippedCount: skippedDeliveries.length,
      reason: failedDeliveries[0]?.reason || skippedDeliveries[0]?.reason || null,
      deliveries,
    };
  }

  async _dispatchSingleTarget(notification, subscription = {}) {
    if (!subscription?.url) {
      return { success: false, channel: "webhook", skipped: true, reason: "webhook_url_missing", attempts: 0 };
    }

    if (this.sendDelayMs > 0) {
      await this.sleep(this.sendDelayMs);
    }

    const payload = this._toWebhookPayload(notification, subscription);
    const startedAt = Date.now();
    let lastError = null;
    let lastResponse = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this._postJson(subscription.url, payload, subscription);
        const normalizedResponse = response && typeof response === "object" ? response : {};
        const result = {
          success: true,
          channel: "webhook",
          webhookId: subscription.id ?? null,
          targetUrl: subscription.url,
          attempts: attempt,
          deliveredAt: new Date().toISOString(),
          responseStatusCode: normalizedResponse.statusCode || null,
          responseBody: normalizedResponse.body || null,
          responseHeaders: normalizedResponse.headers || null,
          durationMs: Date.now() - startedAt,
        };

        await this._recordDelivery(notification, subscription, payload, result);
        return result;
      } catch (error) {
        lastError = error;
        lastResponse = error?.response || lastResponse;
        if (attempt < this.maxRetries) {
          const backoff = this.baseBackoffMs * 2 ** (attempt - 1);
          await this.sleep(backoff);
        }
      }
    }

    const result = {
      success: false,
      channel: "webhook",
      webhookId: subscription.id ?? null,
      targetUrl: subscription.url,
      attempts: this.maxRetries,
      responseStatusCode: lastResponse?.statusCode || null,
      responseBody: lastResponse?.body || null,
      responseHeaders: lastResponse?.headers || null,
      reason: lastError ? lastError.message : "unknown_webhook_error",
      durationMs: Date.now() - startedAt,
    };

    await this._recordDelivery(notification, subscription, payload, result);
    return result;
  }

  async _recordDelivery(notification, subscription, payload, result) {
    if (!subscription?.id) {
      return null;
    }

    return this.recordDelivery({
      webhookId: subscription.id,
      userId: subscription.userId ?? notification?.userId ?? null,
      eventType: notification?.metadata?.eventType || "notification.event",
      targetUrl: subscription.url,
      requestPayload: payload,
      responseStatusCode: result.responseStatusCode || null,
      responseBody: result.responseBody || null,
      responseHeaders: result.responseHeaders || null,
      attempts: result.attempts || 0,
      success: result.success === true,
      skipped: result.skipped === true,
      reason: result.reason || null,
      correlationId: notification?.correlationId || null,
      notificationId: notification?.id || null,
      durationMs: result.durationMs || null,
    });
  }

  _toWebhookPayload(notification, subscription = {}) {
    return {
      type: notification.metadata?.eventType || "notification.event",
      timestamp: new Date().toISOString(),
      correlationId: notification.correlationId,
      webhookId: subscription.id ?? null,
      payload: {
        notificationId: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        data: notification.metadata || {},
      },
    };
  }

  _postJson(rawUrl, body, subscription = {}) {
    const url = new URL(rawUrl);
    const data = JSON.stringify(body);
    const client = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = client.request(
        {
          method: "POST",
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          timeout: this.timeoutMs,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "User-Agent": "Rolnopol-Webhooks/1.0",
            "X-Rolnopol-Event": body.type,
            "X-Rolnopol-Webhook-Id": subscription?.id != null ? String(subscription.id) : "direct",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
          res.on("end", () => {
            const bodyText = Buffer.concat(chunks).toString("utf8");
            const response = {
              statusCode: res.statusCode || null,
              body: bodyText || null,
              headers: res.headers || null,
            };

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
              return;
            }

            const error = new Error(`webhook_http_${res.statusCode}`);
            error.response = response;
            reject(error);
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("webhook_timeout"));
      });
      req.write(data);
      req.end();
    });
  }
}

module.exports = WebhookDispatcher;
