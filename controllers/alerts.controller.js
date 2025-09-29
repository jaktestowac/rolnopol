const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");

class AlertsController {
  async getCombined(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-MA";
      const alertsService = require("../services/alerts.service")(region);

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
        },
      };
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
          })
        );
        return;
      }

      // Otherwise, get history
      const history = alertsService.getHistory(date, 7);
      res.status(200).json(formatResponseBody({ data: { seed: date, history } }));
    } catch (error) {
      logError("Error getting alerts history:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }

  async getUpcoming(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const region = req.query.region || "PL-MA";
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
          })
        );
        return;
      }

      // Otherwise, get upcoming
      const upcoming = alertsService.getUpcoming(date);
      res.status(200).json(formatResponseBody({ data: { seed: date, upcoming } }));
    } catch (error) {
      logError("Error getting upcoming alerts:", error);
      res.status(400).json(formatResponseBody({ error: error.message }));
    }
  }
}

module.exports = new AlertsController();
