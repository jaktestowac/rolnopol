class MessengerPage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.currentUser = null;
    this.friends = [];
    this.activeConversation = null;
    this.polling = {
      intervalMs: 5000,
      timerId: null,
      inFlight: false,
    };
  }

  async init(app) {
    this.authService = app.getModule("authService");
    this.apiService = app.getModule("apiService");
    this.featureFlagsService = app.getModule("featureFlagsService");

    if (!this.authService || !this.apiService || !this.featureFlagsService) {
      this._showBannerError("Messenger is currently unavailable.");
      return;
    }

    const isAuthenticated = await this.authService.waitForAuth(3000);
    if (!isAuthenticated || !this.authService.requireAuth("/login.html")) {
      return;
    }

    const isEnabled = await this._ensureFeatureEnabled();
    if (!isEnabled) {
      return;
    }

    await this._resolveCurrentUser();
    this._bindEvents();
    await this._loadFriends();
  }

  async _ensureFeatureEnabled() {
    try {
      const enabled = await this.featureFlagsService.isEnabled("messengerEnabled", false);
      if (!enabled) {
        window.location.replace("/404.html");
        return false;
      }
      return true;
    } catch (error) {
      window.location.replace("/404.html");
      return false;
    }
  }

  async _resolveCurrentUser() {
    try {
      this.currentUser = await this.authService.getCurrentUser();
    } catch (error) {
      this.currentUser = null;
    }
  }

  _bindEvents() {
    const refreshBtn = document.getElementById("refreshFriendsBtn");
    const openAddFriendModalBtn = document.getElementById("openAddFriendModalBtn");
    const closeAddFriendModalBtn = document.getElementById("closeAddFriendModalBtn");
    const addFriendModalOverlay = document.getElementById("addFriendModalOverlay");
    const addFriendForm = document.getElementById("addFriendForm");
    const messageForm = document.getElementById("messageForm");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this._loadFriends());
    }

    if (openAddFriendModalBtn) {
      openAddFriendModalBtn.addEventListener("click", () => this._openAddFriendModal());
    }

    if (closeAddFriendModalBtn) {
      closeAddFriendModalBtn.addEventListener("click", () => this._closeAddFriendModal());
    }

    if (addFriendModalOverlay) {
      addFriendModalOverlay.addEventListener("click", () => this._closeAddFriendModal());
    }

    if (addFriendForm) {
      addFriendForm.addEventListener("submit", (event) => this._handleAddFriend(event));
    }

    if (messageForm) {
      messageForm.addEventListener("submit", (event) => this._handleSendMessage(event));
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._stopPolling();
      } else if (this.activeConversation) {
        this._startPolling();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this._closeAddFriendModal();
      }
    });
  }

  async _loadFriends() {
    this._setFriendsState({ loading: true, error: false, empty: false });

    try {
      const response = await this.apiService.get("users/friends", {
        requiresAuth: true,
      });

      if (!response.success) {
        throw new Error(response.error || "Failed to load friends");
      }

      const list = response?.data?.data;
      this.friends = Array.isArray(list) ? list : [];
      this._renderFriends();

      this._setFriendsState({
        loading: false,
        error: false,
        empty: this.friends.length === 0,
      });
    } catch (error) {
      this.friends = [];
      this._renderFriends();
      this._setFriendsState({ loading: false, error: true, empty: false });
    }
  }

  _renderFriends() {
    const listEl = document.getElementById("friendsList");
    if (!listEl) {
      return;
    }

    listEl.innerHTML = "";
    this.friends.forEach((friend) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const isBlocked = !!(friend?.isBlocked || friend?.blocked === true);
      const isActive = this.activeConversation && Number(this.activeConversation.id) === Number(friend.id);
      const displayName = friend.displayedName || friend.username || friend.email || `User #${friend.id}`;
      const subtitle = friend.username || friend.email || `ID: ${friend.id}`;

      button.type = "button";
      button.className = `messenger-list__item${isActive ? " messenger-list__item--active" : ""}`;
      button.setAttribute("aria-label", `Open chat with ${displayName}`);
      button.innerHTML = `
        <strong>${this._escapeHtml(displayName)}</strong>
        <span class="messenger-list__meta">${this._escapeHtml(subtitle)}</span>
        ${isBlocked ? '<span class="messenger-list__badge">Blocked</span>' : ""}
      `;
      button.addEventListener("click", () => this._selectConversation(friend));

      item.appendChild(button);
      listEl.appendChild(item);
    });
  }

  _selectConversation(friend) {
    this.activeConversation = friend;
    this._renderFriends();
    this._renderActiveConversation();
    this._startPolling();
  }

  _renderActiveConversation() {
    const titleEl = document.getElementById("activeChatTitle");
    const statusEl = document.getElementById("activeChatStatus");
    const emptyEl = document.getElementById("chatEmpty");
    const messageList = document.getElementById("messageList");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendMessageBtn");

    if (!this.activeConversation) {
      if (titleEl) {
        titleEl.innerHTML = '<i class="fas fa-comment-dots"></i> Select a friend';
      }
      if (statusEl) {
        statusEl.textContent = "No active conversation";
      }
      if (emptyEl) {
        emptyEl.hidden = false;
      }
      if (messageList) {
        messageList.innerHTML = "";
      }
      if (messageInput) {
        messageInput.disabled = true;
      }
      if (sendBtn) {
        sendBtn.disabled = true;
      }
      return;
    }

    const displayName =
      this.activeConversation.displayedName ||
      this.activeConversation.username ||
      this.activeConversation.email ||
      `User #${this.activeConversation.id}`;
    const isBlocked = !!(this.activeConversation?.isBlocked || this.activeConversation?.blocked === true);

    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-comment-dots"></i> ${this._escapeHtml(displayName)}`;
    }
    if (statusEl) {
      statusEl.textContent = isBlocked ? "Blocked conversation" : "Ready to chat";
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }

    if (messageList) {
      messageList.innerHTML = `
        <li class="messenger-message">
          No messages yet. Start the conversation with ${this._escapeHtml(displayName)}.
          <span class="messenger-message__meta">Just now</span>
        </li>
      `;
    }

    if (messageInput) {
      messageInput.disabled = isBlocked;
      messageInput.placeholder = isBlocked ? "Chat disabled: this user is blocked." : "Type your message...";
      if (!isBlocked) {
        messageInput.focus();
      }
    }
    if (sendBtn) {
      sendBtn.disabled = isBlocked;
    }
  }

  async _handleAddFriend(event) {
    event.preventDefault();
    const input = document.getElementById("friendIdentifier");
    if (!input) {
      return;
    }

    const identifier = input.value.trim();
    if (!identifier) {
      this._setAddFriendFeedback("Provide username or email.", "error");
      return;
    }

    try {
      this._setAddFriendFeedback("");
      const response = await this.apiService.post("users/friends", { identifier }, { requiresAuth: true });

      if (!response.success) {
        this._setAddFriendFeedback(response.error || "Unable to add friend.", "error");
        return;
      }

      input.value = "";
      this._setAddFriendFeedback("Friend added.", "success");
      this._showNotification("Friend added.", "success");
      await this._loadFriends();
      window.setTimeout(() => this._closeAddFriendModal(), 500);
    } catch (error) {
      this._setAddFriendFeedback("Unable to add friend.", "error");
    }
  }

  _handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById("messageInput");

    if (!input || input.disabled || !this.activeConversation) {
      return;
    }

    const content = input.value.trim();
    if (!content) {
      return;
    }

    this._showNotification("Messaging API is not available yet (planned in FR-5).", "info");
    input.value = "";
  }

  _setFriendsState({ loading, error, empty }) {
    const loadingEl = document.getElementById("friendsLoading");
    const errorEl = document.getElementById("friendsError");
    const emptyEl = document.getElementById("friendsEmpty");

    if (loadingEl) {
      loadingEl.hidden = !loading;
    }
    if (errorEl) {
      errorEl.hidden = !error;
    }
    if (emptyEl) {
      emptyEl.hidden = !empty;
    }
  }

  _showBannerError(message) {
    const chatError = document.getElementById("chatError");
    if (chatError) {
      chatError.hidden = false;
      chatError.textContent = message;
    }
  }

  _openAddFriendModal() {
    const modal = document.getElementById("addFriendModal");
    const input = document.getElementById("friendIdentifier");

    if (!modal) {
      return;
    }

    this._setAddFriendFeedback("");
    modal.hidden = false;

    if (input) {
      window.setTimeout(() => input.focus(), 20);
    }
  }

  _closeAddFriendModal() {
    const modal = document.getElementById("addFriendModal");
    const input = document.getElementById("friendIdentifier");

    if (!modal || modal.hidden) {
      return;
    }

    modal.hidden = true;
    this._setAddFriendFeedback("");
    if (input) {
      input.value = "";
    }
  }

  _setAddFriendFeedback(message, type = "") {
    const feedbackEl = document.getElementById("addFriendFeedback");
    if (!feedbackEl) {
      return;
    }

    if (!message) {
      feedbackEl.hidden = true;
      feedbackEl.textContent = "";
      feedbackEl.className = "messenger-inline-feedback";
      return;
    }

    feedbackEl.hidden = false;
    feedbackEl.textContent = message;
    feedbackEl.className = `messenger-inline-feedback${type ? ` messenger-inline-feedback--${type}` : ""}`;
  }

  _showNotification(message, type = "info") {
    if (typeof window.showNotification === "function") {
      window.showNotification(message, type, 4000);
      return;
    }
    if (type === "error") {
      console.error(message);
    } else {
      console.info(message);
    }
  }

  _startPolling() {
    if (!this.activeConversation || document.hidden) {
      return;
    }

    this._stopPolling();
    this.polling.timerId = window.setInterval(() => {
      this._pollActiveConversation();
    }, this.polling.intervalMs);
  }

  _stopPolling() {
    if (this.polling.timerId) {
      window.clearInterval(this.polling.timerId);
      this.polling.timerId = null;
    }
  }

  async _pollActiveConversation() {
    if (!this.activeConversation || this.polling.inFlight || document.hidden) {
      return;
    }

    this.polling.inFlight = true;
    try {
      // FR-2.2 shell for future transport integration.
      // Replace with GET /messages/poll in FR-5 without changing UI wiring.
      return;
    } finally {
      this.polling.inFlight = false;
    }
  }

  _escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

window.MessengerPage = MessengerPage;
