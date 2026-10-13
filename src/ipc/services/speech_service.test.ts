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
import {
  localVoiceFor,
  openRouterModelForVoice,
  synthesizeSpeech,
} from "./speech_service";

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

  it("sends ElevenLabs voices to the ElevenLabs model", async () => {
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

    await synthesizeSpeech({
      text: "Hello from Crackerbox.",
      voice: "sarah",
      speed: 1,
      provider: "openrouter",
    });

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "elevenlabs/eleven-flash-v2.5",
      input: "Hello from Crackerbox.",
      voice: "sarah",
      response_format: "mp3",
    });
  });

  it("picks the right cloud model and offline voice for each voice name", () => {
    expect(openRouterModelForVoice("sarah")).toBe(
      "elevenlabs/eleven-flash-v2.5",
    );
    expect(openRouterModelForVoice("jessica")).toBe(
      "elevenlabs/eleven-flash-v2.5",
    );
    expect(openRouterModelForVoice("af_bella")).toBe("hexgrad/kokoro-82m");
    expect(openRouterModelForVoice("af_sarah")).toBe("hexgrad/kokoro-82m");
    expect(localVoiceFor("bf_emma")).toBe("bf_emma");
    expect(localVoiceFor("af_sarah")).toBe("af_sarah");
    expect(localVoiceFor("sarah")).toBe("af_heart");
    expect(localVoiceFor("jessica")).toBe("af_heart");
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

  it("uses a built-in voice when a cloud-only voice is selected", async () => {
    const child = new FakeVoiceProcess(answersWithAudio);
    forkMock.mockReturnValue(child);
    const service = await freshService();

    await service.synthesizeSpeech({ ...LOCAL_INPUT, voice: "sarah" });
    await service.synthesizeSpeech({ ...LOCAL_INPUT, voice: "bf_emma" });

    const voices = child.posted
      .filter((m) => m.type === "generate")
      .map((m) => m.voice);
    expect(voices).toEqual(["af_heart", "bf_emma"]);
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
