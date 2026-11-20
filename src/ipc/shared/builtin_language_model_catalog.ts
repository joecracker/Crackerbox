import log from "electron-log";
import type {
  LanguageModel,
  LanguageModelProvider,
} from "@/ipc/types/language-model";
import type { ThemeGenerationModelOption } from "@/ipc/types/templates";
import {
  CLOUD_PROVIDERS,
  GEMINI_3_5_FLASH,
  GEMINI_3_1_PRO_PREVIEW,
  GPT_5_2_MODEL_NAME,
  GPT_5_5_MODEL_NAME,
  GPT_5_NANO,
  MODEL_OPTIONS,
  NEMOTRON_3_SUPER_FREE,
  OPUS_4_6,
  OPUS_4_8,
  PROVIDER_TO_ENV_VAR,
} from "./language_model_constants";

const logger = log.scope("builtin_language_model_catalog");

export const FALLBACK_CODEX_CLIENT_VERSION = "0.155.1";

export type { ThemeGenerationModelOption };

type ApiProtocol = "responses" | "chat-completions" | "messages";

const KNOWN_BUILTIN_MODEL_ALIASES = [
  "dyad/theme-generator/google",
  "dyad/theme-generator/anthropic",
  "dyad/theme-generator/openai",
  "dyad/auto/openai",
  "dyad/auto/anthropic",
  "dyad/auto/google",
  "dyad/auto/openrouter",
  "dyad/auto/balanced",
  "dyad/help-bot/default",
] as const;

export type BuiltinModelAlias = (typeof KNOWN_BUILTIN_MODEL_ALIASES)[number];

type BuiltinModelAliasEntry = {
  id: string;
  resolvedModel: { providerId: string; apiName: string };
  displayName?: string;
  purpose?: "theme-generation" | "auto-mode" | "help-bot";
  apiProtocol?: ApiProtocol;
};

type BuiltinLanguageModelCatalog = {
  providers: LanguageModelProvider[];
  modelsByProvider: Record<string, LanguageModel[]>;
  aliases: BuiltinModelAliasEntry[];
  themeGenerationOptions: ThemeGenerationModelOption[];
};

type ResolvedBuiltinModel = {
  providerId: string;
  apiName: string;
  apiProtocol?: ApiProtocol;
};

let builtinCatalog: BuiltinLanguageModelCatalog | null = null;

const DEFAULT_THEME_GENERATION_OPTIONS: ThemeGenerationModelOption[] = [
  { id: "dyad/theme-generator/google", label: "Google" },
  { id: "dyad/theme-generator/anthropic", label: "Anthropic" },
  { id: "dyad/theme-generator/openai", label: "OpenAI" },
];

function buildFallbackCatalog(): BuiltinLanguageModelCatalog {
  const providers: LanguageModelProvider[] = Object.entries(
    CLOUD_PROVIDERS,
  ).map(([providerId, provider]) => ({
    id: providerId,
    name: provider.displayName,
    hasFreeTier: provider.hasFreeTier,
    websiteUrl: provider.websiteUrl,
    gatewayPrefix: provider.gatewayPrefix,
    secondary: provider.secondary,
    envVarName:
      PROVIDER_TO_ENV_VAR[providerId as keyof typeof PROVIDER_TO_ENV_VAR] ??
      undefined,
    type: "cloud",
  }));

  const modelsByProvider: Record<string, LanguageModel[]> = {};
  for (const [providerId, models] of Object.entries(MODEL_OPTIONS)) {
    modelsByProvider[providerId] = models.map((model) => ({
      apiName: model.name,
      displayName: model.displayName,
      description: model.description,
      tag: model.tag,
      tagColor: model.tagColor,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow: model.contextWindow,
      temperature: model.temperature,
      dollarSigns: model.dollarSigns,
      effortSettings: model.effortSettings,
      type: "cloud",
    }));
  }

  return {
    providers,
    modelsByProvider,
    aliases: [
      {
        id: "dyad/theme-generator/google",
        resolvedModel: {
          providerId: "google",
          apiName: GEMINI_3_1_PRO_PREVIEW,
        },
        displayName: "Google",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: OPUS_4_6,
        },
        displayName: "Anthropic",
        purpose: "theme-generation",
      },
      {
        id: "dyad/theme-generator/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_2_MODEL_NAME,
        },
        displayName: "OpenAI",
        purpose: "theme-generation",
      },
      {
        id: "dyad/auto/openai",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_5_MODEL_NAME,
        },
        displayName: "Auto OpenAI",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/anthropic",
        resolvedModel: {
          providerId: "anthropic",
          apiName: OPUS_4_8,
        },
        displayName: "Auto Anthropic",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/google",
        resolvedModel: {
          providerId: "google",
          apiName: GEMINI_3_5_FLASH,
        },
        displayName: "Auto Google",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/openrouter",
        resolvedModel: {
          providerId: "openrouter",
          apiName: NEMOTRON_3_SUPER_FREE,
        },
        displayName: "Auto OpenRouter",
        purpose: "auto-mode",
      },
      {
        id: "dyad/auto/balanced",
        resolvedModel: {
          providerId: "openrouter",
          apiName: "x-ai/grok-4.6",
        },
        displayName: "Auto (balanced)",
        purpose: "auto-mode",
        apiProtocol: "responses",
      },
      {
        id: "dyad/help-bot/default",
        resolvedModel: {
          providerId: "openai",
          apiName: GPT_5_NANO,
        },
        displayName: "Help Bot",
        purpose: "help-bot",
      },
    ],
    themeGenerationOptions: DEFAULT_THEME_GENERATION_OPTIONS,
  };
}

export async function getBuiltinLanguageModelCatalog(): Promise<BuiltinLanguageModelCatalog> {
  builtinCatalog ??= buildFallbackCatalog();
  return builtinCatalog;
}

export function getCodexClientVersion(): string {
  return FALLBACK_CODEX_CLIENT_VERSION;
}

export async function getThemeGenerationModelOptions(): Promise<
  ThemeGenerationModelOption[]
> {
  const catalog = await getBuiltinLanguageModelCatalog();
  return catalog.themeGenerationOptions;
}

export async function resolveBuiltinModelAlias(
  aliasId: BuiltinModelAlias | string,
): Promise<ResolvedBuiltinModel | null> {
  const catalog = await getBuiltinLanguageModelCatalog();
  const alias = catalog.aliases.find((candidate) => candidate.id === aliasId);
  const resolvedModel = alias
    ? { ...alias.resolvedModel, apiProtocol: alias.apiProtocol }
    : null;

  logger.info("Resolved builtin model alias", {
    aliasId,
    resolvedProviderId: resolvedModel?.providerId,
    resolvedApiName: resolvedModel?.apiName,
    apiProtocol: resolvedModel?.apiProtocol,
  });

  return resolvedModel;
}
