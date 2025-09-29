const { formatResponseBody } = require("../helpers/response-helper");
const { isValidId } = require("../helpers/validators");

/**
 * Middleware to validate ID parameters in routes
 * @param {string} paramName - The name of the parameter to validate (default: 'id')
 * @returns {Function} Express middleware function
 */
function validateIdParam(paramName = "id") {
  return (req, res, next) => {
    const id = req.params[paramName];

    if (!id) {
      return res.status(400).json(
        formatResponseBody({
          error: `${paramName} parameter is required`,
        }),
      );
    }

    if (!isValidId(id)) {
      return res.status(400).json(
        formatResponseBody({
          error: `Invalid ${paramName} format. Must be a positive integer.`,
        }),
      );
    }

    // Convert to number and store in request for consistency
    req.params[paramName] = Number(id);
    next();
  };
}

/**
 * Middleware to validate multiple ID parameters
 * @param {Array} paramNames - Array of parameter names to validate
 * @returns {Function} Express middleware function
 */
function validateMultipleIdParams(paramNames) {
  return (req, res, next) => {
    const errors = [];

    for (const paramName of paramNames) {
      const id = req.params[paramName];

      if (!id) {
        errors.push(`${paramName} parameter is required`);
      } else if (!isValidId(id)) {
        errors.push(`Invalid ${paramName} format. Must be a positive integer.`);
      } else {
        // Convert to number and store in request for consistency
        req.params[paramName] = Number(id);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json(
        formatResponseBody({
          error: errors.join(", "),
        }),
      );
    }

    next();
  };
}

/**
 * Middleware to validate ID in request body
 * @param {string} fieldName - The name of the field to validate (default: 'id')
 * @returns {Function} Express middleware function
 */
function validateIdInBody(fieldName = "id") {
  return (req, res, next) => {
    const id = req.body[fieldName];

    if (id !== undefined && id !== null && !isValidId(id)) {
      return res.status(400).json(
        formatResponseBody({
          error: `Invalid ${fieldName} format. Must be a positive integer.`,
        }),
      );
    }

    if (id !== undefined && id !== null) {
      // Convert to number and store in body for consistency
      req.body[fieldName] = Number(id);
    }

    next();
  };
}

module.exports = {
  validateIdParam,
  validateMultipleIdParams,
  validateIdInBody,
};
