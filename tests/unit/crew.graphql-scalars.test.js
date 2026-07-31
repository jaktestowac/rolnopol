import { describe, it, expect } from "vitest";

// Custom scalars (PRD §14.1).
//
// The headline property is COERCION PARITY: `graphql-js` sends variables through
// parseValue and literals through parseLiteral, and a scalar that validates in one
// but not the other accepts data through the back door. Every case below is
// therefore asserted through BOTH paths, driven from one table.
const { GraphQLDate, GraphQLDateTime, GraphQLDays, GraphQLNonEmptyString, MAX_STRING_LENGTH } = require("../../services/graphql/scalars");
const { Kind } = require("graphql");

/** Wrap a JS value as the AST literal node graphql-js would have parsed. */
function literalFor(value) {
  if (typeof value === "string") return { kind: Kind.STRING, value };
  if (typeof value === "number")
    return Number.isInteger(value) ? { kind: Kind.INT, value: String(value) } : { kind: Kind.FLOAT, value: String(value) };
  if (typeof value === "boolean") return { kind: Kind.BOOLEAN, value };
  if (value === null) return { kind: Kind.NULL };
  return { kind: Kind.OBJECT, fields: [] };
}

/** Accept-or-reject through both inbound paths, and assert they agree. */
function bothPaths(scalar, value) {
  const asVariable = attempt(() => scalar.parseValue(value));
  const asLiteral = attempt(() => scalar.parseLiteral(literalFor(value)));
  return { asVariable, asLiteral };
}

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

describe("crew graph scalars — Date", () => {
  const VALID = ["2026-07-29", "2024-02-29", "2000-01-01", "2026-12-31"];
  const INVALID = ["2026-7-29", "29-07-2026", "2026-02-30", "2023-02-29", "2026-13-01", "not a date", "", "2026-07-29T00:00:00Z"];

  it.each(VALID)("accepts %s as both a variable and a literal", (value) => {
    const { asVariable, asLiteral } = bothPaths(GraphQLDate, value);
    expect(asVariable.ok, asVariable.message).toBe(true);
    expect(asLiteral.ok, asLiteral.message).toBe(true);
    expect(asVariable.value).toBe(value);
    expect(asLiteral.value).toBe(value);
  });

  it.each(INVALID)("rejects %s through BOTH paths — no back door", (value) => {
    const { asVariable, asLiteral } = bothPaths(GraphQLDate, value);
    expect(asVariable.ok).toBe(false);
    expect(asLiteral.ok).toBe(false);
  });

  it("rejects 2026-02-30 because it is not a real calendar date, not merely mis-shaped", () => {
    // The regex would pass this. Only a round-trip check catches it, and February
    // is exactly where a leave-booking bug would hide.
    expect(() => GraphQLDate.parseValue("2026-02-30")).toThrow(/not a real calendar date/);
    expect(GraphQLDate.parseValue("2024-02-29")).toBe("2024-02-29"); // leap year, real
  });

  it("rejects a non-string variable and a non-string literal alike", () => {
    expect(() => GraphQLDate.parseValue(20260729)).toThrow();
    expect(() => GraphQLDate.parseLiteral({ kind: Kind.INT, value: "20260729" })).toThrow(/must be written as StringValue/);
  });
});

describe("crew graph scalars — DateTime", () => {
  it("canonicalises equivalent spellings of one instant", () => {
    // Two spellings, one instant: both must serialise identically or a diff of
    // two stored rows would show a change that did not happen.
    expect(GraphQLDateTime.parseValue("2026-07-29T06:10:00Z")).toBe("2026-07-29T06:10:00.000Z");
    expect(GraphQLDateTime.parseValue("2026-07-29T08:10:00+02:00")).toBe("2026-07-29T06:10:00.000Z");
  });

  it("accepts a Date object on the way out but never invalid ones", () => {
    expect(GraphQLDateTime.serialize(new Date("2026-07-29T06:10:00.000Z"))).toBe("2026-07-29T06:10:00.000Z");
    expect(() => GraphQLDateTime.serialize(new Date("nonsense"))).toThrow(/invalid Date/);
  });

  it("rejects garbage through both paths", () => {
    for (const value of ["yesterday", "2026-13-45T00:00:00Z", ""]) {
      const { asVariable, asLiteral } = bothPaths(GraphQLDateTime, value);
      expect(asVariable.ok, `variable ${value}`).toBe(false);
      expect(asLiteral.ok, `literal ${value}`).toBe(false);
    }
  });
});

describe("crew graph scalars — Days", () => {
  it.each([0, 0.5, 1, 1.5, 26, 4.5])("accepts %s through both paths", (value) => {
    const { asVariable, asLiteral } = bothPaths(GraphQLDays, value);
    expect(asVariable.ok, asVariable.message).toBe(true);
    expect(asLiteral.ok, asLiteral.message).toBe(true);
    expect(asVariable.value).toBe(value);
  });

  it.each([-1, -0.5, 0.3, 1.25, 2.7])("rejects %s through both paths", (value) => {
    const { asVariable, asLiteral } = bothPaths(GraphQLDays, value);
    expect(asVariable.ok).toBe(false);
    expect(asLiteral.ok).toBe(false);
  });

  it("rejects half-day granularity violations specifically, not just negatives", () => {
    // Leave is booked in halves. 0.3 days is not a shorter morning, it is a bug.
    expect(() => GraphQLDays.parseValue(0.3)).toThrow(/0\.5 steps/);
    expect(() => GraphQLDays.parseValue(-2)).toThrow(/not be negative/);
  });

  it("rejects Infinity and NaN", () => {
    expect(() => GraphQLDays.parseValue(Infinity)).toThrow(/finite/);
    expect(() => GraphQLDays.parseValue(NaN)).toThrow(/finite/);
  });
});

describe("crew graph scalars — NonEmptyString", () => {
  it("trims on the way in", () => {
    expect(GraphQLNonEmptyString.parseValue("  Halina  ")).toBe("Halina");
    expect(GraphQLNonEmptyString.parseLiteral({ kind: Kind.STRING, value: "  Halina  " })).toBe("Halina");
  });

  it("rejects empty and whitespace-only through both paths", () => {
    for (const value of ["", "   ", "\t\n"]) {
      const { asVariable, asLiteral } = bothPaths(GraphQLNonEmptyString, value);
      expect(asVariable.ok).toBe(false);
      expect(asLiteral.ok).toBe(false);
    }
  });

  it("caps input length at the boundary", () => {
    const atCap = "x".repeat(MAX_STRING_LENGTH);
    const overCap = "x".repeat(MAX_STRING_LENGTH + 1);
    expect(GraphQLNonEmptyString.parseValue(atCap)).toBe(atCap);
    expect(() => GraphQLNonEmptyString.parseValue(overCap)).toThrow(/at most/);
  });

  it("stays lenient on the READ path — the cap guards input, never existing data", () => {
    // An over-long value already in a store must still be readable. Rejecting it
    // on the way out would make a record unreadable because of a rule added later.
    const overCap = "x".repeat(MAX_STRING_LENGTH + 50);
    expect(GraphQLNonEmptyString.serialize(overCap)).toBe(overCap);
  });
});
