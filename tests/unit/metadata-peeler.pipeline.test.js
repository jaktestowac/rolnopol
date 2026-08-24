import { describe, it, expect } from "vitest";

// The same file the browser loads — it is wrapped UMD-style precisely so the
// container parsing can be checked here instead of by eye in a hex panel.
const pipeline = require("../../public/js/pages/metadata-peeler-pipeline.js");

// --------------------------------------------------------------------- builders

const flat = (parts) => Uint8Array.from(parts.flat(Infinity));
const u16be = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16le = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const chars = (text) => [...text].map((character) => character.charCodeAt(0));
const asciiZ = (text) => [...chars(text), 0];
const rational = (numerator, denominator) => [...u32le(numerator), ...u32le(denominator)];

/* A TIFF/EXIF payload with one of everything the tool claims to read: a string
 * in IFD0, a sub-IFD behind a pointer, a GPS directory, and a thumbnail in IFD1.
 *
 * Offsets are computed from the block lengths rather than written out, because
 * an EXIF pointer that is wrong by four bytes is exactly the bug this fixture
 * exists to catch — in the parser, not in the fixture. */
function exifPayload() {
  const IFD0_AT = 8;
  const IFD0_LEN = 2 + 4 * 12 + 4;
  const EXIF_AT = IFD0_AT + IFD0_LEN;
  const EXIF_LEN = 2 + 2 * 12 + 4;
  const GPS_AT = EXIF_AT + EXIF_LEN;
  const GPS_LEN = 2 + 4 * 12 + 4;
  const IFD1_AT = GPS_AT + GPS_LEN;
  const IFD1_LEN = 2 + 2 * 12 + 4;

  const MAKE_AT = IFD1_AT + IFD1_LEN;
  const MAKE = asciiZ("Rolnopol");
  const DATE_AT = MAKE_AT + MAKE.length;
  const DATE = asciiZ("2026:08:25 12:30:45");
  const SERIAL_AT = DATE_AT + DATE.length;
  const SERIAL = asciiZ("JT-1234");
  const LAT_AT = SERIAL_AT + SERIAL.length;
  const LON_AT = LAT_AT + 24;
  const THUMB_AT = LON_AT + 24;
  const THUMB = [0xff, 0xd8, 0xff, 0xd9]; // a four-byte "JPEG": SOI then EOI

  const entry = (tag, type, count, value) => {
    const padded = value.slice(0, 4);

    while (padded.length < 4) padded.push(0);

    return [...u16le(tag), ...u16le(type), ...u32le(count), ...padded];
  };

  const payload = flat([
    chars("II"),
    u16le(42),
    u32le(IFD0_AT),

    // IFD0
    u16le(4),
    entry(0x010f, 2, MAKE.length, u32le(MAKE_AT)), // Make
    entry(0x0112, 3, 1, u16le(6)), // Orientation — inline, rotated 90° CW
    entry(0x8769, 4, 1, u32le(EXIF_AT)), // ExifIFDPointer
    entry(0x8825, 4, 1, u32le(GPS_AT)), // GPSInfoIFDPointer
    u32le(IFD1_AT), // next IFD = the thumbnail directory

    // Exif sub-IFD
    u16le(2),
    entry(0x9003, 2, DATE.length, u32le(DATE_AT)), // DateTimeOriginal
    entry(0xa431, 2, SERIAL.length, u32le(SERIAL_AT)), // BodySerialNumber
    u32le(0),

    // GPS IFD — 50°03'36"N 019°56'18"E
    u16le(4),
    entry(0x0001, 2, 2, asciiZ("N")),
    entry(0x0002, 5, 3, u32le(LAT_AT)),
    entry(0x0003, 2, 2, asciiZ("E")),
    entry(0x0004, 5, 3, u32le(LON_AT)),
    u32le(0),

    // IFD1
    u16le(2),
    entry(0x0201, 4, 1, u32le(THUMB_AT)), // JPEGInterchangeFormat
    entry(0x0202, 4, 1, u32le(THUMB.length)), // JPEGInterchangeFormatLength
    u32le(0),

    MAKE,
    DATE,
    SERIAL,
    [rational(50, 1), rational(3, 1), rational(3600, 100)],
    [rational(19, 1), rational(56, 1), rational(1800, 100)],
    THUMB,
  ]);

  expect(payload.length).toBe(THUMB_AT + THUMB.length);

  return { payload, thumbnailAt: THUMB_AT, thumbnail: THUMB };
}

const segment = (marker, data) => [0xff, marker, ...u16be(data.length + 2), ...data];

/* SOI, four metadata segments, the minimum needed to look like an image, a scan
 * that contains both stuffing (`FF 00`) and a restart marker, EOI, and two
 * appended bytes that no reader will ever look at. */
function jpegFixture() {
  const { payload } = exifPayload();
  const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78];

  const bytes = flat([
    [0xff, 0xd8], // SOI
    segment(0xe0, [...asciiZ("JFIF"), 0x01, 0x02, 0x00, 0, 1, 0, 1, 0, 0]),
    segment(0xe1, [...chars("Exif"), 0, 0, ...payload]),
    segment(0xe2, [...asciiZ("ICC_PROFILE"), 0x01, 0x01, 0xde, 0xad]),
    segment(0xfe, chars("grown in Rolnopol")), // COM
    segment(0xdb, [0x00, ...new Array(64).fill(0x10)]), // DQT
    segment(0xc0, [0x08, ...u16be(2), ...u16be(2), 0x01, 0x01, 0x11, 0x00]), // SOF0
    segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), // SOS
    scan,
    [0xff, 0xd9], // EOI
    [0xaa, 0xbb], // appended junk
  ]);

  return { bytes, exifPayload: payload, scan };
}

function pngChunk(type, data) {
  const body = [...chars(type), ...data];
  const crc = pipeline.crc32(Uint8Array.from(body), 0, body.length);

  return [...u32be(data.length), ...body, ...u32be(crc)];
}

function pngFixture() {
  const { payload } = exifPayload();

  const bytes = flat([
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...u32be(2), ...u32be(2), 8, 6, 0, 0, 0]),
    pngChunk("tEXt", [...asciiZ("Comment"), ...chars("grown in Rolnopol")]),
    pngChunk("iTXt", [...asciiZ("XML:com.adobe.xmp"), 0, 0, 0, 0, ...chars("<x:xmpmeta/>")]),
    pngChunk("tIME", [...u16be(2026), 8, 25, 12, 30, 45]),
    pngChunk("eXIf", [...payload]),
    pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01]),
    pngChunk("IEND", []),
  ]);

  return { bytes };
}

function gifFixture() {
  const bytes = flat([
    chars("GIF89a"),
    [...u16le(2), ...u16le(2), 0x80, 0x00, 0x00], // logical screen descriptor + GCT flag
    [0x00, 0x00, 0x00, 0xff, 0xff, 0xff], // global colour table, two entries
    [0x21, 0xfe, 0x05, ...chars("hello"), 0x00], // comment extension
    [0x21, 0xff, 0x0b, ...chars("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00], // application extension
    [0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00], // graphic control extension
    [0x2c, ...u16le(0), ...u16le(0), ...u16le(2), ...u16le(2), 0x00], // image descriptor
    [0x02, 0x02, 0x4c, 0x01, 0x00], // LZW code size + one sub-block
    [0x3b], // trailer
  ]);

  return { bytes };
}

const labelsOf = (parsed) => parsed.blocks.map((block) => block.label);
const blockNamed = (parsed, label) => parsed.blocks.find((block) => block.label === label);

// ------------------------------------------------------------------------ tests

describe("metadata peeler pipeline", () => {
  describe("format sniffing", () => {
    it("reads the signature, not the file name", () => {
      expect(pipeline.detectFormat(jpegFixture().bytes)).toBe("jpeg");
      expect(pipeline.detectFormat(pngFixture().bytes)).toBe("png");
      expect(pipeline.detectFormat(gifFixture().bytes)).toBe("gif");
    });

    it("refuses anything without a known signature", () => {
      expect(pipeline.detectFormat(Uint8Array.from([0x42, 0x4d, 0x00, 0x00]))).toBe(null);
      expect(pipeline.detectFormat(new Uint8Array(0))).toBe(null);
      expect(pipeline.detectFormat(null)).toBe(null);
    });

    it("reports an unreadable file instead of guessing", () => {
      const parsed = pipeline.parseFile(Uint8Array.from(chars("not an image at all")), "notes.txt");

      expect(parsed.ok).toBe(false);
      expect(parsed.format).toBe(null);
      expect(parsed.warnings[0]).toMatch(/No JPEG, PNG or GIF signature/);
    });
  });

  describe("JPEG segments", () => {
    const { bytes, scan } = jpegFixture();
    const parsed = pipeline.parseFile(bytes, "field.jpg");

    it("names every segment it walks past", () => {
      expect(labelsOf(parsed)).toEqual([
        "SOI",
        "APP0 · JFIF",
        "APP1 · Exif",
        "APP2 · ICC",
        "COM",
        "DQT",
        "SOF0",
        "SOS",
        "scan data",
        "EOI",
        "post-EOI bytes",
      ]);
    });

    it("tells EXIF and XMP apart by payload identifier, not by marker", () => {
      expect(blockNamed(parsed, "APP1 · Exif").strip).toBe("exif");
      expect(blockNamed(parsed, "APP2 · ICC").strip).toBe("icc");
      expect(blockNamed(parsed, "COM").strip).toBe("comment");
      expect(blockNamed(parsed, "APP0 · JFIF").strip).toBe("other");
    });

    it("walks the scan past stuffing and restart markers", () => {
      const block = blockNamed(parsed, "scan data");

      expect(block.length).toBe(scan.length);
      expect(block.essential).toBe(true);
    });

    it("keeps the frame header readable", () => {
      const sof = blockNamed(parsed, "SOF0");

      expect(sof.detail).toBe("frame header — baseline DCT");
      expect(sof.fields).toEqual(
        expect.arrayContaining([
          { name: "size", value: "2 × 2" },
          { name: "precision", value: "8 bits" },
        ]),
      );
    });

    it("keeps the COM text", () => {
      expect(blockNamed(parsed, "COM").fields).toEqual(expect.arrayContaining([{ name: "text", value: "grown in Rolnopol" }]));
    });

    it("reports bytes appended after EOI", () => {
      const tail = blockNamed(parsed, "post-EOI bytes");

      expect(tail.length).toBe(2);
      expect(tail.strip).toBe("other");
    });

    it("covers every byte of the file exactly once", () => {
      expect(parsed.gaps).toEqual([]);
      expect(pipeline.coverage(parsed.blocks, bytes.length)).toEqual([]);

      const summed = parsed.blocks.reduce((total, block) => total + block.length, 0);

      expect(summed).toBe(bytes.length);
    });
  });

  describe("PNG chunks", () => {
    const { bytes } = pngFixture();
    const parsed = pipeline.parseFile(bytes, "field.png");

    it("names every chunk and stops at IEND", () => {
      expect(labelsOf(parsed)).toEqual(["signature", "IHDR", "tEXt", "iTXt", "tIME", "eXIf", "IDAT", "IEND"]);
    });

    it("never marks a critical chunk removable", () => {
      for (const label of ["IHDR", "IDAT", "IEND"]) {
        expect(blockNamed(parsed, label).essential, `${label} must be essential`).toBe(true);
        expect(blockNamed(parsed, label).strip).toBe(null);
      }
    });

    it("reads the image header", () => {
      expect(blockNamed(parsed, "IHDR").fields).toEqual(
        expect.arrayContaining([
          { name: "size", value: "2 × 2" },
          { name: "colour", value: "truecolour + alpha" },
        ]),
      );
    });

    it("decodes a tEXt keyword and value", () => {
      expect(blockNamed(parsed, "tEXt").fields).toEqual(
        expect.arrayContaining([
          { name: "keyword", value: "Comment" },
          { name: "text", value: "grown in Rolnopol" },
        ]),
      );
    });

    // XMP hides inside an iTXt, so the keyword has to decide the group.
    it("regroups an XMP packet out of the text chunks", () => {
      const chunk = blockNamed(parsed, "iTXt");

      expect(chunk.group).toBe("xmp");
      expect(chunk.strip).toBe("xmp");
      expect(chunk.detail).toBe("XMP packet (in iTXt)");
    });

    it("decodes tIME as a timestamp", () => {
      expect(blockNamed(parsed, "tIME").detail).toBe("modified 2026-08-25 12:30:45 UTC");
    });

    it("verifies each chunk CRC", () => {
      for (const block of parsed.blocks.slice(1)) {
        expect(block.warning, `${block.label} CRC`).toBe(null);
        expect(block.fields.some((field) => field.name === "CRC" && field.value.endsWith("✓"))).toBe(true);
      }

      expect(parsed.warnings).toEqual([]);
    });

    it("catches a corrupted chunk instead of trusting it", () => {
      const broken = Uint8Array.from(bytes);
      const chunk = blockNamed(parsed, "tEXt");

      broken[chunk.dataOffset] ^= 0xff;

      const reparsed = pipeline.parseFile(broken, "broken.png");

      expect(blockNamed(reparsed, "tEXt").warning).toBe("CRC mismatch");
      expect(reparsed.warnings.join(" ")).toMatch(/CRC/);
    });

    // The canonical empty-IEND CRC, straight out of the PNG specification.
    it("computes CRC-32 the way PNG does", () => {
      expect(pipeline.crc32(Uint8Array.from(chars("IEND")), 0, 4)).toBe(0xae426082);
    });

    it("covers every byte of the file exactly once", () => {
      expect(parsed.gaps).toEqual([]);
    });
  });

  describe("GIF blocks", () => {
    const { bytes } = gifFixture();
    const parsed = pipeline.parseFile(bytes, "field.gif");

    it("walks the block chain to the trailer", () => {
      expect(labelsOf(parsed)).toEqual([
        "header",
        "screen descriptor",
        "global colour table",
        "comment extension",
        "application extension · NETSCAPE2.0",
        "graphic control extension",
        "image block",
        "trailer",
      ]);
    });

    it("keeps the comment text and the frame timing apart", () => {
      expect(blockNamed(parsed, "comment extension").fields).toEqual(expect.arrayContaining([{ name: "text", value: "hello" }]));
      expect(blockNamed(parsed, "comment extension").strip).toBe("comment");

      // Frame delay is metadata by shape, but dropping it changes playback.
      expect(blockNamed(parsed, "graphic control extension").essential).toBe(true);
    });

    it("covers every byte of the file exactly once", () => {
      expect(parsed.gaps).toEqual([]);
    });
  });

  describe("EXIF tree", () => {
    const parsed = pipeline.parseFile(jpegFixture().bytes, "field.jpg");
    const exif = parsed.exif;

    it("follows the pointers into every directory", () => {
      expect(exif.byteOrder).toBe("little-endian (II)");
      expect(exif.ifds.map((ifd) => ifd.name)).toEqual(["IFD0", "Exif IFD", "GPS IFD", "IFD1 (thumbnail)"]);
      expect(exif.entryCount).toBe(12);
    });

    it("reads an ASCII value that lives outside its entry", () => {
      const make = exif.byName.IFD0.entries.find((entry) => entry.name === "Make");

      expect(make.typeName).toBe("ASCII");
      expect(make.display).toBe("Rolnopol");
    });

    it("names a coded value as well as showing it", () => {
      const orientation = exif.byName.IFD0.entries.find((entry) => entry.name === "Orientation");

      expect(orientation.display).toBe("rotated 90° CW (6)");
    });

    it("turns three rationals and a hemisphere letter into decimal degrees", () => {
      expect(exif.location).toEqual({ latitude: 50.06, longitude: 19.938333 });
      expect(pipeline.gpsDecimal([50, 3, 36], "S")).toBe(-50.06);
      expect(pipeline.gpsDecimal([19, 56, 18], "W")).toBe(-19.938333);
      expect(pipeline.gpsDecimal([], "N")).toBe(null);
    });

    it("locates the embedded thumbnail", () => {
      const thumbnail = pipeline.extractThumbnail(jpegFixture().bytes, exif);

      expect(thumbnail).toBeInstanceOf(Uint8Array);
      expect([...thumbnail]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    });

    it("reads the same tree out of a PNG eXIf chunk", () => {
      const fromPng = pipeline.parseFile(pngFixture().bytes, "field.png");

      expect(fromPng.exif.location).toEqual({ latitude: 50.06, longitude: 19.938333 });
      expect(fromPng.exif.ifds.map((ifd) => ifd.name)).toEqual(["IFD0", "Exif IFD", "GPS IFD", "IFD1 (thumbnail)"]);
    });

    it("survives a pointer that leaves the block", () => {
      const bytes = Uint8Array.from(jpegFixture().bytes);
      const exifBlock = blockNamed(parsed, "APP1 · Exif");
      // The GPSInfoIFDPointer value sits in IFD0's fourth entry, at its offset+8.
      const pointerAt = exifBlock.dataOffset + 6 + 8 + 2 + 3 * 12 + 8;

      bytes[pointerAt] = 0xff;
      bytes[pointerAt + 1] = 0xff;
      bytes[pointerAt + 2] = 0xff;
      bytes[pointerAt + 3] = 0x7f;

      const reparsed = pipeline.parseFile(bytes, "bent.jpg");

      expect(reparsed.exif.byName["GPS IFD"]).toBeUndefined();
      expect(reparsed.warnings.join(" ")).toMatch(/points outside the block/);
    });

    it("rejects a block whose TIFF header is not a TIFF header", () => {
      const broken = pipeline.parseExif(Uint8Array.from(chars("XXnot a tiff header at all")), 0);

      expect(broken.ok).toBe(false);
      expect(broken.error).toMatch(/Unknown byte order/);
    });
  });

  describe("exposure findings", () => {
    const parsed = pipeline.parseFile(jpegFixture().bytes, "field.jpg");
    const findings = pipeline.auditFindings(parsed);
    const labels = findings.map((item) => item.label);

    it("leads with the coordinates", () => {
      expect(findings[0].level).toBe("high");
      expect(findings[0].label).toBe("GPS coordinates");
      expect(findings[0].detail).toContain("50.06, 19.938333");
    });

    it("flags the thumbnail as surviving a crop", () => {
      const thumbnail = findings.find((item) => item.label === "Embedded thumbnail");

      expect(thumbnail.level).toBe("high");
      expect(thumbnail.detail).toMatch(/crops and redactions/i);
    });

    it("separates identity from device fingerprint", () => {
      expect(findings.find((item) => item.label === "Identity fields").detail).toContain("JT-1234");
      expect(findings.find((item) => item.label === "Device fingerprint").detail).toContain("Rolnopol");
    });

    it("reports the container blocks too", () => {
      expect(labels).toContain("Comment blocks");
      expect(labels).toContain("ICC colour profile");
      expect(labels).toContain("Data past the end");
    });

    it("says so when there is nothing to peel", () => {
      const clean = pipeline.parseFile(
        pipeline.stripMetadata(pngFixture().bytes, pipeline.parseFile(pngFixture().bytes, "a.png"), pipeline.STRIP_KEYS).bytes,
        "clean.png",
      );
      const findings = pipeline.auditFindings(clean);

      expect(findings).toHaveLength(1);
      expect(findings[0].level).toBe("clean");
    });
  });

  describe("stripping", () => {
    it("removes only the selected groups", () => {
      const { bytes } = jpegFixture();
      const parsed = pipeline.parseFile(bytes, "field.jpg");
      const result = pipeline.stripMetadata(bytes, parsed, ["exif", "comment"]);
      const reparsed = pipeline.parseFile(result.bytes, "peeled.jpg");

      expect(labelsOf(reparsed)).toEqual(["SOI", "APP0 · JFIF", "APP2 · ICC", "DQT", "SOF0", "SOS", "scan data", "EOI", "post-EOI bytes"]);
      expect(reparsed.exif).toBe(null);
      expect(result.removed.map((item) => item.label)).toEqual(["APP1 · Exif", "COM"]);
    });

    it("copies the image data byte for byte", () => {
      const { bytes, scan } = jpegFixture();
      const parsed = pipeline.parseFile(bytes, "field.jpg");
      const result = pipeline.stripMetadata(bytes, parsed, pipeline.STRIP_KEYS);
      const reparsed = pipeline.parseFile(result.bytes, "peeled.jpg");
      const block = blockNamed(reparsed, "scan data");

      expect([...result.bytes.subarray(block.offset, block.offset + block.length)]).toEqual(scan);
    });

    it("strips a PNG down to its critical chunks and leaves the CRCs intact", () => {
      const { bytes } = pngFixture();
      const parsed = pipeline.parseFile(bytes, "field.png");
      const result = pipeline.stripMetadata(bytes, parsed, pipeline.STRIP_KEYS);
      const reparsed = pipeline.parseFile(result.bytes, "peeled.png");

      expect(labelsOf(reparsed)).toEqual(["signature", "IHDR", "IDAT", "IEND"]);
      expect(reparsed.warnings).toEqual([]);
      expect(reparsed.exif).toBe(null);
      expect(result.bytes.length).toBeLessThan(bytes.length);
    });

    it("drops a GIF comment without disturbing the frame", () => {
      const { bytes } = gifFixture();
      const parsed = pipeline.parseFile(bytes, "field.gif");
      const result = pipeline.stripMetadata(bytes, parsed, ["comment"]);
      const reparsed = pipeline.parseFile(result.bytes, "peeled.gif");

      expect(labelsOf(reparsed)).not.toContain("comment extension");
      expect(labelsOf(reparsed)).toContain("graphic control extension");
      expect(labelsOf(reparsed)).toContain("image block");
    });

    it("keeps everything when nothing is selected", () => {
      const { bytes } = jpegFixture();
      const parsed = pipeline.parseFile(bytes, "field.jpg");
      const result = pipeline.stripMetadata(bytes, parsed, []);

      expect([...result.bytes]).toEqual([...bytes]);
      expect(result.removedCount).toBe(0);
    });

    it("never drops a block the format needs", () => {
      for (const fixture of [jpegFixture(), pngFixture(), gifFixture()]) {
        const parsed = pipeline.parseFile(fixture.bytes, "any");
        const result = pipeline.stripMetadata(fixture.bytes, parsed, pipeline.STRIP_KEYS);

        expect(result.removed.some((item) => item.label === "scan data")).toBe(false);
        expect(pipeline.detectFormat(result.bytes)).toBe(parsed.format);
        expect(pipeline.parseFile(result.bytes, "any").ok).toBe(true);
      }
    });

    it("previews exactly what the peel will do", () => {
      for (const fixture of [jpegFixture(), pngFixture(), gifFixture()]) {
        const parsed = pipeline.parseFile(fixture.bytes, "any");

        for (const groups of [[], ["exif"], ["exif", "comment", "text"], pipeline.STRIP_KEYS]) {
          const preview = pipeline.previewStrip(parsed, groups);
          const result = pipeline.stripMetadata(fixture.bytes, parsed, groups);

          expect(preview.after).toBe(result.bytes.length);
          expect(preview.removedBytes).toBe(result.removedBytes);
          expect(preview.removedCount).toBe(result.removedCount);
        }
      }
    });

    it("accepts a toggle map as well as a list", () => {
      const { bytes } = pngFixture();
      const parsed = pipeline.parseFile(bytes, "field.png");
      const fromList = pipeline.stripMetadata(bytes, parsed, ["text", "time"]);
      const fromMap = pipeline.stripMetadata(bytes, parsed, { text: true, time: true, icc: false });

      expect([...fromMap.bytes]).toEqual([...fromList.bytes]);
    });

    it("preserves bytes no block could account for", () => {
      // A chunk that claims more than the file holds stops the walk, and the
      // remainder must survive the peel rather than vanish into a gap.
      const truncated = pngFixture().bytes.slice(0, 60);
      const parsed = pipeline.parseFile(truncated, "cut.png");
      const result = pipeline.stripMetadata(truncated, parsed, pipeline.STRIP_KEYS);
      const accounted = parsed.blocks.reduce((total, block) => total + block.length, 0);

      expect(parsed.warnings.join(" ")).toMatch(/ends first/);
      expect(accounted + parsed.gaps.reduce((total, gap) => total + gap.length, 0)).toBe(truncated.length);
      expect(result.bytes.length).toBeGreaterThan(0);
    });
  });

  describe("summary and report", () => {
    const { bytes } = jpegFixture();
    const parsed = pipeline.parseFile(bytes, "field.jpg");
    const summary = pipeline.summarise(parsed);

    it("counts metadata against the whole file", () => {
      expect(summary.size).toBe(bytes.length);
      expect(summary.blocks).toBe(parsed.blocks.length);
      expect(summary.metadataBytes + summary.essentialBytes).toBe(bytes.length);
      expect(summary.share).toBeGreaterThan(0.5); // this fixture is mostly EXIF
      expect(summary.groups.exif).toBeGreaterThan(summary.groups.comment);
    });

    it("writes a report with the blocks and the tags in it", () => {
      const report = pipeline.buildReport(parsed, pipeline.auditFindings(parsed), summary);

      expect(report).toContain("METADATA PEELER");
      expect(report).toContain("field.jpg");
      expect(report).toContain("GPS coordinates");
      expect(report).toContain("APP1 · Exif");
      expect(report).toContain("BodySerialNumber");
      expect(report).toContain("JT-1234");
    });

    it("dumps bytes as hex and ASCII", () => {
      const dump = pipeline.hexDump(Uint8Array.from(chars("Rolnopol operator tools")), 0, 23, 2);

      expect(dump.rows).toHaveLength(2);
      expect(dump.rows[0].label).toBe("00000000");
      expect(dump.rows[0].hex.startsWith("52 6F 6C")).toBe(true);
      expect(dump.rows[0].ascii).toBe("Rolnopol operato");
      expect(dump.rows[1].ascii).toBe("r tools");
      expect(dump.total).toBe(23);
    });

    it("formats byte counts the way the readouts do", () => {
      expect(pipeline.formatBytes(512)).toBe("512 B");
      expect(pipeline.formatBytes(2048)).toBe("2.0 KB");
      expect(pipeline.formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    });
  });

  describe("robustness", () => {
    it("does not loop forever on a self-referencing IFD", () => {
      const { bytes } = jpegFixture();
      const parsed = pipeline.parseFile(bytes, "field.jpg");
      const exifBlock = blockNamed(parsed, "APP1 · Exif");
      const bent = Uint8Array.from(bytes);
      // Point the Exif sub-IFD pointer back at IFD0.
      const pointerAt = exifBlock.dataOffset + 6 + 8 + 2 + 2 * 12 + 8;

      bent[pointerAt] = 8;
      bent[pointerAt + 1] = 0;
      bent[pointerAt + 2] = 0;
      bent[pointerAt + 3] = 0;

      const reparsed = pipeline.parseFile(bent, "loop.jpg");

      expect(reparsed.warnings.join(" ")).toMatch(/pointer loop/);
      expect(reparsed.exif.ifds.length).toBeLessThan(5);
    });

    it("stops on a segment that claims an impossible length", () => {
      const bent = Uint8Array.from(jpegFixture().bytes);

      bent[4] = 0x00; // APP0 length -> 0
      bent[5] = 0x00;

      const parsed = pipeline.parseFile(bent, "bent.jpg");
      const tail = blockNamed(parsed, "unparsed bytes");

      expect(parsed.warnings.join(" ")).toMatch(/impossible length/);

      // The walk gives up, but the bytes it never named stay visible and stay in
      // the file: an aborted parse must not turn into a silent deletion.
      expect(tail.offset).toBe(2);
      expect(tail.length).toBe(bent.length - 2);
      expect(parsed.gaps).toEqual([]);
      expect([...pipeline.stripMetadata(bent, parsed, ["exif", "comment"]).bytes]).toEqual([...bent]);
    });

    it("handles a file that is nothing but a signature", () => {
      for (const bytes of [
        Uint8Array.from([0xff, 0xd8, 0xff]),
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Uint8Array.from(chars("GIF89a")),
      ]) {
        const parsed = pipeline.parseFile(bytes, "stub");

        expect(parsed.ok).toBe(true);
        expect(pipeline.summarise(parsed).size).toBe(bytes.length);
        expect(pipeline.stripMetadata(bytes, parsed, pipeline.STRIP_KEYS).bytes.length).toBeLessThanOrEqual(bytes.length);
      }
    });
  });

  describe("strip groups", () => {
    it("declares every key a block may carry", () => {
      const keys = new Set(pipeline.STRIP_KEYS);

      for (const fixture of [jpegFixture(), pngFixture(), gifFixture()]) {
        for (const block of pipeline.parseFile(fixture.bytes, "any").blocks) {
          if (block.essential) continue;

          expect(keys.has(block.strip), `block ${block.label} uses unknown strip key ${block.strip}`).toBe(true);
        }
      }
    });

    it("defaults the two risky groups to off", () => {
      const off = pipeline.STRIP_GROUPS.filter((group) => !group.default).map((group) => group.key);

      expect(off).toEqual(["icc", "other"]);
    });
  });
});
