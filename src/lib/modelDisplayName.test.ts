import { describe, expect, it } from "vitest";
import { stripMakerPrefix } from "./modelDisplayName";

describe("stripMakerPrefix", () => {
  it("drops the leading maker name from OpenRouter-style names", () => {
    expect(stripMakerPrefix("ByteDance Seed: Seedream 5.0 Flash")).toBe(
      "Seedream 5.0 Flash",
    );
    expect(
      stripMakerPrefix("Google: Nano Banana Pro (Gemini 3 Pro Image)"),
    ).toBe("Nano Banana Pro (Gemini 3 Pro Image)");
    expect(stripMakerPrefix("Meta: Llama 3.3 70B Instruct (free)")).toBe(
      "Llama 3.3 70B Instruct (free)",
    );
  });

  it("only strips the first colon", () => {
    expect(stripMakerPrefix("Maker: Model: Variant")).toBe("Model: Variant");
  });

  it("leaves names without a maker prefix alone", () => {
    expect(stripMakerPrefix("GPT 5")).toBe("GPT 5");
    expect(stripMakerPrefix("llama3:8b")).toBe("llama3:8b");
  });

  it("never returns an empty name", () => {
    expect(stripMakerPrefix("Maker:")).toBe("Maker:");
    expect(stripMakerPrefix("Maker: ")).toBe("Maker: ");
  });

  it("does not strip a very long lead-in that is not a maker name", () => {
    const longLead = "A".repeat(41) + ": Model";
    expect(stripMakerPrefix(longLead)).toBe(longLead);
  });
});
