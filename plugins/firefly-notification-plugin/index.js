const { formatResponseBody } = require("../../helpers/response-helper");

module.exports = {
  name: "firefly-notification-plugin",
  order: 70,
  enabled: false,
  autoDiscoverable: false,

  config: {
    routePath: "/api/v1/easter-eggs/firefly-jar",
    maxEvents: 5,
    eventTypes: ["field.created", "notification.sent"],
  },

  init() {
    this.recentEvents = [];
  },

  onEvent({ event, eventType, config }) {
    const maxEvents = Number.isFinite(Number(config.maxEvents)) ? Math.max(1, Number(config.maxEvents)) : 5;
    const currentEvents = Array.isArray(this.recentEvents) ? this.recentEvents : [];

    currentEvents.unshift({
      type: eventType,
      source: event?.source || "unknown",
      timestamp: event?.timestamp || null,
    });

    this.recentEvents = currentEvents.slice(0, maxEvents);
  },

  onRequest({ req, res, config }) {
    if (req.path !== config.routePath) {
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json(
        formatResponseBody({
          error: "Method not allowed",
        }),
      );
      return false;
    }

    const recentEvents = Array.isArray(this.recentEvents) ? this.recentEvents : [];

    res.status(200).json(
      formatResponseBody({
        message: recentEvents.length > 0 ? "The jar is glowing tonight." : "The jar is quiet for now.",
        data: {
          captured: recentEvents.length,
          events: recentEvents,
        },
        meta: {
          easterEgg: {
            id: "firefly-notification-jar",
            glowLevel: recentEvents.length > 0 ? "bright" : "dim",
          },
        },
      }),
    );

    return false;
  },
};
