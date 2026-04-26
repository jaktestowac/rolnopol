import { afterEach, describe, expect, it, vi } from "vitest";
import ToolsExecutor from "../../services/chatbot/tools/tools-executor";
import chatbotContextService from "../../services/chatbot/chatbot-context.service";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolsExecutor for docs", () => {
  it("should return documentation answer when get_documentation_answer is called", async () => {
    const executor = new ToolsExecutor(1, { userId: 1 });

    const result = await executor.execute("get_documentation_answer", {
      query: "system overview",
      max_results: 2,
    });

    expect(result).toHaveProperty("answer");
    expect(result.answer).toContain("Rolnopol is a comprehensive agricultural management system");
    expect(result).toHaveProperty("matches");
    expect(Array.isArray(result.matches)).toBe(true);
  });

  it("should return user farm context with summary only by default", async () => {
    const contextSpy = vi.spyOn(chatbotContextService, "getContextForUser").mockResolvedValue({
      summary: {
        fieldsCount: 2,
        staffCount: 3,
      },
    });

    const executor = new ToolsExecutor(42, { userId: 42 }, { contextService: chatbotContextService });
    const result = await executor.execute("get_user_farm_context", {});

    expect(contextSpy).toHaveBeenCalledWith(42, {
      includeSummary: true,
      includeSamples: false,
    });
    expect(result).toEqual({
      summary: {
        fieldsCount: 2,
        staffCount: 3,
      },
    });
  });

  it("should return user farm context samples when requested", async () => {
    const contextSpy = vi.spyOn(chatbotContextService, "getContextForUser").mockResolvedValue({
      summary: { fieldsCount: 1 },
      samples: { fields: [{ id: 1, name: "North Field" }] },
    });

    const executor = new ToolsExecutor(7, { userId: 7 }, { contextService: chatbotContextService });
    const result = await executor.execute("get_user_farm_context", {
      include_samples: true,
    });

    expect(contextSpy).toHaveBeenCalledWith(7, {
      includeSummary: true,
      includeSamples: true,
    });
    expect(result).toMatchObject({
      summary: { fieldsCount: 1 },
      samples: { fields: [{ id: 1, name: "North Field" }] },
    });
  });
});
