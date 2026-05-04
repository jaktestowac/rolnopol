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
  const REBOOT_VISUAL_SEQUENCE = [
    {
      type: "ascii",
      content: "╔════════════════════════════════════╗\n║   SYSTEM REBOOT // INITIALIZING    ║\n╚════════════════════════════════════╝",
    },
    { type: "text", content: "Purging console buffer... done" },
    { type: "text", content: "Rebuilding renderer lattice... done" },
    { type: "text", content: "Reseeding prompt and session rails... done" },
    { type: "ascii", content: "[████████████░░░░░░░░] 60% · boot image warming" },
    { type: "text", content: "Spawning a fresh shell surface..." },
  ];

  // Scripts are provided by the backend API. We'll fetch them on startup.

  const terminalShell = document.getElementById("terminalShell");
  const terminalOutput = document.getElementById("terminalOutput");
  const terminalInput = document.getElementById("terminalInput");
  const terminalPrompt = document.querySelector(".terminal-input-row .terminal-prompt");
  const terminalInputRow = document.querySelector(".terminal-input-row");
  const terminalSuggestions = document.getElementById("terminalSuggestions");
  const terminalStatus = document.getElementById("terminalStatus");
  const terminalHeaderLights = document.getElementById("terminalCloseLights");
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
    availableFiles: [],
    availableAssets: [],
    currentPath: "/",
    activePrompt: null,
    rebootInProgress: false,
    glitchResetTimer: null,
    rebootPhaseTimer: null,
    rebootResetTimer: null,
    rebootSequenceId: 0,
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

  function syncInputRowMode() {
    const promptState = state.activePrompt;
    const isPrompting = !!promptState;
    const isPasswordPrompt = promptState?.kind === "password";

    if (terminalInputRow) {
      terminalInputRow.classList.toggle("is-prompting", isPrompting);
    }

    if (terminalPrompt) {
      terminalPrompt.textContent = promptState?.label || PROMPT;
      terminalPrompt.classList.toggle("terminal-prompt--active", isPrompting);
    }

    terminalInput.classList.toggle("is-password-prompt", isPasswordPrompt);
    terminalInput.type = "text";
    terminalInput.inputMode = "text";
    terminalInput.autocomplete = "off";
    terminalInput.setAttribute("autocomplete", "off");
    terminalInput.setAttribute("autocapitalize", "off");
    terminalInput.setAttribute("autocorrect", "off");
    terminalInput.setAttribute("spellcheck", "false");
    terminalInput.placeholder = promptState?.placeholder || "";
    terminalInput.disabled = (state.isBusy || state.rebootInProgress) && !isPrompting;
  }

  function appendTerminalNotice(
    text,
    className = "terminal-entry terminal-entry--response terminal-entry--muted terminal-entry--prompt-message",
  ) {
    const content = String(text || "").trim();
    if (!content) {
      return;
    }

    const entry = document.createElement("div");
    entry.className = className;
    entry.textContent = content;
    terminalOutput.appendChild(entry);
    scrollToBottom();
  }

  function clearActivePrompt() {
    state.activePrompt = null;
    syncInputRowMode();
    terminalInput.value = "";
    updateInputWidth();
    renderSuggestions();
    focusTerminalInput();
  }

  function beginTerminalPrompt(options = {}) {
    if (state.activePrompt) {
      return Promise.resolve({ submitted: false, cancelled: true });
    }

    return new Promise((resolve) => {
      const promptState = {
        kind: options.kind || "text",
        label: options.label || "input:",
        message: options.message || "",
        placeholder: options.placeholder || "",
        defaultValue: options.defaultValue || "",
        echoResponse: options.echoResponse !== false,
        formatResponse: typeof options.formatResponse === "function" ? options.formatResponse : null,
        normalizeResponse: typeof options.normalizeResponse === "function" ? options.normalizeResponse : null,
        resolve,
      };

      state.activePrompt = promptState;
      syncInputRowMode();

      if (promptState.message) {
        appendTerminalNotice(promptState.message);
      }

      terminalInput.value = promptState.defaultValue;
      updateInputWidth();
      renderSuggestions();
      focusTerminalInput();
    });
  }

  function submitActivePrompt(cancelled = false) {
    const promptState = state.activePrompt;
    if (!promptState) {
      return Promise.resolve({ submitted: false, cancelled: false });
    }

    const rawValue = String(terminalInput.value || "");
    const normalizedValue = promptState.normalizeResponse ? promptState.normalizeResponse(rawValue) : rawValue.trim();
    const displayValue =
      cancelled || !promptState.echoResponse
        ? promptState.formatResponse
          ? promptState.formatResponse(rawValue, normalizedValue)
          : promptState.kind === "password"
            ? "[hidden]"
            : normalizedValue
        : normalizedValue;

    if (!cancelled) {
      const responseText = String(displayValue == null ? "" : displayValue).trim();
      if (responseText) {
        appendTerminalNotice(
          `${promptState.label} ${responseText}`,
          "terminal-entry terminal-entry--response terminal-entry--prompt-response",
        );
      }
    }

    state.activePrompt = null;
    syncInputRowMode();
    terminalInput.value = "";
    updateInputWidth();
    renderSuggestions();
    focusTerminalInput();

    promptState.resolve({
      submitted: !cancelled,
      cancelled,
      value: normalizedValue,
      rawValue,
    });

    return Promise.resolve({
      submitted: !cancelled,
      cancelled,
      value: normalizedValue,
      rawValue,
    });
  }

  function requestTerminalTextPrompt(options = {}) {
    return beginTerminalPrompt({
      ...options,
      kind: "text",
      echoResponse: options.echoResponse !== false,
    });
  }

  function requestTerminalPasswordPrompt(options = {}) {
    return beginTerminalPrompt({
      ...options,
      kind: "password",
      label: options.label || "password:",
      placeholder: options.placeholder || "Enter password",
      echoResponse: false,
      formatResponse: () => "[hidden]",
    });
  }

  function requestTerminalConfirmation(options = {}) {
    const defaultAffirmative = options.defaultValue === true;
    return beginTerminalPrompt({
      ...options,
      kind: "confirm",
      label: options.label || "confirm [y/N]:",
      placeholder: options.placeholder || "y / n",
      defaultValue: defaultAffirmative ? "y" : "n",
      normalizeResponse: (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (!normalized) {
          return defaultAffirmative;
        }

        if (["y", "yes", "true", "1"].includes(normalized)) {
          return true;
        }

        if (["n", "no", "false", "0"].includes(normalized)) {
          return false;
        }

        return defaultAffirmative;
      },
      formatResponse: (_, normalizedValue) => (normalizedValue ? "yes" : "no"),
    });
  }

  function isProtectedResourceError(result) {
    return (
      String(result?.metadata?.code || "")
        .trim()
        .toUpperCase() === "PASSWORD_REQUIRED"
    );
  }

  function appendPromptLine(promptText) {
    const text = String(promptText || "").trim();
    if (!text) {
      return;
    }

    appendTerminalNotice(text, "terminal-entry terminal-entry--response terminal-entry--muted terminal-entry--prompt-line");
  }

  function hasPasswordFlag(parsedCommand) {
    return parsedCommand && Object.prototype.hasOwnProperty.call(parsedCommand.flags || {}, "password");
  }

  function buildPasswordRetryCommand(rawCommand, password) {
    const baseCommand = String(rawCommand || "").trim();
    const secret = String(password || "").trim();

    if (!baseCommand || !secret) {
      return "";
    }

    return `${baseCommand} --password ${JSON.stringify(secret)}`;
  }

  function promptForProtectedResource(result) {
    return requestTerminalPasswordPrompt({
      label: "password:",
      message: result?.metadata?.hint || "Access requires a password.",
      placeholder: "Enter password",
      defaultValue: "",
    });
  }

  function normalizeTerminalEffect(effect) {
    if (!effect) {
      return null;
    }

    if (typeof effect === "string") {
      const normalizedKind = effect.trim().toLowerCase();
      if (normalizedKind === "glitch") {
        return { kind: "glitch", durationMs: 3200, label: "glitch" };
      }

      if (normalizedKind === "reboot") {
        return { kind: "reboot", durationMs: 5200, glitchDurationMs: 1800, rebootDurationMs: 3400, label: "reboot" };
      }

      return null;
    }

    if (typeof effect === "boolean") {
      return effect ? { kind: "glitch", durationMs: 3200 } : null;
    }

    if (typeof effect !== "object") {
      return null;
    }

    const kind = String(effect.kind || effect.type || effect.name || "")
      .trim()
      .toLowerCase();
    if (kind !== "glitch" && kind !== "reboot") {
      return null;
    }

    const rawDuration = Number(effect.durationMs ?? effect.duration ?? 3200);
    const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.max(500, Math.floor(rawDuration)) : 3200;

    if (kind === "reboot") {
      const rawRebootDuration = Number(effect.rebootDurationMs ?? effect.outroDurationMs);
      const rawGlitchDuration = Number(
        effect.glitchDurationMs ??
          effect.introDurationMs ??
          (Number.isFinite(rawRebootDuration) && rawRebootDuration > 0 ? durationMs - rawRebootDuration : Math.round(durationMs * 0.35)),
      );
      const glitchDurationMs =
        Number.isFinite(rawGlitchDuration) && rawGlitchDuration > 0
          ? Math.max(500, Math.min(Math.floor(rawGlitchDuration), Math.max(500, durationMs - 800)))
          : Math.max(500, Math.min(Math.round(durationMs * 0.35), Math.max(500, durationMs - 800)));

      return {
        kind: "reboot",
        durationMs,
        glitchDurationMs,
        rebootDurationMs:
          Number.isFinite(rawRebootDuration) && rawRebootDuration > 0
            ? Math.max(500, Math.floor(rawRebootDuration))
            : Math.max(500, durationMs - glitchDurationMs),
        label: String(effect.label || effect.message || "reboot").trim() || "reboot",
      };
    }

    return {
      kind: "glitch",
      durationMs,
      label: String(effect.label || effect.message || "glitch").trim() || "glitch",
    };
  }

  function getTerminalEffectFromResult(result) {
    const candidates = [result, result?.metadata, result?.metadata?.file, result?.metadata?.asset, result?.metadata?.resource];

    for (const candidate of candidates) {
      const effect = normalizeTerminalEffect(candidate?.effect);
      if (effect) {
        return effect;
      }
    }

    return null;
  }

  function clearTerminalEffect() {
    if (state.glitchResetTimer) {
      window.clearTimeout(state.glitchResetTimer);
      state.glitchResetTimer = null;
    }

    if (state.rebootPhaseTimer) {
      window.clearTimeout(state.rebootPhaseTimer);
      state.rebootPhaseTimer = null;
    }

    if (state.rebootResetTimer) {
      window.clearTimeout(state.rebootResetTimer);
      state.rebootResetTimer = null;
    }

    state.rebootInProgress = false;
    terminalShell.classList.remove("is-glitching");
    terminalShell.classList.remove("is-rebooting");
    document.documentElement.classList.remove("terminal-glitch-active");
    document.documentElement.classList.remove("terminal-reboot-active");
  }

  function clearTerminalGlitch() {
    clearTerminalEffect();
  }

  function triggerTerminalGlitch(effect = {}) {
    const normalized = normalizeTerminalEffect(effect) || { kind: "glitch", durationMs: 3200 };

    clearTerminalEffect();
    terminalShell.classList.add("is-glitching");
    document.documentElement.classList.add("terminal-glitch-active");

    const durationMs = Number.isFinite(normalized.durationMs) ? Math.max(500, Math.floor(normalized.durationMs)) : 3200;
    state.glitchResetTimer = window.setTimeout(() => {
      clearTerminalEffect();
    }, durationMs);
  }

  function triggerTerminalReboot(effect = {}) {
    const normalized = normalizeTerminalEffect(effect) || {
      kind: "reboot",
      durationMs: 5200,
      glitchDurationMs: 1800,
      rebootDurationMs: 3400,
      label: "reboot",
    };

    clearTerminalEffect();
    state.rebootInProgress = true;
    state.rebootSequenceId += 1;
    const sequenceId = state.rebootSequenceId;
    setBusy(true);
    terminalShell.classList.add("is-glitching");
    document.documentElement.classList.add("terminal-glitch-active");
    setStatus("rebooting");

    const totalDurationMs = Number.isFinite(normalized.durationMs) ? Math.max(500, Math.floor(normalized.durationMs)) : 5200;
    const glitchDurationMs = Number.isFinite(normalized.glitchDurationMs)
      ? Math.max(500, Math.min(Math.floor(normalized.glitchDurationMs), Math.max(500, totalDurationMs - 800)))
      : Math.max(500, Math.min(Math.round(totalDurationMs * 0.35), Math.max(500, totalDurationMs - 800)));

    state.rebootPhaseTimer = window.setTimeout(() => {
      terminalShell.classList.remove("is-glitching");
      document.documentElement.classList.remove("terminal-glitch-active");
      terminalShell.classList.add("is-rebooting");
      document.documentElement.classList.add("terminal-reboot-active");
      if (sequenceId === state.rebootSequenceId && state.rebootInProgress) {
        void renderRebootVisualSequence(sequenceId, normalized);
      }
      setStatus("rebooting");
      state.rebootPhaseTimer = null;
    }, glitchDurationMs);

    state.rebootResetTimer = window.setTimeout(() => {
      state.rebootSequenceId += 1;
      void (async () => {
        resetTerminalState();
        outputRenderer.clear();
        bootSequenceRendered = false;
        await renderBootSequence({ force: true });
        await refreshAutocompleteResources();
        setBusy(false);
        setStatus("ready");
        state.rebootResetTimer = null;
      })();
    }, totalDurationMs);
  }

  function applyResultSideEffects(result, originalCommand, commandName = "") {
    if (
      result?.metadata?.path &&
      String(commandName || "")
        .trim()
        .toLowerCase() === "cd"
    ) {
      state.currentPath = String(result.metadata.path || state.currentPath || "/");
    }

    if (result?.metadata?.porky) {
      applyPorkyMetadata(result.metadata, originalCommand);
    }

    const terminalEffect = getTerminalEffectFromResult(result);
    if (terminalEffect?.kind === "reboot") {
      triggerTerminalReboot(terminalEffect);
    } else if (terminalEffect) {
      triggerTerminalGlitch(terminalEffect);
    }
  }

  function getTerminalContextSummary() {
    const themeState = terminalThemeManager?.getState?.() || {};

    return {
      mode: state.mode,
      theme: themeState.themeName || "green",
      effectsEnabled: themeState.effectsEnabled !== false,
      reducedMotion: themeState.reducedMotion === true,
      currentPath: state.currentPath || "/operator/terminal.html",
      recentCommands: state.history.slice(-6),
      availableCommands: commandSystem.registry.list().map((command) => ({
        name: command.name,
        description: command.description,
        usage: command.usage,
        category: command.category,
      })),
      availableScripts: Array.isArray(state.availableScripts) ? state.availableScripts : [],
      availableFiles: Array.isArray(state.availableFiles) ? state.availableFiles : [],
      availableAssets: Array.isArray(state.availableAssets) ? state.availableAssets : [],
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

  function normalizeCurrentLevelEntries(rows) {
    return Array.isArray(rows)
      ? rows
          .map((row) => ({
            path: String(row?.path || "").trim(),
            title: String(row?.title || row?.name || row?.path || "").trim(),
            type: String(row?.type || "file").trim() || "file",
            locked: row?.locked === true,
            access: row?.access || "public",
          }))
          .filter((entry) => !!entry.path)
      : [];
  }

  async function fetchCurrentLevelResources() {
    if (!terminalApiClient || typeof terminalApiClient.executeCommand !== "function") {
      state.availableFiles = [];
      state.availableAssets = [];
      return;
    }

    try {
      const data = await terminalApiClient.executeCommand("ls", {
        sessionId: state.sessionId,
        context: {
          currentPath: state.currentPath,
        },
      });

      const rows = Array.isArray(data?.result?.metadata?.rows) ? data.result.metadata.rows : [];
      const entries = normalizeCurrentLevelEntries(rows);
      state.availableFiles = entries;
      state.availableAssets = entries.filter((entry) => entry.type === "asset");
    } catch (err) {
      state.availableFiles = [];
      state.availableAssets = [];
    }

    renderSuggestions();
  }

  async function refreshAutocompleteResources() {
    await Promise.all([fetchAvailableScripts(), fetchCurrentLevelResources()]);
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

    if (state.activePrompt) {
      const promptState = state.activePrompt;
      terminalSuggestions.textContent =
        promptState.kind === "password"
          ? `${promptState.message || "Password required."} • Type the password and press Enter • Ctrl+C cancels`
          : promptState.kind === "confirm"
            ? `${promptState.message || "Confirmation required."} • Type y or n and press Enter • Ctrl+C cancels`
            : `${promptState.message || "Enter a response."} • Press Enter to continue • Ctrl+C cancels`;
      return;
    }

    if (state.rebootInProgress) {
      terminalSuggestions.textContent = "Rebooting terminal core… please wait for the fresh shell to return.";
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
      terminalState: state,
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
      terminalState: state,
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
    const shouldAppendSpace = after.length === 0 && match.appendSpace !== false;

    state.autocompleteState = {
      prefix: before,
      suffix: after,
      trailingSpace: shouldAppendSpace ? " " : "",
      appendSpace: shouldAppendSpace,
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
      if (!state.isBusy && !state.rebootInProgress) {
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
    syncInputRowMode();
    terminalShell?.setAttribute("aria-busy", isBusy ? "true" : "false");
    terminalShell?.classList.toggle("is-busy", isBusy);
    setStatus(isBusy ? "busy" : state.rebootInProgress ? "rebooting" : "ready");
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

  async function renderBootSequence({ force = false, sequence = STATIC_BOOT_SEQUENCE } = {}) {
    if (bootSequenceRendered && !force) {
      return;
    }

    bootSequenceRendered = true;
    outputRenderer.clear();
    for (const entry of sequence) {
      // eslint-disable-next-line no-await-in-loop
      await outputRenderer.render(entry);
    }
    setStatus("ready");
    updateInputWidth();
  }

  const waitForMs = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function resetTerminalState() {
    state.history.length = 0;
    state.historyIndex = -1;
    state.mode = "shell";
    state.porkySessionId = "";
    state.porkyConversation = [];
    state.cancelRequested = false;
    state.autocompleteState = null;
    state.availableScripts = [];
    state.availableFiles = [];
    state.availableAssets = [];
    state.currentPath = "/";
    state.activePrompt = null;
    state.activeRenderController?.abort?.();
    state.activeRenderController = null;
    resetPorkyState();
    clearTerminalEffect();
    terminalInput.value = "";
    updateInputWidth();
    syncInputRowMode();
    renderSuggestions();
  }

  async function renderRebootVisualSequence(sequenceId, effect = {}) {
    outputRenderer.clear();
    bootSequenceRendered = false;
    terminalInput.value = "";
    updateInputWidth();
    renderSuggestions();

    const label = String(effect?.label || "reboot").trim() || "reboot";
    const title = label.toUpperCase();
    const visuals = [
      {
        type: "ascii",
        content: `╔════════════════════════════════════╗\n║   ${title.padEnd(30)}║\n╚════════════════════════════════════╝`,
      },
      ...REBOOT_VISUAL_SEQUENCE,
      { type: "ascii", content: "[████████████████████] 100% · terminal shell ready" },
    ];

    for (const entry of visuals) {
      if (sequenceId !== state.rebootSequenceId || !state.rebootInProgress) {
        return;
      }

      // eslint-disable-next-line no-await-in-loop
      await outputRenderer.render(entry);
      if (sequenceId !== state.rebootSequenceId || !state.rebootInProgress) {
        return;
      }

      // eslint-disable-next-line no-await-in-loop
      await waitForMs(180);
    }
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
    if (state.activePrompt) {
      return submitActivePrompt(false);
    }

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
      const parsedCommand = commandSystem.parse?.(effectiveCommand) || { flags: {} };
      const parsedCommandName = String(parsedCommand.commandName || "")
        .trim()
        .toLowerCase();
      const previousPath = state.currentPath;

      if (isPorkyCommand) {
        await appendPorkyThinkingLine();
      }

      let result = await commandSystem.execute(effectiveCommand, {
        terminalState: state,
        apiClient: terminalApiClient,
        themeManager: terminalThemeManager,
      });

      if (isProtectedResourceError(result) && !hasPasswordFlag(parsedCommand)) {
        const promptResponse = await promptForProtectedResource(result);

        if (promptResponse?.cancelled) {
          await outputRenderer.render({
            type: "text",
            content: "^C",
          });
          return;
        }

        if (promptResponse?.submitted && promptResponse.value) {
          const retryCommand = buildPasswordRetryCommand(effectiveCommand, promptResponse.value);
          if (retryCommand) {
            result = await commandSystem.execute(retryCommand, {
              terminalState: state,
              apiClient: terminalApiClient,
              themeManager: terminalThemeManager,
            });
          }
        }
      }

      await outputRenderer.render(result, {
        signal: renderController?.signal,
      });

      applyResultSideEffects(result, command, parsedCommandName);

      if (parsedCommandName === "cd" || parsedCommandName === "sync" || previousPath !== state.currentPath) {
        void refreshAutocompleteResources();
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
    if (state.activePrompt) {
      if (event.key === "Enter") {
        event.preventDefault();
        await submitActivePrompt(false);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        await submitActivePrompt(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "c") {
        event.preventDefault();
        await submitActivePrompt(true);
        return;
      }

      return;
    }

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

  // Header lights act as a close button to return to the main page
  if (terminalHeaderLights) {
    terminalHeaderLights.addEventListener("click", (event) => {
      event.preventDefault();
      // Don't navigate away while rebooting or a busy command is running
      if (state.rebootInProgress || state.isBusy) {
        return;
      }

      try {
        clearTerminalEffect();
        resetTerminalState();
        outputRenderer.clear();
        bootSequenceRendered = false;
      } finally {
        // Navigate back to the main page
        window.location.href = "/";
      }
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
    void refreshAutocompleteResources();
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
  void refreshAutocompleteResources();
  void renderBootSequence();
  renderSuggestions();
})();
