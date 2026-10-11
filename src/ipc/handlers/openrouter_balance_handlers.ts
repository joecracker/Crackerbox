import fetch from "node-fetch";
import { z } from "zod";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { openRouterBalanceContracts } from "../types/openrouter_balance";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("openrouter_balance_handlers");

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const REQUEST_TIMEOUT_MS = 10_000;

const CreditsResponseSchema = z.object({
  data: z.object({
    total_credits: z.number(),
    total_usage: z.number(),
  }),
});

export function registerOpenRouterBalanceHandlers() {
  createTypedHandler(
    openRouterBalanceContracts.getOpenRouterBalance,
    async () => getOpenRouterBalance(),
  );
}

/**
 * Reads the account's purchased credits and usage from OpenRouter. This needs
 * a management key (a regular chat key is refused), which is saved separately
 * from the chat key and is used for nothing else.
 */
export async function getOpenRouterBalance() {
  const key = readSettings().openRouterManagementKey?.value;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(CREDITS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal as any,
    });
  } catch (error) {
    logger.warn("Failed to reach OpenRouter for the balance.", error);
    throw new DyadError(
      "Could not reach OpenRouter to read your balance.",
      DyadErrorKind.External,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    logger.warn(
      `OpenRouter balance request failed. Status: ${response.status}`,
    );
    const rejected = response.status === 401 || response.status === 403;
    throw new DyadError(
      rejected
        ? "OpenRouter refused this key. The balance needs a management key, not a regular chat key."
        : "OpenRouter could not give the balance right now.",
      rejected ? DyadErrorKind.Auth : DyadErrorKind.External,
    );
  }

  const { data } = CreditsResponseSchema.parse(await response.json());
  return {
    totalCredits: data.total_credits,
    totalUsage: data.total_usage,
    remaining: data.total_credits - data.total_usage,
  };
}
