/**
 * Catalog of the hidden practice pages served under /practice/.
 *
 * Add one entry per page. /practice/ (public/practice/index.html) lists them
 * through GET /api/v1/practice/catalog, and tests check that every `path` exists.
 *
 * Fields:
 *   id          unique, kebab-case
 *   title       card title
 *   summary     one or two sentences
 *   path        page URL under /practice/
 *   category    groups pages in the filter
 *   difficulty  "beginner" | "intermediate" | "advanced"
 *   tags        free-form, lower-case
 *   highlights  short bullet points shown on big cards
 *   api         endpoint family the page uses, or null
 *   icon        Font Awesome icon class
 *   addedAt     YYYY-MM-DD, used for "newest first"
 */

const DIFFICULTIES = ["beginner", "intermediate", "advanced"];

const PRACTICE_PAGES = [
  {
    id: "webmcp-demo",
    title: "WebMCP greenhouse",
    summary:
      "A small greenhouse with three WebMCP tools an AI agent can call. They read the status, water a bed and harvest it. Browsers without WebMCP get a polyfill and a tool console.",
    path: "/practice/webmcp-demo.html",
    category: "AI agents",
    difficulty: "beginner",
    tags: ["webmcp", "ai-agents", "tools", "prompt-injection", "polyfill"],
    highlights: [
      "A read-only tool whose output includes a prompt injection",
      "A tool that waters a bed and updates the page",
      "A harvest tool that asks you to confirm first",
      "Each browser tab gets its own greenhouse",
    ],
    api: "/api/v1/practice/webmcp-demo/*",
    icon: "fa-robot",
    addedAt: "2026-10-12",
  },
  {
    id: "webmcp-seed-shop",
    title: "WebMCP seed shop",
    summary:
      "A seed shop whose WebMCP tools change with the cart. Removing an item and placing the order only exist while the cart has something in it.",
    path: "/practice/webmcp-seed-shop.html",
    category: "AI agents",
    difficulty: "intermediate",
    tags: ["webmcp", "ai-agents", "tools", "dynamic-tools", "polyfill"],
    highlights: [
      "Tools register and unregister as the cart fills and empties",
      "A live list of the tools registered right now",
      "Placing an order asks you to confirm first",
      "Runs in the browser, no backend",
    ],
    api: null,
    icon: "fa-basket-shopping",
    addedAt: "2026-10-13",
  },
];

function getCatalog() {
  return {
    pages: PRACTICE_PAGES.map((page) => ({ ...page, tags: [...page.tags], highlights: [...page.highlights] })),
    difficulties: [...DIFFICULTIES],
  };
}

module.exports = { getCatalog, PRACTICE_PAGES, DIFFICULTIES };
