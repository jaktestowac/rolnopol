import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

async function loadChatbotService({ provider = "mock", apiKey = "test-gemini-key", model = "gemini-2.5-flash", context, fetchMock } = {}) {
  vi.resetModules();

  process.env.CHATBOT_LLM_PROVIDER = provider;

  if (apiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = apiKey;
  }

  if (model === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = model;
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

  it("runs chatbot smoke evals for core intents", async () => {
    const { chatbotService } = await loadChatbotService({ provider: "mock" });

    const evalResult = await chatbotService.runSmokeEval(1);

    expect(evalResult).toHaveProperty("total", 4);
    expect(evalResult).toHaveProperty("failures", 0);
    expect(evalResult).toHaveProperty("healthy", true);
    expect(Array.isArray(evalResult.results)).toBe(true);
    expect(evalResult.results.every((item) => item.passed)).toBe(true);
  });
});
