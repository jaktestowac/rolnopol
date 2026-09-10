import { describe, it, expect } from "vitest";

// The same file the browser loads. This half of the pipeline is the MP3
// container: every frame header, both ID3 tags and the Xing/LAME table are read
// here by hand. The codec itself is the browser's job — see the module header —
// so there is nothing about *samples* in this file.
const pipeline = require("../../public/js/pages/spectrogram-bench-pipeline.js");

// --------------------------------------------------------------------- builders

const chars = (text) => [...text].map((character) => character.charCodeAt(0));
const u32be = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const synchsafeBytes = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

const VERSION_BITS = { 1: 3, 2: 2, 2.5: 0 };

function bitrateIndex(version, layer, kbps) {
  const table = pipeline.MPEG_BITRATES[version === 1 ? 1 : 2][layer];
  const index = table.indexOf(kbps);

  if (index < 1) throw new Error(`${kbps} kbps is not a valid rate for MPEG-${version} layer ${layer}`);

  return index;
}

/* One MPEG audio frame: a real four-byte header followed by zeroed payload.
 *
 * The payload is zeros because nothing in the pipeline decodes it — the point of
 * these fixtures is the frame *lattice*, which is what the walk has to get right
 * to land on the next header. */
function frame(options) {
  const settings = options || {};
  const version = settings.version || 1;
  const layer = settings.layer || 3;
  const kbps = settings.kbps || 128;
  const rate = settings.rate || 44100;
  const padding = settings.padding ? 1 : 0;
  const modeBits = settings.modeBits === undefined ? 0 : settings.modeBits;
  const crc = settings.crc === true;

  const rateIndex = pipeline.MPEG_SAMPLE_RATES[version].indexOf(rate);

  if (rateIndex < 0) throw new Error(`${rate} Hz is not an MPEG-${version} rate`);

  const layerBits = 4 - layer;
  const bytes = [
    0xff,
    0xe0 | (VERSION_BITS[version] << 3) | (layerBits << 1) | (crc ? 0 : 1),
    (bitrateIndex(version, layer, kbps) << 4) | (rateIndex << 2) | (padding << 1),
    modeBits << 6,
  ];

  const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const bitrate = kbps * 1000;
  const length =
    layer === 1 ? (Math.floor((12 * bitrate) / rate) + padding) * 4 : Math.floor(((samplesPerFrame / 8) * bitrate) / rate) + padding;

  while (bytes.length < length) bytes.push(0);

  if (settings.body) {
    for (let i = 0; i < settings.body.length && 4 + i < bytes.length; i += 1) {
      bytes[4 + i] = settings.body[i];
    }
  }

  return bytes;
}

function stream(count, options) {
  const out = [];

  for (let i = 0; i < count; i += 1) out.push(...frame(options));

  return out;
}

/* A Xing or Info table, positioned where a real one lives: inside the first
 * frame's side-info area. */
function xingBody(options) {
  const settings = options || {};
  const kind = settings.kind || "Xing";
  const sideInfoSize = settings.sideInfoSize === undefined ? 32 : settings.sideInfoSize;
  const body = new Array(sideInfoSize).fill(0);
  const flags = (settings.frames === undefined ? 0 : 0x01) | (settings.bytes === undefined ? 0 : 0x02);
  const tail = [...chars(kind), ...u32be(flags)];

  if (settings.frames !== undefined) tail.push(...u32be(settings.frames));
  if (settings.bytes !== undefined) tail.push(...u32be(settings.bytes));

  if (settings.lame) {
    // The gapless field sits 21 bytes from the start of the LAME version string,
    // so the offset is measured from there and not from the start of the frame.
    const lameAt = tail.length;

    tail.push(...chars("LAME3.100"));

    while (tail.length < lameAt + 21) tail.push(0);

    const delay = settings.encoderDelay === undefined ? 576 : settings.encoderDelay;
    const padding = settings.encoderPadding === undefined ? 1800 : settings.encoderPadding;

    tail.push((delay >> 4) & 0xff, ((delay & 0x0f) << 4) | ((padding >> 8) & 0x0f), padding & 0xff);
  }

  return [...body, ...tail];
}

function id3v2(options) {
  const settings = options || {};
  const frames = [];

  for (const [id, text] of Object.entries(settings.text || {})) {
    const payload = [0, ...chars(text)]; // encoding byte 0 = Latin-1

    frames.push(...chars(id), ...u32be(payload.length), 0, 0, ...payload);
  }

  const padding = new Array(settings.padding || 0).fill(0);
  const body = [...frames, ...padding];

  return [...chars("ID3"), settings.major || 3, 0, settings.flags || 0, ...synchsafeBytes(body.length), ...body];
}

function id3v1(title, artist) {
  const out = [...chars("TAG")];
  const pad = (text, size) => {
    const value = chars(text).slice(0, size);

    while (value.length < size) value.push(0);

    return value;
  };

  out.push(...pad(title, 30), ...pad(artist, 30), ...pad("", 30), ...pad("", 4), ...pad("", 30), 0);

  return out.slice(0, 128);
}

const bytesOf = (parts) => Uint8Array.from(parts.flat(Infinity));

// ------------------------------------------------------------------------ tests

describe("spectrogram bench MP3 container", () => {
  describe("frame headers", () => {
    // Lengths asserted as literals, not recomputed from the same table the
    // builder used: 144 * 128000 / 44100 = 417.96, and a frame is 417 bytes.
    it("reads an MPEG-1 Layer III frame", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ kbps: 128, rate: 44100 })]), 0);

      expect(header.version).toBe(1);
      expect(header.layer).toBe(3);
      expect(header.sampleRate).toBe(44100);
      expect(header.bitrate).toBe(128000);
      expect(header.samplesPerFrame).toBe(1152);
      expect(header.frameLength).toBe(417);
      expect(header.channels).toBe(2);
      expect(header.channelMode).toBe("stereo");
      expect(header.sideInfoSize).toBe(32);
      expect(header.crc).toBe(false);
    });

    it("adds the padding byte when the padding bit is set", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ kbps: 128, rate: 44100, padding: true })]), 0);

      expect(header.padding).toBe(1);
      expect(header.frameLength).toBe(418);
    });

    // MPEG-2 Layer III carries half the samples per frame, which halves the
    // length for the same bitrate: 72 * 64000 / 22050 = 208.98, so 208 bytes.
    it("reads an MPEG-2 Layer III frame", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ version: 2, kbps: 64, rate: 22050, modeBits: 3 })]), 0);

      expect(header.version).toBe(2);
      expect(header.samplesPerFrame).toBe(576);
      expect(header.frameLength).toBe(208);
      expect(header.channels).toBe(1);
      expect(header.channelMode).toBe("mono");
      expect(header.sideInfoSize).toBe(9);
    });

    it("reads MPEG-2.5 rates", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ version: 2.5, kbps: 32, rate: 11025, modeBits: 3 })]), 0);

      expect(header.version).toBe(2.5);
      expect(header.sampleRate).toBe(11025);
      expect(header.samplesPerFrame).toBe(576);
    });

    // Layer I counts its padding in four-byte slots, so its formula differs:
    // (12 * 32000 / 32000) * 4 = 48.
    it("uses the Layer I frame formula", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ layer: 1, kbps: 32, rate: 32000 })]), 0);

      expect(header.layer).toBe(1);
      expect(header.samplesPerFrame).toBe(384);
      expect(header.frameLength).toBe(48);
    });

    it("notes the CRC when protection is on", () => {
      const header = pipeline.parseFrameHeader(bytesOf([frame({ crc: true })]), 0);

      expect(header.crc).toBe(true);
    });

    it("names every channel mode", () => {
      const modes = [0, 1, 2, 3].map((modeBits) => pipeline.parseFrameHeader(bytesOf([frame({ modeBits })]), 0).channelMode);

      expect(modes).toEqual(["stereo", "joint stereo", "dual channel", "mono"]);
    });

    it("refuses everything reserved rather than guessing", () => {
      const good = frame({ kbps: 128, rate: 44100 });
      const bend = (index, value) => {
        const copy = good.slice();

        copy[index] = value;

        return pipeline.parseFrameHeader(bytesOf([copy]), 0);
      };

      expect(pipeline.parseFrameHeader(bytesOf([good]), 0)).not.toBe(null);
      expect(bend(0, 0xfe), "no sync word").toBe(null);
      expect(bend(1, 0xea), "reserved version").toBe(null);
      expect(bend(1, 0xf9), "reserved layer").toBe(null);
      expect(bend(2, 0x04), "free-format bitrate index").toBe(null);
      expect(bend(2, 0xf4), "bad bitrate index").toBe(null);
      expect(bend(2, 0x9c), "reserved sample rate index").toBe(null);
    });

    it("refuses a header that runs off the end", () => {
      expect(pipeline.parseFrameHeader(Uint8Array.from([0xff, 0xfb, 0x90]), 0)).toBe(null);
      expect(pipeline.parseFrameHeader(new Uint8Array(0), 0)).toBe(null);
    });

    // A lone plausible header inside album art is common; two chained ones are
    // not. Every sync decision in the parser goes through this.
    it("requires two chained frames to accept a sync point", () => {
      const lonely = bytesOf([frame({ kbps: 128 }).slice(0, 40), new Array(600).fill(0x11)]);

      expect(pipeline.parseFrameHeader(lonely, 0)).not.toBe(null);
      expect(pipeline.framePairAt(lonely, 0)).toBe(null);
      expect(pipeline.framePairAt(bytesOf([stream(2, { kbps: 128 })]), 0)).not.toBe(null);
    });
  });

  describe("container sniffing", () => {
    it("knows an MP3 from a WAV by its bytes", () => {
      expect(pipeline.detectContainer(bytesOf([stream(3, { kbps: 128 })]))).toBe("mp3");
      expect(pipeline.detectContainer(bytesOf([id3v2({ text: { TIT2: "x" } }), stream(3, {})]))).toBe("mp3");
      expect(pipeline.detectContainer(bytesOf([chars("RIFF"), u32be(0), chars("WAVE")]))).toBe("wav");
      expect(pipeline.detectContainer(bytesOf([chars("RIFF"), u32be(0), chars("AVI ")]))).toBe(null);
      expect(pipeline.detectContainer(Uint8Array.from([0, 1, 2, 3, 4, 5]))).toBe(null);
      expect(pipeline.detectContainer(null)).toBe(null);
    });

    it("is not fooled by a renamed file", () => {
      // The console asks this, not the extension: a .mp3 holding RIFF is a WAV.
      const wavBytes = bytesOf([chars("RIFF"), u32be(36), chars("WAVE")]);

      expect(pipeline.detectContainer(wavBytes)).toBe("wav");
    });

    it("finds a frame stream that starts after junk", () => {
      expect(pipeline.detectContainer(bytesOf([new Array(500).fill(0x42), stream(3, {})]))).toBe("mp3");
    });
  });

  describe("ID3 tags", () => {
    it("reads a synchsafe tag size", () => {
      // 0x00 0x00 0x02 0x01 is 257, not 513: seven bits per byte.
      expect(pipeline.synchsafe(Uint8Array.from([0x00, 0x00, 0x02, 0x01]), 0)).toBe(257);
      expect(pipeline.synchsafe(Uint8Array.from([0x00, 0x00, 0x01, 0x7f]), 0)).toBe(255);
    });

    it("reads v2.3 text frames", () => {
      const tag = pipeline.readId3v2(bytesOf([id3v2({ text: { TIT2: "Field recording", TPE1: "Rolnopol" } })]));

      expect(tag.version).toBe("2.3.0");
      expect(tag.info).toEqual({ title: "Field recording", artist: "Rolnopol" });
      expect(tag.size).toBeGreaterThan(10);
    });

    it("reads v2.4 frames, whose sizes are synchsafe too", () => {
      const text = [0, ...chars("Rolnopol")];
      const body = [...chars("TIT2"), ...synchsafeBytes(text.length), 0, 0, ...text];
      const tag = pipeline.readId3v2(bytesOf([chars("ID3"), 4, 0, 0, synchsafeBytes(body.length), body]));

      expect(tag.version).toBe("2.4.0");
      expect(tag.info.title).toBe("Rolnopol");
    });

    it("decodes a UTF-8 text frame", () => {
      const utf8 = [0xc5, 0x81, 0xc4, 0x85, 0x6b, 0x61]; // "Łąka"
      const payload = [3, ...utf8];
      const body = [...chars("TIT2"), ...u32be(payload.length), 0, 0, ...payload];
      const tag = pipeline.readId3v2(bytesOf([chars("ID3"), 3, 0, 0, synchsafeBytes(body.length), body]));

      expect(tag.info.title).toBe("Łąka");
    });

    it("counts the footer in the tag size when the flag is set", () => {
      const plain = pipeline.readId3v2(bytesOf([id3v2({ text: { TIT2: "x" } })]));
      const footed = pipeline.readId3v2(bytesOf([id3v2({ text: { TIT2: "x" }, flags: 0x10 })]));

      expect(footed.size).toBe(plain.size + 10);
    });

    it("stops at the padding instead of reading it as frames", () => {
      const tag = pipeline.readId3v2(bytesOf([id3v2({ text: { TIT2: "ok" }, padding: 64 })]));

      expect(tag.info).toEqual({ title: "ok" });
    });

    it("skips a v2.2 tag rather than mis-reading it", () => {
      const tag = pipeline.readId3v2(bytesOf([chars("ID3"), 2, 0, 0, synchsafeBytes(20), new Array(20).fill(0)]));

      expect(tag.version).toBe("2.2.0");
      expect(tag.info).toEqual({});
      expect(tag.size).toBe(30);
    });

    it("reads a trailing ID3v1 tag", () => {
      const tag = pipeline.readId3v1(bytesOf([stream(2, {}), id3v1("Harvest", "Rolnopol")]));

      expect(tag.size).toBe(128);
      expect(tag.info.title).toBe("Harvest");
      expect(tag.info.artist).toBe("Rolnopol");
    });

    it("returns null when there is no tag", () => {
      expect(pipeline.readId3v2(bytesOf([stream(2, {})]))).toBe(null);
      expect(pipeline.readId3v1(bytesOf([stream(2, {})]))).toBe(null);
      expect(pipeline.readId3v1(Uint8Array.from([1, 2, 3]))).toBe(null);
    });
  });

  describe("VBR tables", () => {
    it("reads a Xing header with its frame and byte counts", () => {
      const bytes = bytesOf([frame({ kbps: 128, body: xingBody({ frames: 1000, bytes: 417000 }) }), frame({ kbps: 128 })]);
      const header = pipeline.parseFrameHeader(bytes, 0);
      const vbr = pipeline.readVbrHeader(bytes, header);

      expect(vbr.kind).toBe("Xing");
      expect(vbr.frames).toBe(1000);
      expect(vbr.bytes).toBe(417000);
    });

    it("tells an Info table from a Xing one", () => {
      const bytes = bytesOf([frame({ kbps: 128, body: xingBody({ kind: "Info", frames: 10 }) }), frame({ kbps: 128 })]);

      expect(pipeline.readVbrHeader(bytes, pipeline.parseFrameHeader(bytes, 0)).kind).toBe("Info");
    });

    it("reads the LAME encoder string and its gapless counts", () => {
      const bytes = bytesOf([
        frame({ kbps: 320, body: xingBody({ frames: 10, bytes: 100, lame: true, encoderDelay: 576, encoderPadding: 1800 }) }),
        frame({ kbps: 320 }),
      ]);
      const vbr = pipeline.readVbrHeader(bytes, pipeline.parseFrameHeader(bytes, 0));

      expect(vbr.encoder).toBe("LAME3.100");
      expect(vbr.encoderDelay).toBe(576);
      expect(vbr.encoderPadding).toBe(1800);
    });

    it("finds the table at the mono side-info offset too", () => {
      const bytes = bytesOf([
        frame({ kbps: 128, modeBits: 3, body: xingBody({ sideInfoSize: 17, frames: 42 }) }),
        frame({ kbps: 128, modeBits: 3 }),
      ]);
      const vbr = pipeline.readVbrHeader(bytes, pipeline.parseFrameHeader(bytes, 0));

      expect(vbr.frames).toBe(42);
    });

    it("returns null when the frame carries no table", () => {
      const bytes = bytesOf([stream(2, { kbps: 128 })]);

      expect(pipeline.readVbrHeader(bytes, pipeline.parseFrameHeader(bytes, 0))).toBe(null);
    });
  });

  describe("whole-file walk", () => {
    it("counts frames and derives an exact duration", () => {
      // 40 frames of 1152 samples at 44100 Hz.
      const parsed = pipeline.parseMpeg(bytesOf([stream(40, { kbps: 128, rate: 44100 })]));

      expect(parsed.ok).toBe(true);
      expect(parsed.container).toBe("mp3");
      expect(parsed.frameCount).toBe(40);
      expect(parsed.totalSamples).toBe(40 * 1152);
      expect(parsed.duration).toBeCloseTo((40 * 1152) / 44100, 9);
      expect(parsed.audioBytes).toBe(40 * 417);
      expect(parsed.format.formatName).toBe("MPEG-1 Layer III");
      expect(parsed.format.sampleRate).toBe(44100);
      expect(parsed.format.channels).toBe(2);
      expect(parsed.warnings).toEqual([]);
    });

    it("calls a single-bitrate file CBR and a mixed one VBR", () => {
      const cbr = pipeline.parseMpeg(bytesOf([stream(10, { kbps: 128 })]));
      const vbr = pipeline.parseMpeg(bytesOf([stream(5, { kbps: 128 }), stream(5, { kbps: 192 }), stream(5, { kbps: 96 })]));

      expect(cbr.bitrateMode).toBe("CBR");
      expect(Object.keys(cbr.bitrateCounts)).toEqual(["128"]);

      expect(vbr.bitrateMode).toBe("VBR");
      expect(vbr.bitrateCounts).toEqual({ 96: 5, 128: 5, 192: 5 });
      // The average is computed from the bytes actually walked, not from a header.
      expect(vbr.averageBitrate).toBeGreaterThan(96000);
      expect(vbr.averageBitrate).toBeLessThan(192000);
    });

    it("skips an ID3v2 tag to find the audio", () => {
      const tag = id3v2({ text: { TIT2: "Barn", TPE1: "Rolnopol" } });
      const parsed = pipeline.parseMpeg(bytesOf([tag, stream(12, { kbps: 128 })]));

      expect(parsed.audioStart).toBe(tag.length);
      expect(parsed.frameCount).toBe(12);
      expect(parsed.info.title).toBe("Barn");
      expect(parsed.warnings).toEqual([]);
    });

    it("stops the audio before a trailing ID3v1 tag", () => {
      const parsed = pipeline.parseMpeg(bytesOf([stream(6, { kbps: 128 }), id3v1("Tail", "Rolnopol")]));

      expect(parsed.frameCount).toBe(6);
      expect(parsed.audioEnd).toBe(6 * 417);
      expect(parsed.info.title).toBe("Tail");
    });

    it("prefers the v2 tag and lets v1 fill the gaps", () => {
      const parsed = pipeline.parseMpeg(
        bytesOf([id3v2({ text: { TIT2: "From v2" } }), stream(4, { kbps: 128 }), id3v1("From v1", "Only in v1")]),
      );

      expect(parsed.info.title).toBe("From v2");
      expect(parsed.info.artist).toBe("Only in v1");
    });

    it("reports junk before the first frame", () => {
      const parsed = pipeline.parseMpeg(bytesOf([new Array(300).fill(0x5a), stream(5, { kbps: 128 })]));

      expect(parsed.ok).toBe(true);
      expect(parsed.audioStart).toBe(300);
      expect(parsed.warnings.join(" ")).toMatch(/Skipped 300 bytes of junk/);
    });

    it("re-synchronises across damage and says so", () => {
      const parsed = pipeline.parseMpeg(bytesOf([stream(4, { kbps: 128 }), new Array(200).fill(0x7f), stream(4, { kbps: 128 })]));

      expect(parsed.ok).toBe(true);
      expect(parsed.frameCount).toBe(8);
      expect(parsed.warnings.join(" ")).toMatch(/Re-synchronised 1 time/);
    });

    it("refuses a file with no frames in it", () => {
      const parsed = pipeline.parseMpeg(bytesOf([new Array(2000).fill(0x33)]));

      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/No MPEG audio frame found/);
      expect(pipeline.parseMpeg(Uint8Array.from([1, 2])).error).toMatch(/too short/);
    });

    it("lists the container parts for the readout", () => {
      const parsed = pipeline.parseMpeg(
        bytesOf([
          id3v2({ text: { TIT2: "Listed" } }),
          frame({ kbps: 128, body: xingBody({ frames: 9, bytes: 3753, lame: true }) }),
          stream(8, { kbps: 128 }),
          id3v1("Listed", "Rolnopol"),
        ]),
      );

      expect(parsed.chunks.map((chunk) => chunk.id)).toEqual(["ID3v2", "Xing", "frames", "ID3v1"]);
      expect(parsed.chunks.every((chunk) => typeof chunk.offset === "number" && typeof chunk.note === "string")).toBe(true);
      expect(parsed.info.encoder).toBe("LAME3.100");
    });

    it("survives a stray sync byte inside the stream", () => {
      // 0xFF followed by something that is not a header must not restart the walk.
      const parsed = pipeline.parseMpeg(bytesOf([stream(3, { kbps: 128, body: [0xff, 0x00, 0xff, 0x1f] }), stream(3, { kbps: 128 })]));

      expect(parsed.frameCount).toBe(6);
      expect(parsed.warnings).toEqual([]);
    });
  });

  describe("frame accounting against the Xing table", () => {
    /* Verified against five MP3s encoded by ffmpeg/LAME: a Xing or Info table
     * counts the audio frames and leaves out the frame it sits in, so the walked
     * count is one higher every time. That is the convention, not damage. */
    it("does not complain when the table is one frame short, as encoders write it", () => {
      const parsed = pipeline.parseMpeg(
        bytesOf([frame({ kbps: 128, body: xingBody({ frames: 19, bytes: 8340 }) }), stream(19, { kbps: 128 })]),
      );

      expect(parsed.frameCount).toBe(20);
      expect(parsed.vbr.frames).toBe(19);
      expect(parsed.warnings).toEqual([]);
    });

    it("flags a table that disagrees by more than the header frame", () => {
      const parsed = pipeline.parseMpeg(bytesOf([frame({ kbps: 128, body: xingBody({ frames: 5000 }) }), stream(19, { kbps: 128 })]));

      expect(parsed.ok).toBe(true);
      expect(parsed.warnings.join(" ")).toMatch(/claims 5000 frames but the file holds 20/);
    });

    /* The duration is what a decoder will actually produce, which is longer than
     * the audio somebody encoded: frames hold a fixed 1152 samples, so the last
     * one is padded, and the Xing header frame is real decodable silence too.
     * A 3.000 s source comes back as 3.056 s, and that is the honest number. */
    it("counts every frame in the duration, including the header frame", () => {
      const rate = 44100;
      const parsed = pipeline.parseMpeg(
        bytesOf([frame({ kbps: 128, rate, body: xingBody({ frames: 116 }) }), stream(116, { kbps: 128, rate })]),
      );

      expect(parsed.frameCount).toBe(117);
      expect(parsed.duration).toBeCloseTo((117 * 1152) / rate, 9);
      expect(parsed.duration).toBeGreaterThan(3);
    });
  });

  describe("slicing for the decoder", () => {
    const bytes = bytesOf([id3v2({ text: { TIT2: "Long" } }), stream(200, { kbps: 128, rate: 44100 })]);
    const parsed = pipeline.parseMpeg(bytes);
    const frameSeconds = 1152 / 44100;

    it("cuts on a frame boundary, never mid-frame", () => {
      const slice = pipeline.mpegSlice(bytes, parsed, 1);

      expect(slice.bytes.length % 417).toBe(0);
      expect(slice.frames).toBe(Math.ceil(1 / frameSeconds));
      expect(slice.seconds).toBeGreaterThanOrEqual(1);
      expect(slice.truncated).toBe(true);
    });

    it("leaves the ID3 tag out — no decoder needs it", () => {
      const slice = pipeline.mpegSlice(bytes, parsed, 1);

      expect(slice.bytes[0]).toBe(0xff);
      expect(pipeline.detectContainer(slice.bytes)).toBe("mp3");
    });

    it("produces something that parses again as an MP3", () => {
      const slice = pipeline.mpegSlice(bytes, parsed, 0.5);
      const reparsed = pipeline.parseMpeg(slice.bytes);

      expect(reparsed.ok).toBe(true);
      expect(reparsed.frameCount).toBe(slice.frames);
      expect(reparsed.format.sampleRate).toBe(44100);
      expect(reparsed.warnings).toEqual([]);
    });

    it("returns the whole stream when the budget covers it", () => {
      const slice = pipeline.mpegSlice(bytes, parsed, 3600);

      expect(slice.frames).toBe(200);
      expect(slice.truncated).toBe(false);
      expect(slice.bytes.length).toBe(200 * 417);
    });

    it("treats a zero or missing budget as unlimited", () => {
      expect(pipeline.mpegSlice(bytes, parsed, 0).frames).toBe(200);
      expect(pipeline.mpegSlice(bytes, parsed).frames).toBe(200);
    });
  });

  describe("the line between us and the codec", () => {
    // The pipeline reads MP3 structure and refuses to pretend it reads MP3
    // samples. `decodeSamples` is for PCM containers only, and saying so is
    // better than returning silence.
    it("declines to unpack samples from an MP3", () => {
      const bytes = bytesOf([stream(10, { kbps: 128 })]);
      const parsed = pipeline.parseMpeg(bytes);

      expect(parsed.format.bitsPerSample).toBe(0);
      expect(parsed.data).toBeUndefined();
    });

    it("keeps the same field names as the WAV parser so the console reads one shape", () => {
      const mp3 = pipeline.parseMpeg(bytesOf([stream(10, { kbps: 128, rate: 44100 })]));

      for (const field of ["ok", "chunks", "warnings", "info", "format", "duration"]) {
        expect(mp3, `MP3 result is missing ${field}`).toHaveProperty(field);
      }

      for (const field of ["formatName", "channels", "sampleRate", "bitsPerSample", "extensible"]) {
        expect(mp3.format, `MP3 format is missing ${field}`).toHaveProperty(field);
      }
    });
  });
});
