/* Hidden operator page: /operator/tools/noise-loom
 *
 * Procedural texture generator. Value, gradient and cellular noise are woven
 * into fractal octaves, warped, shaped and dyed through a palette — all from
 * hand-written math seeded by one 32-bit number. Nothing is uploaded and
 * nothing is fetched: the texture is computed in this tab and saved from it.
 *
 * This file is the loom's frame — controls, canvases, downloads. The math
 * lives in `noise-loom-pipeline.js`, which has no DOM in it and is
 * unit-tested directly.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.NoiseLoomPipeline;

  const DYES = ["indigo", "ember", "verdigris", "bone"];
  const DYE_KEY = "nlm-dye";

  const SWATCH_WIDTH = 220;
  const SWATCH_HEIGHT = 14;

  const el = {
    state: document.getElementById("nlmState"),
    dye: document.getElementById("nlmDye"),
    message: document.getElementById("nlmMessage"),
    viewport: document.getElementById("nlmViewport"),
    canvas: document.getElementById("nlmCanvas"),
    seedHud: document.getElementById("nlmSeedHud"),
    passHud: document.getElementById("nlmPassHud"),
    controls: document.getElementById("nlmControls"),
    field: document.getElementById("nlmField"),
    cells: document.getElementById("nlmCells"),
    cellsValue: document.getElementById("nlmCellsValue"),
    octaves: document.getElementById("nlmOctaves"),
    octavesValue: document.getElementById("nlmOctavesValue"),
    gain: document.getElementById("nlmGain"),
    gainValue: document.getElementById("nlmGainValue"),
    warp: document.getElementById("nlmWarp"),
    warpValue: document.getElementById("nlmWarpValue"),
    transform: document.getElementById("nlmTransform"),
    palette: document.getElementById("nlmPalette"),
    swatch: document.getElementById("nlmSwatch"),
    seamless: document.getElementById("nlmSeamless"),
    invert: document.getElementById("nlmInvert"),
    size: document.getElementById("nlmSize"),
    tile: document.getElementById("nlmTile"),
    seed: document.getElementById("nlmSeed"),
    reroll: document.getElementById("nlmReroll"),
    recipe: document.getElementById("nlmRecipe"),
    recipeCopy: document.getElementById("nlmRecipeCopy"),
    savePng: document.getElementById("nlmSavePng"),
    reset: document.getElementById("nlmReset"),
    rangeOut: document.getElementById("nlmRangeOut"),
    passOut: document.getElementById("nlmPassOut"),
    texOut: document.getElementById("nlmTexOut"),
    weaveOut: document.getElementById("nlmWeaveOut"),
  };

  // The texture is woven into this off-screen canvas; the visible canvas only
  // ever shows it (once, or 2×2 when the tile check is on).
  const cloth = document.createElement("canvas");

  let seed = 0;
  let weaving = false;
  let dirty = false;
  let weaveCount = 0;

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

  function applyDye(name) {
    const dye = DYES.indexOf(name) === -1 ? DYES[0] : name;

    document.documentElement.setAttribute("data-nlm-dye", dye);
    if (el.dye) el.dye.value = dye;

    // Private-mode Safari throws on localStorage; a colour is not worth a crash.
    try {
      window.localStorage.setItem(DYE_KEY, dye);
    } catch (error) {
      /* ignore */
    }
  }

  function restoreDye() {
    let stored = null;

    try {
      stored = window.localStorage.getItem(DYE_KEY);
    } catch (error) {
      /* ignore */
    }

    applyDye(stored || DYES[0]);
  }

  // -------------------------------------------------------------------- seeds

  function rollSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      return window.crypto.getRandomValues(new Uint32Array(1))[0];
    }

    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  function showSeed() {
    const hex = pipeline.seedToHex(seed);

    el.seed.value = hex;
    el.seed.classList.remove("is-error");
    el.seedHud.textContent = hex;
  }

  // ------------------------------------------------------------------ controls

  function readControls() {
    return {
      seed,
      field: el.field.value,
      cells: Number(el.cells.value),
      octaves: Number(el.octaves.value),
      gain: Number(el.gain.value),
      warp: Number(el.warp.value),
      transform: el.transform.value,
      palette: el.palette.value,
      seamless: el.seamless.checked,
      invert: el.invert.checked,
      size: Number(el.size.value),
    };
  }

  function writeControls(opts) {
    el.field.value = opts.field;
    el.cells.value = String(opts.cells);
    el.octaves.value = String(opts.octaves);
    el.gain.value = String(opts.gain);
    el.warp.value = String(opts.warp);
    el.transform.value = opts.transform;
    el.palette.value = opts.palette;
    el.seamless.checked = opts.seamless;
    el.invert.checked = opts.invert;
    el.size.value = String(opts.size);
    seed = opts.seed;

    showSeed();
    syncLabels();
  }

  function syncLabels() {
    el.cellsValue.textContent = el.cells.value;
    el.octavesValue.textContent = el.octaves.value;
    el.gainValue.textContent = `${el.gain.value}%`;
    el.warpValue.textContent = `${el.warp.value}%`;
  }

  function resetControls() {
    writeControls(pipeline.normalizeOptions({ ...pipeline.DEFAULTS, seed }));
    setMessage("");
    schedule();
  }

  // ------------------------------------------------------------------- palette

  function paintSwatch() {
    const context = el.swatch.getContext("2d");

    if (!context) return;

    for (let x = 0; x < SWATCH_WIDTH; x += 1) {
      const rgb = pipeline.samplePalette(el.palette.value, x / (SWATCH_WIDTH - 1));

      context.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
      context.fillRect(x, 0, 1, SWATCH_HEIGHT);
    }
  }

  // -------------------------------------------------------------------- render

  function paintCloth() {
    const tiled = el.tile.checked;
    const context = el.canvas.getContext("2d");

    if (!context) return;

    el.canvas.width = cloth.width;
    el.canvas.height = cloth.height;
    context.imageSmoothingEnabled = false;

    if (!tiled) {
      context.drawImage(cloth, 0, 0);
      return;
    }

    // 2×2 repeat at half scale — the working proof of the seamless claim.
    const w = cloth.width / 2;
    const h = cloth.height / 2;

    context.drawImage(cloth, 0, 0, w, h);
    context.drawImage(cloth, w, 0, w, h);
    context.drawImage(cloth, 0, h, w, h);
    context.drawImage(cloth, w, h, w, h);
  }

  function weave() {
    weaving = true;
    dirty = false;
    setState("weaving", "busy");

    // Let the busy state actually paint before the pixel loop takes the thread.
    window.setTimeout(function () {
      const options = readControls();
      const startedAt = performance.now();
      const texture = pipeline.renderTexture(options);
      const elapsed = performance.now() - startedAt;

      cloth.width = texture.width;
      cloth.height = texture.height;

      const context = cloth.getContext("2d");

      if (!context) {
        weaving = false;
        setState("no canvas", "error");
        setMessage("This browser refused a 2D canvas context, so there is nowhere to weave.", "error");
        return;
      }

      context.putImageData(new ImageData(texture.data, texture.width, texture.height), 0, 0);
      paintCloth();
      paintSwatch();

      weaveCount += 1;
      el.rangeOut.textContent = `${texture.min.toFixed(3)} – ${texture.max.toFixed(3)}`;
      el.passOut.textContent = `${elapsed.toFixed(0)} ms`;
      el.texOut.textContent = `${texture.width} × ${texture.height}`;
      el.weaveOut.textContent = String(weaveCount);
      el.passHud.textContent = `${elapsed.toFixed(0)}ms`;
      showSeed();

      // Do not stamp over a recipe the operator is mid-way through pasting.
      if (document.activeElement !== el.recipe) {
        el.recipe.value = pipeline.makeRecipe(options);
        el.recipe.classList.remove("is-error");
      }

      weaving = false;
      setState("woven");

      if (dirty) schedule();
    }, 16);
  }

  function schedule() {
    if (weaving) {
      dirty = true;
      return;
    }

    weave();
  }

  // ----------------------------------------------------------------- downloads

  function savePng() {
    if (!cloth.width) return;

    cloth.toBlob(function (blob) {
      if (!blob) {
        setMessage("The canvas refused to encode a PNG.", "error");
        return;
      }

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);

      link.href = url;
      link.download = `noise-loom-${el.field.value}-${pipeline.seedToHex(seed)}.png`;
      link.click();

      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);

      setMessage("Saved. The recipe in the thread pod re-weaves this exact texture.");
    }, "image/png");
  }

  function copyRecipe() {
    const recipe = el.recipe.value;

    if (!recipe) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(recipe).then(
        function () {
          setMessage("Recipe copied — paste it back here any time to replay the weave.");
        },
        function () {
          el.recipe.select();
          setMessage("The clipboard refused — the recipe is selected, copy it by hand.", "error");
        },
      );
      return;
    }

    el.recipe.select();
    setMessage("No clipboard API here — the recipe is selected, copy it by hand.", "error");
  }

  // --------------------------------------------------------------------- wiring

  el.controls.addEventListener("input", function (event) {
    if (event.target === el.seed || event.target === el.recipe) return;

    syncLabels();

    // The tile check only re-paints what is already woven.
    if (event.target === el.tile) {
      paintCloth();
      return;
    }

    schedule();
  });

  el.controls.addEventListener("submit", function (event) {
    event.preventDefault(); // the form is a grouping device, it has nowhere to post
  });

  el.seed.addEventListener("input", function () {
    const parsed = pipeline.seedFromHex(el.seed.value);

    el.seed.classList.toggle("is-error", parsed === null);

    if (parsed === null) return;

    seed = parsed;
    el.seedHud.textContent = pipeline.seedToHex(seed);
    schedule();
  });

  el.recipe.addEventListener("input", function () {
    const parsed = pipeline.parseRecipe(el.recipe.value);

    el.recipe.classList.toggle("is-error", parsed === null);

    if (parsed === null) return;

    writeControls(parsed);
    setMessage("Recipe accepted — re-weaving.");
    schedule();
  });

  el.reroll.addEventListener("click", function () {
    seed = rollSeed();
    showSeed();
    schedule();
  });

  el.reset.addEventListener("click", resetControls);
  el.savePng.addEventListener("click", savePng);
  el.recipeCopy.addEventListener("click", copyRecipe);

  el.dye.addEventListener("change", function () {
    applyDye(el.dye.value);
  });

  // ---------------------------------------------------------------------- boot

  restoreDye();
  seed = rollSeed();
  showSeed();
  syncLabels();
  paintSwatch();
  setState("idle");
  schedule();
})();
