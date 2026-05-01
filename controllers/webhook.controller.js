const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const webhookService = require("../services/webhook.service");

class WebhookController {
  async list(req, res) {
    try {
      const items = await webhookService.listWebhooks(req.user.userId);
      return res.status(200).json(
        formatResponseBody({
          data: {
            items,
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error listing webhooks", error, res);
    }
  }

  async create(req, res) {
    try {
      const webhook = await webhookService.createWebhook(req.user.userId, req.body || {});
      return res.status(201).json(
        formatResponseBody({
          message: "Webhook created successfully",
          data: {
            webhook,
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error creating webhook", error, res);
    }
  }

  async update(req, res) {
    try {
      const webhook = await webhookService.updateWebhook(req.user.userId, req.params.webhookId, req.body || {});
      return res.status(200).json(
        formatResponseBody({
          message: "Webhook updated successfully",
          data: {
            webhook,
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error updating webhook", error, res);
    }
  }

  async remove(req, res) {
    try {
      await webhookService.deleteWebhook(req.user.userId, req.params.webhookId);
      return res.status(200).json(
        formatResponseBody({
          message: "Webhook deleted successfully",
          data: {
            deleted: true,
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error deleting webhook", error, res);
    }
  }

  async listEvents(req, res) {
    try {
      const data = await webhookService.listAvailableEvents();
      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      return this._handleError("Error listing webhook events", error, res);
    }
  }

  async listDeliveries(req, res) {
    try {
      const asPositiveInt = (value, fallback) => {
        const normalized = Number(value);
        return Number.isInteger(normalized) && normalized >= 0 ? normalized : fallback;
      };

      const filters = {
        webhookId: req.query.webhookId,
        eventType: typeof req.query.eventType === "string" ? req.query.eventType : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        limit: asPositiveInt(req.query.limit, 50),
        offset: asPositiveInt(req.query.offset, 0),
      };

      const data = await webhookService.listDeliveries(req.user.userId, filters);
      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      return this._handleError("Error listing webhook deliveries", error, res);
    }
  }

  _handleError(message, error, res) {
    logError(message, error);

    const errorMessage = typeof error?.message === "string" ? error.message : "Internal server error";
    let statusCode = 500;

    if (errorMessage.includes("Validation failed")) {
      statusCode = 400;
    } else if (errorMessage.includes("not found")) {
      statusCode = 404;
    } else if (errorMessage.includes("deactivated")) {
      statusCode = 401;
    } else if (errorMessage.includes("maximum of")) {
      statusCode = 409;
    }

    return res.status(statusCode).json(
      formatResponseBody({
        error: errorMessage,
      }),
    );
  }
}

module.exports = new WebhookController();
