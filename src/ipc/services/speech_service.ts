import { app } from "electron";
import path from "node:path";
import log from "electron-log";
import type { z } from "zod";
import type { SynthesizeSpeechParamsSchema } from "../types/audio";
import { readSettings } from "@/main/settings";
import { getOpenRouterAppAttributionHeaders } from "../utils/openrouter_attribution";

const logger = log.scope("speech");
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const OPENROUTER_KOKORO_MODEL = "hexgrad/kokoro-82m";
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

const LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60 * 1000;
const OPENROUTER_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type SpeechSynthesisInput = z.infer<typeof SynthesizeSpeechParamsSchema>;

type SpeechAudio = {
  data: Uint8Array<ArrayBuffer>;
  mimeType: "audio/wav" | "audio/mpeg";
};

export interface SpeechProvider {
  synthesize(input: SpeechSynthesisInput): Promise<SpeechAudio>;
}

class KokoroSpeechProvider implements SpeechProvider {
  private ttsPromise: Promise<import("kokoro-js").KokoroTTS> | null = null;
  // One generation at a time. A stopped reply can leave a request running, and
  // the next reply should wait for it rather than run alongside it.
  private queue: Promise<unknown> = Promise.resolve();

  private load() {
    if (!this.ttsPromise) {
      this.ttsPromise = (async () => {
        const [{ KokoroTTS }, { env }] = await Promise.all([
          import("kokoro-js"),
          import("@huggingface/transformers"),
        ]);
        // Keep the model beside Crackerbox preferences rather than in a global
        // cache. This makes it local to this device and survives app restarts.
        env.cacheDir = path.join(app.getPath("userData"), "speech-models");
        logger.info("Loading voice model");
        const started = Date.now();
        const tts = await withTimeout(
          KokoroTTS.from_pretrained(KOKORO_MODEL, {
            dtype: "q8",
            device: "cpu",
          }),
          LOAD_TIMEOUT_MS,
          "Loading the voice model",
        );
        logger.info(`Voice model ready in ${Date.now() - started}ms`);
        return tts;
      })().catch((error) => {
        this.ttsPromise = null;
        throw error;
      });
    }
    return this.ttsPromise;
  }

  synthesize(input: SpeechSynthesisInput) {
    const run = this.queue.then(() => this.generate(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async generate({ text, voice, speed }: SpeechSynthesisInput) {
    const tts = await this.load();
    logger.info(`Generating speech (${text.length} chars)`);
    const started = Date.now();
    const audio = await withTimeout(
      tts.generate(text, { voice: voice as never, speed }),
      GENERATE_TIMEOUT_MS,
      "Generating speech",
    );
    logger.info(`Speech generated in ${Date.now() - started}ms`);
    return {
      data: new Uint8Array(audio.toWav().slice(0)),
      mimeType: "audio/wav" as const,
    };
  }
}

class OpenRouterSpeechProvider implements SpeechProvider {
  async synthesize({ text, voice }: SpeechSynthesisInput) {
    const apiKey = readSettings().providerSettings?.openrouter?.apiKey?.value;
    if (!apiKey) {
      throw new Error("OpenRouter is not connected");
    }

    logger.info(`Generating OpenRouter speech (${text.length} chars)`);
    const started = Date.now();
    const response = await withTimeout(
      fetch(OPENROUTER_SPEECH_URL, {
        method: "POST",
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...getOpenRouterAppAttributionHeaders(),
        },
        body: JSON.stringify({
          model: OPENROUTER_KOKORO_MODEL,
          input: text,
          voice,
          response_format: "mp3",
        }),
      }),
      OPENROUTER_TIMEOUT_MS,
      "Generating OpenRouter speech",
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      logger.warn(
        `OpenRouter voice returned HTTP ${response.status}: ${detail}`,
      );
      throw new Error(`OpenRouter voice returned HTTP ${response.status}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) {
      throw new Error("OpenRouter voice returned empty audio");
    }
    logger.info(`OpenRouter speech generated in ${Date.now() - started}ms`);
    return { data, mimeType: "audio/mpeg" as const };
  }
}

const providers: Record<SpeechSynthesisInput["provider"], SpeechProvider> = {
  openrouter: new OpenRouterSpeechProvider(),
  local: new KokoroSpeechProvider(),
};

export async function synthesizeSpeech(input: SpeechSynthesisInput) {
  try {
    const audio = await providers[input.provider].synthesize(input);
    return {
      audioBase64: Buffer.from(
        audio.data.buffer,
        audio.data.byteOffset,
        audio.data.byteLength,
      ).toString("base64"),
      mimeType: audio.mimeType,
    };
  } catch (error) {
    logger.warn(`${input.provider} speech generation failed`, error);
    throw new Error(
      "Crackerbox couldn't generate speech. Your reply is still available as text.",
    );
  }
}
