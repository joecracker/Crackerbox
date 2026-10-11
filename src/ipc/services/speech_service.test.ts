import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger, readSettings } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn() },
  readSettings: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "C:/temp/crackerbox-tests" },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => logger,
  },
}));

vi.mock("@/main/settings", () => ({ readSettings: () => readSettings() }));

import { synthesizeSpeech } from "./speech_service";

describe("synthesizeSpeech", () => {
  beforeEach(() => {
    readSettings.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the existing OpenRouter key and hosted Bella voice", async () => {
    readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-test-key" } },
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    await expect(
      synthesizeSpeech({
        text: "Hello from Crackerbox.",
        voice: "af_bella",
        speed: 1,
        provider: "openrouter",
      }),
    ).resolves.toEqual({
      audioBase64: "AQID",
      mimeType: "audio/mpeg",
    });

    const [, request] = fetchMock.mock.calls[0];
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer openrouter-test-key",
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "hexgrad/kokoro-82m",
      input: "Hello from Crackerbox.",
      voice: "af_bella",
      response_format: "mp3",
    });
  });

  it("rejects empty OpenRouter audio so the renderer can use local speech", async () => {
    readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-test-key" } },
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    await expect(
      synthesizeSpeech({
        text: "Hello.",
        voice: "af_bella",
        speed: 1,
        provider: "openrouter",
      }),
    ).rejects.toThrow("couldn't generate speech");
  });

  it("logs an OpenRouter error response snippet but returns a generic error", async () => {
    readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-test-key" } },
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider temporarily unavailable", { status: 503 }),
    );

    await expect(
      synthesizeSpeech({
        text: "Hello.",
        voice: "af_bella",
        speed: 1,
        provider: "openrouter",
      }),
    ).rejects.toThrow("couldn't generate speech");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("provider temporarily unavailable"),
    );
  });

  it("reports an unavailable OpenRouter connection for local fallback", async () => {
    readSettings.mockReturnValue({ providerSettings: {} });

    await expect(
      synthesizeSpeech({
        text: "Hello.",
        voice: "af_bella",
        speed: 1,
        provider: "openrouter",
      }),
    ).rejects.toThrow("couldn't generate speech");
  });
});
