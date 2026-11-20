import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
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
  // Where Tim is right now, readable from inside the long-lived listener
  // without re-subscribing every time he changes chats.
  const currentChat = useRef<{ chatId: number | null; appId: number | null }>({
    chatId: null,
    appId: null,
  });
  currentChat.current = {
    chatId: useAtomValue(selectedChatIdAtom),
    appId: useAtomValue(selectedAppIdAtom),
  };

  useEffect(() => {
    return ipc.events.misc.onHouseTrigger((payload) => {
      const jobId = payload.jobId;
      queue = queue.then(async () => {
        let stopWatching: (() => void) | undefined;
        // The chat Tim was in before an approval pulled him to the helper's
        // chat, so he can be sent back once he has answered.
        let returnTo: { chatId: number; appId: number } | null = null;
        let returnTimer: ReturnType<typeof setTimeout> | undefined;
        const goBack = () => {
          clearTimeout(returnTimer);
          returnTimer = undefined;
          const target = returnTo;
          returnTo = null;
          // Only if he is still looking at the helper's chat: if he moved on
          // by himself, leave him where he chose to be.
          if (target && currentChat.current.chatId === openedChatId) {
            selectChat({ chatId: target.chatId, appId: target.appId });
          }
        };
        let openedChatId = 0;
        const stopAll = () => {
          stopWatching?.();
          goBack();
        };
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
          } else if (!isTelegram && !jobId) {
            await ipc.chat.markChatSilent({ chatId });
          }
          // A direct hand-off runs in the background (it stays in the chat
          // list). If a step needs Tim's approval, bring that chat forward so
          // the job does not sit waiting unseen.
          openedChatId = chatId;
          if (jobId) {
            let requestId: string | undefined;
            const stopRequested = ipc.events.userInput.onRequested(
              (descriptor) => {
                if (
                  descriptor.kind === "agent-consent" &&
                  descriptor.chatId === chatId
                ) {
                  // Another approval right behind the last one: stay put.
                  clearTimeout(returnTimer);
                  returnTimer = undefined;
                  requestId = descriptor.requestId;
                  const here = currentChat.current;
                  if (
                    !returnTo &&
                    here.chatId &&
                    here.appId &&
                    here.chatId !== chatId
                  ) {
                    returnTo = { chatId: here.chatId, appId: here.appId };
                  }
                  selectChat({ chatId, appId: payload.appId });
                }
              },
            );
            // Once he has answered, send him back, after a short pause so a
            // run of approvals does not bounce him between chats.
            const stopSettled = ipc.events.userInput.onSettled((settled) => {
              if (settled.requestId === requestId && returnTo) {
                clearTimeout(returnTimer);
                returnTimer = setTimeout(goBack, 2500);
              }
            });
            stopWatching = () => {
              stopRequested();
              stopSettled();
            };
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
                  stopAll();
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
          stopAll();
          if (jobId) {
            void ipc.chat.houseJobDone({ jobId, chatId: 0, success: false });
          }
        }
      });
    });
  }, [streamMessage, selectChat]);

  return null;
}
