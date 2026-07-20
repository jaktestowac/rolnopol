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

function clearLogList() {
  const clearedCount = _logList.length;
  _logList.length = 0;
  return clearedCount;
}

/**
 * Runtime log-level gate.
 *
 * Levels are ranked from most verbose (TRACE) to least (ERROR). Each log
 * function only records/emits when its own rank meets the active threshold.
 * REQUEST/RESPONSE share the DEBUG rank since they are debug-time diagnostics.
 */
const LOG_LEVEL_RANKS = {
  TRACE: 10,
  DEBUG: 20,
  REQUEST: 20,
  RESPONSE: 20,
  INFO: 30,
  WARN: 40,
  WARNING: 40,
  ERROR: 50,
};

// Levels an operator can pick from the Kraken dashboard (verbose -> quiet).
const SELECTABLE_LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

// Minimum severity that is recorded/emitted. Defaults to TRACE so the existing
// DEBUG_MODE / LOG_* flags stay the effective gate until an operator raises it.
let _currentLogLevel = "TRACE";

function getLogLevel() {
  return _currentLogLevel;
}

function getAvailableLogLevels() {
  return [...SELECTABLE_LOG_LEVELS];
}

function setLogLevel(level) {
  const normalized = String(level || "")
    .trim()
    .toUpperCase();
  if (!SELECTABLE_LOG_LEVELS.includes(normalized)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${SELECTABLE_LOG_LEVELS.join(", ")}`);
  }
  _currentLogLevel = normalized;
  return _currentLogLevel;
}

// True when an entry of `level` meets the active threshold and should be kept.
function shouldLog(level) {
  const entryRank = LOG_LEVEL_RANKS[String(level).toUpperCase()] ?? LOG_LEVEL_RANKS.INFO;
  const thresholdRank = LOG_LEVEL_RANKS[_currentLogLevel] ?? LOG_LEVEL_RANKS.TRACE;
  return entryRank >= thresholdRank;
}

/**
 * Simple logging utilities
 */

/**
 * Log debug messages (only in debug mode)
 */
function logDebug(message, data = null) {
  if (settings.DEBUG_MODE && shouldLog("DEBUG")) {
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

function logTrace(message, data = null) {
  if (settings.DEBUG_MODE && settings.LOG_TRACE && shouldLog("TRACE")) {
    const timestamp = new Date().toISOString();
    console.log(`[TRACE] ${timestamp} - ${message}`);
    if (data) {
      console.log("[TRACE]    Data:", JSON.stringify(data, null, 2));
    }
    addLogEntry({
      level: "TRACE",
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
  if (!shouldLog("INFO")) return;
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
  if (!shouldLog("WARN")) return;
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
  if (!shouldLog("ERROR")) return;
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
  if (settings.LOG_REQUEST && shouldLog("REQUEST")) {
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
  if (settings.DEBUG_MODE && shouldLog("RESPONSE")) {
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
  clearLogList,
  logTrace,
  getLogLevel,
  setLogLevel,
  getAvailableLogLevels,
};
