/**
 * Reducing an uploaded filename to something safe to store and to show.
 *
 * Its own file, and written as a code-point scan rather than a regex, for a
 * practical reason: the characters it has to remove are the C0 control range, and
 * a regex literal containing those bytes makes the whole source file binary to
 * every tool that reads it — grep answers "binary file matches" and stops. A loop
 * over code points says the same thing in text.
 *
 * Path segments are stripped rather than escaped — `../../etc/passwd` becomes
 * `passwd` — because a personnel document has no directory. Control characters go
 * too: invisible in a UI, and actively dangerous in a `Content-Disposition`
 * header, where a CR or LF is header injection.
 *
 * What SURVIVES is the point: unicode, spaces, quotes and semicolons are all
 * legitimate in a filename and all stay. Flattening them here would be the easy
 * way to make the download header safe, and it would corrupt the name chosen by
 * every user of a non-English keyboard. Encoding that name correctly on the way
 * out is the download route's job (RFC 6266), not this function's to pre-empt.
 */
const MAX_FILENAME_LENGTH = 255;
const DEL = 0x7f;
const FIRST_PRINTABLE = 0x20;

/** True for C0 controls and DEL — the characters no filename may carry. */
function isControlCodePoint(codePoint) {
  return codePoint < FIRST_PRINTABLE || codePoint === DEL;
}

function stripControlCharacters(value) {
  let out = "";
  for (const character of value) {
    if (!isControlCodePoint(character.codePointAt(0))) out += character;
  }
  return out;
}

function sanitiseFilename(raw) {
  const lastSegment = String(raw ?? "")
    .split(/[\\/]/)
    .pop();
  const name = stripControlCharacters(lastSegment).trim();
  return name.length > MAX_FILENAME_LENGTH ? name.slice(0, MAX_FILENAME_LENGTH) : name;
}

module.exports = { sanitiseFilename, stripControlCharacters, isControlCodePoint, MAX_FILENAME_LENGTH };
