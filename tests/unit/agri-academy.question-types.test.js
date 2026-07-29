import { describe, it, expect } from "vitest";
const path = require("path");

const registry = require(
  path.join(__dirname, "..", "..", "external-services", "agri-academy", "authoring-service", "question-types", "index.js"),
);

const opts = (n) => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), text: `opt ${i}` }));

describe("question-types registry — built-ins", () => {
  it("ships single + multi", () => {
    expect(registry.types().sort()).toEqual(["multi", "single"]);
  });

  it("accepts a valid single question", () => {
    expect(registry.validate({ type: "single", text: "Q", options: opts(3), correct: ["a"] })).toBeNull();
  });

  it("rejects a single with more than one correct", () => {
    expect(registry.validate({ type: "single", text: "Q", options: opts(3), correct: ["a", "b"] })).toMatch(/exactly one/);
  });

  it("accepts a valid multi question", () => {
    expect(registry.validate({ type: "multi", text: "Q", options: opts(4), correct: ["a", "c"] })).toBeNull();
  });

  it("rejects a multi with no correct options", () => {
    expect(registry.validate({ type: "multi", text: "Q", options: opts(3), correct: [] })).toMatch(/at least one/);
  });

  it("rejects correct referencing a non-existent option", () => {
    expect(registry.validate({ type: "single", text: "Q", options: opts(2), correct: ["z"] })).toMatch(/reference option ids/);
  });

  it("rejects too few options", () => {
    expect(registry.validate({ type: "single", text: "Q", options: opts(1), correct: ["a"] })).toMatch(/at least 2 options/);
  });

  it("rejects missing text", () => {
    expect(registry.validate({ type: "single", text: "   ", options: opts(2), correct: ["a"] })).toMatch(/text required/);
  });

  it("rejects an unknown type", () => {
    expect(registry.validate({ type: "ordering", text: "Q", options: opts(3), correct: ["a"] })).toMatch(/unknown question type/);
  });

  it("rejects a null / non-object question", () => {
    expect(registry.validate(null)).toMatch(/question required/);
    expect(registry.validate("nope")).toMatch(/question required/);
  });

  it("rejects duplicate option ids", () => {
    const dup = [{ id: "a", text: "A" }, { id: "a", text: "B" }];
    expect(registry.validate({ type: "single", text: "Q", options: dup, correct: ["a"] })).toMatch(/option ids must be unique/);
  });

  it("rejects an option missing id or text", () => {
    const bad = [{ id: "a", text: "A" }, { id: "b", text: "  " }];
    expect(registry.validate({ type: "single", text: "Q", options: bad, correct: ["a"] })).toMatch(/every option needs an id and text/);
  });

  it("rejects a multi whose correct list repeats an id", () => {
    expect(registry.validate({ type: "multi", text: "Q", options: opts(3), correct: ["a", "a"] })).toMatch(/must not repeat/);
  });
});

describe("question-types registry — extensibility seam", () => {
  it("a new type becomes usable after register(), without touching existing code", () => {
    expect(registry.resolve("numeric")).toBeNull();
    registry.register({
      type: "numeric",
      validate(q) {
        return typeof q.answer === "number" ? null : "numeric questions need a numeric answer";
      },
    });
    expect(registry.types()).toContain("numeric");
    expect(registry.validate({ type: "numeric", text: "2+2?", answer: 4 })).toBeNull();
    expect(registry.validate({ type: "numeric", text: "2+2?", answer: "four" })).toMatch(/numeric answer/);
  });

  it("register() rejects a malformed strategy", () => {
    expect(() => registry.register({ type: "broken" })).toThrow();
  });
});
