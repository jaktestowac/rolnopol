import { describe, it, expect, beforeEach } from "vitest";

// The same file the browser loads — it is wrapped UMD-style precisely so the
// pixelation can be checked here instead of by eye in a canvas.
const pipeline = require("../../public/js/pages/pixelizer-pipeline.js");

const CONTROL_DEFAULTS = {
  palette: "none",
  depth: 8,
  dither: false,
  invert: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  shape: "square",
  gutter: 0,
  scanlines: false,
};

const controls = (overrides) => ({ ...CONTROL_DEFAULTS, ...overrides });

/* A 4×4 raster built to make the averaging visible at block size 2:
 *
 *   cell (0,0): two white pixels, two black       -> mid grey
 *   cell (1,0): all black                         -> black
 *   cell (0,1): all black                         -> black
 *   cell (1,1): one opaque red, three transparent -> red at quarter alpha
 */
const WIDTH = 4;
const HEIGHT = 4;

let raster;

beforeEach(() => {
  raster = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

  const put = (x, y, r, g, b, a) => {
    const i = (y * WIDTH + x) * 4;

    raster[i] = r;
    raster[i + 1] = g;
    raster[i + 2] = b;
    raster[i + 3] = a;
  };

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) put(x, y, 0, 0, 0, 255);
  }

  put(0, 0, 255, 255, 255, 255);
  put(1, 1, 255, 255, 255, 255);
  put(2, 2, 255, 0, 0, 255);
  put(3, 2, 0, 255, 0, 0);
  put(2, 3, 0, 255, 0, 0);
  put(3, 3, 0, 255, 0, 0);
});

const cellOf = (grid, cols, col, row) => {
  const at = (row * cols + col) * 4;

  return Array.from(grid.slice(at, at + 4));
};

describe("Pixelizer pipeline — block averaging", () => {
  it("divides the raster into whole cells", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);

    expect({ cols: grid.cols, rows: grid.rows, block: grid.block }).toEqual({ cols: 2, rows: 2, block: 2 });
    expect(grid.data).toHaveLength(2 * 2 * 4);
  });

  it("averages every pixel of a cell into one colour", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);

    expect(cellOf(grid.data, grid.cols, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(cellOf(grid.data, grid.cols, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it("weights the average by alpha so invisible pixels cannot tint a cell", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);

    // One opaque red plus three transparent green: the green never showed, so it
    // must not pull the cell towards yellow. Alpha is still the plain mean.
    expect(cellOf(grid.data, grid.cols, 1, 1)).toEqual([255, 0, 0, 64]);
  });

  it("covers the remainder when the raster is not a whole number of blocks", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 3);

    // 4px across a 3px block is two cells, the second only 1px wide.
    expect({ cols: grid.cols, rows: grid.rows }).toEqual({ cols: 2, rows: 2 });
    expect(cellOf(grid.data, grid.cols, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("treats a fully transparent cell as transparent rather than guessing a colour", () => {
    const blank = new Uint8ClampedArray(2 * 2 * 4); // every byte zero
    const grid = pipeline.averageBlocks(blank, 2, 2, 2);

    expect(cellOf(grid.data, grid.cols, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("scales the preset block size with the raster's longest edge", () => {
    expect(pipeline.blockSizeFor("low", 1000, 500)).toBe(8);
    expect(pipeline.blockSizeFor("medium", 1000, 500)).toBe(22);
    expect(pipeline.blockSizeFor("high", 1000, 500)).toBe(55);

    // Coarser is coarser at every size, and a tiny image still gets a floor.
    expect(pipeline.blockSizeFor("high", 40, 40)).toBeGreaterThan(pipeline.blockSizeFor("low", 40, 40));
    expect(pipeline.blockSizeFor("low", 10, 10)).toBe(3);
  });

  it("falls back to the default level for an unknown one", () => {
    expect(pipeline.blockSizeFor("nonsense", 1000, 500)).toBe(pipeline.blockSizeFor(pipeline.DEFAULT_LEVEL, 1000, 500));
  });
});

describe("Pixelizer pipeline — grading", () => {
  const gradeFirstCell = (overrides) => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);
    const graded = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls(overrides));

    return Array.from(graded.slice(0, 4));
  };

  it("passes cells through untouched when nothing is enabled", () => {
    expect(gradeFirstCell({})).toEqual([128, 128, 128, 255]);
  });

  it("applies brightness, contrast, saturation and invert", () => {
    expect(gradeFirstCell({ brightness: 40 })).toEqual([168, 168, 168, 255]);
    expect(gradeFirstCell({ invert: true })).toEqual([127, 127, 127, 255]);

    // Contrast pivots on mid grey, so the mid-grey cell cannot move...
    expect(gradeFirstCell({ contrast: 60 })).toEqual([128, 128, 128, 255]);
    // ...but a brightened cell is pushed further from the pivot.
    expect(gradeFirstCell({ brightness: 40, contrast: 60 })[0]).toBeGreaterThan(168);

    // Saturation has nothing to pull apart in a grey cell.
    expect(gradeFirstCell({ saturation: 100 })).toEqual([128, 128, 128, 255]);
  });

  it("pulls a coloured cell towards and away from its luma", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);
    const drained = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls({ saturation: -100 }));
    const red = cellOf(drained, grid.cols, 1, 1);

    // Fully desaturated: the red cell collapses to its own grey, all channels equal.
    expect(red[0]).toBe(red[1]);
    expect(red[1]).toBe(red[2]);
    expect(red[0]).toBeGreaterThan(0);
  });

  it("quantises each channel to the requested colour depth", () => {
    // Two levels per channel leaves only the endpoints.
    expect(pipeline.quantiseChannel(128, 2)).toBe(255);
    expect(pipeline.quantiseChannel(120, 2)).toBe(0);
    expect(pipeline.quantiseChannel(200, 3)).toBe(255);
    expect(pipeline.quantiseChannel(100, 3)).toBe(128);

    expect(gradeFirstCell({ depth: 2 })).toEqual([255, 255, 255, 255]);
  });

  it("snaps cells to the nearest entry of a palette", () => {
    expect(pipeline.nearestPaletteColor(pipeline.PALETTES.gameboy.colors, 128, 128, 128)).toEqual([48, 98, 48]);
    expect(gradeFirstCell({ palette: "gameboy" })).toEqual([48, 98, 48, 255]);

    // Every palette must map to one of its own colours and nothing else.
    for (const [name, palette] of Object.entries(pipeline.PALETTES)) {
      const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);
      const graded = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls({ palette: name }));
      const allowed = new Set(palette.colors.map((c) => c.join(",")));

      for (let i = 0; i < graded.length; i += 4) {
        expect(allowed, `${name} produced an off-palette colour`).toContain([graded[i], graded[i + 1], graded[i + 2]].join(","));
      }
    }
  });

  it("tones towards sepia rather than picking from a palette", () => {
    const [red, green, blue] = gradeFirstCell({ palette: "sepia" });

    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
  });

  it("keeps a cell's alpha through every colour treatment", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);

    for (const overrides of [{}, { palette: "c64" }, { palette: "sepia" }, { depth: 3 }, { invert: true, brightness: 50 }]) {
      const graded = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls(overrides));

      expect(cellOf(graded, grid.cols, 1, 1)[3], `alpha lost with ${JSON.stringify(overrides)}`).toBe(64);
    }
  });

  it("dithers a flat area into a pattern instead of one hard band", () => {
    // 8×8 of one flat colour: quantising alone can only produce a single value.
    const flat = new Uint8ClampedArray(8 * 8 * 4).fill(255);

    for (let i = 0; i < flat.length; i += 4) {
      flat[i] = 100;
      flat[i + 1] = 100;
      flat[i + 2] = 100;
    }

    const grid = pipeline.averageBlocks(flat, 8, 8, 1);
    const banded = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls({ depth: 2 }));
    const dithered = pipeline.gradeBlocks(grid.data, grid.cols, grid.rows, controls({ depth: 2, dither: true }));

    const distinct = (buffer) => {
      const seen = new Set();

      for (let i = 0; i < buffer.length; i += 4) seen.add(buffer[i]);

      return seen.size;
    };

    expect(distinct(banded)).toBe(1);
    expect(distinct(dithered)).toBeGreaterThan(1);
  });

  it("leaves true colour alone when there is nothing to dither to", () => {
    // Dither is a pre-snap nudge; with no palette and no depth limit there is no
    // snap, so the cell must come out exactly as it went in.
    expect(gradeFirstCell({ dither: true })).toEqual([128, 128, 128, 255]);
  });

  it("names the colour treatment that actually applied", () => {
    expect(pipeline.paletteLabel(controls({}))).toBe("true colour");
    expect(pipeline.paletteLabel(controls({ depth: 4 }))).toBe("depth 4");
    expect(pipeline.paletteLabel(controls({ palette: "sepia" }))).toBe("sepia");
    expect(pipeline.paletteLabel(controls({ palette: "c64" }))).toBe("c64 (16)");
    // A palette wins over the depth slider, and the label has to say so.
    expect(pipeline.paletteLabel(controls({ palette: "ink", depth: 4 }))).toBe("ink (4)");
  });
});

describe("Pixelizer pipeline — painting", () => {
  const paint = (block, overrides) => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, block);
    const target = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const colours = pipeline.paintBlocks(target, WIDTH, HEIGHT, grid.data, grid.cols, grid.rows, block, controls(overrides));

    return {
      colours,
      alphaAt: (x, y) => target[(y * WIDTH + x) * 4 + 3],
      rgbAt: (x, y) => Array.from(target.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3)),
    };
  };

  it("blows every cell back up to full block size", () => {
    const out = paint(2, {});

    expect(out.rgbAt(0, 0)).toEqual([128, 128, 128]);
    expect(out.rgbAt(1, 1)).toEqual([128, 128, 128]);
    expect(out.alphaAt(0, 0)).toBe(255);
    expect(out.alphaAt(3, 3)).toBe(64);
  });

  it("reports how many distinct colours reached the canvas", () => {
    expect(paint(2, {}).colours).toBe(3); // grey, black, red
    expect(paint(2, { palette: "none", depth: 8 }).colours).toBe(3);
  });

  it("clears a gap along each cell's right and bottom edge", () => {
    const out = paint(2, { gutter: 1 });

    expect(out.alphaAt(0, 0)).toBe(255);
    expect(out.alphaAt(1, 0)).toBe(0);
    expect(out.alphaAt(0, 1)).toBe(0);
  });

  it("never lets the gap swallow the cell", () => {
    // Gap 8 against a 2px block would leave nothing to draw; it must be clamped
    // rather than producing an empty canvas.
    const out = paint(2, { gutter: 8 });

    expect(out.alphaAt(0, 0)).toBe(255);
  });

  it("masks cells to the chosen shape", () => {
    const dot = paint(4, { shape: "circle" });

    expect(dot.alphaAt(0, 0), "a dot must not reach the cell corner").toBe(0);
    expect(dot.alphaAt(2, 2), "a dot must fill the cell centre").toBeGreaterThan(0);

    const diamond = paint(4, { shape: "diamond" });

    expect(diamond.alphaAt(0, 0)).toBe(0);
    expect(diamond.alphaAt(2, 2)).toBeGreaterThan(0);

    const cross = paint(4, { shape: "cross" });

    expect(cross.alphaAt(0, 0)).toBe(0);
    expect(cross.alphaAt(2, 0), "a cross keeps its vertical arm").toBeGreaterThan(0);
    expect(cross.alphaAt(0, 2), "a cross keeps its horizontal arm").toBeGreaterThan(0);

    // Squares cover everything, which is what makes them the default.
    expect(paint(2, { shape: "square" }).alphaAt(0, 0)).toBe(255);
  });

  it("tests shape membership on normalised cell coordinates", () => {
    expect(pipeline.insideShape("square", 1, 1)).toBe(true);
    expect(pipeline.insideShape("circle", 0, 0)).toBe(true);
    expect(pipeline.insideShape("circle", 0.9, 0.9)).toBe(false);
    expect(pipeline.insideShape("diamond", 0.4, 0.4)).toBe(true);
    expect(pipeline.insideShape("diamond", 0.8, 0.8)).toBe(false);
    expect(pipeline.insideShape("cross", 0, 0.9)).toBe(true);
    expect(pipeline.insideShape("cross", 0.9, 0.9)).toBe(false);
  });

  it("darkens alternate raster rows for scanlines", () => {
    const out = paint(2, { scanlines: true });

    expect(out.rgbAt(0, 0)).toEqual([128, 128, 128]);
    expect(out.rgbAt(0, 1)).toEqual([79, 79, 79]);
    expect(out.rgbAt(0, 1)[0]).toBe(Math.round(128 * pipeline.SCANLINE_DIM));
  });

  it("clears the buffer between passes so an old mosaic cannot show through", () => {
    const grid = pipeline.averageBlocks(raster, WIDTH, HEIGHT, 2);
    const target = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(200);

    pipeline.paintBlocks(target, WIDTH, HEIGHT, grid.data, grid.cols, grid.rows, 4, controls({ shape: "circle" }));

    // The corner is outside the dot, so it must be transparent, not leftover 200.
    expect(Array.from(target.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});
