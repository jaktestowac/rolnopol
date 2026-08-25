import { describe, it, expect } from "vitest";

// The same file the browser loads — it is wrapped UMD-style precisely so the
// weave can be checked here instead of by eye on a canvas.
const pipeline = require("../../public/js/pages/noise-loom-pipeline.js");

/* Small, fast options for tests. Warp is on in most of them on purpose: the
 * warped path is the one most likely to break periodicity or determinism. */
const OPTS = {
  seed: 0xc0ffee,
  field: "perlin",
  cells: 4,
  octaves: 3,
  gain: 50,
  warp: 40,
  transform: "linear",
  palette: "abyss",
  seamless: true,
  invert: false,
  size: 256,
};

const options = (overrides) => ({ ...OPTS, ...overrides });

describe("Noise Loom pipeline — seeds and hashing", () => {
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
    expect(pipeline.seedFromHex("xyz")).toBeNull();
    expect(pipeline.seedFromHex("")).toBeNull();
  });

  it("hash2d is deterministic, spread, and stays in [0, 1)", () => {
    const seen = new Set();

    for (let x = -8; x < 8; x += 1) {
      for (let y = -8; y < 8; y += 1) {
        const value = pipeline.hash2d(x, y, 42);

        expect(value).toBe(pipeline.hash2d(x, y, 42));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        seen.add(value);
      }
    }

    // 256 lattice points should give (nearly) 256 distinct values.
    expect(seen.size).toBeGreaterThan(250);
  });

  it("the seed changes the lattice", () => {
    expect(pipeline.hash2d(3, 7, 1)).not.toBe(pipeline.hash2d(3, 7, 2));
  });
});

describe("Noise Loom pipeline — noise fields", () => {
  it("every field stays in [0, 1] over a sample grid", () => {
    for (const field of pipeline.FIELDS) {
      for (let i = 0; i < 200; i += 1) {
        const u = (i % 20) / 13.7;
        const v = Math.floor(i / 20) / 7.3;
        const value = pipeline.fieldAt(options({ field }), u, v);

        expect(value, `${field} at ${u},${v}`).toBeGreaterThanOrEqual(0);
        expect(value, `${field} at ${u},${v}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("seamless fields are periodic with period 1 in both axes — warp included", () => {
    for (const field of pipeline.FIELDS) {
      const opts = options({ field, warp: 60 });

      for (const [u, v] of [[0.13, 0.71], [0.5, 0.5], [0.99, 0.01], [0, 0.42]]) {
        const base = pipeline.fieldAt(opts, u, v);

        expect(pipeline.fieldAt(opts, u + 1, v), `${field} u-period`).toBeCloseTo(base, 12);
        expect(pipeline.fieldAt(opts, u, v + 1), `${field} v-period`).toBeCloseTo(base, 12);
        expect(pipeline.fieldAt(opts, u + 2, v + 1), `${field} uv-period`).toBeCloseTo(base, 12);
      }
    }
  });

  it("non-seamless fields are not periodic", () => {
    const opts = options({ seamless: false, warp: 0 });
    let different = 0;

    for (const [u, v] of [[0.13, 0.71], [0.4, 0.6], [0.05, 0.9]]) {
      if (pipeline.fieldAt(opts, u, v) !== pipeline.fieldAt(opts, u + 1, v)) different += 1;
    }

    expect(different).toBeGreaterThan(0);
  });

  it("invert mirrors the field exactly", () => {
    const straight = options({ invert: false });
    const inverted = options({ invert: true });

    for (const [u, v] of [[0.2, 0.3], [0.7, 0.9], [0.5, 0.1]]) {
      expect(pipeline.fieldAt(inverted, u, v)).toBeCloseTo(1 - pipeline.fieldAt(straight, u, v), 12);
    }
  });

  it("transforms reshape the same underlying field", () => {
    // Ridged and billow are exact complements of each other by construction.
    const ridged = options({ transform: "ridged" });
    const billow = options({ transform: "billow" });

    for (const [u, v] of [[0.2, 0.3], [0.7, 0.9]]) {
      expect(pipeline.fieldAt(ridged, u, v)).toBeCloseTo(1 - pipeline.fieldAt(billow, u, v), 12);
    }

    // Terrace quantizes: only TERRACE_STEPS distinct plateau values may appear.
    const terrace = options({ transform: "terrace" });
    const seen = new Set();

    for (let i = 0; i < 300; i += 1) {
      seen.add(pipeline.fieldAt(terrace, i / 17.3, i / 23.1));
    }

    expect(seen.size).toBeLessThanOrEqual(pipeline.TERRACE_STEPS);
  });
});

describe("Noise Loom pipeline — options", () => {
  it("clamps garbage back into the loom's bounds", () => {
    const opts = pipeline.normalizeOptions({
      seed: "not a number",
      field: "simplex",
      cells: 9000,
      octaves: -3,
      gain: 200,
      warp: "loud",
      transform: "vaporize",
      palette: "chartreuse",
      size: 333,
    });

    expect(opts.seed).toBe(0);
    expect(opts.field).toBe(pipeline.DEFAULTS.field);
    expect(opts.cells).toBe(24);
    expect(opts.octaves).toBe(1);
    expect(opts.gain).toBe(75);
    expect(opts.warp).toBe(pipeline.DEFAULTS.warp);
    expect(opts.transform).toBe(pipeline.DEFAULTS.transform);
    expect(opts.palette).toBe(pipeline.DEFAULTS.palette);
    expect(opts.size).toBe(pipeline.DEFAULTS.size);
  });

  it("takes no options at all and still comes back whole", () => {
    expect(pipeline.normalizeOptions(null)).toEqual(pipeline.normalizeOptions(pipeline.DEFAULTS));
  });
});

describe("Noise Loom pipeline — palettes", () => {
  it("hits the first stop at 0 and the last stop at 1", () => {
    for (const palette of pipeline.PALETTES) {
      const first = palette.stops[0][1];
      const last = palette.stops[palette.stops.length - 1][1];

      expect(pipeline.samplePalette(palette.key, 0)).toEqual(first);
      expect(pipeline.samplePalette(palette.key, 1)).toEqual(last);
    }
  });

  it("interpolates between stops", () => {
    // mono is black → white, so the midpoint must be mid-grey.
    const mid = pipeline.samplePalette("mono", 0.5);

    for (const channel of mid) {
      expect(channel).toBeGreaterThan(100);
      expect(channel).toBeLessThan(155);
    }
  });

  it("falls back to the first palette for an unknown key", () => {
    expect(pipeline.samplePalette("no-such-dye", 0)).toEqual(pipeline.PALETTES[0].stops[0][1]);
  });
});

describe("Noise Loom pipeline — render", () => {
  it("is deterministic: same options, same texture, byte for byte", () => {
    const a = pipeline.renderTexture(options({}));
    const b = pipeline.renderTexture(options({}));

    expect(a.width).toBe(256);
    expect(a.height).toBe(256);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("different seeds weave different cloth", () => {
    const a = pipeline.renderTexture(options({ seed: 1 }));
    const b = pipeline.renderTexture(options({ seed: 2 }));

    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it("fills every pixel, fully opaque, with a sane field range", () => {
    const texture = pipeline.renderTexture(options({}));

    expect(texture.data.length).toBe(256 * 256 * 4);

    for (let i = 3; i < texture.data.length; i += 4) {
      expect(texture.data[i]).toBe(255);
    }

    expect(texture.min).toBeGreaterThanOrEqual(0);
    expect(texture.max).toBeLessThanOrEqual(1);
    expect(texture.min).toBeLessThan(texture.max);
  });

  it("seamless textures continue across the edge with no duplicated row", () => {
    // Pixels sample at x/size, so the texel one past the right edge is the
    // texel at x=0 — the wrap must land exactly there.
    const opts = pipeline.normalizeOptions(options({}));
    const sample = pipeline.buildSampler(opts);

    for (const v of [0, 0.25, 0.5, 0.99]) {
      expect(sample(1, v)).toBeCloseTo(sample(0, v), 12);
    }
  });
});

describe("Noise Loom pipeline — recipes", () => {
  it("round-trips the whole loom state", () => {
    const opts = pipeline.normalizeOptions(
      options({ field: "worley", transform: "billow", palette: "rust", seamless: false, invert: true, size: 1024 }),
    );
    const recipe = pipeline.makeRecipe(opts);

    expect(recipe.startsWith("LOOM1.")).toBe(true);
    expect(pipeline.parseRecipe(recipe)).toEqual(opts);
  });

  it("round-trips the defaults too", () => {
    const opts = pipeline.normalizeOptions(pipeline.DEFAULTS);

    expect(pipeline.parseRecipe(pipeline.makeRecipe(opts))).toEqual(opts);
  });

  it("refuses anything that does not parse exactly", () => {
    const good = pipeline.makeRecipe(options({}));

    expect(pipeline.parseRecipe("")).toBeNull();
    expect(pipeline.parseRecipe("LOOM2." + good.slice(6))).toBeNull(); // wrong version
    expect(pipeline.parseRecipe(good + ".extra")).toBeNull(); // wrong token count
    expect(pipeline.parseRecipe(good.replace("perlin", "simplex"))).toBeNull(); // unknown field
    expect(pipeline.parseRecipe(good.replace(/\.c4\./, ".c99."))).toBeNull(); // cells out of range
    expect(pipeline.parseRecipe(good.replace(/\.256$/, ".300"))).toBeNull(); // size not offered
    expect(pipeline.parseRecipe(good.replace("00C0FFEE", "NOTHEX!!"))).toBeNull(); // seed not hex
  });
});
