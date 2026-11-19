import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import log from "electron-log";
import { createFallback } from "./fallback_ai_model";

const logger = log.scope("chat_backup");

/**
 * Backup chat model. When the main chat provider (Venice, a custom provider)
 * is down, times out or rate-limits, the same request goes to this model on
 * OpenRouter instead. It is picked for stories: a very large context, cheap,
 * and hosted by many different companies, so a Venice outage does not take it
 * down too (Venice is told to be skipped as a host).
 */
export const CHAT_BACKUP_MODEL = "deepseek/deepseek-v4.1-flash";
export const CHAT_BACKUP_PROVIDER = "openrouter";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Tim hears about backup use at most this often. */
export const BACKUP_NOTICE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type FetchFn = typeof fetch;

/**
 * Adds OpenRouter routing rules to each chat request: never a host that keeps
 * or trains on prompts, and never Venice itself (it is the one that failed).
 * A body that is not JSON is passed through untouched.
 */
export function withBackupRouting(base: FetchFn = fetch): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body && typeof body === "object" && !Array.isArray(body)) {
          body.provider = {
            ...(typeof body.provider === "object" ? body.provider : {}),
            data_collection: "deny",
            ignore: ["Venice"],
          };
          return base(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // not JSON: send as is
      }
    }
    return base(input, init);
  }) as FetchFn;
}

/** True when the backup should be wired in for this primary provider. */
export function shouldUseChatBackup(providerType: string | undefined): boolean {
  return providerType === "custom";
}

/**
 * Wraps `onUsed` so it fires on the first backup request and then at most once
 * per `intervalMs`. It never throws: a failed notice must not break a reply.
 */
export function createBackupNotifier(
  onUsed: () => void | Promise<void>,
  intervalMs = BACKUP_NOTICE_INTERVAL_MS,
  now: () => number = Date.now,
): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    try {
      void Promise.resolve(onUsed()).catch((error) =>
        logger.warn("could not report backup chat use", error),
      );
    } catch (error) {
      logger.warn("could not report backup chat use", error);
    }
  };
}

let sharedNotifier: (() => void) | undefined;

function reportBackupUsed(primaryName: string): void {
  logger.warn(
    `Main chat model ${primaryName} failed; answering with backup ${CHAT_BACKUP_MODEL} on OpenRouter`,
  );
  sharedNotifier ??= createBackupNotifier(async () => {
    const { sendTelegramNotice } = await import("@/main/house_notice");
    await sendTelegramNotice(
      "Heads up: the main chat model wasn't answering, so Crackerbox used the backup model on OpenRouter for a reply. This note comes at most every few hours.",
    );
  });
  sharedNotifier();
}

/** The backup model itself, or undefined when there is no OpenRouter key. */
export function createChatBackupModel({
  apiKey,
  primaryName,
  baseFetch = fetch,
}: {
  apiKey: string | undefined;
  primaryName: string;
  baseFetch?: FetchFn;
}): LanguageModel | undefined {
  if (!apiKey) return undefined;
  const routed = withBackupRouting(baseFetch);
  const provider = createOpenAICompatible({
    name: CHAT_BACKUP_PROVIDER,
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      reportBackupUsed(primaryName);
      return routed(input, init);
    }) as FetchFn,
  });
  return provider(CHAT_BACKUP_MODEL);
}

/** Primary first; the backup only takes over after the primary gives up. */
export function withChatBackup(
  primary: LanguageModel,
  backup: LanguageModel | undefined,
): LanguageModel {
  if (!backup) return primary;
  return createFallback({ models: [primary, backup] });
}
