import { describe, expect, it } from "vitest";
import {
  chooseTemperature,
  modelIgnoresTemperament,
  normalizeTemperature,
  presetIndexForTemperature,
  TEMPERAMENT_PRESETS,
  temperatureForPresetIndex,
} from "./temperament";

describe("slider stops and temperatures", () => {
  it("maps each stop to the agreed number, with Default left unset", () => {
    expect(TEMPERAMENT_PRESETS.map((p) => p.label)).toEqual([
      "Straight-laced",
      "Steady",
      "Default",
      "Playful",
      "Wild",
    ]);
    expect([0, 1, 2, 3, 4].map(temperatureForPresetIndex)).toEqual([
      0.3,
      0.7,
      undefined,
      1.3,
      1.6,
    ]);
    expect(temperatureForPresetIndex(9)).toBeUndefined();
  });

  it("maps a stored temperature back to the nearest stop; unset is Default", () => {
    expect(presetIndexForTemperature(undefined)).toBe(2);
    expect(presetIndexForTemperature(0.3)).toBe(0);
    expect(presetIndexForTemperature(0.7)).toBe(1);
    expect(presetIndexForTemperature(1.3)).toBe(3);
    expect(presetIndexForTemperature(1.6)).toBe(4);
    expect(presetIndexForTemperature(0)).toBe(0);
    expect(presetIndexForTemperature(1)).toBe(1);
    expect(presetIndexForTemperature(1.1)).toBe(3);
    expect(presetIndexForTemperature(2)).toBe(4);
    expect(presetIndexForTemperature(99)).toBe(2);
  });

  it("round-trips every stop that has a number", () => {
    for (const i of [0, 1, 3, 4]) {
      expect(presetIndexForTemperature(temperatureForPresetIndex(i))).toBe(i);
    }
  });
});

describe("normalizeTemperature", () => {
  it.each([0, 0.3, 1, 2])("accepts %s", (v) => {
    expect(normalizeTemperature(v)).toBe(v);
  });
  it.each([-0.1, 2.1, NaN, Infinity, "1", null, undefined, {}])(
    "rejects %s",
    (v) => {
      expect(normalizeTemperature(v)).toBeUndefined();
    },
  );
});

describe("modelIgnoresTemperament", () => {
  it.each([
    [{ provider: "openai", name: "gpt-5" }],
    [{ provider: "openai", name: "gpt-5.2" }],
    [{ provider: "openai", name: "gpt-6-luna" }],
    [{ provider: "claude-code", name: "sonnet" }],
    [{ provider: "auto", name: "auto", connection: "subscription" }],
    [{ provider: "openrouter", name: "openai/gpt-5-mini" }],
    [{ provider: "azure", name: "o3" }],
    [{ provider: "azure", name: "o4-mini" }],
  ])("ignores for %j", (model) => {
    expect(modelIgnoresTemperament(model)).toBe(true);
  });

  it.each([
    [{ provider: "anthropic", name: "claude-sonnet-4-6" }],
    [{ provider: "google", name: "gemini-3-pro-preview" }],
    [{ provider: "lmstudio", name: "stub-model" }],
    [{ provider: "ollama", name: "llama3" }],
    [{ provider: "openrouter", name: "deepseek/deepseek-chat" }],
    [{ provider: "auto", name: "auto" }],
  ])("takes a custom temperature for %j", (model) => {
    expect(modelIgnoresTemperament(model)).toBe(false);
  });
});

describe("chooseTemperature", () => {
  const takes = { provider: "anthropic", name: "claude-sonnet-4-6" };
  const locked = { provider: "openai", name: "gpt-5" };

  it("uses the entity's temperature when it is set", () => {
    expect(
      chooseTemperature({
        modelDefault: 1,
        entityTemperature: 1.6,
        model: takes,
      }),
    ).toBe(1.6);
    expect(
      chooseTemperature({
        modelDefault: undefined,
        entityTemperature: 0,
        model: takes,
      }),
    ).toBe(0);
  });

  it("keeps the model's own default when the entity has none (exactly as before)", () => {
    expect(
      chooseTemperature({
        modelDefault: 0.7,
        entityTemperature: undefined,
        model: takes,
      }),
    ).toBe(0.7);
    expect(
      chooseTemperature({
        modelDefault: undefined,
        entityTemperature: undefined,
        model: takes,
      }),
    ).toBeUndefined();
  });

  it("does not override a model that requires its own temperature", () => {
    expect(
      chooseTemperature({
        modelDefault: 1,
        entityTemperature: 0.3,
        model: locked,
      }),
    ).toBe(1);
    expect(
      chooseTemperature({
        modelDefault: undefined,
        entityTemperature: 0.3,
        model: { provider: "auto", name: "auto", connection: "subscription" },
      }),
    ).toBeUndefined();
  });

  it("ignores a nonsense temperature in a hand-edited roster", () => {
    for (const bad of [5, -1, "hot", NaN, null]) {
      expect(
        chooseTemperature({
          modelDefault: 1,
          entityTemperature: bad,
          model: takes,
        }),
      ).toBe(1);
    }
  });
});
