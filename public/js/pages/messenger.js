class MessengerPage {
  constructor() {
    this.maxMessageLength = 1024;
    this.emojiShortcodes = {
      smile: "😄",
      grinning: "😀",
      grin: "😁",
      blush: "😊",
      joy: "😂",
      laugh: "😂",
      wink: "😉",
      sweat_smile: "😅",
      rofl: "🤣",
      upside_down: "🙃",
      melting: "🫠",
      sad: "😢",
      cry: "😭",
      sob: "😭",
      disappointed: "😞",
      worried: "😟",
      frown: "☹️",
      angry: "😠",
      rage: "😡",
      neutral: "😐",
      expressionless: "😑",
      thinking_face: "🤔",
      heart: "❤️",
      broken_heart: "💔",
      sparkling_heart: "💖",
      yellow_heart: "💛",
      green_heart: "💚",
      blue_heart: "💙",
      purple_heart: "💜",
      black_heart: "🖤",
      white_heart: "🤍",
      orange_heart: "🧡",
      gift_heart: "💝",
      thumbsup: "👍",
      thumbsdown: "👎",
      fist: "✊",
      punch: "👊",
      victory: "✌️",
      peace: "✌️",
      wave_hand: "👋",
      ok_hand: "👌",
      clap: "👏",
      pray: "🙏",
      point_up: "☝️",
      point_down: "👇",
      point_left: "👈",
      point_right: "👉",
      muscle: "💪",
      fire: "🔥",
      party: "🥳",
      thinking: "🤔",
      sleeping: "😴",
      dizzy: "😵",
      mind_blown: "🤯",
      sunglasses: "😎",
      nerd: "🤓",
      star_struck: "🤩",
      heart_eyes: "😍",
      kissing_heart: "😘",
      kiss: "😗",
      hugging: "🤗",
      smirk: "😏",
      monocle: "🧐",
      raised_eyebrow: "🤨",
      pleading: "🥺",
      scream: "😱",
      grimacing: "😬",
      yawn: "🥱",
      poop: "💩",
      skull: "💀",
      ghost: "👻",
      robot: "🤖",
      alien: "👽",
      cat: "🐱",
      dog: "🐶",
      mouse: "🐭",
      rabbit: "🐰",
      bear: "🐻",
      panda: "🐼",
      fox: "🦊",
      lion: "🦁",
      tiger: "🐯",
      monkey: "🐵",
      chicken: "🐔",
      penguin: "🐧",
      bird: "🐦",
      frog: "🐸",
      unicorn: "🦄",
      bee: "🐝",
      butterfly: "🦋",
      flower: "🌸",
      rose: "🌹",
      sunflower: "🌻",
      tree: "🌳",
      leaf: "🍃",
      clover: "🍀",
      sun: "☀️",
      moon: "🌙",
      star: "⭐",
      comet: "☄️",
      rainbow: "🌈",
      cloud: "☁️",
      rain: "🌧️",
      snow: "❄️",
      lightning: "⚡",
      boom: "💥",
      water: "💧",
      coffee: "☕",
      tea: "🍵",
      pizza: "🍕",
      burger: "🍔",
      fries: "🍟",
      taco: "🌮",
      sushi: "🍣",
      ramen: "🍜",
      cake: "🍰",
      donut: "🍩",
      cookie: "🍪",
      apple: "🍎",
      banana: "🍌",
      grape: "🍇",
      strawberry: "🍓",
      peach: "🍑",
      cherry: "🍒",
      football: "⚽",
      basketball: "🏀",
      baseball: "⚾",
      tennis: "🎾",
      volleyball: "🏐",
      trophy: "🏆",
      medal: "🏅",
      game: "🎮",
      music: "🎵",
      guitar: "🎸",
      drum: "🥁",
      camera: "📷",
      phone: "📱",
      laptop: "💻",
      bulb: "💡",
      lock: "🔒",
      key: "🔑",
      hammer: "🔨",
      wrench: "🔧",
      magnet: "🧲",
      money: "💰",
      coin: "🪙",
      chart_up: "📈",
      chart_down: "📉",
      warning: "⚠️",
      check: "✅",
      cross: "❌",
      question: "❓",
      exclamation: "❗",
      bell: "🔔",
      hourglass: "⌛",
      globe: "🌍",
      pin: "📍",
      plane: "✈️",
      car: "🚗",
      bike: "🚲",
      train: "🚆",
      ship: "🚢",
      rocket_ship: "🚀",
      rocket: "🚀",
      wave: "👋",
    };
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.currentUser = null;
    this.friends = [];
    this.activeConversation = null;
    this.messages = [];
    this.lastMessageCursor = null;
    this.pendingOutgoing = new Map();
    this.unreadSyncTimerId = null;
    this.currentConversationRequestId = 0;
    this.unreadState = {
      total: 0,
      byUserId: new Map(),
    };
    this.socket = {
      instance: null,
      connected: false,
      reconnectAttempts: 0,
      reconnectTimerId: null,
      heartbeatTimerId: null,
      manualClose: false,
      lastWarningAt: 0,
    };
    this.polling = {
      intervalMs: 7000,
      timerId: null,
      inFlight: false,
    };
    this.emojiPopupState = {
      open: false,
      mode: "none",
      suggestions: [],
      selectedIndex: 0,
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
    this._ensureSocketConnected();
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
    const emojiPickerBtn = document.getElementById("emojiPickerBtn");
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

    if (emojiPickerBtn) {
      emojiPickerBtn.addEventListener("click", (event) => this._handleEmojiTriggerClick(event));
    }

    const messageInput = document.getElementById("messageInput");
    if (messageInput) {
      messageInput.addEventListener("keydown", (event) => this._handleMessageInputKeydown(event));
      messageInput.addEventListener("input", () => {
        this._replaceCompletedShortcodesInInput();
        this._updateShortcodeAutocomplete();
      });
      messageInput.addEventListener("click", () => this._updateShortcodeAutocomplete());
      messageInput.addEventListener("keyup", (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
          this._updateShortcodeAutocomplete();
        }
      });
    }

    const emojiPopup = document.getElementById("emojiPopup");
    if (emojiPopup) {
      emojiPopup.addEventListener("click", (event) => this._handleEmojiPopupClick(event));
    }

    this._hideEmojiPopup();

    if (toggleBlockBtn) {
      toggleBlockBtn.addEventListener("click", () => this._handleToggleBlock());
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._closeSocket(true);
        this._stopPolling();
      } else {
        this._ensureSocketConnected();
        if (this.activeConversation) {
          this._startPolling();
        }
      }
    });

    window.addEventListener("beforeunload", () => {
      this._closeAddFriendModal();
      this._closeSocket(true);
      this._stopPolling();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this._closeAddFriendModal();
        this._hideEmojiPopup();
      }
    });

    document.addEventListener("click", (event) => {
      const popup = document.getElementById("emojiPopup");
      const trigger = document.getElementById("emojiPickerBtn");
      const messageInput = document.getElementById("messageInput");
      const target = event?.target;

      if (!popup || popup.hidden) {
        return;
      }

      const clickedInsidePopup = popup.contains(target);
      const clickedTrigger = trigger ? trigger.contains(target) : false;
      const clickedInput = messageInput ? messageInput.contains(target) : false;

      if (!clickedInsidePopup && !clickedTrigger && !clickedInput) {
        this._hideEmojiPopup();
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
      await this._loadConversationSummaries();

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
      const unreadCount = this._getUnreadCountForUser(friend.id);

      button.type = "button";
      button.className = `messenger-list__item${isActive ? " messenger-list__item--active" : ""}`;
      button.setAttribute("aria-label", `Open chat with ${displayName}`);
      button.innerHTML = `
        <strong>${this._escapeHtml(displayName)}</strong>
        <span class="messenger-list__meta">${this._escapeHtml(subtitle)}</span>
        ${unreadCount > 0 ? `<span class="messenger-list__badge">${unreadCount} unread</span>` : ""}
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
    this._setUnreadCount(friend.id, 0);
    this._renderFriends();
    this._renderActiveConversation();
    await this._loadConversation(friend.id);
    this._ensureSocketConnected();
    this._startPolling(true);
  }

  _renderActiveConversation() {
    const titleEl = document.getElementById("activeChatTitle");
    const statusEl = document.getElementById("activeChatStatus");
    const emptyEl = document.getElementById("chatEmpty");
    const messageList = document.getElementById("messageList");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendMessageBtn");
    const emojiPickerBtn = document.getElementById("emojiPickerBtn");
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
      if (emojiPickerBtn) {
        emojiPickerBtn.disabled = true;
      }
      this._hideEmojiPopup();
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
    const conversationUnread = this._getUnreadCountForUser(this.activeConversation.id);

    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-comment-dots"></i> ${this._escapeHtml(displayName)}`;
    }
    if (statusEl) {
      statusEl.textContent = isBlocked
        ? "Blocked conversation"
        : conversationUnread > 0
          ? `Ready to chat · ${conversationUnread} unread`
          : "Ready to chat";
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
    if (emojiPickerBtn) {
      emojiPickerBtn.disabled = isBlocked;
    }
    if (isBlocked) {
      this._hideEmojiPopup();
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

    if (!this._isActiveConversationValid()) {
      this._showNotification("Conversation is no longer available.", "error");
      return;
    }

    const rawContent = input.value.trim();
    const content = this._convertShortcodesToEmoji(rawContent);
    if (!content) {
      return;
    }

    if (content.length > this.maxMessageLength) {
      this._showNotification(`Message too long (max ${this.maxMessageLength} chars).`, "error");
      return;
    }

    const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const sentViaSocket = this._sendSocketMessage("send_message", {
        toUserId: Number(this.activeConversation.id),
        content,
        clientMessageId,
      });

      if (sentViaSocket) {
        const timeoutId = window.setTimeout(() => {
          if (this.pendingOutgoing.has(clientMessageId)) {
            this.pendingOutgoing.delete(clientMessageId);
            this._showNotification("Message delivery timed out.", "error");
          }
        }, 60000);

        this.pendingOutgoing.set(clientMessageId, {
          content,
          createdAt: Date.now(),
          timeoutId,
        });
        input.value = "";
        this._hideEmojiPopup();
        return;
      }

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
      this._hideEmojiPopup();
    } catch (error) {
      this._showNotification("Failed to send message.", "error");
    }
  }

  _handleMessageInputKeydown(event) {
    if (this.emojiPopupState.open && this.emojiPopupState.suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this._moveEmojiSelectionByDirection("down");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this._moveEmojiSelectionByDirection("up");
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        this._moveEmojiSelectionByDirection("right");
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this._moveEmojiSelectionByDirection("left");
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        this._hideEmojiPopup();
        return;
      }

      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const selected = this.emojiPopupState.suggestions[this.emojiPopupState.selectedIndex];
        if (selected) {
          event.preventDefault();
          this._applyEmojiSuggestion(selected.shortcode, this.emojiPopupState.mode);
          return;
        }
      }
    }

    // Enter alone sends the message
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this._handleSendMessage(new Event("submit", { bubbles: true }));
      return;
    }

    // Shift+Enter or Ctrl+Enter (or Cmd+Enter on Mac) inserts newline
    if (event.key === "Enter" && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      // Allow browser default behavior to insert newline
      return;
    }
  }

  _handleEmojiTriggerClick(event) {
    event.preventDefault();
    const messageInput = document.getElementById("messageInput");
    if (!messageInput || messageInput.disabled) {
      return;
    }

    if (this.emojiPopupState.open && this.emojiPopupState.mode === "picker") {
      this._hideEmojiPopup();
      return;
    }

    this._showEmojiPopup("", "picker");
    messageInput.focus();
  }

  _handleEmojiPopupClick(event) {
    const target = event?.target;
    if (!target) {
      return;
    }

    const option = target.closest("button[data-emoji-shortcode]");
    if (!option) {
      return;
    }

    event.preventDefault();
    const shortcode = String(option.dataset.emojiShortcode || "").trim();
    if (!shortcode) {
      return;
    }

    this._applyEmojiSuggestion(shortcode, this.emojiPopupState.mode);
  }

  _applyEmojiSuggestion(shortcode, mode = "picker") {
    const messageInput = document.getElementById("messageInput");
    if (!messageInput || messageInput.disabled) {
      return;
    }

    const normalizedShortcode = String(shortcode || "")
      .trim()
      .toLowerCase();
    if (!normalizedShortcode) {
      return;
    }

    if (mode === "autocomplete") {
      const context = this._getActiveShortcodeContext(messageInput);
      if (!context) {
        this._insertTextAtCursor(messageInput, `:${normalizedShortcode}: `);
      } else {
        const replacement = `:${normalizedShortcode}: `;
        messageInput.value = `${messageInput.value.slice(0, context.start)}${replacement}${messageInput.value.slice(context.end)}`;
        const nextCursor = context.start + replacement.length;
        messageInput.selectionStart = nextCursor;
        messageInput.selectionEnd = nextCursor;
      }
    } else {
      const pickedEmoji = this.emojiShortcodes[normalizedShortcode] || `:${normalizedShortcode}:`;
      this._insertTextAtCursor(messageInput, `${pickedEmoji} `);
    }

    this._hideEmojiPopup();
    messageInput.focus();
  }

  _getActiveShortcodeContext(messageInput) {
    if (!messageInput || typeof messageInput.value !== "string") {
      return null;
    }

    const value = messageInput.value;
    const caret = Number.isInteger(messageInput.selectionStart) ? messageInput.selectionStart : value.length;
    const beforeCaret = value.slice(0, caret);
    const match = beforeCaret.match(/(^|\s):([a-z0-9_+-]*)$/i);

    if (!match) {
      return null;
    }

    const start = caret - match[0].length + match[1].length;
    return {
      start,
      end: caret,
      query: String(match[2] || "").toLowerCase(),
    };
  }

  _updateShortcodeAutocomplete() {
    const messageInput = document.getElementById("messageInput");
    if (!messageInput || messageInput.disabled) {
      this._hideEmojiPopup();
      return;
    }

    const context = this._getActiveShortcodeContext(messageInput);
    if (!context) {
      if (this.emojiPopupState.mode === "autocomplete") {
        this._hideEmojiPopup();
      }
      return;
    }

    this._showEmojiPopup(context.query, "autocomplete");
  }

  _showEmojiPopup(query = "", mode = "picker") {
    const popup = document.getElementById("emojiPopup");
    if (!popup) {
      return;
    }

    const normalizedQuery = String(query || "").toLowerCase();
    const allSuggestions = Object.entries(this.emojiShortcodes).map(([shortcode, emoji]) => ({ shortcode, emoji }));
    const filtered = allSuggestions
      .filter((entry) => (normalizedQuery ? entry.shortcode.startsWith(normalizedQuery) : true))
      .sort((left, right) => left.shortcode.localeCompare(right.shortcode));

    const visibleSuggestions = mode === "autocomplete" ? filtered.slice(0, 12) : filtered;

    if (visibleSuggestions.length === 0) {
      this._hideEmojiPopup();
      return;
    }

    this.emojiPopupState.open = true;
    this.emojiPopupState.mode = mode;
    this.emojiPopupState.suggestions = visibleSuggestions;
    this.emojiPopupState.selectedIndex = 0;

    const optionsHtml = visibleSuggestions
      .map((entry, index) => {
        const isSelected = index === this.emojiPopupState.selectedIndex;
        const ariaLabel = `:${entry.shortcode}: ${entry.emoji}`;
        return `
          <button
            type="button"
            class="messenger-emoji-popup__item${isSelected ? " messenger-emoji-popup__item--active" : ""}"
            data-emoji-shortcode="${this._escapeHtml(entry.shortcode)}"
            role="option"
            title=":${this._escapeHtml(entry.shortcode)}:"
            aria-label="${this._escapeHtml(ariaLabel)}"
            aria-selected="${isSelected ? "true" : "false"}"
          >
            <span class="messenger-emoji-popup__icon">${entry.emoji}</span>
          </button>
        `;
      })
      .join("");

    popup.innerHTML = optionsHtml;
    popup.hidden = false;
    popup.dataset.mode = mode;
  }

  _moveEmojiSelection(delta) {
    if (!this.emojiPopupState.open || this.emojiPopupState.suggestions.length === 0) {
      return;
    }

    const count = this.emojiPopupState.suggestions.length;
    const current = this.emojiPopupState.selectedIndex;
    const next = (current + delta + count) % count;
    this.emojiPopupState.selectedIndex = next;
    this._updateEmojiPopupSelection();
  }

  _moveEmojiSelectionByDirection(direction) {
    if (!this.emojiPopupState.open || this.emojiPopupState.suggestions.length === 0) {
      return;
    }

    const count = this.emojiPopupState.suggestions.length;
    const current = this.emojiPopupState.selectedIndex;

    if (direction === "left") {
      this._moveEmojiSelection(-1);
      return;
    }

    if (direction === "right") {
      this._moveEmojiSelection(1);
      return;
    }

    const columns = this._getEmojiGridColumns();
    const safeColumns = Math.max(1, columns);
    const totalRows = Math.ceil(count / safeColumns);
    const currentRow = Math.floor(current / safeColumns);
    const currentCol = current % safeColumns;

    let targetRow = currentRow;
    if (direction === "up") {
      targetRow = (currentRow - 1 + totalRows) % totalRows;
    } else if (direction === "down") {
      targetRow = (currentRow + 1) % totalRows;
    }

    let next = targetRow * safeColumns + currentCol;
    if (next >= count) {
      next = count - 1;
    }

    this.emojiPopupState.selectedIndex = next;
    this._updateEmojiPopupSelection();
  }

  _getEmojiGridColumns() {
    const popup = document.getElementById("emojiPopup");
    if (!popup || popup.hidden) {
      return 1;
    }

    const options = popup.querySelectorAll(".messenger-emoji-popup__item");
    if (!options || options.length === 0) {
      return 1;
    }

    const firstTop = options[0].offsetTop;
    let columns = 0;
    for (const option of options) {
      if (option.offsetTop !== firstTop) {
        break;
      }
      columns += 1;
    }

    return Math.max(1, columns);
  }

  _updateEmojiPopupSelection() {
    const popup = document.getElementById("emojiPopup");
    if (!popup || popup.hidden) {
      return;
    }

    const options = popup.querySelectorAll(".messenger-emoji-popup__item");
    options.forEach((option, index) => {
      const isSelected = index === this.emojiPopupState.selectedIndex;
      option.classList.toggle("messenger-emoji-popup__item--active", isSelected);
      option.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected) {
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  _hideEmojiPopup() {
    const popup = document.getElementById("emojiPopup");
    if (popup) {
      popup.hidden = true;
      popup.innerHTML = "";
      popup.dataset.mode = "none";
    }

    this.emojiPopupState.open = false;
    this.emojiPopupState.mode = "none";
    this.emojiPopupState.suggestions = [];
    this.emojiPopupState.selectedIndex = 0;
  }

  _insertTextAtCursor(input, textToInsert) {
    if (!input || typeof input.value !== "string") {
      return;
    }

    const value = input.value;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : value.length;

    input.value = `${value.slice(0, start)}${textToInsert}${value.slice(end)}`;
    const nextCursor = start + textToInsert.length;
    input.selectionStart = nextCursor;
    input.selectionEnd = nextCursor;
  }

  _replaceCompletedShortcodesInInput() {
    const input = document.getElementById("messageInput");
    if (!input || input.disabled || typeof input.value !== "string") {
      return;
    }

    const value = input.value;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;

    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

    const replacedBefore = this._replaceShortcodesInText(before);
    const replacedSelected = this._replaceShortcodesInText(selected);
    const replacedAfter = this._replaceShortcodesInText(after);
    const replacedValue = `${replacedBefore}${replacedSelected}${replacedAfter}`;

    if (replacedValue === value) {
      return;
    }

    input.value = replacedValue;
    input.selectionStart = replacedBefore.length;
    input.selectionEnd = replacedBefore.length + replacedSelected.length;
  }

  async _loadConversation(withUserId) {
    const requestedUserId = Number(withUserId);
    this.currentConversationRequestId += 1;
    const requestId = this.currentConversationRequestId;

    const chatLoading = document.getElementById("chatLoading");
    const chatError = document.getElementById("chatError");

    if (chatLoading) {
      chatLoading.hidden = false;
    }
    if (chatError) {
      chatError.hidden = true;
    }

    try {
      const response = await this.apiService.get(`messages/conversations/${requestedUserId}?limit=100`, {
        requiresAuth: true,
      });

      const isStaleRequest =
        requestId !== this.currentConversationRequestId ||
        !this.activeConversation ||
        Number(this.activeConversation.id) !== requestedUserId;
      if (isStaleRequest) {
        return;
      }

      if (!response.success || !response?.data?.success) {
        throw new Error(response?.data?.error || response.error || "Failed to load conversation");
      }

      const payload = response.data.data || {};
      const blocked = payload.blocked || {};
      this.messages = Array.isArray(payload.messages) ? payload.messages : [];
      this.lastMessageCursor = this.messages.length > 0 ? this.messages[this.messages.length - 1].id : null;
      this._applyUnreadPayload(payload.unread, requestedUserId);

      if (this.activeConversation) {
        this.activeConversation.blockedByYou = blocked.blockedByYou === true;
        this.activeConversation.blockedByThem = blocked.blockedByUser === true;
        this.activeConversation.isBlocked = this.activeConversation.blockedByYou || this.activeConversation.blockedByThem;
      }

      this._renderActiveConversation();
      this._renderMessages(true);
      this._subscribeActiveConversation();
    } catch (error) {
      const isStaleRequest =
        requestId !== this.currentConversationRequestId ||
        !this.activeConversation ||
        Number(this.activeConversation.id) !== requestedUserId;
      if (isStaleRequest) {
        return;
      }

      if (chatError) {
        chatError.hidden = false;
        chatError.textContent = "Unable to load conversation.";
      }
      this.messages = [];
      this._renderActiveConversation();
    } finally {
      if (chatLoading && requestId === this.currentConversationRequestId) {
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
      item.dataset.messageId = String(Number(message.id));
      item.className = `messenger-message${isOwn ? " messenger-message--own" : ""}`;
      const statusHtml = this._formatMessageStatus(message, isOwn);
      const timestampText = this._formatTimestamp(message.createdAt);
      const metaText = statusHtml ? `${timestampText} · ${statusHtml}` : timestampText;
      const messageContent = this._formatMessageContent(message.content || "");

      item.innerHTML = `
        <span>${messageContent}</span>
        <span class="messenger-message__meta">${metaText}</span>
      `;

      messageList.appendChild(item);
    }

    if (scrollToEnd) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  _updateMessageStatusesInPlace(updatedMessages) {
    const messageList = document.getElementById("messageList");
    if (!messageList || !Array.isArray(updatedMessages) || updatedMessages.length === 0) {
      return;
    }

    // Create a map of old messages by ID for quick comparison
    const oldStatusByMessageId = new Map();
    for (const msg of this.messages) {
      oldStatusByMessageId.set(Number(msg.id), msg.status);
    }

    // Find which messages had status changes
    const changedMessageIds = new Set();
    for (const updatedMsg of updatedMessages) {
      const msgId = Number(updatedMsg.id);
      const oldStatus = oldStatusByMessageId.get(msgId);
      const newStatus = updatedMsg.status;
      if (oldStatus !== newStatus) {
        changedMessageIds.add(msgId);
      }
    }

    if (changedMessageIds.size === 0) {
      return;
    }

    // Update local messages array with new statuses
    for (const updatedMsg of updatedMessages) {
      const msgId = Number(updatedMsg.id);
      const localMsg = this.messages.find((m) => Number(m.id) === msgId);
      if (localMsg && changedMessageIds.has(msgId)) {
        localMsg.status = updatedMsg.status;
      }
    }

    // Update only the status display in changed message DOM elements (lookup by message ID)
    for (const msg of this.messages) {
      const msgId = Number(msg?.id);
      if (!msg || !changedMessageIds.has(msgId)) {
        continue;
      }

      const messageElement = messageList.querySelector(`li[data-message-id="${msgId}"]`);
      if (!messageElement) {
        continue;
      }

      const metaElement = messageElement.querySelector(".messenger-message__meta");
      if (!metaElement) {
        continue;
      }

      const isOwn = Number(msg.fromUserId) === Number(this.currentUser?.id);
      const statusHtml = this._formatMessageStatus(msg, isOwn);
      const timestampText = this._formatTimestamp(msg.createdAt);
      const metaText = statusHtml ? `${timestampText} · ${statusHtml}` : timestampText;

      metaElement.innerHTML = metaText;
    }
  }

  async _refreshMessageStatusesSeamlessly(withUserId) {
    if (!this.activeConversation || Number(this.activeConversation.id) !== Number(withUserId)) {
      return;
    }

    try {
      const response = await this.apiService.get(`messages/conversations/${Number(withUserId)}?limit=100`, {
        requiresAuth: true,
      });

      if (!response.success || !response?.data?.success) {
        return;
      }

      const payload = response.data.data || {};
      const newMessages = Array.isArray(payload.messages) ? payload.messages : [];

      if (newMessages.length === 0) {
        return;
      }

      // Update statuses without full re-render
      this._updateMessageStatusesInPlace(newMessages);
    } catch (error) {
      // Silently ignore fetch errors for read status updates
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
    this._ensureSocketConnected();

    if (this.socket.connected) {
      if (runImmediately) {
        this._subscribeActiveConversation();
      }
      return;
    }

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
      this._applyUnreadPayload(payload.unread, withUserId);
      const incoming = Array.isArray(payload.messages) ? payload.messages : [];
      if (incoming.length === 0) {
        return;
      }

      this._mergeIncomingMessages(incoming, true);
    } finally {
      this.polling.inFlight = false;
    }
  }

  _getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = this.authService?.getToken?.() || "";
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${protocol}//${window.location.host}/api/v1/messages/ws${tokenQuery}`;
  }

  _ensureSocketConnected() {
    if (document.hidden) {
      return;
    }

    if (this.socket.connected && this.socket.instance && this.socket.instance.readyState === WebSocket.OPEN) {
      this._subscribeActiveConversation();
      return;
    }

    if (this.socket.instance && this.socket.instance.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (this.socket.reconnectTimerId) {
      window.clearTimeout(this.socket.reconnectTimerId);
      this.socket.reconnectTimerId = null;
    }

    this.socket.manualClose = false;

    try {
      const ws = new WebSocket(this._getWebSocketUrl());
      this.socket.instance = ws;

      ws.addEventListener("open", () => {
        this.socket.connected = true;
        this.socket.reconnectAttempts = 0;
        this._stopPolling();
        this._startSocketHeartbeat();
        this._subscribeActiveConversation();
      });

      ws.addEventListener("message", (event) => {
        this._handleSocketPacket(event?.data);
      });

      ws.addEventListener("close", () => {
        this.socket.connected = false;
        this._stopSocketHeartbeat();

        const shouldReconnect = !this.socket.manualClose && !document.hidden;
        if (shouldReconnect) {
          this._scheduleSocketReconnect();
          if (this.activeConversation) {
            this._startPolling(false);
          }
        }
      });

      ws.addEventListener("error", () => {
        this.socket.connected = false;
        this._notifySocketInstability();
      });
    } catch (error) {
      this.socket.connected = false;
      this._notifySocketInstability(error);
      this._scheduleSocketReconnect();
      this._startPolling(false);
    }
  }

  _notifySocketInstability(error = null) {
    const now = Date.now();
    if (now - Number(this.socket.lastWarningAt || 0) < 15000) {
      return;
    }

    this.socket.lastWarningAt = now;
    if (error && typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("Messenger websocket connection issue:", error);
    }

    if (this.socket.reconnectAttempts >= 3) {
      this._showNotification("Connection issues detected. Retrying…", "error");
    }
  }

  _scheduleSocketReconnect() {
    if (this.socket.reconnectTimerId || this.socket.manualClose) {
      return;
    }

    const attempt = this.socket.reconnectAttempts + 1;
    this.socket.reconnectAttempts = attempt;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));

    this.socket.reconnectTimerId = window.setTimeout(() => {
      this.socket.reconnectTimerId = null;
      this._ensureSocketConnected();
    }, delay);
  }

  _closeSocket(manual = false) {
    this.socket.manualClose = manual;

    if (this.socket.reconnectTimerId) {
      window.clearTimeout(this.socket.reconnectTimerId);
      this.socket.reconnectTimerId = null;
    }

    this._stopSocketHeartbeat();

    if (this.socket.instance) {
      try {
        this.socket.instance.close();
      } catch (error) {
        // ignore close errors
      }
    }

    this.socket.instance = null;
    this.socket.connected = false;
  }

  _startSocketHeartbeat() {
    this._stopSocketHeartbeat();

    this.socket.heartbeatTimerId = window.setInterval(() => {
      this._sendSocketMessage("ping", {});
    }, 25000);
  }

  _stopSocketHeartbeat() {
    if (this.socket.heartbeatTimerId) {
      window.clearInterval(this.socket.heartbeatTimerId);
      this.socket.heartbeatTimerId = null;
    }
  }

  _sendSocketMessage(type, payload) {
    const ws = this.socket.instance;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      ws.send(
        JSON.stringify({
          type,
          payload,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  _subscribeActiveConversation() {
    if (!this.activeConversation || !this.socket.connected || !this._isActiveConversationValid()) {
      return;
    }

    this._sendSocketMessage("subscribe", {
      withUserId: Number(this.activeConversation.id),
      since: undefined,
    });
  }

  _handleSocketPacket(rawPayload) {
    let packet;
    try {
      packet = JSON.parse(rawPayload);
    } catch (error) {
      return;
    }

    const type = packet?.type;
    if (type === "connected") {
      this._subscribeActiveConversation();
      return;
    }

    if (type === "conversation_delta") {
      const blocked = packet?.data?.blocked || {};
      if (this.activeConversation) {
        this.activeConversation.blockedByYou = blocked.blockedByYou === true;
        this.activeConversation.blockedByThem = blocked.blockedByUser === true;
        this.activeConversation.isBlocked = this.activeConversation.blockedByYou || this.activeConversation.blockedByThem;
      }

      this._applyUnreadPayload(packet?.data?.unread, Number(this.activeConversation?.id));

      const incoming = Array.isArray(packet?.data?.messages) ? packet.data.messages : [];
      this._mergeIncomingMessages(incoming, incoming.length > 0);
      this._renderActiveConversation();
      return;
    }

    if (type === "friends_updated") {
      this._loadFriends();

      if (this.activeConversation) {
        this._loadConversation(this.activeConversation.id);
      }

      return;
    }

    if (type === "read_status_updated") {
      const readByUserId = Number(packet?.data?.readByUserId);
      if (this.activeConversation && readByUserId === Number(this.activeConversation.id)) {
        this._refreshMessageStatusesSeamlessly(readByUserId);
      }

      return;
    }

    if (type === "message_new" || type === "message_sent") {
      const message = packet?.data;
      if (!message) {
        return;
      }

      if (!this.currentUser || !Number.isInteger(Number(this.currentUser.id))) {
        return;
      }

      if (type === "message_sent" && packet?.clientMessageId) {
        this._clearPendingOutgoing(packet.clientMessageId);
      }

      const currentUserId = Number(this.currentUser?.id);
      const messageFrom = Number(message.fromUserId);
      const messageTo = Number(message.toUserId);
      const incomingForCurrentUser = type === "message_new" && messageTo === currentUserId;

      if (incomingForCurrentUser && !this.activeConversation) {
        this._scheduleUnreadSync();
        this._renderFriends();
        this._showNotification("New incoming message.", "info");
      }

      if (!this.activeConversation) {
        return;
      }

      const withUserId = Number(this.activeConversation.id);
      const isRelevant =
        (messageFrom === currentUserId && messageTo === withUserId) || (messageFrom === withUserId && messageTo === currentUserId);

      if (isRelevant) {
        this._mergeIncomingMessages([message], true);

        const incomingForCurrentUser = messageFrom === withUserId && messageTo === Number(this.currentUser?.id);
        if (incomingForCurrentUser) {
          this._subscribeActiveConversation();
        }
      } else if (incomingForCurrentUser) {
        this._scheduleUnreadSync();
        this._renderFriends();
        this._showNotification("New incoming message.", "info");
      }
      return;
    }

    if (type === "error") {
      if (packet?.clientMessageId && this.pendingOutgoing.has(packet.clientMessageId)) {
        this._clearPendingOutgoing(packet.clientMessageId);
      }

      const errorCode = Number(packet?.code);
      const errorMessage = packet?.error || "Messenger error";
      if (errorCode === 401 || errorCode === 403) {
        this._showNotification("Session expired. Please log in again.", "error");
      } else {
        this._showNotification(errorMessage, "error");
      }
    }
  }

  _mergeIncomingMessages(incoming, scrollToEnd = false) {
    const byId = new Map(this.messages.map((message) => [Number(message.id), message]));
    for (const message of incoming) {
      if (!message || !Number.isInteger(Number(message.id))) {
        continue;
      }
      byId.set(Number(message.id), message);
    }

    this.messages = Array.from(byId.values()).sort((left, right) => this._compareMessages(left, right));
    const latest = this.messages[this.messages.length - 1];
    this.lastMessageCursor = latest ? latest.id : this.lastMessageCursor;
    this._renderMessages(scrollToEnd);
  }

  _clearPendingOutgoing(clientMessageId) {
    if (!clientMessageId || !this.pendingOutgoing.has(clientMessageId)) {
      return;
    }

    const pending = this.pendingOutgoing.get(clientMessageId);
    if (pending?.timeoutId) {
      window.clearTimeout(pending.timeoutId);
    }

    this.pendingOutgoing.delete(clientMessageId);
  }

  _scheduleUnreadSync() {
    if (this.unreadSyncTimerId) {
      window.clearTimeout(this.unreadSyncTimerId);
    }

    this.unreadSyncTimerId = window.setTimeout(() => {
      this.unreadSyncTimerId = null;
      this._loadConversationSummaries();
    }, 300);
  }

  _isActiveConversationValid() {
    if (!this.activeConversation) {
      return false;
    }

    const activeUserId = Number(this.activeConversation.id);
    if (!Number.isInteger(activeUserId) || activeUserId <= 0) {
      return false;
    }

    return this.friends.some((friend) => Number(friend?.id) === activeUserId);
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

  async _loadConversationSummaries() {
    try {
      const response = await this.apiService.get("messages/conversations", {
        requiresAuth: true,
      });

      if (!response.success || !response?.data?.success) {
        return;
      }

      const conversations = Array.isArray(response?.data?.data) ? response.data.data : [];
      const unreadMap = new Map();
      let unreadTotal = 0;

      for (const conversation of conversations) {
        const userId = Number(conversation?.withUser?.id);
        const unreadCount = Number(conversation?.unreadCount) || 0;
        if (!Number.isInteger(userId) || userId <= 0) {
          continue;
        }

        if (unreadCount > 0) {
          unreadMap.set(userId, unreadCount);
          unreadTotal += unreadCount;
        }
      }

      this.unreadState.byUserId = unreadMap;
      this.unreadState.total = unreadTotal;
      this._renderFriends();
      this._renderActiveConversation();
    } catch (error) {
      // ignore unread summary sync failures
    }
  }

  _applyUnreadPayload(unread, withUserId) {
    if (!unread || typeof unread !== "object") {
      return;
    }

    const conversationUserId = Number(withUserId);
    if (Number.isInteger(conversationUserId) && conversationUserId > 0 && unread.withUser !== undefined) {
      this._setUnreadCount(conversationUserId, Number(unread.withUser) || 0);
    }

    if (unread.total !== undefined) {
      this.unreadState.total = Math.max(0, Number(unread.total) || 0);
    }

    this._renderFriends();
    this._renderActiveConversation();
  }

  _setUnreadCount(userId, count) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return;
    }

    const normalizedCount = Math.max(0, Number(count) || 0);
    const previousCount = this.unreadState.byUserId.get(numericUserId) || 0;

    if (normalizedCount <= 0) {
      this.unreadState.byUserId.delete(numericUserId);
    } else {
      this.unreadState.byUserId.set(numericUserId, normalizedCount);
    }

    this.unreadState.total = Math.max(0, this.unreadState.total - previousCount + normalizedCount);
  }

  _getUnreadCountForUser(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return 0;
    }

    return this.unreadState.byUserId.get(numericUserId) || 0;
  }

  _formatMessageStatus(message, isOwnMessage) {
    const status = typeof message?.status === "string" ? message.status.trim().toLowerCase() : "";

    if (!status) {
      return "";
    }

    const statusIcons = {
      read: `<span class="msg-status msg-status--read" title="Read">✓✓</span>`,
      delivered: `<span class="msg-status msg-status--delivered" title="Delivered">✓</span>`,
      unread: `<span class="msg-status msg-status--unread" title="Unread">○</span>`,
    };

    if (isOwnMessage && (status === "read" || status === "delivered" || status === "unread")) {
      return statusIcons[status] || "";
    }

    if (!isOwnMessage && (status === "read" || status === "unread")) {
      return statusIcons[status] || "";
    }

    return "";
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

  _formatMessageContent(rawContent) {
    const escaped = this._escapeHtml(rawContent || "");
    const withEmoji = this._replaceShortcodesInText(escaped);
    return withEmoji.replace(/\r?\n/g, "<br>");
  }

  _convertShortcodesToEmoji(rawContent) {
    const text = String(rawContent || "");
    return this._replaceShortcodesInText(text);
  }

  _replaceShortcodesInText(text) {
    return String(text || "").replace(/:([a-z0-9_+-]+):/gi, (fullMatch, shortcodeRaw) => {
      const shortcode = String(shortcodeRaw || "").toLowerCase();
      return this.emojiShortcodes[shortcode] || fullMatch;
    });
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
