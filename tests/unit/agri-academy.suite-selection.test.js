import { describe, it, expect } from "vitest";

// What `npm run academy:test` selects.
//
// This file exists because the enumeration it replaced was WRONG, not merely long.
// `academy:test` named 14 files and there were 21; the seven it missed included
// `agri-academy.leaderboard.test.js`, which had been failing with nobody noticing —
// the only script that would have run it did not list it. An enumeration is a copy
// of the truth that has to be maintained, and this one had not been.
//
// The shared checks live in `tests/helpers/suite-selection.js`.
const { assertSuiteSelection, selectedBy, testFiles } = require("../helpers/suite-selection");

describe("the academy:test selector", () => {
  it("is well-formed and selects every academy test", () => {
    assertSuiteSelection({
      expect,
      script: "academy:test",
      // `agri-academy`, not `academy`: the longer string is what every academy test
      // path actually carries, and it cannot collide with an unrelated file that
      // happens to mention an academy.
      filter: "agri-academy",
      // AgriAcademy runs as standalone services, so its INTEGRATION tests dial HTTP
      // and require nothing academy-specific — content detection only finds the ones
      // that reach the app-side client module. That is fine: the naming and stranding
      // checks cover the rest, and this catches the case it can.
      sourcePattern: /require\(["'][^"']*modules\/agri-academy/,
      minFiles: 20,
    });
  });

  it("selects both layers the academy actually has", () => {
    // No property tests today. Asserted as zero rather than left unstated, so adding
    // one is a deliberate act that updates this line — and stage two already passes
    // `--project property`, so a new one would be picked up without touching the script.
    const selected = selectedBy("agri-academy", testFiles());
    expect(selected.filter((file) => file.startsWith("unit/")).length).toBeGreaterThan(10);
    expect(selected.filter((file) => !file.includes("/")).length).toBeGreaterThan(4);
    expect(selected.filter((file) => file.startsWith("property/"))).toEqual([]);
  });

  it("still selects the file the old enumeration forgot", () => {
    // The specific regression this whole change was worth making for.
    const selected = selectedBy("agri-academy", testFiles());
    expect(selected).toContain("unit/agri-academy.leaderboard.test.js");
    expect(selected).toContain("unit/agri-academy.clients.test.js");
    expect(selected).toContain("unit/agri-academy.shared.test.js");
  });
});
