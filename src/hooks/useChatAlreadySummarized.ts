import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface SearchHit {
  id: number;
  matchedMessageContent: string | null;
}

// A summary chat's first message is always this prompt (see
// SummarizeInNewChatButton). It lives in the shared chat history, so it tells
// us a chat was summarized no matter which device did it.
export function summaryPromptFor(chatId: number) {
  return `Summarize from chat-id=${chatId}`;
}

// The search matches by substring, so "chat-id=5" also finds "chat-id=51".
export function hasSummaryChat(
  hits: readonly SearchHit[],
  chatId: number,
): boolean {
  const exact = new RegExp(`Summarize from chat-id=${chatId}(?!\\d)`);
  return hits.some(
    (hit) => hit.id !== chatId && exact.test(hit.matchedMessageContent ?? ""),
  );
}

export function useChatAlreadySummarized({
  appId,
  chatId,
  enabled,
}: {
  appId: number | null;
  chatId: number | null;
  enabled: boolean;
}): boolean {
  const query = chatId != null ? summaryPromptFor(chatId) : "";
  const { data } = useQuery({
    queryKey: queryKeys.chats.search({ appId, query }),
    queryFn: () => ipc.chat.searchChats({ appId: appId as number, query }),
    enabled: enabled && appId != null && chatId != null,
    staleTime: 0,
    refetchOnMount: "always",
  });
  return chatId != null && data != null && hasSummaryChat(data, chatId);
}
