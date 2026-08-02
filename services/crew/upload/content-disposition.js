/**
 * Building a `Content-Disposition` header for a filename the caller chose.
 *
 * The uploaded name is kept verbatim (see `sanitise-name.js` for what little is
 * stripped and why), which means this function has to hand a browser a name that
 * may contain quotes, semicolons, spaces and any unicode at all. Getting that
 * wrong has three distinct failure modes, and RFC 6266 answers all three with the
 * same two-parameter trick:
 *
 *     Content-Disposition: attachment; filename="quarterly report.pdf";
 *                          filename*=UTF-8''quarterly%20report%20%E2%80%94%20na%C3%AFve.pdf
 *
 *   1. **A quote or a backslash ends the quoted string early.** `say "hi".pdf`
 *      naively interpolated produces a header the parser reads as ending at `hi`,
 *      and the rest becomes garbage parameters. So the ASCII fallback escapes
 *      both, per RFC 2616's quoted-string rules.
 *   2. **A CR or LF is header injection**, full stop — two headers where the
 *      server meant one. Those never reach here (the sanitiser drops them), and
 *      the fallback strips anything non-ASCII anyway, so there is no path for one
 *      to survive. Defence in depth: the cost is a `filter`.
 *   3. **Non-ASCII cannot appear in the quoted form at all.** A raw `ï` in a
 *      header is undefined behaviour across servers and proxies — hence
 *      `filename*`, which is percent-encoded UTF-8 and unambiguous.
 *
 * Both parameters are emitted together, always. Modern browsers read `filename*`
 * and ignore `filename`; anything that does not still gets a usable ASCII name
 * rather than nothing. Sending only the fancy one is the mistake that produces a
 * download called "download".
 */

/** RFC 5987 `attr-char`: what may appear unescaped in an extended parameter. */
const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** Percent-encode UTF-8, escaping everything RFC 5987 does not allow bare. */
function encodeRfc5987(value) {
  let out = "";
  for (const byte of Buffer.from(String(value), "utf8")) {
    const character = String.fromCharCode(byte);
    out += ATTR_CHAR.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * The ASCII fallback: printable ASCII only, with `"` and `\` escaped.
 *
 * A name that reduces to nothing (every character non-ASCII, which is normal for
 * plenty of the world) falls back to a generic one — an empty `filename=""` is
 * worse than a placeholder, and `filename*` still carries the real name.
 */
function toAsciiFallback(filename, fallback = "document") {
  const ascii = Array.from(String(filename))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
    .join("")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .trim();
  return ascii.length > 0 ? ascii : fallback;
}

/**
 * `<type>; filename="..."; filename*=UTF-8''...` for one filename.
 *
 * `attachment` tells the browser to save; `inline` tells it to render in place,
 * which is what a preview needs. Both still carry the filename — an inline
 * document that the user then chooses "save as" on should keep its own name, and
 * an inline response with no filename saves as the URL's last segment, which here
 * would be a bare document id.
 *
 * The disposition type is a two-value allow-list rather than free text on purpose:
 * it ends up in a header, and the caller who picks it is one query parameter away
 * from the outside world.
 */
function contentDisposition(filename, { type = "attachment", fallback = "document" } = {}) {
  const disposition = type === "inline" ? "inline" : "attachment";
  const name = String(filename ?? "").trim() || fallback;
  return `${disposition}; filename="${toAsciiFallback(name, fallback)}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

/** The common case, kept as its own name because most callers only ever want it. */
function contentDispositionAttachment(filename, options = {}) {
  return contentDisposition(filename, { ...options, type: "attachment" });
}

module.exports = { contentDisposition, contentDispositionAttachment, encodeRfc5987, toAsciiFallback };
