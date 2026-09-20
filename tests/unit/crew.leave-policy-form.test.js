import { describe, it, expect } from "vitest";

// Configuring the leave policy from the UI.
//
// This exists because of a real complaint. The page used to meet a first-time user
// with: "No leave policy is configured yet… Set one with the setLeavePolicy mutation
// — the GraphQL explorer can do it." That is a true sentence and a useless one: it
// tells somebody running a farm to go and write a GraphQL query.
//
// **The policy is per ACCOUNT, not per crew member.** Entitlement, accrual mode,
// carry-over, the leave year, notice and the farm's public holidays are properties of
// the farm. What varies per person is their FTE and start date, which live on their
// employment profile and are what the accrual is pro-rated by. Getting that backwards
// would mean maintaining the same eight numbers once per employee.
//
// The parsing helpers are pure and get swept directly; the form is driven through the
// shared DOM harness.
const BOARD = require("../fixtures/crew-leave-board.json");
const { loadLeavePage, fire } = require("../helpers/crew-leave-harness");

/** No policy configured — the state the complaint came from. */
const NO_POLICY = (() => {
  const board = JSON.parse(JSON.stringify(BOARD));
  board.leavePolicy = null;
  board.crew.nodes = board.crew.nodes.map((node) => ({ ...node, leave: null }));
  return board;
})();

let elements;
let page;
let calls;
let CrewApi;

/**
 * The default network: board loads answer with the fixture, a policy save succeeds.
 *
 * Spelled out rather than reusing the panels suite's blanket `{ data: BOARD }`, because
 * this suite's subject is the SAVE — and a stub that returned the board for a mutation
 * would hand the controller a response with no `setLeavePolicy` in it.
 */
function defaultRun(board) {
  return async (operation) => {
    if (operation === global.window.CrewApi.OPERATIONS.SET_LEAVE_POLICY) {
      return {
        ok: true,
        status: 200,
        data: { setLeavePolicy: { __typename: "LeavePolicySet", policy: { ...BOARD.leavePolicy, version: 9 } } },
      };
    }
    return { ok: true, status: 200, data: board };
  };
}

async function loadPage(response) {
  const board = (response && response.data) || BOARD;
  const run = await loadLeavePage(response && response.run ? response : { run: defaultRun(board) });
  elements = run.elements;
  page = run.page;
  calls = run.calls;
  CrewApi = run.CrewApi;
  return run;
}

const policySaves = () => calls.filter((call) => call.operation === CrewApi.OPERATIONS.SET_LEAVE_POLICY);
const boardLoads = () => calls.filter((call) => call.operation === CrewApi.OPERATIONS.LEAVE_BOARD);

// --- the pure parsers -------------------------------------------------------

describe("parseDateList", () => {
  it("accepts a list separated by newlines, commas, semicolons or spaces", async () => {
    // People paste holiday lists from anywhere, so the separator is not worth being
    // strict about — the DATES are.
    await loadPage();
    expect(page.parseDateList("2026-01-01\n2026-05-01").dates).toEqual(["2026-01-01", "2026-05-01"]);
    expect(page.parseDateList("2026-01-01, 2026-05-01").dates).toEqual(["2026-01-01", "2026-05-01"]);
    expect(page.parseDateList("2026-01-01 2026-05-01;2026-12-25").dates).toHaveLength(3);
  });

  it("sorts and de-duplicates, so a pasted list cannot double-count a holiday", async () => {
    await loadPage();
    expect(page.parseDateList("2026-05-01\n2026-01-01\n2026-05-01").dates).toEqual(["2026-01-01", "2026-05-01"]);
  });

  it("REPORTS a bad entry rather than dropping it", async () => {
    // Silently ignoring a typo would mean somebody's holiday is charged as a working
    // day and nobody is told why.
    await loadPage();
    const parsed = page.parseDateList("2026-01-01\n01/05/2026\nnonsense");
    expect(parsed.dates).toEqual(["2026-01-01"]);
    expect(parsed.invalid).toEqual(["01/05/2026", "nonsense"]);
  });

  it("rejects a date that matches the pattern but is not a real day", async () => {
    await loadPage();
    expect(page.parseDateList("2026-02-30").invalid).toEqual(["2026-02-30"]);
    // …and accepts the leap day in a leap year.
    expect(page.parseDateList("2028-02-29").dates).toEqual(["2028-02-29"]);
    expect(page.parseDateList("2026-02-29").invalid).toEqual(["2026-02-29"]);
  });

  it("treats blank input as an empty list, not as an error", async () => {
    await loadPage();
    for (const text of ["", "   \n\n ", null, undefined]) {
      expect(page.parseDateList(text)).toEqual({ dates: [], invalid: [] });
    }
  });
});

describe("parseBlackoutWindows", () => {
  it("reads one from,to,reason per line", async () => {
    await loadPage();
    const parsed = page.parseBlackoutWindows("2026-08-15,2026-09-15,Harvest\n2026-12-24,2026-12-26,Christmas");
    expect(parsed.windows).toEqual([
      { from: "2026-08-15", to: "2026-09-15", reason: "Harvest" },
      { from: "2026-12-24", to: "2026-12-26", reason: "Christmas" },
    ]);
  });

  it("keeps a reason that itself contains commas", async () => {
    // Only the first two fields are dates; everything after is the reason. Splitting
    // on every comma would truncate "Harvest, silage and drilling" at the first one.
    await loadPage();
    expect(page.parseBlackoutWindows("2026-08-15,2026-09-15,Harvest, silage, and drilling").windows[0].reason).toBe(
      "Harvest, silage, and drilling",
    );
  });

  it("allows a window with no reason", async () => {
    await loadPage();
    expect(page.parseBlackoutWindows("2026-08-15,2026-09-15").windows[0].reason).toBeNull();
  });

  it("reports a backwards range or a malformed line instead of saving it", async () => {
    await loadPage();
    const parsed = page.parseBlackoutWindows("2026-09-15,2026-08-15,Backwards\nrubbish\n2026-08-15,Harvest");
    expect(parsed.windows).toEqual([]);
    expect(parsed.invalid).toHaveLength(3);
  });

  it("round-trips through formatBlackoutWindows", async () => {
    // The form is pre-filled from what is stored and saving REPLACES the list, so a
    // save must not mangle windows the user never touched.
    await loadPage();
    const windows = [
      { from: "2026-08-15", to: "2026-09-15", reason: "Harvest" },
      { from: "2026-12-24", to: "2026-12-26", reason: null },
    ];
    expect(page.parseBlackoutWindows(page.formatBlackoutWindows(windows)).windows).toEqual(windows);
  });

  it("formats an empty list as empty text, not as a blank line", async () => {
    await loadPage();
    expect(page.formatBlackoutWindows([])).toBe("");
    expect(page.formatBlackoutWindows(null)).toBe("");
  });
});

describe("policyFormValues", () => {
  it("opens on the server's own defaults when there is no policy", async () => {
    // The point of the panel is to get from "no policy" to "a working policy" in one
    // save. A blank form makes somebody invent eight numbers.
    await loadPage();
    const values = page.policyFormValues(null);
    expect(values).toMatchObject({ annualEntitlementDaysFullTime: 26, accrualMode: "MONTHLY", leaveYearStart: "01-01", minNoticeDays: 3 });
    // Nothing to conflict with yet, so no version is sent.
    expect(values.expectedVersion).toBeNull();
  });

  it("mirrors the server's defaults exactly", async () => {
    // If the two drift, a first-time form quietly proposes something the server would
    // not have chosen.
    await loadPage();
    const { DEFAULT_POLICY } = require("../../services/crew/pillars/leave/service");
    expect(page.POLICY_DEFAULTS.annualEntitlementDaysFullTime).toBe(DEFAULT_POLICY.annualEntitlementDaysFullTime);
    expect(page.POLICY_DEFAULTS.carryOverCapDays).toBe(DEFAULT_POLICY.carryOverCapDays);
    expect(page.POLICY_DEFAULTS.carryOverExpiresOn).toBe(DEFAULT_POLICY.carryOverExpiresOn);
    expect(page.POLICY_DEFAULTS.leaveYearStart).toBe(DEFAULT_POLICY.leaveYearStart);
    expect(page.POLICY_DEFAULTS.minNoticeDays).toBe(DEFAULT_POLICY.minNoticeDays);
    // The graph spells the mode in SCREAMING_CASE; the store spells it lower.
    expect(page.POLICY_DEFAULTS.accrualMode.toLowerCase()).toBe(DEFAULT_POLICY.accrualMode);
  });

  it("pre-fills from the stored policy, including both lists", async () => {
    await loadPage();
    const values = page.policyFormValues({
      annualEntitlementDaysFullTime: 30,
      accrualMode: "UPFRONT",
      carryOverCapDays: 3,
      carryOverExpiresOn: "06-30",
      leaveYearStart: "04-06",
      minNoticeDays: 7,
      publicHolidays: ["2026-01-01", "2026-05-01"],
      blackoutWindows: [{ from: "2026-08-15", to: "2026-09-15", reason: "Harvest" }],
      version: 4,
    });
    expect(values.publicHolidays).toBe("2026-01-01\n2026-05-01");
    expect(values.blackoutWindows).toBe("2026-08-15,2026-09-15,Harvest");
    // The version travels so a concurrent edit conflicts rather than overwriting.
    expect(values.expectedVersion).toBe(4);
  });

  it("renders an absent carry-over expiry as blank, not as the string 'null'", async () => {
    await loadPage();
    expect(page.policyFormValues({ carryOverExpiresOn: null, version: 1 }).carryOverExpiresOn).toBe("");
  });
});

// --- the panel --------------------------------------------------------------

describe("the panel", () => {
  it("offers a set-up button instead of telling the user to write a GraphQL query", async () => {
    await loadPage({ data: NO_POLICY });
    const html = elements.get("leavePolicyPanel").innerHTML;

    expect(html).toContain('id="leavePolicySetup"');
    expect(html).toMatch(/Set up the leave policy/);
    // The sentence that prompted this change must not come back.
    expect(html).not.toMatch(/setLeavePolicy|GraphQL explorer/);
    // And it says the policy is account-wide, which is the thing people get wrong.
    expect(html).toMatch(/whole crew/);
  });

  it("opens the form from that button, pre-filled with the defaults", async () => {
    await loadPage({ data: NO_POLICY });
    await fire(elements.get("leavePolicySetup"), "click");

    expect(elements.get("leavePolicyForm").hidden).toBe(false);
    expect(elements.get("policyEntitlement").value).toBe("26");
    expect(elements.get("policyLeaveYearStart").value).toBe("01-01");
    expect(elements.get("policyAccrualMode").innerHTML).toContain("MONTHLY");
  });

  it("opens from the toolbar pre-filled with the STORED policy", async () => {
    await loadPage({ data: BOARD });
    await fire(elements.get("leavePolicyToggle"), "click");

    expect(elements.get("policyEntitlement").value).toBe(String(BOARD.leavePolicy.annualEntitlementDaysFullTime));
    expect(elements.get("policyMinNotice").value).toBe(String(BOARD.leavePolicy.minNoticeDays));
  });

  it("closes the request form when it opens, and vice versa", async () => {
    // They share one strip, so two stacked forms leave no clue which button produced
    // what — the same rule the work board's toolbar follows.
    await loadPage();
    await fire(elements.get("leaveRequestToggle"), "click");
    expect(elements.get("leaveRequestPanel").hidden).toBe(false);

    await fire(elements.get("leavePolicyToggle"), "click");
    expect(elements.get("leavePolicyForm").hidden).toBe(false);
    expect(elements.get("leaveRequestPanel").hidden).toBe(true);

    await fire(elements.get("leaveRequestToggle"), "click");
    expect(elements.get("leavePolicyForm").hidden).toBe(true);
  });

  it("tracks aria-expanded, and clears field marks on cancel", async () => {
    await loadPage();
    const toggle = elements.get("leavePolicyToggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await fire(toggle, "click");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    elements.get("policyEntitlement").setAttribute("aria-invalid", "true");
    await fire(elements.get("leavePolicyCancel"), "click");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(elements.get("policyEntitlement").getAttribute("aria-invalid")).toBeNull();
  });
});

// --- saving -----------------------------------------------------------------

describe("saving the policy", () => {
  /** Open the form, override some fields, submit. */
  async function save(values, response) {
    await loadPage(response);
    await fire(elements.get("leavePolicyToggle"), "click");
    for (const [id, value] of Object.entries(values || {})) elements.get(id).value = value;
    await fire(elements.get("leavePolicyFormEl"), "submit");
  }

  it("sends a complete LeavePolicyInput with the version it was drawn from", async () => {
    await save({});
    expect(policySaves()).toHaveLength(1);
    expect(policySaves()[0].variables.input).toMatchObject({
      annualEntitlementDaysFullTime: 26,
      accrualMode: "MONTHLY",
      leaveYearStart: "01-01",
      expectedVersion: BOARD.leavePolicy.version,
    });
  });

  it("sends the parsed holiday and blackout lists", async () => {
    await save({ policyPublicHolidays: "2026-12-25\n2026-01-01", policyBlackouts: "2026-08-15,2026-09-15,Harvest" });
    const input = policySaves()[0].variables.input;
    expect(input.publicHolidays).toEqual(["2026-01-01", "2026-12-25"]);
    expect(input.blackoutWindows).toEqual([{ from: "2026-08-15", to: "2026-09-15", reason: "Harvest" }]);
  });

  it("sends carryOverExpiresOn as null when blank, so 'never expires' is expressible", async () => {
    await save({ policyCarryOverExpires: "" });
    expect(policySaves()[0].variables.input.carryOverExpiresOn).toBeNull();
  });

  it("omits expectedVersion on a FIRST save, so the server creates rather than conflicting", async () => {
    await save({}, { data: NO_POLICY });
    expect(policySaves()[0].variables.input).not.toHaveProperty("expectedVersion");
  });

  it("preserves the stored lists when the user changes only a number", async () => {
    // Saving replaces the lists, so a form that did not round-trip them would silently
    // delete every public holiday the moment somebody edited the entitlement.
    await save({ policyEntitlement: "28" });
    const input = policySaves()[0].variables.input;
    expect(input.annualEntitlementDaysFullTime).toBe(28);
    expect(input.publicHolidays).toEqual([...BOARD.leavePolicy.publicHolidays].sort());
    expect(input.blackoutWindows).toEqual(
      BOARD.leavePolicy.blackoutWindows.map((w) => ({ from: w.from, to: w.to, reason: w.reason || null })),
    );
  });

  it("closes the form and reloads the board on success", async () => {
    await save({});
    expect(elements.get("leavePolicyForm").hidden).toBe(true);
    // The initial load plus the refresh, so the balances reflect the new policy.
    expect(boardLoads()).toHaveLength(2);
  });

  describe("refusals", () => {
    it("refuses a leave-year anchor above day 28, before it reaches the graph", async () => {
      // Every one of the twelve month slices has to exist in February too — the
      // server's rule, mirrored here so the message names the field.
      await save({ policyLeaveYearStart: "01-31" });
      expect(policySaves()).toHaveLength(0);
      expect(elements.get("policyLeaveYearStart").getAttribute("aria-invalid")).toBe("true");
      expect(elements.get("leavePolicyErrors").textContent).toMatch(/01 and 28/);
    });

    it("refuses a malformed carry-over expiry", async () => {
      await save({ policyCarryOverExpires: "31st March" });
      expect(policySaves()).toHaveLength(0);
      expect(elements.get("policyCarryOverExpires").getAttribute("aria-invalid")).toBe("true");
    });

    it("names the offending date when a holiday list will not parse", async () => {
      await save({ policyPublicHolidays: "2026-01-01\n01/05/2026" });
      expect(policySaves()).toHaveLength(0);
      expect(elements.get("leavePolicyErrors").textContent).toContain("01/05/2026");
      expect(elements.get("policyPublicHolidays").getAttribute("aria-invalid")).toBe("true");
    });

    it("names the offending line when a blackout will not parse", async () => {
      await save({ policyBlackouts: "2026-09-15,2026-08-15,Backwards" });
      expect(policySaves()).toHaveLength(0);
      expect(elements.get("policyBlackouts").getAttribute("aria-invalid")).toBe("true");
    });

    it.each([
      ["policyEntitlement", "99"],
      ["policyEntitlement", ""],
      ["policyEntitlement", "26.3"],
      ["policyCarryOverCap", "99"],
      ["policyMinNotice", "-1"],
      ["policyMinNotice", "2.5"],
    ])("refuses %s = %s, naming the field", async (id, value) => {
      await save({ [id]: value });
      expect(policySaves()).toHaveLength(0);
      expect(elements.get(id).getAttribute("aria-invalid")).toBe("true");
    });

    it("marks the same inputs for a SERVER rejection as for a client-side one", async () => {
      await loadPage({
        run: async (operation) => {
          if (operation !== CrewApi.OPERATIONS.SET_LEAVE_POLICY) return { ok: true, status: 200, data: BOARD };
          return {
            ok: true,
            status: 200,
            data: {
              setLeavePolicy: { __typename: "LeaveValidationFailed", fieldErrors: [{ field: "minNoticeDays", message: "too long" }] },
            },
          };
        },
      });
      await fire(elements.get("leavePolicyToggle"), "click");
      await fire(elements.get("leavePolicyFormEl"), "submit");

      expect(elements.get("policyMinNotice").getAttribute("aria-invalid")).toBe("true");
      expect(elements.get("leavePolicyErrors").textContent).toContain("too long");
      // The form stays open so nothing typed is lost.
      expect(elements.get("leavePolicyForm").hidden).toBe(false);
    });

    it("tells the user to reload on a version conflict rather than retrying", async () => {
      // Re-sending this form would overwrite a policy the user has not seen.
      await loadPage({
        run: async (operation) => {
          if (operation !== CrewApi.OPERATIONS.SET_LEAVE_POLICY) return { ok: true, status: 200, data: BOARD };
          return {
            ok: true,
            status: 200,
            data: { setLeavePolicy: { __typename: "VersionConflict", expectedVersion: 1, actualVersion: 2 } },
          };
        },
      });
      await fire(elements.get("leavePolicyToggle"), "click");
      await fire(elements.get("leavePolicyFormEl"), "submit");

      expect(elements.get("leavePolicyErrors").textContent).toMatch(/Reload/);
      expect(elements.get("leavePolicyForm").hidden).toBe(false);
    });

    it("reports a transport failure without closing the form", async () => {
      await loadPage({
        run: async (operation) => {
          if (operation !== CrewApi.OPERATIONS.SET_LEAVE_POLICY) return { ok: true, status: 200, data: BOARD };
          return { ok: false, status: 500, errors: [{ message: "boom", extensions: { code: "INTERNAL_ERROR" } }] };
        },
      });
      await fire(elements.get("leavePolicyToggle"), "click");
      await fire(elements.get("leavePolicyFormEl"), "submit");

      expect(elements.get("leavePolicyErrors").textContent).toBeTruthy();
      expect(elements.get("leavePolicyForm").hidden).toBe(false);
    });
  });
});

describe("the operation itself", () => {
  it("validates against the assembled schema and asks for what the form needs back", async () => {
    // `crew-pages.test.js` validates every operation; this pins that the SELECTION is
    // enough to re-fill the form after a save, version included.
    await loadPage();
    const source = CrewApi.OPERATIONS.SET_LEAVE_POLICY;
    for (const field of ["annualEntitlementDaysFullTime", "accrualMode", "publicHolidays", "blackoutWindows", "version"]) {
      expect(source, `SET_LEAVE_POLICY does not select ${field}`).toContain(field);
    }
    // All three outcomes are branched on, so none is silently read as success.
    for (const member of ["LeavePolicySet", "LeaveValidationFailed", "VersionConflict"]) {
      expect(source).toContain(member);
    }
  });
});
