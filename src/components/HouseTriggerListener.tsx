import { useEffect } from "react";
import { ipc } from "@/ipc/types";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useSelectChat } from "@/hooks/useSelectChat";

/**
 * Starts a chat turn as a sister when the house scheduler asks for one (her
 * morning greeting, a surprise check-in) or when Tim texts her on Telegram.
 * The chat is an ordinary chat in her app, so it shows in the sidebar like
 * any other. Telegram texts share one chat per sister per day, and turns run
 * one at a time so two quick texts do not collide.
 */
let queue: Promise<void> = Promise.resolve();

const today = () => new Date().toISOString().slice(0, 10);

async function telegramChatId(appId: number, sisterId: string) {
  const key = `telegramChat:${sisterId}:${today()}`;
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved) {
      const chat = await ipc.chat.getChat(saved);
      if (chat) return saved;
    }
  } catch {
    // chat gone or storage unavailable: make a fresh one
  }
  const id = await ipc.chat.createChat({ appId });
  try {
    localStorage.setItem(key, String(id));
  } catch {
    // light convenience only
  }
  return id;
}

export function HouseTriggerListener() {
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { selectChat } = useSelectChat();

  useEffect(() => {
    return ipc.events.misc.onHouseTrigger((payload) => {
      const jobId = payload.jobId;
      queue = queue.then(async () => {
        try {
          const isTelegram = payload.thread === "telegram";
          const chatId = isTelegram
            ? await telegramChatId(payload.appId, payload.sisterId)
            : await ipc.chat.createChat({ appId: payload.appId });
          // Scheduled jobs run quietly: kept, but hidden from the chat lists.
          // A trigger marked visible (the post-install wake) is the opposite:
          // it opens on screen so Tim sees her report without having to ask.
          if (payload.visible) {
            selectChat({ chatId, appId: payload.appId });
          } else if (!isTelegram) {
            await ipc.chat.markChatSilent({ chatId });
          }
          await streamMessage({
            prompt: payload.prompt,
            chatId,
            appId: payload.appId,
            showOptimisticMessage: false,
            // A direct hand-off waits in main for this turn to settle.
            onSettled: jobId
              ? (result) => {
                  if (result.queued) return;
                  void ipc.chat.houseJobDone({
                    jobId,
                    chatId,
                    success: result.success,
                    pausedByStepLimit: result.pausedByStepLimit,
                  });
                }
              : undefined,
          });
        } catch (error) {
          console.error("House trigger failed", error);
          if (jobId) {
            void ipc.chat.houseJobDone({ jobId, chatId: 0, success: false });
          }
        }
      });
    });
  }, [streamMessage, selectChat]);

  return null;
}
