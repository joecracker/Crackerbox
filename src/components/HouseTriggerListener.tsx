import { useEffect } from "react";
import { ipc } from "@/ipc/types";
import { useStreamChat } from "@/hooks/useStreamChat";

/**
 * Starts a chat turn as a sister when the house scheduler asks for one (her
 * morning greeting, a surprise check-in). The chat is an ordinary chat in her
 * app, so it shows in the sidebar like any other.
 */
export function HouseTriggerListener() {
  const { streamMessage } = useStreamChat({ hasChatId: false });

  useEffect(() => {
    return ipc.events.misc.onHouseTrigger((payload) => {
      void (async () => {
        try {
          const chatId = await ipc.chat.createChat({ appId: payload.appId });
          await streamMessage({
            prompt: payload.prompt,
            chatId,
            appId: payload.appId,
            showOptimisticMessage: false,
          });
        } catch (error) {
          console.error("House trigger failed", error);
        }
      })();
    });
  }, [streamMessage]);

  return null;
}
