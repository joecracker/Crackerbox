import { beforeEach, describe, expect, it, vi } from "vitest";

const readSettings = vi.fn(() => ({
  providerSettings: { google: { apiKey: { value: "test-key" } } },
}));

vi.mock("@/main/settings", () => ({ readSettings }));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("provider model catalog", () => {
  it("maps live OpenRouter slugs, prices and safe output limits", async () => {
    const { mapOpenRouterModels } = await import("./provider_model_catalog");
    const models = mapOpenRouterModels({
      data: [
        {
          id: "vendor/chat:free",
          name: "Vendor Chat",
          description: "A chat model",
          context_length: 8192,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          pricing: { prompt: "0", completion: "0" },
          top_provider: { max_completion_tokens: 4096 },
        },
        {
          id: "vendor/image",
          name: "Image",
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["image"],
          },
          pricing: { prompt: "0.000001", completion: "0.000001" },
        },
      ],
    });

    expect(models).toEqual([
      expect.objectContaining({
        apiName: "vendor/chat:free",
        dollarSigns: 0,
        inputModalities: ["text"],
        maxOutputTokens: 2048,
      }),
    ]);
  });

  it("uses Google generation model IDs and excludes non-chat models", async () => {
    const { mapGoogleModels } = await import("./provider_model_catalog");
    expect(
      mapGoogleModels([
        {
          name: "models/gemini-current",
          displayName: "Gemini Current",
          inputTokenLimit: 100000,
          outputTokenLimit: 16000,
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/gemini-embedding",
          supportedGenerationMethods: ["embedContent"],
        },
        {
          name: "models/gemini-3-pro-image",
          supportedGenerationMethods: ["generateContent"],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        apiName: "gemini-current",
        maxOutputTokens: 16000,
      }),
    ]);
  });

  it("keeps the bundled list when a provider is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { getProviderModels } = await import("./provider_model_catalog");
    const fallback = [{ apiName: "bundled", displayName: "Bundled" }];
    expect(await getProviderModels("openrouter", fallback)).toBe(fallback);
  });
});
