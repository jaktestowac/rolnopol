const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const twoFactorService = require("../services/two-factor.service");

class TwoFactorController {
  async getConfiguration(req, res) {
    try {
      const data = await twoFactorService.getConfiguration(req.user.userId);
      return res.status(200).json(
        formatResponseBody({
          data,
        }),
      );
    } catch (error) {
      return this._handleError(res, "Error getting two-factor configuration:", error);
    }
  }

  async startSetup(req, res) {
    try {
      const data = await twoFactorService.startSetup(req.user.userId);
      return res.status(200).json(
        formatResponseBody({
          message: "Two-factor setup generated successfully",
          data,
        }),
      );
    } catch (error) {
      return this._handleError(res, "Error starting two-factor setup:", error);
    }
  }

  async enable(req, res) {
    try {
      const data = await twoFactorService.enable(req.user.userId, req.body?.code);
      return res.status(200).json(
        formatResponseBody({
          message: "Two-factor authentication enabled successfully",
          data,
        }),
      );
    } catch (error) {
      return this._handleError(res, "Error enabling two-factor authentication:", error);
    }
  }

  async disable(req, res) {
    try {
      const data = await twoFactorService.disable(req.user.userId, req.body?.code);
      return res.status(200).json(
        formatResponseBody({
          message: "Two-factor authentication disabled successfully",
          data,
        }),
      );
    } catch (error) {
      return this._handleError(res, "Error disabling two-factor authentication:", error);
    }
  }

  _handleError(res, label, error) {
    logError(label, error);

    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json(
      formatResponseBody({
        error: error?.message || "Internal server error",
      }),
    );
  }
}

module.exports = new TwoFactorController();
