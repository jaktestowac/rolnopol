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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  console.log = ORIGINAL_CONSOLE_LOG;
  console.warn = ORIGINAL_CONSOLE_WARN;
});

describe("terminal porky service logging", () => {
  it("logs conversation details when llm console logging is enabled", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const porkyService = await loadPorkyService({ llmConsoleLogLevel: 2 });

    consoleLogSpy.mockClear();

    const context = {
      terminal: {
        mode: "porky",
        theme: "green",
        currentPath: "/operator/terminal.html",
        recentCommands: ["porky"],
        availableCommands: [{ name: "porky", description: "Talk with Porky" }],
      },
    };

    await porkyService.startConversation({ sessionId: "porky-log-session", context });
    await porkyService.sendMessage({ sessionId: "porky-log-session", message: "what is this place?", context });
    await porkyService.getStatus({ sessionId: "porky-log-session", context });
    await porkyService.endConversation({ sessionId: "porky-log-session", context });

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
