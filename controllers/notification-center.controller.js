const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const notificationCenter = require("../modules/notification-center");
const featureFlagsService = require("../services/feature-flags.service");
const { getAllEventTypes, getPayloadTemplate } = require("../modules/notification-center/core/event-payload-templates");

const ENDPOINTS = {
  health: "/api/v1/notifications/health",
  events: "/api/v1/notifications/events",
  testEvent: {
    get: "/api/v1/notifications/test-event",
    post: "/api/v1/notifications/test-event",
  },
  triggerEvent: {
    get: "/api/v1/notifications/trigger",
    post: "/api/v1/notifications/trigger",
  },
};

class NotificationCenterController {
  async _getNotificationCenterFlagState() {
    try {
      const data = await featureFlagsService.getFeatureFlags();
      return data?.flags?.notificationCenterEnabled === true;
    } catch {
      return false;
    }
  }

  async getHealth(req, res) {
    try {
      const data = await notificationCenter.getHealth();
      const currentFlagValue = await this._getNotificationCenterFlagState();
      const payload = {
        ...data,
        featureFlags: {
          notificationCenterEnabled: currentFlagValue,
        },
        endpoints: ENDPOINTS,
      };
      return res.status(200).json(formatResponseBody({ data: payload }));
    } catch (error) {
      logError("Error getting notification-center health", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to fetch notification module health" }));
    }
  }

  async getEvents(req, res) {
    try {
      const asPositiveInt = (value, fallback) => {
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 ? n : fallback;
      };

      const normalizeStatusFilter = (value) => {
        if (typeof value !== "string") return undefined;
        const normalized = value.trim().toLowerCase();
        if (!normalized || normalized === "all") return undefined;

        const allowed = new Set(["enqueued", "received", "processing", "processed", "failed"]);
        return allowed.has(normalized) ? normalized : undefined;
      };

      const filters = {
        limit: asPositiveInt(req.query.limit, 50),
        offset: asPositiveInt(req.query.offset, 0),
        type: typeof req.query.type === "string" ? req.query.type : undefined,
        status: normalizeStatusFilter(req.query.status),
        correlationId: typeof req.query.correlationId === "string" ? req.query.correlationId : undefined,
      };

      const data = await notificationCenter.getEvents(filters);
      const currentFlagValue = await this._getNotificationCenterFlagState();
      const payload = {
        ...data,
        featureFlags: {
          notificationCenterEnabled: currentFlagValue,
        },
        endpoints: ENDPOINTS,
      };
      return res.status(200).json(formatResponseBody({ data: payload }));
    } catch (error) {
      logError("Error getting notification-center events", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to fetch notification events" }));
    }
  }

  async triggerTestEvent(req, res) {
    try {
      const bodyPayload = req.body && typeof req.body === "object" ? req.body : {};
      const queryPayload = req.query && typeof req.query === "object" ? req.query : {};
      const payload = req.method === "GET" ? queryPayload : bodyPayload;
      const data = await notificationCenter.triggerTestEvent(payload);
      const currentFlagValue = await this._getNotificationCenterFlagState();
      const status = data.accepted ? 202 : 200;
      return res.status(status).json(
        formatResponseBody({
          data: {
            ...data,
            featureFlags: {
              notificationCenterEnabled: currentFlagValue,
            },
          },
        }),
      );
    } catch (error) {
      logError("Error triggering notification-center test event", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to trigger test notification event" }));
    }
  }

  async triggerEvent(req, res) {
    try {
      const bodyPayload = req.body && typeof req.body === "object" ? req.body : {};
      const queryPayload = req.query && typeof req.query === "object" ? req.query : {};
      const payload = req.method === "GET" ? queryPayload : bodyPayload;
      const eventType = payload.eventType?.trim();
      const availableEventTypes = getAllEventTypes();

      if (!eventType || !availableEventTypes.includes(eventType)) {
        return res.status(400).json(
          formatResponseBody({
            error: `Invalid event type. Supported types: ${availableEventTypes.join(", ")}`,
          }),
        );
      }

      // Generate default payload for the event type if not provided
      const templatePayload = getPayloadTemplate(eventType, {});
      const mergedPayload = {
        ...templatePayload,
        ...payload,
        eventType: undefined, // Remove eventType from payload
      };

      // Add userId if not present
      if (!mergedPayload.userId) {
        mergedPayload.userId = payload.userId || "kraken-admin";
      }

      // Publish the event with the specified type
      const data = await notificationCenter.publishEvent(eventType, mergedPayload);
      const currentFlagValue = await this._getNotificationCenterFlagState();
      const status = data.accepted ? 202 : 200;

      return res.status(status).json(
        formatResponseBody({
          data: {
            ...data,
            featureFlags: {
              notificationCenterEnabled: currentFlagValue,
            },
            availableEventTypes,
          },
        }),
      );
    } catch (error) {
      logError("Error triggering notification-center event", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to trigger notification event" }));
    }
  }

  async listEventTypes(req, res) {
    try {
      const availableEventTypes = getAllEventTypes();
      const currentFlagValue = await this._getNotificationCenterFlagState();

      return res.status(200).json(
        formatResponseBody({
          data: {
            eventTypes: availableEventTypes,
            featureFlags: {
              notificationCenterEnabled: currentFlagValue,
            },
            endpoints: ENDPOINTS,
          },
        }),
      );
    } catch (error) {
      logError("Error listing event types", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to list event types" }));
    }
  }
}

module.exports = new NotificationCenterController();
