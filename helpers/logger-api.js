const settings = require("../data/settings");

// Fixed-width log list
const LOG_LIST_MAX_LENGTH = 500;
const _logList = [];

function addLogEntry(entry) {
  _logList.unshift(entry); // Add newest at the beginning
  if (_logList.length > LOG_LIST_MAX_LENGTH) {
    _logList.pop(); // Remove oldest (from end)
  }
}

function getLogList() {
  return [..._logList];
}

/**
 * Simple logging utilities
 */

/**
 * Log debug messages (only in debug mode)
 */
function logDebug(message, data = null) {
  if (settings.DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    console.log(`[DEBUG] ${timestamp} - ${message}`);
    if (data) {
      console.log("[DEBUG]    Data:", JSON.stringify(data, null, 2));
    }
    addLogEntry({
      level: "DEBUG",
      timestamp,
      message,
      data,
    });
  }
}

/**
 * Log info messages
 */
function logInfo(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[INFO] ${timestamp} - ${message}`);
  if (data) {
    console.log("[INFO]    Data:", JSON.stringify(data, null, 2));
  }
  addLogEntry({
    level: "INFO",
    timestamp,
    message,
    data,
  });
}

/**
 * Log warning messages
 */
function logWarning(message, data = null) {
  const timestamp = new Date().toISOString();
  console.warn(`[WARN] ${timestamp} - ${message}`);
  let logData = data;
  if (data) {
    if (data instanceof Error) {
      if (settings.LOG_STACK_TRACE) {
        console.warn("[WARN]    Stack:", data.stack);
        logData = data.stack;
      } else {
        console.warn("[WARN]    Error:", data.message);
        logData = data.message;
      }
    } else {
      console.warn("[WARN]    Details:", JSON.stringify(data, null, 2));
    }
  }
  addLogEntry({
    level: "WARN",
    timestamp,
    message,
    data: logData,
  });
}

/**
 * Log error messages
 */
function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  console.error(`[ERROR] ${timestamp} - ${message}`);
  let logData = error;
  if (error) {
    if (error instanceof Error) {
      if (settings.LOG_STACK_TRACE) {
        console.error("[ERROR]    Stack:", error.stack);
        logData = error.stack;
      } else {
        console.error("[ERROR]    Error:", error.message);
        logData = error.message;
      }
    } else {
      console.error("[ERROR]    Details:", JSON.stringify(error, null, 2));
    }
  }
  addLogEntry({
    level: "ERROR",
    timestamp,
    message,
    data: logData,
  });
}

/**
 * Log API requests
 */
function logRequest(req) {
  if (settings.LOG_REQUEST) {
    const timestamp = new Date().toISOString();
    console.log(`[REQUEST] ${timestamp} - ${req.method} ${req.originalUrl}`);
    let sanitizedBody = null;
    if (req.body && Object.keys(req.body).length > 0) {
      sanitizedBody = { ...req.body };
      if (sanitizedBody.password) sanitizedBody.password = "[HIDDEN]";
      if (sanitizedBody.token) sanitizedBody.token = "[HIDDEN]";
      console.log("[REQUEST]    Body:", JSON.stringify(sanitizedBody, null, 2));
    }
    addLogEntry({
      level: "REQUEST",
      timestamp,
      method: req.method,
      url: req.originalUrl,
      body: sanitizedBody,
    });
  }
}

/**
 * Log API responses
 */
function logResponse(req, res, responseBody) {
  if (settings.DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    console.log(`[RESPONSE] ${timestamp} - ${req.method} ${req.originalUrl} - ${res.statusCode}`);
    if (responseBody) {
      console.log("[RESPONSE]    Body:", JSON.stringify(responseBody, null, 2));
    }
    addLogEntry({
      level: "RESPONSE",
      timestamp,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      body: responseBody,
    });
  }
}

module.exports = {
  logDebug,
  logInfo,
  logWarning,
  logError,
  logRequest,
  logResponse,
  getLogList,
};
