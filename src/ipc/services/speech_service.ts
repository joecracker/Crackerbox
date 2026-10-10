import { app } from "electron";
import path from "node:path";
import log from "electron-log";
import type { z } from "zod";
import type { SynthesizeSpeechParamsSchema } from "../types/audio";

const logger = log.scope("speech");
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

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
        return KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: "q8",
          device: "cpu",
        });
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
    const audio = await tts.generate(text, { voice: voice as never, speed });
    return new Uint8Array(audio.toWav().slice(0));
  }
}

const provider: SpeechProvider = new KokoroSpeechProvider();

export async function synthesizeSpeech(input: SpeechSynthesisInput) {
  try {
    return {
      audioData: await provider.synthesize(input),
      mimeType: "audio/wav" as const,
    };
  } catch (error) {
    logger.warn("Speech generation failed", error);
    throw new Error(
      "Crackerbox couldn't generate speech. Your reply is still available as text.",
    );
  }
}
