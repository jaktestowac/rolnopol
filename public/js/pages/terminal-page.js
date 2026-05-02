(function () {
  const PROMPT = "guest@archive:~$";
  const TERMINAL_VERSION = "0.1.0";
  const STATIC_BOOT_SEQUENCE = [
    { type: "ascii", content: "╔════════════════════════════╗\n║   ARCHIVE TERMINAL v0.1    ║\n╚════════════════════════════╝" },
    { type: "text", content: "Memory check........ OK" },
    { type: "text", content: "Signal link......... STABLE" },
    { type: "text", content: "Retro display....... ACTIVE" },
    { type: "text", content: "Type a command and press Enter." },
  ];

  // Scripts are provided by the backend API. We'll fetch them on startup.

  const terminalShell = document.getElementById("terminalShell");
  const terminalOutput = document.getElementById("terminalOutput");
  const terminalInput = document.getElementById("terminalInput");
  const terminalInputRow = document.querySelector(".terminal-input-row");
  const terminalSuggestions = document.getElementById("terminalSuggestions");
  const terminalStatus = document.getElementById("terminalStatus");
  const terminalThemeManager = window.TerminalThemeManager?.createTerminalThemeManager({
    documentRef: document,
    storageKey: "rolnopol-terminal-theme-settings",
    persist: true,
  });
  const terminalApiClient = window.TerminalApiClient?.createTerminalApiClient({
    timeout: 12000,
    retries: 1,
  });
  const commandSystem = window.TerminalCommandSystem?.createTerminalCommandSystem({
    version: TERMINAL_VERSION,
    versionLabel: "Archive Terminal",
    terminalName: "Archive Terminal",
    apiClient: terminalApiClient,
    themeManager: terminalThemeManager,
  });
  const outputRenderer = window.TerminalOutputRenderer?.createTerminalOutputRenderer(terminalOutput, {
    autoScroll: true,
  });

  const state = {
    history: [],
    historyIndex: -1,
    sessionId: terminalApiClient?.getSessionId?.() || "",
    mode: "shell",
    porkySessionId: "",
    porkyConversation: [],
    isBusy: false,
    themeManager: terminalThemeManager,
    activeRenderController: null,
    cancelRequested: false,
    autocompleteState: null,
    availableScripts: [],
  };
  let bootSequenceRendered = false;

  if (!terminalShell || !terminalOutput || !terminalInput || !commandSystem || !outputRenderer) {
    return;
  }

  function scrollToBottom() {
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function updateInputWidth() {
    const nextWidth = Math.max(1, terminalInput.value.length + 1);
    terminalInput.style.setProperty("--terminal-input-chars", String(nextWidth));
  }

  function focusTerminalInput() {
    if (terminalInput.disabled) {
      terminalShell.focus({ preventScroll: true });
      return;
    }

    terminalInput.focus({ preventScroll: true });
  }

  function getCursorIndex() {
    return typeof terminalInput.selectionStart === "number" ? terminalInput.selectionStart : terminalInput.value.length;
  }

  function resetAutocompleteState() {
    state.autocompleteState = null;
  }

  function getTerminalContextSummary() {
    const themeState = terminalThemeManager?.getState?.() || {};

    return {
      mode: state.mode,
      theme: themeState.themeName || "green",
      effectsEnabled: themeState.effectsEnabled !== false,
      reducedMotion: themeState.reducedMotion === true,
      currentPath: "/operator/terminal.html",
      recentCommands: state.history.slice(-6),
      availableCommands: commandSystem.registry.list().map((command) => ({
        name: command.name,
        description: command.description,
        usage: command.usage,
        category: command.category,
      })),
      availableScripts: Array.isArray(state.availableScripts) ? state.availableScripts : [],
      availableFiles: [],
      unlockedScripts: [],
      unlockedFiles: [],
      mission: "",
    };
  }

  async function fetchAvailableScripts() {
    if (!terminalApiClient || typeof terminalApiClient.listScripts !== "function") {
      state.availableScripts = [];
      return;
    }

    try {
      const data = await terminalApiClient.listScripts();
      state.availableScripts = Array.isArray(data?.scripts) ? data.scripts : [];
    } catch (err) {
      state.availableScripts = [];
    }

    renderSuggestions();
  }

  function getPorkyConversationWindow() {
    return state.porkyConversation.slice(-8).map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  function pushPorkyConversation(role, content) {
    const text = String(content || "").trim();
    if (!text) {
      return;
    }

    state.porkyConversation.push({
      role,
      content: text,
    });

    if (state.porkyConversation.length > 8) {
      state.porkyConversation = state.porkyConversation.slice(-8);
    }
  }

  function resetPorkyState() {
    state.mode = "shell";
    state.porkySessionId = "";
    state.porkyConversation = [];
  }

  function applyPorkyMetadata(metadata = {}, userMessage = "") {
    const porky = metadata?.porky || {};
    const reply = String(porky.reply || "").trim();

    if (porky.transition === "start") {
      state.mode = "porky";
      state.porkySessionId = String(porky.sessionId || state.porkySessionId || terminalApiClient?.getSessionId?.() || "").trim();
      state.porkyConversation = [];
      pushPorkyConversation("assistant", reply);
      return;
    }

    if (porky.transition === "end") {
      pushPorkyConversation("assistant", reply);
      resetPorkyState();
      return;
    }

    if (porky.transition === "message" || porky.transition === "one-off") {
      if (userMessage) {
        pushPorkyConversation("user", userMessage);
      }
      pushPorkyConversation("assistant", reply);
      state.porkySessionId = String(porky.sessionId || state.porkySessionId || terminalApiClient?.getSessionId?.() || "").trim();
      state.mode = porky.transition === "message" ? "porky" : "shell";
      return;
    }

    if (porky.transition === "status") {
      state.porkySessionId = String(porky.sessionId || state.porkySessionId || terminalApiClient?.getSessionId?.() || "").trim();
    }
  }

  function appendPorkyThinkingLine() {
    return outputRenderer.render({
      type: "text",
      content: "porky is thinking...",
    });
  }

  function isPorkyExitInput(value) {
    return /^(exit|quit)$/i.test(String(value || "").trim());
  }

  function normalizePorkyInput(rawCommand) {
    const command = String(rawCommand || "").trim();

    if (state.mode === "porky" && command && !/^porky\b/i.test(command)) {
      if (isPorkyExitInput(command)) {
        return "porky exit";
      }

      return `porky ${command}`;
    }

    return command;
  }

  function isRenderCancelled(error) {
    return error?.code === "TERMINAL_RENDER_CANCELLED" || error?.name === "TerminalRenderCancelledError";
  }

  function hasActiveTextSelection() {
    const selection = typeof window.getSelection === "function" ? window.getSelection() : null;

    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    return !selection.isCollapsed && String(selection.toString() || "").trim().length > 0;
  }

  function renderSuggestions() {
    if (!terminalSuggestions) {
      return;
    }

    if (state.isBusy) {
      terminalSuggestions.textContent = "Running command… Press Ctrl+C to cancel.";
      return;
    }

    if (state.mode === "porky") {
      terminalSuggestions.textContent = "Porky mode • press Enter to chat • type exit, quit, or Ctrl+C to leave";
      return;
    }

    const suggestion = commandSystem.suggest?.(terminalInput.value, {
      cursorIndex: getCursorIndex(),
      themeManager: terminalThemeManager,
    });

    if (!suggestion) {
      terminalSuggestions.textContent = "Tab autocompletes commands • Ctrl+L clears screen • Ctrl+C cancels";
      return;
    }

    const matches = Array.isArray(suggestion.matches) ? suggestion.matches.slice(0, 5) : [];
    const labels = matches.map((match) => match.value).filter(Boolean);
    const hint = suggestion.hint || "";

    if (suggestion.kind === "argument" && suggestion.commandName === "theme") {
      terminalSuggestions.textContent = ["Theme options", ...labels, hint].filter(Boolean).join(" • ");
      return;
    }

    if (suggestion.kind === "argument" && suggestion.commandName === "effects") {
      terminalSuggestions.textContent = ["Effects options", ...labels, hint].filter(Boolean).join(" • ");
      return;
    }

    if (suggestion.kind === "command" && labels.length > 0) {
      terminalSuggestions.textContent = [`Commands`, ...labels, hint].filter(Boolean).join(" • ");
      return;
    }

    terminalSuggestions.textContent = hint || "Tab autocompletes commands • Ctrl+L clears screen • Ctrl+C cancels";
  }

  function applyAutocompleteSuggestion() {
    const currentValue = terminalInput.value;
    const currentState = state.autocompleteState;

    if (currentState && currentValue.startsWith(currentState.prefix) && currentValue.endsWith(currentState.suffix)) {
      currentState.index = (currentState.index + 1) % currentState.matches.length;
      const match = currentState.matches[currentState.index];
      if (!match) {
        return false;
      }

      terminalInput.value = `${currentState.prefix}${match.value}${currentState.trailingSpace}${currentState.suffix}`;
      updateInputWidth();

      const nextCaret = (currentState.prefix + match.value + currentState.trailingSpace).length;
      terminalInput.setSelectionRange(nextCaret, nextCaret);
      renderSuggestions();
      return true;
    }

    const suggestion = commandSystem.suggest?.(currentValue, {
      cursorIndex: getCursorIndex(),
      themeManager: terminalThemeManager,
    });

    if (!suggestion || !Array.isArray(suggestion.matches) || suggestion.matches.length === 0) {
      return false;
    }

    if (suggestion.kind === "command" && !suggestion.query.trim() && suggestion.matches.length > 1) {
      return false;
    }

    const match = suggestion.matches[0];
    if (!match) {
      return false;
    }

    const before = currentValue.slice(0, suggestion.range.start);
    const after = currentValue.slice(suggestion.range.end);
    const completion = match.value;
    const shouldAppendSpace = after.length === 0;

    state.autocompleteState = {
      prefix: before,
      suffix: after,
      trailingSpace: shouldAppendSpace ? " " : "",
      matches: suggestion.matches,
      index: 0,
      kind: suggestion.kind,
      commandName: suggestion.commandName,
    };

    terminalInput.value = `${before}${completion}${shouldAppendSpace ? " " : ""}${after}`;
    updateInputWidth();

    const nextCaret = (before + completion + (shouldAppendSpace ? " " : "")).length;
    terminalInput.setSelectionRange(nextCaret, nextCaret);
    renderSuggestions();
    return true;
  }

  function cancelCurrentCommand() {
    state.cancelRequested = true;
    state.activeRenderController?.abort?.();
    resetAutocompleteState();
    renderSuggestions();
  }

  function handleTerminalShortcut(event) {
    if (!(event.ctrlKey || event.metaKey)) {
      return false;
    }

    const key = String(event.key || "").toLowerCase();

    if (key === "l") {
      event.preventDefault();
      if (!state.isBusy) {
        outputRenderer.clear();
      }
      resetAutocompleteState();
      updateInputWidth();
      renderSuggestions();
      focusTerminalInput();
      return true;
    }

    if (key === "c") {
      if (hasActiveTextSelection()) {
        return false;
      }

      event.preventDefault();

      if (state.mode === "porky") {
        if (state.isBusy) {
          cancelCurrentCommand();
        }

        resetPorkyState();
        renderSuggestions();
        focusTerminalInput();
        return true;
      }

      if (state.isBusy) {
        cancelCurrentCommand();
      } else {
        terminalInput.value = "";
        updateInputWidth();
        resetAutocompleteState();
        renderSuggestions();
      }

      focusTerminalInput();
      return true;
    }

    return false;
  }

  function setStatus(text) {
    if (terminalStatus) {
      const currentTheme = terminalThemeManager?.getState?.()?.themeName;
      terminalStatus.textContent = currentTheme ? `${text} · ${currentTheme}` : text;
    }
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;
    terminalInput.disabled = isBusy;
    terminalShell?.setAttribute("aria-busy", isBusy ? "true" : "false");
    terminalShell?.classList.toggle("is-busy", isBusy);
    setStatus(isBusy ? "busy" : "ready");
    renderSuggestions();
  }

  function appendCommandLine(command) {
    const wrapper = document.createElement("div");
    wrapper.className = "terminal-entry terminal-entry--command";

    const prompt = document.createElement("span");
    prompt.className = "terminal-prompt";
    prompt.textContent = PROMPT;

    const value = document.createElement("span");
    value.className = "terminal-command";
    value.textContent = command;

    wrapper.append(prompt, value);
    terminalOutput.appendChild(wrapper);
    scrollToBottom();
  }

  async function renderBootSequence() {
    if (bootSequenceRendered) {
      return;
    }

    bootSequenceRendered = true;
    outputRenderer.clear();
    for (const entry of STATIC_BOOT_SEQUENCE) {
      // eslint-disable-next-line no-await-in-loop
      await outputRenderer.render(entry);
    }
    setStatus("ready");
    updateInputWidth();
  }

  function recordHistory(command) {
    state.history.push(command);
    state.historyIndex = state.history.length;
  }

  function moveHistory(direction) {
    if (!state.history.length) {
      return;
    }

    if (state.historyIndex === -1) {
      state.historyIndex = state.history.length;
    }

    const nextIndex = state.historyIndex + direction;
    if (nextIndex < 0) {
      state.historyIndex = 0;
    } else if (nextIndex >= state.history.length) {
      state.historyIndex = state.history.length;
      terminalInput.value = "";
      updateInputWidth();
      return;
    } else {
      state.historyIndex = nextIndex;
    }

    terminalInput.value = state.history[state.historyIndex] || "";
    updateInputWidth();
    const length = terminalInput.value.length;
    terminalInput.setSelectionRange(length, length);
  }

  async function submitCommand(rawCommand = terminalInput.value) {
    const command = String(rawCommand || "").trim();
    if (!command) {
      terminalInput.value = "";
      updateInputWidth();
      resetAutocompleteState();
      renderSuggestions();
      return;
    }

    const effectiveCommand = normalizePorkyInput(command);

    appendCommandLine(command);
    terminalInput.value = "";
    updateInputWidth();
    resetAutocompleteState();

    setBusy(true);

    const renderController = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.activeRenderController = renderController;

    try {
      const isPorkyCommand = /^porky\b/i.test(effectiveCommand) || state.mode === "porky";

      if (isPorkyCommand) {
        await appendPorkyThinkingLine();
      }

      const result = await commandSystem.execute(effectiveCommand, {
        terminalState: state,
        apiClient: terminalApiClient,
        themeManager: terminalThemeManager,
      });

      await outputRenderer.render(result, {
        signal: renderController?.signal,
      });

      if (result?.metadata?.porky) {
        applyPorkyMetadata(result.metadata, command);
      }

      recordHistory(command);
    } catch (error) {
      if (isRenderCancelled(error) || state.cancelRequested) {
        await outputRenderer.render({
          type: "text",
          content: "^C",
        });
        return;
      }

      const fallbackResult =
        typeof error?.toCommandResult === "function"
          ? error.toCommandResult('Type "help" to see available commands.')
          : {
              type: "error",
              content: error?.message || "Unexpected terminal failure",
              metadata: {
                hint: 'Type "help" to see available commands.',
              },
            };

      await outputRenderer.render(fallbackResult);
    } finally {
      state.activeRenderController = null;
      setBusy(false);
      state.cancelRequested = false;
      renderSuggestions();
      focusTerminalInput();
    }
  }

  terminalInput.addEventListener("keydown", async (event) => {
    if (handleTerminalShortcut(event)) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      await submitCommand();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHistory(-1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHistory(1);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      applyAutocompleteSuggestion();
    }
  });

  terminalInput.addEventListener("input", () => {
    updateInputWidth();
    resetAutocompleteState();
    renderSuggestions();
  });

  terminalInput.addEventListener("keyup", renderSuggestions);
  terminalInput.addEventListener("click", renderSuggestions);
  terminalInput.addEventListener("focus", renderSuggestions);

  if (terminalInputRow) {
    terminalInputRow.addEventListener("click", focusTerminalInput);
  }

  if (terminalShell) {
    terminalShell.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;

      if (target?.closest(".terminal-output")) {
        return;
      }

      if (target?.closest("a, button, input, textarea, select, [role='button']")) {
        return;
      }

      focusTerminalInput();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (state.isBusy || terminalShell.contains(document.activeElement) || document.activeElement === terminalInput) {
      handleTerminalShortcut(event);
    }
  });

  window.addEventListener("selectionchange", () => {
    if (document.activeElement === terminalInput) {
      renderSuggestions();
    }
  });

  window.addEventListener("load", () => {
    void fetchAvailableScripts();
    void renderBootSequence();
    updateInputWidth();
    setBusy(false);
    renderSuggestions();
    focusTerminalInput();
  });

  setBusy(true);
  if (terminalThemeManager?.apply) {
    terminalThemeManager.apply();
  }
  void fetchAvailableScripts();
  void renderBootSequence();
  renderSuggestions();
})();
