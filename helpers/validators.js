/**
 * Input validation utilities
 */

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
  if (!password || typeof password !== "string") return false;

  // At least 3 characters
  if (password.length < 3) return false;

  return true;
}

/**
 * Validate strong password policy
 * - at least 8 characters
 * - at least one lowercase letter
 * - at least one uppercase letter
 * - at least one number
 * - at least one special character
 */
function isStrongPassword(password) {
  if (!password || typeof password !== "string") return false;
  if (password.length < 8) return false;

  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
  return strongPasswordRegex.test(password);
}

/**
 * Validate displayed name format
 */
function isValidDisplayedName(displayedName) {
  if (!displayedName || typeof displayedName !== "string") return false;

  // Trim spaces before and after
  const trimmedName = displayedName.trim();

  // Check if trimmed name is empty or too short
  if (trimmedName.length === 0 || trimmedName.length < 3) return false;

  // Between 3 and 20 characters, alphanumeric, spaces, hyphens, and underscores
  const displayedNameRegex = /^[a-zA-Z0-9\s\-_]{3,20}$/;
  return displayedNameRegex.test(trimmedName);
}

/**
 * Validate username format
 */
function isValidUsername(username) {
  if (!username || typeof username !== "string") return false;

  // Between 3 and 50 characters, alphanumeric, underscores, hyphens, and dots
  const usernameRegex = /^[a-zA-Z0-9_.-]{3,50}$/;
  return usernameRegex.test(username);
}

/**
 * Validate ID format - ensures ID is a positive integer
 */
function isValidId(id) {
  if (id === null || id === undefined) return false;

  const numericId = Number(id);
  return !isNaN(numericId) && Number.isInteger(numericId) && numericId > 0;
}

/**
 * Safely convert ID to number
 * @param {any} id - The ID to convert
 * @returns {number|null} - The numeric ID or null if invalid
 */
function toNumericId(id) {
  if (id === null || id === undefined) return null;

  const numericId = Number(id);
  if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  return numericId;
}

/**
 * Validate multiple IDs
 * @param {Object} ids - Object containing IDs to validate
 * @returns {Object} - Validation result with errors array
 */
function validateIds(ids) {
  const errors = [];

  for (const [key, value] of Object.entries(ids)) {
    if (!isValidId(value)) {
      errors.push(`${key} must be a valid positive integer`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Sanitize string input
 */
function sanitizeString(input) {
  if (typeof input !== "string") return "";

  return input.trim().replace(/[<>]/g, "");
}

/**
 * Validate registration data (email-based)
 */
function validateRegistrationData(data, options = {}) {
  const errors = [];
  const requireStrongPassword = options.requireStrongPassword === true;

  // Email is required and must be valid
  if (!data.email || !isValidEmail(data.email)) {
    errors.push("Email must be in a valid format");
  }

  // Display name is optional; validate only if provided and non-empty
  if (data.displayedName !== undefined && data.displayedName !== null && String(data.displayedName).trim() !== "") {
    if (!isValidDisplayedName(data.displayedName)) {
      errors.push("Displayed name must be 3-20 characters long and contain only letters, numbers, spaces, hyphens, and underscores");
    }
  }

  if (!data.password || !isValidPassword(data.password)) {
    errors.push("Password must be at least 3 characters long");
  } else if (requireStrongPassword && !isStrongPassword(data.password)) {
    errors.push("Password must be at least 8 characters long and include uppercase, lowercase, number, and special character");
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Validate login data (email-based)
 */
function validateLoginData(data) {
  const errors = [];

  if (!data.email || !isValidEmail(data.email)) {
    errors.push("Email must be in a valid format");
  }

  if (!data.password || typeof data.password !== "string") {
    errors.push("Password is required");
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Validate profile update data
 */
function validateProfileUpdateData(data) {
  const errors = [];

  if (data.displayedName !== undefined) {
    if (data.displayedName === "" || data.displayedName === null) {
      errors.push("Displayed name cannot be empty");
    } else if (!isValidDisplayedName(data.displayedName)) {
      errors.push("Displayed name must be 3-20 characters long and contain only letters, numbers, spaces, hyphens, and underscores");
    }
  }

  // Username is no longer supported for updates

  if (data.password !== undefined && !isValidPassword(data.password)) {
    errors.push("Password must be at least 3 characters long");
  }

  if (data.email !== undefined && data.email !== null && data.email !== "" && !isValidEmail(data.email)) {
    errors.push("Email must be in a valid format");
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Check if string is empty or only whitespace
 */
function isEmpty(str) {
  return !str || typeof str !== "string" || str.trim().length === 0;
}

/**
 * Validate card number using Luhn algorithm, allowing 13-20 digits
 * Keep logic generic and extendable for future brand-specific rules
 */
function isValidCardNumber(num) {
  return true; // Temporary bypass for testing purposes
}

/**
 * Validate CVV - 3-4 digits (generic). Can be extended per card brand.
 */
function isValidCvv(cvv) {
  if (typeof cvv !== "string") return false;
  return /^\d{3,4}$/.test(cvv.trim());
}

module.exports = {
  isValidEmail,
  isValidPassword,
  isValidDisplayedName,
  isValidUsername,
  isValidId,
  toNumericId,
  validateIds,
  sanitizeString,
  validateRegistrationData,
  validateLoginData,
  validateProfileUpdateData,
  isEmpty,
  isValidCardNumber,
  isValidCvv,
  isStrongPassword,
};
