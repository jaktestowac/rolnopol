/**
 * Profile Page Module
 * Handles profile page functionality in the modular architecture
 */
class ProfilePage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.notification = null;
    this.eventBus = null;
    this.currentUser = null;
    this.updateForm = null;
    this.isLoading = false;
    // Prevent duplicate toasts in quick succession
    this._lastToast = { message: null, at: 0 };
  }

  /**
   * Initialize the profile page
   * @param {App} app - Application instance
   */
  async init(app) {
    this.authService = app.getModule("authService");
    this.apiService = app.getModule("apiService");
    this.notification = app.getModule("notification");
    this.eventBus = app.getEventBus();

    // Wait for authentication to be properly set
    const isAuthenticated = await this.authService.waitForAuth(3000);

    if (!isAuthenticated) {
      window.location.href = "/login.html";
      return;
    }

    // Ensure user is authenticated
    if (!this.authService.requireAuth("/login.html")) {
      return;
    }

    await this._loadProfileData();
    this._setupProfileForm();
    this._setupEventListeners();
  }

  /**
   * Load profile data from API
   * @private
   */
  async _loadProfileData() {
    const loadingElement = document.getElementById("loadingMessage");
    const errorElement = document.getElementById("errorMessage");
    const profileContent = document.getElementById("profileContent");

    try {
      loadingElement.style.display = "block";
      errorElement.style.display = "none";
      profileContent.style.display = "none";

      const response = await this.apiService.get("users/profile", {
        requiresAuth: true,
      });

      if (response.success && response.data) {
        // Handle nested data structure: response.data.data contains the actual user data
        this.currentUser = response.data.data || response.data;
        loadingElement.style.display = "none";
        profileContent.style.display = "block";
        this._updateProfileDisplay();
      } else {
        // Handle authentication errors
        if (response.status === 401 || response.status === 403) {
          // Clear authentication data
          if (this.authService && this.authService.storage) {
            this.authService._clearSession();
          }

          // Redirect to login page
          window.location.href = "/login.html";
          return;
        }

        throw new Error(response.error || "Failed to load profile data");
      }
    } catch (error) {
      errorLogger.log("Profile Data Loading", error, { showToUser: false });
      loadingElement.style.display = "none";
      this._showError("Failed to load profile data. Please try again.", error);

      // Handle authentication errors
      if (error.status === 401 || error.status === 403) {
        // Clear authentication data
        if (this.authService && this.authService.storage) {
          this.authService._clearSession();
        }

        // Redirect to login page
        window.location.href = "/login.html";
        return;
      }
    }
    await this._loadFields();
    await this._loadStaff();
  }

  async _loadFields() {
    const fieldsList = document.getElementById("fieldsList");
    const fieldMessage = document.getElementById("fieldMessage");
    if (!fieldsList) return;
    fieldsList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("fields", {
        requiresAuth: true,
      });
      if (response.success && Array.isArray(response.data)) {
        fieldsList.innerHTML =
          response.data.length === 0 ? "<li>No fields found.</li>" : "";
        response.data.forEach((field) => {
          const li = document.createElement("li");
          li.innerHTML = `<strong>${field.name}</strong> (${field.area} ha)`;
          fieldsList.appendChild(li);
        });
      } else {
        fieldsList.innerHTML = "<li>Error loading fields.</li>";
      }
    } catch (e) {
      fieldsList.innerHTML = "<li>Error loading fields.</li>";
    }
    if (fieldMessage) fieldMessage.textContent = "";
  }

  async _addField(e) {
    e.preventDefault();
    const name = document.getElementById("fieldName").value.trim();
    const area = parseFloat(document.getElementById("fieldArea").value);
    const fieldMessage = document.getElementById("fieldMessage");
    if (!name || isNaN(area)) {
      fieldMessage.textContent = "Name and area are required.";
      return;
    }
    try {
      const response = await this.apiService.post(
        "fields",
        { name, area },
        { requiresAuth: true },
      );
      if (response.success) {
        fieldMessage.textContent = "Field added!";
        document.getElementById("addFieldForm").reset();
        await this._loadFields();
      } else {
        fieldMessage.textContent = response.error || "Error adding field.";
      }
    } catch (e) {
      fieldMessage.textContent = "Error adding field.";
    }
  }

  async _deleteField(fieldId) {
    const fieldMessage = document.getElementById("fieldMessage");
    try {
      const response = await this.apiService.delete(`fields/${fieldId}`, {
        requiresAuth: true,
      });
      if (response.success) {
        fieldMessage.textContent = "Field deleted!";
        await this._loadFields();
      } else {
        fieldMessage.textContent = response.error || "Error deleting field.";
      }
    } catch (e) {
      fieldMessage.textContent = "Error deleting field.";
    }
  }

  async _loadStaff() {
    const staffList = document.getElementById("staffList");
    const staffMessage = document.getElementById("staffMessage");
    if (!staffList) return;
    staffList.innerHTML = "<li>Loading...</li>";
    try {
      const response = await this.apiService.get("staff", {
        requiresAuth: true,
      });
      if (response.success && Array.isArray(response.data)) {
        staffList.innerHTML =
          response.data.length === 0 ? "<li>No staff found.</li>" : "";
        response.data.forEach((staff) => {
          const li = document.createElement("li");
          li.innerHTML = `<strong>${staff.name} ${staff.surname}</strong> (age: ${staff.age})`;
          staffList.appendChild(li);
        });
      } else {
        staffList.innerHTML = "<li>Error loading staff.</li>";
      }
    } catch (e) {
      staffList.innerHTML = "<li>Error loading staff.</li>";
    }
    if (staffMessage) staffMessage.textContent = "";
  }

  async _addStaff(e) {
    e.preventDefault();
    const name = document.getElementById("staffName").value.trim();
    const surname = document.getElementById("staffSurname").value.trim();
    const age = parseInt(document.getElementById("staffAge").value);
    const staffMessage = document.getElementById("staffMessage");
    if (!name || !surname || isNaN(age)) {
      staffMessage.textContent = "Name, surname, and age are required.";
      return;
    }
    try {
      const response = await this.apiService.post(
        "staff",
        { name, surname, age },
        { requiresAuth: true },
      );
      if (response.success) {
        staffMessage.textContent = "Staff added!";
        document.getElementById("addStaffForm").reset();
        await this._loadStaff();
      } else {
        staffMessage.textContent = response.error || "Error adding staff.";
      }
    } catch (e) {
      staffMessage.textContent = "Error adding staff.";
    }
  }

  async _deleteStaff(staffId) {
    const staffMessage = document.getElementById("staffMessage");
    try {
      const response = await this.apiService.delete(`staff/${staffId}`, {
        requiresAuth: true,
      });
      if (response.success) {
        staffMessage.textContent = "Staff deleted!";
        await this._loadStaff();
      } else {
        staffMessage.textContent = response.error || "Error deleting staff.";
      }
    } catch (e) {
      staffMessage.textContent = "Error deleting staff.";
    }
  }

  /**
   * Show error message with the new error card structure
   * @private
   */
  _showError(message, error = null) {
    const errorElement = document.getElementById("errorMessage");
    const errorText = document.getElementById("errorText");

    if (errorElement && errorText) {
      errorText.textContent = message;
      errorElement.style.display = "flex";
    }
  }

  /**
   * Update profile display with user data
   * @private
   */
  _updateProfileDisplay() {
    if (!this.currentUser) {
      errorLogger.log(
        "Profile Display",
        "No current user data available for display",
      );
      return;
    }

    // Update profile header
    this._updateProfileHeader();

    // Update profile information
    const elements = {
      userId: document.getElementById("userId"),
      displayedName: document.getElementById("displayedName"),
      email: document.getElementById("email"),
      createdAt: document.getElementById("createdAt"),
      lastLogin: document.getElementById("lastLogin"),
    };

    // Update profile information display with correct field mapping
    if (elements.userId) {
      const userIdValue =
        this.currentUser.userId ||
        this.currentUser.id ||
        this.currentUser.internalId ||
        "N/A";
      elements.userId.textContent = userIdValue;
    }

    if (elements.displayedName) {
      const displayedNameValue = this.currentUser.displayedName || "N/A";
      elements.displayedName.textContent = displayedNameValue;
    }

    if (elements.email) {
      const emailValue = this.currentUser.email || "No email provided";
      elements.email.textContent = emailValue;
    }

    // Format dates
    if (elements.createdAt && this.currentUser.createdAt) {
      const createdAtValue = this._formatDate(this.currentUser.createdAt);
      elements.createdAt.textContent = createdAtValue;
    } else if (elements.createdAt) {
      elements.createdAt.textContent = "N/A";
    }

    // Get last login from API response or session storage
    if (elements.lastLogin) {
      if (this.currentUser.lastLogin) {
        const lastLoginValue = this._formatDate(this.currentUser.lastLogin);
        elements.lastLogin.textContent = lastLoginValue;
      } else {
        const loginTime =
          this.authService.storage?.cookie.get("rolnopolLoginTime");
        if (loginTime) {
          const loginTimeValue = this._formatDate(parseInt(loginTime));
          elements.lastLogin.textContent = loginTimeValue;
        } else {
          elements.lastLogin.textContent = "Current session";
        }
      }
    }

    // Populate update form
    this._populateUpdateForm();
  }

  /**
   * Update profile header with user information
   * @private
   */
  _updateProfileHeader() {
    const profileName = document.getElementById("profileName");
    const profileEmail = document.getElementById("profileEmail");
    const statusBadge = document.getElementById("statusBadge");
    const statusText = document.getElementById("statusText");

    if (profileName) {
      profileName.textContent = this.currentUser.displayedName || "User";
    }

    if (profileEmail) {
      profileEmail.textContent = this.currentUser.email || "No email provided";
    }

    // Update status badge
    if (statusBadge && statusText) {
      const isActive = this.currentUser.isActive !== false; // Default to true if not specified

      if (isActive) {
        statusBadge.className = "status-badge active";
        statusText.textContent = "Active";
      } else {
        statusBadge.className = "status-badge inactive";
        statusText.textContent = "Inactive";
      }
    }
  }

  /**
   * Format date for display
   * @private
   */
  _formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return "Invalid date";
    }
  }

  /**
   * Populate the update form with current user data
   * @private
   */
  _populateUpdateForm() {
    if (!this.currentUser) return;

    const form = document.getElementById("updateProfileForm");
    if (!form) return;

    const fields = {
      newDisplayedName: this.currentUser.displayedName || "",
      newPassword: "", // Always leave password field empty
    };

    Object.entries(fields).forEach(([fieldName, value]) => {
      const field = form.querySelector(`[name="${fieldName}"], #${fieldName}`);
      if (field) {
        field.value = value;
      }
    });
  }

  /**
   * Setup profile update form
   * @private
   */
  _setupProfileForm() {
    const updateForm = document.getElementById("updateProfileForm");
    if (!updateForm) return;

    this.updateForm = new FormComponent(updateForm);
    this.updateForm.setEventBus(this.eventBus);

    // Add validation rules
    this.updateForm.addValidator(
      "newDisplayedName",
      window.FormValidators.required("Display name is required"),
    );
    this.updateForm.addValidator(
      "newDisplayedName",
      window.FormValidators.displayName(),
    );

    // Password validation - only if password is provided
    this.updateForm.addValidator("newPassword", (value) => {
      if (value && value.length > 0) {
        if (value.length < 3) {
          return "Password must be at least 3 characters";
        }
        if (value.length > 50) {
          return "Password must be no more than 50 characters";
        }
      }
      return null;
    });

    // Password confirmation validation
    this.updateForm.addValidator("confirmPassword", (value) => {
      const password = document.getElementById("newPassword").value;
      if (password && value !== password) {
        return "Passwords do not match";
      }
      return null;
    });

    // Setup real-time validation for display name and passwords
    this._setupDisplayNameValidation();
    this._setupPasswordValidation();

    // Handle form submission
    this.updateForm.onSubmit(async (formData) => {
      await this._handleProfileUpdate(formData);
    });
  }

  /**
   * Setup real-time display name validation with visual feedback
   * @private
   */
  _setupDisplayNameValidation() {
    const displayedNameInput = document.getElementById("newDisplayedName");
    const charCounter = document.getElementById("displayedNameCharCount");
    const errorElement = document.getElementById("displayedNameError");
    const errorText = document.getElementById("displayedNameErrorText");
    const successElement = document.getElementById("displayedNameSuccess");

    if (!displayedNameInput) return;

    // Character counter update
    const updateCharCounter = () => {
      const length = displayedNameInput.value.length;
      charCounter.textContent = length;

      // Update counter color based on length
      charCounter.className = "current";
      if (length >= 20) {
        charCounter.classList.add("at-limit");
      } else if (length >= 16) {
        charCounter.classList.add("near-limit");
      }
    };

    // Real-time validation
    const validateDisplayName = () => {
      const value = displayedNameInput.value.trim();
      const length = value.length;

      // Remove existing validation classes
      displayedNameInput.classList.remove("valid", "invalid");
      errorElement.classList.add("hide");
      successElement.classList.remove("hide");

      // Check if empty
      if (length === 0) {
        displayedNameInput.classList.add("invalid");
        errorText.textContent = "Display name is required";
        errorElement.classList.remove("hide");
        return false;
      }

      // Check minimum length
      if (length < 3) {
        displayedNameInput.classList.add("invalid");
        errorText.textContent = "Display name must be at least 3 characters";
        errorElement.classList.remove("hide");
        return false;
      }

      // Check maximum length
      if (length > 20) {
        displayedNameInput.classList.add("invalid");
        errorText.textContent =
          "Display name must be no more than 20 characters";
        errorElement.classList.remove("hide");
        return false;
      }

      // Check for valid characters (alphanumeric, spaces, hyphens, underscores)
      const validPattern = /^[a-zA-Z0-9\s\-_]+$/;
      if (!validPattern.test(value)) {
        displayedNameInput.classList.add("invalid");
        errorText.textContent =
          "Display name can only contain letters, numbers, spaces, hyphens, and underscores";
        errorElement.classList.remove("hide");
        return false;
      }

      // Valid display name
      displayedNameInput.classList.add("valid");
      successElement.classList.remove("hide");
      return true;
    };

    // Event listeners
    displayedNameInput.addEventListener("input", () => {
      updateCharCounter();
      validateDisplayName();
    });

    displayedNameInput.addEventListener("blur", validateDisplayName);
    displayedNameInput.addEventListener("focus", () => {
      // Show validation state on focus
      if (displayedNameInput.value.trim().length > 0) {
        validateDisplayName();
      }
    });

    // Initialize counter
    updateCharCounter();
  }

  /**
   * Setup real-time password validation with visual feedback
   * @private
   */
  _setupPasswordValidation() {
    const passwordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const passwordCharCounter = document.getElementById("passwordCharCount");
    const confirmPasswordCharCounter = document.getElementById(
      "confirmPasswordCharCount",
    );
    const passwordErrorElement = document.getElementById("passwordError");
    const passwordErrorText = document.getElementById("passwordErrorText");
    const passwordSuccessElement = document.getElementById("passwordSuccess");
    const confirmPasswordErrorElement = document.getElementById(
      "confirmPasswordError",
    );
    const confirmPasswordErrorText = document.getElementById(
      "confirmPasswordErrorText",
    );
    const confirmPasswordSuccessElement = document.getElementById(
      "confirmPasswordSuccess",
    );

    if (!passwordInput || !confirmPasswordInput) return;

    // Character counter update
    const updateCharCounter = (input, counter, limit) => {
      const length = input.value.length;
      counter.textContent = length;

      // Update counter color based on length
      counter.className = "current";
      if (length >= limit) {
        counter.classList.add("at-limit");
      } else if (length >= limit * 0.8) {
        counter.classList.add("near-limit");
      }
    };

    // Password validation
    const validatePassword = () => {
      const value = passwordInput.value;
      const length = value.length;

      // Remove existing validation classes
      passwordInput.classList.remove("valid", "invalid");
      passwordErrorElement.classList.add("hide");
      passwordSuccessElement.classList.add("hide");

      // If empty, it's optional
      if (length === 0) {
        return true;
      }

      // Check minimum length
      if (length < 3) {
        passwordInput.classList.add("invalid");
        passwordErrorText.textContent =
          "Password must be at least 3 characters";
        passwordErrorElement.classList.remove("hide");
        return false;
      }

      // Check maximum length
      if (length > 50) {
        passwordInput.classList.add("invalid");
        passwordErrorText.textContent =
          "Password must be no more than 50 characters";
        passwordErrorElement.classList.remove("hide");
        return false;
      }

      // Valid password
      passwordInput.classList.add("valid");
      passwordSuccessElement.classList.remove("hide");
      return true;
    };

    // Password confirmation validation
    const validateConfirmPassword = () => {
      const passwordValue = passwordInput.value;
      const confirmValue = confirmPasswordInput.value;

      // Remove existing validation classes
      confirmPasswordInput.classList.remove("valid", "invalid");
      confirmPasswordErrorElement.classList.add("hide");
      confirmPasswordSuccessElement.classList.add("hide");

      // If password is empty, confirmation is not needed
      if (passwordValue.length === 0) {
        return true;
      }

      // If confirmation is empty but password is not
      if (confirmValue.length === 0) {
        confirmPasswordInput.classList.add("invalid");
        confirmPasswordErrorText.textContent = "Please confirm your password";
        confirmPasswordErrorElement.classList.remove("hide");
        return false;
      }

      // Check if passwords match
      if (passwordValue !== confirmValue) {
        confirmPasswordInput.classList.add("invalid");
        confirmPasswordErrorText.textContent = "Passwords do not match";
        confirmPasswordErrorElement.classList.remove("hide");
        return false;
      }

      // Valid confirmation
      confirmPasswordInput.classList.add("valid");
      confirmPasswordSuccessElement.classList.remove("hide");
      return true;
    };

    // Event listeners for password
    passwordInput.addEventListener("input", () => {
      updateCharCounter(passwordInput, passwordCharCounter, 50);
      validatePassword();
      validateConfirmPassword(); // Re-validate confirmation when password changes
    });

    passwordInput.addEventListener("blur", validatePassword);
    passwordInput.addEventListener("focus", () => {
      if (passwordInput.value.length > 0) {
        validatePassword();
      }
    });

    // Event listeners for confirm password
    confirmPasswordInput.addEventListener("input", () => {
      updateCharCounter(confirmPasswordInput, confirmPasswordCharCounter, 50);
      validateConfirmPassword();
    });

    confirmPasswordInput.addEventListener("blur", validateConfirmPassword);
    confirmPasswordInput.addEventListener("focus", () => {
      if (confirmPasswordInput.value.length > 0) {
        validateConfirmPassword();
      }
    });

    // Initialize counters
    updateCharCounter(passwordInput, passwordCharCounter, 50);
    updateCharCounter(confirmPasswordInput, confirmPasswordCharCounter, 50);
  }

  /**
   * Handle profile update submission
   * @private
   */
  async _handleProfileUpdate(formData) {
    if (this.isLoading) return;

    // Validate password confirmation
    if (
      formData.newPassword &&
      formData.newPassword !== formData.confirmPassword
    ) {
      this._showUpdateMessage("Passwords do not match", "error");
      return;
    }

    this.isLoading = true;
    const submitButton = document.querySelector(
      '#updateProfileForm button[type="submit"]',
    );
    const originalText = submitButton.innerHTML;

    try {
      // Show loading state
      submitButton.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Updating...';
      submitButton.disabled = true;

      // Prepare update data
      const updateData = {
        displayedName: formData.newDisplayedName,
      };

      // Only include password if it's provided and confirmed
      if (formData.newPassword && formData.newPassword.trim()) {
        updateData.password = formData.newPassword;
      }

      const response = await this.apiService.put("users/profile", updateData, {
        requiresAuth: true,
      });

      if (response.success) {
        // Update local user data
        this.currentUser = { ...this.currentUser, ...updateData };

        // Update display
        this._updateProfileDisplay();

        // Show success message
        this._showUpdateMessage("Profile updated successfully!", "success");

        // Show success notification through notification system
        if (window.App && window.App.getEventBus) {
          const eventBus = window.App.getEventBus();
          eventBus.emit("notification:show", {
            message: "Profile updated successfully!",
            type: "success",
            duration: 5000,
          });
        } else if (window.showNotification) {
          window.showNotification("Profile updated successfully!", "success");
        }

        // Clear password fields
        const passwordField = document.getElementById("newPassword");
        const confirmPasswordField = document.getElementById("confirmPassword");
        if (passwordField) {
          passwordField.value = "";
        }
        if (confirmPasswordField) {
          confirmPasswordField.value = "";
        }

        // Reset password validation states
        this._resetPasswordValidation();
      } else {
        throw new Error(response.error || "Failed to update profile");
      }
    } catch (error) {
      errorLogger.log("Profile Update", error, { showToUser: false });

      let errorMessage = "Failed to update profile. Please try again.";

      if (error.status === 401 || error.status === 403) {
        errorMessage = "Session expired. Please log in again.";
        // Clear authentication data
        if (this.authService && this.authService.storage) {
          this.authService._clearSession();
        }
        // Redirect to login page
        setTimeout(() => {
          window.location.href = "/login.html";
        }, 2000);
      } else if (error.message) {
        errorMessage = error.message;
      }

      this._showUpdateMessage(errorMessage, "error");

      // Error notification is handled by ErrorLogger automatically
    } finally {
      // Reset button state
      submitButton.innerHTML = originalText;
      submitButton.disabled = false;
      this.isLoading = false;
    }
  }

  /**
   * Show update message
   * @private
   */
  _showUpdateMessage(message, type = "info") {
    const messageElement = document.getElementById("updateMessage");
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.className = `message ${type}`;
      messageElement.style.display = "block";

      // Auto-hide success messages after 5 seconds
      if (type === "success") {
        setTimeout(() => {
          messageElement.style.display = "none";
        }, 5000);
      }
    }
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Logout button
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this._handleLogout();
      });
    }

    // Delete account functionality
    this._setupDeleteAccountHandlers();
    // Add event listeners for fields and staff forms
    const addFieldForm = document.getElementById("addFieldForm");
    if (addFieldForm) {
      addFieldForm.addEventListener("submit", this._addField.bind(this));
    }
    const addStaffForm = document.getElementById("addStaffForm");
    if (addStaffForm) {
      addStaffForm.addEventListener("submit", this._addStaff.bind(this));
    }

    // Inline edit for Profile Information card
    this._setupInlineEditHandlers();
  }

  /**
   * Setup delete account event handlers
   * @private
   */
  _setupDeleteAccountHandlers() {
    const deleteAccountBtn = document.getElementById("deleteAccountBtn");
    const deleteModal = document.getElementById("deleteAccountModal");
    const closeModalBtn = document.getElementById("closeDeleteModal");
    const cancelDeleteBtn = document.getElementById("cancelDelete");
    const confirmDeleteBtn = document.getElementById("confirmDelete");
    const deleteConfirmationInput =
      document.getElementById("deleteConfirmation");

    if (!deleteAccountBtn || !deleteModal) return;

    // Open delete modal
    deleteAccountBtn.addEventListener("click", () => {
      deleteModal.style.display = "flex";
      deleteConfirmationInput.focus();
    });

    // Close modal handlers
    const closeModal = () => {
      deleteModal.style.display = "none";
      deleteConfirmationInput.value = "";
      confirmDeleteBtn.disabled = true;
    };

    closeModalBtn.addEventListener("click", closeModal);
    cancelDeleteBtn.addEventListener("click", closeModal);

    // Close modal when clicking outside
    deleteModal.addEventListener("click", (e) => {
      if (e.target === deleteModal) {
        closeModal();
      }
    });

    // Close modal with Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && deleteModal.style.display === "flex") {
        closeModal();
      }
    });

    // Handle confirmation input
    deleteConfirmationInput.addEventListener("input", () => {
      const value = deleteConfirmationInput.value.trim();
      confirmDeleteBtn.disabled = value !== "DELETE";

      // Add visual feedback
      if (value === "DELETE") {
        deleteConfirmationInput.classList.add("valid");
        deleteConfirmationInput.classList.remove("invalid");
      } else if (value.length > 0) {
        deleteConfirmationInput.classList.add("invalid");
        deleteConfirmationInput.classList.remove("valid");
      } else {
        deleteConfirmationInput.classList.remove("valid", "invalid");
      }
    });

    // Handle delete confirmation
    confirmDeleteBtn.addEventListener("click", () => {
      if (deleteConfirmationInput.value.trim() === "DELETE") {
        this._handleDeleteAccount();
      }
    });
  }

  /**
   * Setup inline edit handlers for Profile Information card
   * @private
   */
  _setupInlineEditHandlers() {
    const editBtn = document.getElementById("editProfileInfoBtn");
    const cancelBtn = document.getElementById("editProfileCancel");
    const saveBtn = document.getElementById("editProfileSave");
    const nameInput = document.getElementById("inlineDisplayedName");
    const emailInput = document.getElementById("inlineEmail");

    if (!editBtn || !cancelBtn || !saveBtn || !nameInput || !emailInput) return;

    // Prefill on init
    const prefill = () => {
      if (!this.currentUser) return;
      nameInput.value = this.currentUser.displayedName || "";
      emailInput.value = this.currentUser.email || "";
    };
    prefill();

    editBtn.addEventListener("click", () => {
      this._toggleInlineEdit(true);
      prefill();
      nameInput.focus();
    });

    cancelBtn.addEventListener("click", () => {
      this._clearInlineErrors();
      this._toggleInlineEdit(false);
      prefill();
    });

    const onInput = () => {
      const { isValid } = this._validateInlineFields(false);
      saveBtn.disabled = !isValid;
    };
    nameInput.addEventListener("input", onInput);
    emailInput.addEventListener("input", onInput);

    saveBtn.addEventListener("click", async () => {
      const { isValid, data } = this._validateInlineFields(true);
      if (!isValid) return;
      await this._handleInlineSave(data);
    });
  }

  /**
   * Toggle inline edit mode visibility
   * @private
   */
  _toggleInlineEdit(enable) {
    const nameGroup = document.getElementById("editDisplayedNameGroup");
    const emailGroup = document.getElementById("editEmailGroup");
    const actions = document.getElementById("inlineEditActions");
    const editBtn = document.getElementById("editProfileInfoBtn");
    const nameValue = document.getElementById("displayedName");
    const emailValue = document.getElementById("email");
    const saveBtn = document.getElementById("editProfileSave");

    saveBtn.innerHTML = '<i class="fas fa-spinner"></i> Save';

    // Associated labels for those values
    const nameItem = nameValue ? nameValue.closest(".info-item-modern") : null;
    const emailItem = emailValue
      ? emailValue.closest(".info-item-modern")
      : null;
    const nameLabel = nameItem
      ? nameItem.querySelector(".info-label-modern")
      : null;
    const emailLabel = emailItem
      ? emailItem.querySelector(".info-label-modern")
      : null;

    if (!nameGroup || !emailGroup || !actions || !editBtn) return;

    nameGroup.style.display = enable ? "block" : "none";
    emailGroup.style.display = enable ? "block" : "none";
    actions.style.display = enable ? "flex" : "none";
    editBtn.style.display = enable ? "none" : "inline-flex";

    // Hide current labels and values while editing
    if (nameValue) nameValue.style.display = enable ? "none" : "";
    if (emailValue) emailValue.style.display = enable ? "none" : "";
    if (nameLabel) nameLabel.style.display = enable ? "none" : "";
    if (emailLabel) emailLabel.style.display = enable ? "none" : "";
  }

  /**
   * Validate inline fields and prepare payload
   * @param {boolean} showErrors - whether to show errors in UI
   * @returns {{isValid:boolean,data:Object}}
   * @private
   */
  _validateInlineFields(showErrors = true) {
    const nameInput = document.getElementById("inlineDisplayedName");
    const emailInput = document.getElementById("inlineEmail");
    const nameErr = document.getElementById("inlineDisplayedNameError");
    const emailErr = document.getElementById("inlineEmailError");

    let isValid = true;
    let name = nameInput.value.trim();
    const email = emailInput.value.trim();

    // Display name rules
    let nameError = null;
    if (name.length < 3)
      nameError = "Display name must be at least 3 characters";
    else if (name.length > 20)
      nameError = "Display name must be no more than 20 characters";
    else if (!/^[a-zA-Z0-9\s\-_]+$/.test(name))
      nameError =
        "Only letters, numbers, spaces, hyphens, and underscores allowed";

    if (nameError) {
      isValid = false;
      if (showErrors) {
        nameErr.textContent = nameError;
        nameErr.classList.remove("hide");
      }
    } else if (showErrors) {
      nameErr.classList.add("hide");
    }

    // Email optional but if provided must be valid
    let emailError = null;
    if (email.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        emailError = "Please enter a valid email address";
      }
    }
    if (emailError) {
      isValid = false;
      if (showErrors) {
        emailErr.textContent = emailError;
        emailErr.classList.remove("hide");
      }
    } else if (showErrors) {
      emailErr.classList.add("hide");
    }

    // Prepare payload: only send changed values
    const payload = {};
    if (!this.currentUser || name !== (this.currentUser.displayedName || "")) {
      payload.displayedName = name;
    }
    if (
      email.length > 0 &&
      (!this.currentUser || email !== (this.currentUser.email || ""))
    ) {
      payload.email = email;
    }

    return { isValid, data: payload };
  }

  /**
   * Clear inline error messages
   * @private
   */
  _clearInlineErrors() {
    const nameErr = document.getElementById("inlineDisplayedNameError");
    const emailErr = document.getElementById("inlineEmailError");
    if (nameErr) nameErr.classList.add("hide");
    if (emailErr) emailErr.classList.add("hide");
  }

  /**
   * Save inline edited fields via API
   * @param {{displayedName?:string,email?:string}} data
   * @private
   */
  async _handleInlineSave(data) {
    const saveBtn = document.getElementById("editProfileSave");
    const msg = document.getElementById("inlineEditMessage");
    const original = saveBtn.innerHTML;

    try {
      // If nothing changed, just exit edit mode (avoid setting loading state)
      const noChanges =
        !data ||
        (typeof data === "object" &&
          Object.keys(data).length === 0 &&
          data.constructor === Object) ||
        (!data.displayedName && !data.email);
      if (noChanges) {
        this._toggleInlineEdit(false);
        return;
      }

      // Show loading state only when there is something to save
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      if (msg) {
        msg.style.display = "none";
        msg.className = "message-modern";
      }

      const response = await this.apiService.put("users/profile", data, {
        requiresAuth: true,
      });
      if (!response.success) {
        throw new Error(response.error || "Failed to save changes");
      }

      // Prefer backend returned data when available
      const updated =
        (response.data && (response.data.data || response.data)) || {};
      this.currentUser = { ...this.currentUser, ...updated, ...data };
      this._updateProfileDisplay();

      if (msg) {
        msg.textContent = "Profile information updated";

        this._notifyOnce(msg.textContent, "success", 5000);
      }

      // Close edit mode after short delay
      setTimeout(() => {
        this._toggleInlineEdit(false);
        if (msg) msg.style.display = "none";
      }, 800);
    } catch (error) {
      errorLogger.log("Inline Profile Save", error, { showToUser: false });
      if (msg) {
        msg.textContent = error.message || "Failed to update profile";
        if (window.showNotification) {
          window.showNotification(msg.textContent, "error", 4000);
        }
      }
    } finally {
      saveBtn.innerHTML = original;
      saveBtn.disabled = false;
    }
  }

  /**
   * Notify once helper to avoid duplicate toasts in short interval
   * @private
   */
  _notifyOnce(message, type = "info", duration = 4000) {
    const now = Date.now();
    if (
      this._lastToast.message === message &&
      now - this._lastToast.at < 1500
    ) {
      return; // skip duplicate
    }
    this._lastToast = { message, at: now };
    if (window.showNotification) {
      window.showNotification(message, type, duration);
    }
  }

  /**
   * Handle account deletion
   * @private
   */
  async _handleDeleteAccount() {
    const confirmDeleteBtn = document.getElementById("confirmDelete");
    const originalText = confirmDeleteBtn.innerHTML;

    try {
      // Show loading state
      confirmDeleteBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Deleting...';
      confirmDeleteBtn.disabled = true;

      // Make API call to delete account
      const response = await this.apiService.delete("users/profile", {
        requiresAuth: true,
      });

      if (response.success) {
        // Show success notification through notification system
        if (window.App && window.App.getEventBus) {
          const eventBus = window.App.getEventBus();
          eventBus.emit("notification:show", {
            message: "Account deleted successfully",
            type: "success",
            duration: 5000,
          });
        } else if (window.showNotification) {
          window.showNotification("Account deleted successfully", "success");
        }

        // Clear authentication data
        if (this.authService && this.authService.storage) {
          this.authService._clearSession();
        }

        // Redirect to home page after a short delay
        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      } else {
        throw new Error(response.error || "Failed to delete account");
      }
    } catch (error) {
      errorLogger.log("Account Deletion", error, { showToUser: false });

      let errorMessage = "Failed to delete account. Please try again.";

      if (error.status === 401 || error.status === 403) {
        errorMessage = "Session expired. Please log in again.";
        // Clear authentication data
        if (this.authService && this.authService.storage) {
          this.authService._clearSession();
        }
        // Redirect to login page
        setTimeout(() => {
          window.location.href = "/login.html";
        }, 2000);
      } else if (error.message) {
        errorMessage = error.message;
      }

      // Show error message
      // Error notification is handled by ErrorLogger automatically

      // Reset button state
      confirmDeleteBtn.innerHTML = originalText;
      confirmDeleteBtn.disabled = false;
    }
  }

  /**
   * Handle logout
   * @private
   */
  async _handleLogout() {
    try {
      await this.authService.logout();
      window.location.href = "/login.html";
    } catch (error) {
      errorLogger.log("Logout", error, { showToUser: false });
      // Force redirect even if logout fails
      window.location.href = "/login.html";
    }
  }

  /**
   * Refresh profile data
   */
  async refresh() {
    await this._loadProfileData();
  }

  /**
   * Get current user data
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Reset password validation states
   * @private
   */
  _resetPasswordValidation() {
    const passwordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const passwordCharCounter = document.getElementById("passwordCharCount");
    const confirmPasswordCharCounter = document.getElementById(
      "confirmPasswordCharCount",
    );
    const passwordErrorElement = document.getElementById("passwordError");
    const passwordSuccessElement = document.getElementById("passwordSuccess");
    const confirmPasswordErrorElement = document.getElementById(
      "confirmPasswordError",
    );
    const confirmPasswordSuccessElement = document.getElementById(
      "confirmPasswordSuccess",
    );

    if (passwordInput) {
      passwordInput.classList.remove("valid", "invalid");
      passwordErrorElement.classList.add("hide");
      passwordSuccessElement.classList.add("hide");
    }

    if (confirmPasswordInput) {
      confirmPasswordInput.classList.remove("valid", "invalid");
      confirmPasswordErrorElement.classList.add("hide");
      confirmPasswordSuccessElement.classList.add("hide");
    }

    if (passwordCharCounter) {
      passwordCharCounter.textContent = "0";
      passwordCharCounter.className = "current";
    }

    if (confirmPasswordCharCounter) {
      confirmPasswordCharCounter.textContent = "0";
      confirmPasswordCharCounter.className = "current";
    }
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = ProfilePage;
} else {
  window.ProfilePage = ProfilePage;
}
