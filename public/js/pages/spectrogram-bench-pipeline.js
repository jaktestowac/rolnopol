/**
 * Spectrogram Bench — the analysis engine, with no DOM in it.
 *
 * A file goes in as bytes and comes out as a picture of its own frequencies.
 * Nothing here is handed to a DSP library: both containers are walked by hand,
 * WAV samples are unpacked from whatever width they were stored at, and the
 * transform is a hand-written radix-2 FFT.
 *
 *   1. `detectContainer` — signature sniff, never the file name
 *   2. `parseRiff` / `parseMpeg` — chunk walk, or frame walk plus ID3 and Xing
 *   3. `decodeSamples`  — packed integers or floats → one Float32Array per channel
 *   4. `preEmphasis` / `normalizePeak` — optional conditioning, always reported
 *   5. `makePlan`       — twiddle tables and the bit-reversal permutation, once
 *   6. `spectrogram`    — windowed frames → `transform` → magnitudes in dB
 *
 * One thing this module does *not* do: turn MP3 frames into samples. Layer III
 * decoding is a project of its own, so the console borrows the browser's codec
 * for that one step — see the `MPEG container` section. Nothing in this file
 * calls it, which is what keeps the whole module testable outside a browser.
 *
 * Two things keep this honest rather than merely pretty:
 *
 *   - **Windows carry their gain.** A Hann window throws away 50% of the
 *     amplitude it multiplies, so every window declares a coherent gain and
 *     magnitudes are divided by it. Without that, switching window changes the
 *     dB readout of an unchanged signal and the numbers mean nothing.
 *   - **Frames are planned, not assumed.** `planFrames` derives the hop from
 *     the requested column budget, so a ten-minute file produces the same
 *     bounded amount of work as a ten-second one instead of exhausting memory.
 *
 * Bin zero is DC and bin `size/2` is Nyquist; only the first `size/2 + 1` bins
 * of a real signal's transform carry information, and the rest are their
 * conjugate mirror — so that is all `spectrogram` keeps.
 *
 * Wrapped UMD-style, like the other `*-pipeline.js` files, so
 * `tests/unit/spectrogram-bench.pipeline.test.js` can require the same code the
 * browser loads.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.SpectrogramBenchPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // A malformed RIFF is the normal case for a tool like this, so every walk is
  // bounded. A WAV with 1024 chunks is not a WAV.
  const MAX_CHUNKS = 1024;

  const FFT_SIZES = [256, 512, 1024, 2048, 4096];
  const DEFAULT_FFT_SIZE = 2048;

  // Beyond this the spectrogram is wider than any screen and the extra columns
  // cost memory for detail nobody can see.
  const MAX_COLUMNS = 4096;
  const DEFAULT_COLUMNS = 1200;

  const DB_FLOOR_RANGE = { min: -120, max: -20 };
  const DEFAULT_DB_FLOOR = -90;

  const MIN_LOG_HZ = 20; // where the log frequency axis starts

  /* WAVE format tags. 0xFFFE (extensible) hides the real tag in the first two
   * bytes of its sub-format GUID, which is why `parseRiff` has to look past
   * the tag it is given. */
  const FORMAT_PCM = 0x0001;
  const FORMAT_FLOAT = 0x0003;
  const FORMAT_ALAW = 0x0006;
  const FORMAT_MULAW = 0x0007;
  const FORMAT_EXTENSIBLE = 0xfffe;

  const FORMAT_NAMES = {
    [FORMAT_PCM]: "PCM",
    [FORMAT_FLOAT]: "IEEE float",
    [FORMAT_ALAW]: "A-law",
    [FORMAT_MULAW]: "µ-law",
    [FORMAT_EXTENSIBLE]: "extensible",
  };

  /* Window functions, each with the coherent gain it costs. The gain is the
   * mean of the window, and dividing the spectrum by it is what makes a 0 dBFS
   * sine read as 0 dBFS through any of them. */
  const WINDOWS = {
    hann: {
      label: "Hann",
      note: "general purpose",
      at: function (n, size) {
        return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (size - 1)));
      },
    },
    hamming: {
      label: "Hamming",
      note: "narrower main lobe",
      at: function (n, size) {
        return 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (size - 1));
      },
    },
    blackman: {
      label: "Blackman",
      note: "lowest side lobes",
      at: function (n, size) {
        const x = (2 * Math.PI * n) / (size - 1);

        return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
      },
    },
    rectangular: {
      label: "Rectangular",
      note: "no window at all",
      at: function () {
        return 1;
      },
    },
  };

  /* Colour ramps for the spectrogram, as hand-typed stops interpolated in RGB.
   * Nothing is imported: the point of the tool is that every number on screen
   * was computed here. */
  const RAMPS = {
    abyss: {
      label: "Abyss",
      stops: [
        [4, 6, 14],
        [18, 38, 96],
        [26, 120, 168],
        [64, 214, 214],
        [186, 255, 240],
      ],
    },
    ember: {
      label: "Ember",
      stops: [
        [8, 3, 12],
        [86, 12, 62],
        [190, 44, 48],
        [246, 148, 22],
        [255, 246, 196],
      ],
    },
    flux: {
      label: "Flux",
      stops: [
        [10, 4, 30],
        [72, 24, 148],
        [168, 46, 178],
        [246, 108, 128],
        [255, 232, 168],
      ],
    },
    chlorophyll: {
      label: "Chlorophyll",
      stops: [
        [3, 10, 8],
        [12, 62, 48],
        [42, 140, 74],
        [136, 218, 74],
        [238, 255, 190],
      ],
    },
    /* The three perceptually-uniform maps everybody in signal processing knows
     * by name, transcribed as stops rather than imported. They are worth having
     * because a uniform ramp does not invent contrast that is not in the data —
     * the eye reads an equal step in dB as an equal step in colour. */
    viridis: {
      label: "Viridis",
      stops: [
        [68, 1, 84],
        [71, 45, 123],
        [59, 82, 139],
        [44, 114, 142],
        [33, 145, 140],
        [40, 174, 128],
        [94, 201, 98],
        [173, 220, 48],
        [253, 231, 37],
      ],
    },
    plasma: {
      label: "Plasma",
      stops: [
        [13, 8, 135],
        [65, 4, 157],
        [106, 0, 168],
        [143, 13, 164],
        [177, 42, 144],
        [204, 71, 120],
        [225, 100, 98],
        [242, 132, 75],
        [252, 166, 54],
        [252, 206, 37],
        [240, 249, 33],
      ],
    },
    inferno: {
      label: "Inferno",
      stops: [
        [0, 0, 4],
        [27, 12, 65],
        [74, 12, 107],
        [120, 28, 109],
        [165, 44, 96],
        [207, 68, 70],
        [237, 105, 37],
        [251, 155, 6],
        [247, 209, 61],
        [252, 255, 164],
      ],
    },
    graphite: {
      label: "Graphite",
      stops: [
        [6, 8, 10],
        [58, 62, 68],
        [120, 126, 134],
        [188, 195, 202],
        [246, 250, 255],
      ],
    },
  };

  /* Export sizes. `viewport` means "whatever the plot is on screen right now";
   * every other entry re-runs the analysis at that many columns so a 4K export
   * is genuinely 3840 columns of spectrum rather than an upscale of 1200. */
  const EXPORT_SIZES = [
    { key: "viewport", label: "As displayed", width: 0, height: 0 },
    { key: "720p", label: "1280 × 720", width: 1280, height: 720 },
    { key: "1080p", label: "1920 × 1080", width: 1920, height: 1080 },
    { key: "1440p", label: "2560 × 1440", width: 2560, height: 1440 },
    { key: "4k", label: "3840 × 2160", width: 3840, height: 2160 },
  ];

  /* Analysis window expressed in time rather than in bins. `fft` keeps whatever
   * the FFT-size control says; the rest derive the size from the sample rate, so
   * "25 ms" means the same thing on a 48 kHz file as on a 22 kHz one. */
  const WINDOW_LENGTHS = [
    { key: "fft", label: "By FFT size", ms: 0 },
    { key: "5", label: "5 ms — transients", ms: 5 },
    { key: "10", label: "10 ms", ms: 10 },
    { key: "25", label: "25 ms — speech", ms: 25 },
    { key: "50", label: "50 ms", ms: 50 },
    { key: "100", label: "100 ms — tonal", ms: 100 },
  ];

  /* Frequency bands worth looking at on their own. A zero means "unset", and
   * every bound is clamped to Nyquist by `axisBounds`, so asking for 0–20 kHz on
   * an 8 kHz file quietly gets you 0–4 kHz instead of an empty top half. */
  const FREQUENCY_RANGES = [
    { key: "full", label: "Full range", minHz: 0, maxHz: 0 },
    { key: "20k", label: "20 Hz – 20 kHz", minHz: 20, maxHz: 20000 },
    { key: "10k", label: "20 Hz – 10 kHz", minHz: 20, maxHz: 10000 },
    { key: "5k", label: "20 Hz – 5 kHz", minHz: 20, maxHz: 5000 },
    { key: "2k", label: "20 Hz – 2 kHz", minHz: 20, maxHz: 2000 },
    { key: "voice", label: "300 Hz – 3.4 kHz — voice", minHz: 300, maxHz: 3400 },
    { key: "bass", label: "20 Hz – 500 Hz — bass", minHz: 20, maxHz: 500 },
  ];

  const SIGNALS = {
    sine: { label: "Sine 440 Hz", note: "one bin, nothing else" },
    twoTone: { label: "Two tones", note: "440 Hz + 445 Hz — resolution test" },
    square: { label: "Square 220 Hz", note: "odd harmonics only" },
    saw: { label: "Saw 110 Hz", note: "every harmonic" },
    chirp: { label: "Chirp 40 Hz → 8 kHz", note: "a diagonal line" },
    noise: { label: "White noise", note: "flat, seeded" },
  };

  // ---------------------------------------------------------------- byte readers

  function u16le(bytes, at) {
    return ((bytes[at + 1] << 8) | bytes[at]) >>> 0;
  }

  function u32le(bytes, at) {
    return ((bytes[at + 3] << 24) | (bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]) >>> 0;
  }

  function fourCC(bytes, at) {
    let out = "";

    for (let i = at; i < Math.min(bytes.length, at + 4); i += 1) {
      const code = bytes[i];

      out += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : ".";
    }

    return out;
  }

  function latin1(bytes, at, length) {
    const end = Math.min(bytes.length, at + Math.max(0, length));
    let out = "";

    for (let i = at; i < end; i += 1) {
      if (bytes[i] === 0) break;

      out += String.fromCharCode(bytes[i]);
    }

    return out.trim();
  }

  function formatBytes(count) {
    if (count < 1024) return `${count} B`;
    if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;

    return `${(count / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "—";

    const whole = Math.floor(seconds);
    const minutes = Math.floor(whole / 60);
    const rest = seconds - minutes * 60;

    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
  }

  // ------------------------------------------------------------- RIFF container

  /* Tags inside a LIST/INFO chunk. The same impulse as the Metadata Peeler:
   * an audio file can carry a name, an author and a comment, and a tool that
   * shows you the spectrum may as well show you those too. */
  const INFO_TAGS = {
    INAM: "title",
    IART: "artist",
    IPRD: "album",
    ICRD: "date",
    ICMT: "comment",
    ISFT: "software",
    IGNR: "genre",
    IENG: "engineer",
    ICOP: "copyright",
  };

  function readFormatChunk(bytes, at, size) {
    const tag = u16le(bytes, at);
    const channels = u16le(bytes, at + 2);
    const sampleRate = u32le(bytes, at + 4);
    const blockAlign = u16le(bytes, at + 12);
    const bitsPerSample = u16le(bytes, at + 14);

    let effectiveTag = tag;
    let extensible = false;

    // The extensible tag is a promise that the real one is 24 bytes further in.
    if (tag === FORMAT_EXTENSIBLE && size >= 40) {
      effectiveTag = u16le(bytes, at + 24);
      extensible = true;
    }

    return {
      tag,
      effectiveTag,
      extensible,
      formatName: FORMAT_NAMES[effectiveTag] || `unknown (0x${effectiveTag.toString(16)})`,
      channels,
      sampleRate,
      byteRate: u32le(bytes, at + 8),
      blockAlign,
      bitsPerSample,
      bytesPerSample: Math.ceil(bitsPerSample / 8),
    };
  }

  /* Walk the RIFF chunk list. Every chunk is recorded whether or not this tool
   * understands it, so the readout can show what a file actually contains
   * rather than only the parts that were useful. */
  function parseRiff(bytes) {
    const warnings = [];
    const chunks = [];
    const info = {};

    if (!bytes || bytes.length < 12) {
      return { ok: false, error: "File is too short to be a RIFF container.", chunks, warnings, info };
    }

    const riff = fourCC(bytes, 0);
    const wave = fourCC(bytes, 8);

    if (riff !== "RIFF") {
      return { ok: false, error: `Expected a RIFF header, found "${riff}".`, chunks, warnings, info };
    }

    if (wave !== "WAVE") {
      return { ok: false, error: `RIFF form is "${wave}", not WAVE.`, chunks, warnings, info };
    }

    const declared = u32le(bytes, 4) + 8;

    if (declared > bytes.length) {
      warnings.push(`The RIFF header claims ${declared} bytes but the file is ${bytes.length}.`);
    }

    let format = null;
    let data = null;
    let at = 12;

    while (at + 8 <= bytes.length && chunks.length < MAX_CHUNKS) {
      const id = fourCC(bytes, at);
      const size = u32le(bytes, at + 4);
      const bodyAt = at + 8;
      const available = Math.min(size, bytes.length - bodyAt);

      if (available < size) {
        warnings.push(`Chunk "${id}" claims ${size} bytes but only ${available} remain.`);
      }

      const chunk = { id, offset: at, size, bodyAt, bodyLength: available, note: "" };

      if (id === "fmt " && available >= 16) {
        format = readFormatChunk(bytes, bodyAt, available);
        chunk.note = `${format.formatName}, ${format.channels} ch, ${format.sampleRate} Hz, ${format.bitsPerSample}-bit`;
      } else if (id === "data") {
        data = { offset: bodyAt, length: available };
        chunk.note = `${formatBytes(available)} of samples`;
      } else if (id === "LIST" && available >= 4) {
        const listType = fourCC(bytes, bodyAt);

        chunk.note = `${listType} metadata`;

        if (listType === "INFO") {
          let cursor = bodyAt + 4;
          const listEnd = bodyAt + available;

          while (cursor + 8 <= listEnd) {
            const tag = fourCC(bytes, cursor);
            const tagSize = u32le(bytes, cursor + 4);
            const name = INFO_TAGS[tag];

            if (name) info[name] = latin1(bytes, cursor + 8, Math.min(tagSize, listEnd - cursor - 8));

            cursor += 8 + tagSize + (tagSize & 1);
          }
        }
      } else if (id === "fact") {
        chunk.note = "compressed sample count";
      }

      chunks.push(chunk);

      // Chunk bodies are word-aligned: an odd size is followed by a pad byte
      // that belongs to nobody and is not counted in the size.
      at = bodyAt + available + (available & 1);
    }

    if (!format) {
      return { ok: false, error: "No readable fmt chunk — the file does not say how its samples are stored.", chunks, warnings, info };
    }

    if (!data) {
      return { ok: false, error: "No data chunk — the file has a format but no samples.", chunks, warnings, info };
    }

    const frameBytes = format.blockAlign || format.channels * format.bytesPerSample;
    const frames = frameBytes > 0 ? Math.floor(data.length / frameBytes) : 0;

    if (format.blockAlign && format.blockAlign !== format.channels * format.bytesPerSample) {
      warnings.push(
        `blockAlign is ${format.blockAlign} but ${format.channels} channels of ${format.bytesPerSample} bytes need ${format.channels * format.bytesPerSample}.`,
      );
    }

    return {
      ok: true,
      chunks,
      warnings,
      info,
      format,
      data,
      frames,
      duration: format.sampleRate > 0 ? frames / format.sampleRate : 0,
    };
  }

  // ------------------------------------------------------------- MPEG container

  /* MP3 is read here, not decoded.
   *
   * Everything about the file's *structure* is parsed by hand — the ID3 tags,
   * every frame header, the Xing/LAME table — because that is what tells you the
   * bitrate mode, the real duration, and whether the encoder left a gapless
   * padding note. What this file deliberately does not do is turn Layer III
   * frames into samples: that needs 34 Huffman tables, a bit reservoir, an IMDCT
   * and a synthesis filterbank, and the console hands that one job to the
   * browser's own codec instead — the same bargain the Pixelizer strikes when it
   * lets `drawImage` decode a JPEG. Every measurement downstream is still ours.
   *
   * `mpegSlice` is what makes that bargain safe: the console cuts the byte stream
   * at a frame boundary before decoding, so a two-hour podcast costs the same
   * memory as a two-minute one.
   */

  const MPEG_VERSION_NAMES = { 1: "MPEG-1", 2: "MPEG-2", 2.5: "MPEG-2.5" };
  const MPEG_LAYER_NAMES = { 1: "Layer I", 2: "Layer II", 3: "Layer III" };
  const MPEG_CHANNEL_MODES = ["stereo", "joint stereo", "dual channel", "mono"];

  const MPEG_SAMPLE_RATES = {
    1: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    2.5: [11025, 12000, 8000],
  };

  // Index 0 is "free format" and 15 is "bad"; both are refused rather than guessed.
  const MPEG_BITRATES = {
    1: {
      1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
      2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
      3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    },
    2: {
      1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
      2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
      3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    },
  };

  const MAX_MPEG_FRAMES = 400000; // about 2.5 hours at 1152 samples per frame
  const MAX_RESYNC_SCAN = 262144; // how far to hunt for the next sync word

  const ID3_TEXT_FRAMES = {
    TIT2: "title",
    TPE1: "artist",
    TALB: "album",
    TDRC: "date",
    TYER: "date",
    TCON: "genre",
    TSSE: "software",
    COMM: "comment",
  };

  /* Synchsafe: seven bits per byte, so a tag size can never contain a false sync
   * word. Reading it as a plain big-endian integer is the classic ID3 bug. */
  function synchsafe(bytes, at) {
    return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f);
  }

  function u32be(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  }

  /* One text frame's payload. The first byte is an encoding flag, and only
   * Latin-1 and UTF-8 are worth handling properly for a readout. */
  function id3Text(bytes, at, length) {
    if (length <= 1) return "";

    const encoding = bytes[at];
    const from = at + 1;
    const size = length - 1;

    if (encoding === 1 || encoding === 2) {
      // UTF-16: skip a BOM if present and take the low byte of each unit, which
      // is right across the Latin range and honest enough for a label.
      let cursor = from;
      let low = 0;

      if (bytes[cursor] === 0xff && bytes[cursor + 1] === 0xfe) cursor += 2;
      else if (bytes[cursor] === 0xfe && bytes[cursor + 1] === 0xff) {
        cursor += 2;
        low = 1;
      }

      let out = "";

      for (let i = cursor; i + 1 < at + length; i += 2) {
        const code = bytes[i + low];

        if (!code) break;

        out += String.fromCharCode(code);
      }

      return out.trim();
    }

    if (encoding === 3) {
      // UTF-8 by hand rather than TextDecoder, which is not available in every
      // context this module gets loaded into.
      let out = "";
      let i = from;
      const end = at + length;

      while (i < end && bytes[i]) {
        const byte = bytes[i];

        if (byte < 0x80) {
          out += String.fromCharCode(byte);
          i += 1;
        } else if (byte >= 0xc0 && byte < 0xe0 && i + 1 < end) {
          out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
          i += 2;
        } else if (byte >= 0xe0 && byte < 0xf0 && i + 2 < end) {
          out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
          i += 3;
        } else {
          i += 1; // a stray continuation byte, or a four-byte form: skip it
        }
      }

      return out.trim();
    }

    return latin1(bytes, from, size);
  }

  /* The ID3v2 tag at the head of the file: how long it is, and any text frames
   * worth putting in the readout. */
  function readId3v2(bytes) {
    if (bytes.length < 10 || fourCC(bytes, 0).slice(0, 3) !== "ID3") return null;

    const major = bytes[3];
    const flags = bytes[5];
    const size = synchsafe(bytes, 6);
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    const info = {};

    // v2.2 uses three-character frame ids and a different header size, so only
    // v2.3 and v2.4 frames are walked. An unknown major version means the tag is
    // skipped rather than mis-read.
    if (major === 3 || major === 4) {
      let at = 10;
      const end = Math.min(bytes.length, 10 + size);

      while (at + 10 <= end) {
        const id = fourCC(bytes, at);

        if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding starts here

        const frameSize = major === 4 ? synchsafe(bytes, at + 4) : u32be(bytes, at + 4);

        if (frameSize <= 0 || at + 10 + frameSize > end) break;

        const name = ID3_TEXT_FRAMES[id];

        if (name && !info[name]) {
          const text = id3Text(bytes, at + 10, frameSize);

          if (text) info[name] = text;
        }

        at += 10 + frameSize;
      }
    }

    return { offset: 0, size: 10 + size + footer, version: `2.${major}.${bytes[4]}`, info };
  }

  function readId3v1(bytes) {
    const at = bytes.length - 128;

    if (at < 0 || fourCC(bytes, at).slice(0, 3) !== "TAG") return null;

    return {
      offset: at,
      size: 128,
      info: {
        title: latin1(bytes, at + 3, 30),
        artist: latin1(bytes, at + 33, 30),
        album: latin1(bytes, at + 63, 30),
      },
    };
  }

  /* One four-byte frame header, or null if these bytes are not one.
   *
   * Every reserved value is refused rather than guessed: a reserved version, a
   * reserved layer, the free-format bitrate index and the "bad" one all return
   * null, so a false sync word inside album art cannot become a frame. */
  function parseFrameHeader(bytes, at) {
    if (at + 4 > bytes.length) return null;
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;

    const versionBits = (bytes[at + 1] >> 3) & 0x03;
    const layerBits = (bytes[at + 1] >> 1) & 0x03;

    if (versionBits === 1 || layerBits === 0) return null;

    const bitrateIndex = (bytes[at + 2] >> 4) & 0x0f;
    const rateIndex = (bytes[at + 2] >> 2) & 0x03;

    if (rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) return null;

    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = 4 - layerBits;
    const sampleRate = MPEG_SAMPLE_RATES[version][rateIndex];
    const bitrate = MPEG_BITRATES[version === 1 ? 1 : 2][layer][bitrateIndex] * 1000;

    if (!sampleRate || !bitrate) return null;

    const padding = (bytes[at + 2] >> 1) & 0x01;
    const modeBits = (bytes[at + 3] >> 6) & 0x03;
    const channels = modeBits === 3 ? 1 : 2;
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
    // Layer I counts its padding in four-byte slots; II and III in single bytes.
    const frameLength =
      layer === 1
        ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
        : Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;

    if (frameLength < 4) return null;

    return {
      offset: at,
      version,
      layer,
      sampleRate,
      bitrate,
      padding,
      channels,
      channelMode: MPEG_CHANNEL_MODES[modeBits],
      crc: (bytes[at + 1] & 0x01) === 0,
      samplesPerFrame,
      frameLength,
      sideInfoSize: version === 1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17,
    };
  }

  /* The Xing / Info / VBRI table, which lives inside the first frame's side-info
   * area. "Info" means the encoder wrote a constant bitrate; "Xing" means it did
   * not. A LAME tag after it carries the gapless delay and padding counts. */
  function readVbrHeader(bytes, header) {
    const xingAt = header.offset + 4 + (header.crc ? 2 : 0) + header.sideInfoSize;
    const tag = fourCC(bytes, xingAt);

    if (tag === "Xing" || tag === "Info") {
      const flags = u32be(bytes, xingAt + 4);
      const out = { kind: tag, offset: xingAt, frames: null, bytes: null, encoder: "" };
      let cursor = xingAt + 8;

      if (flags & 0x01) {
        out.frames = u32be(bytes, cursor);
        cursor += 4;
      }

      if (flags & 0x02) {
        out.bytes = u32be(bytes, cursor);
        cursor += 4;
      }

      if (flags & 0x04) cursor += 100; // table of contents
      if (flags & 0x08) cursor += 4; // quality indicator

      if (fourCC(bytes, cursor) === "LAME") {
        out.encoder = latin1(bytes, cursor, 9);

        // Gapless: 12 bits of encoder delay then 12 bits of padding, 21 bytes in.
        const delayAt = cursor + 21;

        if (delayAt + 3 <= bytes.length) {
          out.encoderDelay = (bytes[delayAt] << 4) | (bytes[delayAt + 1] >> 4);
          out.encoderPadding = ((bytes[delayAt + 1] & 0x0f) << 8) | bytes[delayAt + 2];
        }
      }

      return out;
    }

    const vbriAt = header.offset + 4 + 32;

    if (fourCC(bytes, vbriAt) === "VBRI") {
      return {
        kind: "VBRI",
        offset: vbriAt,
        bytes: u32be(bytes, vbriAt + 10),
        frames: u32be(bytes, vbriAt + 14),
        encoder: "Fraunhofer",
      };
    }

    return null;
  }

  /* Two chained headers, not one.
   *
   * A single valid-looking header happens by accident inside album art all the
   * time; the next frame landing exactly where this one says it will is not
   * chance. Every sync decision in this file goes through here. */
  function framePairAt(bytes, at) {
    const header = parseFrameHeader(bytes, at);

    if (!header) return null;

    return parseFrameHeader(bytes, at + header.frameLength) ? header : null;
  }

  /* Walk every frame in the file.
   *
   * Walking all of them rather than trusting the Xing count is what makes the
   * duration exact for a file somebody cut with a byte editor, and it is what
   * turns "VBR" from a claim in a header into an observed set of bitrates. */
  function parseMpeg(bytes) {
    const warnings = [];

    if (!bytes || bytes.length < 4) {
      return { ok: false, error: "File is too short to hold an MPEG frame.", chunks: [], warnings, info: {} };
    }

    const id3v2 = readId3v2(bytes);
    const id3v1 = readId3v1(bytes);
    const end = id3v1 ? id3v1.offset : bytes.length;
    const tagEnd = id3v2 ? id3v2.size : 0;
    const searchLimit = Math.min(end, tagEnd + MAX_RESYNC_SCAN);

    let at = tagEnd;
    let first = null;

    // Hunt for the first real frame: a tag size can be wrong, and some files
    // carry junk between the tag and the audio.
    while (at < searchLimit) {
      first = framePairAt(bytes, at);

      if (first) break;

      at += 1;
    }

    if (!first) {
      return {
        ok: false,
        error: "No MPEG audio frame found — this is not an MP3 this tool can read.",
        chunks: [],
        warnings,
        info: {},
      };
    }

    if (at > tagEnd) warnings.push(`Skipped ${at - tagEnd} bytes of junk before the first frame.`);

    const audioStart = at;
    const bitrateCounts = {};
    let frameCount = 0;
    let totalSamples = 0;
    let audioBytes = 0;
    let resyncs = 0;
    let cursor = at;

    while (cursor + 4 <= end && frameCount < MAX_MPEG_FRAMES) {
      const header = parseFrameHeader(bytes, cursor);

      if (!header) {
        // Lost the stream: scan for the next plausible frame rather than give up
        // on the rest of the file, which is what a player does too.
        let scan = cursor + 1;
        let found = null;

        while (scan + 4 <= end && scan < cursor + MAX_RESYNC_SCAN) {
          found = framePairAt(bytes, scan);

          if (found) break;

          scan += 1;
        }

        if (!found) break;

        resyncs += 1;
        cursor = scan;
        continue;
      }

      const kbps = header.bitrate / 1000;

      bitrateCounts[kbps] = (bitrateCounts[kbps] || 0) + 1;
      frameCount += 1;
      totalSamples += header.samplesPerFrame;
      audioBytes += header.frameLength;
      cursor += header.frameLength;
    }

    if (resyncs) warnings.push(`Re-synchronised ${resyncs} time(s) — the frame stream has damage in it.`);
    if (frameCount >= MAX_MPEG_FRAMES) warnings.push(`Stopped after ${MAX_MPEG_FRAMES} frames.`);

    const vbr = readVbrHeader(bytes, first);

    // A Xing table counts the audio frames and, by convention, leaves out the
    // frame it is itself sitting in — so a difference of one is normal and is not
    // worth mentioning. A larger gap means the file is not the file the encoder
    // wrote: a truncated download is the usual cause.
    if (vbr && vbr.frames && Math.abs(vbr.frames - frameCount) > 1) {
      warnings.push(`The ${vbr.kind} table claims ${vbr.frames} frames but the file holds ${frameCount}.`);
    }
    // Observed, not claimed: more than one bitrate in the file means it varies.
    const bitrateMode = Object.keys(bitrateCounts).length > 1 ? "VBR" : "CBR";
    const duration = first.sampleRate > 0 ? totalSamples / first.sampleRate : 0;
    const info = {};

    if (id3v2) Object.assign(info, id3v2.info);

    if (id3v1) {
      // ID3v1 fills only the gaps: the v2 tag is longer and newer.
      Object.keys(id3v1.info).forEach(function (key) {
        if (!info[key] && id3v1.info[key]) info[key] = id3v1.info[key];
      });
    }

    if (vbr && vbr.encoder) info.encoder = vbr.encoder;

    const chunks = [];

    if (id3v2) {
      const fields = Object.keys(id3v2.info).length;

      chunks.push({
        id: "ID3v2",
        offset: id3v2.offset,
        size: id3v2.size,
        bodyAt: id3v2.offset + 10,
        bodyLength: id3v2.size - 10,
        note: `tag v${id3v2.version}${fields ? ` · ${fields} fields` : ""}`,
      });
    }

    if (vbr) {
      chunks.push({
        id: vbr.kind,
        offset: vbr.offset,
        size: 4,
        bodyAt: vbr.offset,
        bodyLength: 4,
        note: `${vbr.kind === "Info" ? "CBR" : "VBR"} table${vbr.encoder ? ` · ${vbr.encoder}` : ""}`,
      });
    }

    chunks.push({
      id: "frames",
      offset: audioStart,
      size: audioBytes,
      bodyAt: audioStart,
      bodyLength: audioBytes,
      note: `${frameCount} frames · ${first.samplesPerFrame} samples each`,
    });

    if (id3v1) {
      chunks.push({
        id: "ID3v1",
        offset: id3v1.offset,
        size: 128,
        bodyAt: id3v1.offset,
        bodyLength: 128,
        note: "trailing tag",
      });
    }

    return {
      ok: true,
      container: "mp3",
      chunks,
      warnings,
      info,
      id3v2,
      id3v1,
      vbr,
      first,
      audioStart,
      audioEnd: Math.min(cursor, end),
      frameCount,
      totalSamples,
      audioBytes,
      bitrateCounts,
      bitrateMode,
      averageBitrate: duration > 0 ? (audioBytes * 8) / duration : first.bitrate,
      duration,
      // The same shape `parseRiff` returns, so the console reads one set of
      // fields whichever container it opened.
      format: {
        formatName: `${MPEG_VERSION_NAMES[first.version]} ${MPEG_LAYER_NAMES[first.layer]}`,
        channels: first.channels,
        channelMode: first.channelMode,
        sampleRate: first.sampleRate,
        bitsPerSample: 0,
        extensible: false,
      },
    };
  }

  /* Cut the frame stream at the first frame boundary past `seconds`.
   *
   * A byte range of whole frames is still a decodable MP3, which is how the
   * console bounds what it asks the browser codec for. Without this, a two-hour
   * file would be decoded to Float32 in full before anything could be truncated.
   * The ID3 tags are left out: they are metadata, and no decoder needs them. */
  function mpegSlice(bytes, parsed, seconds) {
    const budget = seconds > 0 ? seconds : Infinity;
    const rate = parsed.first.sampleRate;
    let cursor = parsed.audioStart;
    let samples = 0;
    let frames = 0;

    while (cursor + 4 <= parsed.audioEnd && frames < MAX_MPEG_FRAMES) {
      const header = parseFrameHeader(bytes, cursor);

      if (!header) break;
      if (samples / rate >= budget) break;

      samples += header.samplesPerFrame;
      cursor += header.frameLength;
      frames += 1;
    }

    return {
      bytes: bytes.slice(parsed.audioStart, cursor),
      frames,
      seconds: samples / rate,
      truncated: cursor < parsed.audioEnd,
    };
  }

  /* Which container is this? By signature, never by file name: an `.mp3` that
   * opens with RIFF is a WAV somebody renamed. */
  function detectContainer(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (fourCC(bytes, 0) === "RIFF" && bytes.length >= 12 && fourCC(bytes, 8) === "WAVE") return "wav";
    if (fourCC(bytes, 0).slice(0, 3) === "ID3") return "mp3";

    const limit = Math.min(bytes.length, 4096);

    for (let at = 0; at < limit; at += 1) {
      if (framePairAt(bytes, at)) return "mp3";
    }

    return null;
  }

  // ------------------------------------------------------------ sample decoding

  /* Unpack the data chunk into one Float32Array per channel, normalised to
   * -1..1.
   *
   * Integer PCM is signed and little-endian at every width except 8-bit, which
   * is unsigned with 128 as silence — an inconsistency in the format itself,
   * not a bug here. Floats are already normalised and only need copying, though
   * nothing guarantees they stay inside the range. */
  function decodeSamples(bytes, parsed, options) {
    const settings = options || {};
    const { format, data } = parsed;
    const frameBytes = format.blockAlign || format.channels * format.bytesPerSample;
    const limit = settings.maxFrames > 0 ? Math.min(parsed.frames, settings.maxFrames) : parsed.frames;
    const channels = [];
    const isFloat = format.effectiveTag === FORMAT_FLOAT;
    const bits = format.bitsPerSample;

    if (!isFloat && format.effectiveTag !== FORMAT_PCM) {
      return { ok: false, error: `${format.formatName} is not decoded by this tool — PCM and IEEE float only.`, channels: [] };
    }

    if (isFloat && bits !== 32 && bits !== 64) {
      return { ok: false, error: `${bits}-bit float is not a thing this tool reads.`, channels: [] };
    }

    if (!isFloat && bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32) {
      return { ok: false, error: `${bits}-bit PCM is not a width this tool reads.`, channels: [] };
    }

    for (let c = 0; c < format.channels; c += 1) channels.push(new Float32Array(limit));

    // One DataView over the whole buffer; float reads need it and it is the
    // cheapest way to get little-endian semantics without branching per byte.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let clipped = 0;

    for (let frame = 0; frame < limit; frame += 1) {
      const frameAt = data.offset + frame * frameBytes;

      for (let c = 0; c < format.channels; c += 1) {
        const at = frameAt + c * format.bytesPerSample;
        let value = 0;

        if (isFloat) {
          value = bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
        } else if (bits === 8) {
          value = (bytes[at] - 128) / 128;
        } else if (bits === 16) {
          value = view.getInt16(at, true) / 32768;
        } else if (bits === 24) {
          // No getInt24: assemble it, then sign-extend from bit 23.
          const raw = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);

          value = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
        } else {
          value = view.getInt32(at, true) / 2147483648;
        }

        if (value >= 1 || value <= -1) clipped += 1;

        channels[c][frame] = value;
      }
    }

    return {
      ok: true,
      channels,
      frames: limit,
      truncated: limit < parsed.frames,
      clipped,
      sampleRate: format.sampleRate,
    };
  }

  function mixToMono(channels) {
    if (!channels.length) return new Float32Array(0);
    if (channels.length === 1) return channels[0];

    const frames = channels[0].length;
    const out = new Float32Array(frames);
    const scale = 1 / channels.length;

    for (let i = 0; i < frames; i += 1) {
      let sum = 0;

      for (let c = 0; c < channels.length; c += 1) sum += channels[c][i];

      out[i] = sum * scale;
    }

    return out;
  }

  // ------------------------------------------------------------------------ FFT

  /* Everything a transform of one size needs, computed once: the twiddle
   * factors and the bit-reversal permutation. Reusing a plan across a few
   * thousand frames is the difference between a spectrogram that appears and
   * one that hangs the tab. */
  function makePlan(size) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new RangeError(`FFT size must be a power of two of at least 2, got ${size}`);
    }

    const half = size >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    const reverse = new Uint32Array(size);

    for (let i = 0; i < half; i += 1) {
      // Negative angle: this is the forward transform.
      cos[i] = Math.cos((-2 * Math.PI * i) / size);
      sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }

    for (let i = 1, j = 0; i < size; i += 1) {
      let bit = size >> 1;

      for (; j & bit; bit >>= 1) j ^= bit;

      j ^= bit;
      reverse[i] = j;
    }

    return { size, half, cos, sin, reverse };
  }

  /* In-place iterative radix-2 Cooley-Tukey, decimation in time.
   *
   * The input is permuted into bit-reversed order first, which is what lets the
   * butterflies run over contiguous pairs afterwards instead of chasing a
   * recursive split. */
  function transform(plan, re, im) {
    const { size, reverse, cos, sin } = plan;

    for (let i = 0; i < size; i += 1) {
      const j = reverse[i];

      if (j > i) {
        let swap = re[i];

        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;

      for (let base = 0; base < size; base += len) {
        for (let k = 0; k < half; k += 1) {
          const tw = k * step;
          const wr = cos[tw];
          const wi = sin[tw];
          const a = base + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;

          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }

    return { re, im };
  }

  /* The slow, obviously-correct transform. Not used by the page — it exists so
   * the fast one can be checked against it. */
  function naiveDft(input) {
    const size = input.length;
    const re = new Float64Array(size);
    const im = new Float64Array(size);

    for (let k = 0; k < size; k += 1) {
      let sumRe = 0;
      let sumIm = 0;

      for (let n = 0; n < size; n += 1) {
        const angle = (-2 * Math.PI * k * n) / size;

        sumRe += input[n] * Math.cos(angle);
        sumIm += input[n] * Math.sin(angle);
      }

      re[k] = sumRe;
      im[k] = sumIm;
    }

    return { re, im };
  }

  // ------------------------------------------------------------------- windowing

  /* The window as a table, plus the coherent gain that keeps magnitudes
   * comparable when the window changes. */
  function makeWindow(name, size) {
    const shape = WINDOWS[name] || WINDOWS.hann;
    const values = new Float64Array(size);
    let sum = 0;

    for (let n = 0; n < size; n += 1) {
      values[n] = shape.at(n, size);
      sum += values[n];
    }

    return { name: WINDOWS[name] ? name : "hann", label: shape.label, values, gain: sum / size };
  }

  // ------------------------------------------------------------------ dB and bins

  function amplitudeToDb(amplitude) {
    // -Infinity is correct for silence but useless to a renderer; clamp low.
    return amplitude > 1e-12 ? 20 * Math.log10(amplitude) : -240;
  }

  function binToHz(bin, size, sampleRate) {
    return (bin * sampleRate) / size;
  }

  function hzToBin(hz, size, sampleRate) {
    return sampleRate > 0 ? (hz * size) / sampleRate : 0;
  }

  /* The frequency range the vertical axis spans. A log axis cannot start at
   * 0 Hz, so it starts at MIN_LOG_HZ; the linear axis reports the same pair so
   * both share one interface. */
  function axisBounds(sampleRate, options) {
    const settings = options || {};
    const nyquist = sampleRate / 2;
    const ceiling = Math.max(MIN_LOG_HZ * 2, nyquist);
    // Asking for 20 kHz on an 8 kHz file gets you Nyquist, not an empty band.
    const top = settings.maxHz > 0 ? Math.min(ceiling, settings.maxHz) : ceiling;
    const requested = settings.minHz > 0 ? settings.minHz : Math.min(MIN_LOG_HZ, top / 2);
    const bottom = Math.min(Math.max(0.5, requested), top / 2);

    return { bottom, top };
  }

  /* Where a frequency sits on the axis: 0 at the bottom of the plot, 1 at the
   * top. */
  function axisFraction(hz, bounds, logarithmic) {
    if (!logarithmic) return Math.max(0, Math.min(1, hz / bounds.top));
    if (!(hz > 0)) return 0;

    return Math.max(0, Math.min(1, Math.log(hz / bounds.bottom) / Math.log(bounds.top / bounds.bottom)));
  }

  /* The inverse. One implementation, walked forwards by the console's gridlines
   * and backwards by `scaleRows`, so a tick label cannot drift away from the
   * pixel row it points at. */
  function axisHz(fraction, bounds, logarithmic) {
    const t = Math.max(0, Math.min(1, fraction));

    return logarithmic ? bounds.bottom * Math.pow(bounds.top / bounds.bottom, t) : t * bounds.top;
  }

  /* Row-to-bin map for the frequency axis.
   *
   * Rows are returned top-down (row 0 is the highest frequency) because that is
   * how the canvas draws and how every spectrogram is read. */
  function scaleRows(rows, bins, size, sampleRate, logarithmic, options) {
    const map = new Float64Array(rows);
    const bounds = axisBounds(sampleRate, options);

    for (let row = 0; row < rows; row += 1) {
      // 1 at the top row, 0 at the bottom.
      const t = rows > 1 ? 1 - row / (rows - 1) : 1;

      map[row] = Math.min(bins - 1, hzToBin(axisHz(t, bounds, logarithmic), size, sampleRate));
    }

    return map;
  }

  // ------------------------------------------------------------- conditioning

  /* Two optional passes over the samples before any transform runs.
   *
   * Both change what the spectrogram *means*, so both are reported back to the
   * caller rather than applied silently: normalising moves every level reading
   * by a known number of dB, and pre-emphasis deliberately tilts the spectrum.
   * A tool whose readouts you cannot trace back to the file is a toy. */

  /* Scale so the loudest sample sits at `targetDb` (0 dBFS by default).
   *
   * Peak normalisation, not loudness normalisation: one transient decides the
   * gain for the whole file. That is the honest thing for an analysis tool,
   * where the question is usually "what is in here" rather than "how loud does
   * this feel". */
  function normalizePeak(samples, targetDb) {
    const target = Math.pow(10, (targetDb === undefined ? 0 : targetDb) / 20);
    let peak = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const magnitude = samples[i] < 0 ? -samples[i] : samples[i];

      if (magnitude > peak) peak = magnitude;
    }

    // Silence has no peak to normalise to, and scaling it by anything is still
    // silence — so say the pass did nothing rather than divide by zero.
    if (!peak) return { samples, gain: 1, gainDb: 0, applied: false, peak: 0 };

    const gain = target / peak;
    const out = new Float32Array(samples.length);

    for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain;

    return { samples: out, gain, gainDb: amplitudeToDb(gain), applied: true, peak };
  }

  /* First-order high-pass: y[n] = x[n] - a·x[n-1].
   *
   * The standard speech-analysis pre-emphasis. It lifts the high end by roughly
   * 6 dB per octave, which makes upper formants and consonant detail visible on
   * a spectrogram that natural spectral tilt would otherwise bury. A coefficient
   * of 0 is the identity, so the toggle needs no separate bypass path. */
  function preEmphasis(samples, coefficient) {
    const a = coefficient === undefined ? 0.97 : Math.max(0, Math.min(0.999, coefficient));
    const out = new Float32Array(samples.length);
    let previous = 0;

    for (let i = 0; i < samples.length; i += 1) {
      out[i] = samples[i] - a * previous;
      previous = samples[i];
    }

    return out;
  }

  /* The FFT size whose frame comes closest to a window of `ms` milliseconds.
   *
   * Chosen in log space, because 3000 samples is perceptually mid-way between
   * 2048 and 4096 rather than closer to the one it is nearer in absolute terms.
   * Speech work wants 25 ms, transient work wants 5; expressing the choice in
   * time rather than in bins is what makes those numbers usable. */
  function sizeForWindowMs(ms, sampleRate) {
    if (!(ms > 0) || !(sampleRate > 0)) return DEFAULT_FFT_SIZE;

    const target = (ms / 1000) * sampleRate;
    let best = FFT_SIZES[0];
    let bestDistance = Infinity;

    for (const size of FFT_SIZES) {
      const distance = Math.abs(Math.log2(size / target));

      if (distance < bestDistance) {
        bestDistance = distance;
        best = size;
      }
    }

    return best;
  }

  // -------------------------------------------------------------- spectrogram

  /* How many frames fit, and how far apart, given a column budget.
   *
   * The hop is whatever spreads the requested number of columns across the
   * whole signal, with the overlap setting as a floor on quality: a short file
   * gets dense overlap, a long one gets a wider stride, and both produce the
   * same bounded amount of work. */
  function planFrames(sampleCount, size, overlap, maxColumns) {
    const budget = Math.max(1, Math.min(maxColumns || DEFAULT_COLUMNS, MAX_COLUMNS));
    const share = Math.min(0.95, Math.max(0, overlap === undefined ? 0.5 : overlap));
    const denseHop = Math.max(1, Math.round(size * (1 - share)));
    const usable = Math.max(0, sampleCount - size);

    if (sampleCount < size) {
      return { columns: sampleCount > 0 ? 1 : 0, hop: denseHop, size, dense: true };
    }

    const denseColumns = Math.floor(usable / denseHop) + 1;

    if (denseColumns <= budget) {
      return { columns: denseColumns, hop: denseHop, size, dense: true };
    }

    return { columns: budget, hop: Math.max(1, Math.floor(usable / (budget - 1)) || 1), size, dense: false };
  }

  /* The picture: one column of magnitudes in dB per frame.
   *
   * Columns are stored back to back in a single Float32Array — `columns × bins`
   * floats — because a few thousand small arrays is a few thousand allocations
   * the renderer then has to chase. */
  function spectrogram(samples, sampleRate, options) {
    const settings = options || {};
    const size = FFT_SIZES.indexOf(settings.size) === -1 ? DEFAULT_FFT_SIZE : settings.size;
    const plan = settings.plan && settings.plan.size === size ? settings.plan : makePlan(size);
    const window = makeWindow(settings.window || "hann", size);
    const layout = planFrames(samples.length, size, settings.overlap, settings.maxColumns);
    const bins = size / 2 + 1;
    const magnitudes = new Float32Array(layout.columns * bins);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    // A real signal's spectrum is symmetric, so the energy in a bin is split
    // between it and its mirror; doubling recovers the amplitude of the tone.
    const normalise = 2 / (size * window.gain);

    let loudest = -240;
    let loudestColumn = 0;
    let loudestBin = 0;

    for (let column = 0; column < layout.columns; column += 1) {
      const start = column * layout.hop;

      for (let n = 0; n < size; n += 1) {
        const index = start + n;

        re[n] = index < samples.length ? samples[index] * window.values[n] : 0;
        im[n] = 0;
      }

      transform(plan, re, im);

      const columnAt = column * bins;

      for (let bin = 0; bin < bins; bin += 1) {
        // DC and Nyquist have no mirror to fold back in.
        const fold = bin === 0 || bin === bins - 1 ? 0.5 : 1;
        const amplitude = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]) * normalise * fold;
        const db = amplitudeToDb(amplitude);

        magnitudes[columnAt + bin] = db;

        if (db > loudest) {
          loudest = db;
          loudestColumn = column;
          loudestBin = bin;
        }
      }
    }

    return {
      magnitudes,
      columns: layout.columns,
      bins,
      size,
      hop: layout.hop,
      dense: layout.dense,
      sampleRate,
      window: window.name,
      windowGain: window.gain,
      duration: sampleRate > 0 ? samples.length / sampleRate : 0,
      binHz: sampleRate / size,
      frameSeconds: sampleRate > 0 ? size / sampleRate : 0,
      hopSeconds: sampleRate > 0 ? layout.hop / sampleRate : 0,
      peak: {
        db: loudest,
        column: loudestColumn,
        bin: loudestBin,
        hz: binToHz(loudestBin, size, sampleRate),
        seconds: sampleRate > 0 ? (loudestColumn * layout.hop + size / 2) / sampleRate : 0,
      },
      plan,
    };
  }

  /* Interpolate the true peak frequency from three magnitude samples.
   *
   * A tone almost never sits exactly on a bin, and a parabola through the peak
   * bin and its neighbours recovers the fraction of a bin it sits off by — the
   * difference between reading "430 Hz" and reading "440.1 Hz". */
  function refinePeak(magnitudes, columnAt, bin, bins) {
    if (bin <= 0 || bin >= bins - 1) return bin;

    const left = magnitudes[columnAt + bin - 1];
    const middle = magnitudes[columnAt + bin];
    const right = magnitudes[columnAt + bin + 1];
    const divisor = left - 2 * middle + right;

    if (!divisor) return bin;

    const offset = (0.5 * (left - right)) / divisor;

    return bin + Math.max(-0.5, Math.min(0.5, offset));
  }

  function dominantFrequency(picture) {
    const columnAt = picture.peak.column * picture.bins;
    const refined = refinePeak(picture.magnitudes, columnAt, picture.peak.bin, picture.bins);

    return binToHz(refined, picture.size, picture.sampleRate);
  }

  // ------------------------------------------------------------------- readouts

  function measure(samples) {
    let sumSquares = 0;
    let peak = 0;
    let clipped = 0;
    let dcSum = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i];
      const magnitude = value < 0 ? -value : value;

      sumSquares += value * value;
      dcSum += value;

      if (magnitude > peak) peak = magnitude;
      if (magnitude >= 1) clipped += 1;
    }

    const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;

    return {
      rms,
      rmsDb: amplitudeToDb(rms),
      peak,
      peakDb: amplitudeToDb(peak),
      clipped,
      // Anything but zero here means the signal is offset from silence, which
      // wastes headroom and shows up as a bright bin 0.
      dcOffset: samples.length ? dcSum / samples.length : 0,
      // Peak-to-RMS: high means transients, low means something is squashed.
      crestDb: amplitudeToDb(peak) - amplitudeToDb(rms),
    };
  }

  /* Min and max per horizontal bucket — the shape a waveform strip draws. */
  function waveformEnvelope(samples, buckets) {
    const count = Math.max(1, Math.min(buckets || 600, samples.length || 1));
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    const per = samples.length / count;

    for (let bucket = 0; bucket < count; bucket += 1) {
      const from = Math.floor(bucket * per);
      const to = Math.max(from + 1, Math.floor((bucket + 1) * per));
      let low = 0;
      let high = 0;

      for (let i = from; i < to && i < samples.length; i += 1) {
        if (samples[i] < low) low = samples[i];
        if (samples[i] > high) high = samples[i];
      }

      min[bucket] = low;
      max[bucket] = high;
    }

    return { min, max, buckets: count };
  }

  const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  /* Nearest equal-tempered note and how far off it is, in cents. A440, MIDI 69.
   * Turns "1046 Hz" into "C6, +1 cent", which is the form a musician can act on. */
  function noteForHz(hz) {
    if (!(hz > 0)) return null;

    const midi = 69 + 12 * Math.log2(hz / 440);
    const nearest = Math.round(midi);
    const cents = Math.round((midi - nearest) * 100);

    return {
      name: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`,
      midi: nearest,
      cents,
    };
  }

  // ---------------------------------------------------------------- colour ramp

  /* Sample a ramp at 0..1, interpolating between its stops. */
  function sampleRamp(name, t) {
    const ramp = RAMPS[name] || RAMPS.abyss;
    const stops = ramp.stops;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const position = clamped * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    const fraction = position - index;
    const from = stops[index];
    const to = stops[index + 1];

    return [
      Math.round(from[0] + (to[0] - from[0]) * fraction),
      Math.round(from[1] + (to[1] - from[1]) * fraction),
      Math.round(from[2] + (to[2] - from[2]) * fraction),
    ];
  }

  /* A 256-entry lookup table for the ramp. The renderer touches it once per
   * pixel, so it must not be interpolating on the way. */
  function rampTable(name) {
    const table = new Uint8Array(256 * 3);

    for (let i = 0; i < 256; i += 1) {
      const [r, g, b] = sampleRamp(name, i / 255);

      table[i * 3] = r;
      table[i * 3 + 1] = g;
      table[i * 3 + 2] = b;
    }

    return table;
  }

  // ------------------------------------------------------------- test signals

  /* Small xorshift so the noise signal is reproducible. Deliberately local and
   * minimal rather than a third copy of the seed machinery in `glitch-machine`
   * and `noise-loom` — those want hex round-trips and recipes, this wants a
   * repeatable hiss. */
  function xorshift(seed) {
    let state = seed | 0 || 0x9e3779b9;

    return function () {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;

      return (state >>> 0) / 4294967296;
    };
  }

  /* Signals with known spectra, so the bench can be read before any file is
   * loaded — and so the tests have something whose answer is arithmetic. */
  function synthesize(kind, sampleRate, seconds, options) {
    const settings = options || {};
    const rate = sampleRate > 0 ? sampleRate : 44100;
    const frames = Math.max(1, Math.round(rate * (seconds > 0 ? seconds : 1)));
    const out = new Float32Array(frames);
    const amplitude = settings.amplitude === undefined ? 0.7 : settings.amplitude;
    const random = xorshift(settings.seed === undefined ? 0x5eed : settings.seed);

    for (let i = 0; i < frames; i += 1) {
      const t = i / rate;

      if (kind === "sine") {
        out[i] = amplitude * Math.sin(2 * Math.PI * 440 * t);
      } else if (kind === "twoTone") {
        out[i] = amplitude * 0.5 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 445 * t));
      } else if (kind === "square") {
        out[i] = amplitude * (Math.sin(2 * Math.PI * 220 * t) >= 0 ? 1 : -1);
      } else if (kind === "saw") {
        const phase = (110 * t) % 1;

        out[i] = amplitude * (2 * phase - 1);
      } else if (kind === "chirp") {
        // Linear sweep: instantaneous frequency rises, so the phase is the
        // integral of it — quadratic in t, not linear.
        const span = seconds > 0 ? seconds : 1;
        const from = 40;
        const to = 8000;
        const sweep = from * t + ((to - from) * t * t) / (2 * span);

        out[i] = amplitude * Math.sin(2 * Math.PI * sweep);
      } else if (kind === "noise") {
        out[i] = amplitude * (random() * 2 - 1);
      } else {
        out[i] = 0;
      }
    }

    return out;
  }

  return {
    FFT_SIZES,
    DEFAULT_FFT_SIZE,
    MAX_COLUMNS,
    DEFAULT_COLUMNS,
    DB_FLOOR_RANGE,
    DEFAULT_DB_FLOOR,
    MIN_LOG_HZ,
    WINDOWS,
    RAMPS,
    SIGNALS,
    EXPORT_SIZES,
    WINDOW_LENGTHS,
    FREQUENCY_RANGES,
    FORMAT_NAMES,
    MPEG_VERSION_NAMES,
    MPEG_LAYER_NAMES,
    MPEG_SAMPLE_RATES,
    MPEG_BITRATES,
    detectContainer,
    parseRiff,
    parseMpeg,
    parseFrameHeader,
    framePairAt,
    mpegSlice,
    readId3v2,
    readId3v1,
    readVbrHeader,
    synchsafe,
    decodeSamples,
    mixToMono,
    makePlan,
    transform,
    naiveDft,
    makeWindow,
    amplitudeToDb,
    binToHz,
    hzToBin,
    axisBounds,
    axisFraction,
    axisHz,
    scaleRows,
    normalizePeak,
    preEmphasis,
    sizeForWindowMs,
    planFrames,
    spectrogram,
    refinePeak,
    dominantFrequency,
    measure,
    waveformEnvelope,
    noteForHz,
    sampleRamp,
    rampTable,
    synthesize,
    formatBytes,
    formatDuration,
  };
});
