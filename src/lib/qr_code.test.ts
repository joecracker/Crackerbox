// @vitest-environment node
import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { qrDataUrl, qrMatrix } from "./qr_code";

// Reads the code back the way a phone camera would: turn the squares into
// pixels (with the quiet border a real code has) and decode them.
function decode(text: string): string | null {
  const matrix = qrMatrix(text);
  const scale = 6;
  const border = 4;
  const size = (matrix.length + border * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px =
            ((r + border) * scale + y) * size + (c + border) * scale + x;
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }),
  );
  return jsQR(data, size, size)?.data ?? null;
}

describe("QR code", () => {
  it("reads back as the exact address it was made from", () => {
    for (const text of [
      "https://remote.example.com/?cbpair=1",
      "http://192.168.1.16:4319/?cbpair=1",
    ]) {
      expect(decode(text)).toBe(text);
    }
  });

  it("makes a picture a plain image tag can show", () => {
    expect(qrDataUrl("https://remote.example.com/?cbpair=1")).toMatch(
      /^data:image\/gif;base64,/,
    );
  });
});
