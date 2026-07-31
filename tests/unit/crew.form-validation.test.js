import { describe, it, expect, vi } from "vitest";

// Crew Office form validation.
//
// Written because of a concrete bad experience: leaving `hours` blank produced
// `Number("")` → `NaN` → `null` on the wire, `Float!` refused it, and the user was
// told **"That operation does not match the schema."** That sentence is true about
// the transport and useless to the person filling in the form.
//
// So the rules that the server enforces are mirrored on the client, the messages name
// the field, and — the part that actually prevents the original bug — `numberOrNull`
// never returns NaN.
const CrewApi = require("../../public/js/pages/crew-api.js");
const { validateInput, numberOrNull, readValue, applyFieldErrors, clearFieldErrors } = CrewApi;

const messages = (rules) => validateInput(rules).map((error) => error.message);
const fields = (rules) => validateInput(rules).map((error) => error.field);

describe("required fields", () => {
  it("names the field instead of blaming the schema", () => {
    // The regression this file exists for.
    expect(messages([{ field: "hours", label: "Hours", value: "", required: true, kind: "number" }])).toEqual(["Hours is required."]);
  });

  it("treats whitespace as blank", () => {
    expect(fields([{ field: "activity", label: "Activity", value: "   \t", required: true }])).toEqual(["activity"]);
  });

  it("treats null and undefined as blank", () => {
    expect(fields([{ field: "role", label: "Role", value: null, required: true }])).toEqual(["role"]);
    expect(fields([{ field: "role", label: "Role", value: undefined, required: true }])).toEqual(["role"]);
  });

  it("lets an OPTIONAL blank through untouched", () => {
    // Optional means optional: `contractedHoursPerWeek` may legitimately be empty,
    // and complaining about it would block a valid hire.
    expect(validateInput([{ field: "hours", label: "Contracted hours", value: "", kind: "integer", min: 1, max: 80 }])).toEqual([]);
  });

  it("reports EVERY problem at once, not just the first", () => {
    const problems = fields([
      { field: "name", label: "Name", value: "", required: true },
      { field: "age", label: "Age", value: "", required: true, kind: "integer" },
      { field: "role", label: "Role", value: "", required: true },
    ]);
    expect(problems).toEqual(["name", "age", "role"]);
  });

  it("falls back to the field name when no label is given", () => {
    expect(messages([{ field: "staffId", value: "", required: true }])).toEqual(["staffId is required."]);
  });
});

describe("numbers", () => {
  const rule = (value, extra = {}) => [{ field: "hours", label: "Hours", value, required: true, kind: "number", ...extra }];

  it("accepts a valid number", () => {
    expect(validateInput(rule("2.5", { min: 0.25, max: 24, step: 0.25 }))).toEqual([]);
  });

  it("rejects text", () => {
    expect(messages(rule("half a day"))).toEqual(["Hours must be a number."]);
  });

  it("enforces the minimum and the maximum, inclusive", () => {
    expect(validateInput(rule("0.25", { min: 0.25, max: 24 }))).toEqual([]);
    expect(validateInput(rule("24", { min: 0.25, max: 24 }))).toEqual([]);
    expect(messages(rule("0", { min: 0.25, max: 24 }))).toEqual(["Hours must be at least 0.25."]);
    expect(messages(rule("24.25", { min: 0.25, max: 24 }))).toEqual(["Hours must be at most 24."]);
  });

  it("enforces the step, and does not trip over binary floating point", () => {
    // 2.5 / 0.25 is 9.999999999999998, so a naive modulo check would reject a valid
    // value. The quarter-hour steps below are exactly the ones a farm uses.
    for (const value of ["0.25", "0.5", "0.75", "1", "2.5", "7.25", "23.75"]) {
      expect(validateInput(rule(value, { step: 0.25 })), `step should accept ${value}`).toEqual([]);
    }
    expect(messages(rule("2.1", { step: 0.25 }))).toEqual(["Hours must be in steps of 0.25."]);
    expect(messages(rule("0.3", { step: 0.25 }))).toEqual(["Hours must be in steps of 0.25."]);
  });

  it("accepts every tenth for an FTE step", () => {
    for (const value of ["0.1", "0.2", "0.3", "0.5", "0.7", "0.8", "1"]) {
      expect(
        validateInput([{ field: "fte", label: "FTE", value, required: true, kind: "number", min: 0.1, max: 1, step: 0.1 }]),
        `fte should accept ${value}`,
      ).toEqual([]);
    }
  });

  it("requires whole numbers where the schema says Int", () => {
    const age = (value) => [{ field: "age", label: "Age", value, required: true, kind: "integer", min: 16, max: 120 }];
    expect(validateInput(age("34"))).toEqual([]);
    expect(messages(age("34.5"))).toEqual(["Age must be a whole number."]);
    expect(messages(age("15"))).toEqual(["Age must be at least 16."]);
    expect(messages(age("121"))).toEqual(["Age must be at most 120."]);
  });

  it("rejects Infinity and NaN spellings", () => {
    expect(messages(rule("Infinity"))).toEqual(["Hours must be a number."]);
    expect(messages(rule("NaN"))).toEqual(["Hours must be a number."]);
  });
});

describe("dates", () => {
  const rule = (value) => [{ field: "date", label: "Date", value, required: true, kind: "date" }];

  it("accepts YYYY-MM-DD", () => {
    expect(validateInput(rule("2026-08-03"))).toEqual([]);
  });

  it("rejects other shapes", () => {
    for (const value of ["03/08/2026", "2026-8-3", "2026-08-03T00:00:00Z", "next Tuesday"]) {
      expect(messages(rule(value)), value).toEqual(["Date must be a date."]);
    }
  });

  it("rejects a date that does not exist", () => {
    // The pattern accepts 30 February; only a round trip catches it — the same check
    // the server's Date scalar makes, so the two agree.
    expect(messages(rule("2026-02-30"))).toEqual(["Date is not a real date."]);
    expect(messages(rule("2023-02-29"))).toEqual(["Date is not a real date."]);
    expect(validateInput(rule("2024-02-29"))).toEqual([]); // a real leap day
  });
});

describe("times", () => {
  const rule = (value) => [{ field: "startTime", label: "Start time", value, required: true, kind: "time" }];

  it("accepts 24-hour HH:MM", () => {
    for (const value of ["00:00", "05:00", "22:30", "23:59"]) {
      expect(validateInput(rule(value)), value).toEqual([]);
    }
  });

  it("rejects anything else", () => {
    for (const value of ["24:00", "5:00", "05:60", "5am", "0500"]) {
      expect(messages(rule(value)), value).toEqual(["Start time must be a time in HH:MM, 24-hour."]);
    }
  });
});

describe("lengths and patterns", () => {
  it("caps length at the boundary", () => {
    expect(validateInput([{ field: "name", label: "Name", value: "x".repeat(100), maxLength: 100 }])).toEqual([]);
    expect(messages([{ field: "name", label: "Name", value: "x".repeat(101), maxLength: 100 }])).toEqual([
      "Name must be at most 100 characters.",
    ]);
  });

  it("applies a pattern with its own message", () => {
    const rule = (value) => [
      {
        field: "code",
        label: "Code",
        value,
        required: true,
        pattern: /^[a-z][a-z0-9_]{1,39}$/,
        patternMessage: "Code must be lower_snake_case.",
      },
    ];
    expect(validateInput(rule("milking_early"))).toEqual([]);
    expect(messages(rule("Milking Early"))).toEqual(["Code must be lower_snake_case."]);
    expect(messages(rule("1milking"))).toEqual(["Code must be lower_snake_case."]);
  });

  it("falls back to a generic message when a pattern has none", () => {
    expect(messages([{ field: "colour", label: "Colour", value: "green", pattern: /^#[0-9a-f]{6}$/ }])).toEqual([
      "Colour is not in the expected format.",
    ]);
  });
});

describe("numberOrNull", () => {
  it("never returns NaN — the whole point", () => {
    // `Number("")` is NaN and `JSON.stringify(NaN)` is `null`, which is exactly how a
    // blank field became a Float! coercion error.
    for (const value of ["", "   ", null, undefined, "abc", {}]) {
      expect(Number.isNaN(numberOrNull(value)), JSON.stringify(value)).toBe(false);
      expect(numberOrNull(value)).toBeNull();
    }
  });

  it("returns the number when there is one", () => {
    expect(numberOrNull("2.5")).toBe(2.5);
    expect(numberOrNull(" 40 ")).toBe(40);
    expect(numberOrNull(0)).toBe(0);
  });

  it("serialises to JSON null for a blank, never to the string NaN", () => {
    expect(JSON.stringify({ hours: numberOrNull("") })).toBe('{"hours":null}');
  });
});

describe("showing errors on the form", () => {
  /** A DOM stub just rich enough for applyFieldErrors. */
  function stubDom(ids) {
    const elements = new Map(
      ids.map((id) => [
        id,
        {
          id,
          attributes: {},
          focused: false,
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          removeAttribute(name) {
            delete this.attributes[name];
          },
          focus() {
            this.focused = true;
          },
        },
      ]),
    );
    global.document = { getElementById: (id) => elements.get(id) || null };
    return elements;
  }

  it("marks each offending input, focuses the first, and lists every message", () => {
    const elements = stubDom(["hoursInput", "activityInput"]);
    const status = { textContent: "", className: "", setAttribute() {} };

    applyFieldErrors(
      [
        { field: "hours", message: "Hours is required." },
        { field: "activity", message: "Activity is required." },
      ],
      { hours: "hoursInput", activity: "activityInput" },
      status,
    );

    expect(elements.get("hoursInput").attributes["aria-invalid"]).toBe("true");
    expect(elements.get("activityInput").attributes["aria-invalid"]).toBe("true");
    // Focus goes to the first offender, so a long form does not make the user hunt.
    expect(elements.get("hoursInput").focused).toBe(true);
    expect(elements.get("activityInput").focused).toBe(false);
    expect(status.textContent).toBe("Hours is required. Activity is required.");
  });

  it("clears previous marks before adding new ones", () => {
    const elements = stubDom(["hoursInput", "activityInput"]);
    const status = { textContent: "", className: "", setAttribute() {} };
    const idMap = { hours: "hoursInput", activity: "activityInput" };

    applyFieldErrors([{ field: "activity", message: "Activity is required." }], idMap, status);
    expect(elements.get("activityInput").attributes["aria-invalid"]).toBe("true");

    // Second pass: only hours is wrong now, so activity must stop being marked.
    applyFieldErrors([{ field: "hours", message: "Hours is required." }], idMap, status);
    expect(elements.get("activityInput").attributes["aria-invalid"]).toBeUndefined();
    expect(elements.get("hoursInput").attributes["aria-invalid"]).toBe("true");
  });

  it("does nothing at all when there are no errors", () => {
    const elements = stubDom(["hoursInput"]);
    const status = { textContent: "unchanged", className: "", setAttribute() {} };
    applyFieldErrors([], { hours: "hoursInput" }, status);
    expect(elements.get("hoursInput").attributes["aria-invalid"]).toBeUndefined();
    expect(status.textContent).toBe("unchanged");
  });

  it("survives a field the form has no input for", () => {
    // The server may name a field the form does not render (`userId`, say). It must
    // still be reported, not throw.
    stubDom(["hoursInput"]);
    const status = { textContent: "", className: "", setAttribute() {} };
    expect(() => applyFieldErrors([{ field: "userId", message: "userId is not accepted." }], { hours: "hoursInput" }, status)).not.toThrow();
    expect(status.textContent).toBe("userId is not accepted.");
  });

  it("clearFieldErrors tolerates a missing element and a missing map", () => {
    stubDom([]);
    expect(() => clearFieldErrors({ hours: "nope" })).not.toThrow();
    expect(() => clearFieldErrors(undefined)).not.toThrow();
  });

  it("readValue trims, and returns empty for a missing element", () => {
    global.document = { getElementById: (id) => (id === "there" ? { value: "  x  " } : null) };
    expect(readValue("there")).toBe("x");
    expect(readValue("missing")).toBe("");
  });
});

describe("no rules at all", () => {
  it("passes an empty or missing rule list", () => {
    expect(validateInput([])).toEqual([]);
    expect(validateInput(undefined)).toEqual([]);
  });
});
