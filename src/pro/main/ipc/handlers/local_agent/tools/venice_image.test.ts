import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildImageRequest,
  explainVeniceError,
  generateVeniceImage,
  parseImageModels,
  pickImageModel,
  resetImageModelCache,
  sizeFields,
  type VeniceImageModel,
} from "./venice_image";
import { findVeniceApiKey } from "./venice_api";

const pixelModel: VeniceImageModel = {
  id: "venice-sd35",
  offline: false,
  beta: false,
  widthHeightDivisor: 16,
  promptCharacterLimit: 1500,
};
const ratioModel: VeniceImageModel = {
  id: "qwen-image-2",
  offline: false,
  beta: false,
  aspectRatios: ["1:1", "16:9", "9:16"],
  defaultAspectRatio: "1:1",
  resolutions: ["1K", "2K"],
  defaultResolution: "1K",
};

describe("findVeniceApiKey", () => {
  it("finds the key of any provider with Venice in its id", () => {
    expect(
      findVeniceApiKey({
        openrouter: { apiKey: { value: "no" } },
        "custom::Venice AI": { apiKey: { value: "yes" } },
      }),
    ).toBe("yes");
  });
  it("is undefined without a Venice provider or without a key", () => {
    expect(findVeniceApiKey(undefined)).toBeUndefined();
    expect(findVeniceApiKey({ venice: {} })).toBeUndefined();
    expect(
      findVeniceApiKey({ openrouter: { apiKey: { value: "x" } } }),
    ).toBeUndefined();
  });
});

describe("parseImageModels", () => {
  it("reads ids and the constraints that decide how a size is sent", () => {
    const models = parseImageModels({
      data: [
        {
          id: "a",
          model_spec: {
            constraints: { widthHeightDivisor: 8, promptCharacterLimit: 900 },
          },
        },
        {
          id: "b",
          model_spec: {
            offline: true,
            constraints: {
              aspectRatios: ["1:1"],
              defaultAspectRatio: "1:1",
              resolutions: ["1K"],
              defaultResolution: "1K",
            },
          },
        },
        { notAModel: true },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["a", "b"]);
    expect(models[0]).toMatchObject({
      widthHeightDivisor: 8,
      promptCharacterLimit: 900,
    });
    expect(models[1]).toMatchObject({
      offline: true,
      aspectRatios: ["1:1"],
      defaultResolution: "1K",
    });
  });
  it("returns nothing for a broken answer", () => {
    expect(parseImageModels(null)).toEqual([]);
    expect(parseImageModels({ data: "x" })).toEqual([]);
  });
});

describe("pickImageModel", () => {
  const models = [
    { ...pixelModel, id: "other", beta: true },
    { ...pixelModel, id: "stable-one" },
    { ...ratioModel, id: "qwen-image-2" },
    { ...pixelModel, id: "z-image-turbo", offline: true },
  ];
  it("uses the model named by the caller", () => {
    expect(pickImageModel(models, "stable-one").id).toBe("stable-one");
  });
  it("says what is available when the named model is unknown", () => {
    expect(() => pickImageModel(models, "nope")).toThrow(
      /no image model called "nope".*stable-one/,
    );
  });
  it("prefers a known good model that is up, skipping one that is offline", () => {
    expect(pickImageModel(models).id).toBe("qwen-image-2");
  });
  it("falls back to any stable model, then any model", () => {
    expect(pickImageModel([models[0], models[1]]).id).toBe("stable-one");
    expect(pickImageModel([models[0]]).id).toBe("other");
  });
  it("fails clearly when nothing is up", () => {
    expect(() => pickImageModel([models[3]])).toThrow(/no image models/);
    expect(() => pickImageModel([])).toThrow(/no image models/);
  });
});

describe("sizeFields", () => {
  it("sends pixels, rounded to the model's step, for pixel models", () => {
    expect(sizeFields(pixelModel, "1:1")).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(sizeFields(pixelModel, "16:9")).toEqual({
      width: 1024,
      height: 576,
    });
    expect(sizeFields(pixelModel, "2:3")).toEqual({ width: 688, height: 1024 });
  });
  it("sends a ratio and a resolution tier for ratio models", () => {
    expect(sizeFields(ratioModel, "16:9")).toEqual({
      aspect_ratio: "16:9",
      resolution: "1K",
    });
  });
  it("uses the model's default ratio when it does not offer the one asked for", () => {
    expect(sizeFields(ratioModel, "3:2")).toEqual({
      aspect_ratio: "1:1",
      resolution: "1K",
    });
  });
});

describe("buildImageRequest", () => {
  it("asks for a png at the right size", () => {
    expect(buildImageRequest(pixelModel, "a red door", "1:1")).toEqual({
      model: "venice-sd35",
      prompt: "a red door",
      format: "png",
      width: 1024,
      height: 1024,
    });
  });
  it("refuses a prompt longer than the model takes", () => {
    expect(() =>
      buildImageRequest(pixelModel, "x".repeat(1501), "1:1"),
    ).toThrow(/at most 1500/);
  });
});

describe("explainVeniceError", () => {
  it("turns the common statuses into plain advice", () => {
    expect(explainVeniceError(402, "")).toMatch(/balance is empty/);
    expect(explainVeniceError(401, "")).toMatch(/rejected the key/);
    expect(explainVeniceError(422, '{"error":"blocked"}')).toMatch(
      /content policy.*blocked/,
    );
    expect(explainVeniceError(429, "")).toMatch(/busy/);
    expect(explainVeniceError(500, "boom")).toMatch(/failed \(500\).*boom/);
  });
});

describe("generateVeniceImage", () => {
  beforeEach(() => resetImageModelCache());

  function fakeFetch(handlers: {
    models?: unknown;
    generate?: () => Response;
  }) {
    return vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/models")) {
        return new Response(JSON.stringify(handlers.models ?? { data: [] }), {
          status: 200,
        });
      }
      return handlers.generate!();
    }) as unknown as typeof fetch;
  }

  const modelsJson = {
    data: [
      {
        id: "venice-sd35",
        model_spec: { constraints: { widthHeightDivisor: 16 } },
      },
    ],
  };

  it("lists models, builds the request from the chosen one, and returns the picture", async () => {
    const png = Buffer.from("fake-png-bytes");
    const fetchImpl = fakeFetch({
      models: modelsJson,
      generate: () =>
        new Response(JSON.stringify({ images: [png.toString("base64")] }), {
          status: 200,
        }),
    });
    const result = await generateVeniceImage({
      apiKey: "key-1",
      prompt: "a red door",
      aspect: "16:9",
      fetchImpl,
    });
    expect(result.model).toBe("venice-sd35");
    expect(result.bytes.equals(png)).toBe(true);
    const calls = vi.mocked(fetchImpl).mock.calls;
    const generate = calls.find(([u]) =>
      String(u).endsWith("/image/generate"),
    )!;
    expect(JSON.parse((generate[1] as RequestInit).body as string)).toEqual({
      model: "venice-sd35",
      prompt: "a red door",
      format: "png",
      width: 1024,
      height: 576,
    });
    expect((generate[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer key-1",
    });
  });

  it("explains a refusal", async () => {
    const fetchImpl = fakeFetch({
      models: modelsJson,
      generate: () => new Response("no credit", { status: 402 }),
    });
    await expect(
      generateVeniceImage({ apiKey: "key-2", prompt: "x", fetchImpl }),
    ).rejects.toThrow(/balance is empty/);
  });

  it("fails clearly when Venice sends no picture", async () => {
    const fetchImpl = fakeFetch({
      models: modelsJson,
      generate: () =>
        new Response(JSON.stringify({ images: [] }), { status: 200 }),
    });
    await expect(
      generateVeniceImage({ apiKey: "key-3", prompt: "x", fetchImpl }),
    ).rejects.toThrow(/no image/);
  });
});
