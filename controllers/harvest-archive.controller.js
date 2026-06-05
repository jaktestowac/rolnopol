/**
 * Holiday Harvest Archive — Controller.
 */

const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const harvestArchiveService = require("../services/harvest-archive.service");

class HarvestArchiveController {
  async getMetadata(req, res) {
    try {
      const dateStr = req.query?.date;
      const result = await harvestArchiveService.getArchiveMetadata(dateStr);

      if (!result.active) {
        return res.status(200).json(
          formatResponseBody({
            data: {
              active: false,
              message: "No harvest event is currently active.",
            },
          }),
        );
      }

      return res.status(200).json(
        formatResponseBody({
          data: {
            active: true,
            event: result.event,
          },
        }),
      );
    } catch (error) {
      logError("Error getting harvest archive metadata", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to get harvest archive metadata" }));
    }
  }

  async getEntries(req, res) {
    try {
      const dateStr = req.query?.date;
      const result = await harvestArchiveService.getArchiveEntries(dateStr);

      if (!result.active) {
        return res.status(200).json(
          formatResponseBody({
            data: {
              active: false,
              entries: [],
            },
          }),
        );
      }

      return res.status(200).json(
        formatResponseBody({
          data: {
            active: true,
            event: result.event,
            entries: result.entries,
          },
        }),
      );
    } catch (error) {
      logError("Error getting harvest archive entries", { error });
      return res.status(500).json(formatResponseBody({ error: "Failed to get harvest archive entries" }));
    }
  }
}

module.exports = new HarvestArchiveController();
