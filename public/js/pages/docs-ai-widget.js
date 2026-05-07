(function attachDocsAiWidget(global) {
  const DEFAULT_BOT_NAME = "Docsy";
  const DEFAULT_GREETING = "I'm Docsy. Ask me about features, roles, demo accounts, user flows, or API basics in the docs.";

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createMessageMarkup(role, text) {
    return `
      <div class="docs-ai-widget__message docs-ai-widget__message--${escapeHtml(role)}">
        <div class="docs-ai-widget__bubble">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>
      </div>
    `;
  }

  global.setupDocsAiWidget = async function setupDocsAiWidget(options = {}) {
    const getFlagValue = typeof options.getFeatureFlagValue === "function" ? options.getFeatureFlagValue : null;
    if (!getFlagValue) {
      return;
    }

    const widget = document.getElementById("docs-ai-widget");
    if (!widget) {
      return;
    }

    const enabled = await getFlagValue("docsAiAssistantEnabled", false);
    if (!enabled) {
      widget.hidden = true;
      return;
    }

    const toggle = document.getElementById("docs-ai-toggle");
    const panel = document.getElementById("docs-ai-panel");
    const closeBtn = document.getElementById("docs-ai-close");
    const form = document.getElementById("docs-ai-form");
    const input = document.getElementById("docs-ai-input");
    const messages = document.getElementById("docs-ai-messages");
    const status = document.getElementById("docs-ai-status");
    const thinking = document.getElementById("docs-ai-thinking");
    const title = document.getElementById("docs-ai-title");
    const sendBtn = document.getElementById("docs-ai-send");

    if (!widget || !toggle || !panel || !form || !input || !messages || !status || !thinking || !title || !sendBtn) {
      return;
    }

    let botName = DEFAULT_BOT_NAME;
    let initialized = false;
    let isSending = false;

    const setOpen = (isOpen) => {
      toggle.setAttribute("aria-expanded", String(isOpen));
      panel.hidden = !isOpen;
      panel.setAttribute("aria-hidden", String(!isOpen));
      if (isOpen) {
        window.setTimeout(() => input.focus(), 20);
      }
    };

    const setSendingState = (sending) => {
      isSending = sending;
      input.disabled = sending;
      sendBtn.disabled = sending;
      thinking.hidden = !sending;
      status.textContent = sending ? `${botName} is checking the docs…` : "Answers grounded in Rolnopol docs";
    };

    const appendMessage = (role, text) => {
      messages.insertAdjacentHTML("beforeend", createMessageMarkup(role, text));
      messages.scrollTop = messages.scrollHeight;
    };

    const ensureGreeting = () => {
      if (initialized) {
        return;
      }
      initialized = true;
      appendMessage("assistant", DEFAULT_GREETING);
    };

    const sendMessage = async (message) => {
      if (!message || isSending) {
        return;
      }

      appendMessage("user", message);
      setSendingState(true);

      try {
        const response = await apiRequest(getApiUrl("docs-chat/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        });

        if (!response.success || !response?.data?.data) {
          throw new Error(response.error || response?.data?.error || "Unable to reach documentation assistant.");
        }

        const payload = response.data.data;
        botName = payload.botName || botName;
        title.textContent = `✨ ${botName}`;
        appendMessage("assistant", payload.reply || "I couldn't find a helpful answer in the docs just now.");
      } catch (error) {
        appendMessage("assistant", `I hit a paper cut while checking the docs: ${error.message || "Unknown error"}`);
      } finally {
        setSendingState(false);
      }
    };

    widget.hidden = false;
    title.textContent = `✨ ${botName}`;
    setOpen(false);

    toggle.addEventListener("click", () => {
      const nextOpen = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(nextOpen);
      if (nextOpen) {
        ensureGreeting();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => setOpen(false));
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) {
        return;
      }
      input.value = "";
      await sendMessage(message);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    });
  };
})(window);
