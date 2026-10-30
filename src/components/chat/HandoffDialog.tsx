import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useHandoff } from "@/hooks/useHandoff";

/**
 * Where you ask the chat you are in to write its handoff, with an optional
 * note about what the next chat should carry over. Used by the banner button
 * and by the "+" menu, so there is one place that does this.
 */
export function HandoffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { writeHandoff, isStreaming } = useHandoff();
  const [carryOver, setCarryOver] = useState("");

  const submit = () => {
    const note = carryOver;
    setCarryOver("");
    onOpenChange(false);
    void writeHandoff(note);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Write handoff</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This chat will save what the next chat needs to pick up where you
            left off. Anything you want carried over? (optional)
          </p>
          <Textarea
            data-testid="handoff-carry-over"
            value={carryOver}
            onChange={(e) => setCarryOver(e.target.value)}
            placeholder="For example: keep the proof sheet, start with the cuts"
            className="min-h-[80px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              data-testid="handoff-confirm"
              size="sm"
              disabled={isStreaming}
              onClick={submit}
            >
              Write it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
