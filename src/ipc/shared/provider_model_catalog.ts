import log from "electron-log";
import { z } from "zod";
import type { LanguageModel } from "@/ipc/types/language-model";
import { readSettings } from "@/main/settings";

const logger = log.scope("provider_model_catalog");
const CACHE_TTL_MS = 60 * 60 * 1000;
const RETRY_TTL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  context_length: z.number().nullish(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
    })
    .nullish(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
  }),
  top_provider: z
    .object({
      max_completion_tokens: z.number().nullish(),
    })
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
});

const OpenRouterResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

const GoogleModelSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  inputTokenLimit: z.number().optional(),
  outputTokenLimit: z.number().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
});

const GoogleResponseSchema = z.object({
  models: z.array(GoogleModelSchema).optional(),
  nextPageToken: z.string().optional(),
});

type ProviderId = "openrouter" | "google";
type CacheEntry = { models: LanguageModel[]; expiresAt: number };
const cache: Partial<Record<ProviderId, CacheEntry>> = {};
const pending: Partial<Record<ProviderId, Promise<LanguageModel[] | null>>> =
  {};

function priceTier(prompt: string, completion: string): number {
  const promptPerMillion = Number(prompt) * 1_000_000;
  const completionPerMillion = Number(completion) * 1_000_000;
  if (promptPerMillion === 0 && completionPerMillion === 0) return 0;
  const blended = (promptPerMillion + completionPerMillion) / 2;
  if (blended < 0.5) return 1;
  if (blended < 2) return 2;
  if (blended < 5) return 3;
  if (blended < 10) return 4;
  if (blended < 20) return 5;
  return 6;
}

function outputLimit(
  contextWindow?: number | null,
  providerLimit?: number | null,
) {
  const limits = [
    32_000,
    contextWindow ? Math.floor(contextWindow / 4) : 32_000,
  ];
  if (providerLimit) limits.push(providerLimit);
  return Math.max(1, Math.min(...limits));
}

export function mapOpenRouterModels(raw: unknown): LanguageModel[] {
  const { data } = OpenRouterResponseSchema.parse(raw);
  return data
    .filter(
      (model) =>
        model.architecture?.input_modalities?.includes("text") &&
        model.architecture.output_modalities?.includes("text") &&
        Number(model.pricing.prompt) >= 0 &&
        Number(model.pricing.completion) >= 0,
    )
    .map((model) => ({
      apiName: model.id,
      displayName: model.name,
      description: model.description ?? "",
      contextWindow: model.context_length ?? undefined,
      inputModalities: model.architecture?.input_modalities ?? undefined,
      maxOutputTokens: outputLimit(
        model.context_length,
        model.top_provider?.max_completion_tokens,
      ),
      dollarSigns: priceTier(model.pricing.prompt, model.pricing.completion),
      supportsTools: model.supported_parameters
        ? model.supported_parameters.includes("tools")
        : undefined,
      type: "cloud" as const,
    }));
}

export function mapGoogleModels(
  models: z.infer<typeof GoogleModelSchema>[],
): LanguageModel[] {
  const taskSpecificModels =
    /(?:-image|-tts|-transcribe|-computer-use|-robotics|-omni)/i;
  return models
    .filter(
      (model) =>
        model.name.startsWith("models/gemini-") &&
        !taskSpecificModels.test(model.name) &&
        model.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((model) => ({
      apiName: model.name.slice("models/".length),
      displayName: model.displayName ?? model.name.slice("models/".length),
      description: model.description ?? "",
      contextWindow: model.inputTokenLimit,
      maxOutputTokens: outputLimit(
        model.inputTokenLimit,
        model.outputTokenLimit,
      ),
      type: "cloud" as const,
    }));
}

async function fetchGoogleModels(
  key: string,
  signal: AbortSignal,
): Promise<LanguageModel[]> {
  const models: z.infer<typeof GoogleModelSchema>[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { "x-goog-api-key": key },
      signal,
    });
    if (!response.ok)
      throw new Error(`Google model catalog: HTTP ${response.status}`);
    const page = GoogleResponseSchema.parse(await response.json());
    models.push(...(page.models ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return mapGoogleModels(models);
}

async function fetchProviderModels(
  providerId: ProviderId,
): Promise<LanguageModel[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let models: LanguageModel[];
    if (providerId === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`OpenRouter model catalog: HTTP ${response.status}`);
      models = mapOpenRouterModels(await response.json());
    } else {
      const key = readSettings().providerSettings?.google?.apiKey?.value;
      if (!key) return null;
      models = await fetchGoogleModels(key, controller.signal);
    }
    if (models.length === 0)
      throw new Error(`${providerId} returned no chat models`);
    cache[providerId] = { models, expiresAt: Date.now() + CACHE_TTL_MS };
    logger.info("Updated provider model catalog", {
      providerId,
      count: models.length,
    });
    return models;
  } catch (error) {
    logger.warn("Could not refresh provider model catalog", {
      providerId,
      error,
    });
    if (cache[providerId])
      cache[providerId].expiresAt = Date.now() + RETRY_TTL_MS;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getProviderModels(
  providerId: ProviderId,
  fallback: LanguageModel[],
): Promise<LanguageModel[]> {
  const current = cache[providerId];
  if (current && current.expiresAt > Date.now()) return current.models;
  if (!pending[providerId]) {
    pending[providerId] = fetchProviderModels(providerId).finally(() => {
      delete pending[providerId];
    });
  }
  if (current) return current.models;
  return (await pending[providerId]) ?? fallback;
}

// ---------------------------------------------------------------------------
// Generic OpenAI-compatible catalog for custom providers (e.g. NVIDIA Build).
// Calls GET {apiBaseUrl}/models, caches for an hour, and never throws: if the
// provider is unreachable the caller simply keeps its hand-added models.
// ---------------------------------------------------------------------------
const CustomModelListSchema = z.object({
  data: z.array(z.unknown()),
});

// What providers add beyond the bare id. Venice (and similar) publish a real
// description, context size, price and abilities; NVIDIA only says who owns it.
const CustomModelEntrySchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  description: z.string().optional(),
  model_spec: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      availableContextTokens: z.number().optional(),
      pricing: z
        .object({
          input: z.object({ usd: z.number().optional() }).optional(),
          output: z.object({ usd: z.number().optional() }).optional(),
        })
        .optional(),
      capabilities: z
        .object({
          supportsReasoning: z.boolean().optional(),
          supportsVision: z.boolean().optional(),
          supportsFunctionCalling: z.boolean().optional(),
          supportsWebSearch: z.boolean().optional(),
          optimizedForCode: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatUsd(n: number): string {
  return n < 1 ? n.toFixed(2) : String(+n.toFixed(2));
}

/** The last part of a model id, lower-cased: "meta-llama/Llama-3.3-70B" -> "llama-3.3-70b". */
function modelTail(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1).toLowerCase();
}

/**
 * Builds the text shown when hovering a model in the picker. Uses what the
 * provider publishes, then a same-named model's description from OpenRouter,
 * and only then a plain "who made it" line, so no model is left blank.
 */
export function describeCustomModel(
  entry: z.infer<typeof CustomModelEntrySchema>,
  providerName: string,
  openRouterByTail: Map<string, LanguageModel>,
): string {
  const spec = entry.model_spec;
  const facts: string[] = [];
  if (spec?.availableContextTokens)
    facts.push(`${formatTokens(spec.availableContextTokens)} context`);
  const input = spec?.pricing?.input?.usd;
  const output = spec?.pricing?.output?.usd;
  if (input !== undefined && output !== undefined)
    facts.push(
      `$${formatUsd(input)} in / $${formatUsd(output)} out per million tokens`,
    );
  const caps = spec?.capabilities;
  const abilities = [
    caps?.supportsReasoning && "reasoning",
    caps?.supportsVision && "vision",
    caps?.supportsFunctionCalling && "tools",
    caps?.supportsWebSearch && "web search",
    caps?.optimizedForCode && "code",
  ].filter(Boolean);
  if (abilities.length) facts.push(abilities.join(", "));

  const own = (spec?.description ?? entry.description ?? "").trim();
  if (own) return facts.length ? `${own}\n${facts.join(" · ")}` : own;

  const sibling = openRouterByTail.get(modelTail(entry.id));
  const siblingText = sibling?.description?.trim();
  if (siblingText) {
    const siblingFacts = sibling?.contextWindow
      ? `\n${formatTokens(sibling.contextWindow)} context`
      : "";
    return `${siblingText}${siblingFacts}`;
  }

  const owner =
    entry.owned_by ?? (entry.id.includes("/") ? entry.id.split("/")[0] : "");
  const who = owner ? `A ${owner} model` : "A model";
  const extra = facts.length ? `\n${facts.join(" · ")}` : "";
  return `${who}, available through ${providerName}. ${providerName} does not publish a description for it.${extra}`;
}

/** Turns a provider's /models answer into picker entries with hover text. */
export function mapCustomProviderModels(
  raw: unknown,
  providerName: string,
  openRouterModels: LanguageModel[] = [],
): LanguageModel[] {
  const { data } = CustomModelListSchema.parse(raw);
  const byTail = new Map<string, LanguageModel>();
  for (const m of openRouterModels) {
    const tail = modelTail(m.apiName);
    if (!byTail.has(tail)) byTail.set(tail, m);
  }
  const models: LanguageModel[] = [];
  for (const item of data) {
    const parsed = CustomModelEntrySchema.safeParse(item);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (NON_CHAT_MODEL.test(entry.id)) continue;
    models.push({
      apiName: entry.id,
      displayName: entry.id,
      description: describeCustomModel(entry, providerName, byTail),
      type: "cloud" as const,
    });
  }
  return models.sort((a, b) => a.apiName.localeCompare(b.apiName));
}

// Skip models that are obviously not chat models.
const NON_CHAT_MODEL =
  /(embed|rerank|reward|guard|safety|nvclip|clip|vila|parse|retriev|ocr|whisper|asr|tts|riva|image|diffusion|flux|stable-|segment|detect|pii|classif)/i;

const customCache = new Map<string, CacheEntry>();
const customPending = new Map<string, Promise<LanguageModel[]>>();

async function fetchCustomProviderModels(
  providerId: string,
  apiBaseUrl: string,
  apiKey: string | undefined,
): Promise<LanguageModel[]> {
  const cacheKey = `${providerId}|${apiBaseUrl}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const [response, openRouterModels] = await Promise.all([
      fetch(`${apiBaseUrl.replace(/\/+$/, "")}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: controller.signal,
      }),
      // Only used to borrow descriptions for same-named models; never fatal.
      getProviderModels("openrouter", []).catch(() => [] as LanguageModel[]),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = mapCustomProviderModels(
      await response.json(),
      providerId.replace(/^custom::/, ""),
      openRouterModels,
    );
    customCache.set(cacheKey, {
      models,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    logger.info("Updated custom provider model catalog", {
      providerId,
      count: models.length,
    });
    return models;
  } catch (error) {
    logger.warn("Could not fetch custom provider model catalog", {
      providerId,
      error,
    });
    const previous = customCache.get(cacheKey);
    customCache.set(cacheKey, {
      models: previous?.models ?? [],
      expiresAt: Date.now() + RETRY_TTL_MS,
    });
    return previous?.models ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCustomProviderModels(
  providerId: string,
  apiBaseUrl: string | undefined,
  apiKey: string | undefined,
): Promise<LanguageModel[]> {
  if (!apiBaseUrl || !/^https?:\/\//i.test(apiBaseUrl)) return [];
  const cacheKey = `${providerId}|${apiBaseUrl}`;
  const current = customCache.get(cacheKey);
  if (current && current.expiresAt > Date.now()) return current.models;
  let inFlight = customPending.get(cacheKey);
  if (!inFlight) {
    inFlight = fetchCustomProviderModels(
      providerId,
      apiBaseUrl,
      apiKey,
    ).finally(() => {
      customPending.delete(cacheKey);
    });
    customPending.set(cacheKey, inFlight);
  }
  return inFlight;
}
