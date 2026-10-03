import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ipc } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { showError } from "@/lib/toast";
import { slugifyAppFolderName } from "@/shared/app_names";

interface AppQuickRenameDialogProps {
  /** The app being renamed, or null when the dialog is closed. */
  app: ListedApp | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void | Promise<void>;
}

/**
 * Rename an app straight from the Apps gallery, without opening its info page.
 * Uses the same rename call as the info page. Render it with `key={app?.id}`
 * so the fields start fresh for each app.
 */
export function AppQuickRenameDialog({
  app,
  onOpenChange,
  onRenamed,
}: AppQuickRenameDialogProps) {
  const [name, setName] = useState(app?.name ?? "");
  const [renameFolder, setRenameFolder] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);

  const trimmed = name.trim();
  const unchanged = app !== null && trimmed === app.name;

  const handleRename = async () => {
    if (!app || !trimmed || isRenaming) return;
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    setIsRenaming(true);
    try {
      await ipc.app.renameApp({
        appId: app.id,
        appName: trimmed,
        appPath: renameFolder ? slugifyAppFolderName(trimmed) : app.path,
      });
      await onRenamed();
      onOpenChange(false);
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).replace(/^Error invoking remote method 'rename-app': Error: /, "");
      showError(message);
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm p-4"
        data-testid="app-quick-rename-dialog"
      >
        <DialogHeader className="pb-2">
          <DialogTitle>Rename app</DialogTitle>
          <DialogDescription className="text-xs">
            Pick a name you will recognise in the list.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleRename();
          }}
          placeholder="Enter new app name"
          aria-label="New app name"
          className="my-2"
          autoFocus
        />
        <div className="flex items-center gap-2 pb-1">
          <Checkbox
            id="app-quick-rename-folder"
            checked={renameFolder}
            onCheckedChange={(checked) => setRenameFolder(checked === true)}
          />
          <Label
            htmlFor="app-quick-rename-folder"
            className="text-xs text-muted-foreground"
          >
            Also rename the app's folder to match
          </Label>
        </div>
        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isRenaming}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleRename()}
            disabled={isRenaming || !trimmed}
            data-testid="app-quick-rename-confirm-button"
          >
            {isRenaming ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Renaming...
              </>
            ) : (
              "Rename"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
