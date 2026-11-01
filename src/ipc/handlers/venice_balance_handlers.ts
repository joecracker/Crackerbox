import fetch from "node-fetch";
import { z } from "zod";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { veniceBalanceContracts } from "../types/venice_balance";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  findVeniceApiKey,
  VENICE_API_BASE,
} from "@/pro/main/ipc/handlers/local_agent/tools/venice_api";

const logger = log.scope("venice_balance_handlers");

const REQUEST_TIMEOUT_MS = 10_000;

// This endpoint works with an ordinary chat key. (The /billing/balance one
// needs an admin key, which the key used for chat usually is not.)
const RATE_LIMITS_URL = `${VENICE_API_BASE}/api_keys/rate_limits`;

const ResponseSchema = z.object({
  data: z.object({
    accessPermitted: z.boolean().nullish(),
    balances: z.record(z.string(), z.unknown()).nullish(),
  }),
});

function readBalance(
  balances: Record<string, unknown> | null | undefined,
  name: string,
): number {
  for (const [key, value] of Object.entries(balances ?? {})) {
    if (key.replace(/[^a-z]/gi, "").toUpperCase() === name) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

export function registerVeniceBalanceHandlers() {
  createTypedHandler(veniceBalanceContracts.getVeniceBalance, async () =>
    getVeniceBalance(),
  );
}

/** Reads the account's remaining Venice balance with the Venice key already set up. */
export async function getVeniceBalance() {
  const key = findVeniceApiKey(readSettings().providerSettings);
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(RATE_LIMITS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal as any,
    });
  } catch (error) {
    logger.warn("Failed to reach Venice for the balance.", error);
    throw new DyadError(
      "Could not reach Venice to read your balance.",
      DyadErrorKind.External,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    logger.warn(`Venice balance request failed. Status: ${response.status}`);
    const rejected = response.status === 401 || response.status === 403;
    throw new DyadError(
      rejected
        ? "Venice refused this key when asked for the balance."
        : "Venice could not give the balance right now.",
      rejected ? DyadErrorKind.Auth : DyadErrorKind.External,
    );
  }

  const { data } = ResponseSchema.parse(await response.json());
  const diem = readBalance(data.balances, "DIEM");
  const earnedCredits = readBalance(data.balances, "EARNEDCREDITS");
  const bundledCredits = readBalance(data.balances, "BUNDLEDCREDITS");
  const usd = readBalance(data.balances, "USD");
  // Venice spends in this order: DIEM, earned credits, bundled credits, USD.
  const consumptionCurrency =
    diem > 0
      ? "DIEM"
      : earnedCredits > 0
        ? "EARNED_CREDITS"
        : bundledCredits > 0
          ? "BUNDLED_CREDITS"
          : usd > 0
            ? "USD"
            : null;
  return {
    usd,
    diem,
    bundledCredits,
    earnedCredits,
    consumptionCurrency,
    canConsume: data.accessPermitted ?? true,
  };
}
