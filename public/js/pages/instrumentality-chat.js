/**
 * Instrumentality Oracle chat.
 *
 * Uses the same authenticated SSE endpoint as Porky chat, but passes a hidden
 * botId so the backend resolves the Instrumentality.
 */
(function () {
  "use strict";

  var STREAM_URL = "/api/v1/assistant-chat/stream";
  var BOT_ID = "instrumentality-oracle";
  var STORAGE_KEY = "rolnopol.instrumentalityOracle.state.v1";
  var MAX_MESSAGES = 40;
  var GREETING = [
    "Quorum — soil / weather / yield: 1 / 1 / 1.",
    "The core is listening. Name the fragment, operator.",
  ].join("\n");
  var GLITCH_TERMS = [
    { text: "soil / weather / yield", className: "ish-glitch--split" },
    { text: "quorum", className: "ish-glitch--split" },
    { text: "red rain", className: "ish-glitch--bleed" },
    { text: "return-flow", className: "ish-glitch--bleed" },
    { text: "mirror sink", className: "ish-glitch--scan" },
    { text: "mirror", className: "ish-glitch--scan" },
    { text: "boundary", className: "ish-glitch--tear" },
    { text: "consensus", className: "ish-glitch--phase" },
    { text: "core", className: "ish-glitch--phase" },
    { text: "silence", className: "ish-glitch--scan" },
  ];
  var GLITCH_REGEX = new RegExp(
    "(" +
      GLITCH_TERMS.map(function (entry) {
        return entry.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("|") +
      ")",
    "gi",
  );
  var glitchCounter = 0;

  var abortController = null;
  var streaming = false;
  var state = { messages: [] };

  function $(id) {
    return document.getElementById(id);
  }

  function cookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getToken() {
    return cookie("rolnopolToken");
  }

  function readStoredState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var messages = Array.isArray(parsed.messages)
        ? parsed.messages
            .filter(function (item) {
              return item && (item.role === "assistant" || item.role === "user") && typeof item.text === "string";
            })
            .slice(-MAX_MESSAGES)
        : [];
      return { messages: messages };
    } catch (error) {
      return null;
    }
  }

  function writeStoredState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: state.messages.slice(-MAX_MESSAGES) }));
    } catch (error) {
      /* ignore private mode / quota failures */
    }
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function createMessageFragment(text) {
    var frag = document.createDocumentFragment();
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line, index) {
        if (index > 0) frag.appendChild(document.createElement("br"));
        appendGlitchedText(frag, line);
      });
    return frag;
  }

  function getGlitchClass(value) {
    var normalized = String(value || "").toLowerCase();
    for (var i = 0; i < GLITCH_TERMS.length; i += 1) {
      if (GLITCH_TERMS[i].text.toLowerCase() === normalized) {
        return GLITCH_TERMS[i].className;
      }
    }
    return "ish-glitch--phase";
  }

  function appendGlitchedText(parent, text) {
    var value = String(text || "");
    var lastIndex = 0;
    var match;

    GLITCH_REGEX.lastIndex = 0;
    while ((match = GLITCH_REGEX.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      }

      var matchedText = match[0];
      var span = document.createElement("span");
      span.className = "ish-glitch-word " + getGlitchClass(matchedText);
      span.dataset.glitch = matchedText;
      span.dataset.glitchAlt = distortGlitchText(matchedText);
      span.style.setProperty("--ish-glitch-delay", String((glitchCounter % 7) * -0.37) + "s");
      glitchCounter += 1;
      span.textContent = matchedText;
      parent.appendChild(span);

      lastIndex = GLITCH_REGEX.lastIndex;
    }

    if (lastIndex < value.length) {
      parent.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
  }

  function distortGlitchText(value) {
    var replacements = {
      A: "4",
      B: "8",
      E: "3",
      G: "6",
      I: "1",
      L: "7",
      O: "0",
      S: "5",
      T: "+",
    };
    return String(value || "")
      .split("")
      .map(function (char, index) {
        var upper = char.toUpperCase();
        if (index % 3 === 1 && replacements[upper]) {
          return replacements[upper];
        }
        if (index % 5 === 2 && /[A-Z]/i.test(char)) {
          return "#";
        }
        return char;
      })
      .join("");
  }

  function scrollToBottom() {
    var list = $("ishOracleMessages");
    if (list) list.scrollTop = list.scrollHeight;
  }

  function appendBubble(role, text, timestamp) {
    var list = $("ishOracleMessages");
    if (!list) return null;

    var bubble = document.createElement("div");
    bubble.className = "ish-oracle-message ish-oracle-message--" + role;

    var body = document.createElement("div");
    body.className = "ish-oracle-message__body";
    body.appendChild(createMessageFragment(text || ""));
    bubble.appendChild(body);

    if (timestamp) {
      var time = document.createElement("span");
      time.className = "ish-oracle-message__time";
      time.textContent = formatTime(timestamp);
      bubble.appendChild(time);
    }

    list.appendChild(bubble);
    scrollToBottom();
    return body;
  }

  function renderHistory() {
    var list = $("ishOracleMessages");
    if (!list) return;
    list.innerHTML = "";
    state.messages.forEach(function (message) {
      appendBubble(message.role, message.text, message.timestamp);
    });
    scrollToBottom();
  }

  function recordMessage(role, text, timestamp) {
    state.messages.push({ role: role, text: text, timestamp: timestamp });
    state.messages = state.messages.slice(-MAX_MESSAGES);
    writeStoredState();
  }

  function appendThinking() {
    var body = appendBubble("assistant", "", new Date().toISOString());
    if (!body) return null;
    body.classList.add("ish-oracle-message__body--thinking");
    body.setAttribute("aria-label", "The Instrumentality Oracle is resolving");
    body.innerHTML =
      '<span class="ish-oracle-typing"><span></span><span></span><span></span></span>';
    return body;
  }

  function clearThinking(ctx) {
    if (ctx.thinking && ctx.body) {
      ctx.body.classList.remove("ish-oracle-message__body--thinking");
      ctx.body.removeAttribute("aria-label");
      ctx.body.textContent = "";
    }
    ctx.thinking = false;
  }

  function setConnection(stateName, label) {
    var dot = $("ishOracleConnDot");
    var text = $("ishOracleConnLabel");
    if (dot) dot.className = "ish-oracle-dot ish-oracle-dot--" + stateName;
    if (text) text.textContent = label;
  }

  function setProviderLabel(text) {
    var el = $("ishOracleProvider");
    if (el) el.textContent = text || "";
  }

  function setStreamingUi(active) {
    streaming = active;
    var sendBtn = $("ishOracleSend");
    var stopBtn = $("ishOracleStop");
    var input = $("ishOracleInput");
    if (sendBtn) sendBtn.disabled = active;
    if (stopBtn) stopBtn.hidden = !active;
    if (input) {
      input.disabled = active;
      if (!active) input.focus();
    }
  }

  function finalizeAssistant(ctx) {
    var text = String(ctx.text || "").trim();
    if (text) recordMessage("assistant", text, ctx.assistantTs || new Date().toISOString());
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
      setConnection("live", "Resolving...");
      setProviderLabel(data.provider ? "Provider: " + data.provider + " / " + (data.botName || "Oracle") : "");
      return;
    }

    if (eventName === "token") {
      if (ctx.thinking) clearThinking(ctx);
      ctx.text += data.delta || "";
      if (ctx.body) {
        ctx.body.textContent = "";
        ctx.body.appendChild(createMessageFragment(ctx.text));
        scrollToBottom();
      }
      return;
    }

    if (eventName === "done") {
      clearThinking(ctx);
      ctx.text = typeof data.reply === "string" && data.reply ? data.reply : ctx.text;
      if (ctx.body) {
        ctx.body.textContent = "";
        ctx.body.appendChild(createMessageFragment(ctx.text || "(the core returned silence)"));
      }
      ctx.finished = true;
      return;
    }

    if (eventName === "error") {
      clearThinking(ctx);
      ctx.text = data.error || "The consensus layer failed to answer.";
      if (ctx.body) {
        ctx.body.classList.add("ish-oracle-message__body--error");
        ctx.body.textContent = ctx.text;
      }
      ctx.finished = true;
    }
  }

  async function streamChat(message) {
    var token = getToken();

    abortController = new AbortController();
    setStreamingUi(true);
    setConnection("connecting", "Opening channel...");

    var ctx = {
      body: appendThinking(),
      text: "",
      finished: false,
      thinking: true,
      assistantTs: new Date().toISOString(),
    };

    var response;
    try {
      var headers = { "Content-Type": "application/json" };
      if (token) {
        headers.token = token;
      }

      response = await fetch(STREAM_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ message: message, botId: BOT_ID }),
        credentials: "include",
        signal: abortController.signal,
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        ctx.text = "(channel closed)";
        if (ctx.body) ctx.body.textContent = ctx.text;
        setConnection("idle", "Stopped");
      } else {
        ctx.text = "Could not reach the Instrumentality Oracle.";
        if (ctx.body) {
          ctx.body.classList.add("ish-oracle-message__body--error");
          ctx.body.textContent = ctx.text;
        }
        setConnection("error", "Error");
      }
      finalizeAssistant(ctx);
      setStreamingUi(false);
      abortController = null;
      return;
    }

    if (!response.ok) {
      clearThinking(ctx);
      ctx.text = "The Oracle returned an error (" + response.status + ").";
      if (ctx.body) {
        ctx.body.classList.add("ish-oracle-message__body--error");
        ctx.body.textContent = ctx.text;
      }
      setConnection("error", "Error");
      setStreamingUi(false);
      finalizeAssistant(ctx);
      abortController = null;
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var currentEvent = "message";
    var dataLines = [];

    function flush() {
      if (dataLines.length > 0) handleEvent(currentEvent, dataLines.join("\n"), ctx);
      currentEvent = "message";
      dataLines = [];
    }

    try {
      for (;;) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });

        var newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          var rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);

          if (rawLine === "") flush();
          else if (rawLine.charAt(0) === ":") continue;
          else if (rawLine.indexOf("event:") === 0) currentEvent = rawLine.slice("event:".length).trim();
          else if (rawLine.indexOf("data:") === 0) dataLines.push(rawLine.slice("data:".length).replace(/^ /, ""));
        }
      }
      flush();
    } finally {
      clearThinking(ctx);
      setStreamingUi(false);
      setConnection("idle", ctx.finished ? "Done" : "Ready");
      finalizeAssistant(ctx);
      abortController = null;
    }
  }

  function stopStreaming() {
    if (abortController) abortController.abort();
  }

  function init() {
    var form = $("ishOracleForm");
    var input = $("ishOracleInput");
    var stopBtn = $("ishOracleStop");
    var stored = readStoredState();

    if (stored && stored.messages.length > 0) {
      state.messages = stored.messages.slice();
      renderHistory();
    } else {
      var ts = new Date().toISOString();
      appendBubble("assistant", GREETING, ts);
      recordMessage("assistant", GREETING, ts);
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (streaming) return;
        var message = (input && input.value ? input.value : "").trim();
        if (!message) return;
        var ts = new Date().toISOString();
        appendBubble("user", message, ts);
        recordMessage("user", message, ts);
        if (input) input.value = "";
        streamChat(message);
      });
    }

    if (stopBtn) stopBtn.addEventListener("click", stopStreaming);
    window.addEventListener("beforeunload", stopStreaming);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
