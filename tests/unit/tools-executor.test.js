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

  it("should return supported weather regions when get_weather_regions is called", async () => {
    const executor = new ToolsExecutor(1, { userId: 1 });

    const result = await executor.execute("get_weather_regions", {});

    expect(result).toHaveProperty("regions");
    expect(Array.isArray(result.regions)).toBe(true);
    expect(result.regions.length).toBeGreaterThan(0);
    expect(result.regions[0]).toHaveProperty("code");
    expect(result.regions[0]).toHaveProperty("name");
  });

  it("should return all weather data for all regions when get_weather_all_regions is called", async () => {
    const executor = new ToolsExecutor(1, { userId: 1 });

    const result = await executor.execute("get_weather_all_regions", {});

    expect(result).toHaveProperty("regions");
    expect(Array.isArray(result.regions)).toBe(true);
    expect(result.regions.length).toBeGreaterThan(0);
    expect(result).toHaveProperty("baseDate");
    expect(result).toHaveProperty("days");

    const first = result.regions[0];
    expect(first).toHaveProperty("code");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("today");
    expect(first).toHaveProperty("forecast");
    expect(Array.isArray(first.forecast)).toBe(true);
  });

  it("should return public farmlog blogs when get_farmlog_blogs is called", async () => {
    const executor = new ToolsExecutor(1, { userId: 1 });

    const result = await executor.execute("get_farmlog_blogs", {});

    expect(result).toHaveProperty("blogs");
    expect(Array.isArray(result.blogs)).toBe(true);
    if (result.blogs.length > 0) {
      expect(result.blogs[0]).toHaveProperty("url");
    }
  });

  it("should return public farmlog posts when get_farmlog_posts is called", async () => {
    const executor = new ToolsExecutor(1, { userId: 1 });

    const result = await executor.execute("get_farmlog_posts", {});

    expect(result).toHaveProperty("posts");
    expect(Array.isArray(result.posts)).toBe(true);
    if (result.posts.length > 0) {
      expect(result.posts[0]).toHaveProperty("url");
    }
  });
});
