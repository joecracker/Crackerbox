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

describe("hover descriptions for custom provider models", () => {
  it("keeps the description, size, price and abilities a provider publishes", async () => {
    const { mapCustomProviderModels } =
      await import("./provider_model_catalog");
    const [model] = mapCustomProviderModels(
      {
        data: [
          {
            id: "example-reasoner",
            model_spec: {
              description: "A made-up reasoning model for tests.",
              availableContextTokens: 1_000_000,
              pricing: { input: { usd: 0.33 }, output: { usd: 1.32 } },
              capabilities: {
                supportsReasoning: true,
                supportsVision: true,
                supportsFunctionCalling: true,
              },
            },
          },
        ],
      },
      "Venice AI",
    );

    expect(model.description).toBe(
      "A made-up reasoning model for tests.\n1M context · $0.33 in / $1.32 out per million tokens · reasoning, vision, tools",
    );
  });

  it("borrows OpenRouter's description for a same-named model", async () => {
    const { mapCustomProviderModels } =
      await import("./provider_model_catalog");
    const [model] = mapCustomProviderModels(
      { data: [{ id: "meta/llama-3.3-70b-instruct", owned_by: "meta" }] },
      "NVIDIA Build",
      [
        {
          apiName: "meta-llama/llama-3.3-70b-instruct",
          displayName: "Llama 3.3 70B",
          description: "A made-up OpenRouter blurb.",
          contextWindow: 131_072,
          type: "cloud",
        },
      ],
    );

    expect(model.description).toBe("A made-up OpenRouter blurb.\n131K context");
  });

  it("never leaves a model blank: says who made it and that no description exists", async () => {
    const { mapCustomProviderModels } =
      await import("./provider_model_catalog");
    const models = mapCustomProviderModels(
      {
        data: [
          { id: "acme/mystery-1", owned_by: "acme" },
          { id: "plain-name" },
        ],
      },
      "Siray",
    );

    expect(models.map((m) => m.description)).toEqual([
      "A acme model, available through Siray. Siray does not publish a description for it.",
      "A model, available through Siray. Siray does not publish a description for it.",
    ]);
  });

  it("skips entries it cannot read instead of failing the whole list", async () => {
    const { mapCustomProviderModels } =
      await import("./provider_model_catalog");
    const models = mapCustomProviderModels(
      { data: [{ nope: true }, { id: "good-one" }, "text"] },
      "Siray",
    );
    expect(models.map((m) => m.apiName)).toEqual(["good-one"]);
  });
});
