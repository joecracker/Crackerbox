import { useState, type FormEvent } from "react";
import { Loader2, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCheckName } from "@/hooks/useCheckName";
import { useCreateApp } from "@/hooks/useCreateApp";
import { useDebounce } from "@/hooks/useDebounce";
import { useSelectChat } from "@/hooks/useSelectChat";
import { cn } from "@/lib/utils";

// A "project" is what the code still calls an app: a folder with any number of
// chats under it. Creating one here gives it a name up front and opens its
// first chat, the same way the Templates page does.
export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createApp } = useCreateApp();
  const { selectChat } = useSelectChat();
  const trimmed = name.trim();
  const debounced = useDebounce(trimmed, 150);
  const { data: nameCheck, isLoading: isCheckingName } =
    useCheckName(debounced);
  const queryMatchesInput = debounced === trimmed;
  const nameExists = queryMatchesInput && nameCheck?.exists === true;
  const canSubmit =
    trimmed.length > 0 &&
    queryMatchesInput &&
    !isCheckingName &&
    !nameExists &&
    !isSubmitting;

  const handleOpenChange = (next: boolean) => {
    if (!next) setName("");
    onOpenChange(next);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await createApp({ name: trimmed });
      selectChat({ chatId: result.chatId, appId: result.app.id });
      handleOpenChange(false);
    } catch (error) {
      // useCreateApp has already shown the error.
      console.error("Error creating project:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Give it a name. You can keep as many chats as you like under it, and
            rename it later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-2 py-4">
            <Label htmlFor="new-project-name">Project name</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter a project name"
              className={nameExists ? "border-red-500" : ""}
              disabled={isSubmitting}
            />
            {nameExists && (
              <p className="text-sm text-red-500">
                A project with that name already exists.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isSubmitting ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewProjectButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("gap-2", className)}
        data-testid="new-project-button"
        onClick={() => setOpen(true)}
      >
        <PlusCircle size={16} />
        <span>New Project</span>
      </Button>
      {open && <NewProjectDialog open onOpenChange={setOpen} />}
    </>
  );
}
