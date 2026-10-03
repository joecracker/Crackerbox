/**
 * Reads an image's format and pixel size straight from its file header.
 *
 * This exists so a sandbox script never has to decode image bytes by hand:
 * the sandbox interpreter is far too slow for that (decoding a 700,000
 * character base64 string takes over a minute and used to freeze the app).
 *
 * Supported: JPEG, PNG, GIF, WebP, BMP. Width and height are the values
 * stored in the file; EXIF rotation is not applied.
 */

export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "bmp";

export interface ParsedImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

/** Bytes of the file header that are read. Enough for any normal JPEG. */
export const IMAGE_INFO_HEADER_BYTES = 2 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

function asciiAt(buf: Buffer, offset: number, length: number): string {
  if (offset + length > buf.length) {
    return "";
  }
  return buf.toString("latin1", offset, offset + length);
}

function valid(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0
  );
}

function parsePng(buf: Buffer): ParsedImageInfo | null {
  // 8 byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4).
  if (buf.length < 24 || asciiAt(buf, 12, 4) !== "IHDR") {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return valid(width, height) ? { format: "png", width, height } : null;
}

function parseGif(buf: Buffer): ParsedImageInfo | null {
  if (buf.length < 10) {
    return null;
  }
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return valid(width, height) ? { format: "gif", width, height } : null;
}

function parseBmp(buf: Buffer): ParsedImageInfo | null {
  if (buf.length < 26) {
    return null;
  }
  const headerSize = buf.readUInt32LE(14);
  if (headerSize === 12) {
    // Old OS/2 style header: unsigned 16 bit sizes.
    const width = buf.readUInt16LE(18);
    const height = buf.readUInt16LE(20);
    return valid(width, height) ? { format: "bmp", width, height } : null;
  }
  const width = buf.readInt32LE(18);
  // A negative height only means the rows are stored top-down.
  const height = Math.abs(buf.readInt32LE(22));
  return valid(width, height) ? { format: "bmp", width, height } : null;
}

function parseWebp(buf: Buffer): ParsedImageInfo | null {
  if (asciiAt(buf, 0, 4) !== "RIFF" || asciiAt(buf, 8, 4) !== "WEBP") {
    return null;
  }
  const chunk = asciiAt(buf, 12, 4);
  if (chunk === "VP8 ") {
    // Lossy: 3 byte frame tag, start code 9D 01 2A, then 14 bit sizes.
    if (
      buf.length < 30 ||
      buf[23] !== 0x9d ||
      buf[24] !== 0x01 ||
      buf[25] !== 0x2a
    ) {
      return null;
    }
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return valid(width, height) ? { format: "webp", width, height } : null;
  }
  if (chunk === "VP8L") {
    // Lossless: signature byte 0x2F, then 14 bit (size - 1) values.
    if (buf.length < 25 || buf[20] !== 0x2f) {
      return null;
    }
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return valid(width, height) ? { format: "webp", width, height } : null;
  }
  if (chunk === "VP8X") {
    // Extended: 24 bit (size - 1) values.
    if (buf.length < 30) {
      return null;
    }
    const width = buf.readUIntLE(24, 3) + 1;
    const height = buf.readUIntLE(27, 3) + 1;
    return valid(width, height) ? { format: "webp", width, height } : null;
  }
  return null;
}

function parseJpeg(buf: Buffer): ParsedImageInfo | null {
  let pos = 2; // after the FFD8 start-of-image marker
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) {
      pos += 1; // resynchronise on the next marker
      continue;
    }
    // Any number of 0xFF fill bytes may precede a marker code.
    while (pos + 1 < buf.length && buf[pos + 1] === 0xff) {
      pos += 1;
    }
    const marker = buf[pos + 1];
    // Standalone markers carry no length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    // End of image or start of scan before any frame header: no size found.
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (pos + 4 > buf.length) {
      return null;
    }
    const segmentLength = buf.readUInt16BE(pos + 2);
    if (segmentLength < 2) {
      return null; // corrupt: would never advance
    }
    // SOF0-SOF15 hold the frame size, except C4 (DHT), C8 (JPG) and CC (DAC).
    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrameHeader) {
      if (pos + 9 > buf.length) {
        return null;
      }
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      return valid(width, height) ? { format: "jpeg", width, height } : null;
    }
    pos += 2 + segmentLength;
  }
  return null;
}

/** Returns the image format and size, or null if the bytes are not a supported image. */
export function parseImageInfo(buf: Buffer): ParsedImageInfo | null {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return parseJpeg(buf);
  }
  if (startsWith(buf, PNG_SIGNATURE)) {
    return parsePng(buf);
  }
  const head = asciiAt(buf, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") {
    return parseGif(buf);
  }
  if (asciiAt(buf, 0, 2) === "BM") {
    return parseBmp(buf);
  }
  if (asciiAt(buf, 0, 4) === "RIFF") {
    return parseWebp(buf);
  }
  return null;
}
