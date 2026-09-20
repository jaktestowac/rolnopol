import { describe, it, expect } from "vitest";

// The same file the browser loads — it is wrapped UMD-style precisely so the
// corruption can be checked here instead of by eye in an <img>.
const pipeline = require("../../public/js/pages/glitch-machine-pipeline.js");

/* A synthetic but structurally honest JPEG: real markers, real length words,
 * and a scan long enough for the statistics below to be meaningful. The scan
 * ramp deliberately never contains 0xFF, so every 0xFF in it is one we placed
 * — a stuffing pair at 100 and a restart marker at 200. */
const SCAN_LENGTH = 2400;

function buildJpeg() {
  const bytes = [];
  const push = (...values) => bytes.push(...values);

  // SOI
  push(0xff, 0xd8);

  // APP0 · JFIF, payload 14 bytes (length word 16)
  push(0xff, 0xe0, 0x00, 0x10);
  push(0x4a, 0x46, 0x49, 0x46, 0x00); // "JFIF\0"
  push(0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  // DQT, minimal payload (the mapper records it, nothing validates contents)
  push(0xff, 0xdb, 0x00, 0x04, 0x00, 0x00);

  // SOF0 · baseline, 1 component, 16 high × 24 wide (length word 11)
  push(0xff, 0xc0, 0x00, 0x0b);
  push(0x08, 0x00, 0x10, 0x00, 0x18, 0x01, 0x01, 0x11, 0x00);

  // DRI, restart interval 2
  push(0xff, 0xdd, 0x00, 0x04, 0x00, 0x02);

  // SOS header, 1 component (length word 8)
  push(0xff, 0xda, 0x00, 0x08);
  push(0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);

  const scanFrom = bytes.length;

  // Entropy-coded ramp that never hits 0xFF on its own...
  for (let i = 0; i < SCAN_LENGTH; i += 1) {
    push((i * 7 + 13) % 251);
  }

  // ...then a stuffing pair and a restart marker at known offsets.
  bytes[scanFrom + 100] = 0xff;
  bytes[scanFrom + 101] = 0x00;
  bytes[scanFrom + 200] = 0xff;
  bytes[scanFrom + 201] = 0xd1;

  // EOI
  push(0xff, 0xd9);

  return { bytes: new Uint8Array(bytes), scanFrom, scanTo: scanFrom + SCAN_LENGTH };
}

const OPTS = {
  seed: 0xc0ffee,
  amount: 80,
  window: { from: 0, to: 1 },
  ops: { mutate: true, smear: true, stutter: true, swap: true },
};

const options = (overrides) => ({ ...OPTS, ...overrides });

/* The decodability invariant: inside the scan, every 0xFF must still be
 * followed by stuffing (0x00), padding (0xFF) or a restart marker. */
function scanIsMarkerClean(bytes, from, to) {
  for (let at = from; at < to - 1; at += 1) {
    if (bytes[at] !== 0xff) continue;

    const next = bytes[at + 1];

    if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) return false;
  }

  return true;
}

describe("Glitch Machine pipeline — format sniff", () => {
  it("detects the three container signatures", () => {
    expect(pipeline.detectFormat(buildJpeg().bytes)).toBe("jpeg");
    expect(pipeline.detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(pipeline.detectFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("gif");
  });

  it("returns null for anything else", () => {
    expect(pipeline.detectFormat(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    expect(pipeline.detectFormat(new Uint8Array(0))).toBeNull();
    expect(pipeline.detectFormat(null)).toBeNull();
  });
});

describe("Glitch Machine pipeline — seeds", () => {
  it("mulberry32 is deterministic and stays in [0, 1)", () => {
    const a = pipeline.mulberry32(1234);
    const b = pipeline.mulberry32(1234);

    for (let i = 0; i < 100; i += 1) {
      const value = a();

      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("hex seeds round-trip", () => {
    expect(pipeline.seedToHex(0xc0ffee)).toBe("00C0FFEE");
    expect(pipeline.seedFromHex("00C0FFEE")).toBe(0xc0ffee);
    expect(pipeline.seedFromHex("0xff")).toBe(0xff);
    expect(pipeline.seedFromHex("  3f ")).toBe(0x3f);
  });

  it("refuses non-hex seeds instead of guessing", () => {
    expect(pipeline.seedFromHex("")).toBeNull();
    expect(pipeline.seedFromHex("xyz")).toBeNull();
    expect(pipeline.seedFromHex("123456789")).toBeNull();
  });
});

describe("Glitch Machine pipeline — JPEG map", () => {
  it("walks the markers and finds the scan", () => {
    const { bytes, scanFrom, scanTo } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);

    expect(map.valid).toBe(true);
    expect(map.segments.map((s) => s.name)).toEqual(["SOI", "APP0", "DQT", "SOF0", "DRI", "SOS", "EOI"]);
    expect(map.scans).toEqual([{ from: scanFrom, to: scanTo }]);
    expect(map.scanBytes).toBe(SCAN_LENGTH);
  });

  it("reads the frame header and the restart interval", () => {
    const map = pipeline.mapJpeg(buildJpeg().bytes);

    expect(map.width).toBe(24);
    expect(map.height).toBe(16);
    expect(map.coding).toBe("baseline");
    expect(map.restartInterval).toBe(2);
  });

  it("declares a non-JPEG invalid with a warning", () => {
    const map = pipeline.mapJpeg(new Uint8Array([0x00, 0x01, 0x02, 0x03]));

    expect(map.valid).toBe(false);
    expect(map.warnings.length).toBeGreaterThan(0);
  });

  it("survives a truncated file instead of walking off the end", () => {
    const { bytes } = buildJpeg();
    const map = pipeline.mapJpeg(bytes.slice(0, 20));

    expect(map.valid).toBe(false);
    expect(map.warnings.length).toBeGreaterThan(0);
  });
});

describe("Glitch Machine pipeline — corruption", () => {
  it("is deterministic: same bytes, same controls, same seed, same output", () => {
    const { bytes } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const first = pipeline.glitch(bytes, map, options({}));
    const second = pipeline.glitch(bytes, map, options({}));

    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.written).toBe(second.written);
  });

  it("different seeds bend the file differently", () => {
    const { bytes } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const a = pipeline.glitch(bytes, map, options({ seed: 1 }));
    const b = pipeline.glitch(bytes, map, options({ seed: 2 }));

    expect(Array.from(a.bytes)).not.toEqual(Array.from(b.bytes));
  });

  it("never mutates the input buffer", () => {
    const { bytes } = buildJpeg();
    const before = Array.from(bytes);
    const map = pipeline.mapJpeg(bytes);

    pipeline.glitch(bytes, map, options({ amount: 100 }));

    expect(Array.from(bytes)).toEqual(before);
  });

  it("leaves every byte outside the scan untouched", () => {
    const { bytes, scanFrom, scanTo } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(bytes, map, options({ amount: 100 }));

    expect(Array.from(result.bytes.slice(0, scanFrom))).toEqual(Array.from(bytes.slice(0, scanFrom)));
    expect(Array.from(result.bytes.slice(scanTo))).toEqual(Array.from(bytes.slice(scanTo)));
    expect(result.written).toBeGreaterThan(0);
  });

  it("keeps the scan marker-clean so the result still decodes", () => {
    const { bytes, scanFrom, scanTo } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);

    for (const seed of [1, 42, 0xdead, 0xffffffff]) {
      const result = pipeline.glitch(bytes, map, options({ seed, amount: 100 }));

      expect(scanIsMarkerClean(result.bytes, scanFrom, scanTo), `seed ${seed} broke the scan`).toBe(true);
    }
  });

  it("preserves the stuffing pair and the restart marker byte for byte", () => {
    const { bytes, scanFrom } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(bytes, map, options({ amount: 100 }));

    expect(result.bytes[scanFrom + 100]).toBe(0xff);
    expect(result.bytes[scanFrom + 101]).toBe(0x00);
    expect(result.bytes[scanFrom + 200]).toBe(0xff);
    expect(result.bytes[scanFrom + 201]).toBe(0xd1);
  });

  it("respects the window, give or take one run length", () => {
    const { bytes, scanFrom } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(bytes, map, options({ amount: 100, window: { from: 0, to: 0.25 } }));

    // A run that starts inside the window may spill past its end, but never by
    // more than a stutter's read-plus-write span.
    const spill = pipeline.RUN.stutter.max * 2;
    const boundary = scanFrom + Math.ceil(SCAN_LENGTH * 0.25) + spill;

    expect(Array.from(result.bytes.slice(boundary))).toEqual(Array.from(bytes.slice(boundary)));
    expect(result.written).toBeGreaterThan(0);
  });

  it("writes nothing when every operation is disabled", () => {
    const { bytes } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(
      bytes,
      map,
      options({ ops: { mutate: false, smear: false, stutter: false, swap: false } }),
    );

    expect(result.written).toBe(0);
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
  });

  it("uses only the enabled operations", () => {
    const { bytes } = buildJpeg();
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(
      bytes,
      map,
      options({ ops: { mutate: true, smear: false, stutter: false, swap: false } }),
    );

    expect(result.ops.mutate).toBe(result.opsTotal);
    expect(result.ops.smear + result.ops.stutter + result.ops.swap).toBe(0);
  });

  it("scales with the amount and stays under the cap", () => {
    const windowBytes = SCAN_LENGTH;

    expect(pipeline.planOps(windowBytes, 1)).toBeLessThan(pipeline.planOps(windowBytes, 50));
    expect(pipeline.planOps(windowBytes, 50)).toBeLessThan(pipeline.planOps(windowBytes, 100));
    expect(pipeline.planOps(10 * 1024 * 1024, 100)).toBeLessThanOrEqual(pipeline.MAX_OPS);
    expect(pipeline.planOps(windowBytes, 0)).toBe(1);
  });

  it("comes back inert for an invalid map", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const map = pipeline.mapJpeg(bytes);
    const result = pipeline.glitch(bytes, map, options({}));

    expect(result.written).toBe(0);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4]);
  });
});
