import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import { showError, toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { looksLikeHandoffSummary } from "@/lib/handoff_summary";

// Source chats being summarized right now (shared by every Summarize button).
const summarizing = new Set<number>();
const SUMMARY_TIMEOUT_MS = 5 * 60_000;
// A cheap model sometimes carries the old chat on instead of summarizing it.
// One fresh try costs little; a bad summary would quietly poison the new chat.
const MAX_SUMMARY_ATTEMPTS = 2;

export function useSummarizeInNewChat() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage } = useStreamChat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentChatIdRef = useRef(chatId);
  currentChatIdRef.current = chatId;

  const handleSummarize = async () => {
    if (!appId) {
      console.error("No app id found");
      return;
    }
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    if (summarizing.has(chatId)) return;
    const sourceChatId = chatId;
    summarizing.add(sourceChatId);
    const toastId = toast.loading(
      "Writing your handoff. Your new chat will open in a moment. Nothing to press.",
    );
    try {
      const sourceChat = await ipc.chat.getChat(sourceChatId);

      const deleteQuietly = async (id: number) => {
        try {
          await ipc.chat.deleteChat(id);
        } catch {
          // Leaving the empty chat in the list is harmless.
        }
      };

      // The summary is written in the background while you stay in the old
      // chat, so there is nothing to interrupt. The new chat opens only once
      // the summary is finished and the chat is idle, waiting for you.
      const runAttempt = async () => {
        const createdId = await ipc.chat.createChat({
          appId,
          initialChatMode: sourceChat.chatMode ?? undefined,
        });
        const settled = new Promise<"done" | "failed">((resolve) => {
          void streamMessage({
            prompt: "Summarize from chat-id=" + sourceChatId,
            chatId: createdId,
            onSettled: (result) => resolve(result.success ? "done" : "failed"),
          }).then((queued) => {
            if (!queued) resolve("failed");
          });
        });
        const timeout = new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), SUMMARY_TIMEOUT_MS),
        );
        const outcome = await Promise.race([settled, timeout]);

        // Check that the reply really is a summary, not just text: a blank or
        // off-topic reply would leave the new chat with the wrong context.
        let summaryOk = false;
        if (outcome === "done") {
          for (let i = 0; i < 10 && !summaryOk; i++) {
            const newChat = await ipc.chat.getChat(createdId);
            const lastAssistant = [...newChat.messages]
              .reverse()
              .find((m) => m.role === "assistant");
            summaryOk =
              !!lastAssistant && looksLikeHandoffSummary(lastAssistant.content);
            if (!summaryOk) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        return { createdId, outcome, summaryOk };
      };

      let attempt = await runAttempt();
      for (
        let n = 1;
        n < MAX_SUMMARY_ATTEMPTS &&
        attempt.outcome === "done" &&
        !attempt.summaryOk;
        n++
      ) {
        await deleteQuietly(attempt.createdId);
        attempt = await runAttempt();
      }
      const { createdId, outcome, summaryOk } = attempt;

      if (outcome === "failed" || (outcome === "done" && !summaryOk)) {
        showError(
          "The summary didn't finish, so no new chat was made. Your old chat is untouched. Try Summarize again.",
        );
        await deleteQuietly(createdId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
        return;
      }
      if (outcome === "timeout") {
        showError(
          "The summary is taking longer than expected. Opening the new chat so you can watch it or stop it.",
        );
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      if (currentChatIdRef.current === sourceChatId || outcome === "timeout") {
        await navigate({ to: "/chat", search: { id: createdId } });
      } else {
        toast.success("Handoff ready. It's in your chats list.");
      }
    } catch (err) {
      showError(err);
    } finally {
      toast.dismiss(toastId);
      summarizing.delete(sourceChatId);
    }
  };

  return { handleSummarize };
}
