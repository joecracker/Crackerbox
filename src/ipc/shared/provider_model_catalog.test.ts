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

describe("custom provider catalog", () => {
  it("lists chat models from an OpenAI-compatible /models endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek-ai/deepseek-v4.1-flash" },
          { id: "nvidia/nv-embedqa-e5-v5" },
          { id: "moonshotai/kimi-k3" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getCustomProviderModels } =
      await import("./provider_model_catalog");
    const models = await getCustomProviderModels(
      "custom::nvidia",
      "https://integrate.api.nvidia.com/v1/",
      "nvapi-test",
    );
    expect(models.map((m) => m.apiName)).toEqual([
      "deepseek-ai/deepseek-v4.1-flash",
      "moonshotai/kimi-k3",
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://integrate.api.nvidia.com/v1/models",
    );
  });

  it("returns an empty list instead of throwing when the provider is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { getCustomProviderModels } =
      await import("./provider_model_catalog");
    expect(
      await getCustomProviderModels(
        "custom::x",
        "https://example.invalid/v1",
        undefined,
      ),
    ).toEqual([]);
  });
});
