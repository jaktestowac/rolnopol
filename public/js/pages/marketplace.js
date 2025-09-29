/**
 * Marketplace Page
 * Handles marketplace functionality including browsing, creating offers, and transactions
 */
class MarketplacePage {
  constructor() {
    this.apiService = null;
    this.authService = null;
    this.eventBus = null;
    this.currentUser = null;
    this.userBalance = 0;
    this.financialStats = null;
    this.marketplaceStats = null;
    this.fields = [];
    this.animals = [];
    this.offers = [];
    this.myOffers = [];
    this.transactions = [];
    this.initialized = false;
    this.formHandlersSetup = false;
    // Pagination state for Browse Offers
    this.offersPage = 1;
    this.offersPageSize = 9;
    this.offersTotalPages = 1;
  }

  /**
   * Initialize the page
   * @param {App} app - Application instance
   */
  init(app) {
    // Prevent duplicate initialization
    if (this.initialized) {
      return;
    }

    this.apiService = app.getModule("apiService");
    this.authService = app.getModule("authService");
    this.eventBus = app.getEventBus();

    // Check if required services are available
    if (!this.apiService) {
      console.error("ApiService not available for MarketplacePage");
      return;
    }

    if (!this.authService) {
      console.error("AuthService not available for MarketplacePage");
      return;
    }

    if (!this.eventBus) {
      console.error("EventBus not available for MarketplacePage");
      return;
    }

    this._setupEventListeners();
    this._setupTabNavigation();
    this._setupFormHandlers();
    this._setupConfirmationModal();
    this._loadInitialData();

    this.initialized = true;
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    if (!this.eventBus) return;

    // Listen for authentication changes
    this.eventBus.on("auth:login", () => {
      this._loadInitialData();
    });

    this.eventBus.on("auth:logout", () => {
      this._clearData();
    });

    // Listen for user updates
    this.eventBus.on("user:updated", () => {
      this._loadUserBalance();
    });

    // Setup event delegation for marketplace actions
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-cancel") && !e.target.disabled) {
        const offerId = parseInt(e.target.getAttribute("data-offer-id"));
        if (offerId) {
          this.cancelOffer(offerId);
        }
      } else if (e.target.classList.contains("btn-buy") && !e.target.disabled) {
        const offerId = parseInt(e.target.getAttribute("data-offer-id"));
        if (offerId) {
          this.buyItem(offerId);
        }
      }
    });
  }

  /**
   * Setup tab navigation
   * @private
   */
  _setupTabNavigation() {
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");

        // Update active tab button
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");

        // Update active tab content
        tabContents.forEach((content) => content.classList.remove("active"));
        document.getElementById(targetTab).classList.add("active");

        // Load data for the selected tab
        this._loadTabData(targetTab);
      });
    });
  }

  /**
   * Setup form handlers
   * @private
   */
  _setupFormHandlers() {
    // Prevent duplicate setup
    if (this.formHandlersSetup) {
      return;
    }

    const createForm = document.getElementById("createOfferForm");
    const itemTypeSelect = document.getElementById("itemType");
    const itemIdSelect = document.getElementById("itemId");

    // Handle item type change
    itemTypeSelect.addEventListener("change", () => {
      this._loadAvailableItems(itemTypeSelect.value);
    });

    // Handle form submission
    createForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this._createOffer();
    });

    this.formHandlersSetup = true;
  }

  /**
   * Setup confirmation modal
   * @private
   */
  _setupConfirmationModal() {
    const modal = document.getElementById("confirmationModal");
    const closeBtn = document.getElementById("confirmationModalClose");
    const cancelBtn = document.getElementById("confirmationModalCancel");
    const confirmBtn = document.getElementById("confirmationModalConfirm");

    // Close modal when clicking close button or cancel button
    [closeBtn, cancelBtn].forEach((btn) => {
      if (btn) {
        btn.addEventListener("click", () => {
          this._hideConfirmationModal();
        });
      }
    });

    // Close modal when clicking outside the modal content
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        this._hideConfirmationModal();
      }
    });

    // Handle confirm button click
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (this._pendingConfirmationAction) {
          this._pendingConfirmationAction();
          this._hideConfirmationModal();
        }
      });
    }
  }

  /**
   * Load initial data
   * @private
   */
  async _loadInitialData() {
    try {
      if (!this.authService || !this.authService.isAuthenticated()) {
        return;
      }

      this.currentUser = await this.authService.getCurrentUser();
      await Promise.all([
        this._loadUserBalance(),
        this._loadFields(),
        this._loadAnimals(),
        this._loadOffers(),
        this._loadMyOffers(),
        this._loadTransactions(),
        this._loadFinancialStats(),
      ]);

      // Fetch general statistics for totalValue
      try {
        const statsResponse = await fetch("/api/v1/statistics");
        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          this.totalValue = statsData.totalValue || 0;
        } else {
          this.totalValue = 0;
        }
      } catch (err) {
        this.totalValue = 0;
      }
      // Update header stats
      this._updateHeaderStats();
    } catch (error) {
      errorLogger.log("Marketplace Load Initial Data", error);
    }
  }

  /**
   * Load user balance
   * @private
   */
  async _loadUserBalance() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("financial/account", {
        requiresAuth: true,
      });
      if (response.success) {
        // Handle new nested response format: data.account
        const accountData =
          response.data.data.account || response.data.data || response.data;
        this.userBalance = accountData.balance || 0;
        const balanceElement = document.getElementById("userBalance");
        if (balanceElement) {
          balanceElement.textContent = `${this.userBalance} ROL`;
        }
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Balance", error);
    }
  }

  /**
   * Load marketplace statistics
   * @private
   */
  async _loadFinancialStats() {
    try {
      if (!this.apiService) return;

      // Load user's financial stats
      const userStatsResponse = await this.apiService.get("financial/stats", {
        requiresAuth: true,
      });
      if (userStatsResponse.success) {
        // Handle new nested response format: data.statistics
        this.financialStats =
          userStatsResponse.data.statistics ||
          userStatsResponse.data.data ||
          userStatsResponse.data;
      }

      // Load comprehensive marketplace statistics across all users
      const marketplaceStatsResponse = await this.apiService.get(
        "financial/marketplace-stats",
        { requiresAuth: true },
      );
      if (marketplaceStatsResponse.success) {
        this.marketplaceStats =
          marketplaceStatsResponse.data.data || marketplaceStatsResponse.data;
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Financial Stats", error);
    }
  }

  /**
   * Load user's fields
   * @private
   */
  async _loadFields() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("fields", {
        requiresAuth: true,
      });
      if (response.success) {
        this.fields = response.data.data || [];
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Fields", error);
    }
  }

  /**
   * Load user's animals
   * @private
   */
  async _loadAnimals() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("animals", {
        requiresAuth: true,
      });
      if (response.success) {
        this.animals = response.data.data || [];
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Animals", error);
    }
  }

  /**
   * Load marketplace offers
   * @private
   */
  async _loadOffers() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("marketplace/offers", {
        requiresAuth: true,
      });
      if (response.success) {
        this.offers = response.data.data.offers || [];
        // Reset to first page on new data
        this.offersPage = 1;
        this._renderOffers("browseOffers", this.offers);
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Offers", error);
      console.error("Error loading offers:", error);
      this._showError("browseOffers", "Failed to load offers");
    }
  }

  /**
   * Load user's own offers
   * @private
   */
  async _loadMyOffers() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("marketplace/my-offers", {
        requiresAuth: true,
      });
      if (response.success) {
        this.myOffers = response.data.data.offers || [];
        this._renderOffers("myOffers", this.myOffers, true);
      }
    } catch (error) {
      errorLogger.log("Marketplace Load My Offers", error);
      console.error("Error loading my offers:", error);
      this._showError("myOffers", "Failed to load your offers");
    }
  }

  /**
   * Refresh global statistics
   * @private
   */
  async _refreshGlobalStatistics() {
    try {
      const statsResponse = await fetch("/api/v1/statistics");
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        this.totalValue = statsData.totalValue || 0;
      }
    } catch (err) {
      console.error("Failed to refresh global statistics:", err);
    }
  }

  /**
   * Load transaction history
   * @private
   */
  async _loadTransactions() {
    try {
      if (!this.apiService) return;

      const response = await this.apiService.get("marketplace/transactions", {
        requiresAuth: true,
      });
      if (response.success) {
        this.transactions = response.data.data.transactions || [];

        // Don't recalculate totalValue here - keep the global total from statistics
        // this.totalValue should remain from the global statistics API

        this._renderTransactions();
        this._updateHeaderStats();
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Transactions", error);
      this._showError("transactionsList", "Failed to load transactions");
    }
  }

  /**
   * Load tab-specific data
   * @private
   */
  _loadTabData(tabName) {
    switch (tabName) {
      case "browse":
        this._loadOffers();
        break;
      case "my-offers":
        this._loadMyOffers();
        break;
      case "transactions":
        this._loadTransactions();
        break;
    }
  }

  /**
   * Load available items for offer creation
   * @private
   */
  async _loadAvailableItems(itemType) {
    const itemIdSelect = document.getElementById("itemId");
    itemIdSelect.innerHTML = '<option value="">Select an item</option>';

    if (!itemType) return;

    // Check if data is loaded
    if (!this.fields || !this.animals) {
      await this._loadInitialData();
    }

    try {
      if (itemType === "field") {
        // Get fields that are empty (no animals assigned)
        const availableFields = this.fields.filter((field) => {
          const fieldAnimals = this.animals.filter(
            (animal) =>
              animal.fieldId === field.id ||
              animal.fieldId === field.id.toString() ||
              animal.fieldId === parseInt(field.id),
          );
          return fieldAnimals.length === 0;
        });

        availableFields.forEach((field) => {
          const option = document.createElement("option");
          option.value = field.id;
          option.textContent = `${field.name} (${field.area} ha)`;
          itemIdSelect.appendChild(option);
        });
      } else if (itemType === "animal") {
        // Get animals that are not assigned to fields
        const availableAnimals = this.animals.filter((animal) => {
          const fieldId = animal.fieldId;
          return (
            !fieldId ||
            fieldId === 0 ||
            fieldId === "0" ||
            fieldId === null ||
            fieldId === undefined ||
            fieldId === ""
          );
        });

        availableAnimals.forEach((animal) => {
          const option = document.createElement("option");
          option.value = animal.id;
          option.textContent = `${animal.type} (${animal.amount} units)`;
          itemIdSelect.appendChild(option);
        });
      }
    } catch (error) {
      errorLogger.log("Marketplace Load Available Items", error);
    }
  }

  /**
   * Create a new offer
   * @private
   */
  async _createOffer() {
    const form = document.getElementById("createOfferForm");
    const formData = new FormData(form);

    // Client-side validation
    const itemType = formData.get("itemType");
    const itemId = formData.get("itemId");
    const price = parseFloat(formData.get("price"));
    const description = formData.get("description") || "";
    let errorMsg = "";
    if (!itemType) {
      errorMsg = "Please select an item type.";
    } else if (!itemId || isNaN(itemId) || Number(itemId) <= 0) {
      errorMsg = "Please select a valid item.";
    } else if (!price || isNaN(price) || price <= 0) {
      errorMsg = "Please enter a valid price greater than 0.";
    } else if (description.length > 300) {
      errorMsg = "Description cannot exceed 300 characters.";
    }
    if (errorMsg) {
      this._showNotification(errorMsg, "error");
      return;
    }
    const offerData = {
      itemType,
      itemId: parseInt(itemId),
      price,
      description,
    };
    try {
      const response = await this.apiService.post(
        "marketplace/offers",
        offerData,
        { requiresAuth: true },
      );

      if (response.success) {
        this._showNotification("Offer created successfully!", "success");
        form.reset();
        document.getElementById("itemId").innerHTML =
          '<option value="">Select an item</option>';
        // Refresh offers
        await this._loadMyOffers();
        await this._loadOffers();

        // Refresh global statistics to update total value
        await this._refreshGlobalStatistics();

        this._updateHeaderStats();
      }
      // Don't show error notification here - the API service will handle it via event bus
    } catch (error) {
      errorLogger.log("Marketplace Create Offer", error, { showToUser: false });
      // Don't show duplicate error notification - let the API service handle it
    }
  }

  /**
   * Buy an item from marketplace
   * @public
   */
  async buyItem(offerId) {
    // Find the offer details for confirmation
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer) {
      this._showNotification("Offer not found", "error");
      return;
    }

    // Get item details for confirmation message
    const item = this._getItemDetails(offer.itemType, offer.itemId);
    const itemName = item
      ? item.name || `${offer.itemType} #${offer.itemId}`
      : `${offer.itemType} #${offer.itemId}`;

    // Create confirmation message
    const confirmationMessage = `Are you sure you want to buy "${itemName}" for ${offer.price} ROL?`;

    // Show custom confirmation modal
    this._showConfirmationModal(
      "Confirm Purchase",
      confirmationMessage,
      async () => {
        try {
          const response = await this.apiService.post(
            "marketplace/buy",
            { offerId },
            { requiresAuth: true },
          );

          if (response.success) {
            this._showNotification(
              "Purchase completed successfully!",
              "success",
            );

            // Refresh data
            await Promise.all([
              this._loadUserBalance(),
              this._loadOffers(),
              this._loadMyOffers(),
              this._loadTransactions(),
            ]);

            // Refresh global statistics to update total value
            await this._refreshGlobalStatistics();

            this._updateHeaderStats();
          }
          // Don't show error notification here - the API service will handle it via event bus
        } catch (error) {
          errorLogger.log("Marketplace Buy Item", error, { showToUser: false });
          // Don't show duplicate error notification - let the API service handle it
        }
      },
      "Buy Now",
    );
  }

  /**
   * Cancel a offer
   * @public
   */
  async cancelOffer(offerId) {
    console.log("Cancel offer called with ID:", offerId);

    // Find the offer details for confirmation
    const offer = this.myOffers.find((o) => o.id === offerId);
    if (!offer) {
      this._showNotification("Offer not found", "error");
      return;
    }

    // Get item details for confirmation message
    const item = this._getItemDetails(offer.itemType, offer.itemId);
    const itemName = item
      ? item.name || `${offer.itemType} #${offer.itemId}`
      : `${offer.itemType} #${offer.itemId}`;

    // Create confirmation message
    const confirmationMessage = `Are you sure you want to cancel your offer for "${itemName}" (${offer.price} ROL)?`;

    // Show custom confirmation modal
    this._showConfirmationModal(
      "Confirm Cancellation",
      confirmationMessage,
      async () => {
        try {
          const response = await this.apiService.delete(
            `marketplace/offers/${offerId}`,
            { requiresAuth: true },
          );
          console.log("Cancel offer response:", response);

          if (response.success) {
            this._showNotification("Offer cancelled successfully!", "success");

            // Refresh offers
            await this._loadMyOffers();
            await this._loadOffers();

            // Refresh global statistics to update total value
            await this._refreshGlobalStatistics();

            this._updateHeaderStats();
          }
          // Don't show error notification here - the API service will handle it via event bus
        } catch (error) {
          errorLogger.log("Marketplace Cancel Offer", error, {
            showToUser: false,
          });
          console.error("Error cancelling offer:", error);
          // Don't show duplicate error notification - let the API service handle it
        }
      },
      "Cancel Offer",
      true, // isDanger = true for cancellation
    );
  }

  /**
   * Render offers
   * @private
   */
  _renderOffers(containerId, offers, isMyOffers = false) {
    const container = document.getElementById(containerId);
    let paginatedOffers = offers;
    let page = 1,
      pageSize = offers.length,
      totalPages = 1;
    if (!isMyOffers && containerId === "browseOffers") {
      page = this.offersPage;
      pageSize = this.offersPageSize;
      totalPages = Math.max(1, Math.ceil(offers.length / pageSize));
      this.offersTotalPages = totalPages;
      const startIdx = (page - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      paginatedOffers = offers.slice(startIdx, endIdx);
    }

    if (!offers || offers.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-store"></i>
          <p>${isMyOffers ? "You have no active offers" : "No offers available"}</p>
        </div>
      `;
    } else {
      const offersHTML = paginatedOffers
        .map((offer) => {
          const item = this._getItemDetails(offer.itemType, offer.itemId);
          const itemName = item
            ? item.name || `${offer.itemType} #${offer.itemId}`
            : `${offer.itemType} #${offer.itemId}`;

          // Determine status class and text based on offer status
          let statusClass = "";
          let statusText = "";
          let statusMessage = "";
          let isDisabled = false;

          switch (offer.status) {
            case "active":
              statusClass = "offer-active";
              break;
            case "unavailable":
              statusClass = "offer-unavailable";
              statusText = " (Unavailable)";
              statusMessage =
                "Item is currently in use and unavailable for purchase";
              isDisabled = true;
              break;
            case "sold":
              statusClass = "offer-sold";
              statusText = " (Sold)";
              statusMessage = "This item has been sold";
              isDisabled = true;
              break;
            case "cancelled":
              statusClass = "offer-cancelled";
              statusText = " (Cancelled)";
              statusMessage = "This offer has been cancelled";
              isDisabled = true;
              break;
            default:
              statusClass = "offer-active";
          }
          // Render details from backend
          let detailsHtml = "";
          if (offer.details) {
            if (offer.itemType === "animal") {
              detailsHtml = `<div class="offer-meta">Type: <b>${offer.details.type}</b>, Amount: <b>${offer.details.amount}</b></div>`;
            } else if (offer.itemType === "field") {
              detailsHtml = `<div class="offer-meta">Field: <b>${offer.details.name}</b>, Area: <b>${offer.details.area} ha</b></div>`;
            }
          }
          return `
          <div class="offer-card ${statusClass}">
            <div class="offer-header">
              <span class="offer-badge ${offer.itemType === "field" ? "badge-field" : "badge-animal"}">
                ${offer.itemType === "field" ? "Field" : "Animal"}
              </span>
              <span class="offer-price">${offer.price} ROL</span>
            </div>
            <div class="offer-details">
              <div class="offer-name">${itemName}${statusText}</div>
              <div class="offer-seller">Offered by: <b>${offer.sellerLabel || offer.sellerDisplayedName || "Unknown"}</b></div>
              ${detailsHtml}
              ${offer.description ? `<div class="offer-description">${offer.description}</div>` : ""}
              ${statusMessage ? `<div class="offer-status">${statusMessage}</div>` : ""}
            </div>
            <div class="offer-actions">
              ${
                isMyOffers
                  ? `<button class="btn-cancel" data-offer-id="${offer.id}" ${isDisabled ? "disabled" : ""}>Cancel</button>`
                  : `<button class="btn-buy" data-offer-id="${offer.id}" ${isDisabled ? "disabled" : ""}>Buy Now</button>`
              }
            </div>
          </div>
        `;
        })
        .join("");
      container.innerHTML = offersHTML;
    }
    // Always render pagination controls for Browse Offers
    if (!isMyOffers && containerId === "browseOffers") {
      this._renderOffersPagination();
    }
  }

  _renderOffersPagination() {
    const pagDiv = document.getElementById("offersPagination");
    const page = this.offersPage;
    const totalPages = this.offersTotalPages;
    let html = "";
    // Items per page dropdown
    html +=
      `<select id="offersPageSize" class="offers-page-size-select">\n` +
      `<option value="10"${this.offersPageSize === 9 ? " selected" : ""}>9 per page</option>` +
      `<option value="18"${this.offersPageSize === 18 ? " selected" : ""}>18 per page</option>` +
      `<option value="36"${this.offersPageSize === 36 ? " selected" : ""}>36 per page</option>` +
      `</select>`;
    html += `<button class="offers-page-btn" data-page="prev" ${page === 1 ? "disabled" : ""}>&laquo; Prev</button>`;
    // Show up to 5 page numbers, centered on current page
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) {
      html += `<button class="offers-page-btn${i === page ? " active" : ""}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="offers-page-btn" data-page="next" ${page === totalPages ? "disabled" : ""}>Next &raquo;</button>`;
    pagDiv.innerHTML = html;
    this._setupOffersPaginationListeners();
  }

  _setupOffersPaginationListeners() {
    const pagDiv = document.getElementById("offersPagination");
    if (!pagDiv) return;
    // Page buttons
    const buttons = pagDiv.querySelectorAll(".offers-page-btn");
    buttons.forEach((btn) => {
      btn.onclick = (e) => {
        let newPage = this.offersPage;
        const val = btn.getAttribute("data-page");
        if (val === "prev") {
          newPage = Math.max(1, this.offersPage - 1);
        } else if (val === "next") {
          newPage = Math.min(this.offersTotalPages, this.offersPage + 1);
        } else {
          newPage = parseInt(val);
        }
        if (newPage !== this.offersPage) {
          this.offersPage = newPage;
          this._renderOffers("browseOffers", this.offers);
        }
      };
    });
    // Items per page dropdown
    const pageSizeSelect = pagDiv.querySelector("#offersPageSize");
    if (pageSizeSelect) {
      pageSizeSelect.onchange = (e) => {
        const newSize = parseInt(pageSizeSelect.value);
        if (newSize !== this.offersPageSize) {
          this.offersPageSize = newSize;
          this.offersPage = 1;
          this._renderOffers("browseOffers", this.offers);
        }
      };
    }
  }

  /**
   * Render transaction history
   * @private
   */
  _renderTransactions() {
    const container = document.getElementById("transactionsList");

    if (!this.transactions || this.transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-history"></i>
          <p>No transactions found</p>
        </div>
      `;
      return;
    }

    const transactionsHTML = this.transactions
      .map((transaction) => {
        // Get current user ID from multiple possible fields
        const currentUserId =
          this.currentUser.userId ||
          this.currentUser.id ||
          this.currentUser.internalId;

        // Check if current user is the buyer (purchased the item)
        const isBuyer =
          Number(transaction.buyerId) === Number(currentUserId) ||
          String(transaction.buyerId) === String(currentUserId);

        // Check if current user is the seller (sold the item)
        const isSeller =
          Number(transaction.sellerId) === Number(currentUserId) ||
          String(transaction.sellerId) === String(currentUserId);

        const item = this._getItemDetails(
          transaction.itemType,
          transaction.itemId,
        );
        const itemName = item
          ? item.name || `${transaction.itemType} #${transaction.itemId}`
          : `${transaction.itemType} #${transaction.itemId}`;

        return `
        <div class="transaction-item">
          <div class="transaction-info">
            <div class="transaction-type">
              ${isBuyer ? "Purchase" : "Sale"}: ${itemName}
            </div>
            <div class="transaction-date">
              ${new Date(transaction.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div class="transaction-amount ${isBuyer ? "expense" : "income"}">
            ${isBuyer ? "-" : "+"}${transaction.price} ROL
          </div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = transactionsHTML;
  }

  /**
   * Get item details by type and ID
   * @private
   */
  _getItemDetails(itemType, itemId) {
    if (itemType === "field") {
      return this.fields.find(
        (field) =>
          Number(field.id) === Number(itemId) ||
          field.id === itemId ||
          field.id === parseInt(itemId),
      );
    } else if (itemType === "animal") {
      return this.animals.find(
        (animal) =>
          Number(animal.id) === Number(itemId) ||
          animal.id === itemId ||
          animal.id === parseInt(itemId),
      );
    }
    return null;
  }

  /**
   * Show confirmation modal
   * @private
   */
  _showConfirmationModal(
    title,
    message,
    confirmAction,
    confirmButtonText = "Confirm",
    isDanger = false,
  ) {
    const modal = document.getElementById("confirmationModal");
    const titleElement = document.getElementById("confirmationModalTitle");
    const messageElement = document.getElementById("confirmationModalMessage");
    const confirmBtn = document.getElementById("confirmationModalConfirm");

    if (titleElement) titleElement.textContent = title;
    if (messageElement) messageElement.textContent = message;
    if (confirmBtn) {
      confirmBtn.textContent = confirmButtonText;
      if (isDanger) {
        confirmBtn.classList.add("danger");
      } else {
        confirmBtn.classList.remove("danger");
      }
    }

    this._pendingConfirmationAction = confirmAction;
    modal.style.display = "flex";
  }

  /**
   * Hide confirmation modal
   * @private
   */
  _hideConfirmationModal() {
    const modal = document.getElementById("confirmationModal");
    modal.style.display = "none";
    this._pendingConfirmationAction = null;
  }

  /**
   * Show notification
   * @private
   */
  _showNotification(message, type = "info") {
    if (this.eventBus) {
      this.eventBus.emit("notification:show", { message, type });
    }
  }

  /**
   * Show error message
   * @private
   */
  _showError(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Update header statistics
   * @private
   */
  _updateHeaderStats() {
    const totalOffersElement = document.getElementById("totalOffers");
    const myOffersCountElement = document.getElementById("myOffersCount");
    const totalTransactionsElement =
      document.getElementById("totalTransactions");
    // const totalTransferredElement = document.getElementById('totalTransferred'); // Removed

    if (totalOffersElement && this.marketplaceStats) {
      // Show total active offers from all users
      totalOffersElement.textContent =
        this.marketplaceStats.totalActiveOffers || 0;
    }

    if (myOffersCountElement) {
      const myActiveOffers = this.myOffers.filter(
        (offer) => offer.status === "active",
      ).length;
      myOffersCountElement.textContent = myActiveOffers;
    }

    if (totalTransactionsElement && this.marketplaceStats) {
      // Show total transactions from all users
      totalTransactionsElement.textContent =
        this.marketplaceStats.totalTransactions || 0;
    }

    // Remove totalTransferredElement update
    // if (totalTransferredElement && this.marketplaceStats) {
    //   const totalVolume = this.marketplaceStats.totalVolume || 0;
    //   const formattedAmount = this._formatNumber(totalVolume);
    //   totalTransferredElement.textContent = formattedAmount;
    // }

    // Show total value from /api/v1/statistics
    const totalValueElement = document.getElementById("totalValue");
    if (totalValueElement && typeof this.totalValue !== "undefined") {
      totalValueElement.textContent = this._formatNumber(this.totalValue);
    }
  }

  /**
   * Format number with Polish locale and safe handling
   * @private
   */
  _formatNumber(num) {
    if (typeof num !== "number" || isNaN(num)) {
      return "0";
    }

    // Use Polish locale formatting with 2 decimal places
    return new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }

  /**
   * Clear data when user logs out
   * @private
   */
  _clearData() {
    this.currentUser = null;
    this.userBalance = 0;
    this.financialStats = null;
    this.marketplaceStats = null;
    this.fields = [];
    this.animals = [];
    this.offers = [];
    this.myOffers = [];
    this.transactions = [];
    this.totalValue = 0;

    // Clear UI
    document.getElementById("userBalance").textContent = "0 ROL";
    document.getElementById("browseOffers").innerHTML = "";
    document.getElementById("myOffers").innerHTML = "";
    document.getElementById("transactionsList").innerHTML = "";

    // Clear header stats
    const totalOffersElement = document.getElementById("totalOffers");
    const myOffersCountElement = document.getElementById("myOffersCount");
    const totalTransactionsElement =
      document.getElementById("totalTransactions");
    const totalValueElement = document.getElementById("totalValue");

    if (totalOffersElement) totalOffersElement.textContent = "0";
    if (myOffersCountElement) myOffersCountElement.textContent = "0";
    if (totalTransactionsElement) totalTransactionsElement.textContent = "0";
    if (totalValueElement) totalValueElement.textContent = "0,00";
  }
}

// Export for global use
window.MarketplacePage = MarketplacePage;
