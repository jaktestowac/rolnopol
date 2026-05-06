const AVATAR_MAX_SIZE_BYTES = 100 * 1024;
const AVATAR_MAX_DIMENSION = 256;
const ALLOWED_AVATAR_MIME_TYPES = ["image/png", "image/jpeg"];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function getPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error("Malformed PNG image");
  }

  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Malformed PNG image");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Malformed JPEG image");
  }

  let offset = 2;

  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) {
      offset += 1;
    }

    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 7 > buffer.length) {
        break;
      }

      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }

    offset += segmentLength;
  }

  throw new Error("Malformed JPEG image");
}

function getImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") {
    return getPngDimensions(buffer);
  }

  if (mimeType === "image/jpeg") {
    return getJpegDimensions(buffer);
  }

  throw new Error("Unsupported avatar image format");
}

function validateAvatarUpload(buffer, mimeType) {
  const errors = [];
  const normalizedMimeType = typeof mimeType === "string" ? mimeType.split(";")[0].trim().toLowerCase() : "";

  if (!ALLOWED_AVATAR_MIME_TYPES.includes(normalizedMimeType)) {
    errors.push("Avatar must be a PNG or JPEG image");
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    errors.push("Avatar image is required");
  }

  if (Buffer.isBuffer(buffer) && buffer.length > AVATAR_MAX_SIZE_BYTES) {
    errors.push("Avatar image must be 100 KB or smaller");
  }

  let dimensions = null;
  if (errors.length === 0) {
    try {
      dimensions = getImageDimensions(buffer, normalizedMimeType);
    } catch (error) {
      errors.push(error.message || "Malformed avatar image");
    }
  }

  if (dimensions && (dimensions.width > AVATAR_MAX_DIMENSION || dimensions.height > AVATAR_MAX_DIMENSION)) {
    errors.push("Avatar image must be at most 256x256 pixels");
  }

  return {
    isValid: errors.length === 0,
    errors,
    mimeType: normalizedMimeType,
    dimensions,
  };
}

function createAvatarDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

module.exports = {
  AVATAR_MAX_SIZE_BYTES,
  AVATAR_MAX_DIMENSION,
  ALLOWED_AVATAR_MIME_TYPES,
  validateAvatarUpload,
  createAvatarDataUrl,
};
