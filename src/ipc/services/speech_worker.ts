// Runs the built-in Kokoro voice in its own process so that generating speech
// can never freeze Crackerbox's main process. It is started, fed and stopped
// by speech_service.ts.
type IncomingMessage =
  | { type: "init"; cacheDir: string }
  | {
      type: "generate";
      id: number;
      text: string;
      voice: string;
      speed: number;
    };

interface UtilityProcessParentPort {
  on(
    event: "message",
    listener: (event: { data: IncomingMessage }) => void,
  ): void;
  postMessage(message: unknown): void;
}

const parentPort = (
  process as unknown as { parentPort?: UtilityProcessParentPort }
).parentPort;

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

let cacheDir = "";
let ttsPromise: Promise<import("kokoro-js").KokoroTTS> | null = null;
// One generation at a time.
let queue: Promise<unknown> = Promise.resolve();

function load() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const [{ KokoroTTS }, { env }] = await Promise.all([
        import("kokoro-js"),
        import("@huggingface/transformers"),
      ]);
      // Keep the model beside Crackerbox preferences rather than in a global
      // cache, so it stays local to this device and survives app restarts.
      env.cacheDir = cacheDir;
      const started = Date.now();
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: "q8",
        device: "cpu",
      });
      // The first generation pays one-off setup costs; take them now so the
      // first real request is not slower than the rest.
      await tts.generate("Ready.", { voice: "af_heart" as never });
      parentPort?.postMessage({ type: "ready", loadMs: Date.now() - started });
      return tts;
    })().catch((error) => {
      ttsPromise = null;
      throw error;
    });
  }
  return ttsPromise;
}

async function generate({
  id,
  text,
  voice,
  speed,
}: Extract<IncomingMessage, { type: "generate" }>) {
  try {
    const tts = await load();
    const started = Date.now();
    const audio = await tts.generate(text, { voice: voice as never, speed });
    const wav = new Uint8Array(audio.toWav().slice(0));
    parentPort?.postMessage({
      type: "result",
      id,
      wav,
      ms: Date.now() - started,
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

parentPort?.on("message", ({ data }) => {
  if (data.type === "init") {
    cacheDir = data.cacheDir;
    // Start loading right away; the first request usually follows immediately.
    void load().catch(() => {});
    return;
  }
  queue = queue.then(() => generate(data));
});
