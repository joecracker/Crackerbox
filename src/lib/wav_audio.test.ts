import { describe, expect, it } from "vitest";
import { encodeWav, mixToMono } from "./wav_audio";

describe("encodeWav", () => {
  it("writes a real 16-bit mono .wav file", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 24000);
    const view = new DataView(wav.buffer);
    const text = (at: number) =>
      String.fromCharCode(...wav.subarray(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
    expect(wav.byteLength).toBe(44 + 6 * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(46, true)).toBe(16384); // 0.5
    expect(view.getInt16(48, true)).toBe(-16383);
    expect(view.getInt16(50, true)).toBe(32767); // 1
    expect(view.getInt16(52, true)).toBe(-32767); // -1
    expect(view.getInt16(54, true)).toBe(32767); // 2 is clipped
  });
});

describe("mixToMono", () => {
  it("averages the channels and passes one channel through", () => {
    const one = new Float32Array([0.2, 0.4]);
    expect(mixToMono([one])).toBe(one);
    const mixed = mixToMono([
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
    ]);
    expect(Array.from(mixed)).toEqual([0.5, 0.5]);
    expect(mixToMono([]).length).toBe(0);
  });
});
