const { formatResponseBody } = require("../helpers/response-helper");
const { logError } = require("../helpers/logger-api");
const personalApiKeyService = require("../services/personal-api-key.service");

class PersonalApiKeyController {
  async list(req, res) {
    try {
      const items = await personalApiKeyService.listKeys(req.user.userId);

      return res.status(200).json(
        formatResponseBody({
          data: {
            items,
            allowedScopes: personalApiKeyService.listAvailableScopes(),
            allowedModes: personalApiKeyService.listAvailableModes(),
            allowedExpirations: personalApiKeyService.listAvailableExpirationOptions(),
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error listing personal API keys", error, res);
    }
  }

  async create(req, res) {
    try {
      const result = await personalApiKeyService.createKey(req.user.userId, req.body || {});

      return res.status(201).json(
        formatResponseBody({
          message: "API key created successfully",
          data: {
            ...result,
            allowedScopes: personalApiKeyService.listAvailableScopes(),
            allowedModes: personalApiKeyService.listAvailableModes(),
            allowedExpirations: personalApiKeyService.listAvailableExpirationOptions(),
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error creating personal API key", error, res);
    }
  }

  async regenerate(req, res) {
    try {
      const result = await personalApiKeyService.regenerateKey(req.user.userId, req.params.keyId, req.body || {});

      return res.status(200).json(
        formatResponseBody({
          message: "API key regenerated successfully",
          data: {
            ...result,
            allowedScopes: personalApiKeyService.listAvailableScopes(),
            allowedModes: personalApiKeyService.listAvailableModes(),
            allowedExpirations: personalApiKeyService.listAvailableExpirationOptions(),
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error regenerating personal API key", error, res);
    }
  }

  async revoke(req, res) {
    try {
      const key = await personalApiKeyService.revokeKey(req.user.userId, req.params.keyId);

      return res.status(200).json(
        formatResponseBody({
          message: "API key revoked successfully",
          data: {
            key,
          },
        }),
      );
    } catch (error) {
      return this._handleError("Error revoking personal API key", error, res);
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
    } else if (errorMessage.includes("already")) {
      statusCode = 409;
    }

    return res.status(statusCode).json(
      formatResponseBody({
        error: errorMessage,
      }),
    );
  }
}

module.exports = new PersonalApiKeyController();
