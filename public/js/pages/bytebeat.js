/* Hidden operator page: /operator/tools/bytebeat
 *
 * One-line music machine. A formula of `t` is compiled by our own tokenizer
 * and parser — never eval() — and evaluated once per sample, live into
 * WebAudio and offline into a hand-written WAV. Nothing is uploaded and
 * nothing is fetched: the whole synthesizer is this tab.
 *
 * This file is the console — the transport, the scope, the export deck. The
 * compiler and the WAV writer live in `bytebeat-pipeline.js`, which has no
 * DOM in it and is unit-tested directly.
 *
 * Live playback resamples by sample-and-hold: the formula runs at its own
 * rate (8000 Hz for the classics) while the AudioContext runs at whatever the
 * hardware wants, and t only advances when a whole formula-sample has passed.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.BytebeatPipeline;

  const TUBES = ["phosphor", "amber", "ice", "violet"];
  const TUBE_KEY = "btb-tube";

  const SCOPE_SAMPLES = 2048;
  const SCOPE_WIDTH = 960;
  const SCOPE_HEIGHT = 320;
  const PROCESSOR_SIZE = 4096;

  const DEFAULTS = { volume: 60, mode: "byte", duration: 10, bits: 8 };

  const el = {
    state: document.getElementById("btbState"),
    tube: document.getElementById("btbTube"),
    message: document.getElementById("btbMessage"),
    viewport: document.getElementById("btbViewport"),
    scope: document.getElementById("btbScope"),
    tHud: document.getElementById("btbTHud"),
    secHud: document.getElementById("btbSecHud"),
    controls: document.getElementById("btbControls"),
    formula: document.getElementById("btbFormula"),
    error: document.getElementById("btbError"),
    preset: document.getElementById("btbPreset"),
    rate: document.getElementById("btbRate"),
    mode: document.getElementById("btbMode"),
    volume: document.getElementById("btbVolume"),
    volumeValue: document.getElementById("btbVolumeValue"),
    play: document.getElementById("btbPlay"),
    rewind: document.getElementById("btbRewind"),
    duration: document.getElementById("btbDuration"),
    bits: document.getElementById("btbBits"),
    saveWav: document.getElementById("btbSaveWav"),
    reset: document.getElementById("btbReset"),
    rangeOut: document.getElementById("btbRangeOut"),
    clipOut: document.getElementById("btbClipOut"),
    wavOut: document.getElementById("btbWavOut"),
  };

  let fn = null; // the compiled formula — the only code the formula ever becomes
  let playing = false;
  let phase = 0; // fractional t; Math.floor(phase) is the current sample index
  let lastT = -1;
  let lastValue = 0;
  let audio = null; // { context, processor }
  let ring = new Float32Array(SCOPE_SAMPLES);
  let ringAt = 0;
  let rafHandle = null;
  let scopeColor = "51, 255, 128";
  let scopeDim = "51, 255, 128";

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

  function applyTube(name) {
    const tube = TUBES.indexOf(name) === -1 ? TUBES[0] : name;

    document.documentElement.setAttribute("data-btb-tube", tube);
    if (el.tube) el.tube.value = tube;

    // The scope canvas cannot read CSS variables directly — cache them here.
    const styles = getComputedStyle(document.documentElement);

    scopeColor = (styles.getPropertyValue("--btb-a-rgb") || "51 255 128").trim().split(/\s+/).join(", ");
    scopeDim = (styles.getPropertyValue("--btb-b-rgb") || scopeColor).trim().split(/\s+/).join(", ");

    // Private-mode Safari throws on localStorage; a colour is not worth a crash.
    try {
      window.localStorage.setItem(TUBE_KEY, tube);
    } catch (error) {
      /* ignore */
    }

    drawScope();
  }

  function restoreTube() {
    let stored = null;

    try {
      stored = window.localStorage.getItem(TUBE_KEY);
    } catch (error) {
      /* ignore */
    }

    applyTube(stored || TUBES[0]);
  }

  // --------------------------------------------------------------------- scope

  function drawScope() {
    const context = el.scope.getContext("2d");

    if (!context) return;

    context.fillStyle = "rgb(2 4 3)";
    context.fillRect(0, 0, SCOPE_WIDTH, SCOPE_HEIGHT);

    // Graticule.
    context.strokeStyle = `rgba(${scopeDim}, 0.12)`;
    context.lineWidth = 1;
    context.beginPath();

    for (let x = 0; x <= SCOPE_WIDTH; x += SCOPE_WIDTH / 8) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, SCOPE_HEIGHT);
    }

    for (let y = 0; y <= SCOPE_HEIGHT; y += SCOPE_HEIGHT / 4) {
      context.moveTo(0, y + 0.5);
      context.lineTo(SCOPE_WIDTH, y + 0.5);
    }

    context.stroke();

    // Centre line, slightly brighter.
    context.strokeStyle = `rgba(${scopeDim}, 0.3)`;
    context.beginPath();
    context.moveTo(0, SCOPE_HEIGHT / 2 + 0.5);
    context.lineTo(SCOPE_WIDTH, SCOPE_HEIGHT / 2 + 0.5);
    context.stroke();

    // The trace, oldest sample first.
    context.strokeStyle = `rgba(${scopeColor}, 0.9)`;
    context.shadowColor = `rgba(${scopeColor}, 0.7)`;
    context.shadowBlur = 6;
    context.lineWidth = 1.6;
    context.beginPath();

    for (let x = 0; x < SCOPE_WIDTH; x += 1) {
      const index = (ringAt + Math.floor((x / SCOPE_WIDTH) * SCOPE_SAMPLES)) % SCOPE_SAMPLES;
      const value = ring[index];
      const y = (1 - (value + 1) / 2) * (SCOPE_HEIGHT - 8) + 4;

      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.stroke();
    context.shadowBlur = 0;
  }

  function updateHud() {
    const t = Math.floor(phase);
    const rate = Number(el.rate.value);

    el.tHud.textContent = String(t);
    el.secHud.textContent = `${(t / rate).toFixed(1)}s`;
  }

  function frame() {
    rafHandle = null;

    if (!playing) return;

    drawScope();
    updateHud();
    rafHandle = window.requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------- compile

  function recompile() {
    const result = pipeline.compile(el.formula.value);

    el.formula.classList.toggle("is-error", !result.ok);

    if (!result.ok) {
      el.error.textContent = `char ${result.error.at + 1}: ${result.error.message}`;
      el.error.hidden = false;
      setState("parse error", "error");
      return false;
    }

    fn = result.fn;
    el.error.hidden = true;
    el.error.textContent = "";
    setState(playing ? "playing" : "holding");

    if (!playing) previewScope();

    return true;
  }

  /* When the transport is stopped, the scope still shows the truth: the next
   * SCOPE_SAMPLES samples from the current t, rendered offline. */
  function previewScope() {
    if (!fn) return;

    const rendered = pipeline.renderSamples(fn, {
      from: Math.floor(phase),
      count: SCOPE_SAMPLES,
      mode: el.mode.value,
    });

    ring = rendered.samples;
    ringAt = 0;
    lastT = -1;

    el.rangeOut.textContent = `${rendered.min.toFixed(2)} – ${rendered.max.toFixed(2)}`;
    el.clipOut.textContent = el.mode.value === "float" ? `${((rendered.clipped / SCOPE_SAMPLES) * 100).toFixed(1)}%` : "n/a";

    drawScope();
    updateHud();
  }

  // --------------------------------------------------------------------- audio

  function ensureAudio() {
    if (audio) return true;

    const Context = window.AudioContext || window.webkitAudioContext;

    if (!Context) {
      setState("no audio", "error");
      setMessage("This browser has no AudioContext — the console can still export WAVs.", "error");
      return false;
    }

    const context = new Context();
    const processor = context.createScriptProcessor(PROCESSOR_SIZE, 1, 1);

    processor.onaudioprocess = function (event) {
      const out = event.outputBuffer.getChannelData(0);

      if (!playing || !fn) {
        out.fill(0);
        return;
      }

      const step = Number(el.rate.value) / context.sampleRate;
      const volume = Number(el.volume.value) / 100;
      const mode = el.mode.value;

      for (let i = 0; i < out.length; i += 1) {
        const t = Math.floor(phase);

        // Sample-and-hold: the formula only runs when t actually advances.
        if (t !== lastT) {
          lastT = t;
          lastValue = pipeline.toFloat(fn(t), mode);
        }

        out[i] = lastValue * volume;
        ring[ringAt] = lastValue;
        ringAt = (ringAt + 1) % SCOPE_SAMPLES;
        phase += step;
      }
    };

    processor.connect(context.destination);
    audio = { context, processor };

    return true;
  }

  function startPlayback() {
    if (!fn && !recompile()) return;
    if (!ensureAudio()) return;

    audio.context.resume().catch(function () {
      /* an already-running context rejects resume in some browsers — ignore */
    });

    playing = true;
    el.play.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i> Stop';
    el.viewport.classList.add("is-live");
    setState("playing");
    setMessage("");

    if (rafHandle === null) rafHandle = window.requestAnimationFrame(frame);
  }

  function stopPlayback() {
    playing = false;
    el.play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Play';
    el.viewport.classList.remove("is-live");
    setState(fn ? "holding" : "parse error", fn ? undefined : "error");
    previewScope();
  }

  // -------------------------------------------------------------------- export

  function wavByteEstimate() {
    const rate = Number(el.rate.value);
    const seconds = Math.max(1, Math.min(pipeline.MAX_RENDER_SECONDS, Number(el.duration.value) || 1));
    const bytesPerSample = Number(el.bits.value) / 8;

    return 44 + Math.floor(rate * seconds) * bytesPerSample;
  }

  function updateWavEstimate() {
    el.wavOut.textContent = formatBytes(wavByteEstimate());
  }

  function saveWav() {
    if (!fn && !recompile()) {
      setMessage("Fix the formula first — there is nothing to render.", "error");
      return;
    }

    const rate = Number(el.rate.value);
    const seconds = Math.max(1, Math.min(pipeline.MAX_RENDER_SECONDS, Number(el.duration.value) || 1));

    setState("rendering", "busy");

    // Let the busy state paint before the sample loop takes the thread.
    window.setTimeout(function () {
      const rendered = pipeline.renderSamples(fn, { from: 0, count: Math.floor(rate * seconds), mode: el.mode.value });
      const wav = pipeline.makeWav(rendered.samples, { rate, bits: Number(el.bits.value) });
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `bytebeat-${rate}hz-${seconds}s.wav`;
      link.click();

      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);

      setState(playing ? "playing" : "holding");
      setMessage(`Rendered ${seconds}s from t=0 — ${formatBytes(wav.length)} of hand-written RIFF.`);
    }, 16);
  }

  // ------------------------------------------------------------------- presets

  function loadPreset(index) {
    const preset = pipeline.PRESETS[index];

    if (!preset) return;

    el.formula.value = preset.source;
    el.rate.value = String(preset.rate);
    phase = 0;
    lastT = -1;
    recompile();
    updateWavEstimate();
  }

  function fillPresets() {
    pipeline.PRESETS.forEach(function (preset, index) {
      const option = document.createElement("option");

      option.value = String(index);
      option.textContent = `${preset.name} @ ${preset.rate} Hz`;
      el.preset.appendChild(option);
    });
  }

  function resetConsole() {
    el.volume.value = String(DEFAULTS.volume);
    el.mode.value = DEFAULTS.mode;
    el.duration.value = String(DEFAULTS.duration);
    el.bits.value = String(DEFAULTS.bits);
    el.preset.value = "0";
    syncLabels();
    loadPreset(0);
    setMessage("");
  }

  function syncLabels() {
    el.volumeValue.textContent = `${el.volume.value}%`;
  }

  // --------------------------------------------------------------------- wiring

  el.formula.addEventListener("input", function () {
    el.preset.value = ""; // an edited formula is nobody's preset any more
    recompile();
  });

  el.preset.addEventListener("change", function () {
    if (el.preset.value === "") return;

    loadPreset(Number(el.preset.value));
    setMessage("");
  });

  el.controls.addEventListener("input", function (event) {
    if (event.target === el.formula) return;

    syncLabels();

    if (event.target === el.duration || event.target === el.bits || event.target === el.rate) {
      updateWavEstimate();
    }

    if ((event.target === el.mode || event.target === el.rate) && !playing) {
      previewScope();
    }
  });

  el.controls.addEventListener("submit", function (event) {
    event.preventDefault(); // the form is a grouping device, it has nowhere to post
  });

  el.play.addEventListener("click", function () {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  el.rewind.addEventListener("click", function () {
    phase = 0;
    lastT = -1;

    if (!playing) previewScope();

    updateHud();
  });

  el.saveWav.addEventListener("click", saveWav);
  el.reset.addEventListener("click", resetConsole);

  el.tube.addEventListener("change", function () {
    applyTube(el.tube.value);
  });

  // ---------------------------------------------------------------------- boot

  restoreTube();
  fillPresets();
  el.preset.value = "0";
  syncLabels();
  loadPreset(0);
  updateWavEstimate();
  setState("holding");
})();
