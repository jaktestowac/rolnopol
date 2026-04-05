/**
 * BuddyPage - Pet Buddy Terminal Component
 * Handles all pet buddy interactions and rendering
 */

class BuddyPage {
  constructor() {
    this.apiService = null;
    this.authService = null;
    this.featureFlagsService = null;
    this.pet = null;
    this.requestInProgress = false;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.asciiBlinkTimeout = null;
    this.asciiBlinkAnimationTimer = null;
  }

  /**
   * Initialize the buddy page with app services
   */
  async init(app) {
    console.log("[BuddyPage] init() called");

    // Get services from app
    this.apiService = app?.getModule?.("apiService");
    this.authService = app?.getModule?.("authService");
    this.featureFlagsService = app?.getModule?.("featureFlagsService");

    console.log("[BuddyPage] Services loaded:", {
      hasApiService: !!this.apiService,
      hasAuthService: !!this.authService,
      hasFeatureFlagsService: !!this.featureFlagsService,
    });

    // If services are not available, wait for them to be registered
    if (!this.apiService || !this.featureFlagsService) {
      console.log("[BuddyPage] Required services not available yet, waiting...");

      // Wait up to 5 seconds for services to be registered
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));

        this.apiService = app?.getModule?.("apiService");
        this.featureFlagsService = app?.getModule?.("featureFlagsService");

        if (this.apiService && this.featureFlagsService) {
          console.log("[BuddyPage] Services became available after " + i * 100 + "ms");
          break;
        }
      }
    }

    if (!this.apiService) {
      console.error("[BuddyPage] apiService still not available after waiting");
      this._showMessage("Unable to initialize buddy page - apiService not available", true);
      document.getElementById("loadingState").hidden = true;
      return;
    }

    console.log("[BuddyPage] Checking feature flag...");
    // Check feature flag
    const isEnabled = await this._checkFeatureFlag();
    console.log("[BuddyPage] Feature flag enabled:", isEnabled);

    if (!isEnabled) {
      document.getElementById("featureFlagNotice").hidden = false;
      document.getElementById("loadingState").hidden = true;
      return;
    }

    console.log("[BuddyPage] Loading pet data...");
    // Load pet data
    await this._loadPet();
    console.log("[BuddyPage] Pet data loaded:", !!this.pet);

    // Set up event listeners
    this._setupEventListeners();

    // Focus input prompt
    document.getElementById("terminalCommandInput")?.focus();

    // Render based on pet state
    if (this.pet) {
      console.log("[BuddyPage] Pet exists, rendering pet");
      this._renderPet();
      this._showPetSection();
      this._updateCommandHint();
    } else {
      console.log("[BuddyPage] No pet found; awaiting /hatch command");
      this._hidePetSection();
      this._updateCommandHint();
    }

    // Hide loading state
    document.getElementById("loadingState").hidden = true;
    console.log("[BuddyPage] Initialization complete");
  }

  /**
   * Check if feature flag is enabled
   */
  async _checkFeatureFlag() {
    if (!this.featureFlagsService || typeof this.featureFlagsService.isEnabled !== "function") {
      console.warn("[BuddyPage] featureFlagsService not available, defaulting to false");
      return false;
    }

    try {
      const enabled = await this.featureFlagsService.isEnabled("petBuddyEnabled", false);
      return enabled;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load pet data from API
   */
  async _loadPet() {
    try {
      const response = await this.apiService.get("/buddy");
      const petPayload = response?.data?.data;

      if (response?.success && petPayload && petPayload.id) {
        this.pet = petPayload;
        console.log("[BuddyPage] Pet loaded successfully");
        console.log("[BuddyPage] Pet name:", this.pet.name);
        // console.log("[BuddyPage] Pet structure:", {
        //   id: this.pet.id,
        //   name: this.pet.name,
        //   species: this.pet.species,
        //   rarity: this.pet.rarity,
        //   hasPersonality: !!this.pet.personality,
        //   personalityKeys: this.pet.personality ? Object.keys(this.pet.personality) : [],
        //   hasCustomization: !!this.pet.customization,
        //   hasAscii: !!this.pet.ascii,
        // });
      } else {
        console.log("[BuddyPage] No pet found (user doesn't have one yet)");
        this.pet = null;
      }
    } catch (error) {
      console.log("[BuddyPage] Error loading pet:", error.status, error.message);
      if (error.status === 404) {
        this.pet = null;
        console.log("[BuddyPage] No pet found (404), user can hatch a new one");
      } else {
        console.error("[BuddyPage] Unexpected error loading pet:", error);
        this._showNotification("Failed to load pet data: " + error.message, true);
      }
    }
  }

  /**
   * Hatch a new pet
   */
  async _hatchPet() {
    if (this.requestInProgress) return;
    this.requestInProgress = true;

    try {
      const response = await this.apiService.post("/buddy", {});
      const petPayload = response?.data?.data;
      const hatchMessage = response?.data?.message || "Your buddy has arrived!";

      if (response?.success && petPayload) {
        this.pet = petPayload;

        this._hideHatchModal();
        this._showPetSection();
        this._renderPet();
        this._updateCommandHint();

        this._addMessage(`✨ NEW BUDDY HATCHED ✨\n${hatchMessage}`);
        this._showNotification(`Welcome to ${this.pet.name}!`);
      }
    } catch (error) {
      const errorMessage = error?.data?.error || error?.message || "Failed to hatch pet";
      const terminalMessage = `Error hatching buddy: ${errorMessage}`;
      this._addMessage(terminalMessage);
      this._showNotification(errorMessage, true);
      console.error("Hatch error:", error);
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Pet interaction
   */
  async _petPet() {
    if (!this.pet || this.requestInProgress) return;
    this.requestInProgress = true;

    try {
      const response = await this.apiService.post(`/buddy/${this.pet.id}/pet`, {});
      const payload = response?.data?.data;

      if (response?.success && payload) {
        this._addMessage(`$ buddy pet\n${payload.message}`);
        if (payload.totalPets !== undefined) {
          this.pet.totalPets = payload.totalPets;
        }
      }
    } catch (error) {
      const errorMessage = error?.data?.error || "Failed to pet companion";
      this._addMessage(`Error: ${errorMessage}`);
      this._showNotification(errorMessage, true);
      console.error("Pet error:", error);
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Talk to pet
   */
  async _talkToPet(message) {
    if (!this.pet) return;

    const userMessage = message?.trim();
    if (!userMessage) {
      this._addMessage("Usage: /talk <message>");
      return;
    }

    if (this.requestInProgress) return;
    this.requestInProgress = true;

    try {
      const response = await this.apiService.post(`/buddy/${this.pet.id}/talk`, {
        message: userMessage.trim(),
      });
      const payload = response?.data?.data;

      if (response?.success && payload) {
        this._addMessage(`$ buddy talk\n${payload.message}`);
        if (payload.totalTalks !== undefined) {
          this.pet.totalTalks = payload.totalTalks;
        }
      }
    } catch (error) {
      const errorMessage = error?.data?.error || "Failed to talk to pet";
      this._addMessage(`Error: ${errorMessage}`);
      this._showNotification(errorMessage, true);
      console.error("Talk error:", error);
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Ask pet for help
   */
  async _askForHelp(question) {
    if (!this.pet) return;

    const userQuestion = question?.trim();
    if (!userQuestion) {
      this._addMessage("Usage: /ask-help <question>");
      return;
    }

    if (this.requestInProgress) return;
    this.requestInProgress = true;

    try {
      const response = await this.apiService.post(`/buddy/${this.pet.id}/ask-help`, {
        message: userQuestion.trim(),
      });
      const payload = response?.data?.data;

      if (response?.success && payload) {
        this._addMessage(`$ buddy ask-help\n${payload.message}`);
        if (payload.helpMessage) {
          this._addMessage(`\n${payload.helpMessage}`);
        }
        if (payload.quip) {
          this._addMessage(`\n*${payload.quip}*`);
        }
        if (payload.totalAskedForHelp !== undefined) {
          this.pet.totalAskedForHelp = payload.totalAskedForHelp;
        }
      }
    } catch (error) {
      const errorMessage = error?.data?.error || "Failed to ask for help";
      this._addMessage(`Error: ${errorMessage}`);
      this._showNotification(errorMessage, true);
      console.error("Ask help error:", error);
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Show pet info / personality description
   */
  _showInfo() {
    if (!this.pet) return;

    const info = `
═══════════════════════════════════════
         ${this.pet.name.toUpperCase()} - PET INFO
═══════════════════════════════════════
Species:  ${this.pet.species}
Rarity:   ${this.pet.rarityLabel}
Hatched:  ${new Date(this.pet.hatchedAt).toLocaleString()}
Age:      ${this._formatPetAge(this.pet.hatchedAt)}

Personality:
  ${this.pet.personalityDescription || "A unique companion"}

Stats:
  Farming:  ${this.pet.personality.farming}/100
  Patience: ${this.pet.personality.patience}/100
  Chaos:    ${this.pet.personality.chaos}/100
  Wisdom:   ${this.pet.personality.wisdom}/100

Interactions:
  Petted:        ${this.pet.totalPets || 0}
  Talked to:     ${this.pet.totalTalks || 0}
  Asked for help: ${this.pet.totalAskedForHelp || 0}
═══════════════════════════════════════
    `;

    this._addMessage(info);
  }

  _formatPetAge(hatchedAt) {
    if (!hatchedAt) return "Unknown";

    const hatched = new Date(hatchedAt);
    const now = new Date();
    const diffMs = Math.max(0, now - hatched);

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Update pet customization (eyes/hat)
   */
  async _updateCustomization(type, value) {
    if (!this.pet || this.requestInProgress) return;
    this.requestInProgress = true;

    const customization = {};
    if (type === "eyes") {
      customization.eyes = value;
    } else if (type === "hat") {
      customization.hat = value === "none" ? null : value;
    }

    try {
      const response = await this.apiService.patch(`/buddy/${this.pet.id}`, customization);
      const payload = response?.data?.data;

      if (response?.success && payload) {
        this.pet = payload;
        this._renderPet();

        const typeLabel = type === "eyes" ? "eyes" : "hat";
        const valueLabel = type === "eyes" ? value : value === "none" ? "no hat" : value;
        this._addMessage(`✨ ${this.pet.name}'s ${typeLabel} changed to ${valueLabel}!`);
        this._showNotification("Customization updated!");
      }
    } catch (error) {
      const errorMessage = error?.data?.error || "Failed to update customization";
      this._addMessage(`Error: ${errorMessage}`);
      this._showNotification(errorMessage, true);
      console.error("Update customization error:", error);
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Release pet (with confirmation)
   */
  _releasePet() {
    if (!this.pet) return;

    // Show confirmation modal
    document.getElementById("releasePetName").textContent = this.pet.name;
    document.getElementById("releaseModal").classList.remove("hidden");
  }

  /**
   * Confirm release pet
   */
  async _confirmReleasePet() {
    if (!this.pet || this.requestInProgress) return;
    this.requestInProgress = true;

    const petName = this.pet.name;

    try {
      await this.apiService.delete(`/buddy/${this.pet.id}`);

      // Clear pet data
      this.pet = null;

      // Update UI
      this._hidePetSection();
      this._hideHatchModal();
      this._updateCommandHint();

      this._addMessage(`${petName} has been released. Goodbye, friend! 👋`);
      this._showNotification(`${petName} has been released`);
    } catch (error) {
      const errorMessage = error?.data?.error || "Failed to release pet";
      this._addMessage(`Error: ${errorMessage}`);
      this._showNotification(errorMessage, true);
      console.error("Release error:", error);
    } finally {
      this.requestInProgress = false;
      document.getElementById("releaseModal").classList.add("hidden");
    }
  }

  /**
   * Render pet data to UI
   */
  _renderPet() {
    if (!this.pet) {
      console.error("[BuddyPage] _renderPet called but pet is null/undefined");
      return;
    }

    console.log("[BuddyPage] Rendering pet:", this.pet);

    // Pet name and rarity
    document.getElementById("petName").textContent = this.pet.name || "Unknown";
    document.getElementById("petRarity").textContent = this.pet.rarityLabel || `★ ${(this.pet.rarity || "UNKNOWN").toUpperCase()}`;

    // ASCII art
    document.getElementById("asciiArt").textContent = this.pet.ascii || "[Pet ASCII art not available]";
    this._setupAsciiBlink();

    // Stats - with safe access
    const stats = this.pet.personality || {};
    console.log("[BuddyPage] Pet personality stats:", stats);

    this._updateStat("farming", stats.farming || 50);
    this._updateStat("patience", stats.patience || 50);
    this._updateStat("chaos", stats.chaos || 50);
    this._updateStat("wisdom", stats.wisdom || 50);

    // Bio
    document.getElementById("bioText").textContent =
      this.pet.personalityDescription || `${this.pet.name} the ${this.pet.species || "Unknown"}`;

    // Update customization button states
    const currentEyes = (this.pet.customization && this.pet.customization.eyes) || "◉";
    const currentHat = (this.pet.customization && this.pet.customization.hat) || "none";

    document.querySelectorAll(".eye-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.eye === currentEyes);
    });

    document.querySelectorAll(".hat-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.hat === currentHat);
    });
  }

  /**
   * Update a single stat display
   */
  _updateStat(statName, value) {
    const cleanValue = Math.min(100, Math.max(0, value));
    const filled = Math.round(cleanValue / 10);
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    document.getElementById(`stat-${statName}-bar`).textContent = bar;
    document.getElementById(`stat-${statName}-value`).textContent = cleanValue;
  }

  _clearAsciiBlink() {
    if (this.asciiBlinkTimeout) {
      clearTimeout(this.asciiBlinkTimeout);
      this.asciiBlinkTimeout = null;
    }
    if (this.asciiBlinkAnimationTimer) {
      clearTimeout(this.asciiBlinkAnimationTimer);
      this.asciiBlinkAnimationTimer = null;
    }
  }

  _setupAsciiBlink() {
    this._clearAsciiBlink();
    if (!this.pet || !this.pet.ascii) return;

    const scheduleBlink = () => {
      const delay = Math.floor(Math.random() * 4000) + 4000;
      this.asciiBlinkTimeout = setTimeout(() => {
        this._blinkAsciiOnce();
        scheduleBlink();
      }, delay);
    };

    scheduleBlink();
  }

  _blinkAsciiOnce() {
    const asciiEl = document.getElementById("asciiArt");
    if (!asciiEl || !this.pet || !this.pet.ascii) return;

    const eyeChar = this.pet.customization?.eyes || "◉";
    const blinkChar = eyeChar === "@" ? "-" : "-";
    const blinkedAscii = this.pet.ascii.replaceAll(eyeChar, blinkChar);

    asciiEl.textContent = blinkedAscii;
    this.asciiBlinkAnimationTimer = setTimeout(() => {
      asciiEl.textContent = this.pet.ascii;
      this.asciiBlinkAnimationTimer = null;
    }, 180);
  }

  /**
   * Add message to terminal output
   */
  _addMessage(text) {
    const container = document.getElementById("terminalOutput");
    if (!container) {
      return;
    }

    const messageDiv = document.createElement("div");
    messageDiv.className = "terminal-output-line";
    messageDiv.textContent = text;

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Show notification toast
   */
  _showNotification(message, isError = false) {
    const container = document.getElementById("notification-container");
    const notification = document.createElement("div");
    notification.className = `notification${isError ? " error" : ""}`;
    notification.textContent = message;

    container.appendChild(notification);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      notification.remove();
    }, 4000);
  }

  /**
   * Prompt user with simple dialog
   */
  _promptUser(prompt) {
    return window.prompt(prompt);
  }

  /**
   * Show/hide sections
   */
  _showPetSection() {
    document.getElementById("petSection").hidden = false;
  }

  _hidePetSection() {
    document.getElementById("petSection").hidden = true;
  }

  _showHatchPanel() {
    const hatchPanel = document.getElementById("hatchPanel");
    if (hatchPanel) {
      hatchPanel.hidden = false;
    }
  }

  _hideHatchPanel() {
    const hatchPanel = document.getElementById("hatchPanel");
    if (hatchPanel) {
      hatchPanel.hidden = true;
    }
  }

  _showHatchModal() {
    // Don't auto-show, wait for user to click hatch button
  }

  _hideHatchModal() {
    const hatchModal = document.getElementById("hatchModal");
    if (hatchModal) {
      hatchModal.classList.add("hidden");
    }
  }

  _addCommandToHistory(command) {
    if (!command || typeof command !== "string") return;
    if (this.commandHistory[this.commandHistory.length - 1] === command) {
      this.historyIndex = this.commandHistory.length;
      return;
    }

    this.commandHistory.push(command);
    this.historyIndex = this.commandHistory.length;
  }

  _updateCommandHint() {
    const hint = document.getElementById("commandHint");
    if (!hint) return;

    if (this.pet) {
      hint.textContent =
        "Available commands: /pet, /talk <message>, /ask-help <question>, /info, /release. Use Shift+Enter to add a newline.";
    } else {
      hint.textContent = "No pet yet. Type /hatch to begin. Use Shift+Enter for multiline commands.";
    }
  }

  /**
   * Set up all event listeners
   */
  _setupEventListeners() {
    // Terminal command input
    const terminalCommandInput = document.getElementById("terminalCommandInput");
    if (terminalCommandInput) {
      terminalCommandInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const commandText = terminalCommandInput.value.trim();
          if (!commandText) return;
          this._addCommandToHistory(commandText);
          this._addMessage(`$ ${commandText}`);
          terminalCommandInput.value = "";
          await this._executeCommand(commandText);
          terminalCommandInput.focus();
          return;
        }

        if (e.key === "ArrowUp") {
          const caretAtStart = terminalCommandInput.selectionStart === 0 && terminalCommandInput.selectionEnd === 0;
          if (!caretAtStart || this.commandHistory.length === 0) return;
          e.preventDefault();
          this.historyIndex = Math.max(0, this.historyIndex - 1);
          terminalCommandInput.value = this.commandHistory[this.historyIndex] || "";
          terminalCommandInput.selectionStart = terminalCommandInput.selectionEnd = terminalCommandInput.value.length;
          return;
        }

        if (e.key === "ArrowDown") {
          const caretAtEnd =
            terminalCommandInput.selectionStart === terminalCommandInput.value.length &&
            terminalCommandInput.selectionEnd === terminalCommandInput.value.length;
          if (!caretAtEnd || this.commandHistory.length === 0) return;
          e.preventDefault();
          this.historyIndex = Math.min(this.commandHistory.length, this.historyIndex + 1);
          terminalCommandInput.value = this.historyIndex === this.commandHistory.length ? "" : this.commandHistory[this.historyIndex];
          terminalCommandInput.selectionStart = terminalCommandInput.selectionEnd = terminalCommandInput.value.length;
          return;
        }
      });

      terminalCommandInput.addEventListener("blur", () => {
        setTimeout(() => terminalCommandInput.focus(), 0);
      });
    }

    // Release button
    const releaseBtn = document.getElementById("releasePetBtn");
    if (releaseBtn) {
      releaseBtn.addEventListener("click", () => this._releasePet());
    }

    // Hatch Modal
    const hatchModal = document.getElementById("hatchModal");
    const modalCancel = document.getElementById("modalCancel");
    const modalConfirm = document.getElementById("modalConfirm");
    const modalClose = document.getElementById("modalClose");

    if (modalCancel) {
      modalCancel.addEventListener("click", () => {
        hatchModal.classList.add("hidden");
      });
    }

    if (modalConfirm) {
      modalConfirm.addEventListener("click", () => {
        hatchModal.classList.add("hidden");
        this._hatchPet();
      });
    }

    if (modalClose) {
      modalClose.addEventListener("click", () => {
        hatchModal.classList.add("hidden");
      });
    }

    // Release Modal
    const releaseModal = document.getElementById("releaseModal");
    const releaseModalCancel = document.getElementById("releaseModalCancel");
    const releaseModalConfirm = document.getElementById("releaseModalConfirm");
    const releaseModalClose = document.getElementById("releaseModalClose");

    if (releaseModalCancel) {
      releaseModalCancel.addEventListener("click", () => {
        releaseModal.classList.add("hidden");
      });
    }

    if (releaseModalConfirm) {
      releaseModalConfirm.addEventListener("click", () => {
        this._confirmReleasePet();
      });
    }

    if (releaseModalClose) {
      releaseModalClose.addEventListener("click", () => {
        releaseModal.classList.add("hidden");
      });
    }

    // Close modal on overlay click
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        const modal = e.currentTarget.closest(".modal");
        if (modal) {
          modal.classList.add("hidden");
        }
      });
    });
  }

  /**
   * Handle action button clicks
   */
  async _executeCommand(commandText) {
    const commandLine = (commandText || "").trim();
    if (!commandLine.startsWith("/")) {
      this._addMessage("Commands must start with '/'. Type /help for options.");
      return;
    }

    const parts = commandLine.slice(1).split(" ");
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ").trim();

    switch (command) {
      case "hatch":
        await this._hatchPet();
        break;
      case "pet":
        await this._petPet();
        break;
      case "talk":
        await this._talkToPet(args);
        break;
      case "ask-help":
      case "askhelp":
        await this._askForHelp(args);
        break;
      case "info":
        this._showInfo();
        break;
      case "release":
        this._releasePet();
        break;
      case "help":
      case "?":
        this._addMessage("Available commands: /hatch, /pet, /talk <message>, /ask-help <question>, /info, /release");
        break;
      default:
        this._addMessage(`Unknown command: ${command}. Type /help for available commands.`);
        break;
    }
  }

  _handleAction(action) {
    switch (action) {
      case "pet":
        this._petPet();
        break;
      case "talk":
        this._talkToPet();
        break;
      case "ask-help":
        this._askForHelp();
        break;
      case "info":
        this._showInfo();
        break;
    }
  }

  /**
   * Show message helper
   */
  _showMessage(message, isError = false) {
    this._addMessage(message);
    if (isError) {
      this._showNotification(message, true);
    }
  }
}

// Auto-initialize when page loads
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[BuddyPage] DOMContentLoaded event fired");
  const buddyPage = new BuddyPage();

  // Wait for window.App to be available (note: window.App with capital A)
  if (window.App && typeof window.App.getModule === "function") {
    console.log("[BuddyPage] window.App is already available, initializing immediately");
    await buddyPage.init(window.App);
  } else {
    console.log("[BuddyPage] window.App not available, waiting for it...");
    // Fallback: wait for app to be available
    let initialized = false;
    const waitForApp = setInterval(async () => {
      if (!initialized && window.App && typeof window.App.getModule === "function") {
        console.log("[BuddyPage] window.App became available, initializing");
        initialized = true;
        clearInterval(waitForApp);
        try {
          await buddyPage.init(window.App);
        } catch (error) {
          console.error("[BuddyPage] Error during initialization:", error);
          const loadingState = document.getElementById("loadingState");
          if (loadingState) {
            loadingState.hidden = true;
            loadingState.innerHTML = `<p style="color: #ff3333;">Error initializing buddy page: ${error.message}</p>`;
          }
        }
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!initialized) {
        console.error("[BuddyPage] Timeout waiting for window.App, app never became available");
        clearInterval(waitForApp);
        const loadingState = document.getElementById("loadingState");
        if (loadingState) {
          loadingState.hidden = false;
          loadingState.innerHTML = '<p style="color: #ff3333;">Failed to initialize: window.App is not available</p>';
        }
      }
    }, 10000);
  }
});
