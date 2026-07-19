/**
 * Porky Live Chat page — a dedicated, full-page version of the Porky assistant
 * modal that streams the reply token-by-token over Server-Sent Events (SSE).
 *
 * It shares its chat history with the floating assistant-chat modal: both read
 * and write the same localStorage state (`rolnopol.assistantChat.state.v1.<userId>`)
 * and sync live across tabs/surfaces via the same BroadcastChannel. Sending a
 * message here shows up in the modal and vice-versa.
 *
 * The stream endpoint (POST /api/v1/assistant-chat/stream) requires the `token`
 * auth header and a JSON body, neither of which the browser's native EventSource
 * can send — so we drive it with fetch() and parse the SSE frames ourselves.
 */
(function () {
  "use strict";

  var STREAM_URL = "/api/v1/assistant-chat/stream";
  var STORAGE_PREFIX = "rolnopol.assistantChat.state.v1.";
  var SYNC_PREFIX = "rolnopol.assistantChat.sync.v1.";
  var SYNC_MESSAGE_TYPE = "assistant-chat:state-sync";
  // Kept identical to the modal so an empty history seeds the same first message.
  var GREETING =
    "Hi! I'm Porky, your AI Assistant! I can summarize your private farm data. Try asking 'How are my fields doing?' or 'Tell me about animals.'";
  var MAX_MESSAGES = 50;

  var abortController = null;
  var streaming = false;

  // --- Session / shared-store wiring (mirrors app.js assistant widget) ---

  function cookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var userId = cookie("rolnopolUserId");
  var canPersist = typeof userId === "string" && userId.trim().length > 0;
  var storageKey = canPersist ? STORAGE_PREFIX + userId : null;
  var syncChannelName = canPersist ? SYNC_PREFIX + userId : null;
  var currentTabId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
  var syncChannel = null;
  if (syncChannelName && "BroadcastChannel" in window) {
    try {
      syncChannel = new BroadcastChannel(syncChannelName);
    } catch (error) {
      syncChannel = null;
    }
  }

  var state = { isOpen: false, messages: [] };

  function $(id) {
    return document.getElementById(id);
  }

  function getToken() {
    try {
      var apiService = window.App && window.App.getModule ? window.App.getModule("apiService") : null;
      if (apiService && typeof apiService.getToken === "function") {
        var token = apiService.getToken();
        if (token) {
          return token;
        }
      }
    } catch (error) {
      /* fall through to cookie parsing */
    }
    return cookie("rolnopolToken");
  }

  function normalizeStoredState(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    var messages = Array.isArray(payload.messages)
      ? payload.messages
          .filter(function (item) {
            return item && (item.role === "assistant" || item.role === "user") && typeof item.text === "string";
          })
          .slice(-MAX_MESSAGES)
      : [];
    return { isOpen: payload.isOpen === true, messages: messages };
  }

  function readStoredState() {
    if (!canPersist || !storageKey) {
      return null;
    }
    try {
      var raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return normalizeStoredState(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  // Persist the shared state and notify the modal/other tabs. `isOpen` is
  // preserved from whatever the modal last stored, so writing history here never
  // opens/closes the floating panel.
  function writeStoredState() {
    if (!canPersist || !storageKey) {
      return;
    }
    var existing = readStoredState();
    var normalized = {
      isOpen: existing ? existing.isOpen === true : state.isOpen === true,
      messages: state.messages.slice(-MAX_MESSAGES),
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
      if (syncChannel) {
        syncChannel.postMessage({ type: SYNC_MESSAGE_TYPE, sourceTabId: currentTabId, payload: normalized });
      }
    } catch (error) {
      /* ignore storage quota / private mode issues */
    }
  }

  // --- Rendering ---

  function formatTime(iso) {
    if (!iso) {
      return "";
    }
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Convert markdown links [label](href) and bare URLs to safe anchors,
  // matching the modal's rendering.
  function createMessageFragment(text) {
    var frag = document.createDocumentFragment();
    if (typeof text !== "string" || text.length === 0) {
      frag.appendChild(document.createTextNode(String(text || "")));
      return frag;
    }
    var combined = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s]+)/g;
    var lastIndex = 0;
    var match;
    while ((match = combined.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      var href = match[2] || match[3];
      var label = match[1] || match[3];
      try {
        var a = document.createElement("a");
        var resolved = href;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && href.charAt(0) !== "#") {
          resolved = new URL(href, window.location.origin).href;
        }
        a.href = resolved;
        a.textContent = label;
        if (/^https?:\/\//i.test(resolved)) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        frag.appendChild(a);
      } catch (error) {
        frag.appendChild(document.createTextNode(label));
      }
      lastIndex = combined.lastIndex;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    return frag;
  }

  function scrollToBottom() {
    var list = $("porkyChatMessages");
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  // Build a bubble; returns the body element so streaming can update it in place.
  function appendBubble(role, text, timestamp) {
    var list = $("porkyChatMessages");
    if (!list) {
      return null;
    }
    var bubble = document.createElement("div");
    bubble.className = "porky-chat-message porky-chat-message--" + role;

    var body = document.createElement("div");
    body.className = "porky-chat-message__body";
    body.appendChild(createMessageFragment(text || ""));
    bubble.appendChild(body);

    if (timestamp) {
      var time = document.createElement("span");
      time.className = "porky-chat-message__time";
      time.textContent = formatTime(timestamp);
      bubble.appendChild(time);
    }

    list.appendChild(bubble);
    scrollToBottom();
    return body;
  }

  function renderHistory() {
    var list = $("porkyChatMessages");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    for (var i = 0; i < state.messages.length; i += 1) {
      var msg = state.messages[i];
      appendBubble(msg.role, msg.text, msg.timestamp);
    }
    scrollToBottom();
  }

  // Append to shared state + persist (does not render).
  function recordMessage(role, text, timestamp) {
    state.messages.push({ role: role, text: text, timestamp: timestamp });
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(-MAX_MESSAGES);
    }
    writeStoredState();
  }

  function applySyncedState(incoming) {
    var normalized = normalizeStoredState(incoming);
    if (!normalized) {
      return;
    }
    // Don't clobber an in-progress streamed reply; we'll re-sync on completion.
    if (streaming) {
      state.isOpen = normalized.isOpen;
      return;
    }
    state.isOpen = normalized.isOpen;
    state.messages = normalized.messages.slice();
    renderHistory();
  }

  // --- Thinking indicator ---

  function appendThinking() {
    var list = $("porkyChatMessages");
    if (!list) {
      return null;
    }
    var bubble = document.createElement("div");
    bubble.className = "porky-chat-message porky-chat-message--assistant";
    var body = document.createElement("div");
    body.className = "porky-chat-message__body porky-chat-message__body--thinking";
    body.setAttribute("aria-label", "Porky is thinking");
    body.innerHTML =
      '<span class="porky-chat-typing"><span class="porky-chat-typing__dot"></span>' +
      '<span class="porky-chat-typing__dot"></span><span class="porky-chat-typing__dot"></span></span>';
    bubble.appendChild(body);
    list.appendChild(bubble);
    scrollToBottom();
    return body;
  }

  function clearThinking(ctx) {
    if (ctx.thinking && ctx.body) {
      ctx.body.classList.remove("porky-chat-message__body--thinking");
      ctx.body.removeAttribute("aria-label");
      ctx.body.textContent = "";
    }
    ctx.thinking = false;
  }

  // --- Connection status ---

  function setConnection(stateName, label) {
    var dot = $("porkyChatConnDot");
    var text = $("porkyChatConnLabel");
    if (dot) {
      dot.className = "porky-chat-dot porky-chat-dot--" + stateName;
    }
    if (text) {
      text.textContent = label;
    }
  }

  function setProviderLabel(text) {
    var el = $("porkyChatProvider");
    if (el) {
      el.textContent = text || "";
    }
  }

  function setStreamingUi(active) {
    streaming = active;
    var sendBtn = $("porkyChatSend");
    var stopBtn = $("porkyChatStop");
    var input = $("porkyChatInput");
    if (sendBtn) {
      sendBtn.disabled = active;
    }
    if (stopBtn) {
      stopBtn.hidden = !active;
    }
    if (input) {
      input.disabled = active;
      if (!active) {
        input.focus();
      }
    }
  }

  // Persist the assistant reply into the shared history once streaming ends, then
  // re-sync so the modal (and other tabs) reflect it.
  function finalizeAssistant(ctx) {
    var text = (ctx.text || "").trim();
    if (text) {
      recordMessage("assistant", text, ctx.assistantTs || new Date().toISOString());
    }
  }

  function handleEvent(eventName, dataText, ctx) {
    var data = {};
    if (dataText) {
      try {
        data = JSON.parse(dataText);
      } catch (error) {
        return;
      }
    }

    if (eventName === "start") {
      setConnection("live", "Thinking…");
      setProviderLabel(data.provider ? "Provider: " + data.provider + " · " + (data.botName || "Porky") : "");
    } else if (eventName === "token") {
      if (ctx.thinking) {
        clearThinking(ctx);
        setConnection("live", "Streaming…");
      }
      if (!ctx.body) {
        ctx.body = appendBubble("assistant", "", ctx.assistantTs);
      }
      ctx.text += data.delta || "";
      ctx.body.textContent = ctx.text;
      scrollToBottom();
    } else if (eventName === "done") {
      clearThinking(ctx);
      if (ctx.body && typeof data.reply === "string" && data.reply.length > 0) {
        ctx.text = data.reply;
        ctx.body.textContent = "";
        ctx.body.appendChild(createMessageFragment(data.reply));
      } else if (ctx.body && !ctx.text) {
        ctx.body.textContent = "(Porky had nothing to add.)";
      } else if (ctx.body) {
        // Re-render the streamed text with link formatting.
        ctx.body.textContent = "";
        ctx.body.appendChild(createMessageFragment(ctx.text));
      }
      ctx.finished = true;
    } else if (eventName === "error") {
      clearThinking(ctx);
      if (!ctx.body) {
        ctx.body = appendBubble("assistant", "", ctx.assistantTs);
      }
      ctx.body.classList.add("porky-chat-message__body--error");
      ctx.text = data.error || "Something went wrong while contacting Porky.";
      ctx.body.textContent = ctx.text;
      ctx.finished = true;
    }
  }

  async function streamChat(message) {
    var token = getToken();
    if (!token) {
      appendBubble("assistant", "You need to be logged in to chat with Porky. Redirecting to login…");
      window.location.href = "/login.html";
      return;
    }

    abortController = new AbortController();
    setStreamingUi(true);
    setConnection("connecting", "Connecting…");

    var ctx = { body: appendThinking(), text: "", finished: false, thinking: true, assistantTs: new Date().toISOString() };

    var failWith = function (label, text, redirect) {
      setConnection("error", label);
      clearThinking(ctx);
      ctx.text = text;
      if (ctx.body) {
        ctx.body.classList.add("porky-chat-message__body--error");
        ctx.body.textContent = text;
      } else {
        ctx.body = appendBubble("assistant", text, ctx.assistantTs);
      }
      setStreamingUi(false);
      finalizeAssistant(ctx);
      if (redirect) {
        window.location.href = redirect;
      }
    };

    var response;
    try {
      response = await fetch(STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: token },
        body: JSON.stringify({ message: message }),
        credentials: "include",
        signal: abortController.signal,
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        setConnection("idle", "Stopped");
        clearThinking(ctx);
        if (ctx.body && !ctx.text) {
          ctx.body.textContent = "(stopped)";
        }
        finalizeAssistant(ctx);
      } else {
        failWith("Error", "Could not reach the assistant. Please try again.");
      }
      setStreamingUi(false);
      abortController = null;
      return;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        failWith("Error", "Your session has expired. Redirecting to login…", "/login.html");
      } else if (response.status === 404) {
        failWith("Error", "Porky chat is currently disabled by a feature flag.");
      } else {
        failWith("Error", "The assistant returned an error (" + response.status + ").");
      }
      abortController = null;
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var currentEvent = "message";
    var dataLines = [];

    var flush = function () {
      if (dataLines.length > 0) {
        handleEvent(currentEvent, dataLines.join("\n"), ctx);
      }
      currentEvent = "message";
      dataLines = [];
    };

    try {
      for (;;) {
        var result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });

        var newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          var rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);

          if (rawLine === "") {
            flush();
          } else if (rawLine.charAt(0) === ":") {
            /* heartbeat comment — ignore */
          } else if (rawLine.indexOf("event:") === 0) {
            currentEvent = rawLine.slice("event:".length).trim();
          } else if (rawLine.indexOf("data:") === 0) {
            dataLines.push(rawLine.slice("data:".length).replace(/^ /, ""));
          }
          /* id: lines are ignored on the client */
        }
      }
      flush();
    } catch (error) {
      if (!(error && error.name === "AbortError")) {
        setConnection("error", "Error");
      }
    } finally {
      if (ctx.thinking) {
        clearThinking(ctx);
        if (ctx.body && !ctx.text) {
          ctx.body.textContent = "(stopped)";
        }
      }
      setStreamingUi(false);
      setConnection("idle", ctx.finished ? "Done" : "Ready");
      finalizeAssistant(ctx);
      abortController = null;
    }
  }

  function stopStreaming() {
    if (abortController) {
      abortController.abort();
    }
  }

  function init() {
    var form = $("porkyChatForm");
    var input = $("porkyChatInput");
    var stopBtn = $("porkyChatStop");

    // Load the shared history (same store as the modal). Seed the greeting only
    // if there's nothing yet, so both surfaces converge on the same first line.
    var stored = readStoredState();
    if (stored && stored.messages.length > 0) {
      state.isOpen = stored.isOpen;
      state.messages = stored.messages.slice();
      renderHistory();
    } else {
      var ts = new Date().toISOString();
      appendBubble("assistant", GREETING, ts);
      recordMessage("assistant", GREETING, ts);
    }

    // Live sync from the modal / other tabs.
    if (canPersist && storageKey) {
      window.addEventListener("storage", function (event) {
        if (event.key !== storageKey || !event.newValue) {
          return;
        }
        try {
          applySyncedState(JSON.parse(event.newValue));
        } catch (error) {
          /* ignore malformed sync payload */
        }
      });
    }
    if (syncChannel) {
      syncChannel.onmessage = function (event) {
        var message = event && event.data;
        if (!message || message.type !== SYNC_MESSAGE_TYPE || message.sourceTabId === currentTabId) {
          return;
        }
        applySyncedState(message.payload);
      };
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (streaming) {
          return;
        }
        var message = (input && input.value ? input.value : "").trim();
        if (!message) {
          return;
        }
        var ts = new Date().toISOString();
        appendBubble("user", message, ts);
        recordMessage("user", message, ts);
        if (input) {
          input.value = "";
        }
        streamChat(message);
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener("click", stopStreaming);
    }

    window.addEventListener("beforeunload", stopStreaming);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
