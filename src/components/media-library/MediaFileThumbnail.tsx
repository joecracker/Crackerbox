import { useState } from "react";
import type { ComponentType } from "react";
import {
  Image,
  MoreVertical,
  MessageSquarePlus,
  Pencil,
  Trash2,
  MoveRight,
  Expand,
  Pin,
  PinOff,
  Tag,
  Download,
  Copy,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildDyadMediaThumbnailUrl } from "@/lib/dyadMediaUrl";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/ipc/types";
import type { MediaFile } from "@/ipc/types";

type MediaAction = {
  key: string;
  testId: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
};

export function MediaFileThumbnail({
  file,
  appPath,
  onStartNewChatWithImage,
  onRenameImage,
  onMoveImage,
  onDeleteImage,
  onPreviewImage,
  onSetSection,
  onTogglePin,
  onSaveAs,
  onCopyImage,
  onShowInFolder,
  isBusy,
}: {
  file: MediaFile;
  appPath: string;
  onStartNewChatWithImage: (file: MediaFile) => Promise<void>;
  onRenameImage: (file: MediaFile) => void;
  onMoveImage: (file: MediaFile) => void;
  onDeleteImage: (file: MediaFile) => void;
  onPreviewImage: (file: MediaFile) => void;
  onSetSection: (file: MediaFile) => void;
  onTogglePin: (file: MediaFile) => void;
  onSaveAs: (file: MediaFile) => void;
  onCopyImage: (file: MediaFile) => void;
  onShowInFolder: (file: MediaFile) => void;
  isBusy: boolean;
}) {
  const mediaUrl = buildDyadMediaThumbnailUrl(
    appPath,
    file.fileName,
    file.modifiedAtMs,
    file.sizeBytes,
  );
  const [imgError, setImgError] = useState(false);

  const actions: MediaAction[] = [
    {
      key: "save-as",
      testId: "media-save-as",
      label: "Save As…",
      icon: Download,
      onSelect: () => onSaveAs(file),
    },
    {
      key: "copy",
      testId: "media-copy-image",
      label: "Copy Image",
      icon: Copy,
      onSelect: () => onCopyImage(file),
    },
    {
      key: "show-in-folder",
      testId: "media-show-in-folder",
      label: "Show in Folder",
      icon: FolderOpen,
      onSelect: () => onShowInFolder(file),
    },
    {
      key: "chat",
      testId: "media-start-chat-with-image",
      label: "Start New Chat With Image",
      icon: MessageSquarePlus,
      onSelect: () => {
        void onStartNewChatWithImage(file);
      },
      separatorBefore: true,
    },
    {
      key: "rename",
      testId: "media-rename-image",
      label: "Rename Image",
      icon: Pencil,
      onSelect: () => onRenameImage(file),
    },
    {
      key: "move",
      testId: "media-move-to-submenu",
      label: "Move To",
      icon: MoveRight,
      onSelect: () => onMoveImage(file),
    },
    {
      key: "section",
      testId: "media-set-section",
      label: "Set Section",
      icon: Tag,
      onSelect: () => onSetSection(file),
    },
    {
      key: "pin",
      testId: "media-toggle-pin",
      label: file.pinned ? "Unpin (allow archiving)" : "Pin (keep forever)",
      icon: file.pinned ? PinOff : Pin,
      onSelect: () => onTogglePin(file),
    },
    {
      key: "delete",
      testId: "media-delete-image",
      label: "Delete Image",
      icon: Trash2,
      onSelect: () => onDeleteImage(file),
      destructive: true,
      separatorBefore: true,
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          data-testid="media-thumbnail"
          data-media-file-name={file.fileName}
          className="w-[120px] border rounded-md overflow-hidden bg-secondary/30"
        >
          <div
            role="button"
            tabIndex={0}
            draggable
            title="Click to preview. Drag onto your desktop or another app to copy it out. Right-click for more."
            className="group w-[120px] h-[120px] relative cursor-pointer"
            onClick={() => onPreviewImage(file)}
            onDragStart={(e) => {
              // Hand the drag to the system so the real file can be dropped
              // on the desktop, in Explorer, or into other apps.
              e.preventDefault();
              ipc.media.startDrag({ filePath: file.filePath });
            }}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                onPreviewImage(file);
              }
            }}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                data-testid="media-file-actions-trigger"
                aria-label={`Media actions for ${file.fileName}`}
                className={cn(
                  buttonVariants({
                    variant: "secondary",
                    size: "icon",
                  }),
                  "absolute right-1 top-1 size-7",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                onClick={(event) => event.stopPropagation()}
              >
                {actions.map((action) => (
                  <div key={action.key}>
                    {action.separatorBefore && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      data-testid={action.testId}
                      variant={action.destructive ? "destructive" : undefined}
                      onClick={action.onSelect}
                      disabled={isBusy}
                    >
                      <action.icon className="mr-2 h-4 w-4" />
                      {action.label}
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {file.pinned && (
              <div
                data-testid="media-pinned-badge"
                title="Pinned: never moved to the archive"
                className="absolute left-1 top-1 z-10 flex size-6 items-center justify-center rounded-full bg-secondary shadow"
              >
                <Pin className="h-3.5 w-3.5" />
              </div>
            )}

            {imgError ? (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <Image className="h-6 w-6" />
              </div>
            ) : (
              <>
                <img
                  src={mediaUrl}
                  alt={file.fileName}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                  <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                </div>
              </>
            )}
          </div>
          <div className="p-1.5">
            <p
              className="text-xs truncate text-muted-foreground"
              title={[
                file.fileName,
                file.engine ? `Engine: ${file.engine}` : "",
                file.prompt ? `Prompt: ${file.prompt}` : "",
              ]
                .filter(Boolean)
                .join("\n")}
            >
              {file.fileName}
            </p>
            {file.section && (
              <p
                className="text-[10px] truncate text-primary/80"
                title={`Section: ${file.section}`}
              >
                {file.section}
              </p>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {actions.map((action) => (
          <div key={action.key}>
            {action.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem
              data-testid={`${action.testId}-context`}
              variant={action.destructive ? "destructive" : undefined}
              onClick={action.onSelect}
              disabled={isBusy}
            >
              <action.icon className="mr-2 h-4 w-4" />
              {action.label}
            </ContextMenuItem>
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
