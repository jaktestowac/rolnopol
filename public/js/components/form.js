/**
 * Form Component
 * Provides form handling with validation and submission
 */
class FormComponent {
  constructor(formElement, options = {}) {
    this.form = formElement;
    this.options = {
      validateOnBlur: true,
      validateOnInput: false,
      showErrors: true,
      ...options,
    };
    this.validators = new Map();
    this.eventBus = null;

    this._init();
  }

  /**
   * Initialize form component
   * @private
   */
  _init() {
    if (!this.form) {
      throw new Error("Form element is required");
    }

    this._setupEventListeners();
  }

  /**
   * Set event bus for communication
   * @param {EventBus} eventBus - Event bus instance
   */
  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Add field validator
   * @param {string} fieldName - Field name
   * @param {Function} validator - Validator function
   */
  addValidator(fieldName, validator) {
    this.validators.set(fieldName, validator);
  }

  /**
   * Get form data as object
   * @returns {Object} Form data
   */
  getData() {
    const formData = new FormData(this.form);
    const data = {};

    for (const [key, value] of formData.entries()) {
      data[key] = value.trim();
    }

    return data;
  }

  /**
   * Set form data from object
   * @param {Object} data - Form data
   */
  setData(data) {
    Object.entries(data).forEach(([key, value]) => {
      const field = this.form.querySelector(`[name="${key}"]`);
      if (field) {
        field.value = value;
      }
    });
  }

  /**
   * Validate entire form
   * @returns {Object} Validation result
   */
  validate() {
    const errors = {};
    let isValid = true;

    for (const [fieldName, validator] of this.validators) {
      const field = this.form.querySelector(`[name="${fieldName}"]`);
      if (field) {
        const error = validator(field.value, this.getData());
        if (error) {
          errors[fieldName] = error;
          isValid = false;

          if (this.options.showErrors) {
            this._showFieldError(field, error);
          }
        } else {
          this._clearFieldError(field);
        }
      }
    }

    return { isValid, errors };
  }

  /**
   * Validate single field
   * @param {string} fieldName - Field name
   * @returns {string|null} Error message or null
   */
  validateField(fieldName) {
    const validator = this.validators.get(fieldName);
    const field = this.form.querySelector(`[name="${fieldName}"]`);

    if (!validator || !field) return null;

    const error = validator(field.value, this.getData());

    if (this.options.showErrors) {
      if (error) {
        this._showFieldError(field, error);
      } else {
        this._clearFieldError(field);
      }
    }

    return error;
  }

  /**
   * Clear all form errors
   */
  clearErrors() {
    const errorElements = this.form.querySelectorAll(".form__error");
    errorElements.forEach((el) => el.remove());

    const fields = this.form.querySelectorAll(".form__field--error");
    fields.forEach((field) => field.classList.remove("form__field--error"));
  }

  /**
   * Reset form
   */
  reset() {
    this.form.reset();
    this.clearErrors();
  }

  /**
   * Handle form submission
   * @param {Function} handler - Submission handler
   */
  onSubmit(handler) {
    this.form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const validation = this.validate();
      if (!validation.isValid) {
        if (this.eventBus) {
          this.eventBus.emit("form:validationError", {
            form: this.form,
            errors: validation.errors,
          });
        }
        return;
      }

      try {
        await handler(this.getData(), this);
      } catch (error) {
        // Always log errors through the error logger to prevent unhandled promise rejections
        if (window.errorLogger) {
          errorLogger.log("Form Submission", error, { showToUser: false });
        }

        if (this.eventBus) {
          this.eventBus.emit("form:submitError", {
            form: this.form,
            error,
          });
        }

        // Don't re-throw the error to prevent unhandled promise rejections
        // The error has been logged and the event has been emitted
      }
    });
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Validation on blur
    if (this.options.validateOnBlur) {
      this.form.addEventListener(
        "blur",
        (e) => {
          if (e.target.name && this.validators.has(e.target.name)) {
            this.validateField(e.target.name);
          }
        },
        true,
      );
    }

    // Validation on input
    if (this.options.validateOnInput) {
      this.form.addEventListener("input", (e) => {
        if (e.target.name && this.validators.has(e.target.name)) {
          // Debounce validation on input
          clearTimeout(e.target._validationTimeout);
          e.target._validationTimeout = setTimeout(() => {
            this.validateField(e.target.name);
          }, 300);
        }
      });
    }
  }

  /**
   * Show field error
   * @private
   */
  _showFieldError(field, error) {
    this._clearFieldError(field);

    field.classList.add("form__field--error");

    const errorElement = document.createElement("div");
    errorElement.className = "form__error";
    errorElement.textContent = error;
    errorElement.setAttribute("role", "alert");

    field.parentNode.appendChild(errorElement);
  }

  /**
   * Clear field error
   * @private
   */
  _clearFieldError(field) {
    field.classList.remove("form__field--error");

    const existingError = field.parentNode.querySelector(".form__error");
    if (existingError) {
      existingError.remove();
    }
  }
}

/**
 * Form validation utilities
 */
const FormValidators = {
  required:
    (message = "This field is required") =>
    (value) => {
      return !value ? message : null;
    },

  email:
    (message = "Please enter a valid email address") =>
    (value) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return value && !emailRegex.test(value) ? message : null;
    },

  minLength: (min, message) => (value) => {
    message = message || `Must be at least ${min} characters`;
    return value && value.length < min ? message : null;
  },

  maxLength: (max, message) => (value) => {
    message = message || `Must be no more than ${max} characters`;
    return value && value.length > max ? message : null;
  },

  pattern:
    (regex, message = "Invalid format") =>
    (value) => {
      return value && !regex.test(value) ? message : null;
    },
  match:
    (fieldName, message = "Fields do not match") =>
    (value, formData) => {
      return value && value !== formData[fieldName] ? message : null;
    },
  displayName:
    (
      message = "Display name can only contain letters, numbers, spaces, hyphens, and underscores",
    ) =>
    (value) => {
      if (!value) return null;
      const trimmedValue = value.trim();
      if (trimmedValue.length < 3)
        return "Display name must be at least 3 characters";
      if (trimmedValue.length > 20)
        return "Display name must be no more than 20 characters";
      const displayNameRegex = /^[a-zA-Z0-9\s\-_]+$/;
      return !displayNameRegex.test(trimmedValue) ? message : null;
    },
  username:
    (
      message = "Username must be 3-50 characters and contain only letters, numbers, underscores, hyphens, and dots",
    ) =>
    (value) => {
      if (!value) return null;
      const trimmedValue = value.trim();
      if (trimmedValue.length < 3)
        return "Username must be at least 3 characters";
      if (trimmedValue.length > 50)
        return "Username must be no more than 50 characters";
      const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
      return !usernameRegex.test(trimmedValue) ? message : null;
    },
};

// Export for global use
window.FormValidators = FormValidators;
