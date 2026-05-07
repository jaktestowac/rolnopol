import { describe, expect, it } from "vitest";

const docsService = require("../../services/docs.service");

describe("docs service search", () => {
  it("matches natural-language questions for demo accounts", async () => {
    const result = await docsService.search("what are demo accounts?");

    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches[0].title).toBe("Demo Accounts");
    expect(result.answer).toContain('Documentation search results for "what are demo accounts?"');
  });

  it("still supports direct section queries", async () => {
    const result = await docsService.search("user roles");

    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches.some((item) => item.title === "User Types & Permissions")).toBe(true);
  });
});
