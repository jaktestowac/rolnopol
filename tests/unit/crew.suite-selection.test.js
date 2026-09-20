import { describe, it, expect } from "vitest";

// What `npm run crew:test` selects (§14.5, §14.6).
//
// The script is two lines that lean on the vitest projects plus a `crew` path
// filter, instead of naming all 30 files. The reasoning, and the shared checks,
// live in `tests/helpers/suite-selection.js` — this file just points them at the
// crew module. `agri-academy.suite-selection.test.js` is its sibling.
const { assertSuiteSelection, selectedBy, testFiles } = require("../helpers/suite-selection");

describe("the crew:test selector", () => {
  it("is well-formed and selects every crew test", () => {
    assertSuiteSelection({
      expect,
      script: "crew:test",
      filter: "crew",
      // Crew is an in-process module, so its tests require its source directly —
      // which makes content detection reliable here.
      sourcePattern: /require\(["'][^"']*(services\/crew|crew-harness|pages\/crew-api|crew-graphql)/,
      minFiles: 25,
    });
  });

  it("covers all three layers", () => {
    // A regression in the filter that quietly dropped a whole layer would still
    // pass the checks above, because each layer would merely look smaller.
    const selected = selectedBy("crew", testFiles());
    expect(selected.filter((file) => file.startsWith("unit/")).length).toBeGreaterThan(10);
    expect(selected.filter((file) => file.startsWith("property/")).length).toBeGreaterThan(1);
    expect(selected.filter((file) => !file.includes("/")).length).toBeGreaterThan(8);
  });
});
