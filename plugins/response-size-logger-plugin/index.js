module.exports = {
  name: "response-size-logger-plugin",
  order: 30,
  enabled: true,

  onResponse({ req, res, responseBody, responseType, logInfo }) {
    let sizeBytes = 0;

    if (Buffer.isBuffer(responseBody)) {
      sizeBytes = responseBody.length;
    } else if (typeof responseBody === "string") {
      sizeBytes = Buffer.byteLength(responseBody, "utf8");
    } else if (responseBody == null) {
      sizeBytes = 0;
    } else {
      try {
        sizeBytes = Buffer.byteLength(JSON.stringify(responseBody), "utf8");
      } catch {
        sizeBytes = 0;
      }
    }

    logInfo("Plugin response-size-logger", {
      plugin: "response-size-logger-plugin",
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      responseType,
      sizeBytes,
    });
  },
};
