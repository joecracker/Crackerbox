import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import type { SpeechEngine } from "@/lib/speechPlayback";

/**
 * The voice a reply in this chat is spoken with: the speaking entity's own
 * voice when she has one (it runs on Pocket, with Kokoro as the backup),
 * otherwise the voice chosen in settings.
 */
export function useSpokenVoice(
  chatId: number | null | undefined,
  appId: number | null | undefined,
  settings: UserSettings | null | undefined,
): { voice: string; provider: SpeechEngine } {
  const sisters = useQuery({
    queryKey: ["house", "sisters"],
    queryFn: () => ipc.chat.listSisters(),
  });
  const meta = useQuery({
    queryKey: ["chat-sister", chatId],
    queryFn: () => ipc.chat.getChatMetadata(chatId!),
    enabled: chatId != null,
  });
  const speaker =
    sisters.data?.find((s) => s.id === meta.data?.sisterId) ??
    sisters.data?.find((s) => s.appId === appId);
  if (speaker?.voice) return { voice: speaker.voice, provider: "pocket" };
  return {
    voice: settings?.speechVoice ?? "af_bella",
    provider: settings?.speechProvider ?? "openrouter",
  };
}
