import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { VENICE_API_BASE } from "./venice_api";

// Image generation through the user's own Venice account. Venice models differ
// in how they take a size (some want pixels, some an aspect ratio and a
// resolution tier), so the request is built from what the model itself says it
// accepts, read from Venice's model list, instead of from a fixed model name.

export const IMAGE_ASPECTS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

/** Tried in this order when the caller does not name a model. */
const PREFERRED_MODELS = ["z-image-turbo", "qwen-image-2", "venice-sd35"];
const LONG_SIDE_PIXELS = 1024;
const MODEL_LIST_TTL_MS = 10 * 60 * 1000;

export interface VeniceImageModel {
  id: string;
  offline: boolean;
  beta: boolean;
  promptCharacterLimit?: number;
  widthHeightDivisor?: number;
  aspectRatios?: string[];
  defaultAspectRatio?: string;
  resolutions?: string[];
  defaultResolution?: string;
}

export function parseImageModels(json: unknown): VeniceImageModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: VeniceImageModel[] = [];
  for (const entry of data) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id !== "string" || !id) continue;
    const spec = (entry as { model_spec?: any }).model_spec ?? {};
    const c = spec.constraints ?? {};
    out.push({
      id,
      offline: spec.offline === true,
      beta: spec.beta === true,
      promptCharacterLimit:
        typeof c.promptCharacterLimit === "number"
          ? c.promptCharacterLimit
          : undefined,
      widthHeightDivisor:
        typeof c.widthHeightDivisor === "number"
          ? c.widthHeightDivisor
          : undefined,
      aspectRatios: Array.isArray(c.aspectRatios) ? c.aspectRatios : undefined,
      defaultAspectRatio:
        typeof c.defaultAspectRatio === "string"
          ? c.defaultAspectRatio
          : undefined,
      resolutions: Array.isArray(c.resolutions) ? c.resolutions : undefined,
      defaultResolution:
        typeof c.defaultResolution === "string"
          ? c.defaultResolution
          : undefined,
    });
  }
  return out;
}

/** The model named by the caller, else the first preferred one that is up, else any that is up. */
export function pickImageModel(
  models: VeniceImageModel[],
  requested?: string,
): VeniceImageModel {
  if (requested) {
    const found = models.find((m) => m.id === requested);
    if (!found) {
      const some = models
        .filter((m) => !m.offline)
        .slice(0, 8)
        .map((m) => m.id)
        .join(", ");
      throw new DyadError(
        `Venice has no image model called "${requested}". Some that are available: ${some || "none"}.`,
        DyadErrorKind.Validation,
      );
    }
    return found;
  }
  const up = models.filter((m) => !m.offline);
  for (const id of PREFERRED_MODELS) {
    const found = up.find((m) => m.id === id);
    if (found) return found;
  }
  const stable = up.find((m) => !m.beta) ?? up[0];
  if (!stable) {
    throw new DyadError(
      "Venice lists no image models that are available right now.",
      DyadErrorKind.External,
    );
  }
  return stable;
}

function roundTo(value: number, divisor: number): number {
  return Math.max(divisor, Math.round(value / divisor) * divisor);
}

/** Size fields the model accepts: a ratio (and tier) when it has them, otherwise pixels. */
export function sizeFields(
  model: VeniceImageModel,
  aspect: string,
): Record<string, unknown> {
  if (model.aspectRatios?.length) {
    const fields: Record<string, unknown> = {
      aspect_ratio: model.aspectRatios.includes(aspect)
        ? aspect
        : (model.defaultAspectRatio ?? model.aspectRatios[0]),
    };
    if (model.resolutions?.length) {
      fields.resolution = model.defaultResolution ?? model.resolutions[0];
    }
    return fields;
  }
  const [w, h] = aspect.split(":").map(Number);
  const divisor = model.widthHeightDivisor ?? 16;
  const long = Math.max(w, h);
  return {
    width: roundTo((LONG_SIDE_PIXELS * w) / long, divisor),
    height: roundTo((LONG_SIDE_PIXELS * h) / long, divisor),
  };
}

export function buildImageRequest(
  model: VeniceImageModel,
  prompt: string,
  aspect: string,
): Record<string, unknown> {
  if (
    model.promptCharacterLimit !== undefined &&
    prompt.length > model.promptCharacterLimit
  ) {
    throw new DyadError(
      `The prompt is ${prompt.length} characters; ${model.id} takes at most ${model.promptCharacterLimit}. Shorten it and try again.`,
      DyadErrorKind.Validation,
    );
  }
  return {
    model: model.id,
    prompt,
    format: "png",
    ...sizeFields(model, aspect),
  };
}

export function explainVeniceError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 300);
  switch (status) {
    case 401:
      return "Venice rejected the key, or this model needs a higher access tier.";
    case 402:
      return "Venice says the balance is empty. Add credits at venice.ai/settings/api.";
    case 404:
      return `Venice does not know that image model. ${detail}`;
    case 422:
      return `Venice declined the prompt (content policy). Reword it and try again. ${detail}`;
    case 429:
    case 503:
      return "Venice is busy right now. Try again in a moment.";
    default:
      return `Venice image request failed (${status}). ${detail}`;
  }
}

let cachedModels: {
  at: number;
  key: string;
  models: VeniceImageModel[];
} | null = null;

export async function listImageModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<VeniceImageModel[]> {
  const now = Date.now();
  if (
    cachedModels &&
    cachedModels.key === apiKey &&
    now - cachedModels.at < MODEL_LIST_TTL_MS
  ) {
    return cachedModels.models;
  }
  const response = await fetchImpl(`${VENICE_API_BASE}/models?type=image`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw new DyadError(
      explainVeniceError(response.status, await response.text()),
      DyadErrorKind.External,
    );
  }
  const models = parseImageModels(await response.json());
  cachedModels = { at: now, key: apiKey, models };
  return models;
}

export function resetImageModelCache(): void {
  cachedModels = null;
}

export async function generateVeniceImage({
  apiKey,
  prompt,
  aspect = "1:1",
  model,
  signal,
  fetchImpl = fetch,
}: {
  apiKey: string;
  prompt: string;
  aspect?: string;
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ bytes: Buffer; model: string }> {
  const models = await listImageModels(apiKey, signal, fetchImpl);
  const chosen = pickImageModel(models, model);
  const response = await fetchImpl(`${VENICE_API_BASE}/image/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildImageRequest(chosen, prompt, aspect)),
    signal,
  });
  if (!response.ok) {
    throw new DyadError(
      explainVeniceError(response.status, await response.text()),
      DyadErrorKind.External,
    );
  }
  const json = (await response.json()) as { images?: unknown };
  const first = Array.isArray(json.images) ? json.images[0] : undefined;
  if (typeof first !== "string" || !first) {
    throw new DyadError("Venice returned no image.", DyadErrorKind.External);
  }
  return { bytes: Buffer.from(first, "base64"), model: chosen.id };
}
