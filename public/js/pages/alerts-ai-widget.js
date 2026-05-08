(function attachAlertsAiWidget(global) {
  const DEFAULT_BOT_NAME = "Alerticus";
  const DEFAULT_STATUS = "Interprets today's and upcoming alerts for your selected region";
  const DEFAULT_GREETING =
    "I'm Alerticus. Ask me what stands out today, what looks urgent, or what tomorrow may bring for the selected region.";

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
      <div class="alerts-ai-widget__message alerts-ai-widget__message--${escapeHtml(role)}">
        <div class="alerts-ai-widget__bubble">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>
      </div>
    `;
  }

  function getSelectedRegion() {
    return document.getElementById("regionSelect")?.value || "PL-14";
  }

  function getSelectedDate() {
    const label = document.getElementById("todayDate")?.textContent?.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(label || "") ? label : new Date().toISOString().slice(0, 10);
  }

  global.setupAlertsAiWidget = async function setupAlertsAiWidget(options = {}) {
    const getFlagValue = typeof options.getFeatureFlagValue === "function" ? options.getFeatureFlagValue : null;
    if (!getFlagValue) {
      return;
    }

    const widget = document.getElementById("alerts-ai-widget");
    if (!widget) {
      return;
    }

    const enabled = await getFlagValue("alertsAiAssistantEnabled", false);
    if (!enabled) {
      widget.hidden = true;
      return;
    }

    const toggle = document.getElementById("alerts-ai-toggle");
    const panel = document.getElementById("alerts-ai-panel");
    const closeBtn = document.getElementById("alerts-ai-close");
    const form = document.getElementById("alerts-ai-form");
    const input = document.getElementById("alerts-ai-input");
    const messages = document.getElementById("alerts-ai-messages");
    const status = document.getElementById("alerts-ai-status");
    const thinking = document.getElementById("alerts-ai-thinking");
    const title = document.getElementById("alerts-ai-title");
    const sendBtn = document.getElementById("alerts-ai-send");

    if (!toggle || !panel || !form || !input || !messages || !status || !thinking || !title || !sendBtn) {
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
      status.textContent = sending ? `${botName} is scanning the alert horizon…` : DEFAULT_STATUS;
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
        const response = await apiRequest(getApiUrl("alerts-chat/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            region: getSelectedRegion(),
            date: getSelectedDate(),
          }),
        });

        if (!response.success || !response?.data?.data) {
          throw new Error(response.error || response?.data?.error || "Unable to reach alerts assistant.");
        }

        const payload = response.data.data;
        botName = payload.botName || botName;
        title.textContent = `🚨 ${botName}`;
        appendMessage("assistant", payload.reply || "The alert beacons are quiet for the moment.");
      } catch (error) {
        appendMessage("assistant", `My signal tower crackled for a moment: ${error.message || "Unknown error"}`);
      } finally {
        setSendingState(false);
      }
    };

    widget.hidden = false;
    title.textContent = `🚨 ${botName}`;
    status.textContent = DEFAULT_STATUS;
    setOpen(false);

    toggle.addEventListener("click", () => {
      const nextOpen = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(nextOpen);
      if (nextOpen) {
        ensureGreeting();
      }
    });

    closeBtn?.addEventListener("click", () => setOpen(false));

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
