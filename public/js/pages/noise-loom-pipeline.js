/**
 * Noise Loom — the texture engine, with no DOM in it.
 *
 * Hand-written procedural noise: value, gradient (Perlin) and cellular
 * (Worley) fields, stacked into fractal octaves, optionally pushed through a
 * domain warp, shaped by a transform and mapped through a palette. Every
 * number comes from a seeded hash, so a recipe string replays the exact
 * texture, pixel for pixel.
 *
 * Seamless tiling is not a post-process: every octave uses an integer number
 * of lattice cells across the tile and wraps its lattice modulo that count,
 * and the warp field is periodic too — so the composed field is periodic by
 * construction, not by blending.
 *
 * Wrapped UMD-style, like the other `*-pipeline.js` files, so
 * `tests/unit/noise-loom.pipeline.test.js` can require the same code the
 * browser loads.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.NoiseLoomPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // Bounds. The loom weaves, it does not stall the tab.
  const MAX_DIM = 1024;
  const MAX_LATTICE = 512; // finest octave lattice; beyond this it is just aliasing
  const SIZES = [256, 512, 1024];

  const FIELDS = ["value", "perlin", "worley"];
  const TRANSFORMS = ["linear", "ridged", "billow", "terrace"];
  const TERRACE_STEPS = 6;

  // Max displacement of the domain warp, in tile widths, at warp = 100.
  const WARP_SPAN = 0.6;
  const WARP_OCTAVES = 3;

  const DEFAULTS = {
    seed: 0,
    field: "perlin",
    cells: 6,
    octaves: 5,
    gain: 50,
    warp: 25,
    transform: "linear",
    palette: "abyss",
    seamless: true,
    invert: false,
    size: 512,
  };

  /* Gradient palettes as stop lists: [position 0..1, [r, g, b]]. Sampled by
   * linear interpolation between neighbouring stops. */
  const PALETTES = [
    {
      key: "mono",
      name: "Mono / raw field",
      stops: [
        [0, [8, 8, 10]],
        [1, [244, 244, 248]],
      ],
    },
    {
      key: "abyss",
      name: "Abyss / deep water",
      stops: [
        [0, [2, 8, 25]],
        [0.45, [10, 60, 110]],
        [0.75, [40, 170, 200]],
        [1, [220, 250, 255]],
      ],
    },
    {
      key: "ember",
      name: "Ember / heat",
      stops: [
        [0, [5, 3, 20]],
        [0.25, [75, 15, 90]],
        [0.5, [190, 55, 60]],
        [0.75, [250, 150, 40]],
        [1, [255, 240, 190]],
      ],
    },
    {
      key: "verdant",
      name: "Verdant / moss",
      stops: [
        [0, [3, 18, 10]],
        [0.4, [22, 90, 46]],
        [0.7, [90, 180, 60]],
        [1, [235, 250, 200]],
      ],
    },
    {
      key: "rust",
      name: "Rust / oxide",
      stops: [
        [0, [15, 8, 5]],
        [0.4, [95, 40, 20]],
        [0.7, [190, 95, 35]],
        [1, [245, 215, 170]],
      ],
    },
    {
      key: "signal",
      name: "Signal / duotone",
      stops: [
        [0, [20, 4, 32]],
        [0.5, [255, 45, 140]],
        [1, [0, 240, 255]],
      ],
    },
  ];

  // ------------------------------------------------------------------- helpers

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* Quintic fade — zero first and second derivative at the lattice, so no
   * visible grid creases. */
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function wrap(n, period) {
    if (!period) return n;

    return ((n % period) + period) % period;
  }

  // ---------------------------------------------------------------------- PRNG

  /* mulberry32 — same generator the Glitch Machine uses; here it only rolls
   * page-side seeds. The lattice itself uses the stateless hash below. */
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

  function seedFromHex(text) {
    const cleaned = String(text || "").trim().replace(/^0x/i, "");

    if (!cleaned || cleaned.length > 8 || /[^0-9a-f]/i.test(cleaned)) return null;

    return parseInt(cleaned, 16) >>> 0;
  }

  /* Stateless lattice hash: (x, y, seed) → [0, 1). The whole texture hangs off
   * this one function being deterministic and well-spread. */
  function hash2d(x, y, seed) {
    // Each coordinate is mixed on its own before it meets the other. Folding
    // both in with a bare XOR (h ^ x then h ^ y) leaves the two only a few bits
    // apart on neighbouring lattice points, and whole rows of the lattice then
    // collide onto the same value.
    let h = (seed >>> 0) ^ Math.imul(x | 0, 0x27d4eb2d);

    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;

    return (h >>> 0) / 4294967296;
  }

  // -------------------------------------------------------------------- noises

  /* Value noise: random heights on the lattice, quintic-blended. Soft clouds. */
  function valueNoise(x, y, seed, period) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);

    const x0 = wrap(ix, period);
    const x1 = wrap(ix + 1, period);
    const y0 = wrap(iy, period);
    const y1 = wrap(iy + 1, period);

    const top = lerp(hash2d(x0, y0, seed), hash2d(x1, y0, seed), fx);
    const bottom = lerp(hash2d(x0, y1, seed), hash2d(x1, y1, seed), fx);

    return lerp(top, bottom, fy);
  }

  /* Gradient (Perlin) noise: a random direction on each lattice point, dotted
   * with the offset. Range ±√2/2, rescaled into [0, 1]. */
  function gradDot(cx, cy, seed, dx, dy) {
    const angle = hash2d(cx, cy, seed) * Math.PI * 2;

    return Math.cos(angle) * dx + Math.sin(angle) * dy;
  }

  function perlinNoise(x, y, seed, period) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const x0 = wrap(ix, period);
    const x1 = wrap(ix + 1, period);
    const y0 = wrap(iy, period);
    const y1 = wrap(iy + 1, period);

    const u = fade(fx);
    const v = fade(fy);

    const top = lerp(gradDot(x0, y0, seed, fx, fy), gradDot(x1, y0, seed, fx - 1, fy), u);
    const bottom = lerp(gradDot(x0, y1, seed, fx, fy - 1), gradDot(x1, y1, seed, fx - 1, fy - 1), u);

    return clamp01(lerp(top, bottom, v) * 0.7071 + 0.5);
  }

  /* Cellular (Worley) noise: one feature point per cell, F1 distance over the
   * 3×3 neighbourhood. The hash is taken on the *wrapped* cell but the point
   * sits in the *unwrapped* cell, so distances stay continuous across the
   * tile boundary. */
  function worleyNoise(x, y, seed, period) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let best = Infinity;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const cy = iy + dy;
        const wx = wrap(cx, period);
        const wy = wrap(cy, period);
        const px = cx + hash2d(wx, wy, seed);
        const py = cy + hash2d(wx, wy, (seed ^ 0x5bf03635) >>> 0);
        const ddx = px - x;
        const ddy = py - y;
        const d = ddx * ddx + ddy * ddy;

        if (d < best) best = d;
      }
    }

    return clamp01(Math.sqrt(best) / 1.25);
  }

  const NOISE = { value: valueNoise, perlin: perlinNoise, worley: worleyNoise };

  // ----------------------------------------------------------------------- fBm

  /* Octave stack. Each octave doubles the lattice (integer counts only — that
   * is what keeps seamless mode exact) and decays by `gain`. Normalised by the
   * total amplitude so the result stays in [0, 1] for any octave count. */
  function fbm(noiseFn, u, v, seed, cells, octaves, gain, seamless) {
    let amp = 1;
    let total = 0;
    let sum = 0;

    for (let o = 0; o < octaves; o += 1) {
      const lattice = Math.min(MAX_LATTICE, cells * (1 << o));
      const period = seamless ? lattice : 0;
      const octaveSeed = (seed + o * 0x9e3779b9) >>> 0;

      sum += amp * noiseFn(u * lattice, v * lattice, octaveSeed, period);
      total += amp;
      amp *= gain;
    }

    return sum / total;
  }

  // ------------------------------------------------------------------- options

  function pick(list, value, fallback) {
    return list.indexOf(value) === -1 ? fallback : value;
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);

    if (!Number.isFinite(n)) return fallback;

    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function paletteByKey(key) {
    for (let i = 0; i < PALETTES.length; i += 1) {
      if (PALETTES[i].key === key) return PALETTES[i];
    }

    return null;
  }

  function normalizeOptions(raw) {
    const opts = raw || {};

    return {
      seed: normalizeSeed(opts.seed),
      field: pick(FIELDS, opts.field, DEFAULTS.field),
      cells: clampInt(opts.cells, 2, 24, DEFAULTS.cells),
      octaves: clampInt(opts.octaves, 1, 8, DEFAULTS.octaves),
      gain: clampInt(opts.gain, 25, 75, DEFAULTS.gain),
      warp: clampInt(opts.warp, 0, 100, DEFAULTS.warp),
      transform: pick(TRANSFORMS, opts.transform, DEFAULTS.transform),
      palette: paletteByKey(opts.palette) ? opts.palette : DEFAULTS.palette,
      seamless: opts.seamless !== false,
      invert: opts.invert === true,
      size: SIZES.indexOf(Number(opts.size)) === -1 ? DEFAULTS.size : Number(opts.size),
    };
  }

  // ------------------------------------------------------------------ sampling

  function applyTransform(value, transform) {
    if (transform === "ridged") return 1 - Math.abs(2 * value - 1);
    if (transform === "billow") return Math.abs(2 * value - 1);
    if (transform === "terrace") {
      return Math.min(1, Math.floor(value * TERRACE_STEPS) / (TERRACE_STEPS - 1));
    }

    return value;
  }

  /* Compile normalized options into a (u, v) → [0, 1] sampler. The warp field
   * is always value noise — smooth and cheap — and periodic like the main
   * field, so warping never breaks the tile. */
  function buildSampler(options) {
    const opts = normalizeOptions(options);
    const noiseFn = NOISE[opts.field];
    const gain = opts.gain / 100;
    const warp = (opts.warp / 100) * WARP_SPAN;
    const warpOctaves = Math.min(WARP_OCTAVES, opts.octaves);
    const seedU = (opts.seed ^ 0x02f6e2b1) >>> 0;
    const seedV = (opts.seed ^ 0x743f9b1d) >>> 0;

    return function sample(u, v) {
      let su = u;
      let sv = v;

      if (warp > 0) {
        su += warp * (fbm(valueNoise, u, v, seedU, opts.cells, warpOctaves, gain, opts.seamless) - 0.5);
        sv += warp * (fbm(valueNoise, u, v, seedV, opts.cells, warpOctaves, gain, opts.seamless) - 0.5);
      }

      let value = fbm(noiseFn, su, sv, opts.seed, opts.cells, opts.octaves, gain, opts.seamless);

      value = applyTransform(clamp01(value), opts.transform);

      if (opts.invert) value = 1 - value;

      return clamp01(value);
    };
  }

  /* Convenience for tests and one-off probes. Rendering uses buildSampler
   * directly so the options are normalised once, not per pixel. */
  function fieldAt(options, u, v) {
    return buildSampler(options)(u, v);
  }

  function samplePalette(key, t) {
    const palette = paletteByKey(key) || PALETTES[0];
    const stops = palette.stops;
    const value = clamp01(t);

    for (let i = 1; i < stops.length; i += 1) {
      if (value <= stops[i][0]) {
        const span = stops[i][0] - stops[i - 1][0];
        const local = span > 0 ? (value - stops[i - 1][0]) / span : 0;
        const a = stops[i - 1][1];
        const b = stops[i][1];

        return [Math.round(lerp(a[0], b[0], local)), Math.round(lerp(a[1], b[1], local)), Math.round(lerp(a[2], b[2], local))];
      }
    }

    const last = stops[stops.length - 1][1];

    return [last[0], last[1], last[2]];
  }

  // ------------------------------------------------------------------- render

  /* Weave the texture into an RGBA buffer. Pixels sample at x/size (not the
   * pixel centre) so that a tiled repeat continues with no duplicated row —
   * pixel 0 of the next tile is exactly one texel after pixel size-1. */
  function renderTexture(options) {
    const opts = normalizeOptions(options);
    const size = Math.min(MAX_DIM, opts.size);
    const sample = buildSampler(opts);
    const data = new Uint8ClampedArray(size * size * 4);
    let min = 1;
    let max = 0;
    let at = 0;

    for (let y = 0; y < size; y += 1) {
      const v = y / size;

      for (let x = 0; x < size; x += 1) {
        const value = sample(x / size, v);

        if (value < min) min = value;
        if (value > max) max = value;

        const rgb = samplePalette(opts.palette, value);

        data[at] = rgb[0];
        data[at + 1] = rgb[1];
        data[at + 2] = rgb[2];
        data[at + 3] = 255;
        at += 4;
      }
    }

    return { data, width: size, height: size, min, max };
  }

  // ------------------------------------------------------------------- recipes

  /* A recipe is the whole loom state as one pasteable token:
   *   LOOM1.00C0FFEE.perlin.c6.o5.g50.w25.linear.abyss.t.512
   * Flags: t = seamless, i = inverted, x = neither. Anything that does not
   * parse exactly comes back null — a recipe either replays or it is refused. */
  function makeRecipe(options) {
    const opts = normalizeOptions(options);
    const flags = (opts.seamless ? "t" : "") + (opts.invert ? "i" : "");

    return [
      "LOOM1",
      seedToHex(opts.seed),
      opts.field,
      `c${opts.cells}`,
      `o${opts.octaves}`,
      `g${opts.gain}`,
      `w${opts.warp}`,
      opts.transform,
      opts.palette,
      flags || "x",
      String(opts.size),
    ].join(".");
  }

  function prefixedInt(token, prefix, min, max) {
    if (typeof token !== "string" || token.charAt(0) !== prefix) return null;

    const n = Number(token.slice(1));

    if (!Number.isInteger(n) || n < min || n > max) return null;

    return n;
  }

  function parseRecipe(text) {
    const tokens = String(text || "").trim().split(".");

    if (tokens.length !== 11 || tokens[0] !== "LOOM1") return null;

    const seed = seedFromHex(tokens[1]);
    const cells = prefixedInt(tokens[3], "c", 2, 24);
    const octaves = prefixedInt(tokens[4], "o", 1, 8);
    const gain = prefixedInt(tokens[5], "g", 25, 75);
    const warp = prefixedInt(tokens[6], "w", 0, 100);
    const size = Number(tokens[10]);

    if (seed === null || cells === null || octaves === null || gain === null || warp === null) return null;
    if (FIELDS.indexOf(tokens[2]) === -1) return null;
    if (TRANSFORMS.indexOf(tokens[7]) === -1) return null;
    if (!paletteByKey(tokens[8])) return null;
    if (["x", "t", "i", "ti"].indexOf(tokens[9]) === -1) return null;
    if (SIZES.indexOf(size) === -1) return null;

    return normalizeOptions({
      seed,
      field: tokens[2],
      cells,
      octaves,
      gain,
      warp,
      transform: tokens[7],
      palette: tokens[8],
      seamless: tokens[9].indexOf("t") !== -1,
      invert: tokens[9].indexOf("i") !== -1,
      size,
    });
  }

  return {
    MAX_DIM,
    MAX_LATTICE,
    SIZES,
    FIELDS,
    TRANSFORMS,
    TERRACE_STEPS,
    WARP_SPAN,
    DEFAULTS,
    PALETTES,
    mulberry32,
    normalizeSeed,
    seedToHex,
    seedFromHex,
    hash2d,
    valueNoise,
    perlinNoise,
    worleyNoise,
    fbm,
    normalizeOptions,
    buildSampler,
    fieldAt,
    samplePalette,
    renderTexture,
    makeRecipe,
    parseRecipe,
  };
});
