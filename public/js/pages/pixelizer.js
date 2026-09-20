/* Hidden operator page: /operator/tools/pixelizer
 *
 * Takes a local JPEG/PNG/GIF and rebuilds it as a mosaic. No image library, no
 * server round-trip: the file is read with the File API, processed in this tab,
 * and thrown away when the page closes.
 *
 * This file is the console — file intake, controls, readouts, themes. The actual
 * image work lives in `pixelizer-pipeline.js`, which has no DOM in it and is
 * unit-tested directly. What stays here is the one stage that needs a canvas:
 * decoding the file into a raster (capped at MAX_RASTER_DIM) for the pipeline to
 * chew on.
 *
 * Two caches make the controls feel live. `source` holds the decoded raster, so
 * a slider never re-decodes the file; `blocks` holds the cell averages, which
 * depend only on the block size, so a tone or palette change re-runs grading and
 * painting over a few thousand cells rather than re-averaging millions of pixels.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.PixelizerPipeline;

  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif"];
  const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|gif)$/i;
  const MAX_BYTES = 12 * 1024 * 1024;

  // Cap the raster we actually work on. A phone photo can be 6000px wide; full
  // passes over 24M pixels would visibly hang the tab, and the extra detail is
  // discarded by the pixelation anyway.
  const MAX_RASTER_DIM = 1400;

  const THEMES = ["cyan", "amber", "lime", "magenta", "ice"];
  const THEME_KEY = "pxl-theme";

  const DEFAULTS = {
    level: pipeline.DEFAULT_LEVEL,
    palette: "none",
    depth: 8, // 8 = untouched; the slider quantises below that
    dither: false,
    invert: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    shape: "square",
    gutter: 0,
    scanlines: false,
    bloom: false,
  };

  const el = {
    state: document.getElementById("pxlState"),
    theme: document.getElementById("pxlTheme"),
    drop: document.getElementById("pxlDrop"),
    file: document.getElementById("pxlFile"),
    message: document.getElementById("pxlMessage"),
    fileName: document.getElementById("pxlFileName"),
    fileType: document.getElementById("pxlFileType"),
    sourceDims: document.getElementById("pxlSourceDims"),
    rasterDims: document.getElementById("pxlRasterDims"),
    compare: document.getElementById("pxlCompare"),
    download: document.getElementById("pxlDownload"),
    clear: document.getElementById("pxlClear"),
    viewport: document.getElementById("pxlViewport"),
    canvas: document.getElementById("pxlCanvas"),
    compareFlag: document.getElementById("pxlCompareFlag"),
    blockTag: document.getElementById("pxlBlockTag"),
    levelOut: document.getElementById("pxlLevelOut"),
    blockOut: document.getElementById("pxlBlockOut"),
    blockCount: document.getElementById("pxlBlockCount"),
    paletteOut: document.getElementById("pxlPaletteOut"),
    colourCount: document.getElementById("pxlColourCount"),
    elapsed: document.getElementById("pxlElapsed"),
    controls: document.getElementById("pxlControls"),
    block: document.getElementById("pxlBlock"),
    blockValue: document.getElementById("pxlBlockValue"),
    palette: document.getElementById("pxlPalette"),
    depth: document.getElementById("pxlDepth"),
    depthValue: document.getElementById("pxlDepthValue"),
    dither: document.getElementById("pxlDither"),
    invert: document.getElementById("pxlInvert"),
    brightness: document.getElementById("pxlBrightness"),
    brightnessValue: document.getElementById("pxlBrightnessValue"),
    contrast: document.getElementById("pxlContrast"),
    contrastValue: document.getElementById("pxlContrastValue"),
    saturation: document.getElementById("pxlSaturation"),
    saturationValue: document.getElementById("pxlSaturationValue"),
    shape: document.getElementById("pxlShape"),
    gutter: document.getElementById("pxlGutter"),
    gutterValue: document.getElementById("pxlGutterValue"),
    scanlines: document.getElementById("pxlScanlines"),
    bloom: document.getElementById("pxlBloom"),
    reset: document.getElementById("pxlReset"),
  };

  // The decoded image is kept so a control change can re-render without asking
  // the operator to pick the file again.
  let loaded = null; // { image, name, type, size, width, height }
  let objectUrl = null;
  let comparing = false;
  let frameRequest = null;

  let source = null; // { width, height, scaled, data } — survives until a new file
  let blocks = null; // { block, cols, rows, data } — survives until the block size changes
  let output = null; // ImageData sized to the raster

  // -------------------------------------------------------------------- chrome

  function setState(text, kind) {
    if (!el.state) return;

    el.state.textContent = text;
    el.state.classList.toggle("is-busy", kind === "busy");
    el.state.classList.toggle("is-error", kind === "error");
  }

  function setMessage(text, kind) {
    if (!el.message) return;

    el.message.textContent = text || "";
    el.message.classList.toggle("is-error", kind === "error");
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function applyTheme(name) {
    const theme = THEMES.indexOf(name) === -1 ? THEMES[0] : name;

    document.documentElement.setAttribute("data-pxl-theme", theme);
    if (el.theme) el.theme.value = theme;

    // Private-mode Safari throws on localStorage; a theme is not worth a crash.
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* ignore */
    }
  }

  function restoreTheme() {
    let stored = null;

    try {
      stored = window.localStorage.getItem(THEME_KEY);
    } catch (error) {
      /* ignore */
    }

    applyTheme(stored || THEMES[0]);
  }

  // ------------------------------------------------------------------ controls

  function levelKey() {
    const checked = el.controls.querySelector('input[name="level"]:checked');

    return checked ? checked.value : DEFAULTS.level;
  }

  function setLevel(key) {
    const target = el.controls.querySelector(`input[name="level"][value="${key}"]`);

    if (target) target.checked = true;
  }

  function readControls() {
    return {
      level: levelKey(),
      block: Number(el.block.value),
      palette: el.palette.value,
      depth: Number(el.depth.value),
      dither: el.dither.checked,
      invert: el.invert.checked,
      brightness: Number(el.brightness.value),
      contrast: Number(el.contrast.value),
      saturation: Number(el.saturation.value),
      shape: el.shape.value,
      gutter: Number(el.gutter.value),
      scanlines: el.scanlines.checked,
      bloom: el.bloom.checked,
    };
  }

  function signed(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function syncLabels(controls) {
    el.blockValue.textContent = `${controls.block} px`;
    el.depthValue.textContent = controls.depth >= 8 ? "off" : `${controls.depth} / channel`;
    el.brightnessValue.textContent = signed(controls.brightness);
    el.contrastValue.textContent = signed(controls.contrast);
    el.saturationValue.textContent = signed(controls.saturation);
    el.gutterValue.textContent = `${controls.gutter} px`;
    el.viewport.classList.toggle("is-bloom", controls.bloom);
  }

  function resetControls() {
    setLevel(DEFAULTS.level);
    el.palette.value = DEFAULTS.palette;
    el.depth.value = String(DEFAULTS.depth);
    el.dither.checked = DEFAULTS.dither;
    el.invert.checked = DEFAULTS.invert;
    el.brightness.value = String(DEFAULTS.brightness);
    el.contrast.value = String(DEFAULTS.contrast);
    el.saturation.value = String(DEFAULTS.saturation);
    el.shape.value = DEFAULTS.shape;
    el.gutter.value = String(DEFAULTS.gutter);
    el.scanlines.checked = DEFAULTS.scanlines;
    el.bloom.checked = DEFAULTS.bloom;

    syncLabels(readControls());
    schedule();
  }

  // --------------------------------------------------------------- decode stage

  /* Scale the source down to MAX_RASTER_DIM, keeping the aspect ratio. */
  function rasterSize(width, height) {
    const longest = Math.max(width, height);

    if (longest <= MAX_RASTER_DIM) {
      return { width, height, scaled: false };
    }

    const ratio = MAX_RASTER_DIM / longest;

    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
      scaled: true,
    };
  }

  /* Decode once into an offscreen canvas and keep the pixels. Every pipeline
   * stage reads from this buffer, so a slider drag never re-decodes the file. */
  function buildSource() {
    const raster = rasterSize(loaded.width, loaded.height);
    const canvas = document.createElement("canvas");

    canvas.width = raster.width;
    canvas.height = raster.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) return null;

    context.drawImage(loaded.image, 0, 0, raster.width, raster.height);

    return {
      width: raster.width,
      height: raster.height,
      scaled: raster.scaled,
      data: context.getImageData(0, 0, raster.width, raster.height).data,
    };
  }

  // ------------------------------------------------------------------- pipeline

  function schedule() {
    if (!loaded || comparing) return;
    if (frameRequest !== null) return;

    // Coalesce slider spam into one pass per frame.
    frameRequest = window.requestAnimationFrame(function () {
      frameRequest = null;
      render();
    });
  }

  function render() {
    if (!loaded || !el.canvas) return;

    const controls = readControls();
    const context = el.canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      setState("no canvas", "error");
      setMessage("This browser refused a 2D canvas context, so the image cannot be processed.", "error");
      return;
    }

    if (!source) {
      source = buildSource();

      if (!source) {
        setState("no canvas", "error");
        return;
      }

      el.canvas.width = source.width;
      el.canvas.height = source.height;
      output = context.createImageData(source.width, source.height);
      el.rasterDims.textContent = `${source.width} × ${source.height}${source.scaled ? " (scaled)" : ""}`;
    }

    // A preset tracks the raster; Custom takes the slider literally.
    const block =
      controls.level === "custom"
        ? Math.max(Number(el.block.min), controls.block)
        : Math.min(Number(el.block.max), pipeline.blockSizeFor(controls.level, source.width, source.height));

    if (controls.level !== "custom") {
      el.block.value = String(block);
      controls.block = block;
    }

    const startedAt = performance.now();

    if (!blocks || blocks.block !== block) {
      blocks = pipeline.averageBlocks(source.data, source.width, source.height, block);
    }

    const graded = pipeline.gradeBlocks(blocks.data, blocks.cols, blocks.rows, controls);
    const colours = pipeline.paintBlocks(output.data, source.width, source.height, graded, blocks.cols, blocks.rows, block, controls);
    const elapsed = performance.now() - startedAt;

    context.putImageData(output, 0, 0);

    syncLabels(controls);
    el.viewport.classList.add("has-image");
    el.blockTag.textContent = `block ${block}px`;
    el.levelOut.textContent = controls.level === "custom" ? "custom" : pipeline.LEVELS[controls.level].label;
    el.blockOut.textContent = `${block} × ${block} px`;
    el.blockCount.textContent = `${blocks.cols} × ${blocks.rows} = ${blocks.cols * blocks.rows}`;
    el.paletteOut.textContent = pipeline.paletteLabel(controls);
    el.colourCount.textContent = String(colours);
    el.elapsed.textContent = `${elapsed.toFixed(1)} ms`;

    setState("ready");
  }

  /* Hold-to-compare: paint the untouched raster, then fall back to the mosaic on
   * release. Nothing extra is cached for this — the source buffer is already here. */
  function showSource() {
    if (!loaded || !source || comparing) return;

    const context = el.canvas.getContext("2d", { willReadFrequently: true });

    if (!context) return;

    const frame = context.createImageData(source.width, source.height);

    frame.data.set(source.data);

    comparing = true;
    el.compareFlag.hidden = false;
    context.putImageData(frame, 0, 0);
    setState("source", "busy");
  }

  function hideSource() {
    if (!comparing) return;

    comparing = false;
    el.compareFlag.hidden = true;
    render();
  }

  function download() {
    if (!loaded) return;

    const base = loaded.name.replace(/\.[^.]+$/, "") || "image";
    const link = document.createElement("a");

    link.href = el.canvas.toDataURL("image/png");
    link.download = `${base}-pixelized-${el.block.value}px.png`;
    link.click();

    setMessage("Saved as PNG. The CRT bloom is a screen effect and is not baked in.");
  }

  // ---------------------------------------------------------------------- input

  function reject(message) {
    setState("rejected", "error");
    setMessage(message, "error");
  }

  function accepts(file) {
    // Chrome hands over an empty `type` for some drag sources, so fall back to
    // the extension rather than refusing a file the browser can clearly decode.
    if (file.type) return ACCEPTED_TYPES.indexOf(file.type) !== -1;

    return ACCEPTED_EXTENSIONS.test(file.name || "");
  }

  function loadFile(file) {
    if (!file) return;

    if (!accepts(file)) {
      reject(`"${file.name || "that file"}" is not a JPEG, PNG or GIF.`);
      return;
    }

    if (file.size > MAX_BYTES) {
      reject(`${formatBytes(file.size)} is over the ${formatBytes(MAX_BYTES)} limit.`);
      return;
    }

    setState("decoding", "busy");
    setMessage("Decoding…");

    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = function () {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;

      loaded = {
        image,
        name: file.name || "(unnamed)",
        type: file.type || "image/*",
        size: file.size,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      source = null;
      blocks = null;
      comparing = false;
      el.compareFlag.hidden = true;

      el.fileName.textContent = loaded.name;
      el.fileType.textContent = `${loaded.type} · ${formatBytes(file.size)}`;
      el.sourceDims.textContent = `${loaded.width} × ${loaded.height}`;
      el.compare.disabled = false;
      el.download.disabled = false;
      el.clear.disabled = false;

      setMessage(file.type === "image/gif" ? "GIF loaded — first frame only." : "");
      render();
    };

    image.onerror = function () {
      URL.revokeObjectURL(url);
      reject("That file could not be decoded as an image.");
    };

    image.src = url;
  }

  function clearImage() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    loaded = null;
    source = null;
    blocks = null;
    output = null;
    comparing = false;

    el.file.value = "";
    el.viewport.classList.remove("has-image");
    el.compareFlag.hidden = true;
    el.compare.disabled = true;
    el.download.disabled = true;
    el.clear.disabled = true;

    [
      "fileName",
      "fileType",
      "sourceDims",
      "rasterDims",
      "levelOut",
      "blockOut",
      "blockCount",
      "paletteOut",
      "colourCount",
      "elapsed",
    ].forEach(function (key) {
      el[key].textContent = "—";
    });
    el.blockTag.textContent = "block —";

    setMessage("");
    setState("idle");
  }

  // --------------------------------------------------------------------- wiring

  el.drop.addEventListener("click", function () {
    el.file.click();
  });

  el.drop.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    el.file.click();
  });

  el.file.addEventListener("change", function () {
    const picked = el.file.files && el.file.files[0];

    // Clear the input straight away: the File object above stays valid, and an
    // empty input means picking the same file twice still fires `change`.
    el.file.value = "";
    loadFile(picked);
  });

  ["dragenter", "dragover"].forEach(function (name) {
    el.drop.addEventListener(name, function (event) {
      event.preventDefault();
      el.drop.classList.add("is-hot");
    });
  });

  ["dragleave", "dragend"].forEach(function (name) {
    el.drop.addEventListener(name, function () {
      el.drop.classList.remove("is-hot");
    });
  });

  el.drop.addEventListener("drop", function (event) {
    event.preventDefault();
    el.drop.classList.remove("is-hot");
    loadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  // A file dropped outside the zone would otherwise navigate away from the page.
  ["dragover", "drop"].forEach(function (name) {
    window.addEventListener(name, function (event) {
      if (el.drop.contains(event.target)) return;
      event.preventDefault();
    });
  });

  el.controls.addEventListener("input", function (event) {
    // Touching the block slider is a request for that exact size, so flip the
    // level to Custom rather than letting the next render overwrite the value.
    if (event.target === el.block) setLevel("custom");

    syncLabels(readControls());
    schedule();
  });

  el.controls.addEventListener("change", function () {
    syncLabels(readControls());
    schedule();
  });

  el.controls.addEventListener("submit", function (event) {
    event.preventDefault(); // the form is a grouping device, it has nowhere to post
  });

  el.reset.addEventListener("click", resetControls);
  el.clear.addEventListener("click", clearImage);
  el.download.addEventListener("click", download);

  ["mousedown", "touchstart"].forEach(function (name) {
    el.compare.addEventListener(name, function (event) {
      event.preventDefault();
      showSource();
    });
  });

  ["mouseup", "mouseleave", "touchend", "touchcancel", "blur"].forEach(function (name) {
    el.compare.addEventListener(name, hideSource);
  });

  // Keyboard equivalent of the hold gesture.
  el.compare.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    showSource();
  });

  el.compare.addEventListener("keyup", hideSource);

  el.theme.addEventListener("change", function () {
    applyTheme(el.theme.value);
  });

  restoreTheme();
  syncLabels(readControls());
  setState("idle");
})();
