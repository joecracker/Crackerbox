import {
  SendHorizontalIcon,
  StopCircleIcon,
  FolderOpenIcon,
  XIcon,
  Hammer,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { useSettings } from "@/hooks/useSettings";
import { homeChatInputValueAtom, homeSelectedAppAtom } from "@/atoms/chatAtoms";
import { useAtom } from "jotai";
import { useState } from "react";
import type { ReactNode } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "./AttachmentsList";
import { DragDropOverlay } from "./DragDropOverlay";
import { FileAttachmentTypeDialog } from "./FileAttachmentTypeDialog";
import { HomeSubmitOptions } from "@/pages/home";
import { ChatInputControls } from "../ChatInputControls";
import { ModelPicker } from "../ModelPicker";
import { LexicalChatInput } from "./LexicalChatInput";
import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";
import { ImportAppButton } from "@/components/ImportAppButton";
import { ImportAppDialog } from "@/components/ImportAppDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { AppSearchDialog } from "../AppSearchDialog";

export function HomeChatInput({
  onSubmit,
  disabled = false,
  setupAction,
}: {
  onSubmit: (options?: HomeSubmitOptions) => boolean | Promise<boolean>;
  disabled?: boolean;
  setupAction?: ReactNode;
}) {
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const [selectedApp, setSelectedApp] = useAtom(homeSelectedAppAtom);
  const { settings } = useSettings();
  const { isStreaming } = useStreamChat({
    hasChatId: false,
  }); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [appSearchOpen, setAppSearchOpen] = useState(false);
  const [importAppOpen, setImportAppOpen] = useState(false);
  const isMobile = useIsMobile();
  const { apps, loading: appsLoading } = useLoadApps();
  const canSelectApp = !appsLoading && apps.length > 0;

  const placeholder = selectedApp
    ? `Send a message to ${selectedApp.name}...`
    : isMobile
      ? "Message Crackerbox..."
      : "Ask Crackerbox to build something...";

  // Use the attachments hook
  const {
    attachments,
    isDraggingOver,
    pendingFiles,
    handleFileSelect,
    removeAttachment,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    confirmPendingFiles,
    cancelPendingFiles,
  } = useAttachments();

  const handleSelectApp = (appId: number) => {
    const app = apps.find((a) => a.id === appId);
    if (app) {
      setSelectedApp(app);
    }
    setAppSearchOpen(false);
  };

  // Custom submit function that wraps the provided onSubmit
  const handleCustomSubmit = async (
    requestedChatMode: "ask" | "local-agent" = "ask",
  ) => {
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isStreaming ||
      disabled ||
      pendingFiles
    ) {
      return;
    }

    // Call the parent's onSubmit handler with attachments and selected app
    const didSubmit = await onSubmit({
      attachments,
      selectedApp: selectedApp ?? undefined,
      requestedChatMode,
    });

    if (!didSubmit) {
      return;
    }

    // The first-prompt saga owns clearing the snapshotted editing buffer and
    // recording submission analytics at the actual prompt-dispatch commit.
  };

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      <div className="px-3 py-3 sm:p-4" data-testid="home-chat-input-container">
        <div
          aria-disabled={disabled}
          inert={disabled}
          className={cn(
            "relative flex flex-col border border-border rounded-2xl bg-(--background-lighter) transition-colors duration-200",
            "hover:border-primary/30",
            "focus-within:border-[var(--brand-pinstripe)] focus-within:ring-1 focus-within:ring-[var(--brand-pinstripe-soft)]",
            isDraggingOver && "ring-2 ring-blue-500 border-blue-500",
            disabled && "pointer-events-none opacity-70",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attachments list */}
          <AttachmentsList
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Drag and drop overlay */}
          <DragDropOverlay isDraggingOver={isDraggingOver} />

          {/* Dialog for choosing attachment type */}
          <FileAttachmentTypeDialog
            pendingFiles={pendingFiles}
            onConfirm={confirmPendingFiles}
            onCancel={cancelPendingFiles}
          />

          <div className="flex items-end gap-1">
            <LexicalChatInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleCustomSubmit}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={isStreaming || disabled}
              excludeCurrentApp={false}
              disableSendButton={false}
              messageHistory={[]}
            />

            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      aria-label="Cancel generation (unavailable here)"
                      className="px-2 py-2 mb-0.5 mr-1 text-muted-foreground rounded-lg opacity-50 cursor-not-allowed transition-colors duration-150"
                    />
                  }
                >
                  <StopCircleIcon size={20} />
                </TooltipTrigger>
                <TooltipContent>
                  Cancel generation (unavailable here)
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="mb-0.5 mr-1 flex items-center">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => handleCustomSubmit("local-agent")}
                        disabled={
                          disabled ||
                          (!inputValue.trim() && attachments.length === 0)
                        }
                        aria-label="Build this"
                        className="px-2 py-2 text-muted-foreground hover:text-[var(--brand-pinstripe)] rounded-lg transition-colors duration-150 disabled:opacity-30 disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default"
                      />
                    }
                  >
                    <Hammer size={18} />
                  </TooltipTrigger>
                  <TooltipContent>Build this</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => handleCustomSubmit("ask")}
                        disabled={
                          disabled ||
                          (!inputValue.trim() && attachments.length === 0)
                        }
                        aria-label="Send message"
                        className="px-2 py-2 text-muted-foreground hover:text-primary rounded-lg transition-colors duration-150 disabled:opacity-30 disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default"
                      />
                    }
                  >
                    <SendHorizontalIcon size={20} />
                  </TooltipTrigger>
                  <TooltipContent>Send without changing files</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
          {isMobile ? (
            <div className="flex min-w-0 items-center gap-1 px-3 pb-2 pt-1">
              <AuxiliaryActionsMenu
                compact
                onFileSelect={handleFileSelect}
                onSelectApp={
                  canSelectApp ? () => setAppSearchOpen(true) : undefined
                }
                onImportApp={() => setImportAppOpen(true)}
              />
              <ModelPicker />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1 pt-0.5">
              <ChatInputControls />
              <div className="contents" data-testid="home-chat-actions">
                {canSelectApp && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          onClick={() => {
                            if (!disabled) setAppSearchOpen(true);
                          }}
                          disabled={disabled}
                          className={cn(
                            "cursor-pointer h-7 px-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1",
                            selectedApp
                              ? "bg-primary/10 text-primary hover:bg-primary/15"
                              : "text-foreground/80 hover:text-foreground hover:bg-muted/60",
                          )}
                          data-testid="home-app-selector"
                        />
                      }
                    >
                      <FolderOpenIcon size={14} />
                      {selectedApp && (
                        <>
                          <span className="truncate max-w-[90px]">
                            {selectedApp.name}
                          </span>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedApp(null);
                            }}
                            className="hover:bg-primary/20 rounded-sm p-0.5 transition-colors"
                            aria-label="Deselect app"
                            data-testid="home-app-selector-clear"
                          >
                            <XIcon size={12} />
                          </button>
                        </>
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      {selectedApp
                        ? "Change selected app"
                        : "Select an existing app"}
                    </TooltipContent>
                  </Tooltip>
                )}

                <ImportAppButton
                  className="px-0 pb-0"
                  variant="ghost"
                  size="sm"
                />
                <AuxiliaryActionsMenu onFileSelect={handleFileSelect} />
              </div>
            </div>
          )}
        </div>
        {isMobile && (
          <div
            className="mt-2 flex items-center justify-between gap-2 px-2"
            data-testid="home-chat-mobile-controls"
          >
            {selectedApp && (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground"
                onClick={() => setSelectedApp(null)}
                aria-label={`Deselect ${selectedApp.name}`}
              >
                <span className="truncate">{selectedApp.name}</span>
                <XIcon size={12} className="shrink-0" />
              </button>
            )}
            {setupAction}
          </div>
        )}
      </div>

      {importAppOpen && (
        <ImportAppDialog
          isOpen={importAppOpen}
          onClose={() => setImportAppOpen(false)}
        />
      )}

      {appSearchOpen && canSelectApp && (
        <AppSearchDialog
          open={appSearchOpen}
          onOpenChange={setAppSearchOpen}
          onSelectApp={handleSelectApp}
          disableShortcut
          allApps={apps.map((a) => ({
            id: a.id,
            name: a.name,
            createdAt: a.createdAt,
            matchedChatTitle: null,
            matchedChatMessage: null,
          }))}
        />
      )}
    </>
  );
}
