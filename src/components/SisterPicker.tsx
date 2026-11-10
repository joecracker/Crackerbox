import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  MiniSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/ipc/types";

export function SisterBadge({
  color,
  initial,
  size = 18,
}: {
  color: string;
  initial: string;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
      }}
    >
      {initial}
    </span>
  );
}

/** Picks which sister is in this chat. She brings her persona and private memory. */
export function SisterPicker() {
  const queryClient = useQueryClient();
  const routerState = useRouterState();
  const chatId =
    routerState.location.pathname === "/chat"
      ? (routerState.location.search.id as number | undefined)
      : undefined;

  const sisters = useQuery({
    queryKey: ["house", "sisters"],
    queryFn: () => ipc.chat.listSisters(),
    enabled: chatId !== undefined,
  });
  const meta = useQuery({
    queryKey: ["chat-sister", chatId],
    queryFn: () => ipc.chat.getChatMetadata(chatId!),
    enabled: chatId !== undefined,
  });

  if (chatId === undefined || !sisters.data || sisters.data.length === 0) {
    return null;
  }

  const own = sisters.data.find((s) => s.appId === meta.data?.appId);
  const value = meta.data?.sisterId ?? "none";
  const current = sisters.data.find((s) => s.id === value) ?? own;

  const onChange = async (picked: string | null) => {
    const next = picked ?? "none";
    try {
      await ipc.chat.setChatSister({
        chatId,
        sisterId: next === "none" ? null : next,
      });
      await queryClient.invalidateQueries({
        queryKey: ["chat-sister", chatId],
      });
      toast.success(
        next === "none"
          ? "Back to this app's own assistant. Takes effect on your next message."
          : `${sisters.data.find((s) => s.id === next)?.name} is in this chat. Takes effect on your next message.`,
      );
    } catch (e) {
      toast.error(`Could not change sister: ${(e as Error).message}`);
    }
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <MiniSelectTrigger
        data-testid="sister-picker"
        title="Which sister is in this chat"
      >
        <SelectValue>
          {current ? (
            <span className="flex items-center gap-1.5">
              <SisterBadge color={current.color} initial={current.initial} />
              {current.name}
            </span>
          ) : (
            "No sister"
          )}
        </SelectValue>
      </MiniSelectTrigger>
      <SelectContent>
        <SelectItem value="none">
          {own ? `${own.name} (this room)` : "No sister (this app's assistant)"}
        </SelectItem>
        {sisters.data
          .filter((s) => s.id !== own?.id)
          .map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex items-center gap-1.5">
                <SisterBadge color={s.color} initial={s.initial} />
                {s.name}
              </span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
