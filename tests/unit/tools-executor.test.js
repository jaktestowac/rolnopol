import { describe, expect, it } from "vitest";
import ToolsExecutor from "../../services/chatbot/tools/tools-executor";

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
});
