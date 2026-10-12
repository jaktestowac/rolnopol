import { describe, expect, it } from "vitest";

const explainer = require("../../public/js/pages/webmcp-explainer.js");

describe("WebMCP explainer content", () => {
  it("shows the browser agent as the only thing the polyfill cannot do", () => {
    const polyfillGaps = explainer.CAPABILITIES.filter(([, native, polyfill]) => native && !polyfill).map(([label]) => label);

    expect(polyfillGaps).toEqual(["The browser's built-in AI agent can call the tools"]);
    expect(explainer.CAPABILITIES.every(([, native]) => native)).toBe(true);
  });

  it("draws the same callers in both flows, blocked only for the browser agent under the polyfill", () => {
    const callers = (key) => explainer.FLOWS[key].callers.map(({ label, works }) => [label, works]);

    expect(callers("native")).toEqual([
      ["Browser AI agent", true],
      ["Tool console, DevTools, tests", true],
    ]);
    expect(callers("polyfill")).toEqual([
      ["Browser AI agent", false],
      ["Tool console, DevTools, tests", true],
    ]);
  });
});
