import { VENICE_API_BASE } from "./venice_api";
import {
  listImageModels,
  pickImageModel,
  sizeFields,
  explainVeniceError,
} from "./venice_image";

// Many image engines behind one door. Adding an engine = adding a row to ENGINES
// (and, if it is a new service, one small caller). Keys are passed in by the
// caller and never logged or returned.

export const SIRAY_API_BASE = "https://api.siray.ai/v1";

export const IMAGE_STYLES = ["realistic", "anime"] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];

export type EngineService = "venice" | "siray";

export interface EngineRow {
  /** Short name the AI can pass as `model`. */
  name: string;
  service: EngineService;
  /** The service's own model id. */
  modelId: string;
  style: ImageStyle;
  /** Siray only: "pixels" = WxH text, "tier" = "1k"/"2k" only. */
  sizeRule?: "pixels" | "tier";
  /** Siray only: extra output_format field some models want. */
  outputFormat?: string;
  /** image-to-image engines edit a base picture; they never run without one. */
  kind: "text-to-image" | "image-to-image";
}

export const ENGINES: EngineRow[] = [
  {
    name: "venice-chroma",
    service: "venice",
    modelId: "chroma",
    style: "realistic",
    kind: "text-to-image",
  },
  {
    name: "venice-anime",
    service: "venice",
    modelId: "wai-Illustrious",
    style: "anime",
    kind: "text-to-image",
  },
  {
    name: "siray-seedream-5-pro",
    service: "siray",
    modelId: "bytedance/seedream-5.0-pro-t2i-spicy",
    style: "realistic",
    sizeRule: "pixels",
    outputFormat: "jpg",
    kind: "text-to-image",
  },
  {
    name: "siray-wan-2.7-pro",
    service: "siray",
    modelId: "alibaba/wan-2.7-image-pro-t2i-spicy",
    style: "realistic",
    sizeRule: "pixels",
    kind: "text-to-image",
  },
  {
    name: "siray-qwen-pro",
    service: "siray",
    modelId: "alibaba/qwen-image-3-pro-t2i-spicy",
    style: "realistic",
    sizeRule: "tier",
    kind: "text-to-image",
  },
  {
    name: "siray-z-image-anime",
    service: "siray",
    modelId: "alibaba/z-image-spicy-pro-t2i",
    style: "anime",
    sizeRule: "pixels",
    kind: "text-to-image",
  },
  {
    name: "siray-seedream-4-5-i2i",
    service: "siray",
    modelId: "bytedance/seedream-4.5-i2i-spicy",
    style: "realistic",
    sizeRule: "pixels",
    kind: "image-to-image",
  },
];

/** Order tried when the caller names no engine (or the named one fails). */
export const DEFAULT_CHAINS: Record<ImageStyle, string[]> = {
  realistic: [
    "venice-chroma",
    "siray-seedream-5-pro",
    "siray-qwen-pro",
    "siray-wan-2.7-pro",
  ],
  anime: ["venice-anime", "siray-z-image-anime"],
};

export const ENGINE_NAMES = ENGINES.map((e) => e.name);

export const IMAGE_ASPECT_LIST = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;

const SIRAY_SIZES: Record<ImageStyle, Record<string, string>> = {
  anime: {
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "4:3": "1024x768",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
  },
  realistic: {
    "1:1": "1024x1024",
    "3:4": "864x1152",
    "2:3": "832x1248",
    "3:2": "1248x832",
    "4:3": "1152x864",
    "16:9": "1424x800",
    "9:16": "800x1424",
  },
};

// ---- Tunables --------------------------------------------------------------
export const MAX_ATTEMPTS_PER_HOUR = 30; // every request sent to any engine counts
export const MAX_PROMPT_CHARS = 4000;
export const MAX_COUNT = 4;
const VENICE_DEFAULT_PROMPT_CAP = 1450; // Venice 400s a little past ~1500
const VENICE_TIMEOUT_MS = 120_000;
const SIRAY_SUBMIT_TIMEOUT_MS = 60_000;
const SIRAY_POLL_MS = 3_000;
const SIRAY_GIVE_UP_MS = 240_000;
const BLANK_MEAN = 8;
const BLANK_RETRIES = 2;
// ----------------------------------------------------------------------------

export class EngineError extends Error {
  constructor(
    message: string,
    /** True when the service refused the prompt on content grounds. */
    public readonly refused = false,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Trim on a word edge so a long prompt never fails outright. */
export function fitPrompt(prompt: string, cap: number): string {
  if (prompt.length <= cap) return prompt;
  let cut = prompt.slice(0, cap);
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  return cut.replace(/[\s,.;]+$/, "");
}

export function sniffExtension(bytes: Buffer): ".png" | ".jpg" | ".webp" {
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  if (
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  return ".png";
}

/** Edit-a-base-picture engines. A named one goes alone; otherwise all of them. */
export function resolveI2iChain(model: string | undefined): EngineRow[] {
  const all = ENGINES.filter((e) => e.kind === "image-to-image");
  const named = model ? all.find((e) => e.name === model) : undefined;
  return named ? [named] : all;
}

/** Seedream 4.5 sizes by shape (its size field is a fixed list). */
const SEEDREAM_45_SIZES: Record<string, string> = {
  "1:1": "2048x2048",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
  "16:9": "2848x1600",
  "9:16": "1600x2848",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
};

/** The engine rows to try, in order, for a request. */
export function resolveChain(model: string | undefined, style: ImageStyle) {
  const byName = (n: string) => ENGINES.find((e) => e.name === n);
  const first: EngineRow | undefined = model
    ? (byName(model) ?? {
        // Not in the table: treat it as a raw Venice model id.
        name: `venice:${model}`,
        service: "venice",
        modelId: model,
        style,
        kind: "text-to-image",
      })
    : undefined;
  const chainStyle = first?.style ?? style;
  const rest = DEFAULT_CHAINS[chainStyle]
    .map(byName)
    .filter((e): e is EngineRow => !!e && e.name !== first?.name);
  return first ? [first, ...rest] : rest;
}

// ---- Hourly safety cap -----------------------------------------------------
let attemptLog: number[] = [];

/** Reserve one request. False means the hourly cap is used up. */
export function reserveAttempt(now = Date.now()): boolean {
  attemptLog = attemptLog.filter((t) => now - t < 3_600_000);
  if (attemptLog.length >= MAX_ATTEMPTS_PER_HOUR) return false;
  attemptLog.push(now);
  return true;
}

export function resetAttemptLog(): void {
  attemptLog = [];
}

// ---- Black-dud detection ---------------------------------------------------
export interface PixelStats {
  mean: number;
  spread: number;
}
export type PixelSampler = (bytes: Buffer) => Promise<PixelStats | null>;

export function statsLookBlank(stats: PixelStats | null): boolean {
  return !!stats && stats.mean < BLANK_MEAN && stats.spread < BLANK_MEAN;
}

/** Reads a 64px copy of the picture with Electron's own image decoder. */
export const electronSampler: PixelSampler = async (bytes) => {
  const { nativeImage } = await import("electron");
  const img = nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) return null;
  const bmp = img.resize({ width: 64, height: 64, quality: "good" }).toBitmap();
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  const n = bmp.length / 4;
  if (n === 0) return null;
  for (let i = 0; i < bmp.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = bmp[i + c];
      sum[c] += v;
      sumSq[c] += v * v;
    }
  }
  const means = sum.map((s) => s / n);
  const spread = Math.max(
    ...sumSq.map((sq, c) => Math.sqrt(Math.max(0, sq / n - means[c] ** 2))),
  );
  return { mean: (means[0] + means[1] + means[2]) / 3, spread };
};

export async function isBlankImage(
  bytes: Buffer,
  sampler: PixelSampler = electronSampler,
): Promise<boolean> {
  try {
    return statsLookBlank(await sampler(bytes));
  } catch {
    return false;
  }
}

// ---- Service callers -------------------------------------------------------
interface CallRequest {
  prompt: string;
  aspect: string;
  negativePrompt?: string;
  /** Base picture as a data: URI, for image-to-image engines. */
  baseImageUri?: string;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

function asEngineError(err: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw err;
  if (err instanceof EngineError) throw err;
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    throw new EngineError("The request timed out.");
  }
  throw new EngineError(
    err instanceof Error ? err.message : "Unknown image error.",
  );
}

async function callVenice(
  row: EngineRow,
  req: CallRequest,
  key: string,
): Promise<Buffer> {
  try {
    const models = await listImageModels(key, req.signal, req.fetchImpl);
    const model = pickImageModel(models, row.modelId);
    const cap = model.promptCharacterLimit
      ? model.promptCharacterLimit - 20
      : VENICE_DEFAULT_PROMPT_CAP;
    const body: Record<string, unknown> = {
      model: model.id,
      prompt: fitPrompt(req.prompt, cap),
      ...sizeFields(model, req.aspect),
      format: "png",
      safe_mode: false,
      variants: 1,
    };
    if (req.negativePrompt) {
      body.negative_prompt = fitPrompt(req.negativePrompt, 1000);
    }
    const resp = await req.fetchImpl(`${VENICE_API_BASE}/image/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: withTimeout(req.signal, VENICE_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new EngineError(
        explainVeniceError(resp.status, await resp.text()),
        resp.status === 422,
      );
    }
    const json = (await resp.json()) as { images?: unknown };
    const first = Array.isArray(json.images) ? json.images[0] : undefined;
    if (typeof first !== "string" || !first) {
      throw new EngineError("Venice returned no image.");
    }
    return Buffer.from(first, "base64");
  } catch (err) {
    return asEngineError(err, req.signal);
  }
}

async function callSiray(
  row: EngineRow,
  req: CallRequest,
  key: string,
): Promise<Buffer> {
  try {
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const body: Record<string, unknown> = {
      model: row.modelId,
      prompt: req.prompt,
      size:
        row.kind === "image-to-image"
          ? (SEEDREAM_45_SIZES[req.aspect] ?? "2048x2048")
          : row.sizeRule === "tier"
            ? "1k"
            : (SIRAY_SIZES[row.style][req.aspect] ?? "1024x1024"),
    };
    // Siray takes exactly one reference picture, as a plain string.
    if (row.kind === "image-to-image") body.image = req.baseImageUri;
    if (row.outputFormat) body.output_format = row.outputFormat;

    const submit = await req.fetchImpl(
      `${SIRAY_API_BASE}/images/generations/async`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: withTimeout(req.signal, SIRAY_SUBMIT_TIMEOUT_MS),
      },
    );
    if (submit.status === 401) {
      throw new EngineError("Siray rejected the key.");
    }
    if (!submit.ok) {
      const detail = (await submit.text()).replace(/\s+/g, " ").slice(0, 200);
      throw new EngineError(
        `Siray submit failed (${submit.status}). ${detail}`,
      );
    }
    const sj = (await submit.json()) as any;
    const taskId: string | undefined = sj?.data?.task_id ?? sj?.task_id;
    if (!taskId) throw new EngineError("Siray returned no task id.");

    const deadline = Date.now() + SIRAY_GIVE_UP_MS;
    while (Date.now() < deadline) {
      await req.sleep(SIRAY_POLL_MS);
      if (req.signal?.aborted) throw req.signal.reason ?? new Error("aborted");
      const poll = await req.fetchImpl(
        `${SIRAY_API_BASE}/images/generations/async/${taskId}`,
        { headers, signal: withTimeout(req.signal, 30_000) },
      );
      if (!poll.ok) continue;
      const pj = (await poll.json()) as any;
      const d = pj?.data && "status" in pj.data ? pj.data : pj;
      const status = String(d?.status ?? "").toUpperCase();
      if (status === "FAILED") {
        const why = `${d?.fail_code ?? ""} ${pj?.message ?? ""}`.trim();
        throw new EngineError(`Siray generation failed. ${why}`.trim());
      }
      const first = (d?.outputs ?? [])[0];
      const url: string | undefined =
        typeof first === "string" ? first : first?.url;
      if (status === "SUCCESS" && url) {
        // Plain fetch: follows redirects, and the key stays off the file host.
        const img = await req.fetchImpl(url, {
          signal: withTimeout(req.signal, 60_000),
        });
        if (!img.ok) {
          throw new EngineError(
            `Could not download the image (${img.status}).`,
          );
        }
        return Buffer.from(await img.arrayBuffer());
      }
    }
    throw new EngineError(
      `Siray timed out after ${SIRAY_GIVE_UP_MS / 1000} seconds.`,
    );
  } catch (err) {
    return asEngineError(err, req.signal);
  }
}

// ---- The front door --------------------------------------------------------
export interface GenerateOptions {
  prompt: string;
  aspect?: string;
  style?: ImageStyle;
  model?: string;
  negativePrompt?: string;
  /** A picture to edit. When set, only image-to-image engines run. */
  baseImage?: { bytes: Buffer; mime: string };
  count?: number;
  keys: { venice?: string; siray?: string };
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  sampler?: PixelSampler;
}

export interface GeneratedImage {
  bytes: Buffer;
  ext: ".png" | ".jpg" | ".webp";
  /** The engine that actually made it. */
  engine: string;
  modelId: string;
  /** True when it was not the first engine tried. */
  fellBack: boolean;
  /** Plain-English notes: refusals, dud remakes, skipped engines. */
  notes: string[];
}

export interface BatchResult {
  images: GeneratedImage[];
  failures: string[];
  capped: boolean;
}

async function makeOne(
  chain: EngineRow[],
  opts: Required<Pick<GenerateOptions, "prompt" | "aspect">> & GenerateOptions,
  state: { capped: boolean },
): Promise<{ image?: GeneratedImage; failure?: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const notes: string[] = [];
  const req: CallRequest = {
    prompt: opts.prompt,
    aspect: opts.aspect,
    negativePrompt: opts.negativePrompt,
    baseImageUri: opts.baseImage
      ? `data:${opts.baseImage.mime};base64,${opts.baseImage.bytes.toString("base64")}`
      : undefined,
    signal: opts.signal,
    fetchImpl,
    sleep,
  };

  for (let i = 0; i < chain.length; i++) {
    const row = chain[i];
    // Editing keeps her face; making a new picture does not. Never mix them.
    if ((row.kind === "image-to-image") !== Boolean(opts.baseImage)) {
      notes.push(
        row.kind === "image-to-image"
          ? `: skipped, it needs a base picture.`
          : `: skipped, text-only engines would make a new face.`,
      );
      continue;
    }
    const key = opts.keys[row.service];
    if (!key) {
      notes.push(`${row.name}: skipped, no ${row.service} key is set up.`);
      continue;
    }
    for (let attempt = 0; attempt <= BLANK_RETRIES; attempt++) {
      if (!reserveAttempt()) {
        state.capped = true;
        return {
          failure: `Hourly image limit reached (${MAX_ATTEMPTS_PER_HOUR} requests).`,
        };
      }
      let bytes: Buffer;
      try {
        bytes =
          row.service === "venice"
            ? await callVenice(row, req, key)
            : await callSiray(row, req, key);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const e = err as EngineError;
        notes.push(
          `${row.name}: ${e.refused ? "refused the prompt" : "failed"} (${e.message})`,
        );
        break; // next engine
      }
      if (await isBlankImage(bytes, opts.sampler)) {
        notes.push(`${row.name}: came back all black, remaking.`);
        if (attempt === BLANK_RETRIES) {
          notes.push(`${row.name}: stayed black, moving on.`);
        }
        continue;
      }
      return {
        image: {
          bytes,
          ext: sniffExtension(bytes),
          engine: row.name,
          modelId: row.modelId,
          fellBack: i > 0,
          notes,
        },
      };
    }
  }
  return { failure: notes.join(" ") || "No engine could make this picture." };
}

/** Makes 1 to 4 pictures, falling back engine to engine as needed. */
export async function generateImages(
  options: GenerateOptions,
): Promise<BatchResult> {
  const prompt = options.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  const count = Math.max(1, Math.min(MAX_COUNT, options.count ?? 1));
  const aspect = (IMAGE_ASPECT_LIST as readonly string[]).includes(
    options.aspect ?? "",
  )
    ? (options.aspect as string)
    : "1:1";
  const chain = options.baseImage
    ? resolveI2iChain(options.model)
    : resolveChain(options.model, options.style ?? "realistic");
  const state = { capped: false };
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      makeOne(chain, { ...options, prompt, aspect }, state),
    ),
  );
  return {
    images: results.flatMap((r) => (r.image ? [r.image] : [])),
    failures: results.flatMap((r) => (r.failure ? [r.failure] : [])),
    capped: state.capped,
  };
}
