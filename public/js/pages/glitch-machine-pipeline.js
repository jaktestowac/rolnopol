/**
 * Glitch Machine — the corruption engine, with no DOM in it.
 *
 * Databending that cannot brick the file: the JPEG is mapped into segments
 * first, and every byte the engine writes lands inside entropy-coded scan
 * data. Headers, quantisation tables and Huffman tables are never touched, so
 * the result always still *is* a JPEG — just one whose pixels went somewhere
 * strange.
 *
 *   1. `mapJpeg`  — walk the markers, record every scan span
 *   2. `glitch`   — seeded, deterministic corruption inside those spans
 *
 * Two invariants make the output decodable:
 *
 *   - No write may create an `FF` byte (written values are folded to `FE`),
 *     because inside a scan `FF` starts a marker and an accidental one ends
 *     the image early.
 *   - No write may land on an existing `FF` or on the byte after one — that
 *     pair is stuffing (`FF 00`) or a restart marker (`FF D0`–`FF D7`), and
 *     both must survive intact for the decoder to keep its place.
 *
 * All randomness comes from a seeded mulberry32, so a seed is a reproducible
 * artwork: same bytes + same controls + same seed = the same glitch, byte for
 * byte. That is also what makes this file testable.
 *
 * Wrapped UMD-style, like `pixelizer-pipeline.js`, so
 * `tests/unit/glitch-machine.pipeline.test.js` can require the same code the
 * browser loads.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GlitchMachinePipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // Malformed files are expected input, so every walk is bounded.
  const MAX_SEGMENTS = 4096;
  const MAX_OPS = 5000;

  // Run lengths for the multi-byte operations, in bytes. Short enough that a
  // single op reads as texture, long enough to smear a visible band.
  const RUN = {
    smear: { min: 4, max: 48 },
    stutter: { min: 8, max: 64 },
    swap: { min: 8, max: 48 },
  };

  const OP_KEYS = ["mutate", "smear", "stutter", "swap"];

  const SIGNATURES = {
    jpeg: [0xff, 0xd8, 0xff],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    gif: [0x47, 0x49, 0x46, 0x38],
  };

  const SOF_MARKERS = {
    0xc0: "baseline",
    0xc1: "extended sequential",
    0xc2: "progressive",
    0xc3: "lossless",
    0xc5: "differential sequential",
    0xc6: "differential progressive",
    0xc7: "differential lossless",
    0xc9: "arithmetic sequential",
    0xca: "arithmetic progressive",
    0xcb: "arithmetic lossless",
  };

  // ------------------------------------------------------------------- helpers

  function u16be(bytes, at) {
    return ((bytes[at] << 8) | bytes[at + 1]) >>> 0;
  }

  function startsWith(bytes, signature) {
    if (bytes.length < signature.length) return false;

    for (let i = 0; i < signature.length; i += 1) {
      if (bytes[i] !== signature[i]) return false;
    }

    return true;
  }

  /* Signature, never the extension — the page may hand over anything. */
  function detectFormat(bytes) {
    if (!bytes || typeof bytes.length !== "number") return null;
    if (startsWith(bytes, SIGNATURES.png)) return "png";
    if (startsWith(bytes, SIGNATURES.jpeg)) return "jpeg";
    if (startsWith(bytes, SIGNATURES.gif)) return "gif";

    return null;
  }

  // ---------------------------------------------------------------------- PRNG

  /* mulberry32 — 32 bits of state, good spread, four lines. Seeded corruption
   * is the whole product: a seed the operator liked must replay exactly. */
  function mulberry32(seed) {
    let state = seed >>> 0;

    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;

      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSeed(value) {
    const seed = Number(value);

    if (!Number.isFinite(seed)) return 0;

    return Math.abs(Math.floor(seed)) >>> 0;
  }

  function seedToHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  /* Accepts what an operator pastes: "3F", "0x3f", "  c0ffee  ". Anything that
   * is not hex comes back null so the page can refuse it visibly. */
  function seedFromHex(text) {
    const cleaned = String(text || "").trim().replace(/^0x/i, "");

    if (!cleaned || cleaned.length > 8 || /[^0-9a-f]/i.test(cleaned)) return null;

    return parseInt(cleaned, 16) >>> 0;
  }

  // ------------------------------------------------------------------ JPEG map

  /* Walk the entropy-coded scan to the next real marker. Inside a scan an `FF`
   * is stuffing (`FF 00`), a restart marker (`FF D0`–`FF D7`) or padding
   * (`FF FF`) — anything else ends it. Same walk the Metadata Peeler does. */
  function scanEnd(bytes, from) {
    let at = from;

    while (at < bytes.length - 1) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }

      const next = bytes[at + 1];

      if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
        at += 2;
        continue;
      }

      return at;
    }

    return bytes.length;
  }

  /* Split a JPEG into its markers and — the part the engine cares about — the
   * spans of entropy-coded scan data. Progressive files have several scans;
   * every one of them is fair game. */
  function mapJpeg(bytes) {
    const map = {
      valid: false,
      segments: [],
      scans: [],
      scanBytes: 0,
      width: 0,
      height: 0,
      coding: null,
      restartInterval: 0,
      warnings: [],
    };

    if (detectFormat(bytes) !== "jpeg") {
      map.warnings.push("Not a JPEG — the signature does not match.");
      return map;
    }

    let at = 2;

    map.segments.push({ marker: 0xd8, name: "SOI", offset: 0, length: 2 });

    while (at < bytes.length - 1 && map.segments.length < MAX_SEGMENTS) {
      if (bytes[at] !== 0xff) {
        map.warnings.push(`Expected a marker at 0x${at.toString(16).toUpperCase()} — the walk stopped there.`);
        break;
      }

      // Any number of fill FFs may precede the marker byte itself.
      let markerAt = at;

      while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1;

      if (markerAt >= bytes.length) break;

      const marker = bytes[markerAt];
      const headerLength = markerAt - at + 1;

      if (marker === 0xd9) {
        map.segments.push({ marker, name: "EOI", offset: at, length: headerLength });
        at += headerLength;
        break;
      }

      // Standalone markers carry no length word.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        map.segments.push({ marker, name: `RST${marker - 0xd0}`, offset: at, length: headerLength });
        at += headerLength;
        continue;
      }

      if (at + headerLength + 2 > bytes.length) {
        map.warnings.push("Truncated segment header — the walk stopped.");
        break;
      }

      const payloadLength = u16be(bytes, at + headerLength);

      if (payloadLength < 2 || at + headerLength + payloadLength > bytes.length) {
        map.warnings.push("A segment claims more bytes than the file has — the walk stopped.");
        break;
      }

      const dataOffset = at + headerLength + 2;
      const dataLength = payloadLength - 2;

      if (SOF_MARKERS[marker] && dataLength >= 5) {
        map.coding = SOF_MARKERS[marker];
        map.height = u16be(bytes, dataOffset + 1);
        map.width = u16be(bytes, dataOffset + 3);
      }

      if (marker === 0xdd && dataLength >= 2) {
        map.restartInterval = u16be(bytes, dataOffset);
      }

      if (marker === 0xda) {
        const scanFrom = at + headerLength + payloadLength;
        const scanTo = scanEnd(bytes, scanFrom);

        map.segments.push({ marker, name: "SOS", offset: at, length: headerLength + payloadLength });

        if (scanTo > scanFrom) {
          map.scans.push({ from: scanFrom, to: scanTo });
          map.scanBytes += scanTo - scanFrom;
        }

        at = scanTo;
        continue;
      }

      const name = marker >= 0xe0 && marker <= 0xef ? `APP${marker - 0xe0}` : SOF_MARKERS[marker] ? `SOF${marker - 0xc0}` : marker === 0xdb ? "DQT" : marker === 0xc4 ? "DHT" : marker === 0xdd ? "DRI" : marker === 0xfe ? "COM" : `0x${marker.toString(16).toUpperCase()}`;

      map.segments.push({ marker, name, offset: at, length: headerLength + payloadLength });
      at += headerLength + payloadLength;
    }

    map.valid = map.scans.length > 0 && map.scanBytes > 0;

    if (!map.valid && map.warnings.length === 0) {
      map.warnings.push("No entropy-coded scan data found — nothing to bend.");
    }

    return map;
  }

  // ---------------------------------------------------------------- corruption

  /* The two invariants, as one predicate. Evaluated against the *current*
   * buffer, so an earlier op in the same pass cannot be half-undone either. */
  function canWrite(buffer, at, scan) {
    if (at < scan.from || at >= scan.to) return false;
    if (buffer[at] === 0xff) return false;
    if (at > 0 && buffer[at - 1] === 0xff) return false;

    return true;
  }

  /* Fold the one forbidden value; everything else passes through. */
  function safeByte(value) {
    const byte = value & 0xff;

    return byte === 0xff ? 0xfe : byte;
  }

  function writeByte(buffer, at, scan, value, tally) {
    if (!canWrite(buffer, at, scan)) {
      tally.skipped += 1;
      return;
    }

    buffer[at] = safeByte(value);
    tally.written += 1;
  }

  /* Translate an offset into the concatenated scan space back to a file
   * position, and remember which scan it fell in so runs stay inside it. */
  function locate(scans, scanOffset) {
    let remaining = scanOffset;

    for (let i = 0; i < scans.length; i += 1) {
      const span = scans[i].to - scans[i].from;

      if (remaining < span) {
        return { at: scans[i].from + remaining, scan: scans[i] };
      }

      remaining -= span;
    }

    const last = scans[scans.length - 1];

    return { at: last.to - 1, scan: last };
  }

  function runLength(random, kind) {
    const range = RUN[kind];

    return range.min + Math.floor(random() * (range.max - range.min + 1));
  }

  /* How many operations an amount buys. Quadratic so the low end stays subtle
   * — the difference between 5 and 10 should be a whisper, between 90 and 100
   * an avalanche. Scaled by the window so a narrow slice is not overcooked. */
  function planOps(windowBytes, amount) {
    const strength = Math.max(0, Math.min(100, amount)) / 100;
    const ops = Math.round((windowBytes / 640) * strength * strength * 24);

    return Math.max(1, Math.min(MAX_OPS, ops));
  }

  function normalizeWindow(window) {
    let from = window && Number.isFinite(window.from) ? window.from : 0;
    let to = window && Number.isFinite(window.to) ? window.to : 1;

    from = Math.max(0, Math.min(1, from));
    to = Math.max(0, Math.min(1, to));

    return from <= to ? { from, to } : { from: to, to: from };
  }

  /* One pass of the machine. Never mutates the input — the original is what
   * "hold to compare" and the next seed both run from. */
  function glitch(bytes, map, options) {
    const opts = options || {};
    const seed = normalizeSeed(opts.seed);
    const random = mulberry32(seed);
    const result = {
      bytes: null,
      seed,
      ops: { mutate: 0, smear: 0, stutter: 0, swap: 0 },
      opsTotal: 0,
      written: 0,
      skipped: 0,
      windowBytes: 0,
    };

    const enabled = OP_KEYS.filter(function (key) {
      return !opts.ops || opts.ops[key] !== false;
    });

    const buffer = new Uint8Array(bytes);

    result.bytes = buffer;

    if (!map || !map.valid || enabled.length === 0) return result;

    const window = normalizeWindow(opts.window);
    const windowStart = Math.floor(map.scanBytes * window.from);
    const windowEnd = Math.ceil(map.scanBytes * window.to);
    const windowBytes = windowEnd - windowStart;

    result.windowBytes = windowBytes;

    if (windowBytes <= 0) return result;

    const opCount = planOps(windowBytes, Number.isFinite(opts.amount) ? opts.amount : 35);
    const tally = { written: 0, skipped: 0 };

    for (let i = 0; i < opCount; i += 1) {
      const kind = enabled[Math.floor(random() * enabled.length)];
      const target = locate(map.scans, windowStart + Math.floor(random() * windowBytes));

      result.ops[kind] += 1;

      if (kind === "mutate") {
        writeByte(buffer, target.at, target.scan, Math.floor(random() * 255), tally);
        continue;
      }

      if (kind === "smear") {
        // Drag whatever byte is under the head forward — a horizontal tear.
        const value = buffer[target.at];
        const length = runLength(random, "smear");

        for (let step = 0; step < length; step += 1) {
          writeByte(buffer, target.at + step, target.scan, value, tally);
        }

        continue;
      }

      if (kind === "stutter") {
        // Copy a run over the bytes right after it — the decoder replays a
        // stretch of image it has already drawn.
        const length = runLength(random, "stutter");

        for (let step = 0; step < length; step += 1) {
          writeByte(buffer, target.at + length + step, target.scan, buffer[target.at + step], tally);
        }

        continue;
      }

      // swap: exchange two runs, both inside scan data. The second site comes
      // from the same window so the exchange stays local enough to look like a
      // displacement, not noise.
      const other = locate(map.scans, windowStart + Math.floor(random() * windowBytes));
      const length = runLength(random, "swap");

      for (let step = 0; step < length; step += 1) {
        const a = target.at + step;
        const b = other.at + step;
        const aOk = canWrite(buffer, a, target.scan);
        const bOk = canWrite(buffer, b, other.scan);

        if (!aOk || !bOk) {
          tally.skipped += 1;
          continue;
        }

        const held = buffer[a];

        buffer[a] = safeByte(buffer[b]);
        buffer[b] = safeByte(held);
        tally.written += 2;
      }
    }

    result.opsTotal = opCount;
    result.written = tally.written;
    result.skipped = tally.skipped;

    return result;
  }

  return {
    MAX_SEGMENTS,
    MAX_OPS,
    OP_KEYS,
    RUN,
    detectFormat,
    mulberry32,
    normalizeSeed,
    seedToHex,
    seedFromHex,
    mapJpeg,
    planOps,
    glitch,
  };
});
