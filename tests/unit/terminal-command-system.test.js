import { describe, expect, it } from "vitest";

const {
  TerminalCommandRegistry,
  createLocalTerminalCommandRegistry,
  createTerminalCommandSystem,
  formatTerminalPromptLabel,
  formatTerminalPromptPath,
  parseTerminalInput,
} = require("../../public/js/pages/terminal-command-system.js");
const { createTerminalThemeManager } = require("../../public/js/pages/terminal-theme-manager.js");

describe("terminal command system", () => {
  it("parses commands, positional arguments, and flags", () => {
    const parsed = parseTerminalInput('run "boot sequence" --speed fast --glitch');

    expect(parsed).toEqual({
      commandName: "run",
      args: ["boot sequence"],
      flags: {
        speed: "fast",
        glitch: true,
      },
      rawInput: 'run "boot sequence" --speed fast --glitch',
    });
  });

  it("resolves aliases through the registry", () => {
    const registry = new TerminalCommandRegistry();

    registry.register({
      name: "clear",
      description: "Clear terminal output",
      aliases: ["cls"],
      handler: () => ({ type: "clear" }),
    });

    expect(registry.resolve("cls").name).toBe("clear");
    expect(registry.list()).toHaveLength(1);
  });

  it("exposes the built-in local command set", () => {
    const registry = createLocalTerminalCommandRegistry({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
    });

    expect(registry.list().map((command) => command.name)).toEqual(["clear", "date", "help", "history", "version", "about", "echo"]);
  });

  it("executes help, history, echo, clear, and unknown commands", async () => {
    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
    });

    const help = await system.execute("help", { terminalState: { history: [] } });
    expect(help.type).toBe("text");
    expect(help.content).toContain("Available commands:");
    expect(help.content).toContain("help");
    expect(help.content).toContain("clear");

    const echo = await system.execute('echo "hello terminal"', { terminalState: { history: [] } });
    expect(echo).toEqual({ type: "text", content: "hello terminal" });

    const history = await system.execute("history", {
      terminalState: { history: ["help", "echo hello terminal"] },
    });
    expect(history.content).toContain("01. help");
    expect(history.content).toContain("02. echo hello terminal");

    const clear = await system.execute("clear", { terminalState: { history: [] } });
    expect(clear.type).toBe("clear");

    const unknown = await system.execute("deploy", { terminalState: { history: [] } });
    expect(unknown.type).toBe("error");
    expect(unknown.content).toContain("Command not found: deploy");
    expect(unknown.metadata.hint).toContain("help");
  });

  it("renders about, version, and date commands", async () => {
    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
    });

    const about = await system.execute("about", { terminalState: { history: [] } });
    expect(about.content).toContain("Archive Terminal");
    expect(about.content).toContain("Local command system: active");

    const version = await system.execute("version", { terminalState: { history: [] } });
    expect(version.content).toBe("Archive Terminal 0.1.0");

    const date = await system.execute("date", { terminalState: { history: [] } });
    expect(date.content).toBe(new Date("2026-05-02T12:34:56.000Z").toLocaleString());
  });

  it("executes backend-backed commands when an api client is available", async () => {
    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
    });

    const apiClient = {
      getScript: async (scriptId) => ({
        id: scriptId,
        title: "Boot Sequence",
        type: "script",
        steps: [{ type: "text", content: "booting" }],
      }),
      getAsset: async (assetId) => ({
        id: assetId,
        type: "text",
        content: `asset:${assetId}`,
      }),
      getVirtualFile: async (filePath) => ({
        path: filePath,
        type: "text",
        content: `file:${filePath}`,
      }),
      listScripts: async () => ({ scripts: [{ id: "boot-sequence" }] }),
      listFiles: async () => ({ files: [{ path: "logs/system.log" }] }),
      listAssets: async () => ({ assets: [{ id: "signal-image" }] }),
      getCommands: async () => ({ commands: [{ name: "run" }] }),
      executeCommand: async (input) => {
        const normalized = String(input || "").trim();

        if (/^run\b/i.test(normalized)) {
          return {
            ok: true,
            result: {
              type: "script",
              title: "Boot Sequence",
              items: [{ type: "text", content: "booting" }],
            },
          };
        }

        if (/^list\b/i.test(normalized)) {
          return {
            ok: true,
            result: {
              type: "json",
              content: {
                scripts: [{ id: "boot-sequence" }],
                files: [{ path: "logs/system.log" }],
                assets: [{ id: "signal-image" }],
              },
            },
          };
        }

        return {
          ok: true,
          result: {
            type: "text",
            content: `executed:${normalized}`,
          },
        };
      },
      startPorkyConversation: async () => ({
        sessionId: "porky-session",
        active: true,
        reply: "Porky stirs in the static.",
      }),
      sendPorkyMessage: async (message) => ({
        sessionId: "porky-session",
        active: true,
        reply: `porky:${message}`,
      }),
      getPorkyStatus: async () => ({
        sessionId: "porky-session",
        active: true,
        reply: "Porky status:\nprovider: mock",
        status: {
          sessionId: "porky-session",
          provider: "mock",
          model: "mock",
          estimatedTokenUsage: 12,
          estimatedTokenLimit: 2400,
          estimatedTokenUsagePercent: 1,
          estimatedTokenRemaining: 2388,
          recentCommands: 2,
          recentCommandsLimit: 6,
          maxMessageLength: 1024,
          conversationMessages: 2,
          messageLimit: 10,
          mode: "porky",
          theme: "green",
        },
      }),
      endPorkyConversation: async () => ({
        sessionId: "porky-session",
        active: false,
        reply: "Porky slips away.",
      }),
    };

    const run = await system.execute("run boot-sequence", {
      terminalState: { history: [] },
      apiClient,
    });
    expect(run.type).toBe("script");
    expect(run.items).toHaveLength(1);

    const list = await system.execute("list scripts", {
      terminalState: { history: [] },
      apiClient,
    });
    expect(list.type).toBe("json");
    expect(list.content).toMatchObject({ scripts: [{ id: "boot-sequence" }] });

    const login = await system.execute("login", {
      terminalState: { history: [] },
      apiClient,
    });
    expect(login.type).toBe("text");
    expect(login.content).toBe("executed:login");

    const porkyStart = await system.execute("porky", {
      terminalState: { history: [], mode: "shell", porkyConversation: [] },
      apiClient,
    });
    expect(porkyStart.type).toBe("text");
    expect(porkyStart.content).toContain("porky>");
    expect(porkyStart.metadata.porky.transition).toBe("start");

    const porkyChat = await system.execute("porky what is this place?", {
      terminalState: { history: ["porky"], mode: "shell", porkyConversation: [] },
      apiClient,
    });
    expect(porkyChat.type).toBe("text");
    expect(porkyChat.content).toContain("you> what is this place?");
    expect(porkyChat.content).toContain("porky>");
    expect(porkyChat.metadata.porky.transition).toBe("one-off");

    const porkyEnd = await system.execute("porky exit", {
      terminalState: { history: ["porky"], mode: "porky", porkyConversation: [] },
      apiClient,
    });
    expect(porkyEnd.type).toBe("text");
    expect(porkyEnd.metadata.porky.transition).toBe("end");

    const porkyStatus = await system.execute("porky status", {
      terminalState: { history: ["porky"], mode: "porky", porkyConversation: [] },
      apiClient,
    });
    expect(porkyStatus.type).toBe("text");
    expect(porkyStatus.content).toContain("Porky status:");
    expect(porkyStatus.content).toContain("estimated tokens: 12/2400");
    expect(porkyStatus.metadata.porky.transition).toBe("status");
  });

  it("suggests rotating virtual filesystem paths for cd and open commands", async () => {
    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
    });

    const terminalState = {
      currentPath: "/docs/guide",
      availableFiles: [
        { path: "docs/guide/secrets.txt", title: "Secrets", type: "file" },
        { path: "docs/guide/forms", title: "Forms", type: "directory" },
        { path: "docs/guide/fixtures", title: "Fixtures", type: "directory" },
      ],
      availableAssets: [{ id: "signal-image", title: "Signal Frame" }],
      availableScripts: [{ id: "boot-sequence", title: "Boot Sequence" }],
    };

    const cdSuggestion = system.suggest("cd f", {
      terminalState,
      cursorIndex: 4,
    });

    expect(cdSuggestion.kind).toBe("argument");
    expect(cdSuggestion.commandName).toBe("cd");
    expect(cdSuggestion.matches.map((match) => match.value)).toEqual(expect.arrayContaining(["fixtures/", "forms/"]));
    expect(cdSuggestion.matches.map((match) => match.value)).not.toContain("summaries/");
    expect(cdSuggestion.matches.every((match) => match.appendSpace === false)).toBe(true);

    const openSuggestion = system.suggest("open s", {
      terminalState,
      cursorIndex: 6,
    });

    expect(openSuggestion.kind).toBe("argument");
    expect(openSuggestion.commandName).toBe("open");
    expect(openSuggestion.matches.map((match) => match.value)).toEqual(expect.arrayContaining(["secrets.txt", "signal-image"]));
    expect(openSuggestion.matches.every((match) => match.appendSpace === true)).toBe(true);
  });

  it("supports theme and effects commands when a theme manager is available", async () => {
    const documentRef = { documentElement: { dataset: {} } };
    const themeManager = createTerminalThemeManager({
      documentRef,
      persist: false,
      matchMedia: () => ({ matches: false }),
    });

    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
      themeManager,
    });

    const theme = await system.execute("theme blue", { terminalState: { history: [] } });
    expect(theme.type).toBe("text");
    expect(theme.content).toContain("Theme changed to Blue.");
    expect(documentRef.documentElement.dataset.terminalTheme).toBe("blue");

    const effects = await system.execute("effects off", { terminalState: { history: [] } });
    expect(effects.type).toBe("text");
    expect(effects.content).toContain("CRT-style effects are disabled.");
    expect(documentRef.documentElement.dataset.terminalEffects).toBe("off");

    const status = await system.execute("theme", { terminalState: { history: [] } });
    expect(status.content).toContain("Current theme: Blue");
    expect(status.content).toContain("Visual effects: disabled");
  });

  it("suggests terminal commands and theme arguments", () => {
    const documentRef = {
      documentElement: {
        dataset: {},
        classList: {
          toggle: () => {},
        },
      },
    };
    const themeManager = createTerminalThemeManager({
      documentRef,
      persist: false,
      matchMedia: () => ({ matches: false }),
    });
    const system = createTerminalCommandSystem({
      version: "0.1.0",
      versionLabel: "Archive Terminal",
      nowProvider: () => new Date("2026-05-02T12:34:56.000Z"),
      themeManager,
    });

    const commandSuggestion = system.suggest("th", {
      cursorIndex: 2,
      themeManager,
    });

    expect(commandSuggestion.kind).toBe("command");
    expect(commandSuggestion.matches.map((match) => match.value)).toContain("theme");

    const themeSuggestion = system.suggest("theme b", {
      cursorIndex: 7,
      themeManager,
    });

    expect(themeSuggestion.kind).toBe("argument");
    expect(themeSuggestion.matches.map((match) => match.value)).toContain("blue");

    const effectsSuggestion = system.suggest("effects o", {
      cursorIndex: 9,
      themeManager,
    });

    expect(effectsSuggestion.kind).toBe("argument");
    expect(effectsSuggestion.matches.map((match) => match.value)).toEqual(expect.arrayContaining(["on", "off"]));
  });

  it("formats shell prompt paths for the archive terminal", () => {
    expect(formatTerminalPromptPath("/")).toBe("~");
    expect(formatTerminalPromptPath("/docs")).toBe("~/docs");
    expect(formatTerminalPromptPath("/projects/rolnopol-jt/scripts")).toBe("~/projects/rolnopol-jt/scripts");

    expect(formatTerminalPromptLabel("/")).toBe("guest@archive:~$");
    expect(formatTerminalPromptLabel("/docs/guide")).toBe("guest@archive:~/docs/guide$");
  });
});
