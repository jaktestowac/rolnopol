import { describe, it, expect } from "vitest";

// The module tab strip, and the pillar filtering §10.1 asks for.
//
// "Tabs render only for enabled pillars" sounds like a one-liner and has three
// awkward cases hiding in it, all of which are about what happens BEFORE the server
// has answered or when the answer is inconvenient:
//
//   1. the page renders its strip immediately, so there is a moment with no pillar
//      list at all;
//   2. the page you are ON might be a switched-off pillar's page — hiding its own
//      tab would leave nothing marked current, which reads as a broken page;
//   3. two tabs belong to no pillar and must never be filtered.
//
// Pure function, so all three are a function call rather than a browser.
const CrewApi = require("../../public/js/pages/crew-api.js");

const hrefs = (tabs) => tabs.map((tab) => tab.href);
const ALL = ["/crew.html", "/crew-work.html", "/crew-leave.html", "/crew-tools.html", "/crew-explorer.html"];

describe("moduleTabs — the current tab", () => {
  it("marks the tab matching the path, and only that one", () => {
    const tabs = CrewApi.moduleTabs("/crew-leave.html");
    expect(tabs.filter((tab) => tab.active).map((tab) => tab.href)).toEqual(["/crew-leave.html"]);
  });

  it("treats the bare /crew redirect target as the roster", () => {
    expect(CrewApi.moduleTabs("/crew").find((tab) => tab.active).href).toBe("/crew.html");
  });

  it("tolerates a query string and a trailing slash", () => {
    expect(CrewApi.moduleTabs("/crew-member.html?staffId=3").filter((tab) => tab.active)).toEqual([]);
    expect(CrewApi.moduleTabs("/crew-leave.html/").find((tab) => tab.active).href).toBe("/crew-leave.html");
  });

  it("marks nothing current on a page that has no tab of its own", () => {
    // The detail page is reached FROM the roster and carries its own in-page tabs, so
    // it deliberately has no entry in this strip.
    expect(CrewApi.moduleTabs("/crew-member.html").filter((tab) => tab.active)).toEqual([]);
  });
});

describe("moduleTabs — pillar filtering", () => {
  it("shows everything when the pillar list is not known yet", () => {
    // Case 1. A strip that started short and grew would jump under the cursor, and
    // showing a tab briefly is the better failure: it leads to a page that explains
    // itself, whereas hiding one leaves a working view unreachable.
    expect(hrefs(CrewApi.moduleTabs("/crew.html"))).toEqual(ALL);
    expect(hrefs(CrewApi.moduleTabs("/crew.html", null))).toEqual(ALL);
    expect(hrefs(CrewApi.moduleTabs("/crew.html", undefined))).toEqual(ALL);
  });

  it("drops the tabs whose pillar is absent", () => {
    const tabs = hrefs(CrewApi.moduleTabs("/crew.html", ["profiles", "work"]));
    expect(tabs).toContain("/crew-work.html");
    expect(tabs).not.toContain("/crew-leave.html");
    expect(tabs).not.toContain("/crew-tools.html");
  });

  it("never drops the roster or the explorer, whatever the pillar list says", () => {
    // Case 3. The roster reads `staff.json` and the explorer needs no pillar at all,
    // so neither has one to switch off — including for an empty list.
    for (const pillars of [[], ["profiles"], ["profiles", "work", "leave", "training", "tools"]]) {
      const tabs = hrefs(CrewApi.moduleTabs("/crew.html", pillars));
      expect(tabs).toContain("/crew.html");
      expect(tabs).toContain("/crew-explorer.html");
    }
  });

  it("keeps the tab for the page you are ON, even when its pillar is absent", () => {
    // Case 2. Someone deep-linking to a switched-off pillar's page still gets a
    // coherent strip with their position marked; the page itself says what is missing.
    const tabs = CrewApi.moduleTabs("/crew-tools.html", ["profiles", "work"]);
    const current = tabs.find((tab) => tab.href === "/crew-tools.html");
    expect(current).toBeDefined();
    expect(current.active).toBe(true);
    // And it did not smuggle the OTHER absent pillars back in.
    expect(hrefs(tabs)).not.toContain("/crew-leave.html");
  });

  it("shows every pillar tab when all four pillars are assembled", () => {
    expect(hrefs(CrewApi.moduleTabs("/crew.html", ["profiles", "work", "leave", "training", "tools"]))).toEqual(ALL);
  });

  it("keeps the declared order regardless of the order pillars are reported in", () => {
    // The strip's order is a layout decision, not an echo of whatever the server
    // happened to assemble first.
    const shuffled = CrewApi.moduleTabs("/crew.html", ["tools", "leave", "work", "profiles"]);
    expect(hrefs(shuffled)).toEqual(ALL);
  });

  it("carries the pillar on each tab, so the filter has something to read", () => {
    const byHref = new Map(CrewApi.moduleTabs("/crew.html").map((tab) => [tab.href, tab.pillar]));
    expect(byHref.get("/crew-work.html")).toBe("work");
    expect(byHref.get("/crew-leave.html")).toBe("leave");
    expect(byHref.get("/crew-tools.html")).toBe("tools");
    expect(byHref.get("/crew.html")).toBeNull();
    expect(byHref.get("/crew-explorer.html")).toBeNull();
  });
});

describe("the tab pillars match the pillars the server can actually assemble", () => {
  // A tab naming a pillar that does not exist would be hidden forever, and nobody
  // would notice — the page would simply never appear in the strip.
  const { assembleCrewSchema } = require("../../services/crew/registry");

  it("names only real pillars", () => {
    const assembled = assembleCrewSchema().pillars.map((pillar) => pillar.name);
    // `tools` is Phase 6 and not assembled yet, so it is allowed to be absent from
    // the registry while its page still carries an honest placeholder.
    const known = new Set([...assembled, "tools"]);
    for (const tab of CrewApi.MODULE_TABS) {
      if (!tab.pillar) continue;
      expect(known.has(tab.pillar)).toBe(true);
    }
  });

  it("has a tab for every assembled pillar that owns a page", () => {
    // Three exemptions, and they are the same exemption three times: a pillar that
    // is only ever read PER MEMBER lives as a tab on the detail page instead of a
    // page of its own. Profiles owns the roster (whose tab has no `pillar`, because
    // it is never absent); training is one person's certificates; documents is one
    // person's personnel file. A module-wide "all documents" page would be a list of
    // files belonging to nobody in particular — which is not a question anyone asks.
    const MEMBER_SCOPED = ["profiles", "training", "documents"];
    const assembled = assembleCrewSchema().pillars.map((pillar) => pillar.name);
    const tabbed = CrewApi.MODULE_TABS.map((tab) => tab.pillar).filter(Boolean);
    for (const pillar of assembled) {
      if (MEMBER_SCOPED.includes(pillar)) continue;
      expect(tabbed).toContain(pillar);
    }
  });
});

describe("leave labels", () => {
  it("names every leave type and status", () => {
    expect(CrewApi.labelForLeaveType("ANNUAL")).toBe("Annual");
    expect(CrewApi.labelForLeaveStatus("REQUESTED")).toBe("Awaiting decision");
    // Two words for two events, as the server distinguishes them.
    expect(CrewApi.labelForLeaveStatus("WITHDRAWN")).toBe("Withdrawn");
    expect(CrewApi.labelForLeaveStatus("CANCELLED")).toBe("Cancelled");
  });

  it("falls back to the raw value rather than rendering blank", () => {
    expect(CrewApi.labelForLeaveType("SABBATICAL")).toBe("SABBATICAL");
    expect(CrewApi.labelForLeaveStatus(null)).toBe("—");
  });

  it("covers every enum value the schema declares", () => {
    // The same drift guard the certification labels have.
    const { assembleCrewSchema } = require("../../services/crew/registry");
    const schema = assembleCrewSchema().schema;
    const values = (name) =>
      schema
        .getType(name)
        .getValues()
        .map((value) => value.name)
        .sort();

    expect(Object.keys(CrewApi.LEAVE_TYPE_LABELS).sort()).toEqual(values("LeaveType"));
    expect(Object.keys(CrewApi.LEAVE_STATUS_LABELS).sort()).toEqual(values("LeaveStatus"));
  });
});

describe("describeUnion for the leave outcomes", () => {
  it("reports a booking with a warning as a SUCCESS, leading with the booking", () => {
    // §8.3's central UX rule. Leading with the warning would read as a refusal —
    // exactly the bug the PRD calls out — so the sentence has to start with the fact
    // that the request went in.
    const sentence = CrewApi.describeUnion({
      __typename: "LeaveBookedWithWarning",
      warnings: [{ code: "COVERAGE_THIN", message: "2 others are already off." }],
    });
    expect(sentence).toMatch(/^Holiday requested/);
    expect(sentence).toContain("2 others are already off.");
    expect(sentence).toMatch(/booked either way/i);
  });

  it("describes each refusal with the number or date that makes it actionable", () => {
    expect(
      CrewApi.describeUnion({ __typename: "InsufficientBalance", requested: 5, remaining: 3, shortfall: 2, asOf: "2026-10-09" }),
    ).toContain("short by 2");
    expect(CrewApi.describeUnion({ __typename: "InsufficientNotice", minNoticeDays: 3, earliestStart: "2026-08-02" })).toContain(
      "2026-08-02",
    );
    expect(CrewApi.describeUnion({ __typename: "BlackoutPeriod", reason: "Harvest", firstClash: "2026-08-17" })).toContain("Harvest");
    expect(CrewApi.describeUnion({ __typename: "OverlapsExistingLeave", from: "2026-10-05", to: "2026-10-09" })).toContain("2026-10-05");
  });

  it("names the states in an illegal transition in human words", () => {
    const sentence = CrewApi.describeUnion({
      __typename: "IllegalLeaveTransition",
      from: "APPROVED",
      to: "APPROVED",
      allowed: ["CANCELLED"],
    });
    expect(sentence).toContain("approved");
    expect(sentence).toContain("Cancelled");
  });

  it("has a sentence for every union member the leave pillar can return", () => {
    // A `__typename` with no case falls through to the raw type name, which is a
    // sentence no user can act on.
    for (const typename of [
      "LeaveBooked",
      "LeaveBookedWithWarning",
      "InsufficientBalance",
      "OverlapsExistingLeave",
      "BlackoutPeriod",
      "InsufficientNotice",
      "LeaveRequestDecided",
      "LeaveRequestNotFound",
      "IllegalLeaveTransition",
      "LeavePolicySet",
      "LeaveBalanceAdjusted",
      "BlackoutDeclared",
      "LeavePolicyMissing",
      "LeaveValidationFailed",
    ]) {
      const sentence = CrewApi.describeUnion({
        __typename: typename,
        warnings: [],
        allowed: [],
        fieldErrors: [],
        request: { status: "APPROVED" },
      });
      expect(sentence).not.toBe(typename);
      expect(sentence.length).toBeGreaterThan(3);
    }
  });
});

describe("the holidays page's pure helpers", () => {
  const CrewLeave = require("../../public/js/pages/crew-leave.js");

  it("resolves a month range from any day in it", () => {
    expect(CrewLeave.monthRange("2026-07-15", 0)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(CrewLeave.monthRange("2026-07-15", 1)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("asks the calendar how long February is", () => {
    expect(CrewLeave.monthRange("2026-02-10", 0).to).toBe("2026-02-28");
    expect(CrewLeave.monthRange("2028-02-10", 0).to).toBe("2028-02-29");
  });

  it("crosses a year boundary when asked for next month in December", () => {
    expect(CrewLeave.monthRange("2026-12-10", 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("returns null for an unusable date rather than a wrong range", () => {
    expect(CrewLeave.monthRange("not-a-date", 0)).toBeNull();
  });

  it("exports balances as CSV with a header and quoted fields", () => {
    const csv = CrewLeave.balancesCsv({
      nodes: [
        {
          staffId: "3",
          name: "Marek",
          surname: "Nowak",
          profile: { role: "MECHANIC" },
          leave: { balance: { entitlement: 26, accrued: 20, carriedOver: 2, taken: 5, booked: 5, remaining: 12 } },
        },
      ],
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Remaining"');
    expect(lines[1]).toBe('"3","Marek Nowak","MECHANIC","26","20","2","5","5","12"');
  });

  it("survives a name containing a comma or a quote", () => {
    // The one fiddly part of hand-rolled CSV, and the reason it is worth a test.
    const csv = CrewLeave.balancesCsv({
      nodes: [{ staffId: "4", name: 'Ala "The Boss"', surname: "Zielinska, Jr", profile: null, leave: null }],
    });
    expect(csv).toContain('"Ala ""The Boss"" Zielinska, Jr"');
  });

  it("exports a member with no balance without crashing", () => {
    const csv = CrewLeave.balancesCsv({ nodes: [{ staffId: "9", name: "New", surname: "Starter", profile: null, leave: null }] });
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("exports an empty roster as just the header", () => {
    expect(CrewLeave.balancesCsv({ nodes: [] }).split("\r\n")).toHaveLength(1);
    expect(CrewLeave.balancesCsv(null).split("\r\n")).toHaveLength(1);
  });
});
