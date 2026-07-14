class TwoFactorPage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.configuration = null;
  }

  async init(app) {
    this.authService = app?.getModule?.("authService");
    this.apiService = app?.getModule?.("apiService");
    this.featureFlagsService = app?.getModule?.("featureFlagsService");

    const isAuthenticated = await this.authService?.waitForAuth?.(3000);
    if (!isAuthenticated) {
      window.location.href = "/login.html";
      return;
    }

    if (!this.authService?.requireAuth?.("/login.html")) {
      return;
    }

    const enabled = await this._isFeatureEnabled();
    if (!enabled) {
      this._redirectToNotFound();
      return;
    }

    this._setupEventListeners();
    await this._loadConfiguration();
  }

  async _isFeatureEnabled() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      return false;
    }

    try {
      return await this.featureFlagsService.isEnabled("twoFactorAuthEnabled", false);
    } catch (error) {
      return false;
    }
  }

  _redirectToNotFound() {
    if (window?.location && typeof window.location.replace === "function") {
      window.location.replace("/404.html");
    }
  }

  _setLoadingState(isLoading) {
    const loadingElement = document.getElementById("loadingMessage");
    const contentElement = document.getElementById("twoFactorContent");
    const errorElement = document.getElementById("errorMessage");

    if (loadingElement) {
      loadingElement.style.display = isLoading ? "block" : "none";
    }

    if (contentElement) {
      contentElement.style.display = isLoading ? "none" : "block";
    }

    if (errorElement && isLoading) {
      errorElement.style.display = "none";
    }
  }

  _showError(message) {
    const loadingElement = document.getElementById("loadingMessage");
    const contentElement = document.getElementById("twoFactorContent");
    const errorElement = document.getElementById("errorMessage");
    const errorText = document.getElementById("errorText");

    if (loadingElement) {
      loadingElement.style.display = "none";
    }

    if (contentElement) {
      contentElement.style.display = "none";
    }

    if (errorText) {
      errorText.textContent = message;
    }

    if (errorElement) {
      errorElement.style.display = "flex";
    }
  }

  _showMessage(message, type = "info") {
    const messageElement = document.getElementById("pageMessage");
    if (!messageElement) {
      return;
    }

    if (!message) {
      messageElement.textContent = "";
      messageElement.style.display = "none";
      messageElement.className = "message-modern";
      return;
    }

    messageElement.textContent = message;
    messageElement.className = `message-modern ${type}`;
    messageElement.style.display = "block";

    if (window.showNotification) {
      window.showNotification(message, type, 4000);
    }
  }

  _formatDate(value, fallback = "-") {
    if (!value) {
      return fallback;
    }

    try {
      return new Date(value).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return fallback;
    }
  }

  async _loadConfiguration() {
    this._setLoadingState(true);

    try {
      const response = await this.apiService.get("users/profile/two-factor", {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (response.status === 404) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to load two-factor configuration");
      }

      this.configuration = response.data?.data || response.data || {};
      this._renderConfiguration();
      this._setLoadingState(false);
    } catch (error) {
      errorLogger.log("Two-Factor Settings", error, { showToUser: false });
      this._showError(error.message || "Failed to load two-factor configuration.");
    }
  }

  _renderConfiguration() {
    const config = this.configuration || {};
    const enabled = config.enabled === true;
    const pendingSetup = config.pendingSetup === true;

    const badge = document.getElementById("twoFactorStatusBadge");
    const statusLabel = document.getElementById("twoFactorStatusLabel");
    const statusHint = document.getElementById("twoFactorStatusHint");
    const issuer = document.getElementById("twoFactorIssuer");
    const accountLabel = document.getElementById("twoFactorAccountLabel");
    const enabledAt = document.getElementById("twoFactorEnabledAt");
    const setupSection = document.getElementById("setupSection");
    const disableSection = document.getElementById("disableSection");
    const manualEntryPanel = document.getElementById("manualEntryPanel");
    const manualEntryKey = document.getElementById("manualEntryKey");
    const qrCodePanel = document.getElementById("qrCodePanel");
    const qrCodeImage = document.getElementById("qrCodeImage");
    const otpAuthUrlLink = document.getElementById("otpAuthUrlLink");
    const setupGeneratedAt = document.getElementById("setupGeneratedAt");
    const generateSetupBtn = document.getElementById("generateSetupBtn");
    const enableSubmitBtn = document.getElementById("enableTwoFactorBtn");

    if (badge) {
      badge.className = enabled ? "status-badge-modern status-badge-modern--active" : "status-badge-modern status-badge-modern--revoked";
    }

    if (statusLabel) {
      statusLabel.textContent = enabled ? "Enabled" : pendingSetup ? "Pending verification" : "Disabled";
    }

    if (statusHint) {
      statusHint.textContent = enabled
        ? "2FA is active. Login now requires your password and a fresh authenticator-app code."
        : pendingSetup
          ? "A setup secret is ready. Add it to your authenticator app and verify one code to finish enabling 2FA."
          : "2FA is currently off. Generate a setup secret when you are ready to protect your account.";
    }

    if (issuer) {
      issuer.textContent = config.issuer || "Rolnopol";
    }

    if (accountLabel) {
      accountLabel.textContent = config.accountLabel || "-";
    }

    if (enabledAt) {
      enabledAt.textContent = enabled ? this._formatDate(config.enabledAt, "Recently enabled") : "Not enabled";
    }

    if (setupSection) {
      setupSection.style.display = enabled ? "none" : "block";
    }

    if (disableSection) {
      disableSection.style.display = enabled ? "block" : "none";
    }

    if (manualEntryPanel) {
      manualEntryPanel.style.display = pendingSetup && config.manualEntryKey ? "block" : "none";
    }

    if (qrCodePanel) {
      qrCodePanel.style.display = pendingSetup && config.qrCodeDataUrl ? "block" : "none";
    }

    if (manualEntryKey) {
      manualEntryKey.textContent = config.manualEntryKey || "-";
    }

    if (qrCodeImage) {
      qrCodeImage.src = config.qrCodeDataUrl || "";
      qrCodeImage.style.display = pendingSetup && config.qrCodeDataUrl ? "block" : "none";
    }

    if (otpAuthUrlLink) {
      otpAuthUrlLink.href = config.otpAuthUrl || "#";
      otpAuthUrlLink.style.display = pendingSetup && config.otpAuthUrl ? "inline-flex" : "none";
    }

    if (setupGeneratedAt) {
      setupGeneratedAt.textContent =
        pendingSetup && config.setupGeneratedAt
          ? `Setup secret generated ${this._formatDate(config.setupGeneratedAt, "just now")}`
          : "No setup secret generated yet.";
    }

    if (generateSetupBtn) {
      generateSetupBtn.innerHTML = pendingSetup
        ? '<i class="fas fa-rotate-right"></i> Regenerate setup secret'
        : '<i class="fas fa-wand-magic-sparkles"></i> Generate setup secret';
    }

    if (enableSubmitBtn) {
      enableSubmitBtn.disabled = !pendingSetup;
    }
  }

  _setupEventListeners() {
    const generateSetupBtn = document.getElementById("generateSetupBtn");
    const enableForm = document.getElementById("enableTwoFactorForm");
    const disableForm = document.getElementById("disableTwoFactorForm");

    if (generateSetupBtn) {
      generateSetupBtn.addEventListener("click", async () => {
        await this._handleGenerateSetup();
      });
    }

    if (enableForm) {
      enableForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this._handleEnable();
      });
    }

    if (disableForm) {
      disableForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this._handleDisable();
      });
    }
  }

  async _handleGenerateSetup() {
    const button = document.getElementById("generateSetupBtn");
    const originalText = button ? button.innerHTML : "";

    try {
      this._showMessage("");
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
      }

      const response = await this.apiService.post("users/profile/two-factor/setup", {}, { requiresAuth: true, suppressErrorEvents: true });

      if (!response.success) {
        if (response.status === 404) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to generate setup secret");
      }

      this.configuration = response.data?.data || response.data || {};
      this._renderConfiguration();
      this._showMessage("Setup secret generated. Add it to your authenticator app and verify one code.", "success");
    } catch (error) {
      errorLogger.log("Two-Factor Generate Setup", error, { showToUser: false });
      this._showMessage(error.message || "Failed to generate setup secret.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }

  async _handleEnable() {
    const codeInput = document.getElementById("verificationCode");
    const button = document.getElementById("enableTwoFactorBtn");
    const originalText = button ? button.innerHTML : "";
    const code = codeInput ? String(codeInput.value || "").trim() : "";

    try {
      this._showMessage("");
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enabling...';
      }

      const response = await this.apiService.post(
        "users/profile/two-factor/enable",
        { code },
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (response.status === 404) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to enable two-factor authentication");
      }

      this.configuration = response.data?.data || response.data || {};
      this._renderConfiguration();
      if (codeInput) {
        codeInput.value = "";
      }
      this._showMessage("Two-factor authentication is now enabled.", "success");
    } catch (error) {
      errorLogger.log("Two-Factor Enable", error, { showToUser: false });
      this._showMessage(error.message || "Failed to enable two-factor authentication.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }

  async _handleDisable() {
    const codeInput = document.getElementById("disableCode");
    const button = document.getElementById("disableTwoFactorBtn");
    const originalText = button ? button.innerHTML : "";
    const code = codeInput ? String(codeInput.value || "").trim() : "";

    try {
      this._showMessage("");
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disabling...';
      }

      const response = await this.apiService.post(
        "users/profile/two-factor/disable",
        { code },
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (response.status === 404) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to disable two-factor authentication");
      }

      this.configuration = response.data?.data || response.data || {};
      this._renderConfiguration();
      if (codeInput) {
        codeInput.value = "";
      }
      this._showMessage("Two-factor authentication has been disabled.", "success");
    } catch (error) {
      errorLogger.log("Two-Factor Disable", error, { showToUser: false });
      this._showMessage(error.message || "Failed to disable two-factor authentication.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = TwoFactorPage;
}

if (typeof window !== "undefined") {
  window.TwoFactorPage = TwoFactorPage;
}
