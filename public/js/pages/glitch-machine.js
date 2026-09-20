/* Hidden operator page: /operator/tools/glitch-machine
 *
 * Structure-aware databending. A local JPEG (or a PNG/GIF rebaked into one) is
 * mapped into segments, and seeded corruption is written only into the
 * entropy-coded scan data — headers and tables stay intact, so every seed
 * still decodes. No image library, no server round-trip: the file is read with
 * the File API, bent in this tab, and thrown away when the page closes.
 *
 * This file is the deck — file intake, transcoding (the one stage that needs a
 * canvas), controls, telemetry. The corruption itself lives in
 * `glitch-machine-pipeline.js`, which has no DOM in it and is unit-tested
 * directly.
 *
 * The carrier (clean JPEG bytes) and its segment map are cached, so a new seed
 * re-runs only the corruption pass — that is what makes auto-mutate possible.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.GlitchMachinePipeline;

  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif"];
  const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|gif)$/i;
  const MAX_BYTES = 16 * 1024 * 1024;

  // Cap the rebaked raster. A poster-sized PNG would otherwise stall the tab in
  // toBlob, and past this size the glitches read the same anyway.
  const MAX_CARRIER_DIM = 2600;

  // Consecutive decoder rejections before the machine stops rerolling itself.
  const MAX_ERROR_STREAK = 3;

  const AUTO_INTERVAL_MS = 700;

  const SIGNALS = ["vapor", "toxin", "inferno", "void"];
  const SIGNAL_KEY = "glx-signal";

  const DEFAULTS = {
    amount: 35,
    windowFrom: 0,
    windowTo: 100,
    quality: 85,
    ops: { mutate: true, smear: true, stutter: true, swap: true },
  };

  const el = {
    state: document.getElementById("glxState"),
    signal: document.getElementById("glxSignal"),
    drop: document.getElementById("glxDrop"),
    file: document.getElementById("glxFile"),
    message: document.getElementById("glxMessage"),
    fileName: document.getElementById("glxFileName"),
    carrier: document.getElementById("glxCarrier"),
    dims: document.getElementById("glxDims"),
    coding: document.getElementById("glxCoding"),
    scanBytes: document.getElementById("glxScanBytes"),
    quality: document.getElementById("glxQuality"),
    qualityValue: document.getElementById("glxQualityValue"),
    rebake: document.getElementById("glxRebake"),
    controls: document.getElementById("glxControls"),
    amount: document.getElementById("glxAmount"),
    amountValue: document.getElementById("glxAmountValue"),
    windowFrom: document.getElementById("glxWindowFrom"),
    windowFromValue: document.getElementById("glxWindowFromValue"),
    windowTo: document.getElementById("glxWindowTo"),
    windowToValue: document.getElementById("glxWindowToValue"),
    opMutate: document.getElementById("glxOpMutate"),
    opSmear: document.getElementById("glxOpSmear"),
    opStutter: document.getElementById("glxOpStutter"),
    opSwap: document.getElementById("glxOpSwap"),
    reset: document.getElementById("glxReset"),
    seed: document.getElementById("glxSeed"),
    reroll: document.getElementById("glxReroll"),
    auto: document.getElementById("glxAuto"),
    opsOut: document.getElementById("glxOpsOut"),
    writtenOut: document.getElementById("glxWrittenOut"),
    skippedOut: document.getElementById("glxSkippedOut"),
    elapsed: document.getElementById("glxElapsed"),
    compare: document.getElementById("glxCompare"),
    saveJpeg: document.getElementById("glxSaveJpeg"),
    savePng: document.getElementById("glxSavePng"),
    clear: document.getElementById("glxClear"),
    viewport: document.getElementById("glxViewport"),
    output: document.getElementById("glxOutput"),
    empty: document.getElementById("glxEmpty"),
    compareFlag: document.getElementById("glxCompareFlag"),
    seedHud: document.getElementById("glxSeedHud"),
    writesHud: document.getElementById("glxWritesHud"),
  };

  let loaded = null; // { image, name, type, size, width, height } — the decoded original
  let sourceUrl = null; // object URL keeping `loaded.image` alive
  let carrier = null; // Uint8Array — clean JPEG bytes the engine bends
  let carrierUrl = null; // object URL of the clean carrier, for hold-to-compare
  let carrierNote = "";
  let map = null; // pipeline.mapJpeg(carrier)
  let glitched = null; // Uint8Array — the last result, for "save .jpg"
  let glitchedUrl = null;
  let seed = 0;
  let comparing = false;
  let errorStreak = 0;
  let autoTimer = null;

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

  function applySignal(name) {
    const signal = SIGNALS.indexOf(name) === -1 ? SIGNALS[0] : name;

    document.documentElement.setAttribute("data-glx-signal", signal);
    if (el.signal) el.signal.value = signal;

    // Private-mode Safari throws on localStorage; a colour is not worth a crash.
    try {
      window.localStorage.setItem(SIGNAL_KEY, signal);
    } catch (error) {
      /* ignore */
    }
  }

  function restoreSignal() {
    let stored = null;

    try {
      stored = window.localStorage.getItem(SIGNAL_KEY);
    } catch (error) {
      /* ignore */
    }

    applySignal(stored || SIGNALS[0]);
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
    let from = Number(el.windowFrom.value);
    let to = Number(el.windowTo.value);

    if (from > to) {
      const held = from;

      from = to;
      to = held;
    }

    return {
      seed,
      amount: Number(el.amount.value),
      window: { from: from / 100, to: to / 100 },
      ops: {
        mutate: el.opMutate.checked,
        smear: el.opSmear.checked,
        stutter: el.opStutter.checked,
        swap: el.opSwap.checked,
      },
    };
  }

  function syncLabels() {
    el.amountValue.textContent = el.amount.value;
    el.windowFromValue.textContent = `${el.windowFrom.value}%`;
    el.windowToValue.textContent = `${el.windowTo.value}%`;
    el.qualityValue.textContent = `${el.quality.value}%`;
  }

  function anyOpEnabled(controls) {
    return controls.ops.mutate || controls.ops.smear || controls.ops.stutter || controls.ops.swap;
  }

  function resetControls() {
    el.amount.value = String(DEFAULTS.amount);
    el.windowFrom.value = String(DEFAULTS.windowFrom);
    el.windowTo.value = String(DEFAULTS.windowTo);
    el.quality.value = String(DEFAULTS.quality);
    el.opMutate.checked = DEFAULTS.ops.mutate;
    el.opSmear.checked = DEFAULTS.ops.smear;
    el.opStutter.checked = DEFAULTS.ops.stutter;
    el.opSwap.checked = DEFAULTS.ops.swap;

    syncLabels();
    render();
  }

  // ------------------------------------------------------------------ carrier

  function adoptCarrier(bytes, note) {
    carrier = bytes;
    carrierNote = note;
    map = pipeline.mapJpeg(carrier);

    if (carrierUrl) URL.revokeObjectURL(carrierUrl);
    carrierUrl = URL.createObjectURL(new Blob([carrier], { type: "image/jpeg" }));

    if (!map.valid) {
      setState("bad carrier", "error");
      setMessage(map.warnings[0] || "The carrier has no scan data to bend.", "error");
      return false;
    }

    el.carrier.textContent = `${note} · ${formatBytes(carrier.length)}`;
    el.dims.textContent = map.width && map.height ? `${map.width} × ${map.height}` : "—";
    el.coding.textContent = map.coding || "—";
    el.scanBytes.textContent = `${formatBytes(map.scanBytes)} in ${map.scans.length} scan${map.scans.length === 1 ? "" : "s"}`;

    if (map.warnings.length > 0) {
      setMessage(`Carrier mapped with a warning: ${map.warnings[0]}`);
    }

    return true;
  }

  /* Re-encode the decoded original through a canvas at the chosen quality.
   * Rebaking is also useful on native JPEGs: a lower-quality carrier has
   * coarser blocks, and coarse blocks glitch louder. */
  function rebake(onDone) {
    if (!loaded) return;

    const longest = Math.max(loaded.width, loaded.height);
    const ratio = longest > MAX_CARRIER_DIM ? MAX_CARRIER_DIM / longest : 1;
    const width = Math.max(1, Math.round(loaded.width * ratio));
    const height = Math.max(1, Math.round(loaded.height * ratio));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      setState("no canvas", "error");
      setMessage("This browser refused a 2D canvas context, so the file cannot be rebaked.", "error");
      return;
    }

    context.drawImage(loaded.image, 0, 0, width, height);
    setState("rebaking", "busy");

    canvas.toBlob(
      function (blob) {
        if (!blob) {
          setState("rebake failed", "error");
          setMessage("The canvas refused to encode a JPEG.", "error");
          return;
        }

        blob.arrayBuffer().then(function (buffer) {
          const quality = Number(el.quality.value);
          const scaled = ratio < 1 ? `, scaled to ${width}×${height}` : "";

          if (!adoptCarrier(new Uint8Array(buffer), `rebaked JPEG @ ${quality}%${scaled}`)) return;
          if (onDone) onDone();
        });
      },
      "image/jpeg",
      Number(el.quality.value) / 100,
    );
  }

  // -------------------------------------------------------------------- render

  function render() {
    if (!carrier || !map || !map.valid) return;

    const controls = readControls();

    if (!anyOpEnabled(controls)) {
      setState("disarmed");
      setMessage("Every operation is switched off — the machine has nothing to write with.");
      return;
    }

    setState("bending", "busy");

    const startedAt = performance.now();
    const result = pipeline.glitch(carrier, map, controls);
    const elapsed = performance.now() - startedAt;

    glitched = result.bytes;

    if (glitchedUrl) URL.revokeObjectURL(glitchedUrl);
    glitchedUrl = URL.createObjectURL(new Blob([glitched], { type: "image/jpeg" }));

    if (!comparing) el.output.src = glitchedUrl;

    el.output.hidden = false;
    el.empty.hidden = true;
    el.viewport.classList.add("has-image");

    el.opsOut.textContent = `${result.opsTotal} (m${result.ops.mutate} · sm${result.ops.smear} · st${result.ops.stutter} · sw${result.ops.swap})`;
    el.writtenOut.textContent = String(result.written);
    el.skippedOut.textContent = String(result.skipped);
    el.elapsed.textContent = `${elapsed.toFixed(1)} ms`;
    el.writesHud.textContent = String(result.written);
    showSeed();
  }

  function outputDecoded() {
    errorStreak = 0;
    if (!comparing) setState("armed");
  }

  /* The invariants should make this unreachable, but a decoder is allowed to
   * be stricter than the spec — so a refused seed rolls again, a few times. */
  function outputRefused() {
    if (!glitchedUrl || el.output.src !== glitchedUrl) return;

    errorStreak += 1;

    if (errorStreak >= MAX_ERROR_STREAK) {
      setState("decoder revolt", "error");
      setMessage("Three seeds in a row failed to decode. Ease the intensity or rebake the carrier.", "error");
      stopAuto();
      return;
    }

    setMessage(`The decoder refused seed ${pipeline.seedToHex(seed)} — rolling again.`);
    seed = rollSeed();
    render();
  }

  // ----------------------------------------------------------------- auto-mutate

  function stopAuto() {
    if (autoTimer !== null) {
      window.clearInterval(autoTimer);
      autoTimer = null;
    }

    el.auto.checked = false;
    el.viewport.classList.remove("is-auto");
  }

  function startAuto() {
    if (!carrier || autoTimer !== null) return;

    el.viewport.classList.add("is-auto");
    autoTimer = window.setInterval(function () {
      if (document.hidden || comparing) return;

      seed = rollSeed();
      render();
    }, AUTO_INTERVAL_MS);
  }

  // ------------------------------------------------------------------- compare

  function showOriginal() {
    if (!carrierUrl || comparing) return;

    comparing = true;
    el.compareFlag.hidden = false;
    el.output.src = carrierUrl;
    setState("original", "busy");
  }

  function hideOriginal() {
    if (!comparing) return;

    comparing = false;
    el.compareFlag.hidden = true;

    if (glitchedUrl) el.output.src = glitchedUrl;
    setState("armed");
  }

  // ------------------------------------------------------------------ downloads

  function baseName() {
    return (loaded && loaded.name.replace(/\.[^.]+$/, "")) || "image";
  }

  function saveJpeg() {
    if (!glitched) return;

    const link = document.createElement("a");

    link.href = glitchedUrl;
    link.download = `${baseName()}-glitched-${pipeline.seedToHex(seed)}.jpg`;
    link.click();

    setMessage("Saved the bent bytes themselves — reopening the file replays this exact decode.");
  }

  /* Bake what the decoder made of the bent bytes into pixels. Useful because
   * two decoders may disagree about a glitched scan; a PNG pins this one. */
  function savePng() {
    if (!glitched || !el.output.naturalWidth) return;

    const canvas = document.createElement("canvas");

    canvas.width = el.output.naturalWidth;
    canvas.height = el.output.naturalHeight;

    const context = canvas.getContext("2d");

    if (!context) return;

    context.drawImage(el.output, 0, 0);

    const link = document.createElement("a");

    link.href = canvas.toDataURL("image/png");
    link.download = `${baseName()}-glitched-${pipeline.seedToHex(seed)}.png`;
    link.click();

    setMessage("Saved this browser's decode as a PNG.");
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

  function enableDeck() {
    el.compare.disabled = false;
    el.saveJpeg.disabled = false;
    el.savePng.disabled = false;
    el.clear.disabled = false;
    el.reroll.disabled = false;
    el.rebake.disabled = false;
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

    setState("feeding", "busy");
    setMessage("Reading…");
    stopAuto();

    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = function () {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = url;

      loaded = {
        image,
        name: file.name || "(unnamed)",
        type: file.type || "image/*",
        size: file.size,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };

      el.fileName.textContent = `${loaded.name} · ${formatBytes(file.size)}`;
      seed = rollSeed();
      errorStreak = 0;
      comparing = false;
      el.compareFlag.hidden = true;

      const arm = function () {
        enableDeck();
        setMessage(file.type === "image/gif" ? "GIF rebaked — first frame only." : "");
        render();
      };

      // A native JPEG is bent as-is: its own compression is the canvas. PNG
      // and GIF have no entropy-coded scan to corrupt, so they are rebaked.
      if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name || "")) {
        file.arrayBuffer().then(function (buffer) {
          const bytes = new Uint8Array(buffer);

          if (pipeline.detectFormat(bytes) === "jpeg") {
            if (!adoptCarrier(bytes, "native JPEG")) return;
            arm();
            return;
          }

          // Mislabelled type — rebake whatever the browser decoded.
          rebake(arm);
        });
        return;
      }

      rebake(arm);
    };

    image.onerror = function () {
      URL.revokeObjectURL(url);
      reject("That file could not be decoded as an image.");
    };

    image.src = url;
  }

  function eject() {
    stopAuto();

    [sourceUrl, carrierUrl, glitchedUrl].forEach(function (url) {
      if (url) URL.revokeObjectURL(url);
    });

    sourceUrl = null;
    carrierUrl = null;
    glitchedUrl = null;
    loaded = null;
    carrier = null;
    map = null;
    glitched = null;
    comparing = false;
    errorStreak = 0;

    el.file.value = "";
    el.output.hidden = true;
    el.output.removeAttribute("src");
    el.empty.hidden = false;
    el.viewport.classList.remove("has-image");
    el.compareFlag.hidden = true;

    el.compare.disabled = true;
    el.saveJpeg.disabled = true;
    el.savePng.disabled = true;
    el.clear.disabled = true;
    el.reroll.disabled = true;
    el.rebake.disabled = true;

    ["fileName", "carrier", "dims", "coding", "scanBytes", "opsOut", "writtenOut", "skippedOut", "elapsed"].forEach(
      function (key) {
        el[key].textContent = "—";
      },
    );

    el.seed.value = "";
    el.seedHud.textContent = "--------";
    el.writesHud.textContent = "0";

    setMessage("");
    setState("offline");
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
    if (event.target === el.seed) return; // the seed field has its own handler

    // Keep the window a window: dragging one end past the other pushes it.
    if (event.target === el.windowFrom && Number(el.windowFrom.value) > Number(el.windowTo.value)) {
      el.windowTo.value = el.windowFrom.value;
    }

    if (event.target === el.windowTo && Number(el.windowTo.value) < Number(el.windowFrom.value)) {
      el.windowFrom.value = el.windowTo.value;
    }

    syncLabels();

    if (event.target !== el.quality) render();
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
    render();
  });

  el.reroll.addEventListener("click", function () {
    seed = rollSeed();
    errorStreak = 0;
    render();
  });

  el.auto.addEventListener("change", function () {
    if (el.auto.checked) {
      startAuto();
    } else {
      stopAuto();
    }
  });

  el.rebake.addEventListener("click", function () {
    rebake(render);
  });

  el.reset.addEventListener("click", resetControls);
  el.clear.addEventListener("click", eject);
  el.saveJpeg.addEventListener("click", saveJpeg);
  el.savePng.addEventListener("click", savePng);

  el.output.addEventListener("load", outputDecoded);
  el.output.addEventListener("error", outputRefused);

  ["mousedown", "touchstart"].forEach(function (name) {
    el.compare.addEventListener(name, function (event) {
      event.preventDefault();
      showOriginal();
    });
  });

  ["mouseup", "mouseleave", "touchend", "touchcancel", "blur"].forEach(function (name) {
    el.compare.addEventListener(name, hideOriginal);
  });

  // Keyboard equivalent of the hold gesture.
  el.compare.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    showOriginal();
  });

  el.compare.addEventListener("keyup", hideOriginal);

  el.signal.addEventListener("change", function () {
    applySignal(el.signal.value);
  });

  restoreSignal();
  syncLabels();
  setState("offline");
})();
