import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CONSOLE_LOG = console.log;
const ORIGINAL_CONSOLE_WARN = console.warn;

async function loadPorkyService({ llmConsoleLogLevel = 0 } = {}) {
  vi.resetModules();

  process.env.CHATBOT_LLM_PROVIDER = "mock";
  process.env.LLM_CONSOLE_LOG_LEVEL = String(llmConsoleLogLevel);

  const serviceModule = await import("../../services/terminal-porky.service.js");
  return serviceModule.default || serviceModule;
}

function buildTerminalContext(overrides = {}) {
  const { featureFlags = null, ...terminalOverrides } = overrides;

  return {
    terminal: {
      mode: "porky",
      theme: "green",
      currentPath: "/operator/terminal.html",
      recentCommands: ["porky"],
      availableCommands: [{ name: "porky", description: "Talk with Porky" }],
      ...terminalOverrides,
    },
    ...(featureFlags ? { featureFlags } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
  console.log = ORIGINAL_CONSOLE_LOG;
  console.warn = ORIGINAL_CONSOLE_WARN;
});

describe("terminal porky split personalities", () => {
  it("keeps classic Porky active when no persona flags are enabled", async () => {
    const porkyService = await loadPorkyService();

    const context = buildTerminalContext({
      now: "2026-06-02T22:30:00.000Z",
      featureFlags: {
        celebrationEventsEnabled: false,
        terminalPorkySplitPersonalityEnabled: false,
      },
    });
    const start = await porkyService.startConversation({ sessionId: "porky-classic-session", context });
    const reply = await porkyService.sendMessage({ sessionId: "porky-classic-session", message: "who are you", context });

    expect(start.persona).toMatchObject({
      id: "classic",
      source: "default",
      active: false,
    });
    expect(start.reply).not.toContain("Tonight's mask:");
    expect(reply.reply).toContain("I am Porky.");
  });

  it("switches Porky to a scheduled night persona when the split-personality flag is enabled", async () => {
    const porkyService = await loadPorkyService();

    const context = buildTerminalContext({
      now: "2026-06-06T22:30:00.000Z",
      featureFlags: {
        celebrationEventsEnabled: false,
        terminalPorkySplitPersonalityEnabled: true,
      },
    });
    const start = await porkyService.startConversation({ sessionId: "porky-harvest-night", context });
    const status = await porkyService.getStatus({ sessionId: "porky-harvest-night", context });
    const reply = await porkyService.sendMessage({ sessionId: "porky-harvest-night", message: "who are you", context });

    expect(start.persona).toMatchObject({
      id: "cheerful-harvest-host",
      source: "feature-flag-night",
      active: true,
    });
    expect(start.reply).toContain("Tonight's mask: Cheerful Harvest Host.");
    expect(status.reply).toContain("persona: Cheerful Harvest Host");
    expect(reply.reply).toContain("harvest lights are on");
  });

  it("prefers celebration-event personas over the scheduled night rotation", async () => {
    const porkyService = await loadPorkyService();

    const context = buildTerminalContext({
      now: "2026-10-31T22:30:00.000Z",
      featureFlags: {
        celebrationEventsEnabled: true,
        terminalPorkySplitPersonalityEnabled: true,
      },
    });
    const start = await porkyService.startConversation({ sessionId: "porky-halloween-session", context });
    const status = await porkyService.getStatus({ sessionId: "porky-halloween-session", context });
    const reply = await porkyService.sendMessage({ sessionId: "porky-halloween-session", message: "who are you", context });

    expect(start.persona).toMatchObject({
      id: "glitch-prophet",
      source: "celebration-event",
      eventId: "halloween",
      eventName: "Halloween",
      active: true,
    });
    expect(status.status.persona).toMatchObject({
      id: "glitch-prophet",
      reason: "Halloween",
    });
    expect(reply.reply).toContain("checksum-shaped rumor");
  });
});

describe("terminal porky service logging", () => {
  it("logs conversation details when llm console logging is enabled", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const porkyService = await loadPorkyService({ llmConsoleLogLevel: 2 });

    consoleLogSpy.mockClear();

    const context = buildTerminalContext({
      featureFlags: {
        celebrationEventsEnabled: false,
        terminalPorkySplitPersonalityEnabled: false,
      },
    });

    await porkyService.startConversation({ sessionId: "porky-log-session", context });
    const reply = await porkyService.sendMessage({ sessionId: "porky-log-session", message: "what is this place?", context });
    const status = await porkyService.getStatus({ sessionId: "porky-log-session", context });
    await porkyService.endConversation({ sessionId: "porky-log-session", context });

    expect(reply.botId).toBe("terminal-porky");
    expect(status.botId).toBe("terminal-porky");

    const joinedLogs = consoleLogSpy.mock.calls.flat().join("\n");

    expect(joinedLogs).toContain("[Porky] conversation started");
    expect(joinedLogs).toContain("[Porky] message processed");
    expect(joinedLogs).toContain("[Porky] status requested");
    expect(joinedLogs).toContain("[Porky] conversation ended");
    expect(joinedLogs).toContain("estimatedTokenUsage");
    expect(joinedLogs).toContain("promptPreview");
    expect(joinedLogs).toContain("what is this place?");
  });
});
