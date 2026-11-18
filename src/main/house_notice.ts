import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getDyadAppPath } from "@/paths/paths";
import { readRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { parseEnvCreds } from "./telegram_inbound";

const logger = log.scope("house_notice");

const SEND_TIMEOUT_MS = 15_000;

export type TelegramFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

const realFetch: TelegramFetch = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });

/**
 * Sends a short note to Tim on Telegram, from the first sister whose bot
 * accepts it. Telegram turning the message down (a dead token, a wrong chat),
 * a timeout or a network error counts as "not sent" and the next bot is tried.
 * Returns whether any bot took it, and says so in the log when none did.
 */
export async function sendTelegramNotice(
  text: string,
  send: TelegramFetch = realFetch,
): Promise<boolean> {
  let tried = 0;
  for (const s of readRoster()) {
    try {
      const env = fs.readFileSync(
        path.join(getDyadAppPath(s.id), ".env"),
        "utf8",
      );
      const { token, chat } = parseEnvCreds(env);
      if (!token || !chat) continue;
      tried++;
      const res = await send(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text }),
        },
      );
      if (res.ok) return true;
      logger.warn(
        `Telegram turned down a note from ${s.id}'s bot (HTTP ${res.status})`,
      );
    } catch (error) {
      logger.warn(`Telegram note from ${s.id}'s bot did not go through`, error);
    }
  }
  logger.warn(
    tried === 0
      ? "Could not tell Tim on Telegram: no sister has a bot set up"
      : "Could not tell Tim on Telegram: every bot failed",
  );
  return false;
}

const noticedToday = new Map<string, string>();

/** Tells Tim at most once per local day for the same key (a repeating problem is one note, not a flood). */
export async function noticeOncePerDay(
  key: string,
  text: string,
  now: Date = new Date(),
  send?: TelegramFetch,
): Promise<boolean> {
  const day = now.toDateString();
  if (noticedToday.get(key) === day) return false;
  const sent = await sendTelegramNotice(text, send);
  // Only a note that really went out counts; otherwise it is tried again later.
  if (sent) noticedToday.set(key, day);
  return sent;
}

export function resetNoticesForTests() {
  noticedToday.clear();
}
