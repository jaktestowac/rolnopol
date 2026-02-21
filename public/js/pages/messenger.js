class MessengerPage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.currentUser = null;
    this.friends = [];
    this.activeConversation = null;
    this.messages = [];
    this.lastMessageCursor = null;
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
    const toggleBlockBtn = document.getElementById("toggleBlockBtn");

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

    if (toggleBlockBtn) {
      toggleBlockBtn.addEventListener("click", () => this._handleToggleBlock());
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

      if (this.activeConversation) {
        const refreshed = this.friends.find((friend) => Number(friend.id) === Number(this.activeConversation.id));
        if (refreshed) {
          this.activeConversation = refreshed;
        }
      }

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

  async _selectConversation(friend) {
    this.activeConversation = friend;
    this.messages = [];
    this.lastMessageCursor = null;
    this._renderFriends();
    this._renderActiveConversation();
    await this._loadConversation(friend.id);
    this._startPolling(true);
  }

  _renderActiveConversation() {
    const titleEl = document.getElementById("activeChatTitle");
    const statusEl = document.getElementById("activeChatStatus");
    const emptyEl = document.getElementById("chatEmpty");
    const messageList = document.getElementById("messageList");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendMessageBtn");
    const toggleBlockBtn = document.getElementById("toggleBlockBtn");

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
      if (toggleBlockBtn) {
        toggleBlockBtn.disabled = true;
        toggleBlockBtn.innerHTML = '<i class="fas fa-ban"></i> Block';
      }
      return;
    }

    const displayName =
      this.activeConversation.displayedName ||
      this.activeConversation.username ||
      this.activeConversation.email ||
      `User #${this.activeConversation.id}`;
    const isBlocked = !!this._isConversationBlocked(this.activeConversation);

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
      if (this.messages.length === 0) {
        messageList.innerHTML = `
          <li class="messenger-message">
            No messages yet. Start the conversation with ${this._escapeHtml(displayName)}.
            <span class="messenger-message__meta">Now</span>
          </li>
        `;
      } else {
        this._renderMessages();
      }
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

    if (toggleBlockBtn) {
      toggleBlockBtn.disabled = false;
      if (this.activeConversation?.blockedByYou === true) {
        toggleBlockBtn.innerHTML = '<i class="fas fa-lock-open"></i> Unblock';
      } else {
        toggleBlockBtn.innerHTML = '<i class="fas fa-ban"></i> Block';
      }
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

  async _handleSendMessage(event) {
    event.preventDefault();
    const input = document.getElementById("messageInput");

    if (!input || input.disabled || !this.activeConversation) {
      return;
    }

    const content = input.value.trim();
    if (!content) {
      return;
    }

    try {
      const response = await this.apiService.post(
        "messages",
        {
          toUserId: Number(this.activeConversation.id),
          content,
        },
        { requiresAuth: true },
      );

      if (!response.success || !response?.data?.success) {
        this._showNotification(response?.data?.error || response.error || "Failed to send message.", "error");
        return;
      }

      const createdMessage = response?.data?.data;
      if (createdMessage && createdMessage.id) {
        this.messages = [...this.messages.filter((message) => Number(message.id) !== Number(createdMessage.id)), createdMessage].sort(
          (left, right) => this._compareMessages(left, right),
        );
        this.lastMessageCursor = createdMessage.id;
        this._renderMessages(true);
      }

      input.value = "";
    } catch (error) {
      this._showNotification("Failed to send message.", "error");
    }
  }

  async _loadConversation(withUserId) {
    const chatLoading = document.getElementById("chatLoading");
    const chatError = document.getElementById("chatError");

    if (chatLoading) {
      chatLoading.hidden = false;
    }
    if (chatError) {
      chatError.hidden = true;
    }

    try {
      const response = await this.apiService.get(`messages/conversations/${Number(withUserId)}?limit=100`, {
        requiresAuth: true,
      });

      if (!response.success || !response?.data?.success) {
        throw new Error(response?.data?.error || response.error || "Failed to load conversation");
      }

      const payload = response.data.data || {};
      const blocked = payload.blocked || {};
      this.messages = Array.isArray(payload.messages) ? payload.messages : [];
      this.lastMessageCursor = this.messages.length > 0 ? this.messages[this.messages.length - 1].id : null;

      if (this.activeConversation) {
        this.activeConversation.blockedByYou = blocked.blockedByYou === true;
        this.activeConversation.blockedByThem = blocked.blockedByUser === true;
        this.activeConversation.isBlocked = this.activeConversation.blockedByYou || this.activeConversation.blockedByThem;
      }

      this._renderActiveConversation();
      this._renderMessages(true);
    } catch (error) {
      if (chatError) {
        chatError.hidden = false;
        chatError.textContent = "Unable to load conversation.";
      }
      this.messages = [];
      this._renderActiveConversation();
    } finally {
      if (chatLoading) {
        chatLoading.hidden = true;
      }
    }
  }

  _renderMessages(scrollToEnd = false) {
    const messageList = document.getElementById("messageList");
    if (!messageList) {
      return;
    }

    messageList.innerHTML = "";

    for (const message of this.messages) {
      const item = document.createElement("li");
      const isOwn = Number(message.fromUserId) === Number(this.currentUser?.id);
      item.className = `messenger-message${isOwn ? " messenger-message--own" : ""}`;

      item.innerHTML = `
        <span>${this._escapeHtml(message.content || "")}</span>
        <span class="messenger-message__meta">${this._escapeHtml(this._formatTimestamp(message.createdAt))}</span>
      `;

      messageList.appendChild(item);
    }

    if (scrollToEnd) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  async _handleToggleBlock() {
    if (!this.activeConversation) {
      return;
    }

    const targetId = Number(this.activeConversation.id);
    const blockedByYou = this.activeConversation.blockedByYou === true;

    try {
      if (blockedByYou) {
        const response = await this.apiService.delete(`users/blocked/${targetId}`, { requiresAuth: true });
        if (!response.success || !response?.data?.success) {
          this._showNotification(response?.data?.error || response.error || "Unable to unblock user.", "error");
          return;
        }
      } else {
        const response = await this.apiService.post(
          "users/blocked",
          {
            userId: targetId,
          },
          { requiresAuth: true },
        );
        if (!response.success || !response?.data?.success) {
          this._showNotification(response?.data?.error || response.error || "Unable to block user.", "error");
          return;
        }
      }

      await this._loadFriends();
      if (this.activeConversation) {
        await this._loadConversation(this.activeConversation.id);
      }
      this._showNotification(blockedByYou ? "User unblocked." : "User blocked.", "success");
    } catch (error) {
      this._showNotification("Unable to update block status.", "error");
    }
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

  _startPolling(runImmediately = false) {
    if (!this.activeConversation || document.hidden) {
      return;
    }

    this._stopPolling();

    if (runImmediately) {
      this._pollActiveConversation();
    }

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
      const withUserId = Number(this.activeConversation.id);
      const sinceQuery = this.lastMessageCursor ? `&since=${encodeURIComponent(this.lastMessageCursor)}` : "";
      const response = await this.apiService.get(`messages/poll?withUserId=${withUserId}${sinceQuery}`, {
        requiresAuth: true,
      });

      if (!response.success || !response?.data?.success) {
        return;
      }

      const payload = response.data.data || {};
      const incoming = Array.isArray(payload.messages) ? payload.messages : [];
      if (incoming.length === 0) {
        return;
      }

      const byId = new Map(this.messages.map((message) => [Number(message.id), message]));
      for (const message of incoming) {
        byId.set(Number(message.id), message);
      }

      this.messages = Array.from(byId.values()).sort((left, right) => this._compareMessages(left, right));
      const latest = this.messages[this.messages.length - 1];
      this.lastMessageCursor = latest ? latest.id : this.lastMessageCursor;
      this._renderMessages(true);
    } finally {
      this.polling.inFlight = false;
    }
  }

  _compareMessages(left, right) {
    const leftTs = Date.parse(left?.createdAt || 0) || 0;
    const rightTs = Date.parse(right?.createdAt || 0) || 0;

    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }

    return Number(left?.id || 0) - Number(right?.id || 0);
  }

  _isConversationBlocked(conversation) {
    if (!conversation) {
      return false;
    }

    const blockedByYou = conversation.blockedByYou === true;
    const blockedByThem = conversation.blockedByThem === true;
    return blockedByYou || blockedByThem || conversation.isBlocked === true || conversation.blocked === true;
  }

  _formatTimestamp(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString();
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
