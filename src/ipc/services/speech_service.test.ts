import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger, readSettings, forkMock } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn() },
  readSettings: vi.fn(),
  forkMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "C:/temp/crackerbox-tests" },
  utilityProcess: { fork: forkMock },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => logger,
  },
}));

vi.mock("@/main/settings", () => ({ readSettings: () => readSettings() }));

import { EventEmitter } from "node:events";
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

describe("synthesizeSpeech with Venice", () => {
  beforeEach(() => {
    readSettings.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the saved Venice provider key and Venice's Kokoro model", async () => {
    readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-test-key" } },
        "custom::Venice AI": { apiKey: { value: "venice-test-key" } },
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      );

    await expect(
      synthesizeSpeech({
        text: "Hello from Crackerbox.",
        voice: "af_bella",
        speed: 1,
        provider: "venice",
      }),
    ).resolves.toEqual({ audioBase64: "AQID", mimeType: "audio/mpeg" });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.venice.ai/api/v1/audio/speech");
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer venice-test-key",
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "tts-kokoro",
      input: "Hello from Crackerbox.",
      voice: "af_bella",
      response_format: "mp3",
    });
  });

  it("swaps a voice Venice lacks for Heart", async () => {
    readSettings.mockReturnValue({
      providerSettings: { venice: { apiKey: { value: "venice-test-key" } } },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    await synthesizeSpeech({
      text: "Hello.",
      voice: "bf_isabella",
      speed: 1,
      provider: "venice",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).voice).toBe(
      "af_heart",
    );
  });

  it("fails without a Venice key so the player can fall back", async () => {
    readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { apiKey: { value: "openrouter-test-key" } },
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      synthesizeSpeech({
        text: "Hello.",
        voice: "af_bella",
        speed: 1,
        provider: "venice",
      }),
    ).rejects.toThrow("couldn't generate speech");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

type VoiceRequest = { type: string; id: number };

/** Stands in for the separate process that runs the built-in voice. */
class FakeVoiceProcess extends EventEmitter {
  posted: Array<Record<string, unknown>> = [];
  killed = false;
  constructor(
    private behaviour: (message: VoiceRequest, self: FakeVoiceProcess) => void,
  ) {
    super();
  }
  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
    this.behaviour(message as unknown as VoiceRequest, this);
  }
  kill() {
    this.killed = true;
    return true;
  }
}

const answersWithAudio = (message: VoiceRequest, self: FakeVoiceProcess) => {
  if (message.type !== "generate") return;
  queueMicrotask(() =>
    self.emit("message", {
      type: "result",
      id: message.id,
      wav: new Uint8Array([1, 2, 3]),
      ms: 5,
    }),
  );
};

async function freshService() {
  vi.resetModules();
  return import("./speech_service");
}

const LOCAL_INPUT = {
  text: "Hello.",
  voice: "af_bella",
  speed: 1,
  provider: "local" as const,
};

describe("synthesizeSpeech with the built-in voice", () => {
  beforeEach(() => {
    forkMock.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it("runs the voice in a separate process and reuses it", async () => {
    const child = new FakeVoiceProcess(answersWithAudio);
    forkMock.mockReturnValue(child);
    const service = await freshService();

    await expect(service.synthesizeSpeech(LOCAL_INPUT)).resolves.toEqual({
      audioBase64: "AQID",
      mimeType: "audio/wav",
    });
    await service.synthesizeSpeech(LOCAL_INPUT);

    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(forkMock.mock.calls[0][0]).toMatch(/speech_worker\.js$/);
    expect(child.posted[0]).toEqual({
      type: "init",
      cacheDir: expect.stringMatching(/speech-models$/),
    });
    expect(child.posted.filter((m) => m.type === "generate")).toHaveLength(2);
  });

  it("starts a fresh voice process after the old one stops unexpectedly", async () => {
    const crashing = new FakeVoiceProcess((message, self) => {
      if (message.type === "generate") {
        queueMicrotask(() => self.emit("exit", 1));
      }
    });
    const healthy = new FakeVoiceProcess(answersWithAudio);
    forkMock.mockReturnValueOnce(crashing).mockReturnValueOnce(healthy);
    const service = await freshService();

    await expect(service.synthesizeSpeech(LOCAL_INPUT)).rejects.toThrow(
      "couldn't generate speech",
    );
    expect(crashing.killed).toBe(true);
    await expect(service.synthesizeSpeech(LOCAL_INPUT)).resolves.toMatchObject({
      mimeType: "audio/wav",
    });
    expect(forkMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the voice process when only one request fails", async () => {
    let first = true;
    const child = new FakeVoiceProcess((message, self) => {
      if (message.type !== "generate") return;
      if (first) {
        first = false;
        queueMicrotask(() =>
          self.emit("message", {
            type: "error",
            id: message.id,
            message: "bad",
          }),
        );
      } else {
        answersWithAudio(message, self);
      }
    });
    forkMock.mockReturnValue(child);
    const service = await freshService();

    await expect(service.synthesizeSpeech(LOCAL_INPUT)).rejects.toThrow(
      "couldn't generate speech",
    );
    await expect(service.synthesizeSpeech(LOCAL_INPUT)).resolves.toMatchObject({
      mimeType: "audio/wav",
    });
    expect(child.killed).toBe(false);
    expect(forkMock).toHaveBeenCalledTimes(1);
  });
});
