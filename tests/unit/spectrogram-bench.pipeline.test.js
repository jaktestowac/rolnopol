import { describe, it, expect } from "vitest";

// The same file the browser loads — it is wrapped UMD-style precisely so the
// transform can be checked against arithmetic instead of by eye in a canvas.
const pipeline = require("../../public/js/pages/spectrogram-bench-pipeline.js");

// --------------------------------------------------------------------- builders

const chars = (text) => [...text].map((character) => character.charCodeAt(0));
const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

const PCM_SUBFORMAT_GUID = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

function encodeSample(value, bits, float) {
  if (float && bits === 32) {
    const buffer = new ArrayBuffer(4);

    new DataView(buffer).setFloat32(0, value, true);

    return [...new Uint8Array(buffer)];
  }

  if (float && bits === 64) {
    const buffer = new ArrayBuffer(8);

    new DataView(buffer).setFloat64(0, value, true);

    return [...new Uint8Array(buffer)];
  }

  if (bits === 8) return [Math.max(0, Math.min(255, Math.round(value * 128) + 128))];
  if (bits === 16) {
    const raw = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));

    return u16(raw < 0 ? raw + 0x10000 : raw);
  }
  if (bits === 24) {
    const raw = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388608)));
    const unsigned = raw < 0 ? raw + 0x1000000 : raw;

    return [unsigned & 0xff, (unsigned >> 8) & 0xff, (unsigned >> 16) & 0xff];
  }

  const raw = Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483648)));

  return u32(raw < 0 ? raw + 0x100000000 : raw);
}

/* A real WAV, assembled byte by byte, so the parser is tested against the
 * format rather than against a fixture somebody generated with a library. */
function wav(options) {
  const settings = options || {};
  const bits = settings.bits || 16;
  const float = settings.float === true;
  const sampleRate = settings.sampleRate || 8000;
  const channels = settings.channels || [[0, 0.5, -0.5, 1]];
  const bytesPerSample = Math.ceil(bits / 8);
  const blockAlign = channels.length * bytesPerSample;
  const frames = channels[0].length;

  const data = [];

  for (let frame = 0; frame < frames; frame += 1) {
    for (let c = 0; c < channels.length; c += 1) {
      data.push(...encodeSample(channels[c][frame], bits, float));
    }
  }

  const tag = settings.extensible ? 0xfffe : float ? 3 : 1;
  const fmtBody = [
    ...u16(tag),
    ...u16(channels.length),
    ...u32(sampleRate),
    ...u32(sampleRate * blockAlign),
    ...u16(blockAlign),
    ...u16(bits),
  ];

  if (settings.extensible) {
    fmtBody.push(...u16(22), ...u16(bits), ...u32(0), ...PCM_SUBFORMAT_GUID);
  }

  const body = [...chars("WAVE")];

  if (settings.info) {
    const entries = [];

    for (const [tagName, text] of Object.entries(settings.info)) {
      const value = [...chars(text), 0];

      if (value.length & 1) value.push(0); // INFO values are word-aligned too
      entries.push(...chars(tagName), ...u32(value.length), ...value);
    }

    const list = [...chars("INFO"), ...entries];

    body.push(...chars("LIST"), ...u32(list.length), ...list);
  }

  if (settings.junkChunk) {
    // Odd size on purpose: the walk must step over the pad byte.
    const junk = chars("odd");

    body.push(...chars("JUNK"), ...u32(junk.length), ...junk, 0);
  }

  body.push(...chars("fmt "), ...u32(fmtBody.length), ...fmtBody);
  body.push(...chars("data"), ...u32(settings.declaredDataSize === undefined ? data.length : settings.declaredDataSize), ...data);

  return Uint8Array.from([...chars("RIFF"), ...u32(body.length), ...body]);
}

/* A sine that lands exactly on a bin, so a rectangular-window reading is exact
 * arithmetic rather than an approximation blurred by leakage. */
function binExactSine(size, bin, amplitude) {
  const out = new Float32Array(size);

  for (let i = 0; i < size; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * bin * i) / size);
  }

  return out;
}

function deterministicSignal(size) {
  const out = new Float64Array(size);
  let state = 0x2545f491;

  for (let i = 0; i < size; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = ((state >>> 0) / 4294967296) * 2 - 1;
  }

  return out;
}

const magnitudesOf = (re, im) => re.map((value, i) => Math.hypot(value, im[i]));

// ------------------------------------------------------------------------ tests

describe("spectrogram bench pipeline", () => {
  describe("FFT", () => {
    it("agrees with a naive DFT", () => {
      const size = 256;
      const signal = deterministicSignal(size);
      const plan = pipeline.makePlan(size);
      const re = Float64Array.from(signal);
      const im = new Float64Array(size);

      pipeline.transform(plan, re, im);

      const slow = pipeline.naiveDft(signal);
      const fast = magnitudesOf([...re], [...im]);
      const reference = magnitudesOf([...slow.re], [...slow.im]);

      for (let bin = 0; bin < size; bin += 1) {
        expect(fast[bin], `bin ${bin}`).toBeCloseTo(reference[bin], 6);
      }
    });

    it("turns an impulse into a flat spectrum", () => {
      const size = 64;
      const plan = pipeline.makePlan(size);
      const re = new Float64Array(size);
      const im = new Float64Array(size);

      re[0] = 1;
      pipeline.transform(plan, re, im);

      for (let bin = 0; bin < size; bin += 1) {
        expect(Math.hypot(re[bin], im[bin]), `bin ${bin}`).toBeCloseTo(1, 10);
      }
    });

    it("conserves energy (Parseval)", () => {
      const size = 128;
      const signal = deterministicSignal(size);
      const plan = pipeline.makePlan(size);
      const re = Float64Array.from(signal);
      const im = new Float64Array(size);

      let timeEnergy = 0;

      for (let i = 0; i < size; i += 1) timeEnergy += signal[i] * signal[i];

      pipeline.transform(plan, re, im);

      let bandEnergy = 0;

      for (let bin = 0; bin < size; bin += 1) bandEnergy += re[bin] * re[bin] + im[bin] * im[bin];

      expect(bandEnergy / size).toBeCloseTo(timeEnergy, 6);
    });

    it("puts a bin-exact sine in exactly that bin", () => {
      const size = 512;
      const plan = pipeline.makePlan(size);
      const re = Float64Array.from(binExactSine(size, 40, 1));
      const im = new Float64Array(size);

      pipeline.transform(plan, re, im);

      const magnitudes = magnitudesOf([...re], [...im]);
      const loudest = magnitudes.indexOf(Math.max(...magnitudes.slice(0, size / 2 + 1)));

      expect(loudest).toBe(40);
      // A unit sine splits size/2 of amplitude between the bin and its mirror.
      // Four places, not more: the signal is stored as float32 before the
      // transform reads it, and that rounding is worth ~2e-6 here.
      expect(magnitudes[40]).toBeCloseTo(size / 2, 4);
    });

    it("refuses a size that is not a power of two", () => {
      expect(() => pipeline.makePlan(1000)).toThrow(RangeError);
      expect(() => pipeline.makePlan(0)).toThrow(RangeError);
      expect(() => pipeline.makePlan(2.5)).toThrow(RangeError);
      expect(() => pipeline.makePlan(1024)).not.toThrow();
    });

    it("reuses a plan across calls without drifting", () => {
      const plan = pipeline.makePlan(64);
      const first = new Float64Array(64);
      const second = new Float64Array(64);

      first[3] = 1;
      second[3] = 1;

      pipeline.transform(plan, first, new Float64Array(64));
      pipeline.transform(plan, second, new Float64Array(64));

      expect([...first]).toEqual([...second]);
    });
  });

  describe("windows", () => {
    it("reports the coherent gain each window costs", () => {
      expect(pipeline.makeWindow("rectangular", 512).gain).toBe(1);
      expect(pipeline.makeWindow("hann", 512).gain).toBeCloseTo(0.5, 2);
      expect(pipeline.makeWindow("hamming", 512).gain).toBeCloseTo(0.54, 2);
      expect(pipeline.makeWindow("blackman", 512).gain).toBeCloseTo(0.42, 2);
    });

    it("falls back to Hann for an unknown name", () => {
      expect(pipeline.makeWindow("trapezoid", 64).name).toBe("hann");
    });

    // The whole point of dividing by the gain: the reading must not depend on
    // which window produced it.
    it("reads the same amplitude through every window", () => {
      const size = 1024;
      const samples = binExactSine(size * 4, 128, 0.5); // bin-exact at this size

      for (const name of Object.keys(pipeline.WINDOWS)) {
        const picture = pipeline.spectrogram(samples, size, { size, window: name });

        expect(picture.peak.db, `window ${name}`).toBeCloseTo(pipeline.amplitudeToDb(0.5), 0);
      }
    });
  });

  describe("decibels and bins", () => {
    it("converts amplitude to dBFS", () => {
      expect(pipeline.amplitudeToDb(1)).toBeCloseTo(0, 10);
      expect(pipeline.amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 3);
      expect(pipeline.amplitudeToDb(0.001)).toBeCloseTo(-60, 6);
      expect(pipeline.amplitudeToDb(0)).toBe(-240);
    });

    it("maps bins to frequencies and back", () => {
      expect(pipeline.binToHz(0, 2048, 44100)).toBe(0);
      expect(pipeline.binToHz(1024, 2048, 44100)).toBe(22050); // Nyquist
      expect(pipeline.hzToBin(22050, 2048, 44100)).toBe(1024);
      expect(pipeline.hzToBin(pipeline.binToHz(37, 512, 8000), 512, 8000)).toBeCloseTo(37, 10);
    });

    it("agrees with itself in both directions", () => {
      const bounds = pipeline.axisBounds(44100);

      expect(bounds.top).toBe(22050);
      expect(bounds.bottom).toBe(pipeline.MIN_LOG_HZ);

      for (const logarithmic of [true, false]) {
        for (const hz of [20, 100, 440, 1000, 5000, 22050]) {
          const fraction = pipeline.axisFraction(hz, bounds, logarithmic);

          expect(pipeline.axisHz(fraction, bounds, logarithmic), `${hz} Hz, log=${logarithmic}`).toBeCloseTo(hz, 6);
        }
      }
    });

    it("clamps the axis at both ends", () => {
      const bounds = pipeline.axisBounds(44100);

      expect(pipeline.axisFraction(0, bounds, true)).toBe(0);
      expect(pipeline.axisFraction(-100, bounds, true)).toBe(0);
      expect(pipeline.axisFraction(1e9, bounds, true)).toBe(1);
      expect(pipeline.axisFraction(0, bounds, false)).toBe(0);
      expect(pipeline.axisFraction(1e9, bounds, false)).toBe(1);
      expect(pipeline.axisHz(-1, bounds, true)).toBeCloseTo(bounds.bottom, 10);
      expect(pipeline.axisHz(2, bounds, true)).toBeCloseTo(bounds.top, 10);
    });

    // The console draws gridlines from `axisFraction` while the picture is
    // painted from `scaleRows`. A tick label that pointed at the wrong row would
    // be a lie told confidently, so the two must land on the same pixel.
    it("puts a gridline on the row that holds its frequency", () => {
      const rows = 512;
      const bounds = pipeline.axisBounds(44100);

      for (const logarithmic of [true, false]) {
        const map = pipeline.scaleRows(rows, 1025, 2048, 44100, logarithmic);

        for (const hz of [100, 440, 1000, 5000, 10000]) {
          const fraction = pipeline.axisFraction(hz, bounds, logarithmic);
          const row = Math.round((1 - fraction) * (rows - 1));
          const hzAtRow = pipeline.binToHz(map[row], 2048, 44100);

          // Compared as axis fractions, not as Hz: one row covers ~1.4% of the
          // frequency on a log axis, so the only meaningful tolerance is "within
          // half a pixel row" — which is what a tick label promises.
          const drift = Math.abs(pipeline.axisFraction(hzAtRow, bounds, logarithmic) - fraction);

          expect(drift, `${hz} Hz, log=${logarithmic}`).toBeLessThanOrEqual(0.5 / (rows - 1));
        }
      }
    });

    it("builds a top-down row map for both axis scales", () => {
      const linear = pipeline.scaleRows(100, 1025, 2048, 44100, false);
      const log = pipeline.scaleRows(100, 1025, 2048, 44100, true);

      expect(linear[0]).toBeCloseTo(1024, 6); // row 0 is the top: Nyquist
      expect(linear[99]).toBeCloseTo(0, 6);
      expect(linear[50]).toBeCloseTo(1024 * (1 - 50 / 99), 6);

      // Log axis: still monotonic top-down, but compressed at the top.
      for (let row = 1; row < 100; row += 1) {
        expect(log[row], `row ${row}`).toBeLessThanOrEqual(log[row - 1]);
      }

      expect(log[0]).toBeGreaterThan(log[50]);
      expect(pipeline.binToHz(log[99], 2048, 44100)).toBeLessThan(pipeline.MIN_LOG_HZ + 1);
    });
  });

  describe("frame planning", () => {
    it("uses the dense hop when the budget allows", () => {
      const plan = pipeline.planFrames(44100, 1024, 0.5, 1200);

      expect(plan.dense).toBe(true);
      expect(plan.hop).toBe(512);
      expect(plan.columns).toBe(Math.floor((44100 - 1024) / 512) + 1);
    });

    it("widens the stride instead of blowing the budget", () => {
      const plan = pipeline.planFrames(44100 * 600, 2048, 0.5, 1200);

      expect(plan.dense).toBe(false);
      expect(plan.columns).toBe(1200);
      expect(plan.hop).toBeGreaterThan(1024);
    });

    it("never exceeds the hard column cap", () => {
      const plan = pipeline.planFrames(44100 * 3600, 256, 0.9, 99999);

      expect(plan.columns).toBeLessThanOrEqual(pipeline.MAX_COLUMNS);
    });

    it("handles a signal shorter than one frame", () => {
      expect(pipeline.planFrames(100, 1024, 0.5, 100).columns).toBe(1);
      expect(pipeline.planFrames(0, 1024, 0.5, 100).columns).toBe(0);
    });
  });

  describe("spectrogram", () => {
    const sampleRate = 8192;
    const samples = binExactSine(sampleRate * 2, 256, 1); // 256 cycles per 8192 samples

    it("describes its own geometry", () => {
      const picture = pipeline.spectrogram(samples, sampleRate, { size: 1024, window: "hann", overlap: 0.5 });

      expect(picture.size).toBe(1024);
      expect(picture.bins).toBe(513); // size/2 + 1
      expect(picture.magnitudes.length).toBe(picture.columns * picture.bins);
      expect(picture.binHz).toBeCloseTo(8, 6);
      expect(picture.duration).toBeCloseTo(2, 6);
      expect(picture.window).toBe("hann");
    });

    it("finds the tone and reads back its amplitude", () => {
      const picture = pipeline.spectrogram(samples, sampleRate, { size: 1024, window: "rectangular" });

      // 256 cycles over 8192 samples = 256/2 = 128 Hz... in a 1024 frame that
      // is bin 16 exactly, which is why the reading is exact.
      expect(picture.peak.bin).toBe(16);
      expect(picture.peak.hz).toBeCloseTo(128, 6);
      expect(picture.peak.db).toBeCloseTo(0, 3);
    });

    it("recovers an off-bin frequency by interpolating the peak", () => {
      const rate = 44100;
      const seconds = 0.5;
      const frames = Math.round(rate * seconds);
      const tone = new Float32Array(frames);

      for (let i = 0; i < frames; i += 1) tone[i] = Math.sin((2 * Math.PI * 1000 * i) / rate);

      const picture = pipeline.spectrogram(tone, rate, { size: 2048, window: "hann" });

      // 1000 Hz sits at bin 46.44 — the raw peak bin cannot be right.
      expect(picture.peak.hz).not.toBeCloseTo(1000, 0);
      expect(pipeline.dominantFrequency(picture)).toBeCloseTo(1000, 0);
    });

    it("leaves the interpolation alone at the edges", () => {
      const magnitudes = Float32Array.from([-10, -3, -12]);

      expect(pipeline.refinePeak(magnitudes, 0, 0, 3)).toBe(0);
      expect(pipeline.refinePeak(magnitudes, 0, 2, 3)).toBe(2);

      // The left neighbour is louder than the right, so the true peak sits to
      // the *left* of the peak bin: the offset has to come out negative.
      expect(pipeline.refinePeak(magnitudes, 0, 1, 3)).toBeCloseTo(0.9375, 4);
    });

    it("puts a chirp's energy where the chirp is", () => {
      const rate = 16000;
      const signal = pipeline.synthesize("chirp", rate, 1);
      const picture = pipeline.spectrogram(signal, rate, { size: 512, window: "hann" });
      const loudestBinIn = (column) => {
        const at = column * picture.bins;
        let best = 0;

        for (let bin = 1; bin < picture.bins; bin += 1) {
          if (picture.magnitudes[at + bin] > picture.magnitudes[at + best]) best = bin;
        }

        return best;
      };

      const first = loudestBinIn(1);
      const middle = loudestBinIn(Math.floor(picture.columns / 2));
      const last = loudestBinIn(picture.columns - 2);

      expect(first).toBeLessThan(middle);
      expect(middle).toBeLessThan(last);
    });

    it("shows the square wave's odd harmonics and not its even ones", () => {
      const rate = 8800;
      const signal = pipeline.synthesize("square", rate, 1, { amplitude: 1 });
      const picture = pipeline.spectrogram(signal, rate, { size: 2048, window: "hann" });
      const at = picture.peak.column * picture.bins;
      const dbAtHz = (hz) => picture.magnitudes[at + Math.round(pipeline.hzToBin(hz, picture.size, rate))];

      // 220 Hz square: 660 and 1100 are present, 440 and 880 are not.
      expect(dbAtHz(660)).toBeGreaterThan(dbAtHz(440) + 20);
      expect(dbAtHz(1100)).toBeGreaterThan(dbAtHz(880) + 20);
    });

    it("accepts a supplied plan of the matching size", () => {
      const plan = pipeline.makePlan(512);
      const picture = pipeline.spectrogram(samples, sampleRate, { size: 512, plan });

      expect(picture.plan).toBe(plan);
    });

    it("falls back to the default size for a bad one", () => {
      expect(pipeline.spectrogram(samples, sampleRate, { size: 999 }).size).toBe(pipeline.DEFAULT_FFT_SIZE);
    });
  });

  describe("RIFF container", () => {
    it("parses a plain 16-bit mono file", () => {
      const parsed = pipeline.parseRiff(wav({ bits: 16, sampleRate: 8000 }));

      expect(parsed.ok).toBe(true);
      expect(parsed.format.formatName).toBe("PCM");
      expect(parsed.format.channels).toBe(1);
      expect(parsed.format.sampleRate).toBe(8000);
      expect(parsed.format.bitsPerSample).toBe(16);
      expect(parsed.frames).toBe(4);
      expect(parsed.duration).toBeCloseTo(4 / 8000, 10);
      expect(parsed.chunks.map((chunk) => chunk.id)).toEqual(["fmt ", "data"]);
      expect(parsed.warnings).toEqual([]);
    });

    it("looks past the extensible tag to the real format", () => {
      const parsed = pipeline.parseRiff(wav({ bits: 16, extensible: true }));

      expect(parsed.format.tag).toBe(0xfffe);
      expect(parsed.format.extensible).toBe(true);
      expect(parsed.format.effectiveTag).toBe(1);
      expect(parsed.format.formatName).toBe("PCM");
    });

    it("steps over an odd-sized chunk's pad byte", () => {
      const parsed = pipeline.parseRiff(wav({ junkChunk: true }));

      expect(parsed.ok).toBe(true);
      expect(parsed.chunks.map((chunk) => chunk.id)).toEqual(["JUNK", "fmt ", "data"]);
      expect(parsed.frames).toBe(4);
    });

    it("reads LIST/INFO metadata", () => {
      const parsed = pipeline.parseRiff(wav({ info: { INAM: "Field recording", IART: "Rolnopol", ISFT: "bytebeat" } }));

      expect(parsed.info).toEqual({ title: "Field recording", artist: "Rolnopol", software: "bytebeat" });
    });

    it("reports a data chunk that outruns the file", () => {
      const parsed = pipeline.parseRiff(wav({ declaredDataSize: 9999 }));

      expect(parsed.ok).toBe(true);
      expect(parsed.warnings.join(" ")).toMatch(/only \d+ remain/);
      expect(parsed.frames).toBe(4);
    });

    it("refuses what is not a WAVE", () => {
      expect(pipeline.parseRiff(Uint8Array.from(chars("not a riff at all!!"))).error).toMatch(/Expected a RIFF header/);
      expect(pipeline.parseRiff(Uint8Array.from([...chars("RIFF"), 0, 0, 0, 0, ...chars("AVI ")])).error).toMatch(/not WAVE/);
      expect(pipeline.parseRiff(Uint8Array.from([1, 2, 3])).error).toMatch(/too short/);
      expect(pipeline.parseRiff(null).ok).toBe(false);
    });

    it("says which part is missing", () => {
      const noData = Uint8Array.from([...chars("RIFF"), 0, 0, 0, 0, ...chars("WAVE")]);

      expect(pipeline.parseRiff(noData).error).toMatch(/No readable fmt chunk/);
    });
  });

  describe("sample decoding", () => {
    // Values chosen to be exactly representable at every width tested.
    const exact = [0, 0.5, -0.5, 0.25];

    for (const bits of [8, 16, 24, 32]) {
      it(`round-trips ${bits}-bit PCM`, () => {
        const bytes = wav({ bits, channels: [exact] });
        const parsed = pipeline.parseRiff(bytes);
        const decoded = pipeline.decodeSamples(bytes, parsed);

        expect(decoded.ok).toBe(true);
        expect(decoded.channels).toHaveLength(1);

        for (let i = 0; i < exact.length; i += 1) {
          expect(decoded.channels[0][i], `${bits}-bit sample ${i}`).toBeCloseTo(exact[i], 6);
        }
      });
    }

    for (const bits of [32, 64]) {
      it(`round-trips ${bits}-bit float`, () => {
        const values = [0, 0.3, -0.75, 0.999];
        const bytes = wav({ bits, float: true, channels: [values] });
        const parsed = pipeline.parseRiff(bytes);
        const decoded = pipeline.decodeSamples(bytes, parsed);

        expect(decoded.ok).toBe(true);

        for (let i = 0; i < values.length; i += 1) {
          expect(decoded.channels[0][i]).toBeCloseTo(values[i], 6);
        }
      });
    }

    it("de-interleaves stereo", () => {
      const left = [0.5, 0.25, -0.5];
      const right = [-0.5, 0.75, 0.125];
      const bytes = wav({ bits: 16, channels: [left, right] });
      const parsed = pipeline.parseRiff(bytes);
      const decoded = pipeline.decodeSamples(bytes, parsed);

      expect(decoded.channels).toHaveLength(2);
      expect([...decoded.channels[0]].map((v) => Math.round(v * 1000) / 1000)).toEqual(left);
      expect([...decoded.channels[1]].map((v) => Math.round(v * 1000) / 1000)).toEqual(right);
    });

    it("treats 8-bit as unsigned with 128 as silence", () => {
      const bytes = wav({ bits: 8, channels: [[0]] });
      const parsed = pipeline.parseRiff(bytes);

      expect(bytes[parsed.data.offset]).toBe(128);
      expect(pipeline.decodeSamples(bytes, parsed).channels[0][0]).toBe(0);
    });

    it("counts clipped samples", () => {
      const bytes = wav({ bits: 16, channels: [[1, -1, 0.5, 1]] });
      const parsed = pipeline.parseRiff(bytes);

      // +1.0 does not survive 16-bit signed, but -1.0 does, and so does the
      // clamped positive peak.
      expect(pipeline.decodeSamples(bytes, parsed).clipped).toBeGreaterThan(0);
    });

    it("stops at maxFrames and says so", () => {
      const bytes = wav({ bits: 16, channels: [[0.1, 0.2, 0.3, 0.4]] });
      const parsed = pipeline.parseRiff(bytes);
      const decoded = pipeline.decodeSamples(bytes, parsed, { maxFrames: 2 });

      expect(decoded.frames).toBe(2);
      expect(decoded.truncated).toBe(true);
      expect(decoded.channels[0]).toHaveLength(2);
    });

    it("declines a format it cannot unpack", () => {
      const bytes = wav({ bits: 16 });
      const parsed = pipeline.parseRiff(bytes);

      parsed.format.effectiveTag = 7; // µ-law
      parsed.format.formatName = "µ-law";

      expect(pipeline.decodeSamples(bytes, parsed).error).toMatch(/not decoded by this tool/);
    });

    it("declines an odd bit width", () => {
      const bytes = wav({ bits: 16 });
      const parsed = pipeline.parseRiff(bytes);

      parsed.format.bitsPerSample = 12;

      expect(pipeline.decodeSamples(bytes, parsed).error).toMatch(/not a width this tool reads/);
    });

    it("mixes channels down without clipping the average", () => {
      const mono = pipeline.mixToMono([Float32Array.from([1, -1, 0.5]), Float32Array.from([1, 1, -0.5])]);

      expect([...mono]).toEqual([1, 0, 0]);
      expect(pipeline.mixToMono([]).length).toBe(0);
    });

    it("returns the same array for mono rather than copying", () => {
      const only = Float32Array.from([0.1, 0.2]);

      expect(pipeline.mixToMono([only])).toBe(only);
    });
  });

  describe("readouts", () => {
    it("measures level, headroom and offset", () => {
      const sine = binExactSine(1024, 8, 1);
      const stats = pipeline.measure(sine);

      expect(stats.peak).toBeCloseTo(1, 3);
      expect(stats.peakDb).toBeCloseTo(0, 2);
      // RMS of a full-scale sine is 1/sqrt(2), which is -3.01 dBFS.
      expect(stats.rmsDb).toBeCloseTo(-3.01, 1);
      expect(stats.crestDb).toBeCloseTo(3.01, 1);
      expect(stats.dcOffset).toBeCloseTo(0, 6);
    });

    it("catches a DC offset", () => {
      const offset = Float32Array.from(new Array(64).fill(0.25));

      expect(pipeline.measure(offset).dcOffset).toBeCloseTo(0.25, 6);
    });

    it("draws a waveform envelope in buckets", () => {
      const samples = Float32Array.from([0, 1, 0, -1, 0.5, -0.5, 0.2, -0.2]);
      const envelope = pipeline.waveformEnvelope(samples, 4);

      expect(envelope.buckets).toBe(4);
      expect([...envelope.max]).toEqual([1, 0, 0.5, 0.20000000298023224]);
      expect([...envelope.min]).toEqual([0, -1, -0.5, -0.20000000298023224]);
    });

    it("never asks for more buckets than samples", () => {
      expect(pipeline.waveformEnvelope(Float32Array.from([0.5, -0.5]), 900).buckets).toBe(2);
      expect(pipeline.waveformEnvelope(new Float32Array(0), 900).buckets).toBe(1);
    });

    it("names the nearest note and the error in cents", () => {
      expect(pipeline.noteForHz(440)).toEqual({ name: "A4", midi: 69, cents: 0 });
      expect(pipeline.noteForHz(261.6256)).toEqual({ name: "C4", midi: 60, cents: 0 });
      expect(pipeline.noteForHz(466.1638).name).toBe("A♯4");
      expect(pipeline.noteForHz(880)).toEqual({ name: "A5", midi: 81, cents: 0 });
      expect(pipeline.noteForHz(445).cents).toBe(20);
      expect(pipeline.noteForHz(0)).toBe(null);
      expect(pipeline.noteForHz(-5)).toBe(null);
    });
  });

  describe("colour ramps", () => {
    it("interpolates between the stops", () => {
      for (const name of Object.keys(pipeline.RAMPS)) {
        const low = pipeline.sampleRamp(name, 0);
        const high = pipeline.sampleRamp(name, 1);
        const stops = pipeline.RAMPS[name].stops;

        expect(low, `${name} floor`).toEqual(stops[0]);
        expect(high, `${name} ceiling`).toEqual(stops[stops.length - 1]);
      }
    });

    it("clamps out-of-range samples", () => {
      expect(pipeline.sampleRamp("abyss", -3)).toEqual(pipeline.sampleRamp("abyss", 0));
      expect(pipeline.sampleRamp("abyss", 9)).toEqual(pipeline.sampleRamp("abyss", 1));
      expect(pipeline.sampleRamp("no-such-ramp", 0)).toEqual(pipeline.RAMPS.abyss.stops[0]);
    });

    it("bakes a 256-entry table the renderer can index", () => {
      const table = pipeline.rampTable("ember");

      expect(table).toBeInstanceOf(Uint8Array);
      expect(table.length).toBe(768);
      expect([table[0], table[1], table[2]]).toEqual(pipeline.RAMPS.ember.stops[0]);
      expect([table[765], table[766], table[767]]).toEqual(pipeline.RAMPS.ember.stops[4]);
    });
  });

  describe("conditioning", () => {
    it("normalises the peak to full scale", () => {
      const quiet = Float32Array.from([0.1, -0.25, 0.2, 0]);
      const result = pipeline.normalizePeak(quiet);

      expect(result.applied).toBe(true);
      expect(result.peak).toBeCloseTo(0.25, 6);
      expect(result.gainDb).toBeCloseTo(12.04, 2);
      expect(pipeline.measure(result.samples).peak).toBeCloseTo(1, 6);
      // The shape survives; only the scale changes.
      expect(result.samples[0] / result.samples[2]).toBeCloseTo(0.1 / 0.2, 5);
    });

    it("normalises to a target below full scale", () => {
      const result = pipeline.normalizePeak(Float32Array.from([0.5, -0.5]), -6);

      expect(pipeline.measure(result.samples).peakDb).toBeCloseTo(-6, 2);
    });

    it("leaves silence alone instead of dividing by zero", () => {
      const silence = new Float32Array(16);
      const result = pipeline.normalizePeak(silence);

      expect(result.applied).toBe(false);
      expect(result.gainDb).toBe(0);
      expect(result.samples).toBe(silence);
      expect([...result.samples].every((value) => value === 0)).toBe(true);
    });

    it("passes a signal through unchanged at coefficient zero", () => {
      const signal = Float32Array.from([0.5, -0.25, 0.75, 0]);

      expect([...pipeline.preEmphasis(signal, 0)]).toEqual([...signal]);
    });

    it("strips a constant offset", () => {
      const flat = Float32Array.from(new Array(32).fill(0.5));
      const filtered = pipeline.preEmphasis(flat, 0.97);

      // The first sample has no predecessor, so it survives; everything after it
      // is what a high-pass does to DC.
      expect(filtered[0]).toBeCloseTo(0.5, 6);
      expect(filtered[8]).toBeCloseTo(0.5 - 0.97 * 0.5, 6);
      expect(Math.abs(filtered[31])).toBeLessThan(0.02);
    });

    it("tilts the spectrum upwards, which is the whole point", () => {
      const rate = 16000;
      const low = pipeline.synthesize("sine", rate, 0.25, { amplitude: 0.5 });
      const before = pipeline.spectrogram(low, rate, { size: 1024, window: "hann" });
      const after = pipeline.spectrogram(pipeline.preEmphasis(low, 0.97), rate, { size: 1024, window: "hann" });

      // 440 Hz is well below the hinge, so pre-emphasis attenuates it.
      expect(after.peak.db).toBeLessThan(before.peak.db);

      const highTone = new Float32Array(rate / 4);

      for (let i = 0; i < highTone.length; i += 1) highTone[i] = 0.5 * Math.sin((2 * Math.PI * 6000 * i) / rate);

      const highBefore = pipeline.spectrogram(highTone, rate, { size: 1024, window: "hann" });
      const highAfter = pipeline.spectrogram(pipeline.preEmphasis(highTone, 0.97), rate, { size: 1024, window: "hann" });

      // 6 kHz is above it, so it gains — and gains more than the low tone did.
      expect(highAfter.peak.db).toBeGreaterThan(highBefore.peak.db);
    });

    it("clamps a runaway coefficient", () => {
      const signal = Float32Array.from([1, 1, 1, 1]);

      expect(() => pipeline.preEmphasis(signal, 5)).not.toThrow();
      expect(pipeline.preEmphasis(signal, 5)[3]).toBeCloseTo(1 - 0.999, 6);
      expect(pipeline.preEmphasis(signal, -3)[3]).toBe(1);
    });
  });

  describe("window length in time", () => {
    it("picks the FFT size closest to the requested milliseconds", () => {
      // 25 ms at 44100 is 1102.5 samples, and 1024 is the nearest power of two.
      expect(pipeline.sizeForWindowMs(25, 44100)).toBe(1024);
      expect(pipeline.sizeForWindowMs(5, 44100)).toBe(256);
      expect(pipeline.sizeForWindowMs(10, 44100)).toBe(512);
      expect(pipeline.sizeForWindowMs(50, 44100)).toBe(2048);
      expect(pipeline.sizeForWindowMs(100, 44100)).toBe(4096);
    });

    it("means the same duration at any sample rate", () => {
      // 25 ms is 1024 samples at 44.1 kHz but only 512 at 22.05 kHz.
      expect(pipeline.sizeForWindowMs(25, 22050)).toBe(512);
      expect(pipeline.sizeForWindowMs(25, 48000)).toBe(1024);
      expect(pipeline.sizeForWindowMs(25, 8000)).toBe(256);
    });

    it("never leaves the offered sizes", () => {
      for (const ms of [0.1, 1, 25, 500, 10000]) {
        expect(pipeline.FFT_SIZES, `${ms} ms`).toContain(pipeline.sizeForWindowMs(ms, 44100));
      }
    });

    it("falls back to the default for nonsense", () => {
      expect(pipeline.sizeForWindowMs(0, 44100)).toBe(pipeline.DEFAULT_FFT_SIZE);
      expect(pipeline.sizeForWindowMs(-5, 44100)).toBe(pipeline.DEFAULT_FFT_SIZE);
      expect(pipeline.sizeForWindowMs(25, 0)).toBe(pipeline.DEFAULT_FFT_SIZE);
    });
  });

  describe("frequency range of interest", () => {
    it("narrows both ends of the axis", () => {
      const bounds = pipeline.axisBounds(44100, { minHz: 300, maxHz: 3400 });

      expect(bounds.bottom).toBe(300);
      expect(bounds.top).toBe(3400);
    });

    it("clamps a range the file cannot supply", () => {
      // 20 kHz asked of an 8 kHz file is 4 kHz, not an empty top half.
      expect(pipeline.axisBounds(8000, { minHz: 20, maxHz: 20000 }).top).toBe(4000);
      // A floor at or above the ceiling would invert the axis.
      expect(pipeline.axisBounds(44100, { minHz: 9000, maxHz: 5000 }).bottom).toBe(2500);
    });

    it("leaves the axis alone when nothing is asked for", () => {
      expect(pipeline.axisBounds(44100, {})).toEqual(pipeline.axisBounds(44100));
      expect(pipeline.axisBounds(44100, { minHz: 0, maxHz: 0 })).toEqual(pipeline.axisBounds(44100));
    });

    it("maps the rows onto the narrowed band", () => {
      const rows = 256;
      const options = { minHz: 300, maxHz: 3400 };
      const map = pipeline.scaleRows(rows, 1025, 2048, 44100, true, options);

      // Row 0 is the top of the plot, which is now 3400 Hz rather than Nyquist.
      expect(pipeline.binToHz(map[0], 2048, 44100)).toBeCloseTo(3400, -1);
      expect(pipeline.binToHz(map[rows - 1], 2048, 44100)).toBeCloseTo(300, -1);

      for (let row = 1; row < rows; row += 1) {
        expect(map[row], `row ${row}`).toBeLessThanOrEqual(map[row - 1]);
      }
    });

    it("keeps the gridline maths and the row map in step inside a range", () => {
      const rows = 256;
      const options = { minHz: 300, maxHz: 3400 };
      const bounds = pipeline.axisBounds(44100, options);
      const map = pipeline.scaleRows(rows, 1025, 2048, 44100, true, options);

      for (const hz of [500, 1000, 2000, 3000]) {
        const fraction = pipeline.axisFraction(hz, bounds, true);
        const row = Math.round((1 - fraction) * (rows - 1));
        const hzAtRow = pipeline.binToHz(map[row], 2048, 44100);
        const drift = Math.abs(pipeline.axisFraction(hzAtRow, bounds, true) - fraction);

        expect(drift, `${hz} Hz`).toBeLessThanOrEqual(0.5 / (rows - 1));
      }
    });

    it("offers only ranges that make sense", () => {
      for (const range of pipeline.FREQUENCY_RANGES) {
        expect(typeof range.key).toBe("string");
        expect(typeof range.label).toBe("string");
        expect(range.maxHz === 0 || range.maxHz > range.minHz, `range ${range.key}`).toBe(true);
      }
    });
  });

  describe("colour maps", () => {
    it("carries the three named scientific ramps", () => {
      for (const name of ["viridis", "plasma", "inferno"]) {
        expect(pipeline.RAMPS, `${name} missing`).toHaveProperty(name);
        expect(pipeline.RAMPS[name].stops.length).toBeGreaterThanOrEqual(9);
      }
    });

    it("runs each of them dark to light", () => {
      const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

      for (const name of ["viridis", "plasma", "inferno"]) {
        const floor = luminance(pipeline.sampleRamp(name, 0));
        const middle = luminance(pipeline.sampleRamp(name, 0.5));
        const ceiling = luminance(pipeline.sampleRamp(name, 1));

        expect(floor, `${name} floor`).toBeLessThan(middle);
        expect(middle, `${name} middle`).toBeLessThan(ceiling);
      }
    });

    it("ends viridis and inferno where the reference maps end", () => {
      expect(pipeline.sampleRamp("viridis", 0)).toEqual([68, 1, 84]);
      expect(pipeline.sampleRamp("viridis", 1)).toEqual([253, 231, 37]);
      expect(pipeline.sampleRamp("inferno", 0)).toEqual([0, 0, 4]);
      expect(pipeline.sampleRamp("inferno", 1)).toEqual([252, 255, 164]);
    });
  });

  describe("export sizes", () => {
    it("can hold a column per pixel at 4K", () => {
      const widest = Math.max(...pipeline.EXPORT_SIZES.map((size) => size.width));

      expect(widest).toBe(3840);
      expect(pipeline.MAX_COLUMNS).toBeGreaterThanOrEqual(widest);
      expect(pipeline.planFrames(44100 * 600, 2048, 0.5, widest).columns).toBe(widest);
    });

    it("offers a viewport option that names no size", () => {
      const viewport = pipeline.EXPORT_SIZES.find((size) => size.key === "viewport");

      expect(viewport.width).toBe(0);
      expect(viewport.height).toBe(0);
    });
  });

  describe("test signals", () => {
    it("stays inside the amplitude it was asked for", () => {
      for (const kind of Object.keys(pipeline.SIGNALS)) {
        const signal = pipeline.synthesize(kind, 8000, 0.25, { amplitude: 0.5 });

        expect(signal.length, kind).toBe(2000);
        expect(pipeline.measure(signal).peak, kind).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    });

    it("repeats exactly for the same seed", () => {
      const first = pipeline.synthesize("noise", 8000, 0.1, { seed: 7 });
      const second = pipeline.synthesize("noise", 8000, 0.1, { seed: 7 });
      const other = pipeline.synthesize("noise", 8000, 0.1, { seed: 8 });

      expect([...first]).toEqual([...second]);
      expect([...first]).not.toEqual([...other]);
    });

    it("puts the sine at 440 Hz", () => {
      const signal = pipeline.synthesize("sine", 44100, 0.5);
      const picture = pipeline.spectrogram(signal, 44100, { size: 4096, window: "hann" });

      expect(pipeline.dominantFrequency(picture)).toBeCloseTo(440, 0);
      expect(pipeline.noteForHz(pipeline.dominantFrequency(picture)).name).toBe("A4");
    });

    it("returns silence for an unknown kind", () => {
      expect(pipeline.measure(pipeline.synthesize("trombone", 8000, 0.1)).peak).toBe(0);
    });
  });

  describe("formatting", () => {
    it("formats bytes and durations for the readouts", () => {
      expect(pipeline.formatBytes(900)).toBe("900 B");
      expect(pipeline.formatBytes(2048)).toBe("2.0 KB");
      expect(pipeline.formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
      expect(pipeline.formatDuration(0)).toBe("0:00.00");
      expect(pipeline.formatDuration(9.5)).toBe("0:09.50");
      expect(pipeline.formatDuration(125.25)).toBe("2:05.25");
      expect(pipeline.formatDuration(-1)).toBe("—");
    });
  });

  describe("end to end", () => {
    it("goes from WAV bytes to a picture of the tone inside it", () => {
      const rate = 22050;
      const tone = pipeline.synthesize("sine", rate, 0.5, { amplitude: 0.5 });
      const bytes = wav({ bits: 16, sampleRate: rate, channels: [[...tone]] });

      const parsed = pipeline.parseRiff(bytes);
      const decoded = pipeline.decodeSamples(bytes, parsed);
      const mono = pipeline.mixToMono(decoded.channels);
      const picture = pipeline.spectrogram(mono, parsed.format.sampleRate, { size: 2048, window: "hann" });

      expect(parsed.ok).toBe(true);
      expect(decoded.ok).toBe(true);
      expect(picture.duration).toBeCloseTo(0.5, 2);
      expect(pipeline.dominantFrequency(picture)).toBeCloseTo(440, 0);
      expect(picture.peak.db).toBeCloseTo(pipeline.amplitudeToDb(0.5), 0);
      expect(pipeline.measure(mono).peakDb).toBeCloseTo(pipeline.amplitudeToDb(0.5), 1);
    });
  });
});
