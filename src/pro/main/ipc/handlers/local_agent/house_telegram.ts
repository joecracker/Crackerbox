import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getDyadAppPath } from "@/paths/paths";
import { parseEnvCreds } from "@/main/telegram_inbound";

const logger = log.scope("house_telegram");

const DAILY_CAP = 20;
const sent: Record<string, { day: string; n: number }> = {};

/**
 * A letter addressed to Tim also goes to his phone, from the sender's own
 * Telegram bot, so he never has to open the mailbox folder. The letter is
 * already saved before this runs; a failure here only means no ping.
 */
export async function forwardLetterToTim(
  sisterId: string,
  subject: string,
  body: string,
): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const c = (sent[sisterId] ??= { day, n: 0 });
  if (c.day !== day) {
    c.day = day;
    c.n = 0;
  }
  if (c.n >= DAILY_CAP) {
    return `Telegram skipped: ${DAILY_CAP} pings to Tim already today. The letter is saved in his mailbox.`;
  }
  try {
    const env = fs.readFileSync(
      path.join(getDyadAppPath(sisterId), ".env"),
      "utf8",
    );
    const { token, chat } = parseEnvCreds(env);
    if (!token || !chat) return "Telegram skipped: no bot set up for you.";
    const text = `\u2709\uFE0F ${subject}\n\n${body.trim()}`.slice(0, 3900);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text }),
          signal: ctl.signal,
        },
      );
      const json: any = await res.json().catch(() => ({}));
      if (!json?.ok)
        return `Telegram failed (${res.status}). The letter is saved in his mailbox.`;
    } finally {
      clearTimeout(timer);
    }
    c.n++;
    return "Also sent to Tim on Telegram.";
  } catch (error) {
    logger.warn(`${sisterId}: could not forward letter to Tim`, error);
    return "Telegram failed. The letter is saved in his mailbox.";
  }
}
