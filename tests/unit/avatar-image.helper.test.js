import { describe, it, expect } from "vitest";

const { validateAvatarUpload, createAvatarDataUrl, AVATAR_MAX_SIZE_BYTES } = require("../../helpers/avatar-image");

// Build a minimal but structurally valid PNG buffer of the given dimensions.
function pngBuffer(width = 1, height = 1) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, 4, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

// Build a minimal JPEG with a SOF0 marker carrying the given dimensions.
function jpegBuffer(width = 1, height = 1) {
  // SOI + SOF0 marker (0xFFC0), length 17, precision 8, height, width, 3 components.
  // The declared segment length (17) is measured from offset 4, so the buffer must
  // be at least 4 + 17 = 21 bytes long for the parser to accept the segment.
  const sof = Buffer.alloc(21);
  sof.writeUInt16BE(0xffd8, 0); // SOI
  sof.writeUInt16BE(0xffc0, 2); // SOF0
  sof.writeUInt16BE(17, 4); // segment length
  sof.writeUInt8(8, 6); // precision
  sof.writeUInt16BE(height, 7);
  sof.writeUInt16BE(width, 9);
  return sof;
}

describe("avatar-image helper", () => {
  describe("validateAvatarUpload", () => {
    it("accepts a small valid PNG", () => {
      const result = validateAvatarUpload(pngBuffer(64, 64), "image/png");
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.dimensions).toEqual({ width: 64, height: 64 });
      expect(result.mimeType).toBe("image/png");
    });

    it("accepts a valid JPEG and strips charset params from the mime type", () => {
      const result = validateAvatarUpload(jpegBuffer(32, 48), "image/jpeg; charset=binary");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.dimensions).toEqual({ width: 32, height: 48 });
    });

    it("rejects an unsupported mime type", () => {
      const result = validateAvatarUpload(pngBuffer(), "image/gif");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Avatar must be a PNG or JPEG image");
    });

    it("rejects an empty / non-buffer payload", () => {
      const result = validateAvatarUpload(Buffer.alloc(0), "image/png");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Avatar image is required");
    });

    it("rejects an oversized image", () => {
      const big = pngBuffer(10, 10);
      const padded = Buffer.concat([big, Buffer.alloc(AVATAR_MAX_SIZE_BYTES + 1)]);
      const result = validateAvatarUpload(padded, "image/png");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Avatar image must be 100 KB or smaller");
    });

    it("rejects a malformed PNG", () => {
      const result = validateAvatarUpload(Buffer.from("not a png but long enough to pass length check........"), "image/png");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("Malformed PNG"))).toBe(true);
    });

    it("rejects an image exceeding the maximum dimensions", () => {
      const result = validateAvatarUpload(pngBuffer(512, 512), "image/png");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Avatar image must be at most 256x256 pixels");
    });
  });

  describe("createAvatarDataUrl", () => {
    it("builds a base64 data URL", () => {
      const url = createAvatarDataUrl(Buffer.from("hi"), "image/png");
      expect(url).toBe(`data:image/png;base64,${Buffer.from("hi").toString("base64")}`);
    });
  });
});
