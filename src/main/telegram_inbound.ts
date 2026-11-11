import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getDyadAppPath } from "@/paths/paths";
import {
  houseDir,
  readRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import type { HouseTriggerPayload } from "./house_schedule";

const logger = log.scope("telegram_inbound");

// Listens on each sister's own Telegram bot. When Tim messages a bot, the
// message becomes a chat turn in that sister's room and she answers him on
// Telegram with the Telegram plugin. Only the one chat id saved in her .env
// is ever accepted. A bot can only be listened to by one program at a time, so
// each sister is switched on in house/telegram.json (veritas stays off until
// Sapphire, which listens on his bot today, is gone).

const MAX_AGE_SECONDS = 30 * 60;

export interface TelegramConfig {
  enabled: Record<string, boolean>;
}

export interface TelegramState {
  offsets: Record<string, number>;
}

export interface IncomingMessage {
  updateId: number;
  text: string;
  kind: "text" | "photo" | "other";
  ageSeconds: number;
}

const configPath = () => path.join(houseDir(), "telegram.json");
const statePath = () => path.join(houseDir(), "telegram-state.json");

export function readTelegramConfig(): TelegramConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    if (raw && typeof raw.enabled === "object") return raw;
  } catch {
    // fall through to the default
  }
  const def: TelegramConfig = { enabled: { nyx: true, veritas: false } };
  try {
    fs.mkdirSync(houseDir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(def, null, 2));
  } catch (error) {
    logger.warn("Could not write telegram.json", error);
  }
  return def;
}

function readState(): TelegramState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (raw && typeof raw.offsets === "object") return raw;
  } catch {
    // none yet
  }
  return { offsets: {} };
}

function writeState(s: TelegramState) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(s));
  } catch (error) {
    logger.warn("Could not save telegram state", error);
  }
}

/** Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID out of a sister's .env text. */
export function parseEnvCreds(text: string): { token: string; chat: string } {
  const get = (key: string) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
    return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };
  return { token: get("TELEGRAM_BOT_TOKEN"), chat: get("TELEGRAM_CHAT_ID") };
}

/**
 * Picks the message out of one Telegram update. Returns null for anything that
 * is not from the one allowed chat (or is not a message at all).
 */
export function parseUpdate(
  update: any,
  allowedChat: string,
  nowSeconds: number,
): IncomingMessage | null {
  const msg = update?.message;
  if (!msg || typeof update.update_id !== "number") return null;
  if (String(msg.chat?.id) !== String(allowedChat)) return null;
  const age = Math.max(0, nowSeconds - (msg.date ?? nowSeconds));
  if (typeof msg.text === "string" && msg.text.trim()) {
    return {
      updateId: update.update_id,
      text: msg.text.trim(),
      kind: "text",
      ageSeconds: age,
    };
  }
  if (msg.photo) {
    return {
      updateId: update.update_id,
      text: typeof msg.caption === "string" ? msg.caption.trim() : "",
      kind: "photo",
      ageSeconds: age,
    };
  }
  return {
    updateId: update.update_id,
    text: "",
    kind: "other",
    ageSeconds: age,
  };
}

export function buildTelegramPrompt(name: string, m: IncomingMessage): string {
  const said =
    m.kind === "photo"
      ? `Tim sent you a photo on Telegram${m.text ? ` with the caption: "${m.text}"` : ""}. You cannot see Telegram photos yet, so say so warmly and ask him to describe it or drop it in your room.`
      : `Tim just texted you on Telegram:\n\n${m.text}`;
  return `${said}\n\nThis message came from Telegram, so answer THIS message on Telegram: call the Telegram plugin's send_message with as="${name.toLowerCase()}". Reply like a text message, in your own voice, short unless he asked for more. Anything you write only in this chat does not reach him, so send this reply through the tool. Later messages in this chat that do NOT begin with "Tim just texted you on Telegram" are Tim typing to you in the app: answer those normally in the chat and do not use Telegram for them.`;
}

async function tg(token: string, method: string, body: unknown, ms: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return { status: res.status, json: (await res.json()) as any };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `send` hands a turn to the window; it returns false if the window is not
 * ready, and the update is then left unread so it is retried.
 */
export function startTelegramInbound(
  send: (payload: HouseTriggerPayload) => boolean,
): () => void {
  let stopped = false;
  const state = readState();
  const running = new Set<string>();

  async function loop(sisterId: string) {
    running.add(sisterId);
    while (!stopped) {
      try {
        if (!readTelegramConfig().enabled[sisterId]) {
          await sleep(30_000);
          continue;
        }
        const sister = readRoster().find((s) => s.id === sisterId);
        if (!sister) {
          await sleep(60_000);
          continue;
        }
        let env = "";
        try {
          env = fs.readFileSync(
            path.join(getDyadAppPath(sister.id), ".env"),
            "utf8",
          );
        } catch {
          await sleep(60_000);
          continue;
        }
        const { token, chat } = parseEnvCreds(env);
        if (!token || !chat) {
          await sleep(60_000);
          continue;
        }
        const offset = state.offsets[sisterId];
        const { status, json } = await tg(
          token,
          "getUpdates",
          { timeout: 25, allowed_updates: ["message"], ...(offset ? { offset } : {}) },
          40_000,
        );
        if (status === 409) {
          // Another program (Sapphire) is listening on this bot.
          logger.warn(`${sisterId}: bot is being listened to elsewhere`);
          await sleep(120_000);
          continue;
        }
        if (!json?.ok) {
          await sleep(20_000);
          continue;
        }
        for (const update of json.result as any[]) {
          const m = parseUpdate(update, chat, Math.floor(Date.now() / 1000));
          if (!m) {
            state.offsets[sisterId] = update.update_id + 1;
            continue;
          }
          if (m.ageSeconds > MAX_AGE_SECONDS) {
            state.offsets[sisterId] = update.update_id + 1;
            continue;
          }
          if (m.kind === "other") {
            await tg(token, "sendMessage", {
              chat_id: chat,
              text: "I can only read text for now, love. Type it to me?",
            }, 15_000).catch(() => {});
            state.offsets[sisterId] = update.update_id + 1;
            continue;
          }
          const ok = send({
            appId: sister.appId,
            sisterId,
            prompt: buildTelegramPrompt(sister.name, m),
            title: `Telegram: ${sister.name}`,
            thread: "telegram",
          });
          if (!ok) {
            await sleep(10_000);
            break; // leave it unread; try again
          }
          state.offsets[sisterId] = update.update_id + 1;
        }
        writeState(state);
      } catch (error) {
        logger.warn(`${sisterId} poll failed`, error);
        await sleep(20_000);
      }
    }
    running.delete(sisterId);
  }

  for (const s of readRoster()) void loop(s.id);
  return () => {
    stopped = true;
  };
}