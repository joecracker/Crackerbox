import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { showError } from "@/lib/toast";

interface AppQuickDeleteDialogProps {
  /** The app being deleted, or null when the dialog is closed. */
  app: ListedApp | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (appId: number) => void | Promise<void>;
}

/**
 * Delete one app straight from the Apps gallery, without opening its info
 * page. Uses the same delete call and warning text as the info page.
 */
export function AppQuickDeleteDialog({
  app,
  onOpenChange,
  onDeleted,
}: AppQuickDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!app || isDeleting) return;
    setIsDeleting(true);
    try {
      await ipc.app.deleteApp({ appId: app.id });
      await onDeleted(app.id);
      onOpenChange(false);
    } catch (error) {
      onOpenChange(false);
      showError(error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm p-4"
        data-testid="app-quick-delete-dialog"
      >
        <DialogHeader className="pb-2">
          <DialogTitle>Delete "{app?.name}"?</DialogTitle>
          <DialogDescription className="text-xs">
            This action is irreversible. All app files and chat history will be
            permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
            className="flex items-center gap-1"
            data-testid="app-quick-delete-confirm-button"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete app"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
