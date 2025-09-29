const { logResponse } = require("./logger-api");

/**
 * Format consistent API responses
 */

/**
 * Filter out internal fields from user-facing responses
 * @param {Object} data - The data to filter
 * @param {boolean} isAdmin - Whether this is an admin response
 * @returns {Object} - Filtered data
 */
function filterInternalFields(data, isAdmin = false) {
  if (!data) return data;

  // If admin, return all data including internalId
  if (isAdmin) return data;

  // For user-facing responses, remove internalId
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === "object" && item !== null) {
        const { internalId, ...filteredItem } = item;
        return filteredItem;
      }
      return item;
    });
  }

  if (typeof data === "object" && data !== null) {
    const { internalId, ...filteredData } = data;
    return filteredData;
  }

  return data;
}

/**
 * Format a successful response
 */
function formatResponseBody(payload, isAdmin = false) {
  const response = {
    success: true,
    timestamp: new Date().toISOString(),
  };

  // If there's an error, mark success as false
  if (payload.error) {
    response.success = false;
    response.error = payload.error;
    if (payload.details) {
      response.details = payload.details;
    }
  } else {
    // For successful responses, filter internal fields if not admin
    if (payload.data) {
      response.data = filterInternalFields(payload.data, isAdmin);
    }
    if (payload.message) {
      response.message = payload.message;
    }
  }

  return response;
}

/**
 * Format an error response
 */
function formatErrorResponse(message, details = null) {
  return formatResponseBody({
    error: message,
    details: details,
  });
}

/**
 * Format a success response with data
 */
function formatSuccessResponse(data, message = null, isAdmin = false) {
  const response = {
    data: data,
  };

  if (message) {
    response.message = message;
  }

  return formatResponseBody(response, isAdmin);
}

/**
 * Send a formatted JSON response
 */
function sendResponse(req, res, statusCode, payload, isAdmin = false) {
  const responseBody = formatResponseBody(payload, isAdmin);

  // Log the response if in debug mode
  logResponse(req, res, responseBody);

  res.status(statusCode).json(responseBody);
}

/**
 * Send a success response
 */
function sendSuccess(req, res, data, message = null, isAdmin = false) {
  sendResponse(req, res, 200, formatSuccessResponse(data, message, isAdmin));
}

/**
 * Send an error response
 */
function sendError(req, res, statusCode, message, details = null) {
  sendResponse(req, res, statusCode, formatErrorResponse(message, details));
}

/**
 * Send a validation error response
 */
function sendValidationError(req, res, errors) {
  sendError(req, res, 400, "Validation failed", { validationErrors: errors });
}

/**
 * Send a not found response
 */
function sendNotFound(req, res, resource = "Resource") {
  sendError(req, res, 404, `${resource} not found`);
}

/**
 * Send an unauthorized response
 */
function sendUnauthorized(req, res, message = "Unauthorized") {
  sendError(req, res, 401, message);
}

/**
 * Send a forbidden response
 */
function sendForbidden(req, res, message = "Forbidden") {
  sendError(req, res, 403, message);
}

/**
 * Send an internal server error response
 */
function sendInternalError(req, res, message = "Internal server error") {
  sendError(req, res, 500, message);
}

module.exports = {
  formatResponseBody,
  formatErrorResponse,
  formatSuccessResponse,
  filterInternalFields,
  sendResponse,
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendInternalError,
};
