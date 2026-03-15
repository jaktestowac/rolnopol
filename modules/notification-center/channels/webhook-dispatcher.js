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
  }

  async dispatch(notification, webhookUrl = null) {
    const targetUrl = webhookUrl || this.defaultUrl;
    if (!targetUrl) {
      return { success: false, channel: "webhook", skipped: true, reason: "webhook_url_missing", attempts: 0 };
    }

    if (this.sendDelayMs > 0) {
      await this.sleep(this.sendDelayMs);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this._postJson(targetUrl, this._toWebhookPayload(notification));
        return { success: true, channel: "webhook", attempts: attempt, deliveredAt: new Date().toISOString() };
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          const backoff = this.baseBackoffMs * 2 ** (attempt - 1);
          await this.sleep(backoff);
        }
      }
    }

    return {
      success: false,
      channel: "webhook",
      attempts: this.maxRetries,
      reason: lastError ? lastError.message : "unknown_webhook_error",
    };
  }

  _toWebhookPayload(notification) {
    return {
      type: notification.metadata?.eventType || "notification.event",
      timestamp: new Date().toISOString(),
      correlationId: notification.correlationId,
      payload: {
        notificationId: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        data: notification.metadata || {},
      },
    };
  }

  _postJson(rawUrl, body) {
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
          },
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`webhook_http_${res.statusCode}`));
          }
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
