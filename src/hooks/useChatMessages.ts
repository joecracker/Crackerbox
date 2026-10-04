import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";

import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import type { Message } from "@/ipc/types";

const EMPTY_CHAT_MESSAGES: Message[] = [];

export function useChatMessages(chatId: number | null | undefined): Message[] {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(
          chatMessagesByIdAtom,
          (messagesById) =>
            chatId == null
              ? EMPTY_CHAT_MESSAGES
              : (messagesById.get(chatId) ?? EMPTY_CHAT_MESSAGES),
          Object.is,
        ),
      [chatId],
    ),
  );
}

export type LatestChatMessageSummary = Pick<Message, "role" | "model">;

/**
 * Subscribes to only the role and model of a chat's newest message. Unlike
 * useChatMessages it does not change on every streamed word, so components that
 * only need this (such as the model picker) are not re-rendered per chunk.
 */
export function useLatestChatMessageSummary(
  chatId: number | null | undefined,
): LatestChatMessageSummary | undefined {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(
          chatMessagesByIdAtom,
          (messagesById): LatestChatMessageSummary | undefined => {
            const latest =
              chatId == null ? undefined : messagesById.get(chatId)?.at(-1);
            return latest
              ? { role: latest.role, model: latest.model }
              : undefined;
          },
          (a, b) => a?.role === b?.role && a?.model === b?.model,
        ),
      [chatId],
    ),
  );
}

export function useChatMessagesLoaded(
  chatId: number | null | undefined,
): boolean {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(chatMessagesByIdAtom, (messagesById) =>
          chatId == null ? false : messagesById.has(chatId),
        ),
      [chatId],
    ),
  );
}

export function useChatMessageCount(chatId: number | null | undefined): number {
  return useAtomValue(
    useMemo(
      () =>
        selectAtom(chatMessagesByIdAtom, (messagesById) =>
          chatId == null ? 0 : (messagesById.get(chatId)?.length ?? 0),
        ),
      [chatId],
    ),
  );
}
