(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TerminalCommandSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const CATEGORY_ORDER = {
    system: 0,
    content: 1,
    debug: 2,
    script: 3,
    hidden: 4,
  };

  function toStringValue(value) {
    return value == null ? "" : String(value);
  }

  function coerceFlagValue(value) {
    const normalized = toStringValue(value).trim();

    if (normalized === "true") return true;
    if (normalized === "false") return false;

    return normalized;
  }

  function tokenizeCommandInput(rawInput) {
    const input = toStringValue(rawInput).trim();
    if (!input) return [];

    const tokens = [];
    let current = "";
    let quote = null;
    let escaped = false;

    for (const char of input) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (quote) {
        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === quote) {
          quote = null;
          continue;
        }

        current += char;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }

        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  function parseTerminalInput(rawInput) {
    const raw = toStringValue(rawInput);
    const tokens = tokenizeCommandInput(raw);

    if (tokens.length === 0) {
      return {
        commandName: "",
        args: [],
        flags: {},
        rawInput: raw,
      };
    }

    const [commandName, ...rest] = tokens;
    const args = [];
    const flags = {};

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];

      if (token.startsWith("--") && token.length > 2) {
        const flagBody = token.slice(2);
        const equalsIndex = flagBody.indexOf("=");

        if (equalsIndex >= 0) {
          const key = flagBody.slice(0, equalsIndex).trim();
          const value = flagBody.slice(equalsIndex + 1).trim();
          if (key) {
            flags[key] = coerceFlagValue(value);
          }
          continue;
        }

        const key = flagBody.trim();
        const nextToken = rest[index + 1];

        if (key && nextToken && !nextToken.startsWith("-")) {
          flags[key] = coerceFlagValue(nextToken);
          index += 1;
        } else if (key) {
          flags[key] = true;
        }

        continue;
      }

      if (token.startsWith("-") && token.length > 1) {
        const shorts = token.slice(1).split("");

        if (shorts.length === 1) {
          const shortKey = shorts[0];
          const nextToken = rest[index + 1];

          if (nextToken && !nextToken.startsWith("-")) {
            flags[shortKey] = coerceFlagValue(nextToken);
            index += 1;
          } else {
            flags[shortKey] = true;
          }
        } else {
          shorts.forEach((shortKey) => {
            flags[shortKey] = true;
          });
        }

        continue;
      }

      args.push(token);
    }

    return {
      commandName,
      args,
      flags,
      rawInput: raw,
    };
  }

  function isHiddenCommand(command) {
    return command?.category === "hidden" || command?.hidden === true;
  }

  function compareCommands(a, b) {
    const categoryA = CATEGORY_ORDER[a.category] ?? CATEGORY_ORDER.system;
    const categoryB = CATEGORY_ORDER[b.category] ?? CATEGORY_ORDER.system;

    if (categoryA !== categoryB) {
      return categoryA - categoryB;
    }

    return a.name.localeCompare(b.name);
  }

  function formatHelpText(commands) {
    const list = Array.isArray(commands) ? commands : [];

    if (list.length === 0) {
      return "No commands are available.";
    }

    const nameWidth = Math.max(...list.map((command) => command.name.length), 7) + 2;
    const lines = ["Available commands:", ""];

    list.forEach((command) => {
      lines.push(`${command.name.padEnd(nameWidth)}${command.description}`);
    });

    return lines.join("\n");
  }

  function formatHistoryText(history) {
    const list = Array.isArray(history) ? history.filter((entry) => toStringValue(entry).trim()) : [];

    if (list.length === 0) {
      return "No command history yet.";
    }

    return ["Command history:", "", ...list.map((entry, index) => `${String(index + 1).padStart(2, "0")}. ${entry}`)].join("\n");
  }

  function formatThemeList(themeManager) {
    const themes = typeof themeManager?.listThemes === "function" ? themeManager.listThemes() : [];

    if (themes.length === 0) {
      return "No themes are available.";
    }

    return [
      "Available themes:",
      "",
      ...themes.map((theme) => `${theme.name.padEnd(10)}${theme.label}${theme.description ? ` — ${theme.description}` : ""}`),
    ].join("\n");
  }

  function formatThemeStatus(themeManager) {
    const state = typeof themeManager?.getState === "function" ? themeManager.getState() : null;
    const currentTheme = typeof themeManager?.describeTheme === "function" ? themeManager.describeTheme(state?.themeName) : null;
    const effectsText = state?.effectsEnabled ? "enabled" : "disabled";
    const motionText = state?.reducedMotion ? "reduced-motion preference active" : "full motion allowed";

    return [
      `Current theme: ${currentTheme?.label || state?.themeName || "unknown"}`,
      `Theme id: ${state?.themeName || "unknown"}`,
      `Visual effects: ${effectsText}`,
      `Motion mode: ${motionText}`,
      "",
      'Use "theme list" to see all themes or "theme <name>" to switch.',
      'Use "effects on" or "effects off" to toggle CRT-style effects.',
    ].join("\n");
  }

  const AUTOCOMPLETE_SUGGESTION_LIMIT = 6;

  function clampCursorIndex(cursorIndex, inputLength) {
    const numericIndex = Number(cursorIndex);
    if (!Number.isFinite(numericIndex)) {
      return inputLength;
    }

    return Math.max(0, Math.min(inputLength, Math.floor(numericIndex)));
  }

  function getTokenBounds(input, cursorIndex) {
    const text = toStringValue(input);
    const safeCursor = clampCursorIndex(cursorIndex, text.length);

    let start = safeCursor;
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) {
      start -= 1;
    }

    let end = safeCursor;
    while (end < text.length && !/\s/.test(text.charAt(end))) {
      end += 1;
    }

    return {
      start,
      end,
      token: text.slice(start, end),
      cursorIndex: safeCursor,
    };
  }

  function createSuggestionEntry(value, description = "", extra = {}) {
    return {
      value,
      label: value,
      description: toStringValue(description),
      ...extra,
    };
  }

  function describeCommandUsage(command, themeManager) {
    if (!command) {
      return 'Type "help" to see available commands.';
    }

    const commandName = toStringValue(command.name || command.value).trim();
    const description = command.description || command.label || "";

    if (commandName === "theme") {
      const themes = typeof themeManager?.listThemes === "function" ? themeManager.listThemes().map((theme) => theme.name) : [];

      return ["Usage: theme <name>", themes.length > 0 ? `Themes: ${themes.join(", ")}` : null].filter(Boolean).join(". ");
    }

    if (commandName === "effects") {
      return "Usage: effects on|off|toggle";
    }

    if (command.usage) {
      return `Usage: ${command.usage}`;
    }

    if (Array.isArray(command.examples) && command.examples.length > 0) {
      return `Example: ${command.examples[0]}`;
    }

    return description;
  }

  function getArgumentSuggestions(command, themeManager, query = "") {
    const normalizedQuery = toStringValue(query).trim().toLowerCase();

    if (!command) {
      return [];
    }

    if (command.name === "theme") {
      const themes = typeof themeManager?.listThemes === "function" ? themeManager.listThemes() : [];

      return themes
        .filter((theme) => !normalizedQuery || theme.name.startsWith(normalizedQuery))
        .slice(0, AUTOCOMPLETE_SUGGESTION_LIMIT)
        .map((theme) => createSuggestionEntry(theme.name, theme.description || theme.label || theme.name, { kind: "theme" }));
    }

    if (command.name === "effects") {
      return ["on", "off", "toggle"]
        .filter((value) => !normalizedQuery || value.startsWith(normalizedQuery))
        .slice(0, AUTOCOMPLETE_SUGGESTION_LIMIT)
        .map((value) =>
          createSuggestionEntry(
            value,
            value === "on" ? "Enable CRT-style effects" : value === "off" ? "Disable CRT-style effects" : "Switch between on and off",
            { kind: "effect" },
          ),
        );
    }

    return [];
  }

  function suggestTerminalInput(rawInput, options = {}) {
    const registry = options.registry instanceof TerminalCommandRegistry ? options.registry : null;

    if (!registry) {
      return null;
    }

    const input = toStringValue(rawInput);
    const cursorIndex = clampCursorIndex(options.cursorIndex ?? input.length, input.length);
    const bounds = getTokenBounds(input, cursorIndex);
    const includeHidden = options.includeHidden === true;
    const themeManager = options.themeManager || null;
    const commandPrefix = input.slice(0, bounds.start);
    const commandTokens = tokenizeCommandInput(commandPrefix);
    const commandName = toStringValue(commandTokens[0] || "").trim();
    const command = commandName ? registry.resolve(commandName) : null;
    const tokenQuery = bounds.token.trim().toLowerCase();
    const isEditingCommandName = bounds.start === 0;

    if (isEditingCommandName) {
      const matches = registry
        .list({ includeHidden })
        .filter((entry) => !tokenQuery || entry.name.startsWith(tokenQuery))
        .slice(0, AUTOCOMPLETE_SUGGESTION_LIMIT)
        .map((entry) => createSuggestionEntry(entry.name, entry.description, { kind: "command", usage: entry.usage }));

      return {
        kind: "command",
        commandName: "",
        query: bounds.token,
        range: { start: bounds.start, end: bounds.end },
        matches,
        hint:
          matches.length > 0
            ? describeCommandUsage(registry.resolve(matches[0].value) || matches[0], themeManager)
            : 'Type "help" to see available commands.',
        usage: "",
      };
    }

    if (!command) {
      return {
        kind: "hint",
        commandName,
        query: bounds.token,
        range: { start: bounds.start, end: bounds.end },
        matches: [],
        hint: commandName ? `Unknown command: ${commandName}` : 'Type "help" to see available commands.',
        usage: "",
      };
    }

    const matches = getArgumentSuggestions(command, themeManager, bounds.token);

    return {
      kind: matches.length > 0 ? "argument" : "hint",
      commandName: command.name,
      query: bounds.token,
      range: { start: bounds.start, end: bounds.end },
      matches,
      hint: describeCommandUsage(command, themeManager),
      usage: command.usage || "",
    };
  }

  function createThemeCommandResult(themeManager, themeName) {
    const theme = typeof themeManager?.describeTheme === "function" ? themeManager.describeTheme(themeName) : null;

    if (!theme) {
      return buildCommandError(`Unknown theme: ${themeName}`, 'Use "theme list" to see available themes.');
    }

    const state = typeof themeManager?.getState === "function" ? themeManager.getState() : null;

    return {
      type: "text",
      content: [
        `Theme changed to ${theme.label}.`,
        theme.description ? theme.description : null,
        state?.effectsEnabled === false ? "CRT-style effects are currently off." : "CRT-style effects are currently on.",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        theme: theme.name,
        label: theme.label,
        effectsEnabled: state?.effectsEnabled !== false,
      },
    };
  }

  function createEffectsStatusResult(themeManager) {
    const state = typeof themeManager?.getState === "function" ? themeManager.getState() : null;
    return {
      type: "text",
      content: [
        `CRT-style effects are ${state?.effectsEnabled ? "enabled" : "disabled"}.`,
        state?.reducedMotion ? "Reduced-motion preference detected; motion-heavy effects remain suppressed." : "",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        effectsEnabled: state?.effectsEnabled === true,
        reducedMotion: state?.reducedMotion === true,
      },
    };
  }

  function registerThemeCommands(registry, options = {}) {
    const themeManager = options.themeManager;

    if (!themeManager) {
      return registry;
    }

    registry.register({
      name: "theme",
      description: "Show or change the terminal theme",
      usage: "theme <name|list>",
      category: "system",
      examples: ["theme green", "theme list"],
      handler: (context) => {
        const subject = toStringValue(context?.args?.[0]).trim().toLowerCase();

        if (!subject || subject === "status" || subject === "current") {
          return {
            type: "text",
            content: formatThemeStatus(themeManager),
          };
        }

        if (subject === "list") {
          return {
            type: "text",
            content: formatThemeList(themeManager),
          };
        }

        if (subject === "reset") {
          themeManager.reset();
          return createThemeCommandResult(themeManager, themeManager.getCurrentThemeName());
        }

        try {
          themeManager.setTheme(subject);
          return createThemeCommandResult(themeManager, subject);
        } catch (error) {
          if (typeof error?.toCommandResult === "function") {
            return error.toCommandResult('Type "theme list" to see available themes.');
          }

          return buildCommandError(error?.message || `Unknown theme: ${subject}`, 'Type "theme list" to see available themes.', {
            code: error?.code || "THEME_NOT_FOUND",
            theme: subject,
          });
        }
      },
    });

    registry.register({
      name: "effects",
      description: "Toggle CRT-style visual effects",
      usage: "effects <on|off|status|toggle>",
      category: "system",
      examples: ["effects off", "effects on"],
      handler: (context) => {
        const subject = toStringValue(context?.args?.[0]).trim().toLowerCase();

        if (!subject || subject === "status") {
          return createEffectsStatusResult(themeManager);
        }

        if (subject === "toggle") {
          themeManager.toggleEffects();
          return createEffectsStatusResult(themeManager);
        }

        if (subject === "on" || subject === "enable" || subject === "enabled") {
          themeManager.setEffectsEnabled(true);
          return createEffectsStatusResult(themeManager);
        }

        if (subject === "off" || subject === "disable" || subject === "disabled") {
          themeManager.setEffectsEnabled(false);
          return createEffectsStatusResult(themeManager);
        }

        return buildCommandError(`Unknown effects option: ${subject}`, 'Use "effects on", "effects off", or "effects status".');
      },
    });

    return registry;
  }

  function buildCommandError(message, hint, metadata = {}) {
    return {
      type: "error",
      content: message,
      metadata: {
        hint: hint || 'Type "help" to see available commands.',
        ...metadata,
      },
    };
  }

  function buildBackendUnavailableResult(commandName) {
    return buildCommandError(`Backend unavailable for command: ${commandName}`, 'Try local commands such as "help" or "history".');
  }

  function isTerminalApiClient(apiClient) {
    return !!apiClient && typeof apiClient.executeCommand === "function";
  }

  function unwrapBackendCommandData(data) {
    if (!data) {
      return { type: "text", content: "" };
    }

    if (typeof data === "string") {
      return { type: "text", content: data };
    }

    if (typeof data !== "object") {
      return { type: "text", content: toStringValue(data) };
    }

    if (data.type) {
      return data;
    }

    if (data.scriptId && Array.isArray(data.steps)) {
      return { type: "script", ...data, items: data.steps };
    }

    if (data.kind === "image" || data.contentType?.startsWith?.("image/") || data.src) {
      return {
        type: "image",
        src: data.src || data.url || data.content || "",
        alt: data.alt || data.title || data.name || "Terminal image",
        metadata: data,
      };
    }

    if (data.kind === "table" || Array.isArray(data.rows)) {
      return { type: "table", content: data, metadata: data };
    }

    if (data.kind === "json" || Array.isArray(data) || data.commands || data.files || data.assets || data.scripts) {
      return { type: "json", content: data, metadata: data };
    }

    return { type: "text", content: toStringValue(data.content || data.message || JSON.stringify(data)), metadata: data };
  }

  async function handleBackendCommand(context, commandName, handler) {
    const apiClient = context?.apiClient;
    if (!isTerminalApiClient(apiClient)) {
      return buildBackendUnavailableResult(commandName);
    }

    try {
      const result = await handler(apiClient);
      const payload =
        result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "result") ? result.result : result;
      return normalizeCommandResult(unwrapBackendCommandData(payload));
    } catch (error) {
      if (typeof error?.toCommandResult === "function") {
        return error.toCommandResult('Type "help" to see available commands.');
      }

      return buildCommandError(
        error?.message || `Backend command failed: ${commandName}`,
        'Type "sync" to refresh backend data or try local commands.',
        {
          code: error?.code || "BACKEND_COMMAND_FAILED",
          status: error?.status || 0,
        },
      );
    }
  }

  function resourceToResult(resource, fallbackLabel) {
    if (!resource) {
      return buildCommandError(
        `${fallbackLabel} not found`,
        'Type "list scripts", "list files", or "list assets" to explore available resources.',
      );
    }

    if (resource.type === "script") {
      return {
        type: "script",
        title: resource.title || resource.name,
        items: Array.isArray(resource.steps) ? resource.steps : Array.isArray(resource.items) ? resource.items : [],
        metadata: resource,
      };
    }

    if (resource.type === "image" || resource.contentType?.startsWith?.("image/") || resource.src) {
      return {
        type: "image",
        src: resource.src || resource.url || resource.content || "",
        alt: resource.alt || resource.title || fallbackLabel,
        metadata: resource,
      };
    }

    if (resource.type === "table" || Array.isArray(resource.rows)) {
      return { type: "table", content: resource, metadata: resource };
    }

    if (resource.type === "json" || resource.kind === "json") {
      return { type: "json", content: resource.content || resource.data || resource, metadata: resource };
    }

    return { type: "text", content: resource.content || resource.message || toStringValue(resource), metadata: resource };
  }

  function splitCommandTarget(args) {
    return Array.isArray(args) ? args.join(" ").trim() : "";
  }

  function buildPorkyTerminalContext(context) {
    const terminalState = context?.terminalState || {};
    const themeState = typeof context?.themeManager?.getState === "function" ? context.themeManager.getState() : null;
    const availableCommands = typeof context?.registry?.list === "function" ? context.registry.list() : [];

    return {
      terminal: {
        mode: toStringValue(terminalState.mode || "shell").trim() || "shell",
        theme: toStringValue(themeState?.themeName || terminalState.theme || "green").trim() || "green",
        effectsEnabled: themeState?.effectsEnabled !== false,
        reducedMotion: themeState?.reducedMotion === true,
        currentPath: toStringValue(terminalState.currentPath || "/operator/terminal.html").trim() || "/operator/terminal.html",
        recentCommands: Array.isArray(terminalState.history) ? terminalState.history.slice(-6) : [],
        availableCommands: availableCommands.map((command) => ({
          name: command.name,
          description: command.description,
          usage: command.usage,
          category: command.category,
        })),
        availableScripts: Array.isArray(terminalState.availableScripts) ? terminalState.availableScripts.slice(-6) : [],
        availableFiles: Array.isArray(terminalState.availableFiles) ? terminalState.availableFiles.slice(-6) : [],
        unlockedScripts: Array.isArray(terminalState.unlockedScripts) ? terminalState.unlockedScripts.slice(-6) : [],
        unlockedFiles: Array.isArray(terminalState.unlockedFiles) ? terminalState.unlockedFiles.slice(-6) : [],
        mission: toStringValue(terminalState.mission || "").trim(),
      },
      conversation: Array.isArray(terminalState.porkyConversation) ? terminalState.porkyConversation.slice(-8) : [],
    };
  }

  function formatPorkyTranscriptLine(speaker, message) {
    const label = `${toStringValue(speaker).trim() || "porky"}>`;
    const lines = toStringValue(message).split("\n");
    if (lines.length === 0) {
      return label;
    }

    return [label + (lines[0] ? ` ${lines[0]}` : ""), ...lines.slice(1).map((line) => `  ${line}`)].join("\n");
  }

  function formatPorkyStatusText(status = {}) {
    const lines = [
      "Porky status:",
      `provider: ${status.provider || "unknown"}`,
      `model: ${status.model || "unknown"}`,
      `session: ${status.active ? "awake" : "idle"}`,
      `mode: ${status.mode || "shell"}`,
      `theme: ${status.theme || "green"}`,
      `messages: ${status.conversationMessages ?? 0}/${status.messageLimit ?? 10}`,
      `estimated tokens: ${status.estimatedTokenUsage ?? 0}/${status.estimatedTokenLimit ?? 2400} (${status.estimatedTokenUsagePercent ?? 0}%)`,
      `token remaining: ${status.estimatedTokenRemaining ?? 0}`,
      `recent commands: ${status.recentCommands ?? 0}/${status.recentCommandsLimit ?? 6}`,
      `max message length: ${status.maxMessageLength ?? 1024}`,
    ];

    return lines.join("\n");
  }

  function registerBackendTerminalCommands(registry) {
    function tryRegister(def) {
      try {
        if (registry.resolve(def.name)) {
          // Skip registration if a local/previous command exists with same name
          return null;
        }
        return registry.register(def);
      } catch (err) {
        // If registration fails for any reason, skip to avoid breaking startup
        return null;
      }
    }

    tryRegister({
      name: "run",
      description: "Run predefined backend script",
      usage: "run <script-name>",
      category: "script",
      requiresBackend: true,
      examples: ["run boot-sequence"],
      handler: (context) => {
        const scriptId = splitCommandTarget(context?.args);
        if (!scriptId) {
          return buildCommandError("Usage: run <script-name>", 'Try "list scripts" to see available scripts.');
        }

        return handleBackendCommand(context, "run", async (apiClient) => {
          const script = await apiClient.getScript(scriptId);
          return resourceToResult(script, scriptId);
        });
      },
    });

    tryRegister({
      name: "open",
      description: "Display a backend asset or virtual file",
      aliases: ["cat"],
      usage: "open <asset-or-file>",
      category: "content",
      requiresBackend: true,
      examples: ["open signal-image", "open logs/system.log"],
      handler: (context) => {
        const target = splitCommandTarget(context?.args);
        if (!target) {
          return buildCommandError("Usage: open <asset-or-file>", 'Try "list assets" or "list files" to find something to open.');
        }

        return handleBackendCommand(context, "open", async (apiClient) => {
          try {
            return await apiClient.getAsset(target);
          } catch (assetError) {
            try {
              return await apiClient.getVirtualFile(target);
            } catch (fileError) {
              throw fileError?.status === 404 ? assetError : fileError;
            }
          }
        });
      },
    });

    tryRegister({
      name: "list",
      description: "List backend scripts, files, or assets",
      usage: "list <scripts|files|assets>",
      category: "system",
      requiresBackend: true,
      examples: ["list scripts", "list files", "list assets"],
      handler: (context) => {
        const subject = toStringValue(context?.args?.[0]).trim().toLowerCase();

        if (!subject) {
          return buildCommandError("Usage: list <scripts|files|assets>", "Example: list scripts");
        }

        return handleBackendCommand(context, "list", async (apiClient) => {
          if (subject === "scripts") return apiClient.listScripts();
          if (subject === "files") return apiClient.listFiles();
          if (subject === "assets") return apiClient.listAssets();

          return buildCommandError(`Unknown list target: ${subject}`, 'Try "list scripts", "list files", or "list assets".');
        });
      },
    });

    tryRegister({
      name: "inspect",
      description: "Inspect a backend object",
      usage: "inspect <id>",
      category: "debug",
      requiresBackend: true,
      examples: ["inspect boot-sequence"],
      handler: (context) => {
        const target = splitCommandTarget(context?.args);
        if (!target) {
          return buildCommandError("Usage: inspect <id>", 'Try "search <query>" or "list scripts" first.');
        }

        return handleBackendCommand(context, "inspect", async (apiClient) =>
          apiClient.executeCommand(`inspect ${target}`, { terminalState: context.terminalState }),
        );
      },
    });

    tryRegister({
      name: "search",
      description: "Search backend content",
      usage: "search <query>",
      category: "debug",
      requiresBackend: true,
      examples: ["search archive"],
      handler: (context) => {
        const query = splitCommandTarget(context?.args);
        if (!query) {
          return buildCommandError("Usage: search <query>", "Try searching for a script, file, or asset name.");
        }

        return handleBackendCommand(context, "search", async (apiClient) =>
          apiClient.executeCommand(`search ${query}`, { terminalState: context.terminalState }),
        );
      },
    });

    tryRegister({
      name: "mission",
      description: "Start a predefined scenario",
      usage: "mission <name>",
      category: "script",
      requiresBackend: true,
      examples: ["mission intro"],
      handler: (context) => {
        const missionName = splitCommandTarget(context?.args);
        if (!missionName) {
          return buildCommandError("Usage: mission <name>", 'Try "list scripts" to see available missions.');
        }

        return handleBackendCommand(context, "mission", async (apiClient) =>
          apiClient.executeCommand(`mission ${missionName}`, { terminalState: context.terminalState }),
        );
      },
    });

    tryRegister({
      name: "login",
      description: "Start a scripted login flow",
      usage: "login",
      category: "script",
      requiresBackend: true,
      examples: ["login"],
      handler: (context) =>
        handleBackendCommand(context, "login", async (apiClient) =>
          apiClient.executeCommand("login", { terminalState: context.terminalState }),
        ),
    });

    tryRegister({
      name: "sync",
      description: "Refresh backend command metadata",
      usage: "sync",
      category: "debug",
      requiresBackend: true,
      examples: ["sync"],
      handler: (context) =>
        handleBackendCommand(context, "sync", async (apiClient) => {
          const commands = await apiClient.getCommands();
          const commandList = Array.isArray(commands?.commands) ? commands.commands : Array.isArray(commands) ? commands : [];

          return {
            type: "json",
            content: {
              message: "Backend command metadata refreshed",
              commandCount: commandList.length,
              commands: commandList,
            },
            metadata: {
              refreshed: true,
              commandCount: commandList.length,
            },
          };
        }),
    });

    tryRegister({
      name: "porky",
      description: "Talk with Porky, the terminal chatbot",
      usage: "porky [message]",
      category: "content",
      requiresBackend: true,
      examples: ["porky", "porky what is this place?"],
      handler: async (context) => {
        const apiClient = context?.apiClient;
        if (!isTerminalApiClient(apiClient)) {
          return buildBackendUnavailableResult("porky");
        }

        const terminalState = context?.terminalState || {};
        const message = splitCommandTarget(context?.args);
        const wantsExit = /^(exit|quit)$/i.test(message);
        const wantsStatus = /^(status|stats|health)$/i.test(message);
        const requestContext = buildPorkyTerminalContext(context);
        const sessionId = terminalState.porkySessionId || apiClient.getSessionId?.() || terminalState.sessionId || null;

        if (wantsStatus) {
          const response = await apiClient.getPorkyStatus({ sessionId, context: requestContext }, { retries: 0 });

          return normalizeCommandResult({
            type: "text",
            content: formatPorkyStatusText(response?.status || response),
            metadata: {
              porky: {
                mode: terminalState.mode === "porky" ? "porky" : "shell",
                transition: "status",
                active: response?.active === true,
                sessionId: response?.sessionId || sessionId,
                reply: response?.reply || formatPorkyStatusText(response?.status || response),
                status: response?.status || null,
              },
            },
          });
        }

        if (wantsExit) {
          const response = await apiClient.endPorkyConversation({ sessionId, context: requestContext }, { retries: 0 });

          return normalizeCommandResult({
            type: "text",
            content: formatPorkyTranscriptLine("porky", response?.reply || "Porky slips back into the static."),
            metadata: {
              porky: {
                mode: "shell",
                transition: "end",
                active: false,
                sessionId: response?.sessionId || sessionId,
                reply: response?.reply || "Porky slips back into the static.",
              },
            },
          });
        }

        if (!message) {
          const response = await apiClient.startPorkyConversation({ sessionId, context: requestContext }, { retries: 0 });

          return normalizeCommandResult({
            type: "text",
            content: formatPorkyTranscriptLine("porky", response?.reply || "Porky stirs but says nothing."),
            metadata: {
              porky: {
                mode: "porky",
                transition: "start",
                active: true,
                sessionId: response?.sessionId || sessionId,
                reply: response?.reply || "Porky stirs but says nothing.",
              },
            },
          });
        }

        const response = await apiClient.sendPorkyMessage(message, { sessionId, context: requestContext }, { retries: 0 });

        return normalizeCommandResult({
          type: "text",
          content: [
            formatPorkyTranscriptLine("you", message),
            formatPorkyTranscriptLine("porky", response?.reply || "Porky is listening."),
          ].join("\n"),
          metadata: {
            porky: {
              mode: terminalState.mode === "porky" ? "porky" : "shell",
              transition: terminalState.mode === "porky" ? "message" : "one-off",
              active: terminalState.mode === "porky",
              sessionId: response?.sessionId || sessionId,
              reply: response?.reply || "Porky is listening.",
            },
          },
        });
      },
    });
  }

  class TerminalCommandRegistry {
    constructor() {
      this.commands = new Map();
      this.aliases = new Map();
    }

    register(commandDefinition) {
      if (!commandDefinition || !commandDefinition.name || typeof commandDefinition.handler !== "function") {
        throw new Error("Invalid terminal command definition");
      }

      const normalizedCommand = {
        ...commandDefinition,
        name: toStringValue(commandDefinition.name).trim(),
        description: toStringValue(commandDefinition.description).trim(),
        aliases: Array.isArray(commandDefinition.aliases)
          ? commandDefinition.aliases.map((alias) => toStringValue(alias).trim()).filter(Boolean)
          : [],
        usage: toStringValue(commandDefinition.usage).trim(),
        category: commandDefinition.category || "system",
        isLocal: commandDefinition.isLocal !== false,
      };

      if (!normalizedCommand.name) {
        throw new Error("Terminal command name is required");
      }

      const canonicalName = normalizedCommand.name.toLowerCase();
      if (this.commands.has(canonicalName) || this.aliases.has(canonicalName)) {
        throw new Error(`Terminal command already registered: ${normalizedCommand.name}`);
      }

      normalizedCommand.aliases.forEach((alias) => {
        const aliasKey = alias.toLowerCase();
        if (this.commands.has(aliasKey) || this.aliases.has(aliasKey)) {
          throw new Error(`Terminal command alias already registered: ${alias}`);
        }
      });

      this.commands.set(canonicalName, normalizedCommand);
      normalizedCommand.aliases.forEach((alias) => {
        this.aliases.set(alias.toLowerCase(), canonicalName);
      });

      return normalizedCommand;
    }

    resolve(name) {
      const lookup = toStringValue(name).trim().toLowerCase();
      if (!lookup) return null;

      const canonicalName = this.commands.has(lookup) ? lookup : this.aliases.get(lookup);
      if (!canonicalName) return null;

      return this.commands.get(canonicalName) || null;
    }

    list(options = {}) {
      const includeHidden = options.includeHidden === true;

      return [...this.commands.values()]
        .filter((command) => includeHidden || !isHiddenCommand(command))
        .slice()
        .sort(compareCommands);
    }

    getCategories(options = {}) {
      return this.list(options).reduce((categories, command) => {
        const category = command.category || "system";
        if (!categories.includes(category)) {
          categories.push(category);
        }
        return categories;
      }, []);
    }
  }

  function registerLocalTerminalCommands(registry, options = {}) {
    const version = toStringValue(options.version || options.terminalVersion || "0.1.0").trim() || "0.1.0";
    const versionLabel = toStringValue(options.versionLabel || options.terminalName || "Archive Terminal").trim() || "Archive Terminal";
    const nowProvider = typeof options.nowProvider === "function" ? options.nowProvider : () => new Date();

    registry.register({
      name: "help",
      description: "Show available commands",
      aliases: ["?"],
      usage: "help",
      category: "system",
      examples: ["help"],
      handler: () => ({
        type: "text",
        content: formatHelpText(registry.list()),
      }),
    });

    registry.register({
      name: "clear",
      description: "Clear terminal output",
      aliases: ["cls"],
      usage: "clear",
      category: "system",
      examples: ["clear"],
      handler: () => ({
        type: "clear",
      }),
    });

    registry.register({
      name: "history",
      description: "Show previous commands",
      aliases: ["h"],
      usage: "history",
      category: "system",
      examples: ["history"],
      handler: (context) => ({
        type: "text",
        content: formatHistoryText(context?.terminalState?.history || []),
      }),
    });

    registry.register({
      name: "about",
      description: "Show terminal information",
      aliases: ["info"],
      usage: "about",
      category: "content",
      examples: ["about"],
      handler: () => ({
        type: "text",
        content: [
          `${versionLabel}`,
          `Version: ${version}`,
          "Local command system: active",
          "Commands run entirely in the browser.",
          'Type "help" to see available commands.',
        ].join("\n"),
      }),
    });

    registry.register({
      name: "echo",
      description: "Print provided text",
      aliases: ["print"],
      usage: "echo <text>",
      category: "content",
      examples: ["echo hello world"],
      handler: (context) => {
        const text = Array.isArray(context?.args) ? context.args.join(" ").trim() : "";

        return {
          type: "text",
          content: text || "Usage: echo <text>",
        };
      },
    });

    registry.register({
      name: "date",
      description: "Show local date/time",
      aliases: ["now"],
      usage: "date",
      category: "system",
      examples: ["date"],
      handler: () => ({
        type: "text",
        content: nowProvider().toLocaleString(),
      }),
    });

    registry.register({
      name: "version",
      description: "Show terminal version",
      aliases: ["ver"],
      usage: "version",
      category: "system",
      examples: ["version"],
      handler: () => ({
        type: "text",
        content: `${versionLabel} ${version}`,
      }),
    });

    registerThemeCommands(registry, options);

    // Local script support: register local "run" and "list scripts" commands
    const localScripts = Array.isArray(options.localScripts) ? options.localScripts : [];

    if (localScripts.length > 0) {
      registry.register({
        name: "list",
        description: "List local scripts, files, or assets (local only)",
        usage: "list <scripts>",
        category: "system",
        isLocal: true,
        examples: ["list scripts"],
        handler: (context) => {
          const subject = toStringValue(context?.args?.[0]).trim().toLowerCase();

          if (!subject || subject !== "scripts") {
            return buildCommandError("Usage: list <scripts>", 'Try "list scripts" to see available local scripts.');
          }

          const items = localScripts.map((s) => ({
            id: s.id || s.name || s.scriptId || "",
            title: s.title || s.name || s.scriptId || "",
            description: s.description || "",
          }));

          return {
            type: "json",
            content: items,
            metadata: {
              local: true,
              count: items.length,
            },
          };
        },
      });

      registry.register({
        name: "run",
        description: "Run a local script",
        usage: "run <script-name>",
        category: "script",
        isLocal: true,
        examples: ["run boot-sequence"],
        handler: (context) => {
          const scriptId = splitCommandTarget(context?.args);
          if (!scriptId) {
            return buildCommandError("Usage: run <script-name>", 'Try "list scripts" to see available scripts.');
          }

          const script = localScripts.find((s) => (s.id || s.name || s.scriptId) === scriptId || (s.name && s.name === scriptId));
          if (!script) {
            return buildCommandError(`Script not found: ${scriptId}`, 'Try "list scripts" to see available scripts.');
          }

          return {
            type: "script",
            title: script.title || script.name || script.scriptId || scriptId,
            items: Array.isArray(script.steps) ? script.steps : Array.isArray(script.items) ? script.items : [],
            metadata: {
              localScript: true,
              scriptId: script.id || script.name || script.scriptId || scriptId,
            },
          };
        },
      });
    }

    return registry;
  }

  function createLocalTerminalCommandRegistry(options = {}) {
    const registry = new TerminalCommandRegistry();
    registerLocalTerminalCommands(registry, options);
    return registry;
  }

  function normalizeCommandResult(result) {
    if (!result) {
      return {
        type: "text",
        content: "",
      };
    }

    if (typeof result === "string") {
      return {
        type: "text",
        content: result,
      };
    }

    if (!result.type) {
      return {
        ...result,
        type: "text",
      };
    }

    return result;
  }

  async function executeRegisteredCommand({ rawInput, registry, terminalState = {}, apiClient = null, themeManager = null }) {
    const parsed = parseTerminalInput(rawInput);

    if (!parsed.commandName) {
      return normalizeCommandResult({
        type: "text",
        content: 'Type "help" to see available commands.',
      });
    }

    if (!(registry instanceof TerminalCommandRegistry)) {
      throw new Error("A TerminalCommandRegistry instance is required to execute commands");
    }

    const command = registry.resolve(parsed.commandName);

    if (!command) {
      return {
        type: "error",
        content: `Command not found: ${parsed.commandName}`,
        metadata: {
          hint: 'Type "help" to see available commands.',
          unknownCommand: parsed.commandName,
        },
      };
    }

    const context = {
      rawInput: parsed.rawInput,
      commandName: parsed.commandName,
      args: parsed.args,
      flags: parsed.flags,
      terminalState,
      apiClient,
      registry,
      themeManager,
    };

    const result = await Promise.resolve(command.handler(context));
    return normalizeCommandResult(result);
  }

  function createTerminalCommandSystem(options = {}) {
    const registry = createLocalTerminalCommandRegistry(options);
    if (options.enableBackendCommands !== false) {
      registerBackendTerminalCommands(registry, options);
    }

    return {
      parser: parseTerminalInput,
      registry,
      suggest: (rawInput, context = {}) =>
        suggestTerminalInput(rawInput, {
          registry,
          cursorIndex: context.cursorIndex,
          includeHidden: context.includeHidden,
          themeManager: context.themeManager || options.themeManager || null,
        }),
      execute: (rawInput, context = {}) =>
        executeRegisteredCommand({
          rawInput,
          registry,
          apiClient: context.apiClient || options.apiClient || null,
          themeManager: context.themeManager || options.themeManager || null,
          ...context,
        }),
      parse: parseTerminalInput,
    };
  }

  return {
    CATEGORY_ORDER,
    TerminalCommandRegistry,
    createLocalTerminalCommandRegistry,
    createTerminalCommandSystem,
    executeRegisteredCommand,
    formatHelpText,
    formatHistoryText,
    normalizeCommandResult,
    parseTerminalInput,
    suggestTerminalInput,
    registerThemeCommands,
    registerBackendTerminalCommands,
    registerLocalTerminalCommands,
  };
});
