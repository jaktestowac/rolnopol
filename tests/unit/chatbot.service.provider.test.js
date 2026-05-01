import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

async function loadChatbotService({
  provider = "mock",
  apiKey = "test-gemini-key",
  model = "gemini-2.5-flash",
  context,
  fetchMock,
  llmConsoleLogLevel,
} = {}) {
  vi.resetModules();

  process.env.CHATBOT_LLM_PROVIDER = provider;

  if (llmConsoleLogLevel === undefined) {
    delete process.env.LLM_CONSOLE_LOG_LEVEL;
  } else {
    process.env.LLM_CONSOLE_LOG_LEVEL = String(llmConsoleLogLevel);
  }

  if (apiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = apiKey;
    process.env.OPENROUTER_API_KEY = apiKey;
  }

  if (model === undefined) {
    delete process.env.GEMINI_MODEL;
    delete process.env.OPENROUTER_MODEL;
  } else {
    process.env.GEMINI_MODEL = model;
    process.env.OPENROUTER_MODEL = model;
  }

  const contextServiceMock = {
    getContextForUser: vi.fn().mockResolvedValue(
      context || {
        summary: {
          fieldsCount: 1,
          totalFieldAreaHa: 12.5,
          staffCount: 1,
          animalRecordsCount: 1,
          totalAnimals: 10,
        },
        samples: {
          fields: [{ name: "North Field", area: 12.5 }],
          staff: [{ name: "Anna", surname: "Kowalska", position: "Agronomist" }],
          animals: [{ type: "cow", amount: 10 }],
        },
      },
    ),
  };

  vi.doMock("../../services/chatbot/chatbot-context.service", () => contextServiceMock);

  if (fetchMock) {
    global.fetch = fetchMock;
  }

  const serviceModule = await import("../../services/chatbot/chatbot.service");

  if (context) {
    contextServiceMock.getContextForUser.mockResolvedValue(context);
  }

  return {
    chatbotService: serviceModule.default || serviceModule,
    contextServiceMock,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
});

describe("chatbot.service provider selection", () => {
  it("uses mock connector by default", async () => {
    const { chatbotService } = await loadChatbotService({ provider: "mock" });

    const response = await chatbotService.ask({
      userId: 1,
      message: "summary",
    });

    expect(response.provider).toBe("mock");
    expect(response.reply).toContain("Here is a quick summary of your farm data");
  });

  it("uses gemini connector when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini-generated assistant response." }],
            },
          },
        ],
      }),
    });

    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      fetchMock,
    });

    const response = await chatbotService.ask({
      userId: 1,
      message: "Give me a short summary",
    });

    expect(response.provider).toBe("gemini");
    expect(response.reply).toBe("Gemini-generated assistant response.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/models/gemini-2.5-flash:generateContent");
    expect(requestInit.headers["x-goog-api-key"]).toBe("gemini-key");
  });

  it("sends a trimmed prompt context to gemini while keeping full context for tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini-generated assistant response." }],
            },
          },
        ],
      }),
    });

    const fullContext = {
      summary: {
        fieldsCount: 2,
        totalFieldAreaHa: 12.5,
        staffCount: 1,
        animalRecordsCount: 1,
        totalAnimals: 10,
      },
      samples: {
        fields: [{ name: "North Field", area: 12.5 }],
        staff: [{ name: "Anna", surname: "Kowalska", position: "Agronomist" }],
        animals: [{ type: "cow", amount: 10 }],
      },
    };

    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      context: fullContext,
      fetchMock,
    });

    const response = await chatbotService.ask({
      userId: 1,
      message: "Give me a short summary",
    });

    expect(response.provider).toBe("gemini");
    expect(response.reply).toBe("Gemini-generated assistant response.");

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    const promptText = body.contents?.[0]?.parts?.[0]?.text || "";

    expect(promptText).toContain("User farm context (JSON):");
    expect(promptText).toContain('"summary":');
    expect(promptText).not.toContain("North Field");
    expect(promptText).not.toContain("Agronomist");
  });

  it("falls back to mock when gemini is selected but key is missing", async () => {
    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "",
      model: "",
    });

    const response = await chatbotService.ask({
      userId: 1,
      message: "summary",
    });

    expect(response.provider).toBe("mock");
    expect(response.reply).toContain("Here is a quick summary of your farm data");
  });

  it("returns raw OpenRouter key info for /ratelimits without loading context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          label: "primary-key",
          usage: 12.34,
          limit: 50,
          limit_remaining: 37.66,
          rate_limit: {
            requests: 60,
            interval: "1m",
          },
        },
      }),
    });

    const { chatbotService, contextServiceMock } = await loadChatbotService({
      provider: "openrouter",
      apiKey: "openrouter-key",
      model: "openrouter/model",
      fetchMock,
    });

    const response = await chatbotService.ask({
      userId: 1,
      message: "/ratelimits",
    });

    expect(response.provider).toBe("openrouter");
    expect(response.contextSummary).toBeNull();
    expect(response.reply).toContain('"limit_remaining": 37.66');
    expect(response.reply).toContain('"rate_limit"');
    expect(contextServiceMock.getContextForUser).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/key");
    expect(requestInit.method).toBe("GET");
    expect(requestInit.headers.Authorization).toBe("Bearer openrouter-key");
  });

  it("returns mocked limits info for /limits on non-OpenRouter providers", async () => {
    const { chatbotService, contextServiceMock } = await loadChatbotService({ provider: "mock" });

    const response = await chatbotService.ask({
      userId: 1,
      message: "/limits",
    });

    expect(response.provider).toBe("mock");
    expect(response.contextSummary).toBeNull();
    expect(response.reply).toContain('"supported": false');
    expect(response.reply).toContain("mock provider");
    expect(contextServiceMock.getContextForUser).not.toHaveBeenCalled();
  });

  it("runs chatbot smoke evals for core intents", async () => {
    const { chatbotService } = await loadChatbotService({ provider: "mock" });

    const evalResult = await chatbotService.runSmokeEval(1);

    expect(evalResult).toHaveProperty("total", 4);
    expect(evalResult).toHaveProperty("failures", 0);
    expect(evalResult).toHaveProperty("healthy", true);
    expect(Array.isArray(evalResult.results)).toBe(true);
    expect(evalResult.results.every((item) => item.passed)).toBe(true);
  });

  it("keeps LLM console logging silent at level 0", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini-generated assistant response." }],
            },
          },
        ],
      }),
    });

    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      fetchMock,
      llmConsoleLogLevel: 0,
    });

    await chatbotService.ask({
      userId: 1,
      message: "Give me a short summary",
    });

    const messages = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
    const llmLogs = messages.filter((message) => message.startsWith("[LLM]"));
    const infoLogs = messages.filter((message) => message.startsWith("[INFO]"));
    const traceLogs = messages.filter((message) => message.startsWith("[TRACE]"));

    expect(llmLogs).toHaveLength(0);
    expect(infoLogs).toHaveLength(0);
    expect(traceLogs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("logs prompt and response text at level 1", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini-generated assistant response." }],
            },
          },
        ],
      }),
    });

    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      fetchMock,
      llmConsoleLogLevel: 1,
    });

    await chatbotService.ask({
      userId: 1,
      message: "Give me a short summary",
    });

    const messages = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
    const llmLogs = messages.filter((message) => message.startsWith("[LLM]"));
    const infoLogs = messages.filter((message) => message.startsWith("[INFO]"));
    const traceLogs = messages.filter((message) => message.startsWith("[TRACE]"));

    expect(llmLogs.some((message) => message.includes("request: Give me a short summary"))).toBe(true);
    expect(llmLogs.some((message) => message.includes("response: Gemini-generated assistant response."))).toBe(true);
    expect(llmLogs.every((message) => !message.includes("systemInstruction"))).toBe(true);
    expect(infoLogs.some((message) => message.includes("Chatbot initialized with 'gemini' provider."))).toBe(true);
    expect(traceLogs).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("logs the full request and response objects at level 2", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini-generated assistant response." }],
            },
          },
        ],
      }),
    });

    const { chatbotService } = await loadChatbotService({
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      fetchMock,
      llmConsoleLogLevel: 2,
    });

    await chatbotService.ask({
      userId: 1,
      message: "Give me a short summary",
    });

    const messages = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
    const llmLogs = messages.filter((message) => message.startsWith("[LLM]"));
    const infoLogs = messages.filter((message) => message.startsWith("[INFO]"));
    const traceLogs = messages.filter((message) => message.startsWith("[TRACE]"));

    expect(llmLogs.some((message) => message.includes("systemInstruction"))).toBe(true);
    expect(llmLogs.some((message) => message.includes("messages"))).toBe(true);
    expect(llmLogs.some((message) => message.includes("candidates"))).toBe(true);
    expect(infoLogs.some((message) => message.includes("Chatbot initialized with 'gemini' provider."))).toBe(true);
    expect(traceLogs.some((message) => message.includes("Chatbot ask() completed for user 1"))).toBe(true);

    consoleSpy.mockRestore();
  });
});
