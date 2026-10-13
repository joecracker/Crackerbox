import { app, utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import log from "electron-log";
import type { z } from "zod";
import type { SynthesizeSpeechParamsSchema } from "../types/audio";
import { readSettings } from "@/main/settings";
import { getOpenRouterAppAttributionHeaders } from "../utils/openrouter_attribution";

const logger = log.scope("speech");
const OPENROUTER_KOKORO_MODEL = "hexgrad/kokoro-82m";
const OPENROUTER_ELEVENLABS_MODEL = "elevenlabs/eleven-flash-v2.5";
// Cloud voices that belong to a model other than Kokoro. Any other voice name
// is a Kokoro voice.
const OPENROUTER_VOICE_MODELS: Record<string, string> = {
  sarah: OPENROUTER_ELEVENLABS_MODEL,
  jessica: OPENROUTER_ELEVENLABS_MODEL,
};
// The built-in (offline) voice only knows Kokoro voices. When a cloud-only
// voice is chosen it still needs one of these for the offline backup.
const LOCAL_FALLBACK_VOICE = "af_heart";

export function openRouterModelForVoice(voice: string) {
  return OPENROUTER_VOICE_MODELS[voice] ?? OPENROUTER_KOKORO_MODEL;
}

export function localVoiceFor(voice: string) {
  return /^[ab][fm]_/.test(voice) ? voice : LOCAL_FALLBACK_VOICE;
}
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

const LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60 * 1000;
// In testing on 2026-10-12 ElevenLabs Flash answered in about 2 seconds for a
// paragraph, while Kokoro took 2 to 15 seconds and at times never answered at
// all. A request still silent after this long is treated as failed.
const OPENROUTER_TIMEOUT_MS = 30_000;
// The model holds a few hundred MB while loaded, so let it go after a quiet spell.
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

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

type VoiceProcessMessage =
  | { type: "ready"; loadMs: number }
  | { type: "result"; id: number; wav: Uint8Array; ms: number }
  | { type: "error"; id: number; message: string };

/**
 * Runs Kokoro in its own process. Generating speech takes about as long as the
 * speech lasts and keeps the processor busy, so doing it inside the main
 * process froze the whole app (and swallowed clicks) for several seconds at a
 * time. In its own process the app stays responsive however long it takes.
 */
class KokoroSpeechProvider implements SpeechProvider {
  private child: UtilityProcess | null = null;
  private ready = false;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (wav: Uint8Array<ArrayBuffer>) => void;
      reject: (error: Error) => void;
    }
  >();
  private idleTimer: NodeJS.Timeout | undefined;

  private start(): UtilityProcess {
    if (this.child) return this.child;
    logger.info("Starting local voice process");
    // Emitted next to main.js (`.vite/build`), so this resolves in both dev and
    // packaged (ASAR) builds.
    const child = utilityProcess.fork(
      path.join(__dirname, "speech_worker.js"),
      [],
      { serviceName: "crackerbox-voice" },
    );
    this.child = child;
    this.ready = false;
    child.on("message", (message: VoiceProcessMessage) =>
      this.handleMessage(child, message),
    );
    child.on("error", (type, location) => {
      logger.warn(`Local voice process error: ${type} ${location}`);
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      logger.warn(`Local voice process exited (code ${code})`);
      this.reset(new Error("The local voice stopped unexpectedly."));
    });
    child.postMessage({
      type: "init",
      cacheDir: path.join(app.getPath("userData"), "speech-models"),
    });
    return child;
  }

  private handleMessage(child: UtilityProcess, message: VoiceProcessMessage) {
    if (child !== this.child) return;
    if (message.type === "ready") {
      this.ready = true;
      logger.info(`Voice model ready in ${message.loadMs}ms`);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.type === "result") {
      logger.info(`Speech generated in ${message.ms}ms`);
      entry.resolve(new Uint8Array(message.wav));
    } else {
      entry.reject(new Error(message.message));
    }
  }

  /** Drops the voice process; the next request starts a fresh one. */
  private reset(error: Error) {
    const child = this.child;
    this.child = null;
    this.ready = false;
    clearTimeout(this.idleTimer);
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) entry.reject(error);
    child?.kill();
  }

  private scheduleIdleShutdown() {
    clearTimeout(this.idleTimer);
    if (this.pending.size > 0 || !this.child) return;
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0 && this.child) {
        logger.info("Stopping idle local voice process");
        this.reset(new Error("The local voice was stopped while idle."));
      }
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref();
  }

  async synthesize({ text, voice, speed }: SpeechSynthesisInput) {
    const child = this.start();
    clearTimeout(this.idleTimer);
    const id = this.nextId++;
    // The first request also waits for the model to load.
    const timeoutMs = this.ready
      ? GENERATE_TIMEOUT_MS
      : LOAD_TIMEOUT_MS + GENERATE_TIMEOUT_MS;
    const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    logger.info(`Generating speech (${text.length} chars)`);
    child.postMessage({
      type: "generate",
      id,
      text,
      voice: localVoiceFor(voice),
      speed,
    });
    try {
      const data = await withTimeout(result, timeoutMs, "Generating speech");
      return { data, mimeType: "audio/wav" as const };
    } catch (error) {
      // A request that never answers means the process is stuck; start fresh.
      if (error instanceof Error && error.message.includes("timed out")) {
        this.reset(error);
      }
      throw error;
    } finally {
      this.pending.delete(id);
      this.scheduleIdleShutdown();
    }
  }
}

class OpenRouterSpeechProvider implements SpeechProvider {
  async synthesize({ text, voice }: SpeechSynthesisInput) {
    const apiKey = readSettings().providerSettings?.openrouter?.apiKey?.value;
    if (!apiKey) {
      throw new Error("OpenRouter is not connected");
    }

    const model = openRouterModelForVoice(voice);
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
          model,
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
    logger.info(
      `OpenRouter speech generated in ${Date.now() - started}ms (${model})`,
    );
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
