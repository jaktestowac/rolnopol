// Bullet-proof INI parser.
//
// Pure and side-effect free: it takes text, returns a report, and NEVER throws
// and NEVER returns a partial result. Malformed input produces `errors` entries
// alongside whatever parsed cleanly, so a single bad line can never take the
// whole configuration (or the server boot) down with it.
//
// Supported syntax:
//   ; comment            # comment
//   [section]            section names are trimmed; lookup is case-insensitive
//   key = value          `=` is the only separator
//   key = "quoted value" double or single quotes preserve spaces and ; # chars
//   key =                empty value (valid, yields "")
//
// Deliberately rejected (reported, never guessed at):
//   key: value           no `=` — reported as a malformed line
//   [unclosed            unterminated section header
//   []                   empty section name
//   = value              empty key
//   __proto__ = x        prototype-polluting keys

const MAX_INPUT_LENGTH = 1024 * 1024; // characters — a flag config is never this big
const MAX_LINES = 20000;
const MAX_SECTION_DEPTH_LENGTH = 512; // guards absurd section/key names
const GLOBAL_SECTION = "";
// Duplicate detection joins a section and a key. NUL is used as the separator
// because it cannot occur in either, while a space can (`[a b] c` vs `[a] b c`).
const SEEN_KEY_SEPARATOR = "\u0000";
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const TRUE_VALUES = new Set(["true", "1", "on", "yes"]);
const FALSE_VALUES = new Set(["false", "0", "off", "no"]);

/**
 * Strip a UTF-8 BOM and normalise line endings (CRLF / CR / LF).
 * @param {string} text
 * @returns {string[]} lines
 */
function splitLines(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.split(/\r\n|\r|\n/);
}

function isCommentLine(line) {
  return line.startsWith(";") || line.startsWith("#");
}

/**
 * Unescape the inside of a double-quoted value.
 * Recognised escapes: \\ \" \' \n \r \t \; \#
 * An unknown escape keeps the backslash so nothing is silently swallowed.
 */
function unescapeDoubleQuoted(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    i += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "\\":
        out += "\\";
        break;
      case '"':
        out += '"';
        break;
      case "'":
        out += "'";
        break;
      case ";":
        out += ";";
        break;
      case "#":
        out += "#";
        break;
      default:
        out += `\\${next}`;
        break;
    }
  }
  return out;
}

/**
 * Parse the right-hand side of `key = value`.
 *
 * Quoted values are taken verbatim (after unescaping) and anything trailing the
 * closing quote is treated as a comment. Unquoted values are trimmed and lose
 * an inline `;`/`#` comment only when the marker is preceded by whitespace, so
 * a value like `a;b` survives intact. A value that *starts* with a marker is a
 * comment in full — `key = ; note` is an empty value, matching the line-level
 * rule where a leading marker always begins a comment.
 *
 * @returns {{ value: string, quoted: boolean, error: string|null }}
 */
function parseValue(rawValue) {
  const trimmed = rawValue.trim();

  if (trimmed.length === 0 || isCommentLine(trimmed)) {
    return { value: "", quoted: false, error: null };
  }

  const first = trimmed[0];
  if (first === '"' || first === "'") {
    // Find the closing quote, honouring backslash escapes for double quotes.
    let closingIndex = -1;
    for (let i = 1; i < trimmed.length; i += 1) {
      if (trimmed[i] === "\\" && first === '"') {
        i += 1;
        continue;
      }
      if (trimmed[i] === first) {
        closingIndex = i;
        break;
      }
    }

    if (closingIndex === -1) {
      return { value: "", quoted: true, error: "Unterminated quoted value" };
    }

    const inner = trimmed.slice(1, closingIndex);
    const rest = trimmed.slice(closingIndex + 1).trim();
    if (rest.length > 0 && !isCommentLine(rest)) {
      return { value: "", quoted: true, error: `Unexpected content after quoted value: ${rest}` };
    }

    return {
      value: first === '"' ? unescapeDoubleQuoted(inner) : inner,
      quoted: true,
      error: null,
    };
  }

  // Unquoted: cut an inline comment that is separated by whitespace.
  const commentMatch = trimmed.match(/\s+[;#]/);
  const value = commentMatch ? trimmed.slice(0, commentMatch.index) : trimmed;
  return { value: value.trim(), quoted: false, error: null };
}

function emptyResult() {
  return {
    sections: Object.create(null),
    entries: [],
    errors: [],
    warnings: [],
  };
}

function pushIssue(list, line, raw, message) {
  list.push({ line, raw, message });
}

/**
 * Parse INI text.
 *
 * @param {string} text
 * @returns {{
 *   sections: Object<string, Object<string, string>>,  // lowercase section name -> key -> value
 *   entries: Array<{section: string, key: string, value: string, quoted: boolean, line: number, raw: string}>,
 *   errors: Array<{line: number, raw: string, message: string}>,
 *   warnings: Array<{line: number, raw: string, message: string}>,
 * }}
 */
function parseIni(text) {
  const result = emptyResult();

  if (typeof text !== "string") {
    pushIssue(result.errors, 0, "", `Expected INI content to be a string, received ${text === null ? "null" : typeof text}`);
    return result;
  }

  if (text.length > MAX_INPUT_LENGTH) {
    pushIssue(result.errors, 0, "", `INI content exceeds the ${MAX_INPUT_LENGTH} character limit`);
    return result;
  }

  const lines = splitLines(text);
  if (lines.length > MAX_LINES) {
    pushIssue(result.errors, 0, "", `INI content exceeds the ${MAX_LINES} line limit`);
    return result;
  }

  let currentSection = GLOBAL_SECTION;
  const seen = new Map(); // section + SEEN_KEY_SEPARATOR + key -> line number

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    const line = raw.trim();

    if (line.length === 0 || isCommentLine(line)) {
      continue;
    }

    // Section header
    if (line.startsWith("[")) {
      const closingIndex = line.indexOf("]");
      if (closingIndex === -1) {
        pushIssue(result.errors, lineNumber, raw, "Unterminated section header (missing `]`)");
        continue;
      }

      const rest = line.slice(closingIndex + 1).trim();
      if (rest.length > 0 && !isCommentLine(rest)) {
        pushIssue(result.errors, lineNumber, raw, `Unexpected content after section header: ${rest}`);
        continue;
      }

      const name = line.slice(1, closingIndex).trim();
      if (name.length === 0) {
        pushIssue(result.errors, lineNumber, raw, "Empty section name");
        continue;
      }
      if (name.length > MAX_SECTION_DEPTH_LENGTH) {
        pushIssue(result.errors, lineNumber, raw, "Section name is too long");
        continue;
      }

      currentSection = name.toLowerCase();
      if (!result.sections[currentSection]) {
        result.sections[currentSection] = Object.create(null);
      }
      continue;
    }

    // Key / value
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      const hint = line.includes(":") ? " (use `key = value`, not `key: value`)" : "";
      pushIssue(result.errors, lineNumber, raw, `Malformed line, expected \`key = value\`${hint}`);
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0) {
      pushIssue(result.errors, lineNumber, raw, "Empty key");
      continue;
    }
    if (key.length > MAX_SECTION_DEPTH_LENGTH) {
      pushIssue(result.errors, lineNumber, raw, "Key is too long");
      continue;
    }
    if (UNSAFE_KEYS.has(key)) {
      pushIssue(result.errors, lineNumber, raw, `Key "${key}" is not allowed`);
      continue;
    }

    const parsed = parseValue(line.slice(separatorIndex + 1));
    if (parsed.error) {
      pushIssue(result.errors, lineNumber, raw, parsed.error);
      continue;
    }

    const seenKey = `${currentSection}${SEEN_KEY_SEPARATOR}${key}`;
    const previousLine = seen.get(seenKey);
    if (previousLine !== undefined) {
      pushIssue(result.warnings, lineNumber, raw, `Duplicate key "${key}" overrides the value from line ${previousLine}`);
    }
    seen.set(seenKey, lineNumber);

    if (!result.sections[currentSection]) {
      result.sections[currentSection] = Object.create(null);
    }
    result.sections[currentSection][key] = parsed.value;
    result.entries.push({
      section: currentSection,
      key,
      value: parsed.value,
      quoted: parsed.quoted,
      line: lineNumber,
      raw,
    });
  }

  return result;
}

/**
 * Read a section as a plain (prototype-free) object.
 * @param {ReturnType<typeof parseIni>} parsed
 * @param {string} name
 * @returns {Object<string, string>}
 */
function getSection(parsed, name) {
  const key = typeof name === "string" ? name.toLowerCase() : "";
  const section = parsed?.sections?.[key];
  return section || Object.create(null);
}

/**
 * Coerce an INI value to a boolean.
 * @param {string} value
 * @returns {boolean|undefined} undefined when the value is not a known boolean
 */
function parseBooleanValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return undefined;
}

module.exports = {
  parseIni,
  getSection,
  parseBooleanValue,
  GLOBAL_SECTION,
  MAX_INPUT_LENGTH,
  MAX_LINES,
  BOOLEAN_TRUE_VALUES: [...TRUE_VALUES],
  BOOLEAN_FALSE_VALUES: [...FALSE_VALUES],
};
