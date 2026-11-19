import { describe, expect, it } from "vitest";
import {
  POCKET_VOICES,
  customVoiceId,
  customVoiceNameOf,
  isBuiltInPocketVoice,
  isPocketVoice,
} from "./pocket_voices";

describe("pocket voices", () => {
  it("keeps the original eight first and has no duplicates", () => {
    expect(POCKET_VOICES.slice(0, 3).map(([id]) => id)).toEqual([
      "azelma",
      "cosette",
      "eponine",
    ]);
    const ids = POCKET_VOICES.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accepts built-in names and safe custom names only", () => {
    expect(isPocketVoice("azelma")).toBe(true);
    expect(isPocketVoice("anna")).toBe(true);
    expect(isPocketVoice(customVoiceId("My Voice"))).toBe(true);
    expect(isBuiltInPocketVoice("custom:My Voice")).toBe(false);
    for (const bad of [
      "custom:../x",
      "custom:a/b",
      "custom:a\b",
      "custom:",
      "custom: spaced",
      "custom:.hidden",
      "nobody",
      42,
      null,
    ]) {
      expect(isPocketVoice(bad)).toBe(false);
    }
    expect(customVoiceNameOf("custom:" + "x".repeat(57))).toBeNull();
    expect(customVoiceNameOf("custom:" + "x".repeat(56))).not.toBeNull();
  });
});
