/* Hidden operator page: /operator/tools/spectrogram-bench
 *
 * Takes a local WAV or MP3, or a synthesised test signal, and draws the
 * frequencies inside it. No audio library: both containers are walked by hand
 * and the transform is a hand-written FFT, all in
 * `spectrogram-bench-pipeline.js` — which has no DOM in it and is unit-tested
 * directly.
 *
 * One deliberate exception, and it is worth stating plainly rather than hiding
 * in a helper: **WAV samples are unpacked by us, MP3 samples are not.** Layer III
 * decoding needs 34 Huffman tables, a bit reservoir, an IMDCT and a synthesis
 * filterbank, so `decodeCompressed` hands that one job to the browser's codec —
 * the same bargain the Pixelizer strikes when it lets `drawImage` decode a JPEG.
 * The MP3 *container* is still read here, and every measurement downstream is
 * ours either way. The "Samples via" readout says which path a file took.
 *
 * What else stays here is the work that needs a document:
 *
 *   - painting the magnitudes into an ImageData through a colour ramp
 *   - the axes, crosshair and playhead, on a second canvas at screen resolution
 *   - playback through WebAudio, so you can hear the thing you are looking at
 *   - the PNG export
 *
 * Two canvases, on purpose. The spectrogram canvas is `columns × ROWS` — one
 * pixel per analysis frame — and CSS stretches it to fit. The overlay is sized
 * in real screen pixels, so its text stays crisp and its coordinates are the
 * ones the pointer arrives in. `xToColumn` and `yToBin` are the only bridge
 * between the two systems.
 *
 * Changing the ramp, floor, gain or axis repaints from the cached magnitudes;
 * only FFT size, window, overlap and channel re-run the transform. That split is
 * why dragging the floor slider is instant on a two-minute file.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.SpectrogramBenchPipeline;

  const ACCEPTED_TYPES = ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/mpeg", "audio/mp3", "audio/x-mpeg"];
  const ACCEPTED_EXTENSIONS = /\.(wav|mp3)$/i;

  const MAX_BYTES = 64 * 1024 * 1024;
  // Two minutes of stereo float is already ~40 MB of Float32Array; past that the
  // tab is paying for detail nobody scrolls to. For an MP3 this is enforced
  // *before* decoding, by cutting the frame stream — see `loadMp3`.
  const MAX_SECONDS = 120;

  const ROWS = 512; // vertical resolution of the painted spectrogram
  const SIGNAL_RATE = 44100;

  const THEMES = ["cyan", "amber", "lime", "magenta", "ice"];
  const THEME_KEY = "spb-theme";

  const LOG_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const TIME_STEPS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60];

  const el = {
    state: document.getElementById("spbState"),
    theme: document.getElementById("spbTheme"),
    drop: document.getElementById("spbDrop"),
    file: document.getElementById("spbFile"),
    message: document.getElementById("spbMessage"),
    fileName: document.getElementById("spbFileName"),
    format: document.getElementById("spbFormat"),
    decoder: document.getElementById("spbDecoder"),
    rate: document.getElementById("spbRate"),
    channels: document.getElementById("spbChannels"),
    duration: document.getElementById("spbDuration"),
    samples: document.getElementById("spbSamples"),
    savePng: document.getElementById("spbSavePng"),
    clear: document.getElementById("spbClear"),
    geometry: document.getElementById("spbGeometry"),
    wave: document.getElementById("spbWave"),
    viewport: document.getElementById("spbViewport"),
    canvas: document.getElementById("spbCanvas"),
    overlay: document.getElementById("spbOverlay"),
    empty: document.getElementById("spbEmpty"),
    cursorTime: document.getElementById("spbCursorTime"),
    cursorHz: document.getElementById("spbCursorHz"),
    cursorNote: document.getElementById("spbCursorNote"),
    cursorDb: document.getElementById("spbCursorDb"),
    play: document.getElementById("spbPlay"),
    playLabel: document.getElementById("spbPlayLabel"),
    stop: document.getElementById("spbStop"),
    clock: document.getElementById("spbClock"),
    volume: document.getElementById("spbVolume"),
    volumeValue: document.getElementById("spbVolumeValue"),
    legend: document.getElementById("spbLegend"),
    legendMin: document.getElementById("spbLegendMin"),
    legendMax: document.getElementById("spbLegendMax"),
    controls: document.getElementById("spbControls"),
    fftSize: document.getElementById("spbFftSize"),
    window: document.getElementById("spbWindow"),
    overlap: document.getElementById("spbOverlap"),
    overlapValue: document.getElementById("spbOverlapValue"),
    channel: document.getElementById("spbChannel"),
    ramp: document.getElementById("spbRamp"),
    floor: document.getElementById("spbFloor"),
    floorValue: document.getElementById("spbFloorValue"),
    gain: document.getElementById("spbGain"),
    gainValue: document.getElementById("spbGainValue"),
    logScale: document.getElementById("spbLogScale"),
    gridLines: document.getElementById("spbGridLines"),
    signal: document.getElementById("spbSignal"),
    seconds: document.getElementById("spbSeconds"),
    secondsValue: document.getElementById("spbSecondsValue"),
    loadSignal: document.getElementById("spbLoadSignal"),
    peak: document.getElementById("spbPeak"),
    rms: document.getElementById("spbRms"),
    crest: document.getElementById("spbCrest"),
    dc: document.getElementById("spbDc"),
    clipped: document.getElementById("spbClipped"),
    dominant: document.getElementById("spbDominant"),
    note: document.getElementById("spbNote"),
    binHz: document.getElementById("spbBinHz"),
    hop: document.getElementById("spbHop"),
    elapsed: document.getElementById("spbElapsed"),
    chunks: document.getElementById("spbChunks"),
    chunksEmpty: document.getElementById("spbChunksEmpty"),
    chunksTag: document.getElementById("spbChunksTag"),
    info: document.getElementById("spbInfo"),
    warnings: document.getElementById("spbWarnings"),
  };

  // The decoded signal survives until a new one is loaded, so a control change
  // never re-reads the file.
  let source = null; // { label, kind, channels, sampleRate, frames, parsed }
  let picture = null; // spectrogram result, cached for repaints
  let rowMap = null; // row -> bin, for the current axis
  let rampTable = pipeline.rampTable("abyss");
  let plans = {}; // FFT plans by size, reused across analyses

  let audioContext = null;
  let audioBuffer = null;
  let audioNode = null;
  let gainNode = null;
  let playing = false;
  let playOffset = 0;
  let playStartedAt = 0;
  let frameRequest = null;
  let pointer = null; // { x, y } in overlay CSS pixels

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

  function applyTheme(name) {
    const theme = THEMES.indexOf(name) === -1 ? THEMES[0] : name;

    document.documentElement.setAttribute("data-spb-theme", theme);
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

  // ---------------------------------------------------------------- DOM helpers

  function node(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);

    return element;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function readoutRow(label, value) {
    const row = node("div", "spb-readout__row");

    row.appendChild(node("dt", null, label));
    row.appendChild(node("dd", null, value));

    return row;
  }

  function formatHz(hz) {
    if (!isFinite(hz)) return "—";
    if (hz >= 10000) return `${(hz / 1000).toFixed(1)} kHz`;
    if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
    if (hz >= 100) return `${hz.toFixed(0)} Hz`;

    return `${hz.toFixed(1)} Hz`;
  }

  function tickLabel(hz) {
    return hz >= 1000 ? `${hz / 1000}k` : String(hz);
  }

  function formatDb(db) {
    if (!isFinite(db) || db <= -239) return "−∞ dB";

    return `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
  }

  function signed(value, unit) {
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}${unit}`;
  }

  // ------------------------------------------------------------------ controls

  function readControls() {
    return {
      size: Number(el.fftSize.value),
      window: el.window.value,
      overlap: Number(el.overlap.value) / 100,
      channel: el.channel.value,
      ramp: el.ramp.value,
      floor: Number(el.floor.value),
      gain: Number(el.gain.value),
      logarithmic: el.logScale.checked,
      axes: el.gridLines.checked,
      seconds: Number(el.seconds.value),
    };
  }

  function syncLabels(controls) {
    el.overlapValue.textContent = `${Math.round(controls.overlap * 100)}%`;
    el.floorValue.textContent = `${controls.floor} dB`;
    el.gainValue.textContent = signed(controls.gain, " dB");
    el.secondsValue.textContent = `${controls.seconds.toFixed(1)} s`;
    el.legendMin.textContent = `${controls.floor} dB`;
  }

  /* Rebuild the channel list for the loaded signal, keeping "mix" selected
   * unless the previous choice still exists. */
  function syncChannelOptions() {
    const previous = el.channel.value;

    clear(el.channel);
    el.channel.appendChild(new Option("Mix to mono", "mix"));

    if (source) {
      const names = source.channels.length === 2 ? ["Left", "Right"] : null;

      for (let c = 0; c < source.channels.length; c += 1) {
        el.channel.appendChild(new Option(names ? names[c] : `Channel ${c + 1}`, String(c)));
      }
    }

    el.channel.value = [...el.channel.options].some((option) => option.value === previous) ? previous : "mix";
  }

  // ------------------------------------------------------------------- analysis

  function selectedSamples(controls) {
    if (!source) return new Float32Array(0);
    if (controls.channel === "mix") return pipeline.mixToMono(source.channels);

    const index = Number(controls.channel);

    return source.channels[index] || source.channels[0];
  }

  function planFor(size) {
    if (!plans[size]) plans[size] = pipeline.makePlan(size);

    return plans[size];
  }

  function analyse() {
    if (!source) return;

    const controls = readControls();
    const samples = selectedSamples(controls);
    const startedAt = performance.now();

    picture = pipeline.spectrogram(samples, source.sampleRate, {
      size: controls.size,
      window: controls.window,
      overlap: controls.overlap,
      plan: planFor(controls.size),
      maxColumns: pipeline.DEFAULT_COLUMNS,
    });

    const stats = pipeline.measure(samples);
    const elapsed = performance.now() - startedAt;
    const dominant = pipeline.dominantFrequency(picture);
    const note = pipeline.noteForHz(dominant);

    el.peak.textContent = formatDb(stats.peakDb);
    el.rms.textContent = formatDb(stats.rmsDb);
    el.crest.textContent = `${stats.crestDb.toFixed(1)} dB`;
    el.dc.textContent = stats.dcOffset.toFixed(4);
    el.clipped.textContent = stats.clipped ? `${stats.clipped} samples` : "none";
    el.dominant.textContent = formatHz(dominant);
    el.note.textContent = note ? `${note.name} ${signed(note.cents, "¢")}` : "—";
    el.binHz.textContent = `${picture.binHz.toFixed(2)} Hz`;
    el.hop.textContent = `${picture.hop} sp · ${(picture.hopSeconds * 1000).toFixed(1)} ms`;
    el.elapsed.textContent = `${elapsed.toFixed(0)} ms`;

    el.geometry.textContent = `${picture.columns} × ${picture.bins} · ${picture.size}-point`;
    el.viewport.classList.add("has-image");
    el.empty.hidden = true;

    paint(controls);
    drawWaveform(samples);
    setState("ready");
  }

  // -------------------------------------------------------------------- painting

  /* Magnitudes into pixels.
   *
   * One pixel per column per row, straight into an ImageData: at 1200 columns
   * and 512 rows that is 614k pixels, and anything less direct (a fill per cell,
   * a gradient per column) is visibly slower. */
  function paint(controls) {
    if (!picture) return;

    el.canvas.width = picture.columns;
    el.canvas.height = ROWS;

    const context = el.canvas.getContext("2d", { willReadFrequently: false });

    if (!context) {
      setState("no canvas", "error");
      setMessage("This browser refused a 2D canvas context, so the spectrogram cannot be drawn.", "error");
      return;
    }

    rowMap = pipeline.scaleRows(ROWS, picture.bins, picture.size, picture.sampleRate, controls.logarithmic);

    const image = context.createImageData(picture.columns, ROWS);
    const pixels = image.data;
    const span = Math.max(1, -controls.floor); // floor is negative; 0 dB is the top
    const magnitudes = picture.magnitudes;
    const bins = picture.bins;
    let at = 0;

    for (let row = 0; row < ROWS; row += 1) {
      const bin = Math.round(rowMap[row]);

      for (let column = 0; column < picture.columns; column += 1) {
        const db = magnitudes[column * bins + bin] + controls.gain;
        // Normalise the visible window (floor .. 0 dB) onto the 256-entry ramp.
        let level = ((db - controls.floor) / span) * 255;

        if (level < 0) level = 0;
        else if (level > 255) level = 255;

        const stop = (level | 0) * 3;

        pixels[at] = rampTable[stop];
        pixels[at + 1] = rampTable[stop + 1];
        pixels[at + 2] = rampTable[stop + 2];
        pixels[at + 3] = 255;
        at += 4;
      }
    }

    context.putImageData(image, 0, 0);
    drawLegend(controls);
    resizeOverlay();
  }

  function drawWaveform(samples) {
    const canvas = el.wave;
    const context = canvas.getContext("2d");

    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    const envelope = pipeline.waveformEnvelope(samples, width);
    const middle = height / 2;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--spb-accent").trim() || "#4ff5ff";

    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,0.10)";
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();

    context.fillStyle = accent;

    for (let x = 0; x < envelope.buckets; x += 1) {
      const top = middle - envelope.max[x] * middle;
      const bottom = middle - envelope.min[x] * middle;

      // Always at least a pixel: a silent bucket should still draw the axis.
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }

  function drawLegend(controls) {
    const context = el.legend.getContext("2d");

    if (!context) return;

    const width = el.legend.width;
    const height = el.legend.height;
    const image = context.createImageData(width, height);

    for (let x = 0; x < width; x += 1) {
      const stop = Math.min(255, Math.round((x / (width - 1)) * 255)) * 3;

      for (let y = 0; y < height; y += 1) {
        const at = (y * width + x) * 4;

        image.data[at] = rampTable[stop];
        image.data[at + 1] = rampTable[stop + 1];
        image.data[at + 2] = rampTable[stop + 2];
        image.data[at + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    el.legendMin.textContent = `${controls.floor} dB`;
  }

  // --------------------------------------------------------- overlay and axes

  /* The overlay is sized in real device pixels so its text is not stretched by
   * the CSS scaling that the spectrogram canvas below it relies on. */
  function resizeOverlay() {
    const rect = el.canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const ratio = window.devicePixelRatio || 1;

    el.overlay.width = Math.round(rect.width * ratio);
    el.overlay.height = Math.round(rect.height * ratio);
    el.overlay.style.width = `${rect.width}px`;
    el.overlay.style.height = `${rect.height}px`;

    drawOverlay();
  }

  function overlaySize() {
    const ratio = window.devicePixelRatio || 1;

    return { width: el.overlay.width / ratio, height: el.overlay.height / ratio, ratio };
  }

  /* Screen x to analysis column, and back. Column centres are half a frame in
   * from the start of their samples, which is what makes a click seek to the
   * sound you clicked on rather than to a frame boundary. */
  function xToColumn(x, width) {
    if (!picture || picture.columns < 2) return 0;

    const fraction = Math.max(0, Math.min(1, x / width));

    return Math.round(fraction * (picture.columns - 1));
  }

  function columnToSeconds(column) {
    if (!picture) return 0;

    return (column * picture.hop + picture.size / 2) / picture.sampleRate;
  }

  function secondsToX(seconds, width) {
    if (!picture || picture.columns < 2) return 0;

    const column = (seconds * picture.sampleRate - picture.size / 2) / picture.hop;

    return (Math.max(0, Math.min(picture.columns - 1, column)) / (picture.columns - 1)) * width;
  }

  function yToBin(y, height) {
    if (!picture || !rowMap) return 0;

    const row = Math.max(0, Math.min(ROWS - 1, Math.round((y / height) * (ROWS - 1))));

    return rowMap[row];
  }

  function hzToY(hz, height) {
    if (!picture) return 0;

    const bounds = pipeline.axisBounds(picture.sampleRate);
    const fraction = pipeline.axisFraction(hz, bounds, el.logScale.checked);

    return (1 - fraction) * height;
  }

  function drawAxes(context, width, height) {
    if (!picture) return;

    const nyquist = picture.sampleRate / 2;
    const logarithmic = el.logScale.checked;

    context.save();
    context.font = "10px 'SF Mono', 'Cascadia Mono', Consolas, monospace";
    context.textBaseline = "middle";
    context.lineWidth = 1;

    const ticks = logarithmic
      ? LOG_TICKS.filter((hz) => hz < nyquist)
      : [1, 2, 3, 4, 5, 6, 7].map((step) => Math.round((nyquist * step) / 8));

    for (const hz of ticks) {
      const y = Math.round(hzToY(hz, height)) + 0.5;

      if (y < 8 || y > height - 4) continue;

      context.strokeStyle = "rgba(255,255,255,0.10)";
      context.beginPath();
      context.moveTo(38, y);
      context.lineTo(width, y);
      context.stroke();

      context.fillStyle = "rgba(255,255,255,0.55)";
      context.fillText(`${tickLabel(hz)}`, 6, y);
    }

    // Time axis: pick the coarsest step that still gives about eight labels.
    const duration = columnToSeconds(picture.columns - 1);
    const step = TIME_STEPS.find((candidate) => duration / candidate <= 8) || TIME_STEPS[TIME_STEPS.length - 1];

    for (let t = 0; t <= duration + 1e-9; t += step) {
      const x = Math.round(secondsToX(t, width)) + 0.5;

      if (x > width - 2) continue;

      context.strokeStyle = "rgba(255,255,255,0.08)";
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height - 14);
      context.stroke();

      context.fillStyle = "rgba(255,255,255,0.5)";
      context.fillText(`${t.toFixed(step < 1 ? 2 : 0)}s`, x + 3, height - 7);
    }

    context.restore();
  }

  function drawOverlay() {
    const context = el.overlay.getContext("2d");

    if (!context || !picture) return;

    const { width, height, ratio } = overlaySize();

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (el.gridLines.checked) drawAxes(context, width, height);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--spb-accent").trim() || "#4ff5ff";

    // Playhead.
    if (playing || playOffset > 0) {
      const x = Math.round(secondsToX(currentTime(), width)) + 0.5;

      context.strokeStyle = accent;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();

      const glow = context.createLinearGradient(x - 24, 0, x, 0);

      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(1, "rgba(255,255,255,0.16)");
      context.fillStyle = glow;
      context.fillRect(x - 24, 0, 24, height);
    }

    // Crosshair.
    if (pointer) {
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(pointer.x + 0.5, 0);
      context.lineTo(pointer.x + 0.5, height);
      context.moveTo(0, pointer.y + 0.5);
      context.lineTo(width, pointer.y + 0.5);
      context.stroke();
      context.setLineDash([]);
    }
  }

  // -------------------------------------------------------------------- cursor

  function updateCursor() {
    if (!picture || !pointer) {
      el.cursorTime.textContent = "—";
      el.cursorHz.textContent = "—";
      el.cursorNote.textContent = "—";
      el.cursorDb.textContent = "—";
      return;
    }

    const { width, height } = overlaySize();
    const column = xToColumn(pointer.x, width);
    const bin = yToBin(pointer.y, height);
    const hz = pipeline.binToHz(bin, picture.size, picture.sampleRate);
    const db = picture.magnitudes[column * picture.bins + Math.round(bin)];
    const note = pipeline.noteForHz(hz);

    el.cursorTime.textContent = pipeline.formatDuration(columnToSeconds(column));
    el.cursorHz.textContent = formatHz(hz);
    el.cursorNote.textContent = note ? `${note.name} ${signed(note.cents, "¢")}` : "—";
    el.cursorDb.textContent = formatDb(db);
  }

  // ------------------------------------------------------------------ playback

  /* Playback volume as a plain amplitude, 0..1.
   *
   * No perceptual curve on top: this page reads levels in dBFS all day, so the
   * slider is the amplitude it says it is and the readout gives the dB beside
   * it — 20% is −14 dB, and that is a number the rest of the console agrees
   * with. */
  function volumeAmplitude() {
    return Math.max(0, Math.min(100, Number(el.volume.value))) / 100;
  }

  function syncVolume() {
    const amplitude = volumeAmplitude();

    el.volumeValue.textContent =
      amplitude <= 0 ? "muted" : `${Math.round(amplitude * 100)}% · ${formatDb(pipeline.amplitudeToDb(amplitude))}`;

    // Ramp rather than jump: an instant gain change on a playing buffer clicks.
    if (gainNode && audioContext) gainNode.gain.setTargetAtTime(amplitude, audioContext.currentTime, 0.015);
  }

  function ensureContext() {
    if (audioContext) return audioContext;

    const Constructor = window.AudioContext || window.webkitAudioContext;

    if (!Constructor) return null;

    audioContext = new Constructor();

    // One gain node for the life of the page; every source plays through it, so
    // the slider keeps working across files and seeks.
    gainNode = audioContext.createGain();
    gainNode.gain.value = volumeAmplitude();
    gainNode.connect(audioContext.destination);

    return audioContext;
  }

  /* Copy the decoded channels into an AudioBuffer once. If the file's rate is
   * not the context's, the source node resamples on playback — the picture stays
   * at the file's own rate either way. */
  function ensureBuffer() {
    if (audioBuffer || !source) return audioBuffer;

    const context = ensureContext();

    if (!context) return null;

    audioBuffer = context.createBuffer(source.channels.length, source.frames, source.sampleRate);

    for (let c = 0; c < source.channels.length; c += 1) {
      audioBuffer.copyToChannel(source.channels[c], c);
    }

    return audioBuffer;
  }

  function currentTime() {
    if (!playing || !audioContext) return playOffset;

    return Math.min(source ? source.frames / source.sampleRate : 0, playOffset + (audioContext.currentTime - playStartedAt));
  }

  function tick() {
    frameRequest = null;

    if (!playing) return;

    const at = currentTime();

    el.clock.textContent = pipeline.formatDuration(at);
    drawOverlay();

    if (source && at >= source.frames / source.sampleRate) {
      stopPlayback(true);
      return;
    }

    frameRequest = window.requestAnimationFrame(tick);
  }

  function startPlayback(from) {
    const context = ensureContext();
    const buffer = ensureBuffer();

    if (!context || !buffer) {
      setMessage("This browser refused an audio context, so playback is unavailable.", "error");
      return;
    }

    if (context.state === "suspended") context.resume();

    stopNode();

    audioNode = context.createBufferSource();
    audioNode.buffer = buffer;
    audioNode.connect(gainNode || context.destination);
    audioNode.onended = function () {
      // Fires for a natural end and for our own stop; only the former should
      // reset the transport.
      if (playing && audioNode) stopPlayback(true);
    };

    playOffset = Math.max(0, Math.min(from || 0, buffer.duration - 0.01));
    playStartedAt = context.currentTime;
    playing = true;
    audioNode.start(0, playOffset);

    el.playLabel.textContent = "Pause";
    el.play.classList.add("is-playing");
    setState("playing", "busy");

    if (frameRequest === null) frameRequest = window.requestAnimationFrame(tick);
  }

  function stopNode() {
    if (!audioNode) return;

    audioNode.onended = null;

    try {
      audioNode.stop();
    } catch (error) {
      /* already stopped */
    }

    audioNode.disconnect();
    audioNode = null;
  }

  function pausePlayback() {
    if (!playing) return;

    playOffset = currentTime();
    playing = false;
    stopNode();

    el.playLabel.textContent = "Play";
    el.play.classList.remove("is-playing");
    setState("ready");
    drawOverlay();
  }

  function stopPlayback(rewind) {
    playing = false;
    stopNode();

    if (rewind) playOffset = 0;

    if (frameRequest !== null) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = null;
    }

    el.playLabel.textContent = "Play";
    el.play.classList.remove("is-playing");
    el.clock.textContent = pipeline.formatDuration(playOffset);
    setState(source ? "ready" : "idle");
    drawOverlay();
  }

  // -------------------------------------------------------------------- sources

  function adoptSignal(channels, sampleRate, label, kind, parsed) {
    stopPlayback(true);

    audioBuffer = null;
    source = {
      label,
      kind,
      channels,
      sampleRate,
      frames: channels.length ? channels[0].length : 0,
      parsed: parsed || null,
    };

    syncChannelOptions();

    el.fileName.textContent = label;
    el.rate.textContent = `${sampleRate.toLocaleString("en-US")} Hz`;
    el.channels.textContent = channels.length === 1 ? "1 (mono)" : `${channels.length}`;
    el.duration.textContent = pipeline.formatDuration(source.frames / sampleRate);
    el.samples.textContent = source.frames.toLocaleString("en-US");

    el.savePng.disabled = false;
    el.clear.disabled = false;
    el.play.disabled = false;
    el.stop.disabled = false;
    el.clock.textContent = "0:00.00";

    renderContainer();
    analyse();
  }

  function renderContainer() {
    clear(el.chunks);
    clear(el.info);

    const parsed = source && source.parsed;

    if (!parsed) {
      el.chunksEmpty.hidden = false;
      el.chunksTag.textContent = source ? "synthesised" : "no file";
      el.warnings.textContent = "";
      el.warnings.classList.remove("is-error");
      return;
    }

    el.chunksEmpty.hidden = true;
    el.chunksTag.textContent = `${parsed.chunks.length} chunks`;

    parsed.chunks.forEach(function (chunk) {
      const row = node("div", "spb-chunk");

      row.appendChild(node("span", "spb-chunk__id", chunk.id));
      row.appendChild(node("span", "spb-chunk__offset", `0x${chunk.offset.toString(16).toUpperCase().padStart(6, "0")}`));
      row.appendChild(node("span", "spb-chunk__size", pipeline.formatBytes(chunk.size)));
      row.appendChild(node("span", "spb-chunk__note", chunk.note));

      if (chunk.id === "fmt " || chunk.id === "data") row.classList.add("is-essential");

      el.chunks.appendChild(row);
    });

    // The same impulse as the Metadata Peeler: if the file carries a name or a
    // comment, show it.
    Object.keys(parsed.info).forEach(function (key) {
      el.info.appendChild(readoutRow(key, parsed.info[key]));
    });

    el.warnings.textContent = parsed.warnings.length ? parsed.warnings.join(" ") : "";
    el.warnings.classList.toggle("is-error", parsed.warnings.length > 0);
  }

  function loadSignal() {
    const controls = readControls();
    const kind = el.signal.value;
    const samples = pipeline.synthesize(kind, SIGNAL_RATE, controls.seconds, { amplitude: 0.7 });
    const label = pipeline.SIGNALS[kind] ? pipeline.SIGNALS[kind].label : kind;

    el.format.textContent = "synthesised · 32-bit float";
    el.decoder.textContent = "generated here";
    setState("analysing", "busy");
    adoptSignal([samples], SIGNAL_RATE, label, "signal", null);
    setMessage(`${label} — ${pipeline.SIGNALS[kind] ? pipeline.SIGNALS[kind].note : ""}`);
  }

  // ---------------------------------------------------------------------- input

  function reject(message) {
    setState("rejected", "error");
    setMessage(message, "error");
  }

  function accepts(file) {
    // Chrome hands over an empty `type` for some drag sources, so fall back to
    // the extension rather than refusing a file the parser could clearly read.
    if (file.type) return ACCEPTED_TYPES.indexOf(file.type) !== -1 || ACCEPTED_EXTENSIONS.test(file.name || "");

    return ACCEPTED_EXTENSIONS.test(file.name || "");
  }

  function readBytes(file) {
    if (typeof file.arrayBuffer === "function") return file.arrayBuffer();

    return new Promise(function (resolve, error) {
      const reader = new FileReader();

      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        error(reader.error);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Hand a compressed stream to the browser's own codec.
   *
   * This is the one step the pipeline does not do itself, and it is the same
   * bargain the Pixelizer strikes when it lets `drawImage` decode a JPEG: the
   * container is read by hand, the codec is borrowed, and every measurement
   * afterwards is ours. A hand-written Layer III decoder — 34 Huffman tables, a
   * bit reservoir, an IMDCT and a synthesis filterbank — is a different project.
   *
   * The context is created at the *file's own* sample rate, taken from the frame
   * header this tool parsed, so the decode is not silently resampled to whatever
   * the output device happens to run at. */
  function decodeCompressed(bytes, sampleRate) {
    const Constructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;

    if (!Constructor) return Promise.reject(new Error("OfflineAudioContext is unavailable"));

    let context;

    try {
      context = new Constructor(1, 1, sampleRate);
    } catch (error) {
      // Some rates are refused; fall back and report the difference afterwards.
      context = new Constructor(1, 1, 44100);
    }

    // `decodeAudioData` detaches the ArrayBuffer it is handed, so give it a copy
    // and keep ours — the container panel still needs to read the original bytes.
    const copy = bytes.slice().buffer;

    return new Promise(function (resolve, error) {
      const result = context.decodeAudioData(copy, resolve, error);

      // Older Safari only takes the callbacks; everything current also returns a
      // promise. Wiring both is cheaper than sniffing.
      if (result && typeof result.then === "function") result.then(resolve, error);
    });
  }

  function loadWav(bytes, name) {
    const parsed = pipeline.parseRiff(bytes);

    if (!parsed.ok) {
      reject(parsed.error);
      return;
    }

    setState("unpacking", "busy");

    const decoded = pipeline.decodeSamples(bytes, parsed, { maxFrames: MAX_SECONDS * parsed.format.sampleRate });

    if (!decoded.ok) {
      reject(decoded.error);
      return;
    }

    el.format.textContent =
      `${parsed.format.formatName} · ${parsed.format.bitsPerSample}-bit` + (parsed.format.extensible ? " · extensible" : "");
    el.decoder.textContent = "unpacked here";

    setState("analysing", "busy");
    adoptSignal(decoded.channels, parsed.format.sampleRate, name, "file", parsed);

    const notes = [];

    if (decoded.truncated) notes.push(`Only the first ${MAX_SECONDS} s were read.`);
    if (decoded.clipped) notes.push(`${decoded.clipped} samples sit at full scale.`);
    if (parsed.info.title) notes.push(`Titled "${parsed.info.title}".`);

    setMessage(notes.join(" "));
  }

  function loadMp3(bytes, name) {
    const parsed = pipeline.parseMpeg(bytes);

    if (!parsed.ok) {
      reject(parsed.error);
      return;
    }

    // Cut the frame stream first: decoding a two-hour file to Float32 and then
    // throwing most of it away is how a tab runs out of memory.
    const slice = pipeline.mpegSlice(bytes, parsed, MAX_SECONDS);

    setState("decoding", "busy");
    setMessage(`${parsed.frameCount} frames read here; handing ${slice.frames} of them to the browser codec…`);

    decodeCompressed(slice.bytes, parsed.format.sampleRate).then(
      function (buffer) {
        const channels = [];

        for (let c = 0; c < buffer.numberOfChannels; c += 1) {
          // Copy: the AudioBuffer goes out of scope, and the analysis holds on
          // to these for the life of the file.
          channels.push(buffer.getChannelData(c).slice());
        }

        const kbps = Math.round(parsed.averageBitrate / 1000);

        el.format.textContent = `${parsed.format.formatName} · ${kbps} kbps ${parsed.bitrateMode}`;
        el.decoder.textContent = "browser codec";

        setState("analysing", "busy");
        adoptSignal(channels, buffer.sampleRate, name, "file", parsed);

        const notes = [];

        if (slice.truncated) notes.push(`Only the first ${MAX_SECONDS} s were decoded of ${pipeline.formatDuration(parsed.duration)}.`);

        if (buffer.sampleRate !== parsed.format.sampleRate) {
          notes.push(
            `The file says ${parsed.format.sampleRate} Hz but the decoder returned ${buffer.sampleRate} Hz — the axis follows the decoder.`,
          );
        }

        if (parsed.vbr && parsed.vbr.encoderDelay) {
          notes.push(`${parsed.vbr.encoderDelay} samples of encoder delay precede the first real sample.`);
        } else {
          notes.push("MP3 decoding adds a short encoder delay before the first real sample.");
        }

        if (parsed.info.title) notes.push(`Titled "${parsed.info.title}".`);

        setMessage(notes.join(" "));
      },
      function (error) {
        reject(`The browser codec refused this MP3${error && error.message ? ` (${error.message})` : ""}.`);
      },
    );
  }

  function loadFile(file) {
    if (!file) return;

    if (!accepts(file)) {
      reject(`"${file.name || "that file"}" is not a WAV or an MP3.`);
      return;
    }

    if (file.size > MAX_BYTES) {
      reject(`${pipeline.formatBytes(file.size)} is over the ${pipeline.formatBytes(MAX_BYTES)} limit.`);
      return;
    }

    setState("reading", "busy");
    setMessage("Reading bytes…");

    readBytes(file).then(
      function (buffer) {
        const bytes = new Uint8Array(buffer);
        // By signature, not by extension: a .mp3 holding RIFF is a WAV, and the
        // wrong branch would report a parse failure for a perfectly good file.
        const container = pipeline.detectContainer(bytes);
        const name = file.name || "(unnamed)";

        if (container === "wav") loadWav(bytes, name);
        else if (container === "mp3") loadMp3(bytes, name);
        else reject("No WAVE header and no MPEG frame — this is not a file this tool can read.");
      },
      function () {
        reject("That file could not be read.");
      },
    );
  }

  // --------------------------------------------------------------------- export

  /* Composite the spectrogram and a clean set of axes — no crosshair, no
   * playhead — at screen resolution, so the PNG is the plot rather than a
   * snapshot of the cursor's position. */
  function savePng() {
    if (!picture) return;

    const { width, height, ratio } = overlaySize();
    const canvas = document.createElement("canvas");

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const context = canvas.getContext("2d");

    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(el.canvas, 0, 0, width, height);

    if (el.gridLines.checked) drawAxes(context, width, height);

    const base = source ? source.label.replace(/\.[^.]+$/, "") || "signal" : "signal";
    const link = document.createElement("a");

    link.href = canvas.toDataURL("image/png");
    link.download = `${base}-spectrogram-${picture.size}.png`;
    link.click();

    setMessage(`Saved a ${canvas.width} × ${canvas.height} PNG of the plot.`);
  }

  function clearSource() {
    stopPlayback(true);

    source = null;
    picture = null;
    rowMap = null;
    audioBuffer = null;
    pointer = null;

    el.file.value = "";
    el.viewport.classList.remove("has-image");
    el.empty.hidden = false;

    const context = el.canvas.getContext("2d");

    if (context) context.clearRect(0, 0, el.canvas.width, el.canvas.height);

    const waveContext = el.wave.getContext("2d");

    if (waveContext) waveContext.clearRect(0, 0, el.wave.width, el.wave.height);

    const overlayContext = el.overlay.getContext("2d");

    if (overlayContext) overlayContext.clearRect(0, 0, el.overlay.width, el.overlay.height);

    clear(el.chunks);
    clear(el.info);
    el.chunksEmpty.hidden = false;
    el.chunksTag.textContent = "no file";
    el.warnings.textContent = "";
    el.warnings.classList.remove("is-error");

    el.savePng.disabled = true;
    el.clear.disabled = true;
    el.play.disabled = true;
    el.stop.disabled = true;

    [
      "fileName",
      "format",
      "decoder",
      "rate",
      "channels",
      "duration",
      "samples",
      "peak",
      "rms",
      "crest",
      "dc",
      "clipped",
      "dominant",
      "note",
      "binHz",
      "hop",
      "elapsed",
      "cursorTime",
      "cursorHz",
      "cursorNote",
      "cursorDb",
    ].forEach(function (key) {
      el[key].textContent = "—";
    });

    el.geometry.textContent = "no signal";
    el.clock.textContent = "0:00.00";
    syncChannelOptions();

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

  // Which controls need the transform run again, and which only need a repaint.
  const REANALYSE = ["spbFftSize", "spbWindow", "spbOverlap", "spbChannel"];

  el.controls.addEventListener("input", function (event) {
    const controls = readControls();

    syncLabels(controls);

    if (event.target === el.ramp) rampTable = pipeline.rampTable(controls.ramp);

    if (!source) return;

    if (REANALYSE.indexOf(event.target.id) !== -1) {
      setState("analysing", "busy");
      analyse();
      return;
    }

    if (event.target === el.seconds) return; // only matters on the next render

    paint(controls);
  });

  el.controls.addEventListener("change", function (event) {
    const controls = readControls();

    syncLabels(controls);

    if (event.target === el.ramp) rampTable = pipeline.rampTable(controls.ramp);

    if (!source) return;

    if (REANALYSE.indexOf(event.target.id) !== -1) {
      setState("analysing", "busy");
      analyse();
      return;
    }

    if (event.target === el.gridLines) {
      drawOverlay();
      return;
    }

    paint(controls);
    updateCursor();
  });

  el.controls.addEventListener("submit", function (event) {
    event.preventDefault(); // the form is a grouping device, it has nowhere to post
  });

  el.loadSignal.addEventListener("click", loadSignal);
  el.savePng.addEventListener("click", savePng);
  el.clear.addEventListener("click", clearSource);

  el.play.addEventListener("click", function () {
    if (playing) pausePlayback();
    else startPlayback(playOffset);
  });

  el.stop.addEventListener("click", function () {
    stopPlayback(true);
  });

  // The volume lives outside the controls form, so it gets its own listener and
  // never triggers a repaint or a re-analysis.
  el.volume.addEventListener("input", syncVolume);

  el.overlay.addEventListener("pointermove", function (event) {
    if (!picture) return;

    const rect = el.overlay.getBoundingClientRect();

    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    updateCursor();
    drawOverlay();
  });

  el.overlay.addEventListener("pointerleave", function () {
    pointer = null;
    updateCursor();
    drawOverlay();
  });

  el.overlay.addEventListener("click", function (event) {
    if (!picture || !source) return;

    const rect = el.overlay.getBoundingClientRect();
    const seconds = columnToSeconds(xToColumn(event.clientX - rect.left, rect.width));

    if (playing) startPlayback(seconds);
    else {
      playOffset = seconds;
      el.clock.textContent = pipeline.formatDuration(seconds);
      drawOverlay();
    }
  });

  el.theme.addEventListener("change", function () {
    applyTheme(el.theme.value);

    // The waveform and overlay are painted with the theme accent, so they have
    // to be redrawn when it changes.
    if (source) {
      drawWaveform(selectedSamples(readControls()));
      drawOverlay();
    }
  });

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () {
      if (picture) resizeOverlay();
    }).observe(el.viewport);
  } else {
    window.addEventListener("resize", function () {
      if (picture) resizeOverlay();
    });
  }

  window.addEventListener("beforeunload", function () {
    stopNode();
    if (audioContext) audioContext.close();
  });

  restoreTheme();
  syncLabels(readControls());
  syncVolume();
  syncChannelOptions();
  drawLegend(readControls());
  setState("idle");
})();
