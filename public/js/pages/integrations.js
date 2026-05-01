class IntegrationsPage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.defaultTab = "personal-api-keys";
    this.personalApiKeysEnabled = false;
    this.webhooksEnabled = false;
    this.webhookEvents = [];
    this.webhookRecords = new Map();
    this.webhookLoadPromise = null;
    this.defaultWebhookSubTab = "list";
  }

  async init(app) {
    this.authService = app?.getModule?.("authService");
    this.apiService = app?.getModule?.("apiService");
    this.featureFlagsService = app?.getModule?.("featureFlagsService");

    if (!this.authService || !this.apiService) {
      this._showError("Unable to initialize the integrations page.");
      return;
    }

    const isAuthenticated = await this.authService.waitForAuth(3000);
    if (!isAuthenticated) {
      window.location.href = "/login.html";
      return;
    }

    if (!this.authService.requireAuth("/login.html")) {
      return;
    }

    this.personalApiKeysEnabled = await this._isPersonalApiKeysFeatureEnabled();
    this.webhooksEnabled = await this._isIntegrationsWebhooksEnabled();

    if (!this.personalApiKeysEnabled && !this.webhooksEnabled) {
      this._redirectToNotFound();
      return;
    }

    this._showContent();
    this._setupTabs();

    const requestedTab = this._getRequestedTab();
    this._activateIntegrationsTab(requestedTab);

    if (this.personalApiKeysEnabled) {
      this._setupPersonalApiKeyHandlers();
      await this._loadPersonalApiKeys();
    }

    if (this.webhooksEnabled) {
      this._setupWebhookHandlers();

      if (requestedTab === "webhooks") {
        await this._ensureWebhookDataLoaded();
      }
    }
  }

  _setupTabs() {
    const tabButtons = Array.from(document.querySelectorAll("[data-integrations-tab]"));
    if (tabButtons.length === 0) {
      return;
    }

    tabButtons.forEach((button) => {
      if (button.dataset.integrationsTab === "personal-api-keys" && !this.personalApiKeysEnabled) {
        return;
      }

      if (button.dataset.integrationsTab === "webhooks" && !this.webhooksEnabled) {
        return;
      }

      button.addEventListener("click", () => {
        this._activateIntegrationsTab(button.dataset.integrationsTab);
      });
    });
  }

  _getRequestedTab() {
    const hash = typeof window?.location?.hash === "string" ? window.location.hash.replace(/^#/, "").trim().toLowerCase() : "";

    const defaultTab = this._getDefaultAvailableTab();

    if (hash === "webhooks" && this.webhooksEnabled) {
      return "webhooks";
    }

    if (hash === "personal-api-keys" && this.personalApiKeysEnabled) {
      return "personal-api-keys";
    }

    return defaultTab;
  }

  _activateIntegrationsTab(tabKey) {
    const selectedTab = this._normalizeIntegrationsTab(tabKey);
    const tabButtons = Array.from(document.querySelectorAll("[data-integrations-tab]"));
    const tabPanels = Array.from(document.querySelectorAll("[data-integrations-panel]"));

    tabButtons.forEach((button) => {
      const isActive = button.dataset.integrationsTab === selectedTab;

      if (button.classList?.toggle) {
        button.classList.toggle("is-active", isActive);
      }

      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.integrationsPanel === selectedTab;

      panel.hidden = !isActive;
      panel.style.display = isActive ? "block" : "none";
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    if (selectedTab === "webhooks" && this.webhooksEnabled) {
      void this._ensureWebhookDataLoaded();
    }
  }

  _normalizeIntegrationsTab(tabKey) {
    if (tabKey === "webhooks" && this.webhooksEnabled) {
      return "webhooks";
    }

    if (tabKey === "personal-api-keys" && this.personalApiKeysEnabled) {
      return "personal-api-keys";
    }

    return this._getDefaultAvailableTab();
  }

  _getDefaultAvailableTab() {
    if (this.personalApiKeysEnabled) {
      return "personal-api-keys";
    }

    if (this.webhooksEnabled) {
      return "webhooks";
    }

    return this.defaultTab;
  }

  _showContent() {
    const loadingElement = document.getElementById("loadingMessage");
    const errorElement = document.getElementById("errorMessage");
    const contentElement = document.getElementById("integrationsContent");

    if (loadingElement) {
      loadingElement.style.display = "none";
    }

    if (errorElement) {
      errorElement.style.display = "none";
    }

    if (contentElement) {
      contentElement.style.display = "block";
    }
  }

  _showError(message) {
    const loadingElement = document.getElementById("loadingMessage");
    const errorElement = document.getElementById("errorMessage");
    const errorText = document.getElementById("errorText");
    const contentElement = document.getElementById("integrationsContent");

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

  _redirectToNotFound() {
    if (window?.location && typeof window.location.replace === "function") {
      window.location.replace("/404.html");
    }
  }

  async _isPersonalApiKeysFeatureEnabled() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      return false;
    }

    try {
      return await this.featureFlagsService.isEnabled("personalApiKeysEnabled", false);
    } catch (error) {
      return false;
    }
  }

  async _isIntegrationsWebhooksEnabled() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      return false;
    }

    try {
      return await this.featureFlagsService.isEnabled("integrationsWebhooksEnabled", false);
    } catch (error) {
      return false;
    }
  }

  _isPersonalApiKeysUnavailable(result) {
    return result?.status === 404 || String(result?.error || "").includes("Personal API keys not found");
  }

  _isWebhooksUnavailable(result) {
    return result?.status === 404 || String(result?.error || "").includes("Webhooks not found");
  }

  _setupPersonalApiKeyHandlers() {
    const form = document.getElementById("personalApiKeyForm");
    const copyBtn = document.getElementById("copyPersonalApiKeyBtn");
    const list = document.getElementById("personalApiKeyList");
    const modal = document.getElementById("personalApiKeyModal");
    const helpModal = document.getElementById("personalApiKeyHelpModal");
    const openHelpModalBtn = document.getElementById("openPersonalApiKeyHelpModal");
    const closeModalBtn = document.getElementById("closePersonalApiKeyModal");
    const dismissModalBtn = document.getElementById("dismissPersonalApiKeyModal");
    const closeHelpModalBtn = document.getElementById("closePersonalApiKeyHelpModal");
    const dismissHelpModalBtn = document.getElementById("dismissPersonalApiKeyHelpModal");

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this._handleCreatePersonalApiKey();
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const valueEl = document.getElementById("personalApiKeyModalValue");
        const rawKey = valueEl ? valueEl.textContent.trim() : "";
        if (!rawKey) {
          return;
        }

        try {
          await navigator.clipboard.writeText(rawKey);
          copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
          this._showPersonalApiKeyMessage("API key copied to clipboard.", "success");
        } catch (error) {
          this._showPersonalApiKeyMessage("Copy failed. Please copy the key manually.", "error");
        }
      });
    }

    if (openHelpModalBtn) {
      openHelpModalBtn.addEventListener("click", () => {
        this._openPersonalApiKeyHelpModal();
      });
    }

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        this._closePersonalApiKeyModal();
      });
    }

    if (dismissModalBtn) {
      dismissModalBtn.addEventListener("click", () => {
        this._closePersonalApiKeyModal();
      });
    }

    if (closeHelpModalBtn) {
      closeHelpModalBtn.addEventListener("click", () => {
        this._closePersonalApiKeyHelpModal();
      });
    }

    if (dismissHelpModalBtn) {
      dismissHelpModalBtn.addEventListener("click", () => {
        this._closePersonalApiKeyHelpModal();
      });
    }

    if (modal) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          this._closePersonalApiKeyModal();
        }
      });
    }

    if (helpModal) {
      helpModal.addEventListener("click", (event) => {
        if (event.target === helpModal) {
          this._closePersonalApiKeyHelpModal();
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      const isModalOpen = modal && modal.style.display === "flex";
      const isHelpModalOpen = helpModal && helpModal.style.display === "flex";

      if (event.key === "Escape") {
        if (isModalOpen) {
          this._closePersonalApiKeyModal();
        } else if (isHelpModalOpen) {
          this._closePersonalApiKeyHelpModal();
        }
      }
    });

    if (list) {
      list.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("[data-api-key-action]");
        if (!actionButton) {
          return;
        }

        const { apiKeyAction: action, apiKeyId } = actionButton.dataset;
        if (!apiKeyId) {
          return;
        }

        if (action === "regenerate") {
          await this._handleRegeneratePersonalApiKey(apiKeyId, actionButton);
        }

        if (action === "revoke") {
          await this._handleRevokePersonalApiKey(apiKeyId, actionButton);
        }
      });
    }
  }

  _setupWebhookHandlers() {
    const form = document.getElementById("webhookForm");
    const list = document.getElementById("webhookList");
    const subTabButtons = Array.from(document.querySelectorAll("[data-webhook-subtab]"));

    subTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this._activateWebhookSubTab(button.dataset.webhookSubtab);
      });
    });

    this._activateWebhookSubTab(this.defaultWebhookSubTab);

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this._handleCreateWebhook();
      });
    }

    if (list) {
      list.addEventListener("click", async (event) => {
        const actionButton = event.target?.closest?.("[data-webhook-action]");
        if (!actionButton) {
          return;
        }

        const { webhookAction: action, webhookId } = actionButton.dataset;
        if (!webhookId) {
          return;
        }

        if (action === "toggle") {
          await this._handleToggleWebhook(webhookId, actionButton);
        }

        if (action === "delete") {
          await this._handleDeleteWebhook(webhookId, actionButton);
        }
      });
    }
  }

  async _ensureWebhookDataLoaded() {
    if (this.webhookLoadPromise) {
      return this.webhookLoadPromise;
    }

    this.webhookLoadPromise = (async () => {
      try {
        await Promise.all([this._loadWebhookEvents(), this._loadWebhooks(), this._loadWebhookDeliveries()]);
      } finally {
        this.webhookLoadPromise = null;
      }
    })();

    return this.webhookLoadPromise;
  }

  async _loadWebhookEvents() {
    const state = document.getElementById("webhookEventsState");
    const options = document.getElementById("webhookEventsOptions");

    if (!state || !options) {
      return;
    }

    state.style.display = "block";
    options.style.display = "none";

    try {
      const response = await this.apiService.get("users/profile/webhooks/events", {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to load webhook events");
      }

      this.webhookEvents = Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
      this._renderWebhookEventOptions(this.webhookEvents);
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      state.style.display = "block";
      state.textContent = "Failed to load supported events. Please refresh and try again.";
      this._showWebhookMessage("Failed to load supported webhook events.", "error");
    }
  }

  _renderWebhookEventOptions(items) {
    const state = document.getElementById("webhookEventsState");
    const options = document.getElementById("webhookEventsOptions");

    if (!state || !options) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      state.style.display = "block";
      state.textContent = "No webhook-compatible backend events are currently available.";
      options.style.display = "none";
      options.innerHTML = "";
      return;
    }

    options.innerHTML = items
      .map(
        (item) => `
          <label class="glass integration-option-card">
            <input type="checkbox" value="${this._escapeHtml(item.type)}" />
            <span>
              <strong>${this._escapeHtml(item.label || item.type)}</strong>
              <small>${this._escapeHtml(item.description || "No description provided.")}</small>
              <small><span class="integration-badge"><i class="fas fa-bolt"></i>${this._escapeHtml(item.type)}</span></small>
            </span>
          </label>
        `,
      )
      .join("");

    state.style.display = "none";
    options.style.display = "grid";
  }

  async _loadWebhooks() {
    const state = document.getElementById("webhookListState");
    const list = document.getElementById("webhookList");

    if (!state || !list) {
      return;
    }

    state.style.display = "block";
    list.innerHTML = "";

    try {
      const response = await this.apiService.get("users/profile/webhooks", {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to load webhooks");
      }

      const items = Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
      this.webhookRecords = new Map(items.map((item) => [String(item.id), item]));
      this._renderWebhooks(items);
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showWebhookMessage("Failed to load webhooks.", "error");
      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #7a2f2f">
          Failed to load your webhooks. Please refresh and try again.
        </div>
      `;
    } finally {
      state.style.display = "none";
    }
  }

  _renderWebhooks(items) {
    const list = document.getElementById("webhookList");
    if (!list) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #51634a">
          No webhooks yet. Create one above when you’re ready to stream farm events into your own tools.
        </div>
      `;
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const enabled = item.enabled === true;
        const statusBadgeClass = enabled
          ? "status-badge-modern status-badge-modern--active"
          : "status-badge-modern status-badge-modern--disabled";
        const statusLabel = enabled ? "Enabled" : "Disabled";
        const eventBadges =
          Array.isArray(item.eventTypes) && item.eventTypes.length > 0
            ? item.eventTypes
                .map(
                  (eventType) => `<span class="integration-badge"><i class="fas fa-wave-square"></i>${this._escapeHtml(eventType)}</span>`,
                )
                .join("")
            : `<span class="integration-badge"><i class="fas fa-wave-square"></i>No events</span>`;

        return `
          <article class="glass" style="padding: 1rem; border-radius: 1rem; display: flex; flex-direction: column; gap: 0.85rem">
            <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: flex-start">
              <div>
                <h4 style="margin: 0 0 0.35rem 0">${this._escapeHtml(item.name || "Webhook endpoint")}</h4>
                <div style="font-family: monospace; font-size: 0.95rem; color: #51634a; word-break: break-all">${this._escapeHtml(item.url || "")}</div>
              </div>
              <span class="${statusBadgeClass}" style="white-space: nowrap">
                <i class="fas fa-circle"></i>
                <span>${statusLabel}</span>
              </span>
            </div>

            <div class="integration-badge-row">${eventBadges}</div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem">
              <div>
                <strong>Created</strong>
                <div class="integration-muted">${this._escapeHtml(this._formatOptionalDate(item.createdAt))}</div>
              </div>
              <div>
                <strong>Last trigger</strong>
                <div class="integration-muted">${this._escapeHtml(this._formatOptionalDate(item.lastTriggeredAt))}</div>
              </div>
              <div>
                <strong>Last success</strong>
                <div class="integration-muted">${this._escapeHtml(this._formatOptionalDate(item.lastDeliveredAt))}</div>
              </div>
              <div>
                <strong>Last failure</strong>
                <div class="integration-muted">${this._escapeHtml(this._formatOptionalDate(item.lastFailureAt))}</div>
              </div>
            </div>

            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap">
              <button type="button" class="btn btn-compact btn-outline btn-futuristic" data-webhook-action="toggle" data-webhook-id="${this._escapeHtml(item.id)}">
                <i class="fas fa-power-off"></i>
                ${enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" class="btn btn-compact btn-danger" data-webhook-action="delete" data-webhook-id="${this._escapeHtml(item.id)}">
                <i class="fas fa-trash"></i>
                Delete
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async _loadWebhookDeliveries() {
    const state = document.getElementById("webhookDeliveryListState");
    const list = document.getElementById("webhookDeliveryList");

    if (!state || !list) {
      return;
    }

    state.style.display = "block";
    list.innerHTML = "";

    try {
      const response = await this.apiService.get("users/profile/webhooks/deliveries?limit=10", {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to load webhook deliveries");
      }

      const items = Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
      this._renderWebhookDeliveries(items);
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #7a2f2f">
          Failed to load recent delivery activity.
        </div>
      `;
    } finally {
      state.style.display = "none";
    }
  }

  _renderWebhookDeliveries(items) {
    const list = document.getElementById("webhookDeliveryList");
    if (!list) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #51634a">
          No deliveries recorded yet. Once Rolnopol sends an event, you’ll see the status, response code, and target endpoint here.
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <article class="glass" style="padding: 1rem; border-radius: 1rem; display: grid; gap: 0.85rem">
        <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: center">
          <h4 style="margin: 0">Recent delivery activity</h4>
          <span class="integration-muted">Latest ${items.length} attempts</span>
        </div>
        ${items
          .map((item) => {
            const statusBadgeClass =
              item.status === "delivered"
                ? "status-badge-modern status-badge-modern--active"
                : item.status === "failed"
                  ? "status-badge-modern status-badge-modern--revoked"
                  : "status-badge-modern";
            const responseCode = item.response?.statusCode != null ? String(item.response.statusCode) : "—";

            return `
              <div style="padding: 0.85rem 0.95rem; border-radius: 0.9rem; background: rgba(255, 255, 255, 0.45); display: grid; gap: 0.55rem">
                <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: center">
                  <div>
                    <strong>${this._escapeHtml(item.eventType || "notification.event")}</strong>
                    <div class="integration-muted" style="word-break: break-all">${this._escapeHtml(item.targetUrl || "Unknown target")}</div>
                  </div>
                  <span class="${statusBadgeClass}">
                    <i class="fas fa-circle"></i>
                    <span>${this._escapeHtml(item.status || "unknown")}</span>
                  </span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.65rem">
                  <div><strong>When</strong><div class="integration-muted">${this._escapeHtml(this._formatOptionalDate(item.createdAt))}</div></div>
                  <div><strong>Response</strong><div class="integration-muted">${this._escapeHtml(responseCode)}</div></div>
                  <div><strong>Attempts</strong><div class="integration-muted">${this._escapeHtml(item.attempts ?? 0)}</div></div>
                  <div><strong>Reason</strong><div class="integration-muted">${this._escapeHtml(item.reason || "—")}</div></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </article>
    `;
  }

  async _handleCreateWebhook() {
    const button = document.getElementById("createWebhookBtn");
    const nameInput = document.getElementById("webhookName");
    const urlInput = document.getElementById("webhookUrl");
    const enabledInput = document.getElementById("webhookEnabled");
    const originalText = button ? button.innerHTML : "";

    try {
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
      }

      const response = await this.apiService.post(
        "users/profile/webhooks",
        {
          name: nameInput ? nameInput.value.trim() : "",
          url: urlInput ? urlInput.value.trim() : "",
          eventTypes: this._getSelectedWebhookEvents(),
          enabled: enabledInput ? enabledInput.checked : true,
        },
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to create webhook");
      }

      this._showWebhookMessage("Webhook created successfully.", "success");
      this._resetWebhookForm();
      await Promise.all([this._loadWebhooks(), this._loadWebhookDeliveries()]);
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showWebhookMessage(error.message || "Failed to create webhook.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }

  _activateWebhookSubTab(subTabKey) {
    const selectedSubTab = this._normalizeWebhookSubTab(subTabKey);
    const buttons = Array.from(document.querySelectorAll("[data-webhook-subtab]"));
    const panels = Array.from(document.querySelectorAll("[data-webhook-subtab-panel]"));

    buttons.forEach((button) => {
      const isActive = button.dataset.webhookSubtab === selectedSubTab;

      if (button.classList?.toggle) {
        button.classList.toggle("is-active", isActive);
      }

      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      const isActive = panel.dataset.webhookSubtabPanel === selectedSubTab;

      panel.hidden = !isActive;
      panel.style.display = isActive ? "block" : "none";
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  _normalizeWebhookSubTab(subTabKey) {
    if (subTabKey === "deliveries") {
      return "deliveries";
    }

    return this.defaultWebhookSubTab;
  }

  async _handleToggleWebhook(webhookId, button) {
    const webhook = this.webhookRecords.get(String(webhookId));
    const originalText = button?.innerHTML || "";

    if (!webhook || !button) {
      return;
    }

    try {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      const response = await this.apiService.put(
        `users/profile/webhooks/${encodeURIComponent(webhookId)}`,
        { enabled: webhook.enabled !== true },
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to update webhook");
      }

      this._showWebhookMessage(`Webhook ${webhook.enabled === true ? "disabled" : "enabled"} successfully.`, "success");
      await this._loadWebhooks();
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showWebhookMessage(error.message || "Failed to update webhook.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  async _handleDeleteWebhook(webhookId, button) {
    const originalText = button?.innerHTML || "";

    if (!button) {
      return;
    }

    try {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

      const response = await this.apiService.delete(`users/profile/webhooks/${encodeURIComponent(webhookId)}`, {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isWebhooksUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to delete webhook");
      }

      this._showWebhookMessage("Webhook deleted successfully.", "success");
      await Promise.all([this._loadWebhooks(), this._loadWebhookDeliveries()]);
    } catch (error) {
      if (this._isWebhooksUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showWebhookMessage(error.message || "Failed to delete webhook.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  _getSelectedWebhookEvents() {
    return Array.from(document.querySelectorAll("#webhookEventsOptions input[type='checkbox']"))
      .filter((input) => input.checked)
      .map((input) => input.value);
  }

  _resetWebhookForm() {
    const nameInput = document.getElementById("webhookName");
    const urlInput = document.getElementById("webhookUrl");
    const enabledInput = document.getElementById("webhookEnabled");
    const eventInputs = Array.from(document.querySelectorAll("#webhookEventsOptions input[type='checkbox']"));

    if (nameInput) {
      nameInput.value = "";
    }

    if (urlInput) {
      urlInput.value = "";
    }

    if (enabledInput) {
      enabledInput.checked = true;
    }

    eventInputs.forEach((input) => {
      input.checked = false;
    });
  }

  _showWebhookMessage(message, type = "info") {
    const messageEl = document.getElementById("webhookMessage");
    if (!messageEl) {
      return;
    }

    messageEl.textContent = message;
    messageEl.className = `message-modern ${type}`;
    messageEl.style.display = "block";

    if (window.showNotification) {
      window.showNotification(message, type, 4000);
    }
  }

  async _loadPersonalApiKeys() {
    const section = document.getElementById("personalApiKeysSection");
    const state = document.getElementById("personalApiKeyListState");
    const list = document.getElementById("personalApiKeyList");
    if (!section || !state || !list) {
      return;
    }

    state.style.display = "block";
    list.innerHTML = "";

    try {
      const response = await this.apiService.get("users/profile/api-keys", {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isPersonalApiKeysUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to load API keys");
      }

      const items = Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
      this._renderPersonalApiKeys(items);
    } catch (error) {
      if (this._isPersonalApiKeysUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showPersonalApiKeyMessage("Failed to load API keys.", "error");
      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #7a2f2f">
          Failed to load API keys. Please refresh and try again.
        </div>
      `;
    } finally {
      state.style.display = "none";
    }
  }

  _renderPersonalApiKeys(items) {
    const list = document.getElementById("personalApiKeyList");
    if (!list) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `
        <div class="glass" style="padding: 1rem; border-radius: 1rem; color: #51634a">
          No personal API keys yet. Create one above when you’re ready to automate the farm.
        </div>
      `;
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const scopes = Array.isArray(item.scopes) ? item.scopes.join(", ") : "all";
        const revoked = item.isRevoked === true;
        const expired = item.isExpired === true && !revoked;
        const statusBadgeClass = revoked
          ? "status-badge-modern status-badge-modern--revoked"
          : expired
            ? "status-badge-modern"
            : "status-badge-modern status-badge-modern--active";
        const statusLabel = revoked ? "Revoked" : expired ? "Expired" : "Active";
        const activityLabel = revoked ? "Revoked" : "Last used";
        const activityValue = revoked ? this._formatOptionalDate(item.revokedAt) : this._formatOptionalDate(item.lastUsedAt);
        const expirationValue = this._formatPersonalApiKeyExpirationDate(item);
        const lifetimeLabel = this._describePersonalApiKeyExpiration(item.expiration);

        return `
          <article class="glass" style="padding: 1rem; border-radius: 1rem; display: flex; flex-direction: column; gap: 0.85rem">
            <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: flex-start">
              <div>
                <h4 style="margin: 0 0 0.35rem 0">${this._escapeHtml(item.label || "Personal integration key")}</h4>
                <div style="font-family: monospace; font-size: 0.95rem; color: #51634a">${this._escapeHtml(item.keyPreview || "Hidden")}</div>
              </div>
              <span class="${statusBadgeClass}" style="white-space: nowrap">
                <i class="fas fa-circle"></i>
                <span>${statusLabel}</span>
              </span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem">
              <div>
                <strong>Scopes</strong>
                <div style="color: #51634a">${this._escapeHtml(scopes)}</div>
              </div>
              <div>
                <strong>Created</strong>
                <div style="color: #51634a">${this._escapeHtml(this._formatOptionalDate(item.createdAt))}</div>
              </div>
              <div>
                <strong>Lifetime</strong>
                <div style="color: #51634a">${this._escapeHtml(lifetimeLabel)}</div>
              </div>
              <div>
                <strong>Expires</strong>
                <div style="color: #51634a">${this._escapeHtml(expirationValue)}</div>
              </div>
              <div>
                <strong>${activityLabel}</strong>
                <div style="color: #51634a">${this._escapeHtml(activityValue)}</div>
              </div>
            </div>

            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap">
              <button type="button" class="btn btn-compact btn-outline btn-futuristic" data-api-key-action="regenerate" data-api-key-id="${this._escapeHtml(item.id)}" ${revoked ? "disabled" : ""}>
                <i class="fas fa-rotate-right"></i>
                Regenerate
              </button>
              <button type="button" class="btn btn-compact btn-danger" data-api-key-action="revoke" data-api-key-id="${this._escapeHtml(item.id)}" ${revoked ? "disabled" : ""}>
                <i class="fas fa-ban"></i>
                Revoke
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async _handleCreatePersonalApiKey() {
    const button = document.getElementById("createPersonalApiKeyBtn");
    const labelInput = document.getElementById("personalApiKeyLabel");
    const originalText = button ? button.innerHTML : "";

    try {
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
      }

      const response = await this.apiService.post(
        "users/profile/api-keys",
        {
          label: labelInput ? labelInput.value.trim() : "",
          scopes: this._getSelectedPersonalApiKeyScopes(),
          expiration: this._getSelectedPersonalApiKeyExpiration(),
        },
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (this._isPersonalApiKeysUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to create API key");
      }

      this._revealPersonalApiKey(response.data?.data?.rawKey || "");
      this._showPersonalApiKeyMessage("API key created successfully.", "success");

      if (labelInput) {
        labelInput.value = "";
      }

      this._resetPersonalApiKeyScopes();
      this._resetPersonalApiKeyExpiration();
      await this._loadPersonalApiKeys();
    } catch (error) {
      if (this._isPersonalApiKeysUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showPersonalApiKeyMessage(error.message || "Failed to create API key.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    }
  }

  async _handleRegeneratePersonalApiKey(apiKeyId, button) {
    const originalText = button.innerHTML;

    try {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerating...';

      const response = await this.apiService.post(
        `users/profile/api-keys/${encodeURIComponent(apiKeyId)}/regenerate`,
        {},
        { requiresAuth: true, suppressErrorEvents: true },
      );

      if (!response.success) {
        if (this._isPersonalApiKeysUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to regenerate API key");
      }

      this._revealPersonalApiKey(response.data?.data?.rawKey || "");
      this._showPersonalApiKeyMessage("API key regenerated successfully.", "success");
      await this._loadPersonalApiKeys();
    } catch (error) {
      if (this._isPersonalApiKeysUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showPersonalApiKeyMessage(error.message || "Failed to regenerate API key.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  async _handleRevokePersonalApiKey(apiKeyId, button) {
    const originalText = button.innerHTML;

    try {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Revoking...';

      const response = await this.apiService.delete(`users/profile/api-keys/${encodeURIComponent(apiKeyId)}`, {
        requiresAuth: true,
        suppressErrorEvents: true,
      });

      if (!response.success) {
        if (this._isPersonalApiKeysUnavailable(response)) {
          this._redirectToNotFound();
          return;
        }

        throw new Error(response.error || "Failed to revoke API key");
      }

      this._showPersonalApiKeyMessage("API key revoked successfully.", "success");
      await this._loadPersonalApiKeys();
    } catch (error) {
      if (this._isPersonalApiKeysUnavailable(error)) {
        this._redirectToNotFound();
        return;
      }

      this._showPersonalApiKeyMessage(error.message || "Failed to revoke API key.", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  _getSelectedPersonalApiKeyScopes() {
    const scopeInputs = Array.from(document.querySelectorAll("#personalApiKeyScopes input[type='checkbox']"));
    const selected = scopeInputs.filter((input) => input.checked).map((input) => input.value);

    if (selected.includes("all")) {
      return ["all"];
    }

    return selected.length > 0 ? selected : ["user-account"];
  }

  _getSelectedPersonalApiKeyExpiration() {
    const expirationSelect = document.getElementById("personalApiKeyExpiration");
    const normalized = expirationSelect && typeof expirationSelect.value === "string" ? expirationSelect.value.trim().toLowerCase() : "";

    return normalized || "never";
  }

  _resetPersonalApiKeyScopes() {
    const scopeInputs = Array.from(document.querySelectorAll("#personalApiKeyScopes input[type='checkbox']"));
    scopeInputs.forEach((input) => {
      input.checked = input.value === "user-account";
    });
  }

  _resetPersonalApiKeyExpiration() {
    const expirationSelect = document.getElementById("personalApiKeyExpiration");
    if (expirationSelect) {
      expirationSelect.value = "never";
    }
  }

  _revealPersonalApiKey(rawKey) {
    const modal = document.getElementById("personalApiKeyModal");
    const value = document.getElementById("personalApiKeyModalValue");
    const copyBtn = document.getElementById("copyPersonalApiKeyBtn");

    if (!modal || !value) {
      return;
    }

    value.textContent = rawKey;
    if (copyBtn) {
      copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy key';
    }

    modal.style.display = rawKey ? "flex" : "none";

    if (rawKey && copyBtn && typeof copyBtn.focus === "function") {
      copyBtn.focus();
    }
  }

  _closePersonalApiKeyModal() {
    const modal = document.getElementById("personalApiKeyModal");
    const value = document.getElementById("personalApiKeyModalValue");
    const copyBtn = document.getElementById("copyPersonalApiKeyBtn");

    if (!modal || !value) {
      return;
    }

    modal.style.display = "none";
    value.textContent = "";

    if (copyBtn) {
      copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy key';
    }
  }

  _openPersonalApiKeyHelpModal() {
    const modal = document.getElementById("personalApiKeyHelpModal");
    const dismissButton = document.getElementById("dismissPersonalApiKeyHelpModal");

    if (!modal) {
      return;
    }

    modal.style.display = "flex";

    if (dismissButton && typeof dismissButton.focus === "function") {
      dismissButton.focus();
    }
  }

  _closePersonalApiKeyHelpModal() {
    const modal = document.getElementById("personalApiKeyHelpModal");

    if (!modal) {
      return;
    }

    modal.style.display = "none";
  }

  _showPersonalApiKeyMessage(message, type = "info") {
    const messageEl = document.getElementById("personalApiKeyMessage");
    if (!messageEl) {
      return;
    }

    messageEl.textContent = message;
    messageEl.className = `message-modern ${type}`;
    messageEl.style.display = "block";

    if (window.showNotification) {
      window.showNotification(message, type, 4000);
    }
  }

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

  _formatOptionalDate(value) {
    if (!value) {
      return "Never";
    }

    return this._formatDate(value);
  }

  _formatPersonalApiKeyExpirationDate(item) {
    if (!item || !item.expiresAt || item.expiration === "never") {
      return "No expiration date";
    }

    return this._formatOptionalDate(item.expiresAt);
  }

  _describePersonalApiKeyExpiration(expiration) {
    const labels = {
      "1d": "1 day",
      "7d": "7 days",
      "14d": "14 days",
      "30d": "30 days",
      "365d": "1 year",
      never: "No expiration date",
    };

    const normalized = typeof expiration === "string" ? expiration.trim().toLowerCase() : "never";
    return labels[normalized] || labels.never;
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.IntegrationsPage = IntegrationsPage;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = IntegrationsPage;
}
