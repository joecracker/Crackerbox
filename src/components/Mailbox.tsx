import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";

/** A little roadside mailbox. The flag is up when there is unread mail. */
function MailboxIcon({ flagUp }: { flagUp: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect
        x="11.5"
        y="15"
        width="3"
        height="10"
        rx="1"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M3 14a7 7 0 0 1 7-7h6a7 7 0 0 1 7 7v1H3v-1z"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="4"
        y="12"
        width="6"
        height="2"
        rx="1"
        fill="#181f1a"
        opacity="0.35"
      />
      {flagUp ? (
        <g>
          <rect x="21" y="2" width="2" height="11" rx="1" fill="currentColor" />
          <rect x="15" y="2" width="7" height="5" rx="1" fill="#ef4444" />
        </g>
      ) : (
        <rect
          x="21"
          y="10"
          width="4"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.6"
        />
      )}
    </svg>
  );
}

export function MailboxButton({ isExpanded }: { isExpanded: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [letter, setLetter] = useState("");
  const queryClient = useQueryClient();
  const mail = useQuery({
    queryKey: ["house", "mailbox"],
    queryFn: () => ipc.chat.houseMailbox(),
    refetchInterval: 15000,
  });
  const unread = (mail.data ?? []).filter((m) => m.unread).length;

  const openLetter = async (file: string) => {
    setSelected(file);
    setLetter(await ipc.chat.houseReadLetter({ file }));
    await queryClient.invalidateQueries({ queryKey: ["house", "mailbox"] });
  };

  return (
    <>
      <button
        type="button"
        aria-label={unread > 0 ? `Mailbox, ${unread} unread` : "Mailbox"}
        title={unread > 0 ? `Mailbox: ${unread} unread` : "Mailbox: empty"}
        data-testid="mailbox-button"
        onClick={() => setOpen(true)}
        className={cn(
          "mb-1 flex h-10 items-center justify-center rounded-xl outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          unread > 0 ? "text-sidebar-foreground" : "text-sidebar-foreground/50",
          isExpanded ? "w-14" : "w-10",
        )}
      >
        <MailboxIcon flagUp={unread > 0} />
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSelected(null);
            setLetter("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="mailbox-dialog">
          <DialogHeader>
            <DialogTitle>Your mailbox</DialogTitle>
            <DialogDescription>
              Notes your entities have left for you.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => setSelected(null)}
              >
                &larr; Back
              </button>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                {letter}
              </pre>
            </div>
          ) : (mail.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No mail yet.
            </p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-auto">
              {(mail.data ?? []).map((m) => (
                <li key={m.file}>
                  <button
                    type="button"
                    onClick={() => openLetter(m.file)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        m.unread ? "bg-red-500" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate",
                          m.unread && "font-semibold",
                        )}
                      >
                        {m.subject}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        from {m.from}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
