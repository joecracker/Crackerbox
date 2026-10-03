// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseImageInfo } from "./image_info";

const u16be = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const i32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
const u24le = (n: number) =>
  Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

function png(w: number, h: number) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    Buffer.from("IHDR", "latin1"),
    u32be(w),
    u32be(h),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
}

function jpegSegment(marker: number, payloadLength: number) {
  return Buffer.concat([
    Buffer.from([0xff, marker]),
    u16be(payloadLength + 2),
    Buffer.alloc(payloadLength),
  ]);
}

function jpegSof(marker: number, w: number, h: number) {
  return Buffer.concat([
    Buffer.from([0xff, marker]),
    u16be(17),
    Buffer.from([8]),
    u16be(h),
    u16be(w),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  ]);
}

const SOI = Buffer.from([0xff, 0xd8]);

describe("parseImageInfo", () => {
  it("reads PNG", () => {
    expect(parseImageInfo(png(1024, 768))).toEqual({
      format: "png",
      width: 1024,
      height: 768,
    });
  });

  it("reads a baseline JPEG after a short APP0", () => {
    const buf = Buffer.concat([
      SOI,
      jpegSegment(0xe0, 14),
      jpegSof(0xc0, 768, 1376),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "jpeg",
      width: 768,
      height: 1376,
    });
  });

  it("reads a progressive JPEG (SOF2)", () => {
    const buf = Buffer.concat([
      SOI,
      jpegSegment(0xe0, 14),
      jpegSof(0xc2, 4000, 3000),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "jpeg",
      width: 4000,
      height: 3000,
    });
  });

  it("finds the frame header after large EXIF and ICC segments", () => {
    const buf = Buffer.concat([
      SOI,
      jpegSegment(0xe1, 65000),
      jpegSegment(0xe2, 65000),
      jpegSegment(0xdb, 130),
      jpegSegment(0xc4, 400),
      jpegSof(0xc0, 640, 480),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "jpeg",
      width: 640,
      height: 480,
    });
  });

  it("does not mistake DHT (C4) or DAC (CC) for a frame header", () => {
    const buf = Buffer.concat([
      SOI,
      jpegSegment(0xc4, 30),
      jpegSegment(0xcc, 4),
      jpegSof(0xc1, 320, 200),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "jpeg",
      width: 320,
      height: 200,
    });
  });

  it("tolerates 0xFF fill bytes before a marker", () => {
    const buf = Buffer.concat([
      SOI,
      Buffer.from([0xff, 0xff, 0xff]),
      jpegSegment(0xe0, 14),
      jpegSof(0xc0, 100, 50),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "jpeg",
      width: 100,
      height: 50,
    });
  });

  it("returns null for a JPEG that reaches the scan before any frame header", () => {
    const buf = Buffer.concat([
      SOI,
      jpegSegment(0xe0, 14),
      Buffer.from([0xff, 0xda, 0x00, 0x02]),
    ]);
    expect(parseImageInfo(buf)).toBeNull();
  });

  it("returns quickly (null) for a corrupt zero-length segment instead of looping", () => {
    const buf = Buffer.concat([
      SOI,
      Buffer.from([0xff, 0xe0, 0x00, 0x00]),
      Buffer.alloc(1000),
    ]);
    const t0 = Date.now();
    expect(parseImageInfo(buf)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("returns null for a truncated JPEG", () => {
    expect(
      parseImageInfo(Buffer.concat([SOI, jpegSegment(0xe0, 14)])),
    ).toBeNull();
    expect(parseImageInfo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("reads GIF", () => {
    const buf = Buffer.concat([
      Buffer.from("GIF89a", "latin1"),
      u16le(320),
      u16le(240),
      Buffer.alloc(8),
    ]);
    expect(parseImageInfo(buf)).toEqual({
      format: "gif",
      width: 320,
      height: 240,
    });
  });

  it("reads BMP, including a top-down (negative height) one", () => {
    const make = (h: number) =>
      Buffer.concat([
        Buffer.from("BM", "latin1"),
        Buffer.alloc(12),
        u32le(40),
        i32le(200),
        i32le(h),
        Buffer.alloc(20),
      ]);
    expect(parseImageInfo(make(100))).toEqual({
      format: "bmp",
      width: 200,
      height: 100,
    });
    expect(parseImageInfo(make(-100))).toEqual({
      format: "bmp",
      width: 200,
      height: 100,
    });
  });

  it("reads WebP in all three flavours", () => {
    const riff = (chunk: string, data: Buffer) =>
      Buffer.concat([
        Buffer.from("RIFF", "latin1"),
        u32le(4 + 8 + data.length),
        Buffer.from("WEBP", "latin1"),
        Buffer.from(chunk, "latin1"),
        u32le(data.length),
        data,
      ]);
    const vp8x = riff(
      "VP8X",
      Buffer.concat([
        Buffer.alloc(4),
        u24le(1919),
        u24le(1079),
        Buffer.alloc(4),
      ]),
    );
    expect(parseImageInfo(vp8x)).toEqual({
      format: "webp",
      width: 1920,
      height: 1080,
    });

    const bits = (500 - 1) | ((300 - 1) << 14);
    const vp8l = riff(
      "VP8L",
      Buffer.concat([Buffer.from([0x2f]), u32le(bits >>> 0), Buffer.alloc(4)]),
    );
    expect(parseImageInfo(vp8l)).toEqual({
      format: "webp",
      width: 500,
      height: 300,
    });

    const vp8 = riff(
      "VP8 ",
      Buffer.concat([
        Buffer.alloc(3),
        Buffer.from([0x9d, 0x01, 0x2a]),
        u16le(640),
        u16le(360),
        Buffer.alloc(4),
      ]),
    );
    expect(parseImageInfo(vp8)).toEqual({
      format: "webp",
      width: 640,
      height: 360,
    });
  });

  it("returns null for non-images and empty input", () => {
    expect(
      parseImageInfo(Buffer.from("just some text, not an image")),
    ).toBeNull();
    expect(parseImageInfo(Buffer.alloc(0))).toBeNull();
    expect(parseImageInfo(png(0, 10))).toBeNull();
  });
});
