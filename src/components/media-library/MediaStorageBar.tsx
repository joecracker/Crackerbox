import { useState } from "react";
import { Archive, AlertTriangle, FolderOpen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ipc, type MediaStorageInfo } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { formatBytes } from "@/lib/mediaUtils";
import { cn } from "@/lib/utils";

export function MediaStorageBar({ info }: { info: MediaStorageInfo }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const overWarn = info.archiveBytes >= info.warnBytes;

  const openFolder = async () => {
    try {
      await ipc.media.openArchiveFolder();
    } catch (error) {
      showError(error);
    }
  };

  const emptyArchive = async () => {
    setBusy(true);
    try {
      const result = await ipc.media.emptyArchive();
      await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(
        `Emptied the archive (${result.removedFiles} picture${result.removedFiles === 1 ? "" : "s"}, ${formatBytes(result.removedBytes)})`,
      );
      setConfirmOpen(false);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="media-storage-bar"
      className={cn(
        "mb-4 rounded-lg border p-3 text-sm",
        overWarn
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
          : "bg-[--background-lightest]",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p>
            <span className="font-medium">Pictures:</span>{" "}
            {formatBytes(info.liveBytes)} ({info.liveFileCount} file
            {info.liveFileCount === 1 ? "" : "s"})
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1 font-medium">
              <Archive className="h-3.5 w-3.5" />
              Archive:
            </span>{" "}
            {formatBytes(info.archiveBytes)} ({info.archiveFileCount} file
            {info.archiveFileCount === 1 ? "" : "s"})
          </p>
          <p className="text-xs text-muted-foreground">
            Pictures older than 30 days move to the archive instead of being
            deleted. Pin a picture to keep it in its project.
          </p>
          {overWarn && (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              The archive is over {formatBytes(info.warnBytes)}. Empty it when
              you no longer need those old pictures.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="media-open-archive"
            onClick={() => {
              void openFolder();
            }}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Open archive folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="media-empty-archive"
            disabled={info.archiveFileCount === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Empty archive
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="media-empty-archive-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the archive?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {info.archiveFileCount} old picture
              {info.archiveFileCount === 1 ? "" : "s"} (
              {formatBytes(info.archiveBytes)}) that were moved out of your
              projects. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              data-testid="media-empty-archive-confirm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void emptyArchive();
              }}
            >
              Empty archive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
