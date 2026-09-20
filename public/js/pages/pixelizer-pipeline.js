/**
 * Pixelizer — the image pipeline, with no DOM in it.
 *
 * Four stages turn a decoded raster into a mosaic, and every one of them is a
 * loop over raw bytes rather than a call into something that would do it for us
 * (the page's whole premise is that the pixelation is ours):
 *
 *   1. `averageBlocks` — one alpha-weighted mean colour per cell
 *   2. `gradeBlocks`   — tone, dither, palette / colour depth, at cell resolution
 *   3. `paintBlocks`   — cell shape, gap and scanlines, back out to raster size
 *   4. (decode/draw stays in the page — it needs a canvas)
 *
 * Stage 1 is deliberately not the usual downscale/upscale trick: a shrunken
 * `drawImage` would hand the averaging to the browser's smoothing filter, whose
 * kernel we neither control nor can report on.
 *
 * Stages 1 and 2/3 are separable on purpose. Cell averages depend only on the
 * block size, so the page caches them and a tone slider re-runs stages 2-3 over
 * a few thousand cells instead of a couple of million pixels.
 *
 * Wrapped UMD-style, like `crew-api.js`, so `tests/unit/pixelizer.pipeline.test.js`
 * can require the same code the browser loads.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.PixelizerPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // The presets scale the block with the raster's longest edge, so one level
  // reads the same on a thumbnail and on a wallpaper. `min` keeps the small end
  // from collapsing back into an unpixelated image.
  const LEVELS = {
    low: { label: "low", factor: 0.008, min: 3 },
    medium: { label: "medium", factor: 0.022, min: 6 },
    high: { label: "high", factor: 0.055, min: 12 },
  };
  const DEFAULT_LEVEL = "medium";

  // Hand-typed palettes — the point of the tool is that nothing here is
  // imported. CGA and C64 are the canonical 16-entry sets; the rest are short
  // ramps that suit a console readout. `sepia` is a tone map, not a palette, and
  // is handled inside `gradeBlocks`.
  const PALETTES = {
    ink: {
      label: "ink (4)",
      colors: [
        [5, 7, 10],
        [74, 85, 96],
        [154, 167, 179],
        [238, 244, 250],
      ],
    },
    gameboy: {
      label: "game boy (4)",
      colors: [
        [15, 56, 15],
        [48, 98, 48],
        [139, 172, 15],
        [155, 188, 15],
      ],
    },
    amber: {
      label: "amber crt (4)",
      colors: [
        [26, 13, 0],
        [107, 61, 0],
        [204, 122, 0],
        [255, 207, 107],
      ],
    },
    ice: {
      label: "ice (5)",
      colors: [
        [3, 6, 12],
        [18, 56, 74],
        [42, 127, 149],
        [79, 245, 255],
        [216, 244, 255],
      ],
    },
    cga: {
      label: "cga (16)",
      colors: [
        [0, 0, 0],
        [0, 0, 170],
        [0, 170, 0],
        [0, 170, 170],
        [170, 0, 0],
        [170, 0, 170],
        [170, 85, 0],
        [170, 170, 170],
        [85, 85, 85],
        [85, 85, 255],
        [85, 255, 85],
        [85, 255, 255],
        [255, 85, 85],
        [255, 85, 255],
        [255, 255, 85],
        [255, 255, 255],
      ],
    },
    c64: {
      label: "c64 (16)",
      colors: [
        [0, 0, 0],
        [255, 255, 255],
        [136, 0, 0],
        [170, 255, 238],
        [204, 68, 204],
        [0, 204, 85],
        [0, 0, 170],
        [238, 238, 119],
        [221, 136, 85],
        [102, 68, 0],
        [255, 119, 119],
        [51, 51, 51],
        [119, 119, 119],
        [170, 255, 102],
        [0, 136, 255],
        [187, 187, 187],
      ],
    },
  };

  // 4×4 ordered (Bayer) matrix, normalised to 0..1 on use. Applied at cell
  // resolution, so the pattern is visible instead of hiding inside one block.
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const DITHER_PALETTE_SPREAD = 56; // how far a cell may be nudged before palette matching

  const SCANLINE_DIM = 0.62; // multiplier applied to every other raster row

  function clamp255(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;

    return value;
  }

  /* Block size for a preset level, given the raster it will be applied to. */
  function blockSizeFor(level, width, height) {
    const preset = LEVELS[level] || LEVELS[DEFAULT_LEVEL];

    return Math.max(preset.min, Math.round(Math.max(width, height) * preset.factor));
  }

  // ------------------------------------------------------- stage 1: block average

  /* One mean colour per cell, written into a cols×rows RGBA grid.
   *
   * Colours are averaged weighted by alpha. A fully transparent pixel still
   * carries whatever RGB the encoder left behind it, and letting that count
   * would drag cells along a transparent PNG edge towards a colour that was
   * never visible. The trailing column and row are narrower when the raster is
   * not a whole number of blocks, which is why the loops clamp their extent. */
  function averageBlocks(data, width, height, block) {
    const cols = Math.ceil(width / block);
    const rows = Math.ceil(height / block);
    const grid = new Uint8ClampedArray(cols * rows * 4);

    for (let row = 0; row < rows; row += 1) {
      const top = row * block;
      const cellRows = Math.min(block, height - top);

      for (let col = 0; col < cols; col += 1) {
        const left = col * block;
        const cellCols = Math.min(block, width - left);

        let weightedRed = 0;
        let weightedGreen = 0;
        let weightedBlue = 0;
        let alphaSum = 0;

        for (let y = 0; y < cellRows; y += 1) {
          let index = ((top + y) * width + left) * 4;

          for (let x = 0; x < cellCols; x += 1, index += 4) {
            const alpha = data[index + 3];

            weightedRed += data[index] * alpha;
            weightedGreen += data[index + 1] * alpha;
            weightedBlue += data[index + 2] * alpha;
            alphaSum += alpha;
          }
        }

        const target = (row * cols + col) * 4;

        grid[target] = alphaSum ? weightedRed / alphaSum : 0;
        grid[target + 1] = alphaSum ? weightedGreen / alphaSum : 0;
        grid[target + 2] = alphaSum ? weightedBlue / alphaSum : 0;
        grid[target + 3] = alphaSum / (cellRows * cellCols);
      }
    }

    return { block, cols, rows, data: grid };
  }

  // --------------------------------------------------------------- stage 2: grade

  function quantiseChannel(value, levels) {
    const step = 255 / (levels - 1);

    return clamp255(Math.round(Math.round(value / step) * step));
  }

  function nearestPaletteColor(colors, red, green, blue) {
    let best = colors[0];
    let bestDistance = Infinity;

    for (let i = 0; i < colors.length; i += 1) {
      const candidate = colors[i];
      const dr = red - candidate[0];
      const dg = green - candidate[1];
      const db = blue - candidate[2];
      // Squared distance is enough to rank, and skips a sqrt per candidate.
      const distance = dr * dr + dg * dg + db * db;

      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }

    return best;
  }

  /* Tone, dither and palette over the cell grid. Returns a new buffer so the
   * cached averages from stage 1 survive for the next control change. */
  function gradeBlocks(grid, cols, rows, controls) {
    const out = new Uint8ClampedArray(grid.length);
    const contrastFactor = 1 + controls.contrast / 100;
    const saturationFactor = 1 + controls.saturation / 100;
    const palette = PALETTES[controls.palette] || null;
    const quantising = controls.depth < 8;
    const ditherSpread = palette ? DITHER_PALETTE_SPREAD : 255 / (controls.depth - 1);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = (row * cols + col) * 4;

        let red = grid[index];
        let green = grid[index + 1];
        let blue = grid[index + 2];

        if (controls.brightness) {
          red += controls.brightness;
          green += controls.brightness;
          blue += controls.brightness;
        }

        if (controls.contrast) {
          red = (red - 128) * contrastFactor + 128;
          green = (green - 128) * contrastFactor + 128;
          blue = (blue - 128) * contrastFactor + 128;
        }

        if (controls.saturation) {
          // Rec. 601 luma — the weights the eye actually uses.
          const luma = 0.299 * red + 0.587 * green + 0.114 * blue;

          red = luma + (red - luma) * saturationFactor;
          green = luma + (green - luma) * saturationFactor;
          blue = luma + (blue - luma) * saturationFactor;
        }

        if (controls.palette === "sepia") {
          const luma = 0.299 * red + 0.587 * green + 0.114 * blue;

          red = luma * 1.07 + 24;
          green = luma * 0.94 + 12;
          blue = luma * 0.72;
        }

        if (controls.invert) {
          red = 255 - red;
          green = 255 - green;
          blue = 255 - blue;
        }

        if (controls.dither && (palette || quantising)) {
          // Nudge the cell by its position in the Bayer matrix before snapping,
          // so a flat gradient breaks into a pattern instead of a hard band.
          const offset = (BAYER[row & 3][col & 3] / 16 - 0.5) * ditherSpread;

          red += offset;
          green += offset;
          blue += offset;
        }

        if (palette) {
          const picked = nearestPaletteColor(palette.colors, clamp255(red), clamp255(green), clamp255(blue));

          red = picked[0];
          green = picked[1];
          blue = picked[2];
        } else if (quantising) {
          red = quantiseChannel(red, controls.depth);
          green = quantiseChannel(green, controls.depth);
          blue = quantiseChannel(blue, controls.depth);
        }

        out[index] = red;
        out[index + 1] = green;
        out[index + 2] = blue;
        out[index + 3] = grid[index + 3];
      }
    }

    return out;
  }

  // --------------------------------------------------------------- stage 3: paint

  /* Is (nx, ny) inside the cell for the chosen shape? Coordinates are normalised
   * to -1..1 from the cell centre, so one test covers every cell size. */
  function insideShape(shape, nx, ny) {
    if (shape === "circle") return nx * nx + ny * ny <= 1;
    if (shape === "diamond") return Math.abs(nx) + Math.abs(ny) <= 1;
    if (shape === "cross") return Math.abs(nx) <= 0.34 || Math.abs(ny) <= 0.34;

    return true;
  }

  /* Blow the cell grid back up to raster size, and return how many distinct
   * colours ended up on screen.
   *
   * Anything outside a cell's shape or inside its gap is left fully transparent
   * rather than filled with a background colour: the console grid shows through,
   * and a saved PNG keeps the holes. */
  function paintBlocks(target, width, height, grid, cols, rows, block, controls) {
    const shape = controls.shape;
    const gap = Math.min(controls.gutter || 0, Math.max(0, block - 1));
    const seen = new Set();

    target.fill(0);

    for (let row = 0; row < rows; row += 1) {
      const top = row * block;
      const cellHeight = Math.min(block, height - top) - gap;

      if (cellHeight <= 0) continue;

      for (let col = 0; col < cols; col += 1) {
        const left = col * block;
        const cellWidth = Math.min(block, width - left) - gap;

        if (cellWidth <= 0) continue;

        const cell = (row * cols + col) * 4;
        const red = grid[cell];
        const green = grid[cell + 1];
        const blue = grid[cell + 2];
        const alpha = grid[cell + 3];

        seen.add((red << 16) | (green << 8) | blue);

        const halfWidth = cellWidth / 2;
        const halfHeight = cellHeight / 2;

        for (let y = 0; y < cellHeight; y += 1) {
          const ny = halfHeight <= 0.5 ? 0 : (y + 0.5 - halfHeight) / halfHeight;
          // Scanlines darken every other *raster* row, so their pitch follows the
          // output resolution rather than the cell size.
          const dim = controls.scanlines && ((top + y) & 1) === 1 ? SCANLINE_DIM : 1;

          let index = ((top + y) * width + left) * 4;

          for (let x = 0; x < cellWidth; x += 1, index += 4) {
            const nx = halfWidth <= 0.5 ? 0 : (x + 0.5 - halfWidth) / halfWidth;

            if (!insideShape(shape, nx, ny)) continue;

            target[index] = red * dim;
            target[index + 1] = green * dim;
            target[index + 2] = blue * dim;
            target[index + 3] = alpha;
          }
        }
      }
    }

    return seen.size;
  }

  /* Label for the colour readout: which of the mutually exclusive colour
   * treatments actually applied. */
  function paletteLabel(controls) {
    if (PALETTES[controls.palette]) return PALETTES[controls.palette].label;
    if (controls.palette === "sepia") return "sepia";
    if (controls.depth < 8) return `depth ${controls.depth}`;

    return "true colour";
  }

  return {
    LEVELS,
    DEFAULT_LEVEL,
    PALETTES,
    BAYER,
    SCANLINE_DIM,
    blockSizeFor,
    averageBlocks,
    gradeBlocks,
    paintBlocks,
    insideShape,
    quantiseChannel,
    nearestPaletteColor,
    paletteLabel,
  };
});
