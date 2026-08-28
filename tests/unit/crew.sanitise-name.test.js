import { describe, it, expect } from "vitest";

const {
  sanitiseFilename,
  stripControlCharacters,
  isControlCodePoint,
  MAX_FILENAME_LENGTH,
} = require("../../services/crew/pillars/documents/sanitise-name");

// Every character here that would otherwise be an unreadable byte is built from
// its code point. That is not fussiness: the module under test explains in its own
// header that a literal C0 byte turns a source file binary to every tool that
// reads it, and a test file that reproduced the problem while asserting the fix
// would be a poor advertisement for the rule.
const ch = (codePoint) => String.fromCharCode(codePoint);

const NUL = ch(0x00);
const BEL = ch(0x07);
const TAB = ch(0x09);
const LF = ch(0x0a);
const CR = ch(0x0d);
const ESC = ch(0x1b);
const UNIT_SEP = ch(0x1f);
const DEL = ch(0x7f);
const BACKSLASH = ch(0x5c);
const ZWJ = ch(0x200d);

describe("crew documents sanitise-name", () => {
  describe("isControlCodePoint", () => {
    it("flags the whole C0 range and DEL", () => {
      for (let codePoint = 0x00; codePoint <= 0x1f; codePoint += 1) {
        expect(isControlCodePoint(codePoint)).toBe(true);
      }
      expect(isControlCodePoint(0x7f)).toBe(true);
    });

    it("does not flag space, the first printable code point", () => {
      expect(isControlCodePoint(0x20)).toBe(false);
    });

    it("does not flag printable ASCII or anything above DEL", () => {
      expect(isControlCodePoint("A".codePointAt(0))).toBe(false);
      expect(isControlCodePoint("~".codePointAt(0))).toBe(false); // 0x7e, just below DEL
      expect(isControlCodePoint(0x80)).toBe(false); // C1 range is deliberately kept
      expect(isControlCodePoint("ł".codePointAt(0))).toBe(false);
    });
  });

  describe("stripControlCharacters", () => {
    it("removes control characters and keeps everything around them", () => {
      expect(stripControlCharacters(`raport${NUL}${BEL}.pdf`)).toBe("raport.pdf");
      expect(stripControlCharacters(`${ESC}[31mred${ESC}[0m.txt`)).toBe("[31mred[0m.txt");
    });

    it("removes tab, CR and LF — a CR or LF is header injection downstream", () => {
      expect(stripControlCharacters(`a${TAB}b${CR}${LF}c.txt`)).toBe("abc.txt");
      expect(stripControlCharacters(`safe.pdf${CR}${LF}Content-Type: text/html`)).toBe("safe.pdfContent-Type: text/html");
    });

    it("iterates by code point, so astral characters survive intact", () => {
      expect(stripControlCharacters(`umowa\u{1f4c4}${NUL}.pdf`)).toBe("umowa\u{1f4c4}.pdf");
    });

    it("returns an empty string when the input is nothing but controls", () => {
      expect(stripControlCharacters(`${NUL}${UNIT_SEP}${DEL}`)).toBe("");
    });
  });

  describe("sanitiseFilename — path segments are stripped, not escaped", () => {
    it("reduces a POSIX traversal attempt to its last segment", () => {
      expect(sanitiseFilename("../../etc/passwd")).toBe("passwd");
    });

    it("reduces a Windows traversal attempt to its last segment", () => {
      const traversal = ["..", "..", "windows", "system32", "config", "sam"].join(BACKSLASH);
      expect(sanitiseFilename(traversal)).toBe("sam");
    });

    it("strips an absolute path down to the filename", () => {
      expect(sanitiseFilename("/var/data/crew/contract.pdf")).toBe("contract.pdf");
      expect(sanitiseFilename(["C:", "Users", "k", "contract.pdf"].join(BACKSLASH))).toBe("contract.pdf");
    });

    it("handles mixed separators", () => {
      expect(sanitiseFilename(`a/b${BACKSLASH}c/d${BACKSLASH}report.xlsx`)).toBe("report.xlsx");
    });

    it("returns an empty string for a value that is only a directory", () => {
      expect(sanitiseFilename("uploads/")).toBe("");
      expect(sanitiseFilename("/")).toBe("");
    });
  });

  describe("sanitiseFilename — what SURVIVES is the point", () => {
    it("keeps non-ASCII letters, so a non-English keyboard is not corrupted", () => {
      expect(sanitiseFilename("umowa-o-pracę-żółć.pdf")).toBe("umowa-o-pracę-żółć.pdf");
      expect(sanitiseFilename("契約書.pdf")).toBe("契約書.pdf");
      expect(sanitiseFilename("résumé — final.docx")).toBe("résumé — final.docx");
    });

    it("keeps interior spaces, quotes and semicolons — the download route encodes them, not this function", () => {
      expect(sanitiseFilename('my "signed" contract; v2.pdf')).toBe('my "signed" contract; v2.pdf');
      expect(sanitiseFilename("name=with;attribute.pdf")).toBe("name=with;attribute.pdf");
    });

    it("keeps emoji and ZWJ sequences", () => {
      const farmer = `\u{1f9d1}${ZWJ}\u{1f33e}`;
      expect(sanitiseFilename(`${farmer}-crew.pdf`)).toBe(`${farmer}-crew.pdf`);
    });
  });

  describe("sanitiseFilename — trimming and length", () => {
    it("trims leading and trailing whitespace", () => {
      expect(sanitiseFilename("   spaced.pdf   ")).toBe("spaced.pdf");
    });

    it("trims whitespace exposed by removing control characters", () => {
      expect(sanitiseFilename(`${NUL} report.pdf ${NUL}`)).toBe("report.pdf");
    });

    it("truncates at MAX_FILENAME_LENGTH", () => {
      const overlong = `${"a".repeat(MAX_FILENAME_LENGTH + 50)}.pdf`;
      const result = sanitiseFilename(overlong);
      expect(result).toHaveLength(MAX_FILENAME_LENGTH);
      expect(result).toBe("a".repeat(MAX_FILENAME_LENGTH));
    });

    it("leaves a name of exactly MAX_FILENAME_LENGTH untouched", () => {
      const exact = "b".repeat(MAX_FILENAME_LENGTH);
      expect(sanitiseFilename(exact)).toBe(exact);
    });

    it("measures length after stripping, not before", () => {
      const padded = NUL.repeat(100) + "c".repeat(MAX_FILENAME_LENGTH);
      expect(sanitiseFilename(padded)).toHaveLength(MAX_FILENAME_LENGTH);
    });
  });

  describe("sanitiseFilename — non-string input", () => {
    it("coerces null and undefined to an empty string rather than throwing", () => {
      expect(sanitiseFilename(null)).toBe("");
      expect(sanitiseFilename(undefined)).toBe("");
      expect(sanitiseFilename("")).toBe("");
    });

    it("coerces other primitives", () => {
      expect(sanitiseFilename(42)).toBe("42");
      expect(sanitiseFilename(false)).toBe("false");
    });
  });

  it("is idempotent — sanitising a sanitised name changes nothing", () => {
    const inputs = ["../../etc/passwd", `report${CR}${LF}.pdf`, "umowa-o-pracę.pdf", `${"z".repeat(MAX_FILENAME_LENGTH + 10)}.pdf`, "   "];
    for (const input of inputs) {
      const once = sanitiseFilename(input);
      expect(sanitiseFilename(once)).toBe(once);
    }
  });
});
