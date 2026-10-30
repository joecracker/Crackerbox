import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  HANDOFF_START_LINE,
  buildHandoffRequest,
} from "@/prompts/handoff_prompts";

/** Whether this chat has a handoff that is still current (see getHandoffStatus). */
export function useHandoffStatus(chatId: number | null) {
  return useQuery({
    queryKey: queryKeys.chats.handoff({ chatId }),
    queryFn: () => ipc.chat.getHandoffStatus(chatId as number),
    enabled: chatId != null,
    staleTime: 0,
  });
}

/**
 * The two halves of a handoff:
 * - writeHandoff: asks the current chat (which did the work) to save the
 *   handoff into the app's memory. Nothing else happens, and no new chat opens.
 * - startNewChat: opens a fresh chat whose first message is the plain
 *   "Continue from the handoff." line; the model answers with its game plan.
 */
export function useHandoff() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const { streamMessage, isStreaming } = useStreamChat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const busyRef = useRef(false);
  const statusQuery = useHandoffStatus(chatId ?? null);

  // The handoff is saved while a reply is running, so look again when it ends.
  useEffect(() => {
    if (!isStreaming && chatId != null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chats.handoff({ chatId }),
      });
    }
  }, [isStreaming, chatId, queryClient]);

  const writeHandoff = useCallback(
    async (carryOver?: string) => {
      if (chatId == null || isStreaming || busyRef.current) return;
      busyRef.current = true;
      const prompt = buildHandoffRequest(carryOver);
      try {
        const started = await streamMessage({
          prompt,
          chatId,
          redo: false,
          requestedChatMode: "local-agent",
          showOptimisticMessage: true,
          optimisticDisplayContent: prompt,
          onSettled: () => {
            busyRef.current = false;
            void queryClient.invalidateQueries({
              queryKey: queryKeys.chats.handoff({ chatId }),
            });
          },
        });
        if (!started) busyRef.current = false;
      } catch (err) {
        busyRef.current = false;
        showError(err);
      }
    },
    [chatId, isStreaming, queryClient, streamMessage],
  );

  const startNewChat = useCallback(async () => {
    if (appId == null || busyRef.current) return;
    busyRef.current = true;
    try {
      const newChatId = await ipc.chat.createChat({
        appId,
        initialChatMode: "local-agent",
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      await navigate({ to: "/chat", search: { id: newChatId } });
      await streamMessage({
        prompt: HANDOFF_START_LINE,
        chatId: newChatId,
        redo: false,
        requestedChatMode: "local-agent",
        showOptimisticMessage: true,
        optimisticDisplayContent: HANDOFF_START_LINE,
      });
    } catch (err) {
      showError(err);
    } finally {
      busyRef.current = false;
    }
  }, [appId, navigate, queryClient, streamMessage]);

  return {
    chatId,
    saved: statusQuery.data?.saved === true,
    isStreaming,
    writeHandoff,
    startNewChat,
  };
}
