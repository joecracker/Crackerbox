import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHandoff } from "@/hooks/useHandoff";
import { HandoffDialog } from "./HandoffDialog";

const BUTTON_CLASSES =
  "h-6 px-2 text-xs border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20 hover:border-amber-500/60";

/**
 * One button for the whole handoff. It reads "Write handoff" until this chat
 * has saved one, then "New chat". Writing asks the chat you are in, which did
 * the work, so it knows what the next chat needs.
 */
export function HandoffButton() {
  const { chatId, saved, isStreaming, startNewChat } = useHandoff();
  const [open, setOpen] = useState(false);

  if (chatId == null) return null;

  if (saved) {
    return (
      <Button
        data-testid="new-chat-from-handoff"
        variant="outline"
        size="sm"
        className={BUTTON_CLASSES}
        onClick={() => void startNewChat()}
      >
        New chat
        <ArrowRight className="h-3 w-3 ml-1" />
      </Button>
    );
  }

  return (
    <>
      <Button
        data-testid="write-handoff"
        variant="outline"
        size="sm"
        disabled={isStreaming}
        className={BUTTON_CLASSES}
        onClick={() => setOpen(true)}
      >
        Write handoff
        <ArrowRight className="h-3 w-3 ml-1" />
      </Button>
      <HandoffDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
