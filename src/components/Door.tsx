import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";

/** A front door with a mail slot. Open: slot lit, letter poking out. Locked: padlock. */
export function DoorIcon({
  open,
  size = 26,
}: {
  open: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect
        x="5"
        y="2"
        width="16"
        height="22"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <rect
        x="8.5"
        y="8"
        width="9"
        height="3"
        rx="1.2"
        fill="currentColor"
        opacity={open ? 0.95 : 0.5}
      />
      {open ? (
        <g>
          <rect x="10" y="4.5" width="6" height="4" rx="0.8" fill="#22c55e" />
          <circle cx="17.5" cy="17" r="1.4" fill="#22c55e" />
        </g>
      ) : (
        <g>
          <rect
            x="9.5"
            y="15"
            width="7"
            height="5.5"
            rx="1.2"
            fill="currentColor"
          />
          <path
            d="M11 15v-1.8a2 2 0 0 1 4 0V15"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </g>
      )}
    </svg>
  );
}

function timeLeft(expiresAt: number, now: number): string {
  const mins = Math.max(0, Math.ceil((expiresAt - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DoorButton({
  isExpanded,
  variant = "rail",
}: {
  isExpanded: boolean;
  /** "bar" is the phone bottom-bar slot: same door, laid out like its neighbors. */
  variant?: "rail" | "bar";
}) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const door = useQuery({
    queryKey: ["house", "door"],
    queryFn: () => ipc.chat.houseDoor(),
    refetchInterval: 15000,
  });
  const toggle = useMutation({
    mutationFn: (open: boolean) => ipc.chat.houseSetDoor({ open }),
    onSuccess: (data) => queryClient.setQueryData(["house", "door"], data),
  });
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const open = !!door.data?.open;
  const expiresAt = door.data?.expiresAt ?? null;
  const title = open
    ? `Front door: open${expiresAt ? `, locks in ${timeLeft(expiresAt, now)}` : ""}. Click to lock.`
    : "Front door: locked. Click to open for 3 hours.";

  if (variant === "bar") {
    return (
      <button
        type="button"
        aria-label={title}
        title={title}
        aria-pressed={open}
        data-testid="door-button"
        onClick={() => toggle.mutate(!open)}
        disabled={toggle.isPending}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
          open
            ? "text-sidebar-foreground"
            : "text-sidebar-foreground/70 active:text-sidebar-foreground",
        )}
      >
        <DoorIcon open={open} size={20} />
        <span>{open && expiresAt ? timeLeft(expiresAt, now) : "Door"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      aria-pressed={open}
      data-testid="door-button"
      onClick={() => toggle.mutate(!open)}
      disabled={toggle.isPending}
      className={cn(
        "mb-1 flex h-10 items-center justify-center rounded-xl outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        open ? "text-sidebar-foreground" : "text-sidebar-foreground/50",
        isExpanded ? "w-14" : "w-10",
      )}
    >
      <DoorIcon open={open} />
    </button>
  );
}
