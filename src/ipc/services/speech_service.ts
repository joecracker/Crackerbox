import { app } from "electron";
import path from "node:path";
import log from "electron-log";
import type { z } from "zod";
import type { SynthesizeSpeechParamsSchema } from "../types/audio";

const logger = log.scope("speech");
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

const LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60 * 1000;

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

export interface SpeechProvider {
  synthesize(input: SpeechSynthesisInput): Promise<Uint8Array<ArrayBuffer>>;
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
    return new Uint8Array(audio.toWav().slice(0));
  }
}

const provider: SpeechProvider = new KokoroSpeechProvider();

export async function synthesizeSpeech(input: SpeechSynthesisInput) {
  try {
    const wav = await provider.synthesize(input);
    return {
      audioBase64: Buffer.from(
        wav.buffer,
        wav.byteOffset,
        wav.byteLength,
      ).toString("base64"),
      mimeType: "audio/wav" as const,
    };
  } catch (error) {
    logger.warn("Speech generation failed", error);
    throw new Error(
      "Crackerbox couldn't generate speech. Your reply is still available as text.",
    );
  }
}
