import { describe, it, expect } from "vitest";

// helpers/ini-parser.js must never throw and never lose good lines to bad ones:
// a malformed feature-flags.ini has to degrade into `errors` while the rest of
// the file still applies. Everything below is a claim about that contract.
const { parseIni, getSection, parseBooleanValue, MAX_INPUT_LENGTH, MAX_LINES } = require("../../helpers/ini-parser");

describe("ini-parser: happy path", () => {
  it("parses sections, keys and values", () => {
    const parsed = parseIni("[flags]\ncrewOfficeEnabled = true\nmessengerEnabled = false\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(getSection(parsed, "flags")).toMatchObject({
      crewOfficeEnabled: "true",
      messengerEnabled: "false",
    });
  });

  it("records the source line for each entry", () => {
    const parsed = parseIni("[flags]\n\n; a comment\ncrewOfficeEnabled = true\n");

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ section: "flags", key: "crewOfficeEnabled", value: "true", line: 4 });
  });

  it("trims whitespace around keys, values and section names", () => {
    const parsed = parseIni("[  flags  ]\n\t crewOfficeEnabled \t =  true  \n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").crewOfficeEnabled).toBe("true");
  });

  it("looks sections up case-insensitively", () => {
    const parsed = parseIni("[FLAGS]\na = 1\n");

    expect(getSection(parsed, "flags").a).toBe("1");
    expect(getSection(parsed, "Flags").a).toBe("1");
  });

  it("keeps keys case-sensitive", () => {
    const parsed = parseIni("[flags]\ncrewOfficeEnabled = true\nCREWOFFICEENABLED = false\n");

    expect(getSection(parsed, "flags").crewOfficeEnabled).toBe("true");
    expect(getSection(parsed, "flags").CREWOFFICEENABLED).toBe("false");
    expect(parsed.warnings).toEqual([]);
  });

  it("supports multiple sections and puts pre-section keys in the global section", () => {
    const parsed = parseIni("loose = 1\n[flags]\na = true\n[settings]\nmode = seed\n");

    expect(getSection(parsed, "").loose).toBe("1");
    expect(getSection(parsed, "flags").a).toBe("true");
    expect(getSection(parsed, "settings").mode).toBe("seed");
  });

  it("re-entering a section merges into it", () => {
    const parsed = parseIni("[flags]\na = true\n[settings]\nmode = off\n[flags]\nb = false\n");

    expect(getSection(parsed, "flags")).toMatchObject({ a: "true", b: "false" });
  });
});

describe("ini-parser: comments and blank lines", () => {
  it("ignores empty lines and both comment markers", () => {
    const parsed = parseIni("\n; semicolon\n   \n# hash\n[flags]\n  ; indented\na = true\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
  });

  it("strips an inline comment separated by whitespace", () => {
    const parsed = parseIni("[flags]\na = true ; turn it on\nb = false # off for now\n");

    expect(getSection(parsed, "flags")).toMatchObject({ a: "true", b: "false" });
  });

  it("keeps comment characters that are part of the value", () => {
    const parsed = parseIni("[flags]\na = one;two\nb = one#two\n");

    expect(getSection(parsed, "flags")).toMatchObject({ a: "one;two", b: "one#two" });
  });

  it("accepts a trailing comment after a section header", () => {
    const parsed = parseIni("[flags] ; the flags\na = true\n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("true");
  });
});

describe("ini-parser: values", () => {
  it("treats a missing value as an empty string", () => {
    const parsed = parseIni("[flags]\na =\nb=\n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags")).toMatchObject({ a: "", b: "" });
  });

  it("preserves spaces and comment markers inside double quotes", () => {
    const parsed = parseIni('[flags]\na = "  spaced ; value  "\n');

    expect(getSection(parsed, "flags").a).toBe("  spaced ; value  ");
  });

  it("preserves single-quoted values literally", () => {
    const parsed = parseIni("[flags]\na = ' raw # value '\n");

    expect(getSection(parsed, "flags").a).toBe(" raw # value ");
  });

  it("unescapes recognised escapes inside double quotes", () => {
    const parsed = parseIni('[flags]\na = "line\\nbreak\\ttab\\\\slash\\"quote"\n');

    expect(getSection(parsed, "flags").a).toBe('line\nbreak\ttab\\slash"quote');
  });

  it("keeps the backslash for an unknown escape", () => {
    const parsed = parseIni('[flags]\na = "keep\\qthis"\n');

    expect(getSection(parsed, "flags").a).toBe("keep\\qthis");
  });

  it("allows a comment after a closing quote", () => {
    const parsed = parseIni('[flags]\na = "value" ; trailing\n');

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("value");
  });

  it("reports an unterminated quoted value without losing other lines", () => {
    const parsed = parseIni('[flags]\na = "oops\nb = true\n');

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ line: 2, message: "Unterminated quoted value" });
    expect(getSection(parsed, "flags")).toMatchObject({ b: "true" });
    expect(getSection(parsed, "flags").a).toBeUndefined();
  });

  it("reports junk after a closing quote", () => {
    const parsed = parseIni('[flags]\na = "value" junk\n');

    expect(parsed.errors[0].message).toContain("Unexpected content after quoted value");
  });

  it("keeps everything after the first `=` in the value", () => {
    const parsed = parseIni("[flags]\na = b = c\n");

    expect(getSection(parsed, "flags").a).toBe("b = c");
  });
});

describe("ini-parser: a value that is only a comment", () => {
  it("treats a leading `;` as a comment, yielding an empty value", () => {
    const parsed = parseIni("[flags]\na = ; not a value\nb = true\n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("");
    expect(getSection(parsed, "flags").b).toBe("true");
  });

  it("treats a leading `#` as a comment too", () => {
    const parsed = parseIni("[flags]\na = # not a value\n");

    expect(getSection(parsed, "flags").a).toBe("");
  });

  it("applies the same rule with no space after the marker", () => {
    const parsed = parseIni("[flags]\na = ;nope\nb = #nope\n");

    expect(getSection(parsed, "flags")).toMatchObject({ a: "", b: "" });
  });

  it("still keeps a marker that is not in first position", () => {
    const parsed = parseIni("[flags]\na = keep;this\n");

    expect(getSection(parsed, "flags").a).toBe("keep;this");
  });

  it("keeps a leading marker when it is quoted", () => {
    const parsed = parseIni('[flags]\na = "; literal"\n');

    expect(getSection(parsed, "flags").a).toBe("; literal");
  });
});

describe("ini-parser: quoting edge cases", () => {
  it("reads empty double and single quotes as an empty value", () => {
    const parsed = parseIni("[flags]\na = \"\"\nb = ''\n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags")).toMatchObject({ a: "", b: "" });
  });

  it("handles a trailing escaped backslash before the closing quote", () => {
    const parsed = parseIni('[flags]\na = "x\\\\"\n');

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("x\\");
  });

  it("does not honour escapes inside single quotes, by design", () => {
    // The `'` closes the value, so the remainder is unexpected content.
    const parsed = parseIni("[flags]\na = 'it\\'s'\n");

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toContain("Unexpected content after quoted value");
  });

  it("cuts an inline comment separated by a tab", () => {
    const parsed = parseIni("[flags]\na = true\t; tabbed comment\n");

    expect(getSection(parsed, "flags").a).toBe("true");
  });

  it("records whether a value was quoted", () => {
    const parsed = parseIni('[flags]\na = "quoted"\nb = bare\n');

    expect(parsed.entries.map((entry) => [entry.key, entry.quoted])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("ini-parser: malformed input", () => {
  it("reports a line without a separator and keeps parsing", () => {
    const parsed = parseIni("[flags]\nthis is not ini\na = true\n");

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ line: 2, raw: "this is not ini" });
    expect(getSection(parsed, "flags").a).toBe("true");
  });

  it("hints at the right syntax when a colon was used", () => {
    const parsed = parseIni("[flags]\na: true\n");

    expect(parsed.errors[0].message).toContain("key = value");
    expect(parsed.errors[0].message).toContain("not `key: value`");
  });

  it("reports an unterminated section header", () => {
    const parsed = parseIni("[flags\na = true\n");

    expect(parsed.errors[0].message).toContain("Unterminated section header");
    // The key still lands in the global section rather than vanishing.
    expect(getSection(parsed, "").a).toBe("true");
  });

  it("reports an empty section name", () => {
    const parsed = parseIni("[]\na = true\n");

    expect(parsed.errors[0].message).toBe("Empty section name");
  });

  it("reports junk after a section header", () => {
    const parsed = parseIni("[flags] junk\na = true\n");

    expect(parsed.errors[0].message).toContain("Unexpected content after section header");
  });

  it("reports an empty key", () => {
    const parsed = parseIni("[flags]\n = true\n");

    expect(parsed.errors[0].message).toBe("Empty key");
  });

  it("warns about a duplicate key and keeps the last value", () => {
    const parsed = parseIni("[flags]\na = true\na = false\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatchObject({ line: 3 });
    expect(parsed.warnings[0].message).toContain("line 2");
    expect(getSection(parsed, "flags").a).toBe("false");
  });

  it("does not treat the same key in different sections as a duplicate", () => {
    const parsed = parseIni("[flags]\na = true\n[settings]\na = false\n");

    expect(parsed.warnings).toEqual([]);
  });

  it("does not confuse a section/key pair that a naive separator would collide", () => {
    // `[a b] c` and `[a] b c` must stay distinct entries, not a false duplicate.
    const parsed = parseIni("[a b]\nc = 1\n[a]\nb c = 2\n");

    expect(parsed.warnings).toEqual([]);
    expect(getSection(parsed, "a b").c).toBe("1");
    expect(getSection(parsed, "a")["b c"]).toBe("2");
  });

  it("reports a section name at the length limit boundary", () => {
    expect(parseIni(`[${"x".repeat(512)}]\n`).errors).toEqual([]);
    expect(parseIni(`[${"x".repeat(513)}]\n`).errors[0].message).toBe("Section name is too long");
  });

  it("reports a key at the length limit boundary", () => {
    expect(parseIni(`[flags]\n${"x".repeat(512)} = true\n`).errors).toEqual([]);
    expect(parseIni(`[flags]\n${"x".repeat(513)} = true\n`).errors[0].message).toBe("Key is too long");
  });

  it("keeps a quoted-looking key as a literal key rather than guessing", () => {
    const parsed = parseIni('[flags]\n"a=b" = true\n');

    // The first `=` splits the line, so the key is the literal `"a`.
    expect(parsed.errors).toEqual([]);
    expect(Object.keys(getSection(parsed, "flags"))).toEqual(['"a']);
  });
});

describe("ini-parser: hostile input", () => {
  it("rejects prototype-polluting keys", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const parsed = parseIni(`[flags]\n${key} = true\n`);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].message).toContain("is not allowed");
    }
  });

  it("does not let a section named __proto__ touch Object.prototype", () => {
    const parsed = parseIni("[__proto__]\npolluted = true\n");

    expect(getSection(parsed, "__proto__").polluted).toBe("true");
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("returns prototype-free section objects", () => {
    const parsed = parseIni("[flags]\na = true\n");
    const section = getSection(parsed, "flags");

    expect(Object.getPrototypeOf(section)).toBeNull();
    expect(section.toString).toBeUndefined();
  });

  it("returns an empty section instead of undefined for unknown names", () => {
    const parsed = parseIni("[flags]\na = true\n");

    expect(getSection(parsed, "nope")).toEqual({});
    expect(getSection(parsed, undefined)).toEqual({});
    expect(getSection(null, "flags")).toEqual({});
    expect(getSection({}, "flags")).toEqual({});
  });

  it("never throws on non-string input", () => {
    for (const input of [undefined, null, 42, {}, [], true, () => {}]) {
      const parsed = parseIni(input);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].message).toContain("Expected INI content to be a string");
      expect(parsed.entries).toEqual([]);
    }
  });

  it("handles an empty string and a whitespace-only file", () => {
    for (const input of ["", "   ", "\n\n\n", "\t"]) {
      const parsed = parseIni(input);
      expect(parsed.errors).toEqual([]);
      expect(parsed.entries).toEqual([]);
    }
  });

  it("refuses input above the size limit", () => {
    const parsed = parseIni("a".repeat(MAX_INPUT_LENGTH + 1));

    expect(parsed.errors[0].message).toContain("character limit");
    expect(parsed.entries).toEqual([]);
  });

  it("accepts input exactly at the size limit", () => {
    // Padded with spaces, not newlines, so this exercises the size cap alone.
    const parsed = parseIni("[flags]\na = true".padEnd(MAX_INPUT_LENGTH, " "));

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("true");
  });

  it("accepts input exactly at the line limit", () => {
    const parsed = parseIni("[flags]\na = true" + "\n".repeat(MAX_LINES - 2));

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("true");
  });

  it("refuses input above the line limit", () => {
    const parsed = parseIni("\n".repeat(MAX_LINES + 1));

    expect(parsed.errors[0].message).toContain("line limit");
    expect(parsed.entries).toEqual([]);
  });

  it("reports over-long keys and section names", () => {
    const longName = "x".repeat(600);

    expect(parseIni(`[${longName}]\n`).errors[0].message).toBe("Section name is too long");
    expect(parseIni(`[flags]\n${longName} = true\n`).errors[0].message).toBe("Key is too long");
  });

  it("survives binary-ish and unicode content", () => {
    const parsed = parseIni("[flags]\n\u0000\u0001 = \u0002\nkluczÓw = tak\n😀 = true\n");

    expect(() => parseIni("\u0000\u0001\u0002")).not.toThrow();
    expect(getSection(parsed, "flags")["kluczÓw"]).toBe("tak");
    expect(getSection(parsed, "flags")["😀"]).toBe("true");
  });
});

describe("ini-parser: line endings and BOM", () => {
  it("handles CRLF, CR and mixed line endings", () => {
    for (const text of ["[flags]\r\na = true\r\nb = false\r\n", "[flags]\ra = true\rb = false\r", "[flags]\r\na = true\nb = false\r"]) {
      const parsed = parseIni(text);
      expect(parsed.errors).toEqual([]);
      expect(getSection(parsed, "flags")).toMatchObject({ a: "true", b: "false" });
    }
  });

  it("strips a UTF-8 BOM so the first section still parses", () => {
    const parsed = parseIni("﻿[flags]\na = true\n");

    expect(parsed.errors).toEqual([]);
    expect(getSection(parsed, "flags").a).toBe("true");
  });

  it("does not require a trailing newline", () => {
    const parsed = parseIni("[flags]\na = true");

    expect(getSection(parsed, "flags").a).toBe("true");
  });
});

describe("parseBooleanValue", () => {
  it("accepts every documented truthy spelling", () => {
    for (const value of ["true", "TRUE", " True ", "1", "on", "ON", "yes", "Yes"]) {
      expect(parseBooleanValue(value)).toBe(true);
    }
  });

  it("accepts every documented falsy spelling", () => {
    for (const value of ["false", "FALSE", " False ", "0", "off", "OFF", "no", "No"]) {
      expect(parseBooleanValue(value)).toBe(false);
    }
  });

  it("returns undefined for anything else, so callers can report it", () => {
    for (const value of ["", "  ", "maybe", "2", "-1", "truthy", "enabled", "t", "y", null, undefined, 1, 0, true, false, {}]) {
      expect(parseBooleanValue(value)).toBeUndefined();
    }
  });
});
