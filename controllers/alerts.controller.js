const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const featureFlagsService = require("../services/feature-flags.service");

class AlertsController {
  _buildRedEventDecoder(seedDate) {
    const encoded = Buffer.from(`RED-EVENT:${seedDate}:beware of the falling crimson rain`, "utf8").toString("base64");
    return {
      id: "red-event-decoder",
      encoded,
      hint: "Decode using base64",
    };
  }

  _applyRedEventDecoder(alerts, seedDate) {
    if (!Array.isArray(alerts)) {
      return alerts;
    }

    const decoder = this._buildRedEventDecoder(seedDate);
    return alerts.map((alert) => {
      if (alert?.title !== "RED EVENT") {
        return alert;
      }

      return {
        ...alert,
        details: {
          ...(alert.details || {}),
          redEventDecoder: decoder,
        },
      };
    });
  }

  async getCombined(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-MA";
      const redEventDecodeEnabled = req.query?.redDecode === "1" || req.query?.redDecode === "true";
      const alertsService = require("../services/alerts.service")(region);
      const featureFlags = await featureFlagsService.getFeatureFlags();
      const celebrationEventsEnabled = featureFlags?.flags?.celebrationEventsEnabled === true;

      // Get today's and tomorrow's dates in UTC
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const tomorrowUTC = new Date(todayUTC.getTime());
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
      const tomorrowISO = tomorrowUTC.toISOString().slice(0, 10);

      // Parse queried date
      const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
      const queriedDate = new Date(Date.UTC(y, m - 1, d));

      // Otherwise, treat as normal
      let history = alertsService.getHistory(date, 7);
      const upcoming = alertsService.getUpcoming(date);
      const today = { date, alerts: alertsService.generateAlertsForDate(date) };
      const celebrationEvents = celebrationEventsEnabled ? alertsService.getCelebrationEventsForDate(date) : [];

      // check each date (in history, upcoming, today) - if date is greater than tomorrow then replace alerts with empty array
      if (today.date > tomorrowISO) {
        today.alerts = [];
        today.message = "We don't have predictions for dates beyond tomorrow.";
      }

      if (upcoming.date > tomorrowISO) {
        upcoming.alerts = [];
        upcoming.message = "We don't have predictions for dates beyond tomorrow.";
      }

      // If queried date is after tomorrow, history should be fully empty per tests
      if (queriedDate.getTime() > tomorrowUTC.getTime()) {
        history = [];
      } else {
        history.forEach((h) => {
          if (h.date > tomorrowISO) {
            h.alerts = [];
            h.message = "We don't have predictions for dates beyond tomorrow.";
          }
        });
      }

      const body = {
        data: {
          seed: date,
          today,
          upcoming,
          history,
          celebrationEvents,
        },
      };

      if (celebrationEvents.length > 0) {
        body.meta = {
          ...(body.meta || {}),
          celebrationTheme: celebrationEvents[0].themeKey,
        };
      }

      if (redEventDecodeEnabled) {
        body.data.today.alerts = this._applyRedEventDecoder(body.data.today.alerts, date);
        body.data.upcoming.alerts = this._applyRedEventDecoder(body.data.upcoming.alerts, date);
        body.data.history = Array.isArray(body.data.history)
          ? body.data.history.map((entry) => ({
              ...entry,
              alerts: this._applyRedEventDecoder(entry.alerts, date),
            }))
          : body.data.history;

        body.meta = {
          easterEgg: this._buildRedEventDecoder(date),
        };
      }

      // If any future restriction applied, include message as in tests
      if (
        today.date > tomorrowISO ||
        upcoming.date > tomorrowISO ||
        (Array.isArray(history) && history.some((h) => h.date > tomorrowISO))
      ) {
        body.message = "We don't have predictions for dates beyond tomorrow.";
      }

      res.status(200).json(formatResponseBody(body));
    } catch (error) {
      logError("Error getting combined alerts:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }

  async getHistory(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-24";
      const redEventDecodeEnabled = req.query?.redDecode === "1" || req.query?.redDecode === "true";
      const alertsService = require("../services/alerts.service")(region);

      // Get tomorrow's date in UTC
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const tomorrowUTC = new Date(todayUTC.getTime());
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

      // Parse queried date
      const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
      const queriedDate = new Date(Date.UTC(y, m - 1, d));

      // If queried date is after tomorrow, return no history
      if (queriedDate.getTime() > tomorrowUTC.getTime()) {
        res.status(200).json(
          formatResponseBody({
            data: { seed: date, history: [] },
            message: "We don't have predictions for dates beyond tomorrow.",
          }),
        );
        return;
      }

      // Otherwise, get history
      const history = alertsService.getHistory(date, 7);
      const responsePayload = {
        data: {
          seed: date,
          history: redEventDecodeEnabled
            ? history.map((entry) => ({
                ...entry,
                alerts: this._applyRedEventDecoder(entry.alerts, date),
              }))
            : history,
        },
      };

      if (redEventDecodeEnabled) {
        responsePayload.meta = {
          easterEgg: this._buildRedEventDecoder(date),
        };
      }

      res.status(200).json(formatResponseBody(responsePayload));
    } catch (error) {
      logError("Error getting alerts history:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }

  async getUpcoming(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-MA";
      const redEventDecodeEnabled = req.query?.redDecode === "1" || req.query?.redDecode === "true";
      const alertsService = require("../services/alerts.service")(region);

      // Get tomorrow's date in UTC
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const tomorrowUTC = new Date(todayUTC.getTime());
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

      // Parse queried date
      const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
      const queriedDate = new Date(Date.UTC(y, m - 1, d));

      // If queried date is after tomorrow, return no upcoming
      if (queriedDate.getTime() > tomorrowUTC.getTime()) {
        const nextISO = new Date(queriedDate.getTime());
        nextISO.setUTCDate(nextISO.getUTCDate() + 1);
        const nextDate = nextISO.toISOString().slice(0, 10);
        res.status(200).json(
          formatResponseBody({
            data: { seed: date, upcoming: { date: nextDate, alerts: [] } },
            message: "We don't have predictions for dates beyond tomorrow.",
          }),
        );
        return;
      }

      // Otherwise, get upcoming
      const upcoming = alertsService.getUpcoming(date);
      const responsePayload = {
        data: {
          seed: date,
          upcoming: redEventDecodeEnabled
            ? {
                ...upcoming,
                alerts: this._applyRedEventDecoder(upcoming.alerts, date),
              }
            : upcoming,
        },
      };

      if (redEventDecodeEnabled) {
        responsePayload.meta = {
          easterEgg: this._buildRedEventDecoder(date),
        };
      }

      res.status(200).json(formatResponseBody(responsePayload));
    } catch (error) {
      logError("Error getting upcoming alerts:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }

  async getCelebrationEvents(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-MA";
      const alertsService = require("../services/alerts.service")(region);
      const featureFlags = await featureFlagsService.getFeatureFlags();

      if (featureFlags?.flags?.celebrationEventsEnabled !== true) {
        res.status(404).json(
          formatResponseBody({
            error: "Celebration events not found",
          }),
        );
        return;
      }

      const celebrationEvents = alertsService.getCelebrationEventsForDate(date);

      const responsePayload = {
        data: {
          seed: date,
          celebrationEvents,
        },
      };

      if (celebrationEvents.length > 0) {
        responsePayload.meta = {
          celebrationTheme: celebrationEvents[0].themeKey,
        };
      }

      res.status(200).json(formatResponseBody(responsePayload));
    } catch (error) {
      logError("Error getting celebration events:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }
}

module.exports = new AlertsController();
