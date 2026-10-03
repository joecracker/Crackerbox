import { useState, type ReactNode } from "react";
import { useAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { AppQuickDeleteDialog } from "@/components/AppQuickDeleteDialog";
import { AppQuickRenameDialog } from "@/components/AppQuickRenameDialog";
import { useLoadApps } from "@/hooks/useLoadApps";
import type { ListedApp } from "@/ipc/types/app";

/**
 * The "..." menu on an app card (Rename, Delete) is offered both in the Apps
 * gallery and in the Featured Apps row on the Home page. This keeps the two
 * dialogs and their state in one place so both behave identically.
 *
 * Pass `onRename` / `onDelete` to AppShowcaseCard and render `dialogs` once.
 */
export function useAppQuickActions(): {
  onRename: (app: ListedApp) => void;
  onDelete: (app: ListedApp) => void;
  dialogs: ReactNode;
} {
  const { refreshApps } = useLoadApps();
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const [renameTarget, setRenameTarget] = useState<ListedApp | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListedApp | null>(null);

  const dialogs = (
    <>
      <AppQuickRenameDialog
        key={`rename-${renameTarget?.id ?? "none"}`}
        app={renameTarget}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null);
        }}
        onRenamed={async () => {
          await refreshApps();
        }}
      />
      <AppQuickDeleteDialog
        app={deleteTarget}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        onDeleted={async (deletedId) => {
          if (selectedAppId === deletedId) setSelectedAppId(null);
          await refreshApps();
        }}
      />
    </>
  );

  return { onRename: setRenameTarget, onDelete: setDeleteTarget, dialogs };
}
