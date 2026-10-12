import { describe, expect, it } from "vitest";

const catalogPage = require("../../public/js/pages/practice-catalog.js");
const { PRACTICE_PAGES, DIFFICULTIES } = require("../../services/practice/practice-catalog.js");

const pages = [
  { id: "a", title: "WebMCP greenhouse", summary: "Agent tools", category: "AI agents", difficulty: "beginner", tags: ["webmcp", "tools"], highlights: [], addedAt: "2026-10-12" },
  { id: "b", title: "Drag and drop", summary: "Move cards", category: "UI", difficulty: "advanced", tags: ["dnd"], highlights: ["Sortable lists"], addedAt: "2026-11-01" },
  { id: "c", title: "Forms łąka", summary: "Validation", category: "UI", difficulty: "intermediate", tags: ["forms", "tools"], highlights: [], addedAt: "2026-09-01" },
];

const state = (patch = {}) => ({ ...catalogPage.DEFAULT_STATE, ...patch });
const ids = (list) => list.map((page) => page.id);

describe("practice catalog filtering", () => {
  it("returns every page sorted by name by default", () => {
    expect(ids(catalogPage.filterPages(pages, state()))).toEqual(["b", "c", "a"]);
  });

  it("searches title, summary, tags and highlights, requiring every word", () => {
    expect(ids(catalogPage.filterPages(pages, state({ query: "sortable" })))).toEqual(["b"]);
    expect(ids(catalogPage.filterPages(pages, state({ query: "TOOLS webmcp" })))).toEqual(["a"]);
    expect(ids(catalogPage.filterPages(pages, state({ query: "laka" })))).toEqual(["c"]);
    expect(ids(catalogPage.filterPages(pages, state({ query: "nothing-matches" })))).toEqual([]);
  });

  it("filters by category, difficulty and all selected tags", () => {
    expect(ids(catalogPage.filterPages(pages, state({ category: "UI" })))).toEqual(["b", "c"]);
    expect(ids(catalogPage.filterPages(pages, state({ difficulty: "beginner" })))).toEqual(["a"]);
    expect(ids(catalogPage.filterPages(pages, state({ tags: ["tools"] })))).toEqual(["c", "a"]);
    expect(ids(catalogPage.filterPages(pages, state({ tags: ["tools", "forms"] })))).toEqual(["c"]);
  });

  it("sorts by newest and by difficulty", () => {
    expect(ids(catalogPage.sortPages(pages, "newest"))).toEqual(["b", "a", "c"]);
    expect(ids(catalogPage.sortPages(pages, "difficulty"))).toEqual(["a", "c", "b"]);
  });
});

describe("practice catalog URL state", () => {
  it("round-trips non-default values through the query string", () => {
    const custom = state({ query: "web mcp", category: "AI agents", difficulty: "beginner", tags: ["webmcp", "tools"], sort: "newest", view: "compact" });
    const query = catalogPage.serializeState(custom);

    expect(catalogPage.parseState(query)).toEqual(custom);
    expect(catalogPage.serializeState(catalogPage.DEFAULT_STATE)).toBe("");
  });

  it("falls back to defaults for unknown values and uses the stored view", () => {
    expect(catalogPage.parseState("?view=huge&sort=random")).toMatchObject({ view: "small", sort: "title" });
    expect(catalogPage.parseState("", "large").view).toBe("large");
    expect(catalogPage.parseState("?view=compact", "small").view).toBe("compact");
  });

  it("knows when filters are active", () => {
    expect(catalogPage.hasActiveFilters(state())).toBe(false);
    expect(catalogPage.hasActiveFilters(state({ view: "compact", sort: "newest" }))).toBe(false);
    expect(catalogPage.hasActiveFilters(state({ tags: ["webmcp"] }))).toBe(true);
  });
});

describe("practice catalog registry", () => {
  it("has complete, unique entries", () => {
    const seen = new Set();
    for (const page of PRACTICE_PAGES) {
      expect(seen.has(page.id), page.id).toBe(false);
      seen.add(page.id);
      expect(page.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(page.path).toMatch(/^\/practice\/[a-z0-9-]+\.html$/);
      expect(page.title && page.summary && page.category && page.icon).toBeTruthy();
      expect(DIFFICULTIES).toContain(page.difficulty);
      expect(page.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.tags.every((tag) => tag === tag.toLowerCase())).toBe(true);
    }
  });
});
