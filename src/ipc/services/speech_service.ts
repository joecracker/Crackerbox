import { app, utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import log from "electron-log";
import type { z } from "zod";
import type { SynthesizeSpeechParamsSchema } from "../types/audio";
import { readSettings } from "@/main/settings";
import { isBuiltInPocketVoice } from "@/shared/pocket_voices";
import { resolveCustomPocketVoice } from "./pocket_custom_voices";
import { getOpenRouterAppAttributionHeaders } from "../utils/openrouter_attribution";

const logger = log.scope("speech");
const OPENROUTER_KOKORO_MODEL = "hexgrad/kokoro-82m";
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const VENICE_KOKORO_MODEL = "tts-kokoro";
const VENICE_SPEECH_URL = "https://api.venice.ai/api/v1/audio/speech";
// Kokoro voices Venice offers (checked against its model list on 2026-10-25).
// Isabella is not one of them, so a voice it lacks is swapped for Heart.
const VENICE_VOICES = new Set(["af_heart", "af_nicole", "af_sarah", "bf_emma"]);
const VENICE_FALLBACK_VOICE = "af_heart";

const LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60 * 1000;
// The hosted voice (Kokoro on OpenRouter) usually answers in 2 to 15 seconds,
// but at times it hangs and never answers. On 2026-10-12, 8 of 18 requests did,
// and then all 16 test requests did, whatever their size. A request still
// silent after this long is treated as failed and the player falls back to the
// built-in voice.
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
    child.postMessage({ type: "generate", id, text, voice, speed });
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

// Pocket TTS (Kyutai): a small voice model that runs on this PC's processor.
// Crackerbox starts its own little server on first use, talks to it over the
// local loopback only, and shuts it down after a quiet spell or on exit.
const POCKET_PORT = 8745;
const POCKET_DEFAULT_VOICE = "azelma";
const POCKET_START_TIMEOUT_MS = 3 * 60 * 1000;
// Starting Pocket takes about ten seconds, and until it is ready the backup
// voice speaks. So it is kept running much longer than the Kokoro model, and
// started ahead of time (see warmPocketVoice) rather than on the first reply.
const POCKET_IDLE_SHUTDOWN_MS = 3 * 60 * 60 * 1000;
const POCKET_REQUEST_TIMEOUT_MS = 60 * 1000;

/**
 * Pocket streams its WAV, so the header carries placeholder sizes. Players
 * that read the sizes would stop early or refuse the file, so write the real
 * ones in.
 */
export function fixStreamedWav(data: Uint8Array<ArrayBuffer>) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (at: number) => String.fromCharCode(...data.subarray(at, at + 4));
  if (data.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return data;
  }
  view.setUint32(4, data.byteLength - 8, true);
  let at = 12;
  while (at + 8 <= data.byteLength) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "data") {
      view.setUint32(at + 4, data.byteLength - (at + 8), true);
      break;
    }
    at += 8 + size + (size % 2);
  }
  return data;
}

export function pocketVoiceFor(voice: string) {
  return isBuiltInPocketVoice(voice) ? voice : POCKET_DEFAULT_VOICE;
}

/** The "My voices" folder: sound files that become the user's own Pocket voices. */
export function pocketVoicesDir(): string {
  return path.join(app.getPath("userData"), "pocket-voices");
}

// A voice file is read whole and sent with every request, so keep it sensible.
const MAX_CUSTOM_VOICE_BYTES = 25 * 1024 * 1024;

/**
 * The request body for Pocket's /tts. A built-in voice goes by name; a voice
 * from the My voices folder goes as an uploaded file. If a custom voice file is
 * gone or too big, Pocket's default voice speaks instead of nothing.
 */
export function buildPocketRequest(
  text: string,
  voice: string,
  dir: string,
): { body: URLSearchParams | FormData; custom: boolean } {
  const file = resolveCustomPocketVoice(dir, voice);
  if (file) {
    try {
      if (fs.statSync(file).size <= MAX_CUSTOM_VOICE_BYTES) {
        const form = new FormData();
        form.set("text", text);
        // A File (not a bare Blob) so the file name, and with it the format
        // Pocket reads the sound as, travels with the upload.
        form.set(
          "voice_wav",
          new File(
            [new Uint8Array(fs.readFileSync(file))],
            path.basename(file),
          ),
        );
        return { body: form, custom: true };
      }
      logger.warn(`My voice file is too big, using the default: ${file}`);
    } catch (error) {
      logger.warn(`Could not read my voice file ${file}`, error);
    }
  }
  return {
    body: new URLSearchParams({ text, voice_url: pocketVoiceFor(voice) }),
    custom: false,
  };
}

export function findPocketExe(): string | null {
  const home = app.getPath("home");
  const candidates = [
    path.join(
      app.getPath("userData"),
      "pocket-tts",
      ".venv",
      "Scripts",
      "pocket-tts.exe",
    ),
    path.join(
      home,
      "Documents",
      "pocket-tts-test",
      ".venv",
      "Scripts",
      "pocket-tts.exe",
    ),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      child.kill();
    }
  } catch {
    // Already gone.
  }
}

class PocketSpeechProvider implements SpeechProvider {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private active = 0;

  constructor() {
    process.once("exit", () => this.stop());
  }

  private stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = null;
    this.starting = null;
    if (child) killTree(child);
  }

  private async healthy() {
    try {
      const response = await fetch(`http://127.0.0.1:${POCKET_PORT}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private ensureRunning(): Promise<void> {
    if (this.starting) return this.starting;
    const starting = (async () => {
      if (this.child && (await this.healthy())) return;
      const exe = findPocketExe();
      if (!exe) throw new Error("Pocket TTS is not installed on this PC");
      logger.info("Starting Pocket TTS server");
      const child = spawn(
        exe,
        ["serve", "--host", "127.0.0.1", "--port", String(POCKET_PORT)],
        { windowsHide: true, stdio: "ignore" },
      );
      this.child = child;
      child.on("exit", (code) => {
        if (this.child !== child) return;
        logger.warn(`Pocket TTS server exited (code ${code})`);
        this.child = null;
        this.starting = null;
      });
      child.on("error", (error) => {
        logger.warn("Pocket TTS server failed to start", error);
      });
      const deadline = Date.now() + POCKET_START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.child !== child)
          throw new Error("Pocket TTS stopped while starting");
        if (await this.healthy()) {
          logger.info("Pocket TTS server ready");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      this.stop();
      throw new Error("Pocket TTS did not start in time");
    })();
    this.starting = starting;
    starting.catch(() => {
      if (this.starting === starting) this.starting = null;
    });
    return starting;
  }

  private scheduleIdleShutdown() {
    clearTimeout(this.idleTimer);
    if (this.active > 0 || !this.child) return;
    this.idleTimer = setTimeout(() => {
      if (this.active === 0 && this.child) {
        logger.info("Stopping idle Pocket TTS server");
        this.stop();
      }
    }, POCKET_IDLE_SHUTDOWN_MS);
    this.idleTimer.unref();
  }

  /** Starts the server ahead of the first reply. Never throws. */
  async warm() {
    try {
      await this.ensureRunning();
      this.scheduleIdleShutdown();
    } catch (error) {
      logger.warn("Could not warm up Pocket TTS", error);
    }
  }

  async synthesize({ text, voice }: SpeechSynthesisInput) {
    this.active++;
    clearTimeout(this.idleTimer);
    try {
      await this.ensureRunning();
      logger.info(`Generating Pocket speech (${text.length} chars)`);
      const started = Date.now();
      const { body, custom } = buildPocketRequest(
        text,
        voice,
        pocketVoicesDir(),
      );
      const response = await fetch(`http://127.0.0.1:${POCKET_PORT}/tts`, {
        method: "POST",
        signal: AbortSignal.timeout(POCKET_REQUEST_TIMEOUT_MS),
        // A form upload sets its own content type; a plain form needs it stated.
        ...(body instanceof URLSearchParams
          ? { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          : {}),
        body,
      });
      if (!response.ok) {
        if (custom) {
          logger.warn(
            `Pocket could not use a My voices file (HTTP ${response.status}). Voice cloning needs a one-time unlock: accept the terms at huggingface.co/kyutai/pocket-tts and sign in with "hf auth login" on this PC. See Settings > Voice.`,
          );
        }
        throw new Error(`Pocket TTS returned HTTP ${response.status}`);
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength === 0)
        throw new Error("Pocket TTS returned empty audio");
      logger.info(`Pocket speech generated in ${Date.now() - started}ms`);
      return { data: fixStreamedWav(data), mimeType: "audio/wav" as const };
    } finally {
      this.active--;
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

/** The saved key of the Venice provider set up under AI providers. */
function findVeniceApiKey(): string | undefined {
  const providerSettings = readSettings().providerSettings ?? {};
  for (const [id, setting] of Object.entries(providerSettings)) {
    const key = setting?.apiKey?.value;
    if (/venice/i.test(id) && key) return key;
  }
  return undefined;
}

export function veniceVoiceFor(voice: string) {
  return VENICE_VOICES.has(voice) ? voice : VENICE_FALLBACK_VOICE;
}

class VeniceSpeechProvider implements SpeechProvider {
  async synthesize({ text, voice }: SpeechSynthesisInput) {
    const apiKey = findVeniceApiKey();
    if (!apiKey) {
      throw new Error("Venice is not connected");
    }

    logger.info(`Generating Venice speech (${text.length} chars)`);
    const started = Date.now();
    const response = await withTimeout(
      fetch(VENICE_SPEECH_URL, {
        method: "POST",
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: VENICE_KOKORO_MODEL,
          input: text,
          voice: veniceVoiceFor(voice),
          response_format: "mp3",
        }),
      }),
      OPENROUTER_TIMEOUT_MS,
      "Generating Venice speech",
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      logger.warn(`Venice voice returned HTTP ${response.status}: ${detail}`);
      throw new Error(`Venice voice returned HTTP ${response.status}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) {
      throw new Error("Venice voice returned empty audio");
    }
    logger.info(`Venice speech generated in ${Date.now() - started}ms`);
    return { data, mimeType: "audio/mpeg" as const };
  }
}

const providers: Record<SpeechSynthesisInput["provider"], SpeechProvider> = {
  openrouter: new OpenRouterSpeechProvider(),
  venice: new VeniceSpeechProvider(),
  local: new KokoroSpeechProvider(),
  pocket: new PocketSpeechProvider(),
};

/** Gets Pocket ready at app start when it is the chosen voice, so no reply falls back to the backup voice. */
export function warmPocketVoice() {
  if (readSettings().speechProvider !== "pocket") return;
  void (providers.pocket as PocketSpeechProvider).warm();
}

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
