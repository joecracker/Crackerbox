import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useHandoff } from "@/hooks/useHandoff";

const BUTTON_CLASSES =
  "h-6 px-2 text-xs border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20 hover:border-amber-500/60";

/**
 * One button for the whole handoff. It reads "Write handoff" until this chat
 * has saved one, then "New chat". Writing asks the chat you are in, which did
 * the work, so it knows what the next chat needs.
 */
export function HandoffButton() {
  const { chatId, saved, isStreaming, writeHandoff, startNewChat } =
    useHandoff();
  const [open, setOpen] = useState(false);
  const [carryOver, setCarryOver] = useState("");

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

  const submit = () => {
    const note = carryOver;
    setCarryOver("");
    setOpen(false);
    void writeHandoff(note);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            data-testid="write-handoff"
            variant="outline"
            size="sm"
            disabled={isStreaming}
            className={BUTTON_CLASSES}
          />
        }
      >
        Write handoff
        <ArrowRight className="h-3 w-3 ml-1" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Anything you want carried over to the next chat? (optional)
          </p>
          <Textarea
            data-testid="handoff-carry-over"
            value={carryOver}
            onChange={(e) => setCarryOver(e.target.value)}
            placeholder="For example: keep the proof sheet, start with the cuts"
            className="min-h-[64px] text-xs"
          />
          <div className="flex justify-end">
            <Button data-testid="handoff-confirm" size="sm" onClick={submit}>
              Write it
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
