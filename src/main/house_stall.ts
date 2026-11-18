import log from "electron-log";
import { readRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { forwardLetterToTim } from "@/pro/main/ipc/handlers/local_agent/house_telegram";
import { readSilentChats } from "@/main/silent_chats";

const logger = log.scope("house_stall");

/**
 * A scheduled chat (the morning greeting, a surprise, the nightly tidy-up) that
 * the model never answered, even after a retry, would otherwise end in silence.
 * Tell Tim on Telegram, from Dextra's bot, which entity got stuck. Chats Tim
 * opened himself show the error on screen instead, so they are not reported.
 */
export async function reportStalledScheduledChat(chat: {
  id: number;
  sisterId?: string | null;
  app: { id: number };
}): Promise<void> {
  try {
    if (!readSilentChats().has(chat.id)) return;
    const roster = readRoster();
    const speaker =
      roster.find((s) => s.id === chat.sisterId) ??
      roster.find((s) => s.appId === chat.app.id);
    const who = speaker?.name ?? "One of the house";
    await forwardLetterToTim(
      "dextra",
      `${who} got stuck`,
      `The AI model stopped answering ${who}'s scheduled job, even after one retry, so nothing was sent from it. It is usually the provider hanging. It will try again on its next scheduled time.`,
    );
  } catch (error) {
    logger.warn("could not report a stalled scheduled chat", error);
  }
}
