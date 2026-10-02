import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleSummarize = async () => {
    if (!appId) {
      console.error("No app id found");
      return;
    }
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    try {
      const sourceChat = await ipc.chat.getChat(chatId);
      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: sourceChat.chatMode ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      // navigate to new chat
      await navigate({ to: "/chat", search: { id: newChatId } });
      await streamMessage({
        prompt: "Summarize from chat-id=" + chatId,
        chatId: newChatId,
      });
      // A blank summary leaves the new chat with no context, so the next
      // message makes the AI start over. Say so instead of failing silently.
      // streamMessage can return before the reply is fully saved, so wait up
      // to 60s for real content before calling it a failure.
      let summaryOk = false;
      for (let i = 0; i < 60 && !summaryOk; i++) {
        const newChat = await ipc.chat.getChat(newChatId);
        const lastAssistant = [...newChat.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        summaryOk =
          !!lastAssistant && lastAssistant.content.trim().length >= 40;
        if (!summaryOk) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!summaryOk) {
        showError(
          "The summary came back empty, so this new chat has no context. Your old chat is untouched. Try Summarize again.",
        );
      }
    } catch (err) {
      showError(err);
    }
  };

  return { handleSummarize };
}
